import React, { useState, useEffect } from 'react';
import { Box, Typography, TextField, Button, TableContainer, Table, TableBody, TableRow, TableCell, Paper, Dialog, DialogTitle, DialogContent, DialogActions, Menu, MenuItem, Divider } from '@mui/material';

const TableEditor = React.forwardRef(({ 
  tableHtml, 
  onAnnotationSaved, 
  existingAnnotations = [], 
  onExportHtml, 
  autoSave = true, 
  onEditingStateChange = () => {},
  hideInstructions = false,
  model,
  modelIndex,
  diffInfo,
  onCellEditCommit
}, ref) => {
  const [tableData, setTableData] = useState({ rows: [], headers: [] });
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [corrections, setCorrections] = useState({});
  const [selectedCells, setSelectedCells] = useState([]);
  const [anchorEl, setAnchorEl] = useState(null);
  const [contextMenuPosition, setContextMenuPosition] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [history, setHistory] = useState([]);
  const [currentHistoryIndex, setCurrentHistoryIndex] = useState(-1);

  const HIGHLIGHT_COLORS = [
    '#ffcccc', // model 0: red
    '#ccffcc'  // model 1: green
  ];

  // Helper function to sanitize table HTML
  const sanitizeTableHtml = (tableHtml) => {
    // Remove bare <table> if followed by <table border="1">
    let cleaned = tableHtml.replace(/<table>\s*<table\s+[^>]*>/g, '<table border="1">');
    
    // Count opening and closing tags
    const openTags = (cleaned.match(/<table[^>]*>/g) || []).length;
    const closeTags = (cleaned.match(/<\/table>/g) || []).length;
    
    // Add missing closing tags
    if (openTags > closeTags) {
      cleaned += '</table>'.repeat(openTags - closeTags);
    }
    
    return cleaned;
  };

  // Updated parseHtmlTable function to handle colspan and rowspan
  const parseHtmlTable = (tableHtml) => {
    if (!tableHtml) {
      console.error('No table HTML provided');
      return { rows: [], originalTable: null };
    }

    // Sanitize the table HTML first
    const cleanedHtml = sanitizeTableHtml(tableHtml);
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(cleanedHtml, 'text/html');
    const tableElement = doc.querySelector('table');
    
    if (!tableElement) {
      console.error('No table found in HTML');
      return { rows: [], originalTable: null };
    }
    
    const rows = [];
    const rowElements = tableElement.querySelectorAll('tr');
    
    // Create a grid to track which cells are occupied by rowspan/colspan
    const grid = [];
    
    rowElements.forEach((rowElement, rowIndex) => {
      const row = [];
      const cells = rowElement.querySelectorAll('th, td');
      
      // Initialize this row in the grid if it doesn't exist
      if (!grid[rowIndex]) {
        grid[rowIndex] = [];
      }
      
      let colIndex = 0;
      cells.forEach((cell) => {
        // Skip cells that are already occupied by rowspan from above
        while (grid[rowIndex][colIndex]) {
          colIndex++;
        }
        
        const rowspan = parseInt(cell.getAttribute('rowspan')) || 1;
        const colspan = parseInt(cell.getAttribute('colspan')) || 1;
        const isHeader = cell.tagName.toLowerCase() === 'th';
        const cellText = cell.innerHTML.trim();
        
        row.push({
          text: cellText,
          isHeader,
          rowspan,
          colspan,
          originalCell: cell,
          rowIndex,
          colIndex
        });
        
        // Mark the grid as occupied for this cell and any cells it spans
        for (let r = 0; r < rowspan; r++) {
          if (!grid[rowIndex + r]) {
            grid[rowIndex + r] = [];
          }
          for (let c = 0; c < colspan; c++) {
            grid[rowIndex + r][colIndex + c] = { spannedBy: { row: rowIndex, col: colIndex } };
          }
        }
        
        colIndex += colspan;
      });
      
      rows.push(row);
    });
    
    return { rows, originalTable: tableElement };
  };

  // Function to save state to history
  const saveToHistory = (newState) => {
    // Remove any future states if we're in the middle of the history
    const newHistory = history.slice(0, currentHistoryIndex + 1);
    newHistory.push(JSON.stringify(newState));
    setHistory(newHistory);
    setCurrentHistoryIndex(newHistory.length - 1);
  };

  // Function to handle undo
  const handleUndo = () => {
    if (currentHistoryIndex > 0) {
      const previousState = JSON.parse(history[currentHistoryIndex - 1]);
      setTableData(previousState);
      setCurrentHistoryIndex(currentHistoryIndex - 1);
      
      // Generate and save HTML from the previous state
      const correctedHtml = generateFinalHtml();
      if (onExportHtml) {
        onExportHtml(correctedHtml);
      }
    }
  };

  // Parse the HTML table into a structured format
  useEffect(() => {
    if (!tableHtml) return;

    const parsedTable = parseHtmlTable(tableHtml);
    setTableData(parsedTable);
    // Initialize history with the first state
    if (history.length === 0) {
      saveToHistory(parsedTable);
    }
  }, [tableHtml]);

  // Load existing annotations when they change
  useEffect(() => {
    if (existingAnnotations && existingAnnotations.length > 0) {
      const newCorrections = {};
      
      existingAnnotations.forEach(annotation => {
        newCorrections[annotation.id] = {
          original: annotation.originalText,
          corrected: annotation.correctedText,
          timestamp: annotation.timestamp
        };
      });
      
      setCorrections(newCorrections);
    }
  }, [existingAnnotations]);

  // Apply corrections to tableData when it's loaded and corrections exist
  useEffect(() => {
    if (tableData.rows.length > 0 && Object.keys(corrections).length > 0) {
      const updatedRows = [...tableData.rows];
      
      Object.entries(corrections).forEach(([cellId, correction]) => {
        for (let rowIndex = 0; rowIndex < updatedRows.length; rowIndex++) {
          const cellIndex = updatedRows[rowIndex].findIndex(cell => cell.id === cellId);
          
          if (cellIndex !== -1) {
            updatedRows[rowIndex][cellIndex] = {
              ...updatedRows[rowIndex][cellIndex],
              text: correction.corrected
            };
            break;
          }
        }
      });
      
      setTableData({ ...tableData, rows: updatedRows });
    }
  }, [tableData, corrections]);

  // Improved save function to ensure changes are persisted
  const handleSaveChanges = () => {
    if (!onExportHtml) return;
    
    // Generate new HTML
    const correctedHtml = generateFinalHtml();
    
    // Ensure the save is triggered
    Promise.resolve().then(() => {
      onExportHtml(correctedHtml);
      if (onCellEditCommit) onCellEditCommit();
    });
  };

  // Handle table content change
  const handleAddRow = (index) => {
    const updatedRows = [...tableData.rows];
    const templateRow = updatedRows[index];
    
    // Create new row based on the template row
    const newRow = templateRow.map((cell, colIndex) => ({
      text: '',
      isHeader: false,
      rowspan: 1,
      colspan: 1,
      rowIndex: index + 1,
      colIndex: colIndex,
      originalCell: null
    }));

    // Insert the new row after the specified index
    updatedRows.splice(index + 1, 0, newRow);

    // Update rowIndex for all rows after the insertion
    for (let i = index + 2; i < updatedRows.length; i++) {
      updatedRows[i] = updatedRows[i].map(cell => 
        cell ? { ...cell, rowIndex: i } : null
      );
    }

    const newState = { ...tableData, rows: updatedRows };
    setTableData(newState);
    saveToHistory(newState);
    handleSaveChanges();
    if (onCellEditCommit) onCellEditCommit();
  };

  // Handle adding column
  const handleAddColumn = (index) => {
    const updatedRows = tableData.rows.map((row, rowIndex) => {
      const newCell = {
        text: '',
        isHeader: row[0]?.isHeader || false,
        rowspan: 1,
        colspan: 1,
        rowIndex: rowIndex,
        colIndex: index + 1,
        originalCell: null
      };

      const newRow = [...row];
      newRow.splice(index + 1, 0, newCell);

      for (let i = index + 2; i < newRow.length; i++) {
        if (newRow[i]) {
          newRow[i] = { ...newRow[i], colIndex: i };
        }
      }

      return newRow;
    });

    const newState = { ...tableData, rows: updatedRows };
    setTableData(newState);
    saveToHistory(newState);
    handleSaveChanges();
    if (onCellEditCommit) onCellEditCommit();
  };

  // Handle delete column
  const handleDeleteColumn = (index) => {
    const updatedRows = JSON.parse(JSON.stringify(tableData.rows));
    
    updatedRows.forEach((row, rowIndex) => {
      row.splice(index, 1);
      
      row.forEach((cell, colIndex) => {
        if (cell) {
          cell.colIndex = colIndex;
        }
      });
    });

    const newState = { ...tableData, rows: updatedRows };
    setTableData(newState);
    saveToHistory(newState);
    
    const correctedHtml = generateFinalHtml();
    if (onExportHtml) {
      onExportHtml(correctedHtml);
    }
    if (onCellEditCommit) onCellEditCommit();
  };

  // Handle merge cells
  const handleMergeCells = () => {
    if (selectedCells.length < 2) return;

    const sortedCells = [...selectedCells].sort((a, b) => {
      if (a.rowIndex !== b.rowIndex) return a.rowIndex - b.rowIndex;
      return a.colIndex - b.colIndex;
    });

    const firstCell = sortedCells[0];
    const lastCell = sortedCells[sortedCells.length - 1];
    const rowspan = lastCell.rowIndex - firstCell.rowIndex + 1;
    const colspan = lastCell.colIndex - firstCell.colIndex + 1;

    if (selectedCells.length !== rowspan * colspan) {
      console.error('Invalid cell selection for merge');
      return;
    }

    const updatedRows = JSON.parse(JSON.stringify(tableData.rows));

    const mergedText = selectedCells
      .map(cell => {
        const cellData = updatedRows[cell.rowIndex][cell.colIndex];
        return cellData ? cellData.text : '';
      })
      .filter(text => text)
      .join(' ');

    updatedRows[firstCell.rowIndex][firstCell.colIndex] = {
      ...updatedRows[firstCell.rowIndex][firstCell.colIndex],
      text: mergedText,
      rowspan,
      colspan,
      originalCell: null
    };

    for (let i = firstCell.rowIndex; i <= lastCell.rowIndex; i++) {
      for (let j = firstCell.colIndex; j <= lastCell.colIndex; j++) {
        if (i !== firstCell.rowIndex || j !== firstCell.colIndex) {
          updatedRows[i][j] = null;
        }
      }
    }

    const newState = { ...tableData, rows: updatedRows };
    setTableData(newState);
    saveToHistory(newState);
    
    const correctedHtml = generateFinalHtml();
    if (onExportHtml) {
      onExportHtml(correctedHtml);
    }
    if (onCellEditCommit) onCellEditCommit();

    setSelectedCells([]);
  };

  // Handle split cell
  const handleSplitCell = (rowIndex, colIndex) => {
    const cell = tableData.rows[rowIndex][colIndex];
    if (cell.rowspan === 1 && cell.colspan === 1) return;

    const updatedRows = [...tableData.rows];
    for (let i = 0; i < cell.rowspan; i++) {
      for (let j = 0; j < cell.colspan; j++) {
        if (i === 0 && j === 0) {
          updatedRows[rowIndex][colIndex] = {
            ...cell,
            rowspan: 1,
            colspan: 1
          };
        } else {
          updatedRows[rowIndex + i][colIndex + j] = {
            text: '',
            isHeader: cell.isHeader,
            rowspan: 1,
            colspan: 1,
            rowIndex: rowIndex + i,
            colIndex: colIndex + j,
            originalCell: null
          };
        }
      }
    }

    const newState = { ...tableData, rows: updatedRows };
    setTableData(newState);
    saveToHistory(newState);
    handleSaveChanges();
    if (onCellEditCommit) onCellEditCommit();
  };

  // Handle cell selection
  const handleCellClick = (event, rowIndex, colIndex) => {
    if (event.ctrlKey || event.metaKey) {
      // Multi-select for merging
      const cell = { rowIndex, colIndex, text: tableData.rows[rowIndex][colIndex].text };
      setSelectedCells(prev => {
        const exists = prev.some(c => c.rowIndex === rowIndex && c.colIndex === colIndex);
        if (exists) {
          return prev.filter(c => !(c.rowIndex === rowIndex && c.colIndex === colIndex));
        }
        return [...prev, cell];
      });
    } else {
      // Regular cell editing
      setSelectedCells([]);
      const cell = tableData.rows[rowIndex][colIndex];
      setEditingCell({ rowIndex, colIndex });
    setEditValue(cell.text);
    setDialogOpen(true);
    }
  };

  // Handle context menu
  const handleContextMenu = (event, rowIndex, colIndex) => {
    event.preventDefault();
    setContextMenuPosition({ x: event.clientX, y: event.clientY });
    setAnchorEl({ rowIndex, colIndex });
  };

  const handleCloseContextMenu = () => {
    setContextMenuPosition(null);
    setAnchorEl(null);
  };

  // Add functions to handle dialog close and save
  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingCell(null);
    setEditValue('');
  };

  const handleSaveDialog = () => {
    if (editingCell) {
      const { rowIndex, colIndex } = editingCell;
      
      const updatedRows = [...tableData.rows];
      if (updatedRows[rowIndex] && updatedRows[rowIndex][colIndex]) {
        updatedRows[rowIndex][colIndex].text = editValue;
        const newState = { ...tableData, rows: updatedRows };
        setTableData(newState);
        saveToHistory(newState);
        
        if (autoSave && onExportHtml) {
          const correctedHtml = generateFinalHtml();
          onExportHtml(correctedHtml);
        }
        if (onCellEditCommit) {
          onCellEditCommit();
        }
      }
      
      setDialogOpen(false);
      setEditingCell(null);
      setEditValue('');
    }
  };

  // Improved HTML generation
  const generateFinalHtml = () => {
    if (!tableData || !tableData.rows.length) {
      console.error('No table data available');
      return '';
    }
    
    // Create a new table element with border
    const newTable = document.createElement('table');
    newTable.setAttribute('border', '1');
    const tbody = document.createElement('tbody');
    newTable.appendChild(tbody);
    
    // First, calculate the total number of columns in the table
    let totalColumns = 0;
    tableData.rows.forEach(row => {
      let rowColumns = 0;
      row.forEach(cell => {
        if (cell) {
          rowColumns += cell.colspan || 1;
        }
      });
      totalColumns = Math.max(totalColumns, rowColumns);
    });

    // Create rows and cells based on current table data
    tableData.rows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      let currentColumn = 0;

      // Process existing cells
      row.forEach((cell, colIndex) => {
        if (cell) {
          const td = document.createElement(cell.isHeader ? 'th' : 'td');
          td.innerHTML = cell.text || '';
          
          if (cell.rowspan > 1) td.setAttribute('rowspan', cell.rowspan);
          if (cell.colspan > 1) td.setAttribute('colspan', cell.colspan);
          
          tr.appendChild(td);
          currentColumn += cell.colspan || 1;
        }
      });

      // Add any missing cells to complete the row
      while (currentColumn < totalColumns) {
        const td = document.createElement('td');
        tr.appendChild(td);
        currentColumn++;
      }
      
      tbody.appendChild(tr);
    });
    
    return newTable.outerHTML;
  };

  // Check if a cell has been corrected
  const isCellCorrected = (cellId) => {
    return Object.keys(corrections).includes(cellId);
  };

  // Notify parent when editing state changes
  useEffect(() => {
    onEditingStateChange(editingCell !== null);
  }, [editingCell, onEditingStateChange]);

  // Expose methods via ref
  React.useImperativeHandle(ref, () => ({
    generateCorrectedHtml: () => {
      return generateFinalHtml();
    },
    undo: handleUndo,
    canUndo: () => currentHistoryIndex > 0
  }));

  // Handle delete row
  const handleDeleteRow = (index) => {
    const updatedRows = JSON.parse(JSON.stringify(tableData.rows));
    updatedRows.splice(index, 1);

    // Update rowIndex for all remaining rows
    for (let i = index; i < updatedRows.length; i++) {
      updatedRows[i] = updatedRows[i].map(cell => 
        cell ? { ...cell, rowIndex: i } : null
      );
    }

    const newState = { ...tableData, rows: updatedRows };
    setTableData(newState);
    saveToHistory(newState);
    
    const correctedHtml = generateFinalHtml();
    if (onExportHtml) {
      onExportHtml(correctedHtml);
    }
    if (onCellEditCommit) onCellEditCommit();
  };

  // Handle add row above
  const handleAddRowAbove = (index) => {
    const updatedRows = [...tableData.rows];
    const templateRow = updatedRows[index];
    
    // Create new row based on the template row
    const newRow = templateRow.map((cell, colIndex) => ({
      text: '',
      isHeader: false,
      rowspan: 1,
      colspan: 1,
      rowIndex: index,
      colIndex: colIndex,
      originalCell: null
    }));

    // Insert the new row at the specified index
    updatedRows.splice(index, 0, newRow);

    // Update rowIndex for all rows after the insertion
    for (let i = index + 1; i < updatedRows.length; i++) {
      updatedRows[i] = updatedRows[i].map(cell => 
        cell ? { ...cell, rowIndex: i } : null
      );
    }

    const newState = { ...tableData, rows: updatedRows };
    setTableData(newState);
    saveToHistory(newState);
    handleSaveChanges();
    if (onCellEditCommit) onCellEditCommit();
  };

  // Handle add column to the left
  const handleAddColumnLeft = (index) => {
    const updatedRows = tableData.rows.map((row, rowIndex) => {
      const newCell = {
        text: '',
        isHeader: row[0]?.isHeader || false,
        rowspan: 1,
        colspan: 1,
        rowIndex: rowIndex,
        colIndex: index,
        originalCell: null
      };

      const newRow = [...row];
      newRow.splice(index, 0, newCell);

      // Update colIndex for all cells after the insertion
      for (let i = index + 1; i < newRow.length; i++) {
        if (newRow[i]) {
          newRow[i] = { ...newRow[i], colIndex: i };
        }
      }

      return newRow;
    });

    const newState = { ...tableData, rows: updatedRows };
    setTableData(newState);
    saveToHistory(newState);
    handleSaveChanges();
    if (onCellEditCommit) onCellEditCommit();
  };

  // Helper to check if a cell should be highlighted
  function getCellDiff(rowIdx, colIdx) {
    if (!diffInfo || !diffInfo.table_diff) return null;
    return diffInfo.table_diff.find(diff => diff.row === rowIdx && diff.col === colIdx && diff.diff_type && diff.diff_type.length > 0);
  }

  // Render the table editor
  return (
    <Box sx={{ height: '100%', overflow: 'hidden' }}>
      {!hideInstructions && (
        <Typography variant="body2" sx={{ p: 1, color: 'text.secondary' }}>
        </Typography>
      )}
      
      <TableContainer 
        component={Paper} 
        sx={{ 
          height: '100%',
          overflow: 'auto',
          '& table': {
            borderCollapse: 'collapse',
            width: '100%',
          },
          '& td, & th': {
            border: '1px solid #e0e0e0',
            padding: '8px',
            position: 'relative',
            lineHeight: '1.5',
            verticalAlign: 'top'
          },
          '& tr': {
            minHeight: '28px'
          }
        }}
      >
        <Table>
              <TableBody>
                {tableData.rows.map((row, rowIndex) => (
                  <TableRow key={rowIndex}>
                {row.map((cell, colIndex) => (
                  cell && (
                        <TableCell 
                      key={`${rowIndex}-${colIndex}`}
                      onClick={(e) => handleCellClick(e, rowIndex, colIndex)}
                      onContextMenu={(e) => handleContextMenu(e, rowIndex, colIndex)}
                          rowSpan={cell.rowspan}
                          colSpan={cell.colspan}
                      component={cell.isHeader ? 'th' : 'td'}
                      align="left"
                          sx={{
                            cursor: 'pointer',
                            lineHeight: '1.5',
                        backgroundColor: selectedCells.some(
                          c => c.rowIndex === rowIndex && c.colIndex === colIndex
                        ) ? '#e3f2fd' : cell.isHeader ? '#f5f5f5' :
                          (getCellDiff(rowIndex, colIndex) ? HIGHLIGHT_COLORS[modelIndex] : 'inherit'),
                            '&:hover': {
                          backgroundColor: '#f0f7ff',
                            }
                          }}
                        >
                      {cell.text || '\u00A0'}
                        </TableCell>
                  )
                ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

      {/* Context Menu */}
      <Menu
        open={Boolean(contextMenuPosition)}
        onClose={handleCloseContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenuPosition
            ? { top: contextMenuPosition.y, left: contextMenuPosition.x }
            : undefined
        }
      >
        {anchorEl && (
          <>
            <MenuItem onClick={() => {
              handleDeleteRow(anchorEl.rowIndex);
              handleCloseContextMenu();
            }}>
              Delete Row
            </MenuItem>
            <MenuItem onClick={() => {
              handleDeleteColumn(anchorEl.colIndex);
              handleCloseContextMenu();
            }}>
              Delete Column
            </MenuItem>
            <Divider />
            <MenuItem onClick={() => {
              handleAddRowAbove(anchorEl.rowIndex);
              handleCloseContextMenu();
            }}>
              Insert Row Above
            </MenuItem>
            <MenuItem onClick={() => {
              handleAddRow(anchorEl.rowIndex);
              handleCloseContextMenu();
            }}>
              Insert Row Below
            </MenuItem>
            <MenuItem onClick={() => {
              handleAddColumnLeft(anchorEl.colIndex);
              handleCloseContextMenu();
            }}>
              Insert Column Left
            </MenuItem>
            <MenuItem onClick={() => {
              handleAddColumn(anchorEl.colIndex);
              handleCloseContextMenu();
            }}>
              Insert Column Right
            </MenuItem>
            {selectedCells.length > 1 && (
              <MenuItem onClick={() => {
                handleMergeCells();
                handleCloseContextMenu();
              }}>
                Merge Selected Cells
              </MenuItem>
            )}
            {tableData.rows[anchorEl.rowIndex][anchorEl.colIndex].rowspan > 1 ||
             tableData.rows[anchorEl.rowIndex][anchorEl.colIndex].colspan > 1 ? (
              <MenuItem onClick={() => {
                handleSplitCell(anchorEl.rowIndex, anchorEl.colIndex);
                handleCloseContextMenu();
              }}>
                Split Cell
              </MenuItem>
            ) : null}
          </>
        )}
      </Menu>

      <Dialog
        open={dialogOpen} 
        onClose={handleCloseDialog}
        maxWidth="md"
      >
        <DialogTitle>Edit Cell Content</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            multiline
            fullWidth
            minRows={3}
            maxRows={10}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            variant="outlined"
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancel</Button>
          <Button onClick={handleSaveDialog} color="primary">
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
});

export default TableEditor; 