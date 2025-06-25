import React, { useEffect, useRef, useImperativeHandle, useState, forwardRef } from 'react';
import { Typography } from '@mui/material';
import Handsontable from 'handsontable';
import 'handsontable/dist/handsontable.full.min.css';

// Utility: Parse HTML table to Handsontable data and mergeCells config
function parseHtmlTableToHot(tableHtml) {
  if (!tableHtml) return { data: [[]], mergeCells: [] };
  const parser = new window.DOMParser();
  const doc = parser.parseFromString(tableHtml, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return { data: [[]], mergeCells: [] };
  const rows = Array.from(table.querySelectorAll('tr'));
  let maxCols = 0;
  // First pass: determine max columns
  rows.forEach(tr => {
    let colCount = 0;
    Array.from(tr.children).forEach(cell => {
      const colspan = parseInt(cell.getAttribute('colspan')) || 1;
      colCount += colspan;
    });
    maxCols = Math.max(maxCols, colCount);
  });
  // Second pass: build data and mergeCells
  const data = [];
  const mergeCells = [];
  const cellMatrix = [];
  rows.forEach((tr, rowIdx) => {
    if (!data[rowIdx]) data[rowIdx] = [];
    if (!cellMatrix[rowIdx]) cellMatrix[rowIdx] = [];
    let colIdx = 0;
    Array.from(tr.children).forEach(cell => {
      // Skip over merged cells
      while (cellMatrix[rowIdx][colIdx]) colIdx++;
      const text = cell.innerHTML.replace(/<br\s*\/?>(\n)?/g, '\n').replace(/<[^>]+>/g, '').trim();
      const rowspan = parseInt(cell.getAttribute('rowspan')) || 1;
      const colspan = parseInt(cell.getAttribute('colspan')) || 1;
      data[rowIdx][colIdx] = text;
      // Mark merged cells in matrix
      if (rowspan > 1 || colspan > 1) {
        mergeCells.push({ row: rowIdx, col: colIdx, rowspan, colspan });
        for (let r = 0; r < rowspan; r++) {
          for (let c = 0; c < colspan; c++) {
            if (!cellMatrix[rowIdx + r]) cellMatrix[rowIdx + r] = [];
            cellMatrix[rowIdx + r][colIdx + c] = true;
          }
        }
      } else {
        cellMatrix[rowIdx][colIdx] = true;
      }
      colIdx += colspan;
    });
    // Fill missing columns
    for (let i = 0; i < maxCols; i++) {
      if (typeof data[rowIdx][i] === 'undefined') data[rowIdx][i] = '';
    }
  });
  return { data, mergeCells };
}

// Utility: Convert Handsontable data + mergeCells to HTML table
function hotToHtmlTable(data, mergeCells) {
  if (!data || !data.length) return '<table border="1"></table>';
  // Build a matrix to track merged cells
  const rowCount = data.length;
  const colCount = Math.max(...data.map(row => row.length));
  const skip = Array.from({ length: rowCount }, () => Array(colCount).fill(false));
  let html = '<table border="1">';
  for (let r = 0; r < rowCount; r++) {
    html += '<tr>';
    for (let c = 0; c < colCount; c++) {
      if (skip[r][c]) continue;
      // Find if this cell is the start of a merge
      const merge = mergeCells.find(m => m.row === r && m.col === c);
      let attrs = '';
      if (merge) {
        if (merge.rowspan > 1) attrs += ` rowspan=\"${merge.rowspan}\"`;
        if (merge.colspan > 1) attrs += ` colspan=\"${merge.colspan}\"`;
        // Mark all covered cells to skip
        for (let rr = 0; rr < merge.rowspan; rr++) {
          for (let cc = 0; cc < merge.colspan; cc++) {
            if (rr !== 0 || cc !== 0) skip[r + rr][c + cc] = true;
          }
        }
      }
      const cellText = (data[r][c] || '').replace(/\n/g, '<br>');
      html += `<td${attrs}>${cellText}</td>`;
    }
    html += '</tr>';
  }
  html += '</table>';
  return html;
}

const TableEditor = forwardRef(({
  tableHtml,
  onExportHtml,
  model,
  modelIndex,
  diffInfo,
  onCellEditCommit,
  hideInstructions = false
}, ref) => {
  const containerRef = useRef(null);
  const hotInstanceRef = useRef(null);
  // For diff highlighting
  const [lastHtml, setLastHtml] = useState('');

  // Parse HTML table to Handsontable data/mergeCells
  function getHotConfigFromHtml(html) {
    const { data, mergeCells } = parseHtmlTableToHot(html);
    return { data, mergeCells };
  }

  // Initialize Handsontable
  useEffect(() => {
    if (!containerRef.current) return;
    // Destroy previous instance if exists
    if (hotInstanceRef.current) {
      hotInstanceRef.current.destroy();
      hotInstanceRef.current = null;
    }
    const { data, mergeCells } = getHotConfigFromHtml(tableHtml);
    hotInstanceRef.current = new Handsontable(containerRef.current, {
      data,
      colHeaders: false,
      rowHeaders: false,
      width: '100%',
      height: '100%',
      stretchH: 'all',
      licenseKey: 'non-commercial-and-evaluation',
      mergeCells,
      contextMenu: true,
      manualRowMove: true,
      manualColumnMove: true,
      manualRowResize: true,
      manualColumnResize: true,
      afterChange: (changes, source) => {
        // Only trigger onCellEditCommit for real user edits
        const userSources = ['edit', 'paste', 'autofill', 'UndoRedo.undo', 'UndoRedo.redo'];
        if (!userSources.includes(source)) return;
        const newData = hotInstanceRef.current.getData();
        const newMergeCells = hotInstanceRef.current.getPlugin('mergeCells').mergedCellsCollection.mergedCells;
        const html = hotToHtmlTable(newData, newMergeCells);
        setLastHtml(html);
        if (onExportHtml) onExportHtml(html);
        if (onCellEditCommit) onCellEditCommit();
      },
      afterMergeCells: () => {
        if (!hotInstanceRef.current) return;
        const newData = hotInstanceRef.current.getData();
        const newMergeCells = hotInstanceRef.current.getPlugin('mergeCells').mergedCellsCollection.mergedCells;
        const html = hotToHtmlTable(newData, newMergeCells);
        setLastHtml(html);
        if (onExportHtml) onExportHtml(html);
      },
      afterUnmergeCells: () => {
        if (!hotInstanceRef.current) return;
        const newData = hotInstanceRef.current.getData();
        const newMergeCells = hotInstanceRef.current.getPlugin('mergeCells').mergedCellsCollection.mergedCells;
        const html = hotToHtmlTable(newData, newMergeCells);
        setLastHtml(html);
        if (onExportHtml) onExportHtml(html);
      },
      beforeMergeCells: (cellRange, auto) => {
        if (!hotInstanceRef.current) return;
        const hot = hotInstanceRef.current;
        let mergedContent = '';
        for (let row = cellRange.from.row; row <= cellRange.to.row; row++) {
          for (let col = cellRange.from.col; col <= cellRange.to.col; col++) {
            const value = hot.getDataAtCell(row, col);
            if (value && value.trim() !== '') {
              if (mergedContent) mergedContent += ' ';
              mergedContent += value;
            }
          }
        }
        // Set the concatenated value to the top-left cell
        setTimeout(() => {
          if (!hotInstanceRef.current) return;
          hotInstanceRef.current.setDataAtCell(cellRange.from.row, cellRange.from.col, mergedContent);
        }, 0);
      },
      cells: (row, col) => {
        // Diff highlighting
        if (!diffInfo || !diffInfo.table_diff) return {};
        const diff = diffInfo.table_diff.find(d => d.row === row && d.col === col && d.diff_type && d.diff_type.length > 0);
        if (diff) {
          return {
            className: modelIndex === 0 ? 'hot-diff-cell-0' : 'hot-diff-cell-1'
          };
        }
        return {};
      },
    });
    // Set initial html for undo/imperative
    setLastHtml(hotToHtmlTable(data, mergeCells));
    return () => {
      if (hotInstanceRef.current) {
        hotInstanceRef.current.destroy();
        hotInstanceRef.current = null;
      }
    };
    // eslint-disable-next-line
  }, [tableHtml, diffInfo]);

  // Expose imperative API
  useImperativeHandle(ref, () => ({
    generateCorrectedHtml: () => {
      if (!hotInstanceRef.current) return lastHtml;
      const data = hotInstanceRef.current.getData();
      const mergeCells = hotInstanceRef.current.getPlugin('mergeCells').mergedCellsCollection.mergedCells;
      return hotToHtmlTable(data, mergeCells);
    },
    undo: () => hotInstanceRef.current && hotInstanceRef.current.undo(),
    canUndo: () => hotInstanceRef.current && hotInstanceRef.current.isUndoAvailable()
  }));

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {!hideInstructions && (
        <Typography variant="body2" sx={{ p: 1, color: 'text.secondary' }}>
          Table editing powered by Handsontable
        </Typography>
      )}
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, minWidth: 0, width: '100%', height: '100%' }} />
      {/* Diff highlighting styles */}
      <style>{`
        .hot-diff-cell-0 { background: #ffcccc !important; }
        .hot-diff-cell-1 { background: #ccffcc !important; }
      `}</style>
    </div>
  );
});

export default TableEditor; 