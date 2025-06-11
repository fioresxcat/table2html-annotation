import React, { useState, useEffect, useRef } from 'react';
import { Container, AppBar, Toolbar, Typography, Box, Paper, Button, CircularProgress, Snackbar, Alert, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Grid } from '@mui/material';
import TableEditor from './components/TableEditor';
import TextEditor from './components/TextEditor';
import TableNavigator from './components/TableNavigator';
import FileBrowser from './components/FileBrowser';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { toast } from 'react-toastify';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import DownloadIcon from '@mui/icons-material/Download';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteIcon from '@mui/icons-material/Delete';
import UndoIcon from '@mui/icons-material/Undo';
import {
  getFileDetails,
  getImageUrl,
  getImageBase64,
  getParsedText,
  getAnnotations,
  saveAnnotations,
  exportText,
  updateParsedText,
  downloadAllAnnotations,
  getServerStatus,
  getTableFiles,
  excludeFile
} from './services/ApiService';
import ZoomableImage from './components/ZoomableImage';

// Create a theme
const theme = createTheme({
  palette: {
    primary: {
      main: '#1976d2',
    },
    secondary: {
      main: '#dc004e',
    },
  },
});

function App() {
  const [currentFile, setCurrentFile] = useState(null);
  const [filesList, setFilesList] = useState([]);
  const [currentFileId, setCurrentFileId] = useState(null);
  const [currentImage, setCurrentImage] = useState(null);
  const [outsideText, setOutsideText] = useState('');
  const [tables, setTables] = useState([]);
  const [currentTableIndex, setCurrentTableIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [currentAnnotations, setCurrentAnnotations] = useState([]);
  const [serverStatus, setServerStatus] = useState(null);
  const [serverConnected, setServerConnected] = useState(false);
  const [autoSave, setAutoSave] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [mobileView, setMobileView] = useState('both');
  const [confirmExcludeOpen, setConfirmExcludeOpen] = useState(false);
  const [lastPageNumber, setLastPageNumber] = useState(1);

  // Check server status on mount
  useEffect(() => {
    checkServerStatus();
  }, []);

  const checkServerStatus = async () => {
    try {
      const status = await getServerStatus();
      setServerStatus(status);
      setServerConnected(true);
    } catch (error) {
      console.error('Server connection error:', error);
      setServerConnected(false);
    }
  };

  // Add ref to access TableEditor methods
  const tableEditor = useRef(null);

  // Load a file by ID
  const loadFile = async (fileId) => {
    setIsLoading(true);
    setLoadingStatus(`Loading file...`);
    setCurrentImage(null);
    setOutsideText('');
    setTables([]);
    setCurrentTableIndex(0);
    setCurrentAnnotations([]);

    try {
      // Get file details
      const fileDetails = await getFileDetails(fileId);
      if (!fileDetails.success) {
        console.error('Error loading file details');
        setIsLoading(false);
        return;
      }

      // Set current file with pagination info
      setCurrentFile({
        ...fileDetails.file,
        pagination: fileDetails.pagination
      });
      // Store the page number
      if (fileDetails.pagination?.currentPage) {
        setLastPageNumber(fileDetails.pagination.currentPage);
      }
      setCurrentFileId(fileId);

      // Get image (either direct URL or base64)
      try {
        const imageResult = await getImageBase64(fileId);
        if (imageResult.success) {
          setCurrentImage(imageResult.imageData);
        }
      } catch (error) {
        console.error('Error loading image, falling back to URL:', error);
        // Fallback to direct URL
        setCurrentImage(getImageUrl(fileId));
      }

      // Load text content if available
      if (fileDetails.file.hasTxt) {
        try {
          const textResult = await getParsedText(fileId);
          if (textResult.success) {
            setOutsideText(textResult.outside_text);
            setTables(textResult.tables);
          } else {
            toast.error('Error loading text content');
          }
        } catch (error) {
          console.error('Error loading text:', error);
          toast.error(`Error loading text: ${error.message}`);
        }
      } else {
        toast.warning('No text file available for this image');
      }

      // Load annotations if available
      try {
        const annotationsResult = await getAnnotations(fileId);
        if (annotationsResult.success) {
          setCurrentAnnotations(annotationsResult.annotations.corrections || []);
        }
      } catch (error) {
        console.error('Error loading annotations:', error);
        toast.error(`Error loading annotations: ${error.message}`);
      }
    } catch (error) {
      console.error('Error loading file:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle table navigation
  const handleTableNavigation = (direction) => {
    if (direction === 'next' && currentTableIndex < tables.length - 1) {
      setCurrentTableIndex(prev => prev + 1);
    } else if (direction === 'prev' && currentTableIndex > 0) {
      setCurrentTableIndex(prev => prev - 1);
    }
  };

  // Modify handleTextChange to not trigger auto-save
  const handleTextChange = (newText) => {
    setOutsideText(newText);
  };

  // Modify handleTableChange to not trigger auto-save
  const handleTableChange = async (newTableHtml) => {
    const newTables = [...tables];
    newTables[currentTableIndex] = newTableHtml;
    setTables(newTables);
  };

  // Handle file selection from FileBrowser
  const handleFileSelected = (fileId) => {
    loadFile(fileId);
  };

  // Update handleNextFile to always save before navigation
  const handleNextFile = async () => {
    if (!currentFile) return;
    
    try {
      // Always save before navigating
      setIsLoading(true);
      setLoadingStatus('Saving changes...');
      await saveCurrentText();
      
      setLoadingStatus('Loading next file...');
      
      // Get files to find the next one
      const result = await getTableFiles(1, 10000);
      if (result.success && result.files && result.files.length > 0) {
        const currentIndex = result.files.findIndex(f => f.id === currentFileId);
        if (currentIndex >= 0 && currentIndex < result.files.length - 1) {
          const nextFile = result.files[currentIndex + 1];
          await loadFile(nextFile.id);
        } else {
          console.log('This is the last file');
          setIsLoading(false);
        }
      } else {
        console.error('Error fetching files list');
        setIsLoading(false);
      }
    } catch (error) {
      console.error('Error navigating to next file:', error);
      setIsLoading(false);
    }
  };

  // Update handlePrevFile to always save before navigation
  const handlePrevFile = async () => {
    if (!currentFile) return;
    
    try {
      // Always save before navigating
      setIsLoading(true);
      setLoadingStatus('Saving changes...');
      await saveCurrentText();
      
      setLoadingStatus('Loading previous file...');
      
      // Get files to find the previous one
      const result = await getTableFiles(1, 10000);
      if (result.success && result.files && result.files.length > 0) {
        const currentIndex = result.files.findIndex(f => f.id === currentFileId);
        if (currentIndex > 0) {
          const prevFile = result.files[currentIndex - 1];
          await loadFile(prevFile.id);
        } else {
          console.log('This is the first file');
          setIsLoading(false);
        }
      } else {
        console.error('Error fetching files list');
        setIsLoading(false);
      }
    } catch (error) {
      console.error('Error navigating to previous file:', error);
      setIsLoading(false);
    }
  };

  // Simplify handleAnnotationSaved to just trigger table save
  const handleAnnotationSaved = async (updatedAnnotation) => {
    if (!currentFileId) return;
    
    try {
      // We'll keep track of annotations in memory
      let updatedAnnotations = [...currentAnnotations];
      const existingIndex = updatedAnnotations.findIndex(a => a.id === updatedAnnotation.id);
      
      if (existingIndex >= 0) {
        updatedAnnotations[existingIndex] = updatedAnnotation;
      } else {
        updatedAnnotations.push(updatedAnnotation);
      }
      
      setCurrentAnnotations(updatedAnnotations);
      
      // No need to save annotations to JSON - just trigger the table save
      if (tableEditor.current && tableEditor.current.generateCorrectedHtml) {
        const correctedHtml = tableEditor.current.generateCorrectedHtml();
        if (correctedHtml) {
          handleTableChange(correctedHtml);
        }
      }
    } catch (error) {
      console.error('Error handling annotation:', error);
    }
  };

  // Update handleExportText to save directly back to the original file
  const handleExportText = async (textContent) => {
    if (!currentFileId) return;
    
    try {
      // Get the current file's details
      const fileDetails = await getFileDetails(currentFileId);
      if (!fileDetails.success || !fileDetails.file) {
        console.error('Could not get file details for text export');
        return;
      }
      
      // Check if this file has a text file
      if (fileDetails.file.hasTxt) {
        // Update the original text file
        const result = await updateParsedText(currentFileId, {
          outside_text: textContent,
          tables: tables
        });
        if (!result.success) {
          console.error(`Error updating text: ${result.error || 'Unknown error'}`);
        }
      } else {
        // If no original text, create a new one with exportText
        const result = await exportText(currentFileId, textContent);
        if (!result.success) {
          console.error(`Error exporting text: ${result.error || 'Unknown error'}`);
        }
      }
    } catch (error) {
      console.error('Error handling text export:', error);
    }
  };

  // Export all annotations
  const handleExportAllAnnotations = () => {
    try {
      downloadAllAnnotations();
      toast.info('Downloading all annotations...');
    } catch (error) {
      console.error('Error exporting all annotations:', error);
      toast.error(`Error: ${error.message}`);
    }
  };

  // Update handleBackToFiles to always save before navigation
  const handleBackToFiles = async () => {
    try {
      // Always save before navigating away
      if (currentFileId) {
        setIsLoading(true);
        setLoadingStatus('Saving changes...');
        await saveCurrentText();
      }
      
      setCurrentFile(null);
      setCurrentFileId(null);
      setCurrentImage(null);
      setOutsideText('');
      setTables([]);
      setCurrentAnnotations([]);
    } catch (error) {
      console.error('Error saving before navigation:', error);
      toast.error('Error saving changes');
    } finally {
      setIsLoading(false);
    }
  };

  // Update saveCurrentText to not check autoSave
  const saveCurrentText = async () => {
    if (!currentFileId) return false;
    
    try {
      let updatedTables = [...tables];
      
      // If we have a table editor and we're on a table, get its latest state
      if (tableEditor.current && tableEditor.current.generateCorrectedHtml && tables.length > 0) {
        const correctedHtml = tableEditor.current.generateCorrectedHtml();
        if (correctedHtml) {
          updatedTables[currentTableIndex] = correctedHtml;
        }
      }
      
      // Always save the current state
      const result = await updateParsedText(currentFileId, {
        outside_text: outsideText,
        tables: updatedTables
      });

      if (!result.success && result.error && result.error.includes('modified externally')) {
        toast.warning('File was modified externally. Reloading latest version...');
        await loadFile(currentFileId);
        return false;
      }

      return result.success;
    } catch (error) {
      console.error('Error saving text:', error);
      toast.error('Error saving changes');
      return false;
    }
  };

  // Update keyboard navigation to always save
  useEffect(() => {
    // Function to handle keyboard events
    const handleKeyDown = async (event) => {
      // Skip keyboard navigation if loading or editing a cell
      if (!currentFile || isLoading || isEditing) return;
      
      // Skip if the active element is a text input or textarea
      const activeElement = document.activeElement;
      if (activeElement && (
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.isContentEditable
      )) {
        return;
      }
      
      switch (event.key) {
        case 'ArrowLeft':
          // Always save before navigating
          setIsLoading(true);
          setLoadingStatus('Saving changes...');
          await saveCurrentText();
          handlePrevFile();
          break;
        case 'ArrowRight':
          // Always save before navigating
          setIsLoading(true);
          setLoadingStatus('Saving changes...');
          await saveCurrentText();
          handleNextFile();
          break;
        default:
          break;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [currentFile, isLoading, isEditing]);

  // Remove beforeunload handler since we're not auto-saving anymore
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (currentFileId && tables.length > 0) {
        // Show a warning if there are unsaved changes
        e.preventDefault();
        e.returnValue = '';
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [currentFileId, tables.length]);

  // Handle excluding (removing) the current file
  const handleOpenExcludeDialog = () => {
    setConfirmExcludeOpen(true);
  };
  
  const handleCloseExcludeDialog = () => {
    setConfirmExcludeOpen(false);
  };
  
  const handleExcludeFile = async () => {
    if (!currentFileId) return;
    
    try {
      setIsLoading(true);
      setLoadingStatus('Moving file to excluded directory...');
      setConfirmExcludeOpen(false);
      
      // First get the files list and find the current index before excluding
      let nextFileId = null;
      
      try {
        const filesList = await getTableFiles(1, 10000);
        if (filesList.success && filesList.files && filesList.files.length > 0) {
          const currentIndex = filesList.files.findIndex(f => f.id === currentFileId);
          if (currentIndex >= 0) {
            // Determine the next file to load (either next or previous if at the end)
            if (currentIndex < filesList.files.length - 1) {
              // There's a next file
              nextFileId = filesList.files[currentIndex + 1].id;
            } else if (currentIndex > 0) {
              // This is the last file, go to previous
              nextFileId = filesList.files[currentIndex - 1].id;
            }
          }
        }
      } catch (error) {
        console.error('Error determining next file:', error);
      }
      
      // Now exclude the current file
      const result = await excludeFile(currentFileId);
      
      if (result.success) {
        console.log(`File ${currentFileId} excluded successfully`);
        
        // Navigate to the next file if we found one
        if (nextFileId) {
          console.log(`Loading next file: ${nextFileId}`);
          // Directly call loadFile with the pre-determined next file ID
          await loadFile(nextFileId);
        } else {
          // No files left or couldn't determine next file, go back to file browser
          console.log('No more files to navigate to, returning to file browser');
          setCurrentFile(null);
          setCurrentFileId(null);
          setCurrentImage(null);
          setOutsideText('');
          setTables([]);
          setCurrentAnnotations([]);
        }
      } else {
        console.error('Error excluding file:', result.error);
      }
    } catch (error) {
      console.error('Error excluding file:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Add manual save function
  const handleManualSave = async () => {
    try {
      if (!currentFileId) return;
      
      setIsLoading(true);
      setLoadingStatus('Saving file...');

      // Make sure we get the latest table content
      let finalTables = [...tables];
      if (tableEditor.current && tableEditor.current.generateCorrectedHtml) {
        const correctedHtml = tableEditor.current.generateCorrectedHtml();
        if (correctedHtml) {
          finalTables[currentTableIndex] = correctedHtml;
        }
      }

      // Send the current text and all tables to be saved
      const result = await updateParsedText(currentFileId, {
        outside_text: outsideText,
        tables: finalTables
      });

      if (!result.success) {
        if (result.error && result.error.includes('modified externally')) {
          toast.warning('File was modified externally. Reloading latest version...');
          await loadFile(currentFileId);
        } else {
          toast.error(`Error saving: ${result.error}`);
        }
      } else {
        toast.success('File saved successfully');
      }
    } catch (error) {
      console.error('Error saving file:', error);
      toast.error('Error saving file');
    } finally {
      setIsLoading(false);
    }
  };

  // Add handleUndo function
  const handleUndo = () => {
    if (tableEditor.current?.canUndo()) {
      tableEditor.current.undo();
    }
  };

  return (
    <ThemeProvider theme={theme}>
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <Box sx={{ flexGrow: 1, display: 'flex', overflow: 'hidden' }}>
          {!currentFile ? (
            <FileBrowser 
              onFileSelected={handleFileSelected} 
              initialPage={lastPageNumber}
            />
        ) : (
            <Box sx={{ width: '100%', height: '100%', p: 2 }}>
              {/* File Navigation */}
              <Paper sx={{ mb: 2, p: 1 }}>
              <Box sx={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                  alignItems: 'center'
              }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="h6">
                    {currentFile.name}
                  </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>
                      (File {currentFile.pagination?.fileIndex} of {currentFile.pagination?.totalFiles}, 
                      Page {currentFile.pagination?.currentPage})
                  </Typography>
                </Box>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button
                      variant="outlined"
                      startIcon={<ArrowBackIcon />}
                      onClick={handleBackToFiles}
                    >
                      Back to Files
                    </Button>
                    <Button
                      variant="outlined"
                      startIcon={<UndoIcon />}
                      onClick={handleUndo}
                      disabled={!tableEditor.current?.canUndo()}
                    >
                      Undo
                    </Button>
                    <Button
                      variant="outlined"
                      startIcon={<NavigateBeforeIcon />}
                      onClick={handlePrevFile}
                      disabled={isLoading}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outlined"
                      endIcon={<NavigateNextIcon />}
                      onClick={handleNextFile}
                      disabled={isLoading}
                    >
                      Next
                    </Button>
                    <Button
                      variant="contained"
                      color="primary"
                      onClick={handleManualSave}
                      disabled={isLoading}
                    >
                      Save File
                    </Button>
                          <Button
                            variant="outlined"
                            color="error"
                            startIcon={<DeleteIcon />}
                            onClick={handleOpenExcludeDialog}
                    >
                      Exclude
                          </Button>
                        </Box>
                      </Box>
              </Paper>

              {/* Main Content */}
              <Grid container spacing={2} sx={{ height: 'calc(100% - 80px)' }}>
                {/* Left side - Image */}
                <Grid item xs={12} md={6}>
                  <Paper sx={{ height: '100%', overflow: 'hidden' }}>
                    {currentImage && (
                      <ZoomableImage src={currentImage} alt="Current image" />
                    )}
                  </Paper>
                </Grid>

                {/* Right side - Text and Table editors */}
                <Grid item xs={12} md={6}>
                      <Box sx={{ 
                    height: '100%', 
                    display: 'flex', 
                    flexDirection: 'column', 
                    gap: 2 
                  }}>
                    {/* Text Editor */}
                    <Paper sx={{ flex: 0.67, overflow: 'hidden' }}>
                      <TextEditor 
                        text={outsideText}
                        onTextChange={handleTextChange}
                      />
                    </Paper>

                    {/* Table Editor */}
                    <Paper sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                      {tables.length > 0 ? (
                        <>
                          <TableNavigator
                            currentTable={currentTableIndex}
                            totalTables={tables.length}
                            onNavigate={handleTableNavigation}
                          />
                          <Box sx={{ flex: 1, overflow: 'auto' }}>
                        <TableEditor
                          ref={tableEditor}
                              tableHtml={tables[currentTableIndex]}
                          onAnnotationSaved={handleAnnotationSaved}
                          existingAnnotations={currentAnnotations}
                              onExportHtml={handleTableChange}
                          autoSave={autoSave}
                          onEditingStateChange={setIsEditing}
                              hideInstructions={true}
                        />
                      </Box>
                        </>
                  ) : (
                        <Box sx={{ p: 2, textAlign: 'center' }}>
                          <Typography color="textSecondary">
                            No tables found in the text
                    </Typography>
                </Box>
              )}
            </Paper>
                  </Box>
                </Grid>
              </Grid>
          </Box>
        )}
      </Box>
      
        {/* Loading overlay */}
        {isLoading && (
          <Box
            sx={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              zIndex: 9999,
            }}
          >
            <CircularProgress color="primary" />
            <Typography sx={{ mt: 2, color: 'white' }}>{loadingStatus}</Typography>
          </Box>
        )}

        {/* Exclude confirmation dialog */}
      <Dialog
        open={confirmExcludeOpen}
        onClose={handleCloseExcludeDialog}
      >
          <DialogTitle>Confirm Exclude</DialogTitle>
        <DialogContent>
            <DialogContentText>
              Are you sure you want to exclude this file? This will move the image and its associated files to the excluded directory.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
            <Button onClick={handleCloseExcludeDialog}>Cancel</Button>
            <Button onClick={handleExcludeFile} color="error" startIcon={<DeleteIcon />}>
              Exclude
          </Button>
        </DialogActions>
      </Dialog>
      </Box>
    </ThemeProvider>
  );
}

export default App;