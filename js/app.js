import { initDB, savePage, getAllPages, deletePage, clearAllPages, saveAppState, getAppState, exportProject, importProject, exportJSONLayout, importJSONLayout } from './storage.js?v=1.0.4';
import { AdaptiveLearner } from './learner.js?v=1.0.4';
import { runDetection, updateDetectionMask, generateGrid } from './detector.js?v=1.0.4';
import { StoryboardCanvas } from './canvas.js?v=1.0.4';

// Global app state
let pages = [];
let activePageIndex = -1;
let baseFileName = 'storyboard';
let lastDetectionResult = null;
let currentImageFeatures = null;
let currentAspectRatio = 16 / 9;

// Undo stack per page
const undoStacks = new Map(); // pageId -> array of states
const MAX_UNDO = 50;

// Canvas Instantiation
let sbCanvas = null;

// UI Elements
const dropCard = document.getElementById('dropCard');
const fileInput = document.getElementById('fileInput');
const uploadOverlay = document.getElementById('uploadOverlay');
const btnUndo = document.getElementById('btnUndo');
const btnUploadNew = document.getElementById('btnUploadNew');
const btnDownloadZip = document.getElementById('btnDownloadZip');
const workspace = document.getElementById('workspace');
const canvasContainer = document.getElementById('canvasContainer');
const canvas = document.getElementById('storyboardCanvas');
const sidebar = document.getElementById('sidebar');
const previewsGrid = document.getElementById('previewsGrid');
const toast = document.getElementById('toast');
const toastMsg = document.getElementById('toastMsg');

// Project Files buttons
const btnExportProject = document.getElementById('btnExportProject');
const btnImportProject = document.getElementById('btnImportProject');
const projectFileInput = document.getElementById('projectFileInput');

// Pages Sidebar Elements
const pagesSidebar = document.getElementById('pagesSidebar');
const pagesList = document.getElementById('pagesList');
const btnAddPage = document.getElementById('btnAddPage');
const btnImportLayout = document.getElementById('btnImportLayout');
const layoutFileInput = document.getElementById('layoutFileInput');
const autoSaveStatus = document.getElementById('autoSaveStatus');

// Mobile toggles
const togglePagesBtn = document.getElementById('togglePagesBtn');
const toggleControlsBtn = document.getElementById('toggleControlsBtn');

// Control Inputs
const aspectRatioSelect = document.getElementById('aspectRatioSelect');
const gridCols = document.getElementById('gridCols');
const gridRows = document.getElementById('gridRows');
const gridWidth = document.getElementById('gridWidth');
const gridHeight = document.getElementById('gridHeight');
const valWidth = document.getElementById('valWidth');
const valHeight = document.getElementById('valHeight');
const gapX = document.getElementById('gapX');
const gapY = document.getElementById('gapY');
const offsetX = document.getElementById('offsetX');
const offsetY = document.getElementById('offsetY');
const valGapX = document.getElementById('valGapX');
const valGapY = document.getElementById('valGapY');
const valOffsetX = document.getElementById('valOffsetX');
const valOffsetY = document.getElementById('valOffsetY');
const btnAddCrop = document.getElementById('btnAddCrop');
const btnClearAll = document.getElementById('btnClearAll');
const baseFileNameInput = document.getElementById('baseFileName');
const imgFormatSelect = document.getElementById('imgFormat');
const burnLabelsCheckbox = document.getElementById('burnLabels');

// Zoom controls
const zoomPercent = document.getElementById('zoomPercent');
const zoomIn = document.getElementById('zoomIn');
const zoomOut = document.getElementById('zoomOut');
const zoomReset = document.getElementById('zoomReset');
const zoomOverlay = document.getElementById('zoomOverlay');

// Auto-detect controls
const detectMode = document.getElementById('detectMode');
const detectSensitivity = document.getElementById('detectSensitivity');
const valSensitivity = document.getElementById('valSensitivity');
const detectMinSize = document.getElementById('detectMinSize');
const valMinSize = document.getElementById('valMinSize');
const showDetectMask = document.getElementById('showDetectMask');
const trimTextBoxes = document.getElementById('trimTextBoxes');
const frameResize = document.getElementById('frameResize');
const valFrameResize = document.getElementById('valFrameResize');
let lastAutoDetectedBoxes = null;
const btnDetectFrames = document.getElementById('btnDetectFrames');
const btnConfirmDetection = document.getElementById('btnConfirmDetection');
const btnConfirmBad = document.getElementById('btnConfirmBad');
const btnApplyAiSuggestion = document.getElementById('btnApplyAiSuggestion');

// Tabs
const tabButtons = document.querySelectorAll('.tab-btn');

// Initialize Application
async function init() {
  try {
    // 1. Init IndexedDB
    await initDB();
    updateAutoSaveStatus('Initialized');

    // 2. Setup StoryboardCanvas
    sbCanvas = new StoryboardCanvas(canvas, canvasContainer, {
      getActiveTab: () => document.querySelector('.tab-btn.active').getAttribute('data-tab'),
      getGridOffset: () => ({ x: parseInt(offsetX.value) || 0, y: parseInt(offsetY.value) || 0 }),
      getNextBoxId: () => {
        const page = getActivePage();
        if (!page) return Date.now();
        const maxId = page.cropBoxes.reduce((max, b) => Math.max(max, b.id), 0);
        return maxId + 1;
      },
      onBoxesChanged: () => {
        if (frameResize && frameResize.value != 0) {
          frameResize.value = 0;
          valFrameResize.textContent = '0px';
        }
        lastAutoDetectedBoxes = JSON.parse(JSON.stringify(sbCanvas.cropBoxes || []));
        saveCurrentPageState();
        renderPreviews();
      },
      onSelectBox: (id) => {
        const page = getActivePage();
        if (page) {
          page.selectedBoxId = id;
          highlightSelectedPreview(id);
        }
      },
      onRenameBox: (id, name) => {
        saveCurrentPageState();
        renderPreviews();
      },
      onGridMoved: (x, y) => {
        offsetX.value = x;
        offsetY.value = y;
        updateGridSlidersLabels();
        generateAutoGrid();
      },
      onStateChange: () => {
        recordUndoState();
        saveCurrentPageState();
      },
      onZoomChange: (zoom) => {
        zoomPercent.textContent = `${Math.round(zoom * 100)}%`;
        const page = getActivePage();
        if (page) {
          page.zoomLevel = zoom;
          page.panX = sbCanvas.panX;
          page.panY = sbCanvas.panY;
        }
      },
      showToast: (msg, type) => showToast(msg, type)
    });

    // 3. Load pages from IndexedDB
    pages = await getAllPages();
    
    if (pages.length > 0) {
      const savedActiveIndex = await getAppState('activePageIndex');
      activePageIndex = (savedActiveIndex !== null && savedActiveIndex >= 0 && savedActiveIndex < pages.length) ? savedActiveIndex : 0;
      setupWorkspace();
      loadActivePage();
    } else {
      showUploadOverlay();
    }

    // 4. Bind Events
    bindUIEvents();
    updateAIPanel();

  } catch (error) {
    console.error('Initialization failed:', error);
    showToast('Failed to initialize local workspace.', 'error');
  }
}

// Helper to get active page
function setCropBoxesAndSync(boxes, resetSlider = true) {
  sbCanvas.setCropBoxes(boxes);
  if (resetSlider) {
    if (frameResize) {
      frameResize.value = 0;
      valFrameResize.textContent = '0px';
    }
    lastAutoDetectedBoxes = JSON.parse(JSON.stringify(boxes || []));
  }
}

function applyFrameResize() {
  if (!lastAutoDetectedBoxes || lastAutoDetectedBoxes.length === 0) return;
  const offset = parseInt(frameResize.value) || 0;
  
  const resizedBoxes = lastAutoDetectedBoxes.map(box => {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const newW = Math.max(10, box.w + 2 * offset);
    const newH = Math.max(10, box.h + 2 * offset);
    return {
      ...box,
      x: cx - newW / 2,
      y: cy - newH / 2,
      w: newW,
      h: newH
    };
  });
  
  sbCanvas.setCropBoxes(resizedBoxes);
  renderPreviews();
}

function getActivePage() {
  if (activePageIndex >= 0 && activePageIndex < pages.length) {
    return pages[activePageIndex];
  }
  return null;
}

// Show/Hide Upload Overlay
function showUploadOverlay() {
  uploadOverlay.style.display = 'flex';
  btnUndo.style.display = 'none';
  btnUploadNew.style.display = 'none';
  btnDownloadZip.style.display = 'none';
  canvasContainer.style.display = 'none';
  sidebar.style.display = 'none';
  pagesSidebar.style.display = 'none';
  zoomOverlay.style.display = 'none';

  // Toggle Return to Workspace button based on whether pages are loaded
  const btnReturn = document.getElementById('btnReturnToWorkspace');
  if (btnReturn) {
    if (pages && pages.length > 0) {
      btnReturn.style.display = 'inline-flex';
    } else {
      btnReturn.style.display = 'none';
    }
  }
}

function setupWorkspace() {
  uploadOverlay.style.display = 'none';
  btnUndo.style.display = 'inline-flex';
  btnUploadNew.style.display = 'inline-flex';
  btnDownloadZip.style.display = 'inline-flex';
  canvasContainer.style.display = 'block';
  sidebar.style.display = 'flex';
  pagesSidebar.style.display = 'flex';
  zoomOverlay.style.display = 'flex';
}

// Load a specific page into workspace
function loadActivePage() {
  const page = getActivePage();
  if (!page) return;

  updateAutoSaveStatus('Loading page...');

  // Create HTML Image element
  const imgEl = new Image();
  imgEl.src = page.imageSrc;
  imgEl.onload = () => {
    // Extract AI features
    currentImageFeatures = AdaptiveLearner.extractFeatures(imgEl);
    
    // Pass to canvas
    sbCanvas.setImage(imgEl);
    setCropBoxesAndSync(page.cropBoxes, true);
    sbCanvas.lockAspectRatio = page.settings.lockAspectRatio !== undefined ? page.settings.lockAspectRatio : false;
    sbCanvas.setSelectedBoxId(page.selectedBoxId || null);

    // Apply zoom/pan state if stored
    if (page.zoomLevel) {
      sbCanvas.zoomLevel = page.zoomLevel;
      sbCanvas.panX = page.panX || 0;
      sbCanvas.panY = page.panY || 0;
      sbCanvas.applyViewTransform();
    }

    // Apply settings to UI controls
    applySettingsToUI(page.settings);
    updateGridSlidersLabels();
    updateAIPanel();

    // Render previews and sidebars
    renderPagesList();
    renderPreviews();
    
    sbCanvas.draw();
    updateAutoSaveStatus('Saved');
    showToast(`Loaded ${page.name}`);

    // Auto-detect frames instantly if there are no crop boxes yet
    if (!page.cropBoxes || page.cropBoxes.length === 0) {
      runAutoDetection();
    }
  };
}

function updateAspectRatioValue() {
  const val = aspectRatioSelect.value;
  const heightDesc = document.getElementById('heightDesc');
  
  if (val === '16:9') {
    currentAspectRatio = 16 / 9;
    sbCanvas.lockAspectRatio = true;
    sbCanvas.aspectRatioValue = 16 / 9;
    gridHeight.disabled = true;
    if (heightDesc) heightDesc.textContent = "Height is locked to 16:9 ratio based on width";
    updateGridHeightFromWidth();
  } else if (val === '9:16') {
    currentAspectRatio = 9 / 16;
    sbCanvas.lockAspectRatio = true;
    sbCanvas.aspectRatioValue = 9 / 16;
    gridHeight.disabled = true;
    if (heightDesc) heightDesc.textContent = "Height is locked to 9:16 ratio based on width";
    updateGridHeightFromWidth();
  } else {
    currentAspectRatio = 16 / 9; // fallback
    sbCanvas.lockAspectRatio = false;
    gridHeight.disabled = false;
    if (heightDesc) heightDesc.textContent = "Height can be adjusted manually";
  }
}

function applySettingsToUI(s) {
  if (!s) return;
  gridCols.value = s.gridCols || 4;
  gridRows.value = s.gridRows || 3;
  gridWidth.value = s.gridWidth || 320;
  gridHeight.value = s.gridHeight || 180;
  
  if (s.aspectRatio) {
    aspectRatioSelect.value = s.aspectRatio;
  } else {
    // legacy support
    if (s.lockAspectRatio === true) {
      aspectRatioSelect.value = '16:9';
    } else {
      aspectRatioSelect.value = 'free';
    }
  }
  
  gapX.value = s.gapX || 10;
  gapY.value = s.gapY || 10;
  offsetX.value = s.offsetX || 20;
  offsetY.value = s.offsetY || 20;

  detectMode.value = s.detectMode || 'auto';
  detectSensitivity.value = s.detectSensitivity || 88;
  valSensitivity.textContent = detectSensitivity.value + '%';
  detectMinSize.value = s.detectMinSize || 80;
  valMinSize.textContent = detectMinSize.value + 'px';
  trimTextBoxes.checked = s.trimTextBoxes !== undefined ? s.trimTextBoxes : true;
  
  updateAspectRatioValue();
}

// Capture current UI controls settings
function getSettingsFromUI() {
  return {
    gridCols: parseInt(gridCols.value),
    gridRows: parseInt(gridRows.value),
    gridWidth: parseInt(gridWidth.value),
    gridHeight: parseInt(gridHeight.value),
    aspectRatio: aspectRatioSelect.value,
    gapX: parseInt(gapX.value),
    gapY: parseInt(gapY.value),
    offsetX: parseInt(offsetX.value),
    offsetY: parseInt(offsetY.value),
    detectMode: detectMode.value,
    detectSensitivity: parseInt(detectSensitivity.value),
    detectMinSize: parseInt(detectMinSize.value),
    trimTextBoxes: trimTextBoxes.checked
  };
}

// Background autosave of active page to DB
async function saveCurrentPageState() {
  const page = getActivePage();
  if (!page) return;

  updateAutoSaveStatus('Saving...');
  
  page.cropBoxes = sbCanvas.cropBoxes;
  page.selectedBoxId = sbCanvas.selectedBoxId;
  page.settings = getSettingsFromUI();
  page.zoomLevel = sbCanvas.zoomLevel;
  page.panX = sbCanvas.panX;
  page.panY = sbCanvas.panY;

  try {
    await savePage(page);
    updateAutoSaveStatus('Saved');
    // Update thumbnail in sidebar asynchronously
    updateSidebarThumbnail(page);
  } catch (err) {
    console.error('Failed to autosave page:', err);
    updateAutoSaveStatus('Error');
  }
}

// Update local save indicator
function updateAutoSaveStatus(status) {
  if (!autoSaveStatus) return;
  autoSaveStatus.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> ${status}`;
}

// UI Event Handlers
function bindUIEvents() {
  // Upload Card clicks & drops
  const btnBrowse = dropCard.querySelector('.btn-primary');
  if (btnBrowse) {
    btnBrowse.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });
  }

  dropCard.addEventListener('click', (e) => {
    if (e.target === fileInput) return;
    fileInput.click();
  });
  fileInput.addEventListener('click', (e) => {
    e.stopPropagation();
  });
  
  dropCard.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropCard.classList.add('dragover');
  });

  dropCard.addEventListener('dragleave', () => {
    dropCard.classList.remove('dragover');
  });

  dropCard.addEventListener('drop', (e) => {
    e.preventDefault();
    dropCard.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleBatchUpload(e.dataTransfer.files);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleBatchUpload(e.target.files);
    }
  });

  // Try Demo Storyboard Button
  const btnTryDemo = document.getElementById('btnTryDemo');
  if (btnTryDemo) {
    btnTryDemo.addEventListener('click', () => {
      loadDemoStoryboard();
    });
  }

  // App Logo Click Handler (Go back to home page without clearing session)
  const appLogo = document.getElementById('appLogo');
  if (appLogo) {
    appLogo.addEventListener('click', () => {
      showUploadOverlay();
    });
  }

  // Return to Workspace Button Click Handler
  const btnReturnToWorkspace = document.getElementById('btnReturnToWorkspace');
  if (btnReturnToWorkspace) {
    btnReturnToWorkspace.addEventListener('click', () => {
      setupWorkspace();
    });
  }

  // Header Actions
  btnUploadNew.addEventListener('click', () => {
    if (confirm('Clear entire workspace and start new?')) {
      clearWorkspace();
    }
  });

  btnUndo.addEventListener('click', () => triggerUndo());

  btnAddPage.addEventListener('click', () => {
    // Open file chooser to append new images
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = (e) => {
      if (e.target.files.length > 0) {
        handleBatchUpload(e.target.files);
      }
      document.body.removeChild(input);
    };
    input.click();
  });

  // Project Export/Import buttons
  btnExportProject.addEventListener('click', () => {
    if (pages.length === 0) return;
    exportProject(pages, baseFileNameInput.value || 'storyboard');
    showToast('Exporting project file...');
  });

  btnImportProject.addEventListener('click', () => projectFileInput.click());
  projectFileInput.addEventListener('change', async (e) => {
    if (e.target.files.length > 0) {
      try {
        showToast('Loading project bundle...');
        const imported = await importProject(e.target.files[0]);
        pages = imported.pages;
        baseFileNameInput.value = imported.baseFileName;
        activePageIndex = 0;
        await saveAppState('activePageIndex', 0);
        setupWorkspace();
        loadActivePage();
        showToast('Project loaded successfully!');
      } catch (err) {
        console.error(err);
        showToast('Failed to load project bundle.', 'error');
      }
    }
  });

  // JSON Layout Export/Import
  btnImportLayout.addEventListener('click', () => layoutFileInput.click());
  layoutFileInput.addEventListener('change', async (e) => {
    const page = getActivePage();
    if (!page) return;
    if (e.target.files.length > 0) {
      try {
        const boxes = await importJSONLayout(e.target.files[0]);
        setCropBoxesAndSync(boxes, true);
        recordUndoState();
        saveCurrentPageState();
        renderPreviews();
        showToast('Layout imported!');
      } catch (err) {
        showToast('Failed to import layout JSON.', 'error');
      }
    }
  });

  // Sidebar Controls Event Listeners (Grid controls)
  const gridInputs = [gridCols, gridRows, gridWidth, gridHeight, gapX, gapY, offsetX, offsetY];
  gridInputs.forEach(input => {
    input.addEventListener('input', () => {
      if (input === gridWidth && aspectRatioSelect.value !== 'free') {
        updateGridHeightFromWidth();
      }
      updateGridSlidersLabels();
      generateAutoGrid();
    });
    input.addEventListener('change', () => {
      recordUndoState();
      saveCurrentPageState();
    });
  });

  // Aspect ratio select change
  aspectRatioSelect.addEventListener('change', () => {
    updateAspectRatioValue();
    generateAutoGrid();
    recordUndoState();
    saveCurrentPageState();
  });

  // Grid Cols/Rows Enter Key
  [gridCols, gridRows].forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        generateAutoGrid();
        recordUndoState();
        saveCurrentPageState();
        input.blur();
      }
    });
  });

  // Tab toggling
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      document.getElementById('grid-controls').classList.remove('active');
      document.getElementById('detect-controls').classList.remove('active');
      document.getElementById('manual-controls').classList.remove('active');
      
      btn.classList.add('active');
      const activeTabId = btn.getAttribute('data-tab');
      document.getElementById(activeTabId).classList.add('active');
    });
  });

  // Auto detect triggers
  [detectSensitivity, detectMinSize, detectMode, trimTextBoxes].forEach(el => {
    el.addEventListener('change', () => {
      if (showDetectMask.checked) {
        updateDebugMask();
      }
      saveCurrentPageState();
    });
  });

  detectSensitivity.addEventListener('input', () => {
    valSensitivity.textContent = detectSensitivity.value + '%';
    if (showDetectMask.checked) updateDebugMask();
  });

  detectMinSize.addEventListener('input', () => {
    valMinSize.textContent = detectMinSize.value + 'px';
    if (showDetectMask.checked) updateDebugMask();
  });

  showDetectMask.addEventListener('change', () => {
    updateDebugMask();
  });

  if (frameResize) {
    frameResize.addEventListener('input', () => {
      valFrameResize.textContent = (frameResize.value > 0 ? '+' : '') + frameResize.value + 'px';
      applyFrameResize();
    });

    frameResize.addEventListener('change', () => {
      saveCurrentPageState();
    });
  }

  btnDetectFrames.addEventListener('click', () => runAutoDetection());

  // AI confirm/negate buttons
  btnConfirmDetection.addEventListener('click', () => {
    if (!currentImageFeatures || !lastDetectionResult) return;
    const { sensitivity, minSize, mode, panelCount } = lastDetectionResult;
    
    AdaptiveLearner.addSample(currentImageFeatures, sensitivity, minSize, mode, panelCount);
    
    btnConfirmDetection.classList.remove('ready');
    btnConfirmBad.classList.remove('ready');
    lastDetectionResult = null;
    
    updateAIPanel();
    showToast('AI trained with positive feedback.');
  });

  btnConfirmBad.addEventListener('click', () => {
    if (!currentImageFeatures || !lastDetectionResult) return;
    const { sensitivity, minSize, mode } = lastDetectionResult;
    
    AdaptiveLearner.addNegativeSample(currentImageFeatures, sensitivity, minSize, mode);
    
    btnConfirmDetection.classList.remove('ready');
    btnConfirmBad.classList.remove('ready');
    lastDetectionResult = null;
    
    updateAIPanel();
    showToast('Noted negative detection params.');
  });
  
  if (btnApplyAiSuggestion) {
    btnApplyAiSuggestion.addEventListener('click', () => {
      if (!currentImageFeatures) return;
      const suggestion = AdaptiveLearner.suggest(currentImageFeatures);
      if (suggestion) {
        detectMode.value = suggestion.suggestedMode;
        detectSensitivity.value = suggestion.suggestedSens;
        valSensitivity.textContent = suggestion.suggestedSens + '%';
        
        if (suggestion.suggestedMinSize) {
          detectMinSize.value = suggestion.suggestedMinSize;
          valMinSize.textContent = suggestion.suggestedMinSize + 'px';
        }
        
        saveCurrentPageState();
        if (showDetectMask.checked) {
          updateDebugMask();
        }
        showToast('Applied AI suggestions! Click Run to process.');
      }
    });
  }

  // Manual Crop addition
  btnAddCrop.addEventListener('click', () => {
    const page = getActivePage();
    if (!page) return;

    const w = 320;
    const h = Math.round(w / currentAspectRatio);
    const x = Math.max(20, Math.floor((sbCanvas.img.width - w) / 2));
    const y = Math.max(20, Math.floor((sbCanvas.img.height - h) / 2));

    const newBox = {
      id: Date.now(),
      x: x,
      y: y,
      w: w,
      h: h,
      name: `Panel ${sbCanvas.cropBoxes.length + 1}`
    };

    const updatedBoxes = [...sbCanvas.cropBoxes, newBox];
    setCropBoxesAndSync(updatedBoxes, true);
    sbCanvas.setSelectedBoxId(newBox.id);
    recordUndoState();
    saveCurrentPageState();
    renderPreviews();
    showToast('Added manual crop box');
  });

  btnClearAll.addEventListener('click', () => {
    if (confirm('Clear all crop boxes?')) {
      setCropBoxesAndSync([], true);
      sbCanvas.setSelectedBoxId(null);
      recordUndoState();
      saveCurrentPageState();
      renderPreviews();
    }
  });

  // Keyboard Shortcuts (Global)
  window.addEventListener('keydown', (e) => {
    if (document.activeElement && (
      document.activeElement.tagName === 'INPUT' ||
      document.activeElement.tagName === 'SELECT' ||
      document.activeElement.tagName === 'TEXTAREA'
    )) {
      return;
    }

    // Ctrl+Z Undo
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      triggerUndo();
    }

    // Ctrl+C Copy
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      const page = getActivePage();
      if (page && sbCanvas.selectedBoxId) {
        const box = sbCanvas.cropBoxes.find(b => b.id === sbCanvas.selectedBoxId);
        if (box) {
          e.preventDefault();
          sbCanvas.copiedBox = { w: box.w, h: box.h, name: box.name };
          showToast('Copied panel dimensions');
        }
      }
    }

    // Ctrl+V Paste
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
      const page = getActivePage();
      if (page && sbCanvas.copiedBox) {
        e.preventDefault();
        const copied = sbCanvas.copiedBox;
        let px = Math.max(20, Math.floor((sbCanvas.img.width - copied.w) / 2));
        let py = Math.max(20, Math.floor((sbCanvas.img.height - copied.h) / 2));

        if (sbCanvas.selectedBoxId) {
          const sel = sbCanvas.cropBoxes.find(b => b.id === sbCanvas.selectedBoxId);
          if (sel) {
            px = Math.min(sbCanvas.img.width - copied.w, sel.x + 20);
            py = Math.min(sbCanvas.img.height - copied.h, sel.y + 20);
          }
        }

        const newBox = {
          id: Date.now(),
          x: px,
          y: py,
          w: copied.w,
          h: copied.h,
          name: `${copied.name} (Copy)`
        };

        const updated = [...sbCanvas.cropBoxes, newBox];
        setCropBoxesAndSync(updated, true);
        sbCanvas.setSelectedBoxId(newBox.id);
        recordUndoState();
        saveCurrentPageState();
        renderPreviews();
        showToast('Pasted panel');
      }
    }

    // Delete selected box
    if ((e.key === 'Delete' || e.key === 'Backspace') && sbCanvas.selectedBoxId) {
      e.preventDefault();
      setCropBoxesAndSync(sbCanvas.cropBoxes.filter(b => b.id !== sbCanvas.selectedBoxId), true);
      sbCanvas.setSelectedBoxId(null);
      recordUndoState();
      saveCurrentPageState();
      renderPreviews();
      showToast('Deleted panel');
    }
  });

  // Mobile Toggles
  togglePagesBtn.addEventListener('click', () => {
    pagesSidebar.classList.toggle('open');
    sidebar.classList.remove('open');
  });

  toggleControlsBtn.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    pagesSidebar.classList.remove('open');
  });

  // Close sidebars on canvas click on mobile
  workspace.addEventListener('click', () => {
    pagesSidebar.classList.remove('open');
    sidebar.classList.remove('open');
  });

  // Zoom bindings
  zoomIn.addEventListener('click', () => sbCanvas.zoomIn());
  zoomOut.addEventListener('click', () => sbCanvas.zoomOut());
  zoomReset.addEventListener('click', () => sbCanvas.resetZoom());
}

// Multi-image batch loading
async function handleBatchUpload(files) {
  showToast(`Processing ${files.length} image(s)...`);
  
  const originalCount = pages.length;
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.type.startsWith('image/')) continue;

    await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const imageSrc = event.target.result;
        
        // Initial setup for new page
        const newPageId = Date.now() + i;
        const pageName = file.name.split('.')[0] || `Page ${pages.length + 1}`;
        
        const newPage = {
          id: newPageId,
          index: pages.length,
          name: pageName,
          imageSrc: imageSrc,
          cropBoxes: [],
          settings: {
            gridCols: 4,
            gridRows: 3,
            gridWidth: 320,
            gridHeight: 180,
            lockAspectRatio: false,
            aspectRatio: 'free',
            gapX: 10,
            gapY: 10,
            offsetX: 20,
            offsetY: 20,
            detectMode: 'auto',
            detectSensitivity: 88,
            detectMinSize: 80,
            trimTextBoxes: true
          },
          zoomLevel: 1.0,
          panX: 0,
          panY: 0
        };

        pages.push(newPage);
        await savePage(newPage);
        resolve();
      };
      reader.readAsDataURL(file);
    });
  }

  if (pages.length > originalCount) {
    if (originalCount === 0) {
      activePageIndex = 0;
      await saveAppState('activePageIndex', 0);
      setupWorkspace();
      loadActivePage();
    } else {
      renderPagesList();
      showToast(`Added ${pages.length - originalCount} page(s)`);
    }
  }
}

// Load pre-bundled demo storyboard sheet and trigger auto-detection
async function loadDemoStoryboard() {
  try {
    showToast('Loading demo storyboard...');
    const response = await fetch('./storyboardtemplatestorysplitter.png');
    if (!response.ok) throw new Error('Network response was not ok');
    const blob = await response.blob();
    const file = new File([blob], 'storyboard-demo.png', { type: 'image/png' });
    await handleBatchUpload([file]);

    // Poll canvas until the image loads, then run edge detection automatically
    let checkCount = 0;
    const interval = setInterval(() => {
      if (sbCanvas && sbCanvas.img && sbCanvas.img.complete && sbCanvas.img.naturalWidth > 0) {
        clearInterval(interval);
        runAutoDetection();
      }
      checkCount++;
      if (checkCount > 100) {
        clearInterval(interval);
      }
    }, 50);

  } catch (err) {
    console.error('Failed to load demo storyboard:', err);
    showToast('Failed to load demo storyboard.', 'error');
  }
}

// Render Left Pages list
function renderPagesList() {
  pagesList.innerHTML = '';
  
  pages.forEach((page, index) => {
    const item = document.createElement('div');
    item.className = `page-item ${index === activePageIndex ? 'active' : ''}`;
    
    const thumbContainer = document.createElement('div');
    thumbContainer.className = 'page-thumb-container';
    
    const imgThumb = document.createElement('img');
    imgThumb.className = 'page-thumb';
    imgThumb.src = page.imageSrc;
    thumbContainer.appendChild(imgThumb);
    
    const info = document.createElement('div');
    info.className = 'page-info';
    
    const title = document.createElement('div');
    title.className = 'page-title';
    title.textContent = page.name;
    
    const meta = document.createElement('div');
    meta.className = 'page-meta';
    meta.textContent = `${page.cropBoxes.length} panels`;
    
    info.appendChild(title);
    info.appendChild(meta);

    // Double click to rename page
    title.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'text';
      input.value = page.name;
      input.style.fontSize = '0.85rem';
      input.style.padding = '2px';
      title.replaceWith(input);
      input.focus();
      input.select();

      const commitPageRename = () => {
        const newName = input.value.trim();
        if (newName) {
          page.name = newName;
          title.textContent = newName;
          savePage(page);
        }
        input.replaceWith(title);
      };

      input.addEventListener('blur', commitPageRename);
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') commitPageRename();
      });
    });
    
    const actions = document.createElement('div');
    actions.className = 'page-actions';
    
    const btnDel = document.createElement('button');
    btnDel.className = 'page-btn';
    btnDel.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
    btnDel.title = 'Delete Page';
    btnDel.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`Delete page "${page.name}"?`)) {
        await deletePage(page.id);
        pages = pages.filter(p => p.id !== page.id);
        // Reset indexes
        pages.forEach((p, idx) => p.index = idx);
        
        if (pages.length === 0) {
          activePageIndex = -1;
          await saveAppState('activePageIndex', -1);
          showUploadOverlay();
        } else {
          activePageIndex = Math.max(0, activePageIndex - 1);
          await saveAppState('activePageIndex', activePageIndex);
          loadActivePage();
        }
      }
    });

    const btnLayout = document.createElement('button');
    btnLayout.className = 'page-btn';
    btnLayout.innerHTML = '<i class="fa-solid fa-file-export"></i>';
    btnLayout.title = 'Export Layout Coordinates';
    btnLayout.style.color = 'var(--primary)';
    btnLayout.addEventListener('click', (e) => {
      e.stopPropagation();
      exportJSONLayout(page);
    });
    
    actions.appendChild(btnLayout);
    actions.appendChild(btnDel);
    
    item.appendChild(thumbContainer);
    item.appendChild(info);
    item.appendChild(actions);
    
    item.addEventListener('click', async () => {
      if (index !== activePageIndex) {
        // Save current page state first
        await saveCurrentPageState();
        activePageIndex = index;
        await saveAppState('activePageIndex', index);
        loadActivePage();
      }
    });
    
    pagesList.appendChild(item);
  });
}

// Asynchronously generate thumbnail for sidebar list
function updateSidebarThumbnail(page) {
  const sidebarItems = pagesList.children;
  if (sidebarItems[page.index]) {
    const meta = sidebarItems[page.index].querySelector('.page-meta');
    if (meta) {
      meta.textContent = `${page.cropBoxes.length} panels`;
    }
  }
}

// Clear Entire Workspace
async function clearWorkspace() {
  await clearAllPages();
  await saveAppState('activePageIndex', -1);
  pages = [];
  activePageIndex = -1;
  showUploadOverlay();
  showToast('Workspace cleared');
}

// Grid Generator Binding
function updateGridHeightFromWidth() {
  const w = parseInt(gridWidth.value);
  const h = Math.round(w / currentAspectRatio);
  gridHeight.value = h;
  valWidth.textContent = w + 'px';
  valHeight.textContent = h + 'px';
}

function updateGridSlidersLabels() {
  valWidth.textContent = gridWidth.value + 'px';
  valHeight.textContent = gridHeight.value + 'px';
  valGapX.textContent = gapX.value + 'px';
  valGapY.textContent = gapY.value + 'px';
  valOffsetX.textContent = offsetX.value + 'px';
  valOffsetY.textContent = offsetY.value + 'px';
}

function generateAutoGrid() {
  const page = getActivePage();
  if (!page) return;

  const boxes = generateGrid(
    gridCols.value,
    gridRows.value,
    gridWidth.value,
    gridHeight.value,
    gapX.value,
    gapY.value,
    offsetX.value,
    offsetY.value
  );

  setCropBoxesAndSync(boxes, true);
  sbCanvas.setSelectedBoxId(null);
  saveCurrentPageState();
  renderPreviews();
  sbCanvas.draw(); // FIX: Redraw canvas immediately on grid change
}

// Auto Detect Mask Debug drawing
function updateDebugMask() {
  const page = getActivePage();
  if (!page) return;

  const showMask = showDetectMask.checked;
  if (showMask) {
    const result = updateDetectionMask(sbCanvas.img, detectMode.value, detectSensitivity.value, detectMinSize.value);
    if (result) {
      sbCanvas.setMaskState(true, result.maskCanvas);
    }
  } else {
    sbCanvas.setMaskState(false, null);
  }
}

// Run Auto detection algorithm
function runAutoDetection() {
  const page = getActivePage();
  if (!page) return;

  showToast('Running Auto-Detection...');
  
  setTimeout(() => {
    const result = runDetection(
      sbCanvas.img,
      detectMode.value,
      detectSensitivity.value,
      detectMinSize.value,
      trimTextBoxes.checked,
      currentAspectRatio
    );

    if (result && result.boxes.length > 0) {
      setCropBoxesAndSync(result.boxes, true);
      sbCanvas.setSelectedBoxId(null);
      recordUndoState();
      saveCurrentPageState();
      renderPreviews();
      
      // Save last detection result for AI learning feedback loop
      lastDetectionResult = {
        sensitivity: detectSensitivity.value,
        minSize: detectMinSize.value,
        mode: result.modeUsed,
        panelCount: result.boxes.length
      };

      btnConfirmDetection.classList.add('ready');
      btnConfirmBad.classList.add('ready');
      updateAIPanel();
      
      showToast(`Detected ${result.boxes.length} panels via ${result.modeUsed} mode.`);
    } else {
      showToast('No panels detected. Adjust sensitivity.', 'error');
    }
  }, 50);
}

// AI Training UI Sync
function updateAIPanel() {
  const count = AdaptiveLearner.getCount();
  const badge = document.getElementById('aiBadge');
  const badgeText = document.getElementById('aiBadgeText');
  const helpText = document.getElementById('aiHelpText');
  document.getElementById('aiTrainCount').textContent = count + ' image' + (count !== 1 ? 's' : '');

  if (count >= 3) {
    badge.className = 'ai-badge active';
    badgeText.textContent = 'Active';
    if (helpText) {
      helpText.innerHTML = 'Adaptive AI is active and automatically suggesting custom tuning parameters for your storyboard sheets!';
      helpText.style.color = '#10b981';
    }
  } else {
    badge.className = 'ai-badge inactive';
    badgeText.textContent = count === 0 ? 'Awaiting Feedback' : count + ' Sample' + (count > 1 ? 's' : '');
    if (helpText) {
      helpText.innerHTML = 'Adaptive AI warms up and suggests custom tuning parameters after you approve/correct at least 3 panel detections!';
      helpText.style.color = 'rgba(255,255,255,0.4)';
    }
  }

  if (currentImageFeatures && count > 0) {
    const suggestion = AdaptiveLearner.suggest(currentImageFeatures);
    if (suggestion) {
      const pct = Math.round(suggestion.confidence * 100);
      document.getElementById('aiMatchQuality').textContent = pct + '%';
      document.getElementById('aiSuggestedSens').textContent = suggestion.suggestedSens + '%';
      const modeNames = { auto: 'Auto', grid: 'Grid (Structured)', enclosed: 'Enclosed', drawings: 'Drawings' };
      document.getElementById('aiSuggestedMode').textContent = modeNames[suggestion.suggestedMode] || 'Auto';
      document.getElementById('aiConfBar').style.width = pct + '%';
      if (btnApplyAiSuggestion) {
        btnApplyAiSuggestion.style.display = 'flex';
      }
      return suggestion;
    }
  }

  document.getElementById('aiMatchQuality').textContent = '—';
  document.getElementById('aiSuggestedSens').textContent = '—';
  document.getElementById('aiSuggestedMode').textContent = '—';
  document.getElementById('aiConfBar').style.width = '0%';
  if (btnApplyAiSuggestion) {
    btnApplyAiSuggestion.style.display = 'none';
  }
  return null;
}

// Live Previews Sidebar list
function renderPreviews() {
  previewsGrid.innerHTML = '';
  if (sbCanvas.cropBoxes.length === 0) {
    previewsGrid.innerHTML = '<div style="color: var(--text-dark); text-align: center; padding: 2rem;">No crops defined. Use Grid or run Auto-Detect.</div>';
    return;
  }

  sbCanvas.cropBoxes.forEach(box => {
    const card = document.createElement('div');
    card.id = `preview-card-${box.id}`;
    card.className = `preview-card ${box.id === sbCanvas.selectedBoxId ? 'selected' : ''}`;
    
    const thumbContainer = document.createElement('div');
    thumbContainer.className = 'preview-thumb-container';
    
    const ratio = box.w / box.h;
    thumbContainer.style.aspectRatio = `${ratio}`;

    // Offscreen rendering of thumbnail matching the box aspect ratio (no black bars!)
    const off = document.createElement('canvas');
    if (ratio > 1) {
      off.width = 320;
      off.height = Math.round(320 / ratio);
    } else {
      off.width = Math.round(180 * ratio);
      off.height = 180;
    }
    const offCtx = off.getContext('2d');
    
    drawImageSafely(offCtx, sbCanvas.img, box.x, box.y, box.w, box.h, 0, 0, off.width, off.height);

    // Burn Labels into preview if option is set (for visual fidelity)
    if (burnLabelsCheckbox.checked) {
      burnLabelOnCanvas(offCtx, box.name, off.width, off.height, 1.0);
    }

    const imgThumb = document.createElement('img');
    imgThumb.className = 'preview-thumb';
    imgThumb.src = off.toDataURL('image/png');

    const indexBadge = document.createElement('span');
    indexBadge.className = 'preview-index';
    indexBadge.textContent = `${Math.round(box.w)}x${Math.round(box.h)}`;

    thumbContainer.appendChild(imgThumb);
    thumbContainer.appendChild(indexBadge);

    const meta = document.createElement('div');
    meta.className = 'preview-meta';

    const nameInput = document.createElement('input');
    nameInput.className = 'preview-name-input';
    nameInput.type = 'text';
    nameInput.value = box.name;
    nameInput.addEventListener('change', (e) => {
      box.name = e.target.value;
      recordUndoState();
      saveCurrentPageState();
      sbCanvas.draw();
    });

    const actions = document.createElement('div');
    actions.className = 'preview-actions';

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'mini-btn mini-btn-primary';
    downloadBtn.innerHTML = '<i class="fa-solid fa-download"></i> Save';
    downloadBtn.addEventListener('click', () => downloadSingleBox(box));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'mini-btn';
    deleteBtn.style.color = '#ef4444';
    deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
    deleteBtn.addEventListener('click', () => {
      setCropBoxesAndSync(sbCanvas.cropBoxes.filter(b => b.id !== box.id), true);
      if (sbCanvas.selectedBoxId === box.id) sbCanvas.setSelectedBoxId(null);
      recordUndoState();
      saveCurrentPageState();
      renderPreviews();
    });

    actions.appendChild(downloadBtn);
    actions.appendChild(deleteBtn);
    meta.appendChild(nameInput);
    meta.appendChild(actions);
    card.appendChild(thumbContainer);
    card.appendChild(meta);

    card.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON' && !e.target.closest('button')) {
        sbCanvas.setSelectedBoxId(box.id);
        document.querySelectorAll('.preview-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
      }
    });

    previewsGrid.appendChild(card);
  });
}

function highlightSelectedPreview(id) {
  document.querySelectorAll('.preview-card').forEach(c => c.classList.remove('selected'));
  const card = document.getElementById(`preview-card-${id}`);
  if (card) {
    card.classList.add('selected');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// Helper to draw safely outside boundary
function drawImageSafely(ctx, img, sx, sy, sw, sh, dx, dy, dw, dh) {
  const sLeft = Math.max(0, sx);
  const sTop = Math.max(0, sy);
  const sRight = Math.min(img.width, sx + sw);
  const sBottom = Math.min(img.height, sy + sh);

  const sWidth = sRight - sLeft;
  const sHeight = sBottom - sTop;

  if (sWidth <= 0 || sHeight <= 0) return;

  const scaleX = dw / sw;
  const scaleY = dh / sh;

  const dLeft = dx + (sLeft - sx) * scaleX;
  const dTop = dy + (sTop - sy) * scaleY;
  const dWidth = sWidth * scaleX;
  const dHeight = sHeight * scaleY;

  ctx.drawImage(img, sLeft, sTop, sWidth, sHeight, dLeft, dTop, dWidth, dHeight);
}

// Burn Label overlay onto canvas
function burnLabelOnCanvas(ctx, text, w, h, scale = 1.0) {
  const bannerHeight = Math.round(30 * scale);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(0, h - bannerHeight, w, bannerHeight);

  ctx.fillStyle = '#ffffff';
  const fontSize = Math.max(10, Math.round(14 * scale));
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h - bannerHeight / 2);
}

// Download single frame image
function downloadSingleBox(box) {
  const format = imgFormatSelect.value;
  const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  
  let scaleFactor = 1;
  const minDim = Math.min(box.w, box.h);
  if (minDim > 0 && minDim < 300) {
    scaleFactor = 300 / minDim;
  }
  const exportW = Math.round(box.w * scaleFactor);
  const exportH = Math.round(box.h * scaleFactor);

  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = exportW;
  exportCanvas.height = exportH;
  const exportCtx = exportCanvas.getContext('2d');
  
  exportCtx.fillStyle = '#000000';
  exportCtx.fillRect(0, 0, exportW, exportH);
  
  drawImageSafely(exportCtx, sbCanvas.img, box.x, box.y, box.w, box.h, 0, 0, exportW, exportH);

  if (burnLabelsCheckbox.checked) {
    // scale font size relative to frame dimensions
    const scale = exportW / 400;
    burnLabelOnCanvas(exportCtx, box.name, exportW, exportH, Math.max(0.6, scale));
  }

  const link = document.createElement('a');
  link.download = `${box.name}.${format}`;
  link.href = exportCanvas.toDataURL(mimeType, 0.95);
  link.click();
  showToast(`Downloaded ${box.name}`);
}

// Export All Panels across ALL Pages as ZIP file
btnDownloadZip.addEventListener('click', async () => {
  if (pages.length === 0) return;
  
  showToast('Generating batch ZIP... Please wait.');
  
  const zip = new window.JSZip();
  const format = imgFormatSelect.value;
  const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const prefixName = baseFileNameInput.value || 'storyboard';

  // We process sequentially loading images offscreen to prevent memory spikes
  for (let pIdx = 0; pIdx < pages.length; pIdx++) {
    const page = pages[pIdx];
    if (page.cropBoxes.length === 0) continue;

    // Load page image offscreen
    await new Promise((resolve) => {
      const offscreenImg = new Image();
      offscreenImg.src = page.imageSrc;
      offscreenImg.onload = () => {
        const pageFolder = pages.length > 1 ? zip.folder(`Page_${pIdx + 1}_${page.name.replace(/\s+/g, '_')}`) : zip;

        page.cropBoxes.forEach((box, i) => {
          let scaleFactor = 1;
          const minDim = Math.min(box.w, box.h);
          if (minDim > 0 && minDim < 300) {
            scaleFactor = 300 / minDim;
          }
          const exportW = Math.round(box.w * scaleFactor);
          const exportH = Math.round(box.h * scaleFactor);

          const exportCanvas = document.createElement('canvas');
          exportCanvas.width = exportW;
          exportCanvas.height = exportH;
          const exportCtx = exportCanvas.getContext('2d');
          
          exportCtx.fillStyle = '#000000';
          exportCtx.fillRect(0, 0, exportW, exportH);
          drawImageSafely(exportCtx, offscreenImg, box.x, box.y, box.w, box.h, 0, 0, exportW, exportH);

          // Render overlay
          if (burnLabelsCheckbox.checked) {
            const scale = exportW / 400;
            burnLabelOnCanvas(exportCtx, box.name, exportW, exportH, Math.max(0.6, scale));
          }

          const dataUrl = exportCanvas.toDataURL(mimeType, 0.95);
          const binaryData = dataUrl.split(',')[1];
          pageFolder.file(`${prefixName}_p${pIdx + 1}_f${i + 1}_${box.name.replace(/\s+/g, '_')}.${format}`, binaryData, { base64: true });
        });
        resolve();
      };
    });
  }

  zip.generateAsync({ type: 'blob' }).then((content) => {
    const link = document.createElement('a');
    link.download = `${prefixName}_frames.zip`;
    link.href = URL.createObjectURL(content);
    link.click();
    showToast('ZIP download started!');
  });
});

// Undo Stack utilities per page
function recordUndoState() {
  const page = getActivePage();
  if (!page) return;

  let stack = undoStacks.get(page.id);
  if (!stack) {
    stack = [];
    undoStacks.set(page.id, stack);
  }

  const stateSnapshot = {
    cropBoxes: JSON.parse(JSON.stringify(sbCanvas.cropBoxes)),
    selectedBoxId: sbCanvas.selectedBoxId,
    settings: getSettingsFromUI()
  };

  // Skip duplicating same state
  if (stack.length > 0) {
    const last = stack[stack.length - 1];
    if (JSON.stringify(last.cropBoxes) === JSON.stringify(stateSnapshot.cropBoxes) &&
        JSON.stringify(last.settings) === JSON.stringify(stateSnapshot.settings)) {
      return;
    }
  }

  stack.push(stateSnapshot);
  if (stack.length > MAX_UNDO) {
    stack.shift();
  }
}

function triggerUndo() {
  const page = getActivePage();
  if (!page) return;

  const stack = undoStacks.get(page.id);
  if (!stack || stack.length <= 1) {
    showToast('Nothing to undo on this page');
    return;
  }

  // Pop current state
  stack.pop();
  
  // Restore previous state
  const prev = stack[stack.length - 1];
  
  setCropBoxesAndSync(prev.cropBoxes, true);
  sbCanvas.setSelectedBoxId(prev.selectedBoxId);
  applySettingsToUI(prev.settings);
  updateGridSlidersLabels();
  
  saveCurrentPageState();
  renderPreviews();
  sbCanvas.draw();
  showToast('Undo successful!');
}

// Custom Toast Alerts
function showToast(msg, type = 'success') {
  toastMsg.textContent = msg;
  toast.className = `status-toast ${type}`;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// Kick off initialization
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
export { sbCanvas };
