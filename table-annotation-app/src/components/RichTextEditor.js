import React, { useRef, useEffect, useState } from 'react';
import { Editor } from '@monaco-editor/react';
import { Box } from '@mui/material';

const RichTextEditor = ({ 
  text, 
  onTextChange, 
  model, 
  diffInfo, 
  modelIndex,
  height = '100%'
}) => {
  const editorRef = useRef(null);
  const [decorations, setDecorations] = useState([]);

  // Handle editor mount
  const handleEditorDidMount = (editor, monaco) => {
    editorRef.current = editor;
    
    // Configure editor options
    editor.updateOptions({
      fontSize: 13,
      fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
      lineNumbers: 'on',
      wordWrap: 'on',
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true
    });

    // Apply initial decorations
    updateDecorations();
  };

  // Handle text changes
  const handleChange = (value) => {
    if (onTextChange) {
      onTextChange(value || '');
    }
  };

  // Update decorations based on diff info
  const updateDecorations = () => {
    if (!editorRef.current || !diffInfo || !diffInfo.plain_text_diff) {
      return;
    }

    const monaco = window.monaco;
    if (!monaco) return;

    const newDecorations = [];
    const lines = text.split('\n');

    // Build line diff map
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

    // Create decorations for each line with differences
    Object.entries(lineDiffMap).forEach(([lineIndex, diff]) => {
      const lineNum = parseInt(lineIndex) + 1; // Monaco uses 1-based line numbers
      
      if (diff.type === 'partial_match') {
        // Handle character-level differences
        const charDiffs = modelIndex === 0 
          ? diff.char_diffs_first_model 
          : diff.char_diffs_second_model;
        
        if (charDiffs && charDiffs.length > 0) {
          charDiffs.forEach(([start, end]) => {
            newDecorations.push({
              range: new monaco.Range(lineNum, start + 1, lineNum, end + 1),
              options: {
                className: modelIndex === 0 ? 'diff-highlight-red' : 'diff-highlight-green',
                stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
              }
            });
          });
        }
      } else {
        // Highlight entire line for unmatched content
        newDecorations.push({
          range: new monaco.Range(lineNum, 1, lineNum, lines[lineIndex]?.length + 1 || 1),
          options: {
            className: modelIndex === 0 ? 'diff-highlight-red' : 'diff-highlight-green',
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
          }
        });
      }
    });

    // Apply decorations
    const decorationIds = editorRef.current.deltaDecorations(decorations, newDecorations);
    setDecorations(decorationIds);
  };

  // Update decorations when diff info or text changes
  useEffect(() => {
    updateDecorations();
  }, [diffInfo, text, modelIndex]);

  return (
    <Box sx={{ height, position: 'relative' }}>
      {/* Add custom CSS for diff highlighting */}
      <style>
        {`
          .diff-highlight-red {
            background-color: rgba(255, 0, 0, 0.2) !important;
            border-bottom: 2px solid #ff0000;
          }
          .diff-highlight-green {
            background-color: rgba(0, 255, 0, 0.2) !important;
            border-bottom: 2px solid #00ff00;
          }
          .monaco-editor .diff-highlight-red {
            background-color: rgba(255, 0, 0, 0.15) !important;
          }
          .monaco-editor .diff-highlight-green {
            background-color: rgba(0, 255, 0, 0.15) !important;
          }
        `}
      </style>
      
      <Editor
        height={height}
        defaultLanguage="plaintext"
        value={text}
        onChange={handleChange}
        onMount={handleEditorDidMount}
        theme="vs"
        options={{
          fontSize: 13,
          fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
          lineNumbers: 'on',
          wordWrap: 'on',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          padding: { top: 10, bottom: 10 }
        }}
      />
    </Box>
  );
};

export default RichTextEditor; 