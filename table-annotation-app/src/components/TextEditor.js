import React, { useState, useRef, useEffect } from 'react';
import { Box, TextField, Button } from '@mui/material';

function getLineDiffs(modelIndex, diffInfo, lines) {
  if (!diffInfo || !diffInfo.plain_text_diff) return [];
  // Build a map: line index -> diff object
  const lineDiffMap = {};
  diffInfo.plain_text_diff.forEach(diff => {
    if (diff.type === 'partial_match') {
      if (modelIndex === 0) {
        lineDiffMap[diff.first_model_index] = diff;
      } else {
        lineDiffMap[diff.second_model_index] = diff;
      }
    } else if (diff.type === 'first_model_unmatched' && modelIndex === 0) {
      lineDiffMap[diff.first_model_index] = diff;
    } else if (diff.type === 'second_model_unmatched' && modelIndex === 1) {
      lineDiffMap[diff.second_model_index] = diff;
    }
  });
  return lines.map((line, idx) => ({ line, diff: lineDiffMap[idx] }));
}

const HIGHLIGHT_COLORS = [
  'red',   // model 0: red text
  'green'  // model 1: green text
];

const TextEditor = ({ text, onTextChange, model, diffInfo, modelIndex, readOnly = false }) => {
  const [editMode, setEditMode] = useState(false);
  const [editValue, setEditValue] = useState(text);
  const [diffViewKey, setDiffViewKey] = useState(0);
  const textFieldRef = useRef(null);
  const [pendingEditLine, setPendingEditLine] = useState(null);

  // Sync editValue with text prop if text changes and not editing
  useEffect(() => {
    if (!editMode) setEditValue(text);
  }, [text, editMode]);

  // After entering edit mode, set cursor to start of clicked line
  useEffect(() => {
    if (!readOnly && editMode && pendingEditLine !== null && textFieldRef.current) {
      setTimeout(() => {
        const textarea = textFieldRef.current.querySelector('textarea');
        if (textarea) {
          const value = textarea.value;
          const lines = value.split('\n');
          let offset = 0;
          for (let i = 0; i < pendingEditLine; i++) {
            offset += lines[i].length + 1; // +1 for newline
          }
          textarea.focus();
          textarea.setSelectionRange(offset, offset);
        }
        setPendingEditLine(null); // clear after use
      }, 0);
    }
  }, [editMode, pendingEditLine, readOnly]);

  // Split text into lines
  const lines = text.split('\n');
  const lineDiffs = getLineDiffs(modelIndex, diffInfo, lines);

  // Render a line with color highlighting
  const renderLine = (line, diffObj, idx) => {
    if (!diffObj || !diffObj.diff) {
      // No diff for this line
      return <div key={idx}>{line}</div>;
    }
    const diff = diffObj.diff;
    if (diff.type === 'partial_match') {
      // Highlight only differing character ranges
      const charDiffs =
        modelIndex === 0 ? diff.char_diffs_first_model : diff.char_diffs_second_model;
      if (!charDiffs || charDiffs.length === 0) return <div key={idx}>{line}</div>;
      let lastIdx = 0;
      const spans = [];
      charDiffs.forEach(([start, end], i) => {
        if (start > lastIdx) {
          spans.push(<span key={i + '-n'}>{line.slice(lastIdx, start)}</span>);
        }
        spans.push(
          <span key={i} style={{ color: HIGHLIGHT_COLORS[modelIndex] }}>
            {line.slice(start, end)}
          </span>
        );
        lastIdx = end;
      });
      if (lastIdx < line.length) {
        spans.push(<span key="end">{line.slice(lastIdx)}</span>);
      }
      return <div key={idx}>{spans}</div>;
    } else if (
      (diff.type === 'first_model_unmatched' && modelIndex === 0) ||
      (diff.type === 'second_model_unmatched' && modelIndex === 1)
    ) {
      // Highlight the whole line
      return (
        <div key={idx} style={{ color: HIGHLIGHT_COLORS[modelIndex] }}>{line}</div>
      );
    }
    return <div key={idx}>{line}</div>;
  };

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#fff',
        borderRadius: 1,
        border: '1px solid #e0e0e0',
        p: 1,
        fontFamily: 'monospace',
        fontSize: 14,
        overflow: 'hidden'
      }}
    >
      {/* If in edit mode and not readOnly, show TextField, else show diff view */}
      {(!readOnly && editMode) ? (
        <TextField
          multiline
          fullWidth
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={() => {
            setEditMode(false);
            if (editValue !== text) onTextChange(editValue);
            setTimeout(() => setDiffViewKey(k => k + 1), 0); // force diff view re-render
          }}
          autoFocus
          inputRef={textFieldRef}
          variant="outlined"
          sx={{
            flex: 1,
            '& .MuiInputBase-root': {
              height: '100%'
            },
            '& .MuiInputBase-inputMultiline': {
              height: '100% !important',
              overflowY: 'auto !important'
            }
          }}
        />
      ) : diffInfo ? (
        <Box 
          key={diffViewKey} 
          sx={{ 
            flex: 1,
            overflowY: 'auto'
          }}
        >
          {lineDiffs.map((obj, idx) => (
            <div
              key={idx}
              style={{ cursor: readOnly ? 'default' : 'text' }}
              onClick={() => {
                if (!readOnly) {
                  setPendingEditLine(idx);
                  setEditMode(true);
                }
              }}
            >
              {renderLine(obj.line, obj, idx)}
            </div>
          ))}
        </Box>
      ) : (
        <TextField
          multiline
          fullWidth
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          variant="outlined"
          disabled={readOnly}
          sx={{
            flex: 1,
            '& .MuiInputBase-root': {
              height: '100%'
            },
            '& .MuiInputBase-inputMultiline': {
              height: '100% !important',
              overflowY: 'auto !important'
            }
          }}
        />
      )}
    </Box>
  );
};

export default TextEditor; 