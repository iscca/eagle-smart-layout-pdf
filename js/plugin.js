/**
 * Eagle Plugin: Smart Image Layout Studio (PDF & High-Res Image Exporter)
 * Version 2.1
 * Features:
 *  - 4 Layout Modes: Justified Album (Default: Smart Page Auto-Balance), Uniform Grid, Long Stitch, Single Page
 *  - Exact Border-to-Border Spacing Engine & Uniform 4-Sided Image Borders
 *  - Dual Export Engine: Multi-page PDF (.pdf) & High-Res Images (.png, .jpg, .webp - per page or merged long image)
 *  - Dual Preview Modes: Single Page Precision Editor & Multi-Page Grid Overview
 *  - Interactive Canvas: Hover preview, Click-to-Select, Double-Click Fit Toggle, Drag-to-Pan, Wheel-to-Zoom, Flip/Rotate/Reorder
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'eagle_smart_layout_studio_config_v2_2';

  const VALID_IMAGE_EXTS = new Set([
    'jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'svg', 'tiff', 'tif', 'avif', 'ico'
  ]);

  const PAPER_PRESETS = {
    A4: { width: 210, height: 297 },
    A3: { width: 297, height: 420 },
    A5: { width: 148, height: 210 },
    B5: { width: 176, height: 250 },
    Letter: { width: 215.9, height: 279.4 },
    Legal: { width: 215.9, height: 355.6 },
    Screen16_9: { width: 297, height: 167 },
    Social3_4: { width: 210, height: 280 },
    Square: { width: 210, height: 210 }
  };

  const MAX_CANVAS_DIMENSION = 15360;

  function getFactoryDefaultConfig() {
    return {
      mode: 'justified',          // 'justified' | 'grid' | 'stitch' | 'single'
      rowDensity: 'fit_page',     // Default: 'fit_page' (整页自适应均衡分配)
      rowsPerPage: 4,             // Max rows per page in justified mode
      pageFitMode: 'fit_height',  // 'fit_height' | 'natural'
      gridPreset: '2x2',
      cols: 2,
      rows: 2,
      stitchDirection: 'vertical', // 'vertical' | 'horizontal'
      stitchBaseSize: 210,         // Base width (vertical) or height (horizontal) in mm
      paperSize: 'A4',
      customWidth: 210,
      customHeight: 297,
      orientation: 'portrait',    // 'portrait' | 'landscape' | 'auto'

      // Margins & Spacing (Border-to-Border distance in mm)
      marginUniform: true,
      marginTop: 10,
      marginBottom: 10,
      marginLeft: 10,
      marginRight: 10,
      spacingH: 4,
      spacingV: 4,

      // Cell Fill & Visual Styling
      defaultFitMode: 'contain',  // 'contain' | 'cover'
      scale: 1.0,                 // 0.4 ~ 1.0
      borderRadius: 0,            // 0 ~ 20 mm
      borderWidth: 0,             // 0 ~ 5 mm (uniform on top/bottom/left/right)
      borderColor: '#334155',
      shadow: false,
      showCaption: false,

      // Page Background & Header/Footer
      bgColor: '#ffffff',
      headerText: '',
      showPageNumber: false,

      // Export Settings
      exportFormat: 'pdf',        // 'pdf' | 'png' | 'jpeg' | 'webp'
      imageExportMode: 'pages',   // 'pages' (one image per page) | 'merge' (merge all pages into one long image)
      dpi: 150,
      quality: 'high',
      sortBy: 'default'
    };
  }

  const state = {
    images: [],          // Original Eagle items
    selectedImages: [],  // Ordered items for layout
    currentPage: 1,      // 1-based current preview page
    viewMode: 'single',  // 'single' | 'overview'
    zoomLevel: 1.0,      // Preview viewport zoom multiplier
    isExporting: false,
    loadedImagesCache: new Map(),

    // Interactive canvas state
    selectedItemId: null,
    hoveredItemId: null,
    isDraggingPan: false,
    dragStart: { x: 0, y: 0 },
    dragInitialPan: { x: 0, y: 0 },
    draggedListIndex: null,

    config: getFactoryDefaultConfig()
  };

  const DOM = {};
  let rafRenderId = null;

  function saveConfigToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config));
    } catch (_) {}
  }

  function loadConfigFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        state.config = { ...getFactoryDefaultConfig(), ...parsed };
      }
    } catch (_) {}
  }

  function requestRenderPreview() {
    saveConfigToStorage();
    if (rafRenderId) cancelAnimationFrame(rafRenderId);
    rafRenderId = requestAnimationFrame(() => {
      renderPreview();
    });
  }

  function updateTheme() {
    if (typeof eagle === 'undefined' || !eagle.app) return;
    const THEME_SUPPORT = {
      AUTO: eagle.app.isDarkColors() ? 'gray' : 'light',
      LIGHT: 'light',
      LIGHTGRAY: 'lightgray',
      GRAY: 'gray',
      DARK: 'dark',
      BLUE: 'blue',
      PURPLE: 'purple',
    };
    const themeName = THEME_SUPPORT[eagle.app.theme?.toUpperCase()] ?? 'dark';
    const htmlEl = document.documentElement;
    htmlEl.setAttribute('theme', themeName);
    htmlEl.setAttribute('platform', eagle.app.platform || 'mac');
  }

  async function init() {
    loadConfigFromStorage();
    cacheDOMElements();
    syncDOMControlsFromConfig();
    bindEvents();
    await I18N.init();
    populateLocaleSelector();
    updateTheme();
    syncExportUI();

    if (typeof eagle !== 'undefined') {
      eagle.onThemeChanged(() => updateTheme());
      eagle.onPluginCreate(async () => {
        updateTheme();
        await loadSelectedImages();
      });
      eagle.onPluginShow(async () => {
        await loadSelectedImages();
      });
    } else {
      await loadMockImages();
    }
  }

  function cacheDOMElements() {
    DOM.btnRefresh = document.getElementById('btnRefresh');
    DOM.btnResetConfig = document.getElementById('btnResetConfig');
    DOM.btnExport = document.getElementById('btnExport');
    DOM.btnExportLabel = document.getElementById('btnExportLabel');
    DOM.btnSidebarExport = document.getElementById('btnSidebarExport');
    DOM.btnSidebarExportLabel = document.getElementById('btnSidebarExportLabel');
    DOM.quickFormatSelect = document.getElementById('quickFormatSelect');
    DOM.headerStatsBadge = document.getElementById('headerStatsBadge');
    DOM.localeSelect = document.getElementById('localeSelect');
    DOM.emptyState = document.getElementById('emptyState');

    DOM.tabBtns = document.querySelectorAll('.tab-btn');
    DOM.tabPanes = document.querySelectorAll('.tab-pane');

    // Mode Cards
    DOM.modeJustified = document.getElementById('modeJustified');
    DOM.modeGrid = document.getElementById('modeGrid');
    DOM.modeStitch = document.getElementById('modeStitch');
    DOM.modeSingle = document.getElementById('modeSingle');

    // Mode Sections
    DOM.justifiedSection = document.getElementById('justifiedSection');
    DOM.densitySelect = document.getElementById('densitySelect');
    DOM.rowsPerPageSelect = document.getElementById('rowsPerPageSelect');
    DOM.pageFitSelect = document.getElementById('pageFitSelect');

    DOM.gridSection = document.getElementById('gridSection');
    DOM.gridPresetSelect = document.getElementById('gridPresetSelect');
    DOM.gridCustomInputs = document.getElementById('gridCustomInputs');
    DOM.inputCols = document.getElementById('inputCols');
    DOM.inputRows = document.getElementById('inputRows');

    DOM.stitchSection = document.getElementById('stitchSection');
    DOM.stitchDirBtns = document.querySelectorAll('[data-stitch-dir]');
    DOM.inputStitchBase = document.getElementById('inputStitchBase');
    DOM.stitchBaseVal = document.getElementById('stitchBaseVal');

    // Paper & Orientation
    DOM.paperSection = document.getElementById('paperSection');
    DOM.paperSizeSelect = document.getElementById('paperSizeSelect');
    DOM.paperCustomInputs = document.getElementById('paperCustomInputs');
    DOM.inputCustomWidth = document.getElementById('inputCustomWidth');
    DOM.inputCustomHeight = document.getElementById('inputCustomHeight');
    DOM.orientationGroup = document.getElementById('orientationGroup');
    DOM.orientationBtns = document.querySelectorAll('[data-orientation]');

    // Margin & Spacing
    DOM.presetChips = document.querySelectorAll('[data-spacing-preset]');
    DOM.marginUniformBtn = document.getElementById('marginUniformBtn');
    DOM.marginIndepBtn = document.getElementById('marginIndepBtn');
    DOM.marginUniformWrap = document.getElementById('marginUniformWrap');
    DOM.marginIndepWrap = document.getElementById('marginIndepWrap');
    DOM.inputMarginAll = document.getElementById('inputMarginAll');
    DOM.marginAllVal = document.getElementById('marginAllVal');
    DOM.inputMarginTop = document.getElementById('inputMarginTop');
    DOM.marginTopVal = document.getElementById('marginTopVal');
    DOM.inputMarginBottom = document.getElementById('inputMarginBottom');
    DOM.marginBottomVal = document.getElementById('marginBottomVal');
    DOM.inputMarginLeft = document.getElementById('inputMarginLeft');
    DOM.marginLeftVal = document.getElementById('marginLeftVal');
    DOM.inputMarginRight = document.getElementById('inputMarginRight');
    DOM.marginRightVal = document.getElementById('marginRightVal');

    DOM.inputSpacingH = document.getElementById('inputSpacingH');
    DOM.spacingHVal = document.getElementById('spacingHVal');
    DOM.inputSpacingV = document.getElementById('inputSpacingV');
    DOM.spacingVVal = document.getElementById('spacingVVal');

    // Cell Style & Decorations
    DOM.globalFitContain = document.getElementById('globalFitContain');
    DOM.globalFitCover = document.getElementById('globalFitCover');
    DOM.scaleRange = document.getElementById('scaleRange');
    DOM.scaleValText = document.getElementById('scaleValText');
    DOM.inputRadius = document.getElementById('inputRadius');
    DOM.radiusValText = document.getElementById('radiusValText');
    DOM.inputBorderWidth = document.getElementById('inputBorderWidth');
    DOM.borderWidthValText = document.getElementById('borderWidthValText');
    DOM.inputBorderColor = document.getElementById('inputBorderColor');
    DOM.chkShadow = document.getElementById('chkShadow');
    DOM.chkCaption = document.getElementById('chkCaption');

    // Background & Header/Footer
    DOM.swatchBtns = document.querySelectorAll('.swatch-btn');
    DOM.customBgPicker = document.getElementById('customBgPicker');
    DOM.inputHeaderText = document.getElementById('inputHeaderText');
    DOM.chkPageNumber = document.getElementById('chkPageNumber');

    // Export & Quality
    DOM.formatCards = document.querySelectorAll('.format-card');
    DOM.imageExportModeSection = document.getElementById('imageExportModeSection');
    DOM.imgExportModeBtns = document.querySelectorAll('[data-img-export-mode]');
    DOM.dpiSelect = document.getElementById('dpiSelect');
    DOM.qualitySelect = document.getElementById('qualitySelect');
    DOM.exportPixelEstimate = document.getElementById('exportPixelEstimate');
    DOM.footerFormatBadge = document.getElementById('footerFormatBadge');
    DOM.footerResolutionText = document.getElementById('footerResolutionText');

    // Images List
    DOM.tabImagesCount = document.getElementById('tabImagesCount');
    DOM.imagesScrollContainer = document.getElementById('imagesScrollContainer');
    DOM.sortSelect = document.getElementById('sortSelect');
    DOM.btnResetAllEdits = document.getElementById('btnResetAllEdits');

    // Preview Area
    DOM.btnViewSingle = document.getElementById('btnViewSingle');
    DOM.btnViewOverview = document.getElementById('btnViewOverview');
    DOM.singlePagerWrap = document.getElementById('singlePagerWrap');
    DOM.previewZoomControls = document.getElementById('previewZoomControls');
    DOM.singlePageWrapper = document.getElementById('singlePageWrapper');
    DOM.overviewGridContainer = document.getElementById('overviewGridContainer');
    DOM.previewCanvas = document.getElementById('previewCanvas');
    DOM.pdfSheet = document.getElementById('pdfSheet');
    DOM.previewViewport = document.getElementById('previewViewport');
    DOM.pageIndicatorText = document.getElementById('pageIndicatorText');
    DOM.paperInfoBadge = document.getElementById('paperInfoBadge');
    DOM.zoomPercentText = document.getElementById('zoomPercentText');
    DOM.btnPrevPage = document.getElementById('btnPrevPage');
    DOM.btnNextPage = document.getElementById('btnNextPage');
    DOM.btnZoomIn = document.getElementById('btnZoomIn');
    DOM.btnZoomOut = document.getElementById('btnZoomOut');
    DOM.btnZoomFit = document.getElementById('btnZoomFit');
    DOM.pageThumbStrip = document.getElementById('pageThumbStrip');

    // Single Image Edit Bar
    DOM.imageHoverOverlay = document.getElementById('imageHoverOverlay');
    DOM.imageSelectionOverlay = document.getElementById('imageSelectionOverlay');
    DOM.singleEditBar = document.getElementById('singleEditBar');
    DOM.singleItemTitle = document.getElementById('singleItemTitle');
    DOM.singleScaleRange = document.getElementById('singleScaleRange');
    DOM.singleScaleVal = document.getElementById('singleScaleVal');
    DOM.btnFitContain = document.getElementById('btnFitContain');
    DOM.btnFitCover = document.getElementById('btnFitCover');
    DOM.btnRotateItem = document.getElementById('btnRotateItem');
    DOM.btnFlipItem = document.getElementById('btnFlipItem');
    DOM.btnMovePrevItem = document.getElementById('btnMovePrevItem');
    DOM.btnMoveNextItem = document.getElementById('btnMoveNextItem');
    DOM.btnResetItem = document.getElementById('btnResetItem');
    DOM.btnCloseSingleEdit = document.getElementById('btnCloseSingleEdit');

    // Modals
    DOM.progressModal = document.getElementById('progressModal');
    DOM.progressModalTitle = document.getElementById('progressModalTitle');
    DOM.progressFill = document.getElementById('progressFill');
    DOM.progressText = document.getElementById('progressText');
    DOM.successModal = document.getElementById('successModal');
    DOM.successModalTitle = document.getElementById('successModalTitle');
    DOM.successPathText = document.getElementById('successPathText');
    DOM.btnOpenFile = document.getElementById('btnOpenFile');
    DOM.btnRevealFolder = document.getElementById('btnRevealFolder');
    DOM.btnCloseSuccess = document.getElementById('btnCloseSuccess');
  }

  function syncDOMControlsFromConfig() {
    const cfg = state.config;

    DOM.modeJustified.classList.toggle('active', cfg.mode === 'justified');
    DOM.modeGrid.classList.toggle('active', cfg.mode === 'grid');
    DOM.modeStitch.classList.toggle('active', cfg.mode === 'stitch');
    DOM.modeSingle.classList.toggle('active', cfg.mode === 'single');

    DOM.justifiedSection.style.display = (cfg.mode === 'justified') ? 'flex' : 'none';
    DOM.gridSection.style.display = (cfg.mode === 'grid') ? 'flex' : 'none';
    DOM.stitchSection.style.display = (cfg.mode === 'stitch') ? 'flex' : 'none';
    DOM.paperSection.style.display = (cfg.mode === 'stitch') ? 'none' : 'flex';

    DOM.densitySelect.value = cfg.rowDensity || 'fit_page';
    DOM.rowsPerPageSelect.value = String(cfg.rowsPerPage || 4);
    DOM.pageFitSelect.value = cfg.pageFitMode || 'fit_height';

    DOM.gridPresetSelect.value = cfg.gridPreset;
    DOM.gridCustomInputs.style.display = (cfg.gridPreset === 'custom') ? 'grid' : 'none';
    DOM.inputCols.value = cfg.cols;
    DOM.inputRows.value = cfg.rows;

    DOM.stitchDirBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-stitch-dir') === cfg.stitchDirection));
    DOM.inputStitchBase.value = cfg.stitchBaseSize;
    DOM.stitchBaseVal.textContent = `${cfg.stitchBaseSize} mm`;

    DOM.paperSizeSelect.value = cfg.paperSize;
    DOM.paperCustomInputs.style.display = (cfg.paperSize === 'custom') ? 'grid' : 'none';
    DOM.inputCustomWidth.value = cfg.customWidth;
    DOM.inputCustomHeight.value = cfg.customHeight;
    DOM.orientationBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-orientation') === cfg.orientation));

    // Margins & Spacing
    DOM.marginUniformBtn.classList.toggle('active', cfg.marginUniform);
    DOM.marginIndepBtn.classList.toggle('active', !cfg.marginUniform);
    DOM.marginUniformWrap.style.display = cfg.marginUniform ? 'flex' : 'none';
    DOM.marginIndepWrap.style.display = cfg.marginUniform ? 'none' : 'flex';

    DOM.inputMarginAll.value = cfg.marginTop;
    DOM.marginAllVal.textContent = `${cfg.marginTop} mm`;
    ['Top', 'Bottom', 'Left', 'Right'].forEach((side) => {
      DOM[`inputMargin${side}`].value = cfg[`margin${side}`];
      DOM[`margin${side}Val`].textContent = `${cfg[`margin${side}`]} mm`;
    });

    DOM.inputSpacingH.value = cfg.spacingH;
    DOM.spacingHVal.textContent = `${cfg.spacingH} mm`;
    DOM.inputSpacingV.value = cfg.spacingV;
    DOM.spacingVVal.textContent = `${cfg.spacingV} mm`;

    // Cell style
    DOM.globalFitContain.classList.toggle('active', cfg.defaultFitMode === 'contain');
    DOM.globalFitCover.classList.toggle('active', cfg.defaultFitMode === 'cover');

    const scalePct = Math.round((cfg.scale || 1.0) * 100);
    DOM.scaleRange.value = scalePct;
    DOM.scaleValText.textContent = `${scalePct}%`;

    DOM.inputRadius.value = cfg.borderRadius || 0;
    DOM.radiusValText.textContent = `${cfg.borderRadius || 0} mm`;

    DOM.inputBorderWidth.value = cfg.borderWidth || 0;
    DOM.borderWidthValText.textContent = `${cfg.borderWidth || 0} mm`;
    DOM.inputBorderColor.value = cfg.borderColor || '#334155';

    DOM.chkShadow.checked = !!cfg.shadow;
    DOM.chkCaption.checked = !!cfg.showCaption;

    let matchedSwatch = false;
    DOM.swatchBtns.forEach((b) => {
      const isMatch = b.getAttribute('data-bg') === cfg.bgColor;
      b.classList.toggle('active', isMatch);
      if (isMatch) matchedSwatch = true;
    });
    if (!matchedSwatch && cfg.bgColor && cfg.bgColor.startsWith('#')) {
      DOM.customBgPicker.value = cfg.bgColor;
    }

    DOM.inputHeaderText.value = cfg.headerText || '';
    DOM.chkPageNumber.checked = !!cfg.showPageNumber;

    DOM.quickFormatSelect.value = cfg.exportFormat;
    DOM.formatCards.forEach(c => c.classList.toggle('active', c.getAttribute('data-format') === cfg.exportFormat));
    DOM.imgExportModeBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-img-export-mode') === cfg.imageExportMode));
    DOM.dpiSelect.value = String(cfg.dpi || 150);
    DOM.qualitySelect.value = cfg.quality || 'high';
    DOM.sortSelect.value = cfg.sortBy || 'default';

    updateOptionVisibility();
  }

  function bindEvents() {
    DOM.btnRefresh.addEventListener('click', () => loadSelectedImages());
    DOM.btnExport.addEventListener('click', () => executeExport());
    DOM.btnSidebarExport.addEventListener('click', () => executeExport());

    DOM.btnResetConfig.addEventListener('click', () => {
      state.config = getFactoryDefaultConfig();
      state.selectedImages.forEach((img) => {
        img._custom = getDefaultCustomSettings();
      });
      syncDOMControlsFromConfig();
      syncExportUI();
      closeSingleEdit();
      requestRenderPreview();
    });

    // Tabs Navigation
    DOM.tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        DOM.tabBtns.forEach(b => b.classList.remove('active'));
        DOM.tabPanes.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const targetId = btn.getAttribute('data-tab');
        document.getElementById(targetId)?.classList.add('active');
      });
    });

    // View Mode Toggle
    DOM.btnViewSingle.addEventListener('click', () => setViewMode('single'));
    DOM.btnViewOverview.addEventListener('click', () => setViewMode('overview'));

    function setViewMode(mode) {
      state.viewMode = mode;
      const isSingle = mode === 'single';
      DOM.btnViewSingle.classList.toggle('active', isSingle);
      DOM.btnViewOverview.classList.toggle('active', !isSingle);
      DOM.singlePageWrapper.style.display = isSingle ? 'flex' : 'none';
      DOM.singlePagerWrap.style.display = isSingle ? 'flex' : 'none';
      DOM.previewZoomControls.style.visibility = isSingle ? 'visible' : 'hidden';
      DOM.overviewGridContainer.style.display = isSingle ? 'none' : 'grid';
      if (!isSingle) closeSingleEdit();
      requestRenderPreview();
    }

    // Layout Mode Switching
    DOM.modeJustified.addEventListener('click', () => setActiveMode('justified'));
    DOM.modeGrid.addEventListener('click', () => setActiveMode('grid'));
    DOM.modeStitch.addEventListener('click', () => setActiveMode('stitch'));
    DOM.modeSingle.addEventListener('click', () => setActiveMode('single'));

    function setActiveMode(mode) {
      state.config.mode = mode;
      DOM.modeJustified.classList.toggle('active', mode === 'justified');
      DOM.modeGrid.classList.toggle('active', mode === 'grid');
      DOM.modeStitch.classList.toggle('active', mode === 'stitch');
      DOM.modeSingle.classList.toggle('active', mode === 'single');

      DOM.justifiedSection.style.display = (mode === 'justified') ? 'flex' : 'none';
      DOM.gridSection.style.display = (mode === 'grid') ? 'flex' : 'none';
      DOM.stitchSection.style.display = (mode === 'stitch') ? 'flex' : 'none';
      DOM.paperSection.style.display = (mode === 'stitch') ? 'none' : 'flex';

      updateOptionVisibility();
      state.currentPage = 1;
      closeSingleEdit();
      requestRenderPreview();
    }

    // Justified Options
    DOM.densitySelect.addEventListener('change', (e) => {
      state.config.rowDensity = e.target.value;
      closeSingleEdit();
      requestRenderPreview();
    });

    DOM.rowsPerPageSelect.addEventListener('change', (e) => {
      state.config.rowsPerPage = parseInt(e.target.value) || 4;
      closeSingleEdit();
      requestRenderPreview();
    });

    DOM.pageFitSelect.addEventListener('change', (e) => {
      state.config.pageFitMode = e.target.value;
      requestRenderPreview();
    });

    // Grid Options
    DOM.gridPresetSelect.addEventListener('change', (e) => {
      state.config.gridPreset = e.target.value;
      if (e.target.value === 'custom') {
        DOM.gridCustomInputs.style.display = 'grid';
      } else {
        DOM.gridCustomInputs.style.display = 'none';
        const [c, r] = e.target.value.split('x').map(Number);
        state.config.cols = c;
        state.config.rows = r;
        DOM.inputCols.value = c;
        DOM.inputRows.value = r;
      }
      closeSingleEdit();
      requestRenderPreview();
    });

    DOM.inputCols.addEventListener('input', (e) => {
      state.config.cols = Math.max(1, Math.min(12, parseInt(e.target.value) || 1));
      requestRenderPreview();
    });

    DOM.inputRows.addEventListener('input', (e) => {
      state.config.rows = Math.max(1, Math.min(12, parseInt(e.target.value) || 1));
      requestRenderPreview();
    });

    // Long Stitch Options
    DOM.stitchDirBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        DOM.stitchDirBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.config.stitchDirection = btn.getAttribute('data-stitch-dir');
        closeSingleEdit();
        requestRenderPreview();
      });
    });

    DOM.inputStitchBase.addEventListener('input', (e) => {
      const v = parseInt(e.target.value) || 210;
      state.config.stitchBaseSize = v;
      DOM.stitchBaseVal.textContent = `${v} mm`;
      requestRenderPreview();
    });

    // Paper & Orientation
    DOM.paperSizeSelect.addEventListener('change', (e) => {
      state.config.paperSize = e.target.value;
      DOM.paperCustomInputs.style.display = (e.target.value === 'custom') ? 'grid' : 'none';
      requestRenderPreview();
    });

    DOM.inputCustomWidth.addEventListener('input', (e) => {
      state.config.customWidth = Math.max(20, parseFloat(e.target.value) || 210);
      requestRenderPreview();
    });

    DOM.inputCustomHeight.addEventListener('input', (e) => {
      state.config.customHeight = Math.max(20, parseFloat(e.target.value) || 297);
      requestRenderPreview();
    });

    DOM.orientationBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        DOM.orientationBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.config.orientation = btn.getAttribute('data-orientation');
        requestRenderPreview();
      });
    });

    // Quick Spacing Presets
    const SPACING_PRESETS = {
      zero: { margin: 0, gap: 0 },
      compact: { margin: 6, gap: 2 },
      standard: { margin: 10, gap: 4 },
      gallery: { margin: 20, gap: 8 }
    };

    DOM.presetChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        DOM.presetChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const key = chip.getAttribute('data-spacing-preset');
        const p = SPACING_PRESETS[key];
        if (!p) return;

        state.config.marginTop = state.config.marginBottom = state.config.marginLeft = state.config.marginRight = p.margin;
        state.config.spacingH = state.config.spacingV = p.gap;

        DOM.inputMarginAll.value = p.margin;
        DOM.marginAllVal.textContent = `${p.margin} mm`;
        ['Top', 'Bottom', 'Left', 'Right'].forEach((side) => {
          DOM[`inputMargin${side}`].value = p.margin;
          DOM[`margin${side}Val`].textContent = `${p.margin} mm`;
        });

        DOM.inputSpacingH.value = p.gap;
        DOM.spacingHVal.textContent = `${p.gap} mm`;
        DOM.inputSpacingV.value = p.gap;
        DOM.spacingVVal.textContent = `${p.gap} mm`;

        requestRenderPreview();
      });
    });

    // Margins
    DOM.marginUniformBtn.addEventListener('click', () => {
      DOM.marginUniformBtn.classList.add('active');
      DOM.marginIndepBtn.classList.remove('active');
      DOM.marginUniformWrap.style.display = 'flex';
      DOM.marginIndepWrap.style.display = 'none';
      state.config.marginUniform = true;
      const v = parseFloat(DOM.inputMarginAll.value) || 0;
      state.config.marginTop = state.config.marginBottom = state.config.marginLeft = state.config.marginRight = v;
      requestRenderPreview();
    });

    DOM.marginIndepBtn.addEventListener('click', () => {
      DOM.marginIndepBtn.classList.add('active');
      DOM.marginUniformBtn.classList.remove('active');
      DOM.marginUniformWrap.style.display = 'none';
      DOM.marginIndepWrap.style.display = 'flex';
      state.config.marginUniform = false;
      requestRenderPreview();
    });

    DOM.inputMarginAll.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value) || 0;
      DOM.marginAllVal.textContent = `${v} mm`;
      state.config.marginTop = state.config.marginBottom = state.config.marginLeft = state.config.marginRight = v;
      clearActivePresetChips();
      requestRenderPreview();
    });

    ['Top', 'Bottom', 'Left', 'Right'].forEach((side) => {
      const inputEl = DOM[`inputMargin${side}`];
      const valEl = DOM[`margin${side}Val`];
      inputEl.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value) || 0;
        valEl.textContent = `${v} mm`;
        state.config[`margin${side}`] = v;
        clearActivePresetChips();
        requestRenderPreview();
      });
    });

    // Spacing (Border-to-Border)
    DOM.inputSpacingH.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value) || 0;
      DOM.spacingHVal.textContent = `${v} mm`;
      state.config.spacingH = v;
      clearActivePresetChips();
      requestRenderPreview();
    });

    DOM.inputSpacingV.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value) || 0;
      DOM.spacingVVal.textContent = `${v} mm`;
      state.config.spacingV = v;
      clearActivePresetChips();
      requestRenderPreview();
    });

    function clearActivePresetChips() {
      DOM.presetChips.forEach(c => c.classList.remove('active'));
    }

    // Global Fit Mode (Contain vs Cover)
    DOM.globalFitContain.addEventListener('click', () => setGlobalFitMode('contain'));
    DOM.globalFitCover.addEventListener('click', () => setGlobalFitMode('cover'));

    function setGlobalFitMode(fitMode) {
      state.config.defaultFitMode = fitMode;
      DOM.globalFitContain.classList.toggle('active', fitMode === 'contain');
      DOM.globalFitCover.classList.toggle('active', fitMode === 'cover');
      state.selectedImages.forEach((img) => {
        if (img._custom && !img._custom.userModifiedFit) {
          img._custom.fitMode = fitMode;
        }
      });
      const sel = getSelectedItem();
      if (sel) syncSingleEditToolbar(sel);
      requestRenderPreview();
    }

    // Cell Scale, Radius, Border, Shadow, Caption
    DOM.scaleRange.addEventListener('input', (e) => {
      const val = parseInt(e.target.value) || 100;
      state.config.scale = val / 100;
      DOM.scaleValText.textContent = `${val}%`;
      requestRenderPreview();
    });

    DOM.inputRadius.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value) || 0;
      state.config.borderRadius = val;
      DOM.radiusValText.textContent = `${val} mm`;
      requestRenderPreview();
    });

    DOM.inputBorderWidth.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value) || 0;
      state.config.borderWidth = val;
      DOM.borderWidthValText.textContent = `${val} mm`;
      requestRenderPreview();
    });

    DOM.inputBorderColor.addEventListener('input', (e) => {
      state.config.borderColor = e.target.value;
      requestRenderPreview();
    });

    DOM.chkShadow.addEventListener('change', (e) => {
      state.config.shadow = e.target.checked;
      requestRenderPreview();
    });

    DOM.chkCaption.addEventListener('change', (e) => {
      state.config.showCaption = e.target.checked;
      requestRenderPreview();
    });

    // Background Color Swatches & Custom Picker
    DOM.swatchBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        DOM.swatchBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.config.bgColor = btn.getAttribute('data-bg');
        requestRenderPreview();
      });
    });

    DOM.customBgPicker.addEventListener('input', (e) => {
      DOM.swatchBtns.forEach(b => b.classList.remove('active'));
      state.config.bgColor = e.target.value;
      requestRenderPreview();
    });

    // Header & Page Number
    DOM.inputHeaderText.addEventListener('input', (e) => {
      state.config.headerText = e.target.value;
      requestRenderPreview();
    });

    DOM.chkPageNumber.addEventListener('change', (e) => {
      state.config.showPageNumber = e.target.checked;
      requestRenderPreview();
    });

    // Export Format Selection
    DOM.quickFormatSelect.addEventListener('change', (e) => {
      setExportFormat(e.target.value);
    });

    DOM.formatCards.forEach((card) => {
      card.addEventListener('click', () => {
        setExportFormat(card.getAttribute('data-format'));
      });
    });

    function setExportFormat(fmt) {
      state.config.exportFormat = fmt;
      DOM.quickFormatSelect.value = fmt;
      DOM.formatCards.forEach(c => {
        c.classList.toggle('active', c.getAttribute('data-format') === fmt);
      });
      syncExportUI();
      saveConfigToStorage();
    }

    DOM.imgExportModeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        DOM.imgExportModeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.config.imageExportMode = btn.getAttribute('data-img-export-mode');
        syncExportUI();
        saveConfigToStorage();
      });
    });

    // DPI & Quality
    DOM.dpiSelect.addEventListener('change', (e) => {
      state.config.dpi = parseInt(e.target.value) || 150;
      syncExportUI();
      requestRenderPreview();
    });

    DOM.qualitySelect.addEventListener('change', (e) => {
      state.config.quality = e.target.value;
      saveConfigToStorage();
    });

    // Sorting & Reset All Edits
    DOM.sortSelect.addEventListener('change', (e) => {
      state.config.sortBy = e.target.value;
      applySorting();
      renderImageList();
      requestRenderPreview();
    });

    DOM.btnResetAllEdits.addEventListener('click', () => {
      state.selectedImages.forEach((item) => {
        item._custom = getDefaultCustomSettings();
      });
      closeSingleEdit();
      requestRenderPreview();
    });

    // Preview Pager & Zoom
    DOM.btnPrevPage.addEventListener('click', () => {
      if (state.currentPage > 1) {
        state.currentPage--;
        closeSingleEdit();
        requestRenderPreview();
      }
    });

    DOM.btnNextPage.addEventListener('click', () => {
      const totalPages = calculateLayoutPages().length;
      if (state.currentPage < totalPages) {
        state.currentPage++;
        closeSingleEdit();
        requestRenderPreview();
      }
    });

    DOM.btnZoomIn.addEventListener('click', () => {
      state.zoomLevel = Math.min(3.0, +(state.zoomLevel + 0.15).toFixed(2));
      requestRenderPreview();
    });

    DOM.btnZoomOut.addEventListener('click', () => {
      state.zoomLevel = Math.max(0.25, +(state.zoomLevel - 0.15).toFixed(2));
      requestRenderPreview();
    });

    DOM.btnZoomFit.addEventListener('click', () => {
      state.zoomLevel = 1.0;
      requestRenderPreview();
    });

    setupCanvasInteractions();

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      if (e.key === 'Escape' && state.selectedItemId) {
        closeSingleEdit();
      } else if (e.key === 'ArrowLeft' && state.viewMode === 'single') {
        if (state.currentPage > 1) {
          state.currentPage--;
          closeSingleEdit();
          requestRenderPreview();
        }
      } else if (e.key === 'ArrowRight' && state.viewMode === 'single') {
        const total = calculateLayoutPages().length;
        if (state.currentPage < total) {
          state.currentPage++;
          closeSingleEdit();
          requestRenderPreview();
        }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedItemId) {
        const idx = state.selectedImages.findIndex(i => i.id === state.selectedItemId);
        if (idx !== -1) {
          const removedId = state.selectedItemId;
          state.selectedImages.splice(idx, 1);
          state.images = state.images.filter(img => img.id !== removedId);
          closeSingleEdit();
          renderImageList();
          updateUIEmptyState();
          requestRenderPreview();
        }
      }
    });

    // Single Image Floating Toolbar Events
    DOM.singleScaleRange.addEventListener('input', (e) => {
      const it = getSelectedItem();
      if (!it) return;
      const v = parseInt(e.target.value) || 100;
      it._custom.scale = v / 100;
      DOM.singleScaleVal.textContent = `${v}%`;
      requestRenderPreview();
    });

    DOM.btnFitContain.addEventListener('click', () => {
      const it = getSelectedItem();
      if (!it) return;
      it._custom.fitMode = 'contain';
      it._custom.userModifiedFit = true;
      DOM.btnFitContain.classList.add('active');
      DOM.btnFitCover.classList.remove('active');
      requestRenderPreview();
    });

    DOM.btnFitCover.addEventListener('click', () => {
      const it = getSelectedItem();
      if (!it) return;
      it._custom.fitMode = 'cover';
      it._custom.userModifiedFit = true;
      DOM.btnFitCover.classList.add('active');
      DOM.btnFitContain.classList.remove('active');
      requestRenderPreview();
    });

    DOM.btnRotateItem.addEventListener('click', () => {
      const it = getSelectedItem();
      if (!it) return;
      it._custom.rotate = ((it._custom.rotate || 0) + 90) % 360;
      requestRenderPreview();
    });

    DOM.btnFlipItem.addEventListener('click', () => {
      const it = getSelectedItem();
      if (!it) return;
      it._custom.flipH = !it._custom.flipH;
      requestRenderPreview();
    });

    DOM.btnMovePrevItem.addEventListener('click', () => {
      moveSelectedItemOrder(-1);
    });

    DOM.btnMoveNextItem.addEventListener('click', () => {
      moveSelectedItemOrder(1);
    });

    DOM.btnResetItem.addEventListener('click', () => {
      const it = getSelectedItem();
      if (!it) return;
      it._custom = getDefaultCustomSettings();
      syncSingleEditToolbar(it);
      requestRenderPreview();
    });

    DOM.btnCloseSingleEdit.addEventListener('click', () => {
      closeSingleEdit();
    });

    window.addEventListener('resize', () => {
      requestRenderPreview();
    });

    DOM.localeSelect.addEventListener('change', (e) => {
      I18N.setLocale(e.target.value);
    });

    window.addEventListener('localeChanged', () => {
      syncExportUI();
      updateUIEmptyState();
      updatePageInfo();
      renderImageList();
    });

    DOM.btnCloseSuccess.addEventListener('click', () => {
      DOM.successModal.classList.remove('active');
    });
  }

  function moveSelectedItemOrder(delta) {
    if (!state.selectedItemId) return;
    const idx = state.selectedImages.findIndex(i => i.id === state.selectedItemId);
    if (idx === -1) return;
    const targetIdx = idx + delta;
    if (targetIdx < 0 || targetIdx >= state.selectedImages.length) return;

    const temp = state.selectedImages[idx];
    state.selectedImages[idx] = state.selectedImages[targetIdx];
    state.selectedImages[targetIdx] = temp;

    renderImageList();
    requestRenderPreview();
  }

  function getDefaultCustomSettings() {
    return {
      scale: 1.0,
      fitMode: state.config.defaultFitMode || 'contain',
      userModifiedFit: false,
      panX: 0,
      panY: 0,
      rotate: 0,
      flipH: false
    };
  }

  function getSelectedItem() {
    if (!state.selectedItemId) return null;
    return state.selectedImages.find(i => i.id === state.selectedItemId);
  }

  function closeSingleEdit() {
    state.selectedItemId = null;
    DOM.imageSelectionOverlay.classList.remove('active');
    DOM.singleEditBar.classList.remove('active');
    highlightSelectedCardInList();
    requestRenderPreview();
  }

  function syncSingleEditToolbar(item) {
    if (!item) return;
    DOM.singleItemTitle.textContent = item.name;
    DOM.singleItemTitle.setAttribute('title', item.name);

    const s = Math.round((item._custom.scale || 1.0) * 100);
    DOM.singleScaleRange.value = s;
    DOM.singleScaleVal.textContent = `${s}%`;

    const effectiveFit = getEffectiveItemFitMode(item);
    const isCover = effectiveFit === 'cover';
    DOM.btnFitCover.classList.toggle('active', isCover);
    DOM.btnFitContain.classList.toggle('active', !isCover);

    DOM.singleEditBar.classList.add('active');
    highlightSelectedCardInList();
  }

  function getEffectiveItemFitMode(item) {
    const custom = item?._custom;
    if (custom && custom.userModifiedFit) {
      return custom.fitMode;
    }
    // In justified mode with fit_height, cells fill the page height so images cover the inner border frame seamlessly
    if (state.config.mode === 'justified' && state.config.pageFitMode === 'fit_height') {
      return 'cover';
    }
    if (state.config.mode === 'stitch') {
      return 'cover';
    }
    return state.config.defaultFitMode || 'contain';
  }

  function highlightSelectedCardInList() {
    const cards = DOM.imagesScrollContainer.querySelectorAll('.image-item-card');
    cards.forEach((card) => {
      card.classList.toggle('selected', card.getAttribute('data-id') === state.selectedItemId);
    });
  }

  function syncExportUI() {
    const fmt = state.config.exportFormat;
    const isPdf = fmt === 'pdf';
    const fmtUpper = fmt.toUpperCase();

    DOM.imageExportModeSection.style.display = isPdf ? 'none' : 'flex';
    DOM.footerFormatBadge.textContent = fmtUpper;

    const btnText = isPdf
      ? I18N.t('ui.export_pdf')
      : `${I18N.t('ui.export_img')} (${fmtUpper})`;

    DOM.btnExportLabel.textContent = btnText;
    DOM.btnSidebarExportLabel.textContent = btnText;

    const pages = calculateLayoutPages();
    const curPage = pages[state.currentPage - 1] || pages[0];
    if (curPage) {
      const dpi = state.config.dpi || 150;
      const pxW = Math.round((curPage.widthMm / 25.4) * dpi);
      const pxH = Math.round((curPage.heightMm / 25.4) * dpi);
      DOM.exportPixelEstimate.textContent = `${pxW} × ${pxH} px`;
      DOM.footerResolutionText.textContent = `${Math.round(curPage.widthMm)}×${Math.round(curPage.heightMm)}mm · ${dpi} DPI`;
    }
  }

  function setupCanvasInteractions() {
    const canvas = DOM.previewCanvas;

    canvas.addEventListener('mousemove', (e) => {
      if (state.isDraggingPan) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = findHitItem(x, y);

      if (hit && hit.placed.item.id !== state.selectedItemId) {
        state.hoveredItemId = hit.placed.item.id;
        DOM.imageHoverOverlay.style.left = `${hit.px}px`;
        DOM.imageHoverOverlay.style.top = `${hit.py}px`;
        DOM.imageHoverOverlay.style.width = `${hit.pw}px`;
        DOM.imageHoverOverlay.style.height = `${hit.ph}px`;
        DOM.imageHoverOverlay.classList.add('active');
      } else {
        state.hoveredItemId = null;
        DOM.imageHoverOverlay.classList.remove('active');
      }
    });

    canvas.addEventListener('mouseleave', () => {
      state.hoveredItemId = null;
      DOM.imageHoverOverlay.classList.remove('active');
    });

    canvas.addEventListener('mousedown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      const hit = findHitItem(clickX, clickY);
      if (hit) {
        state.selectedItemId = hit.placed.item.id;
        DOM.imageHoverOverlay.classList.remove('active');
        const it = hit.placed.item;
        if (!it._custom) it._custom = getDefaultCustomSettings();
        syncSingleEditToolbar(it);

        state.isDraggingPan = true;
        state.dragStart = { x: e.clientX, y: e.clientY };
        state.dragInitialPan = { x: it._custom.panX || 0, y: it._custom.panY || 0 };

        requestRenderPreview();
      } else {
        closeSingleEdit();
      }
    });

    canvas.addEventListener('dblclick', (e) => {
      const rect = canvas.getBoundingClientRect();
      const hit = findHitItem(e.clientX - rect.left, e.clientY - rect.top);
      if (hit) {
        const it = hit.placed.item;
        if (!it._custom) it._custom = getDefaultCustomSettings();
        const curFit = getEffectiveItemFitMode(it);
        it._custom.fitMode = curFit === 'cover' ? 'contain' : 'cover';
        it._custom.userModifiedFit = true;
        syncSingleEditToolbar(it);
        requestRenderPreview();
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (state.isDraggingPan && state.selectedItemId) {
        const it = getSelectedItem();
        if (!it) return;

        const dx = e.clientX - state.dragStart.x;
        const dy = e.clientY - state.dragStart.y;

        const panFactor = 0.003;
        it._custom.panX = Math.max(-0.6, Math.min(0.6, state.dragInitialPan.x + dx * panFactor));
        it._custom.panY = Math.max(-0.6, Math.min(0.6, state.dragInitialPan.y + dy * panFactor));

        requestRenderPreview();
      }
    });

    window.addEventListener('mouseup', () => {
      state.isDraggingPan = false;
    });

    canvas.addEventListener('wheel', (e) => {
      if (!state.selectedItemId) return;
      const rect = canvas.getBoundingClientRect();
      const hit = findHitItem(e.clientX - rect.left, e.clientY - rect.top);
      if (hit && hit.placed.item.id === state.selectedItemId) {
        e.preventDefault();
        const it = hit.placed.item;
        const delta = e.deltaY < 0 ? 0.05 : -0.05;
        it._custom.scale = Math.max(0.4, Math.min(3.0, +((it._custom.scale || 1.0) + delta).toFixed(2)));
        syncSingleEditToolbar(it);
        requestRenderPreview();
      }
    }, { passive: false });
  }

  function findHitItem(screenX, screenY) {
    const pages = calculateLayoutPages();
    const curPage = pages[state.currentPage - 1];
    if (!curPage) return null;

    const displayW = parseFloat(DOM.pdfSheet.style.width) || 100;
    const scaleFactor = displayW / curPage.widthMm;

    for (const placed of curPage.items) {
      const px = placed.cellX * scaleFactor;
      const py = placed.cellY * scaleFactor;
      const pw = placed.cellW * scaleFactor;
      const ph = placed.cellH * scaleFactor;

      if (screenX >= px && screenX <= px + pw && screenY >= py && screenY <= py + ph) {
        return { placed, px, py, pw, ph };
      }
    }
    return null;
  }

  function populateLocaleSelector() {
    DOM.localeSelect.innerHTML = '';
    I18N.supportedLocales.forEach((item) => {
      const opt = document.createElement('option');
      opt.value = item.code;
      opt.textContent = item.label;
      if (item.code === I18N.currentLocale) {
        opt.selected = true;
      }
      DOM.localeSelect.appendChild(opt);
    });
  }

  function updateOptionVisibility() {
    const isSingle = state.config.mode === 'single';
    const fitImageOpt = DOM.paperSizeSelect.querySelector('option[value="fit_image"]');
    if (fitImageOpt) {
      fitImageOpt.disabled = !isSingle;
      if (!isSingle && state.config.paperSize === 'fit_image') {
        state.config.paperSize = 'A4';
        DOM.paperSizeSelect.value = 'A4';
      }
    }
  }

  async function loadSelectedImages() {
    if (typeof eagle === 'undefined' || !eagle.item) return;

    try {
      const items = await eagle.item.getSelected();
      const validImages = (items || []).filter((item) => {
        const ext = (item.ext || '').toLowerCase();
        return VALID_IMAGE_EXTS.has(ext);
      });

      for (const item of validImages) {
        if (!item._custom) {
          item._custom = getDefaultCustomSettings();
        }
        if (!item.width || !item.height) {
          const imgEl = await loadImageElement(item);
          if (imgEl) {
            item.width = imgEl.naturalWidth;
            item.height = imgEl.naturalHeight;
          }
        }
      }

      state.images = validImages;
      applySorting();
      state.currentPage = 1;

      renderImageList();
      updateUIEmptyState();
      requestRenderPreview();
    } catch (err) {
      console.error('Error getting selected items from Eagle:', err);
    }
  }

  function updateUIEmptyState() {
    const count = state.selectedImages.length;
    const hasImages = count > 0;
    DOM.emptyState.style.display = hasImages ? 'none' : 'flex';
    DOM.btnExport.disabled = !hasImages;
    DOM.btnSidebarExport.disabled = !hasImages;
    DOM.tabImagesCount.textContent = `${count}`;
    DOM.headerStatsBadge.textContent = I18N.t('ui.total_images', { count });
  }

  function applySorting() {
    let list = [...state.images];
    const mode = state.config.sortBy;
    if (mode === 'name_asc') {
      list.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true }));
    } else if (mode === 'name_desc') {
      list.sort((a, b) => (b.name || '').localeCompare(a.name || '', undefined, { numeric: true }));
    } else if (mode === 'ratio_asc') {
      list.sort((a, b) => ((a.width || 1) / (a.height || 1)) - ((b.width || 1) / (b.height || 1)));
    } else if (mode === 'ratio_desc') {
      list.sort((a, b) => ((b.width || 1) / (b.height || 1)) - ((a.width || 1) / (a.height || 1)));
    } else if (mode === 'reverse') {
      list.reverse();
    }
    state.selectedImages = list;
  }

  function renderImageList() {
    DOM.imagesScrollContainer.innerHTML = '';
    state.selectedImages.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'image-item-card';
      if (item.id === state.selectedItemId) card.classList.add('selected');
      card.setAttribute('draggable', 'true');
      card.setAttribute('data-id', item.id);
      card.setAttribute('data-index', index);

      let thumbSrc = item.thumbnailURL || item.fileURL || '';
      if (!thumbSrc && item.filePath) {
        thumbSrc = `file://${item.filePath}`;
      }

      card.innerHTML = `
        <div class="drag-handle" title="Drag to reorder">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="9" cy="6" r="1"></circle><circle cx="15" cy="6" r="1"></circle>
            <circle cx="9" cy="12" r="1"></circle><circle cx="15" cy="12" r="1"></circle>
            <circle cx="9" cy="18" r="1"></circle><circle cx="15" cy="18" r="1"></circle>
          </svg>
        </div>
        <div class="image-thumb-box">
          <img src="${thumbSrc}" loading="lazy" alt="${item.name}" />
        </div>
        <div class="image-info">
          <div class="image-title" title="${item.name}">${index + 1}. ${item.name}</div>
          <div class="image-meta">${item.width || '?'} × ${item.height || '?'} px · ${(item.ext || '').toUpperCase()}</div>
        </div>
        <div class="image-actions">
          <button type="button" class="btn btn-default btn-icon btn-up" title="${I18N.t('ui.move_up')}" ${index === 0 ? 'disabled' : ''}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="18 15 12 9 6 15"></polyline>
            </svg>
          </button>
          <button type="button" class="btn btn-default btn-icon btn-down" title="${I18N.t('ui.move_down')}" ${index === state.selectedImages.length - 1 ? 'disabled' : ''}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          <button type="button" class="btn btn-default btn-icon btn-remove" title="${I18N.t('ui.remove_item')}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        if (state.viewMode !== 'single') {
          DOM.btnViewSingle.click();
        }
        jumpToImageOnCanvas(item);
      });

      card.querySelector('.btn-up').addEventListener('click', (e) => {
        e.stopPropagation();
        if (index > 0) {
          const tmp = state.selectedImages[index - 1];
          state.selectedImages[index - 1] = state.selectedImages[index];
          state.selectedImages[index] = tmp;
          renderImageList();
          requestRenderPreview();
        }
      });

      card.querySelector('.btn-down').addEventListener('click', (e) => {
        e.stopPropagation();
        if (index < state.selectedImages.length - 1) {
          const tmp = state.selectedImages[index + 1];
          state.selectedImages[index + 1] = state.selectedImages[index];
          state.selectedImages[index] = tmp;
          renderImageList();
          requestRenderPreview();
        }
      });

      card.querySelector('.btn-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        state.selectedImages.splice(index, 1);
        state.images = state.images.filter(img => img.id !== item.id);
        if (state.selectedItemId === item.id) closeSingleEdit();
        renderImageList();
        updateUIEmptyState();
        const total = calculateLayoutPages().length;
        if (state.currentPage > total) state.currentPage = Math.max(1, total);
        requestRenderPreview();
      });

      card.addEventListener('dragstart', (e) => {
        state.draggedListIndex = index;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        state.draggedListIndex = null;
        DOM.imagesScrollContainer.querySelectorAll('.image-item-card').forEach(c => c.classList.remove('drag-over'));
      });

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        card.classList.add('drag-over');
      });

      card.addEventListener('dragleave', () => {
        card.classList.remove('drag-over');
      });

      card.addEventListener('drop', (e) => {
        e.preventDefault();
        card.classList.remove('drag-over');
        const fromIdx = state.draggedListIndex;
        const toIdx = index;
        if (fromIdx === null || fromIdx === toIdx) return;

        const [moved] = state.selectedImages.splice(fromIdx, 1);
        state.selectedImages.splice(toIdx, 0, moved);
        renderImageList();
        requestRenderPreview();
      });

      DOM.imagesScrollContainer.appendChild(card);
    });
  }

  function jumpToImageOnCanvas(item) {
    const pages = calculateLayoutPages();
    for (let pIdx = 0; pIdx < pages.length; pIdx++) {
      const found = pages[pIdx].items.find(placed => placed.item.id === item.id);
      if (found) {
        state.currentPage = pIdx + 1;
        state.selectedItemId = item.id;
        if (!item._custom) item._custom = getDefaultCustomSettings();
        syncSingleEditToolbar(item);
        requestRenderPreview();
        break;
      }
    }
  }

  function getPaperBaseDimensions() {
    const cfg = state.config;
    let baseW = 210;
    let baseH = 297;

    if (cfg.paperSize === 'custom') {
      baseW = cfg.customWidth || 210;
      baseH = cfg.customHeight || 297;
    } else if (PAPER_PRESETS[cfg.paperSize]) {
      baseW = PAPER_PRESETS[cfg.paperSize].width;
      baseH = PAPER_PRESETS[cfg.paperSize].height;
    }

    let orientation = cfg.orientation;
    if (orientation === 'landscape' && baseW < baseH) {
      return { widthMm: baseH, heightMm: baseW, orientation: 'landscape' };
    } else if (orientation === 'portrait' && baseW > baseH) {
      return { widthMm: baseH, heightMm: baseW, orientation: 'portrait' };
    }
    return { widthMm: baseW, heightMm: baseH, orientation };
  }

  function loadImageElement(item) {
    return new Promise((resolve) => {
      const key = item.filePath || item.thumbnailURL || item.fileURL || item.id;
      if (state.loadedImagesCache.has(key)) {
        return resolve(state.loadedImagesCache.get(key));
      }

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        state.loadedImagesCache.set(key, img);
        resolve(img);
      };
      img.onerror = () => resolve(null);

      if (item.filePath) {
        img.src = `file://${item.filePath}`;
      } else if (item.thumbnailURL) {
        img.src = item.thumbnailURL;
      } else if (item.fileURL) {
        img.src = item.fileURL;
      } else {
        resolve(null);
      }
    });
  }

  function getEffectiveItemAspect(item) {
    if (!item._custom) item._custom = getDefaultCustomSettings();
    const isRot = (item._custom.rotate % 180 !== 0);
    const w = isRot ? (item.height || 100) : (item.width || 100);
    const h = isRot ? (item.width || 100) : (item.height || 100);
    return { w, h, ratio: Math.max(0.15, Math.min(8, w / h)) };
  }

  /**
   * =========================================================================
   * CORE LAYOUT ENGINE:
   * - Strictly uses Border-to-Border distance for spacingH and spacingV
   * - Accounts for uniform 4-sided borderWidth (b on top, bottom, left, right)
   * =========================================================================
   */
  function calculateLayoutPages() {
    const count = state.selectedImages.length;
    const cfg = state.config;

    if (count === 0) {
      const base = getPaperBaseDimensions();
      return [{ widthMm: base.widthMm, heightMm: base.heightMm, orientation: base.orientation, items: [] }];
    }

    const headerReserveMm = cfg.headerText.trim() ? 8 : 0;
    const footerReserveMm = cfg.showPageNumber ? 7 : 0;
    const borderMm = Math.max(0, cfg.borderWidth || 0);
    const captionMm = cfg.showCaption ? 4.5 : 0;

    // -------------------------------------------------------------
    // Mode 1: Single Image Per Page
    // -------------------------------------------------------------
    if (cfg.mode === 'single') {
      const pages = [];
      for (let i = 0; i < count; i++) {
        const item = state.selectedImages[i];
        const { w: imgW, h: imgH, ratio: imgRatio } = getEffectiveItemAspect(item);

        if (cfg.paperSize === 'fit_image') {
          const dpi = cfg.dpi || 150;
          const innerW = Math.max(20, (imgW / dpi) * 25.4);
          const innerH = Math.max(20, (imgH / dpi) * 25.4);
          const pW = innerW + 2 * borderMm;
          const pH = innerH + 2 * borderMm + captionMm;
          const orient = (pW >= pH) ? 'landscape' : 'portrait';
          pages.push({
            widthMm: pW,
            heightMm: pH,
            orientation: orient,
            items: [{ item, cellX: 0, cellY: 0, cellW: pW, cellH: pH }]
          });
        } else {
          const base = getPaperBaseDimensions();
          let pW = base.widthMm;
          let pH = base.heightMm;
          let orient = base.orientation;
          if (cfg.orientation === 'auto') {
            orient = (imgRatio > 1) ? 'landscape' : 'portrait';
            if ((orient === 'landscape' && pW < pH) || (orient === 'portrait' && pW > pH)) {
              const tmp = pW; pW = pH; pH = tmp;
            }
          }

          const topM = cfg.marginTop + headerReserveMm;
          const botM = cfg.marginBottom + footerReserveMm;
          const availW = Math.max(10, pW - cfg.marginLeft - cfg.marginRight);
          const availH = Math.max(10, pH - topM - botM);

          pages.push({
            widthMm: pW,
            heightMm: pH,
            orientation: orient,
            items: [{ item, cellX: cfg.marginLeft, cellY: topM, cellW: availW, cellH: availH }]
          });
        }
      }
      return pages;
    }

    // -------------------------------------------------------------
    // Mode 2: Long Stitch (Vertical or Horizontal Seamless Strip)
    // -------------------------------------------------------------
    if (cfg.mode === 'stitch') {
      const isVert = cfg.stitchDirection !== 'horizontal';
      const baseSize = Math.max(50, cfg.stitchBaseSize || 210);
      const topM = cfg.marginTop + headerReserveMm;
      const botM = cfg.marginBottom + footerReserveMm;

      if (isVert) {
        const pW = baseSize;
        const availW = Math.max(10, pW - cfg.marginLeft - cfg.marginRight);
        const innerW = Math.max(4, availW - 2 * borderMm);
        let curY = topM;
        const pageItems = [];

        for (let i = 0; i < count; i++) {
          const item = state.selectedImages[i];
          const { ratio } = getEffectiveItemAspect(item);
          const innerH = innerW / ratio;
          const cellH = innerH + 2 * borderMm + captionMm;
          pageItems.push({
            item,
            cellX: cfg.marginLeft,
            cellY: curY,
            cellW: availW,
            cellH
          });
          curY += cellH + (i < count - 1 ? cfg.spacingV : 0);
        }

        const totalH = Math.max(40, curY + botM);
        return [{
          widthMm: pW,
          heightMm: totalH,
          orientation: totalH >= pW ? 'portrait' : 'landscape',
          items: pageItems
        }];
      } else {
        const pH = baseSize;
        const availH = Math.max(10, pH - topM - botM);
        const innerH = Math.max(4, availH - 2 * borderMm - captionMm);
        let curX = cfg.marginLeft;
        const pageItems = [];

        for (let i = 0; i < count; i++) {
          const item = state.selectedImages[i];
          const { ratio } = getEffectiveItemAspect(item);
          const innerW = innerH * ratio;
          const cellW = innerW + 2 * borderMm;
          pageItems.push({
            item,
            cellX: curX,
            cellY: topM,
            cellW,
            cellH: availH
          });
          curX += cellW + (i < count - 1 ? cfg.spacingH : 0);
        }

        const totalW = Math.max(40, curX + cfg.marginRight);
        return [{
          widthMm: totalW,
          heightMm: pH,
          orientation: totalW >= pH ? 'landscape' : 'portrait',
          items: pageItems
        }];
      }
    }

    // -------------------------------------------------------------
    // Mode 3: Uniform Grid (Cols x Rows)
    // -------------------------------------------------------------
    if (cfg.mode === 'grid') {
      const base = getPaperBaseDimensions();
      const pW = base.widthMm;
      const pH = base.heightMm;
      const perPage = cfg.cols * cfg.rows;
      const totalPages = Math.ceil(count / perPage);
      const pages = [];

      const topM = cfg.marginTop + headerReserveMm;
      const botM = cfg.marginBottom + footerReserveMm;
      const availW = Math.max(10, pW - cfg.marginLeft - cfg.marginRight);
      const availH = Math.max(10, pH - topM - botM);
      // Cell outer dimensions: spacingH and spacingV are strictly the gaps between outer border boxes
      const cellW = Math.max(2, (availW - (cfg.cols - 1) * cfg.spacingH) / cfg.cols);
      const cellH = Math.max(2, (availH - (cfg.rows - 1) * cfg.spacingV) / cfg.rows);

      for (let p = 0; p < totalPages; p++) {
        const pageItems = [];
        const start = p * perPage;
        const slice = state.selectedImages.slice(start, start + perPage);

        slice.forEach((item, idx) => {
          const col = idx % cfg.cols;
          const row = Math.floor(idx / cfg.cols);
          const cellX = cfg.marginLeft + col * (cellW + cfg.spacingH);
          const cellY = topM + row * (cellH + cfg.spacingV);

          pageItems.push({ item, cellX, cellY, cellW, cellH });
        });

        pages.push({
          widthMm: pW,
          heightMm: pH,
          orientation: base.orientation,
          items: pageItems
        });
      }
      return pages;
    }

    // -------------------------------------------------------------
    // Mode 4: Smart Justified Album Layout
    // -------------------------------------------------------------
    const base = getPaperBaseDimensions();
    const pW = base.widthMm;
    const pH = base.heightMm;
    const topM = cfg.marginTop + headerReserveMm;
    const botM = cfg.marginBottom + footerReserveMm;
    const availW = Math.max(10, pW - cfg.marginLeft - cfg.marginRight);
    const availH = Math.max(10, pH - topM - botM);

    const maxRowsPerPage = cfg.rowsPerPage || 4;

    if (cfg.rowDensity === 'fit_page') {
      // Smart Page Auto-Balance ("整页自适应均衡分配")
      // Partition items into balanced pages & optimal aspect-ratio rows per page
      const maxItemsPerPage = Math.max(6, maxRowsPerPage * 3);
      const pages = [];

      if (count <= Math.max(12, maxRowsPerPage * 4)) {
        const rowCounts = computeSmartBalancedRows(state.selectedImages, availW, availH, cfg);
        const pageRows = buildRowObjects(state.selectedImages, rowCounts, availW, borderMm, cfg.spacingH);
        pages.push(layoutBalancedPage(pageRows, pW, pH, base.orientation, topM, availW, availH, borderMm, captionMm, cfg));
      } else {
        const numPages = Math.ceil(count / maxItemsPerPage);
        const basePerPage = Math.floor(count / numPages);
        let remItems = count % numPages;
        let offset = 0;

        for (let p = 0; p < numPages; p++) {
          const take = basePerPage + (remItems > 0 ? 1 : 0);
          if (remItems > 0) remItems--;
          const pageSlice = state.selectedImages.slice(offset, offset + take);
          offset += take;

          const rowCounts = computeSmartBalancedRows(pageSlice, availW, availH, cfg);
          const pageRows = buildRowObjects(pageSlice, rowCounts, availW, borderMm, cfg.spacingH);
          pages.push(layoutBalancedPage(pageRows, pW, pH, base.orientation, topM, availW, availH, borderMm, captionMm, cfg));
        }
      }
      return pages;
    }

    // Other rhythm patterns
    let rowGroupCounts = [];
    if (cfg.rowDensity === 'fixed_1') {
      rowGroupCounts = new Array(count).fill(1);
    } else if (cfg.rowDensity === 'fixed_2') {
      rowGroupCounts = chunkCounts(count, 2);
    } else if (cfg.rowDensity === 'fixed_3') {
      rowGroupCounts = chunkCounts(count, 3);
    } else if (cfg.rowDensity === 'fixed_4') {
      rowGroupCounts = chunkCounts(count, 4);
    } else if (cfg.rowDensity === 'fixed_5') {
      rowGroupCounts = chunkCounts(count, 5);
    } else if (cfg.rowDensity === 'auto_34') {
      rowGroupCounts = generatePatternCounts(count, [3, 4, 3, 4]);
    } else if (cfg.rowDensity === 'auto_12') {
      rowGroupCounts = generatePatternCounts(count, [1, 2, 2, 1]);
    } else {
      rowGroupCounts = generatePatternCounts(count, [2, 3, 3, 2]);
    }

    const rows = buildRowObjects(state.selectedImages, rowGroupCounts, availW, borderMm, cfg.spacingH);
    const pages = [];
    let curPageRows = [];

    for (let r = 0; r < rows.length; r++) {
      curPageRows.push(rows[r]);
      if (curPageRows.length >= maxRowsPerPage || r === rows.length - 1) {
        pages.push(layoutBalancedPage(curPageRows, pW, pH, base.orientation, topM, availW, availH, borderMm, captionMm, cfg));
        curPageRows = [];
      }
    }

    return pages;
  }

  function buildRowObjects(itemsList, rowGroupCounts, availW, borderMm, spacingH) {
    const rows = [];
    let imgIdx = 0;
    for (const rowCount of rowGroupCounts) {
      const slice = itemsList.slice(imgIdx, imgIdx + rowCount);
      if (slice.length === 0) continue;
      const itemsWithRatio = slice.map(it => {
        const { ratio } = getEffectiveItemAspect(it);
        return { item: it, ratio };
      });

      const n = itemsWithRatio.length;
      const sumR = itemsWithRatio.reduce((acc, curr) => acc + curr.ratio, 0);
      // Available width for inner images after subtracting border-to-border spacingH and 2*borderMm per item
      const wInnerSum = Math.max(4, availW - (n - 1) * spacingH - 2 * n * borderMm);
      const naturalInnerH = wInnerSum / sumR;

      rows.push({
        items: itemsWithRatio,
        sumRatio: sumR,
        wInnerSum: wInnerSum,
        naturalInnerH: naturalInnerH
      });
      imgIdx += rowCount;
    }
    return rows;
  }

  /**
   * Smart Aspect-Ratio-Aware Balanced Row Partitioning ("整页自适应均衡分配")
   * Finds the most even row distribution whose natural height best matches the page height.
   */
  function computeSmartBalancedRows(itemsSlice, availW, availH, cfg) {
    const K = itemsSlice.length;
    if (K <= 1) return [K];

    const ratios = itemsSlice.map(it => getEffectiveItemAspect(it).ratio);
    const borderMm = Math.max(0, cfg.borderWidth || 0);
    const captionMm = cfg.showCaption ? 4.5 : 0;
    const spacingH = cfg.spacingH || 0;
    const spacingV = cfg.spacingV || 0;

    function rowNaturalOuterH(startIdx, len) {
      let sumR = 0;
      for (let i = startIdx; i < startIdx + len; i++) sumR += ratios[i];
      const wInner = Math.max(4, availW - (len - 1) * spacingH - 2 * len * borderMm);
      return (wInner / sumR) + 2 * borderMm + captionMm;
    }

    if (K === 2) {
      const h1 = rowNaturalOuterH(0, 2);
      const h2 = rowNaturalOuterH(0, 1) + rowNaturalOuterH(1, 1) + spacingV;
      return Math.abs(h1 - availH) <= Math.abs(h2 - availH) ? [2] : [1, 1];
    }

    const minRows = Math.max(1, Math.ceil(K / 5));
    const maxRows = Math.min(K, Math.max(4, cfg.rowsPerPage || 4));
    let bestCounts = null;
    let bestScore = Infinity;

    for (let M = minRows; M <= maxRows; M++) {
      // For M rows and K items, strictly balanced row sizes are floor(K/M) and ceil(K/M)
      const minLen = Math.max(1, Math.floor(K / M));
      const maxLen = Math.ceil(K / M);

      // DP to find the best order of minLen and maxLen rows matching image aspect ratios
      // dp[r][i] = { cost, prevIdx, totalH }
      const dp = Array.from({ length: M + 1 }, () => new Array(K + 1).fill(null));
      dp[0][0] = { heightSum: 0, heights: [] };

      for (let r = 1; r <= M; r++) {
        for (let i = r * minLen; i <= Math.min(K, r * maxLen); i++) {
          let bestState = null;
          for (let len = minLen; len <= maxLen; len++) {
            const prev = i - len;
            if (prev < 0 || !dp[r - 1][prev]) continue;
            const rh = rowNaturalOuterH(prev, len);
            const candHeights = [...dp[r - 1][prev].heights, rh];
            const candSum = dp[r - 1][prev].heightSum + rh;

            if (!bestState) {
              bestState = { heightSum: candSum, heights: candHeights, prevIdx: prev, len };
            } else {
              // Prefer smaller variance among row heights
              const mean1 = candSum / r;
              const var1 = candHeights.reduce((a, h) => a + (h - mean1) ** 2, 0);
              const mean2 = bestState.heightSum / r;
              const var2 = bestState.heights.reduce((a, h) => a + (h - mean2) ** 2, 0);
              if (var1 < var2) {
                bestState = { heightSum: candSum, heights: candHeights, prevIdx: prev, len };
              }
            }
          }
          dp[r][i] = bestState;
        }
      }

      const finalState = dp[M][K];
      if (!finalState) continue;

      const totalPageH = finalState.heightSum + (M - 1) * spacingV;
      // Score measures how close natural height is to availH + row height uniformity
      const heightDiffRatio = Math.abs(totalPageH - availH) / availH;
      const meanH = finalState.heightSum / M;
      const stdH = Math.sqrt(finalState.heights.reduce((a, h) => a + (h - meanH) ** 2, 0) / M) / meanH;
      const score = heightDiffRatio + stdH * 0.25;

      if (score < bestScore) {
        bestScore = score;
        const counts = [];
        let curI = K;
        for (let r = M; r >= 1; r--) {
          const st = dp[r][curI];
          counts.unshift(st.len);
          curI = st.prevIdx;
        }
        bestCounts = counts;
      }
    }

    return bestCounts || generatePatternCounts(K, [2, 3, 3, 2]);
  }

  function chunkCounts(total, chunkSize) {
    const list = [];
    let rem = total;
    while (rem > 0) {
      const take = Math.min(rem, chunkSize);
      list.push(take);
      rem -= take;
    }
    return list;
  }

  function generatePatternCounts(total, pattern) {
    const list = [];
    let rem = total;
    let pIdx = 0;
    while (rem > 0) {
      let desired = pattern[pIdx % pattern.length];
      if (rem < desired) desired = rem;
      if (rem - desired === 1 && desired > 2) {
        desired--;
      }
      list.push(desired);
      rem -= desired;
      pIdx++;
    }
    return list;
  }

  /**
   * Layout rows onto a page with exact border-to-border spacingH & spacingV
   * and uniform 4-sided borderWidth (borderMm).
   */
  function layoutBalancedPage(pageRows, pW, pH, orient, topM, availW, availH, borderMm, captionMm, cfg) {
    const pageItems = [];
    const numRows = pageRows.length;
    if (numRows === 0) {
      return { widthMm: pW, heightMm: pH, orientation: orient, items: [] };
    }

    const totalSpacingV = (numRows - 1) * cfg.spacingV;
    const rowFixedV = 2 * borderMm + captionMm;
    const totalFixedV = totalSpacingV + numRows * rowFixedV;
    const netInnerAvailH = Math.max(8, availH - totalFixedV);

    const sumNaturalInnerH = pageRows.reduce((acc, r) => acc + r.naturalInnerH, 0);

    if (cfg.pageFitMode === 'fit_height') {
      // Fill full availW and full availH; border-to-border gaps are strictly spacingH and spacingV
      const vScale = netInnerAvailH / sumNaturalInnerH;
      let curY = topM;

      for (let r = 0; r < numRows; r++) {
        const rowData = pageRows[r];
        const items = rowData.items;
        const n = items.length;
        const rowInnerH = rowData.naturalInnerH * vScale;
        const rowOuterH = rowInnerH + rowFixedV;
        let curX = cfg.marginLeft;

        for (let i = 0; i < n; i++) {
          const it = items[i];
          const itemInnerW = (it.ratio / rowData.sumRatio) * rowData.wInnerSum;
          const cellW = itemInnerW + 2 * borderMm;

          pageItems.push({
            item: it.item,
            cellX: curX,
            cellY: curY,
            cellW: cellW,
            cellH: rowOuterH
          });

          curX += cellW + cfg.spacingH;
        }

        curY += rowOuterH + cfg.spacingV;
      }
    } else {
      // 'natural' mode: keep exact aspect ratio (0% crop) while preserving exact border-to-border spacingH & spacingV
      let rowW = availW;
      if (sumNaturalInnerH > netInnerAvailH) {
        // Solve exact rowW <= availW so sum(rowInnerH(rowW)) === netInnerAvailH
        let A = 0;
        let B = 0;
        for (let r = 0; r < numRows; r++) {
          const n = pageRows[r].items.length;
          const sumR = pageRows[r].sumRatio;
          A += 1 / sumR;
          B += ((n - 1) * cfg.spacingH + 2 * n * borderMm) / sumR;
        }
        rowW = Math.max(20, Math.min(availW, (netInnerAvailH + B) / A));
      }

      const computedRows = pageRows.map((rowData) => {
        const n = rowData.items.length;
        const wInnerSum = Math.max(4, rowW - (n - 1) * cfg.spacingH - 2 * n * borderMm);
        const rowInnerH = wInnerSum / rowData.sumRatio;
        const rowOuterH = rowInnerH + rowFixedV;
        return { rowData, wInnerSum, rowInnerH, rowOuterH };
      });

      const totalPageRowsOuterH = computedRows.reduce((acc, cr) => acc + cr.rowOuterH, 0) + totalSpacingV;
      const startX = cfg.marginLeft + Math.max(0, (availW - rowW) / 2);
      let curY = topM + Math.max(0, (availH - totalPageRowsOuterH) / 2);

      for (let r = 0; r < numRows; r++) {
        const { rowData, wInnerSum, rowOuterH } = computedRows[r];
        const items = rowData.items;
        const n = items.length;
        let curX = startX;

        for (let i = 0; i < n; i++) {
          const it = items[i];
          const itemInnerW = (it.ratio / rowData.sumRatio) * wInnerSum;
          const cellW = itemInnerW + 2 * borderMm;

          pageItems.push({
            item: it.item,
            cellX: curX,
            cellY: curY,
            cellW: cellW,
            cellH: rowOuterH
          });

          curX += cellW + cfg.spacingH;
        }

        curY += rowOuterH + cfg.spacingV;
      }
    }

    return {
      widthMm: pW,
      heightMm: pH,
      orientation: orient,
      items: pageItems
    };
  }

  /**
   * =========================================================================
   * UNIFIED PAGE RENDERER (Used by both Live Preview & High-Res Export)
   * =========================================================================
   */
  function renderPageToContext(ctx, curPage, pageIndex, totalPages, scaleFactor, isPreview) {
    const cfg = state.config;
    const pageW = curPage.widthMm * scaleFactor;
    const pageH = curPage.heightMm * scaleFactor;

    ctx.clearRect(0, 0, pageW, pageH);
    if (cfg.bgColor && cfg.bgColor !== 'transparent') {
      ctx.fillStyle = cfg.bgColor;
      ctx.fillRect(0, 0, pageW, pageH);
    } else if (isPreview) {
      drawCheckerboard(ctx, pageW, pageH);
    }

    const isDarkBg = isColorDark(cfg.bgColor);
    const decoTextColor = isDarkBg ? 'rgba(255, 255, 255, 0.78)' : 'rgba(15, 23, 42, 0.72)';

    // Page Header Title
    if (cfg.headerText && cfg.headerText.trim()) {
      ctx.save();
      const fontSize = Math.max(8, 4.2 * scaleFactor);
      ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;
      ctx.fillStyle = decoTextColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const headerY = (cfg.marginTop * 0.45 + 1.5) * scaleFactor;
      ctx.fillText(cfg.headerText.trim(), pageW / 2, headerY);
      ctx.restore();
    }

    // Draw Each Placed Image Cell
    for (const placed of curPage.items) {
      const it = placed.item;
      const cacheKey = it.filePath || it.thumbnailURL || it.fileURL || it.id;
      const imgEl = state.loadedImagesCache.get(cacheKey);

      const pxCellX = placed.cellX * scaleFactor;
      const pxCellY = placed.cellY * scaleFactor;
      const pxCellW = placed.cellW * scaleFactor;
      const pxCellH = placed.cellH * scaleFactor;

      if (imgEl && imgEl.complete) {
        drawItemInCell(ctx, imgEl, it, pxCellX, pxCellY, pxCellW, pxCellH, scaleFactor, decoTextColor);
      } else if (isPreview) {
        loadImageElement(it).then(loadedImg => {
          if (loadedImg) requestRenderPreview();
        });
      }
    }

    // Page Number Footer
    if (cfg.showPageNumber) {
      ctx.save();
      const fontSize = Math.max(7, 3.2 * scaleFactor);
      ctx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.fillStyle = decoTextColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const footerY = pageH - Math.max(2 * scaleFactor, (cfg.marginBottom * 0.35) * scaleFactor);
      ctx.fillText(`${pageIndex + 1} / ${totalPages}`, pageW / 2, footerY);
      ctx.restore();
    }
  }

  function isColorDark(hex) {
    if (!hex || hex === 'transparent') return false;
    const clean = hex.replace('#', '');
    if (clean.length !== 6) return false;
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum < 0.45;
  }

  function appendRoundedRectSubpath(ctx, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    if (radius <= 0.1) {
      ctx.rect(x, y, w, h);
    } else {
      ctx.moveTo(x + radius, y);
      ctx.arcTo(x + w, y, x + w, y + h, radius);
      ctx.arcTo(x + w, y + h, x, y + h, radius);
      ctx.arcTo(x, y + h, x, y, radius);
      ctx.arcTo(x, y, x + w, y, radius);
      ctx.closePath();
    }
  }

  function traceRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    appendRoundedRectSubpath(ctx, x, y, w, h, r);
  }

  /**
   * Draw a single image cell with:
   *  - Outer frame (frameX, frameY, frameW, frameH): defines the outer edge of the border
   *  - Uniform 4-sided border thickness (borderPx on top, bottom, left, right)
   *  - Inner image box (innerX, innerY, innerW, innerH): strictly inset by borderPx on all 4 sides
   */
  function drawItemInCell(ctx, imgEl, item, cellX, cellY, cellW, cellH, scaleFactor, decoTextColor) {
    const cfg = state.config;
    const custom = item._custom || getDefaultCustomSettings();
    const fitMode = getEffectiveItemFitMode(item);

    const captionReservePx = cfg.showCaption ? Math.min(cellH * 0.22, 4.5 * scaleFactor) : 0;
    const outerBoxW = Math.max(2, cellW);
    const outerBoxH = Math.max(2, cellH - captionReservePx);

    // Apply global cell scale around the center of the cell
    const cellScale = cfg.scale || 1.0;
    let frameW = outerBoxW * cellScale;
    let frameH = outerBoxH * cellScale;
    let frameX = cellX + (outerBoxW - frameW) / 2;
    let frameY = cellY + (outerBoxH - frameH) / 2;

    const rawBorderPx = Math.max(0, cfg.borderWidth || 0) * scaleFactor;
    const borderPx = Math.min(rawBorderPx, Math.min(frameW, frameH) * 0.45);
    const radiusPx = (cfg.borderRadius || 0) * scaleFactor;

    const isRotated = (custom.rotate % 180 !== 0);
    const origW = isRotated ? imgEl.naturalHeight : imgEl.naturalWidth;
    const origH = isRotated ? imgEl.naturalWidth : imgEl.naturalHeight;
    const imgRatio = origW / origH;

    // Inner image viewport (strictly inset by borderPx on top, bottom, left, right)
    const innerX = frameX + borderPx;
    const innerY = frameY + borderPx;
    const innerW = Math.max(1, frameW - 2 * borderPx);
    const innerH = Math.max(1, frameH - 2 * borderPx);
    const innerRadiusPx = Math.max(0, radiusPx - borderPx);

    // 1. Optional Drop Shadow around the outer border frame
    if (cfg.shadow) {
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.24)';
      ctx.shadowBlur = 3.2 * scaleFactor;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 1.2 * scaleFactor;
      traceRoundedRect(ctx, frameX, frameY, frameW, frameH, radiusPx);
      ctx.fillStyle = borderPx > 0
        ? (cfg.borderColor || '#334155')
        : ((cfg.bgColor && cfg.bgColor !== 'transparent') ? cfg.bgColor : '#ffffff');
      ctx.fill();
      ctx.restore();
    }

    // 2. Clip & Draw Image inside (innerX, innerY, innerW, innerH)
    ctx.save();
    traceRoundedRect(ctx, innerX, innerY, innerW, innerH, innerRadiusPx);
    ctx.clip();

    if (cfg.bgColor && cfg.bgColor !== 'transparent') {
      ctx.fillStyle = cfg.bgColor;
      ctx.fillRect(innerX, innerY, innerW, innerH);
    }

    const innerRatio = innerW / innerH;
    let baseW, baseH;
    if (fitMode === 'cover') {
      if (imgRatio >= innerRatio) {
        baseH = innerH;
        baseW = innerH * imgRatio;
      } else {
        baseW = innerW;
        baseH = innerW / imgRatio;
      }
    } else {
      if (imgRatio >= innerRatio) {
        baseW = innerW;
        baseH = innerW / imgRatio;
      } else {
        baseH = innerH;
        baseW = innerH * imgRatio;
      }
    }

    const itemScale = custom.scale || 1.0;
    const finalW = baseW * itemScale;
    const finalH = baseH * itemScale;

    const panOffsetX = (custom.panX || 0) * innerW;
    const panOffsetY = (custom.panY || 0) * innerH;

    const centerX = innerX + innerW / 2 + panOffsetX;
    const centerY = innerY + innerH / 2 + panOffsetY;

    ctx.translate(centerX, centerY);
    if (custom.rotate) {
      ctx.rotate((custom.rotate * Math.PI) / 180);
    }
    if (custom.flipH) {
      ctx.scale(-1, 1);
    }

    const drawW = isRotated ? finalH : finalW;
    const drawH = isRotated ? finalW : finalH;

    ctx.drawImage(imgEl, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    // 3. Draw Uniform 4-Sided Border Ring (outer frame minus inner image box using evenodd fill)
    if (borderPx > 0) {
      ctx.save();
      ctx.beginPath();
      appendRoundedRectSubpath(ctx, frameX, frameY, frameW, frameH, radiusPx);
      appendRoundedRectSubpath(ctx, innerX, innerY, innerW, innerH, innerRadiusPx);
      ctx.fillStyle = cfg.borderColor || '#334155';
      ctx.fill('evenodd');
      ctx.restore();
    }

    // 4. Optional Image Caption below the bottom border
    if (cfg.showCaption && captionReservePx > 4) {
      ctx.save();
      const fontSize = Math.max(7, 2.7 * scaleFactor);
      ctx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;
      ctx.fillStyle = decoTextColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const cleanName = (item.name || '').replace(/\.[^/.]+$/, '');
      const maxChars = Math.max(6, Math.floor(cellW / (fontSize * 0.58)));
      const label = cleanName.length > maxChars ? cleanName.slice(0, maxChars - 1) + '…' : cleanName;
      ctx.fillText(label, cellX + cellW / 2, cellY + outerBoxH + captionReservePx / 2);
      ctx.restore();
    }
  }

  function drawCheckerboard(ctx, w, h) {
    const size = 14;
    for (let y = 0; y < h; y += size) {
      for (let x = 0; x < w; x += size) {
        ctx.fillStyle = ((Math.floor(x / size) + Math.floor(y / size)) % 2 === 0) ? '#f1f5f9' : '#e2e8f0';
        ctx.fillRect(x, y, size, size);
      }
    }
  }

  /**
   * =========================================================================
   * LIVE PREVIEW RENDERING (Single Page & Multi-Page Overview)
   * =========================================================================
   */
  function renderPreview() {
    const pages = calculateLayoutPages();
    const totalPages = pages.length;

    if (state.currentPage > totalPages) state.currentPage = totalPages;
    if (state.currentPage < 1) state.currentPage = 1;

    updatePageInfo(pages);
    syncExportUI();

    if (state.viewMode === 'overview') {
      renderOverviewGrid(pages);
      return;
    }

    const curPage = pages[state.currentPage - 1];
    if (!curPage) return;

    const paperAspect = curPage.widthMm / curPage.heightMm;
    const viewport = DOM.previewViewport;
    const pad = 44;
    const availW = Math.max(140, viewport.clientWidth - pad);
    const availH = Math.max(140, viewport.clientHeight - pad);

    let displayW, displayH;
    if (availW / availH >= paperAspect) {
      displayH = availH;
      displayW = displayH * paperAspect;
    } else {
      displayW = availW;
      displayH = displayW / paperAspect;
    }

    displayW = Math.round(displayW * state.zoomLevel);
    displayH = Math.round(displayH * state.zoomLevel);

    DOM.pdfSheet.style.width = `${displayW}px`;
    DOM.pdfSheet.style.height = `${displayH}px`;
    DOM.zoomPercentText.textContent = `${Math.round(state.zoomLevel * 100)}%`;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const canvas = DOM.previewCanvas;
    canvas.width = Math.round(displayW * dpr);
    canvas.height = Math.round(displayH * dpr);

    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    const scaleFactor = displayW / curPage.widthMm;
    renderPageToContext(ctx, curPage, state.currentPage - 1, totalPages, scaleFactor, true);

    const selectedPlaced = curPage.items.find(p => p.item.id === state.selectedItemId);
    if (selectedPlaced && state.selectedImages.length > 0) {
      DOM.imageSelectionOverlay.style.left = `${selectedPlaced.cellX * scaleFactor}px`;
      DOM.imageSelectionOverlay.style.top = `${selectedPlaced.cellY * scaleFactor}px`;
      DOM.imageSelectionOverlay.style.width = `${selectedPlaced.cellW * scaleFactor}px`;
      DOM.imageSelectionOverlay.style.height = `${selectedPlaced.cellH * scaleFactor}px`;
      DOM.imageSelectionOverlay.classList.add('active');
    } else {
      DOM.imageSelectionOverlay.classList.remove('active');
    }
  }

  function renderOverviewGrid(pages) {
    DOM.overviewGridContainer.innerHTML = '';
    const totalPages = pages.length;
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    pages.forEach((pData, idx) => {
      const card = document.createElement('div');
      card.className = `overview-page-card ${idx + 1 === state.currentPage ? 'active' : ''}`;

      const wrap = document.createElement('div');
      wrap.className = 'overview-canvas-wrap';

      const c = document.createElement('canvas');
      const maxThumbSide = 200;
      const aspect = pData.widthMm / pData.heightMm;
      let tw, th;
      if (aspect >= 1) {
        tw = maxThumbSide;
        th = Math.max(40, Math.round(maxThumbSide / aspect));
      } else {
        th = maxThumbSide;
        tw = Math.max(40, Math.round(maxThumbSide * aspect));
      }

      c.style.width = `${tw}px`;
      c.style.height = `${th}px`;
      c.width = Math.round(tw * dpr);
      c.height = Math.round(th * dpr);

      const cx = c.getContext('2d');
      cx.scale(dpr, dpr);
      renderPageToContext(cx, pData, idx, totalPages, tw / pData.widthMm, true);

      const label = document.createElement('div');
      label.className = 'overview-page-label';
      label.textContent = I18N.t('ui.page_info', { current: idx + 1, total: totalPages });

      wrap.appendChild(c);
      card.appendChild(wrap);
      card.appendChild(label);

      card.addEventListener('click', () => {
        state.currentPage = idx + 1;
        DOM.btnViewSingle.click();
      });

      DOM.overviewGridContainer.appendChild(card);
    });
  }

  function updatePageInfo(pagesOpt) {
    const pages = pagesOpt || calculateLayoutPages();
    const total = pages.length;
    const curPage = pages[state.currentPage - 1] || pages[0];

    DOM.pageIndicatorText.textContent = I18N.t('ui.page_info', { current: state.currentPage, total });
    DOM.btnPrevPage.disabled = state.currentPage <= 1;
    DOM.btnNextPage.disabled = state.currentPage >= total;

    if (curPage) {
      DOM.paperInfoBadge.textContent = `${Math.round(curPage.widthMm)} × ${Math.round(curPage.heightMm)} mm`;
    }

    DOM.pageThumbStrip.innerHTML = '';
    for (let i = 1; i <= total; i++) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = `page-pill ${i === state.currentPage ? 'active' : ''}`;
      pill.textContent = `P${i} (${pages[i - 1].items.length})`;
      pill.addEventListener('click', () => {
        state.currentPage = i;
        if (state.viewMode !== 'single') {
          DOM.btnViewSingle.click();
        } else {
          closeSingleEdit();
          requestRenderPreview();
        }
      });
      DOM.pageThumbStrip.appendChild(pill);
    }
  }

  /**
   * =========================================================================
   * DUAL EXPORT ENGINE: PDF (.pdf) & HIGH-RES IMAGES (.png / .jpg / .webp)
   * =========================================================================
   */
  async function renderOffscreenPageCanvas(curPage, pageIndex, totalPages, dpi) {
    let pxPerMm = dpi / 25.4;
    let offW = Math.max(1, Math.round(curPage.widthMm * pxPerMm));
    let offH = Math.max(1, Math.round(curPage.heightMm * pxPerMm));

    if (offW > MAX_CANVAS_DIMENSION || offH > MAX_CANVAS_DIMENSION) {
      const clampRatio = MAX_CANVAS_DIMENSION / Math.max(offW, offH);
      offW = Math.max(1, Math.round(offW * clampRatio));
      offH = Math.max(1, Math.round(offH * clampRatio));
      pxPerMm = offW / curPage.widthMm;
    }

    for (const placed of curPage.items) {
      await loadImageElement(placed.item);
    }

    const offCanvas = document.createElement('canvas');
    offCanvas.width = offW;
    offCanvas.height = offH;
    const offCtx = offCanvas.getContext('2d');

    if (state.config.bgColor === 'transparent' && (state.config.exportFormat === 'jpeg' || state.config.exportFormat === 'pdf')) {
      offCtx.fillStyle = '#ffffff';
      offCtx.fillRect(0, 0, offW, offH);
    }

    renderPageToContext(offCtx, curPage, pageIndex, totalPages, pxPerMm, false);
    return offCanvas;
  }

  function getMimeAndQuality(format, qualitySetting) {
    const qMap = { lossless: 1.0, png: 1.0, high: 0.95, medium: 0.85, low: 0.72 };
    const q = qMap[qualitySetting] ?? 0.92;
    if (format === 'png') return { mime: 'image/png', ext: 'png', quality: undefined };
    if (format === 'webp') return { mime: 'image/webp', ext: 'webp', quality: q };
    return { mime: 'image/jpeg', ext: 'jpg', quality: q };
  }

  function dataURLToBuffer(dataUrl) {
    const base64 = dataUrl.split(',')[1];
    return Buffer.from(base64, 'base64');
  }

  async function executeExport() {
    if (state.selectedImages.length === 0 || state.isExporting) return;

    const fmt = state.config.exportFormat;
    if (fmt === 'pdf') {
      await exportAsPdf();
    } else {
      await exportAsImages(fmt);
    }
  }

  async function exportAsPdf() {
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const defaultFileName = `Eagle_Album_${dateStr}.pdf`;
    let savePath = '';

    if (typeof eagle !== 'undefined' && eagle.dialog && eagle.dialog.showSaveDialog) {
      const dialogRes = await eagle.dialog.showSaveDialog({
        title: I18N.t('ui.export_pdf'),
        defaultPath: defaultFileName,
        filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
      });
      if (dialogRes.canceled || !dialogRes.filePath) return;
      savePath = dialogRes.filePath;
    }

    state.isExporting = true;
    DOM.progressModal.classList.add('active');
    DOM.progressFill.style.width = '0%';

    try {
      const pages = calculateLayoutPages();
      const totalPages = pages.length;
      const cfg = state.config;
      const { jsPDF } = window.jspdf;
      let pdfDoc = null;

      for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
        const curPage = pages[pageIdx];
        const percent = Math.round(((pageIdx + 1) / totalPages) * 100);
        DOM.progressFill.style.width = `${percent}%`;
        DOM.progressText.textContent = I18N.t('ui.page_progress', { current: pageIdx + 1, total: totalPages });

        const isLandscape = curPage.widthMm > curPage.heightMm;

        if (pageIdx === 0) {
          pdfDoc = new jsPDF({
            unit: 'mm',
            format: [curPage.widthMm, curPage.heightMm],
            orientation: isLandscape ? 'landscape' : 'portrait',
            compress: true
          });
        } else {
          pdfDoc.addPage([curPage.widthMm, curPage.heightMm], isLandscape ? 'landscape' : 'portrait');
        }

        const pageCanvas = await renderOffscreenPageCanvas(curPage, pageIdx, totalPages, cfg.dpi || 150);
        const usePng = cfg.quality === 'png';
        const q = cfg.quality === 'high' ? 0.95 : (cfg.quality === 'medium' ? 0.85 : 0.72);
        const imgData = pageCanvas.toDataURL(usePng ? 'image/png' : 'image/jpeg', usePng ? undefined : q);

        pdfDoc.addImage(imgData, usePng ? 'PNG' : 'JPEG', 0, 0, curPage.widthMm, curPage.heightMm, undefined, 'FAST');
        await new Promise(r => setTimeout(r, 12));
      }

      if (savePath && typeof require !== 'undefined') {
        const fs = require('fs');
        const pdfArrayBuffer = pdfDoc.output('arraybuffer');
        fs.writeFileSync(savePath, Buffer.from(pdfArrayBuffer));
      } else {
        pdfDoc.save(savePath || defaultFileName);
      }

      showExportSuccessModal(savePath || defaultFileName, I18N.t('ui.export_success'));
    } catch (err) {
      handleExportError(err);
    } finally {
      state.isExporting = false;
    }
  }

  async function exportAsImages(format) {
    const pages = calculateLayoutPages();
    const totalPages = pages.length;
    const cfg = state.config;
    const { mime, ext, quality } = getMimeAndQuality(format, cfg.quality);

    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const defaultFileName = `Eagle_Layout_${dateStr}.${ext}`;
    let savePath = '';

    if (typeof eagle !== 'undefined' && eagle.dialog && eagle.dialog.showSaveDialog) {
      const dialogRes = await eagle.dialog.showSaveDialog({
        title: `${I18N.t('ui.export_img')} (${ext.toUpperCase()})`,
        defaultPath: defaultFileName,
        filters: [{ name: `${ext.toUpperCase()} Image`, extensions: [ext] }]
      });
      if (dialogRes.canceled || !dialogRes.filePath) return;
      savePath = dialogRes.filePath;
    }

    state.isExporting = true;
    DOM.progressModal.classList.add('active');
    DOM.progressFill.style.width = '0%';

    try {
      const dpi = cfg.dpi || 150;
      const shouldMerge = totalPages > 1 && cfg.imageExportMode === 'merge';

      if (totalPages === 1 || shouldMerge) {
        const pageCanvases = [];
        for (let i = 0; i < totalPages; i++) {
          const percent = Math.round(((i + 1) / totalPages) * 90);
          DOM.progressFill.style.width = `${percent}%`;
          DOM.progressText.textContent = I18N.t('ui.page_progress', { current: i + 1, total: totalPages });
          const c = await renderOffscreenPageCanvas(pages[i], i, totalPages, dpi);
          pageCanvases.push(c);
          await new Promise(r => setTimeout(r, 10));
        }

        let finalCanvas = pageCanvases[0];
        if (pageCanvases.length > 1) {
          const maxW = Math.max(...pageCanvases.map(c => c.width));
          const sumH = pageCanvases.reduce((acc, c) => acc + c.height, 0);
          let scaleDown = 1;
          if (sumH > MAX_CANVAS_DIMENSION) {
            scaleDown = MAX_CANVAS_DIMENSION / sumH;
          }

          finalCanvas = document.createElement('canvas');
          finalCanvas.width = Math.round(maxW * scaleDown);
          finalCanvas.height = Math.round(sumH * scaleDown);
          const fCtx = finalCanvas.getContext('2d');

          if (cfg.bgColor && cfg.bgColor !== 'transparent') {
            fCtx.fillStyle = cfg.bgColor;
            fCtx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
          } else if (format === 'jpeg') {
            fCtx.fillStyle = '#ffffff';
            fCtx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
          }

          let curY = 0;
          for (const pc of pageCanvases) {
            const dw = Math.round(pc.width * scaleDown);
            const dh = Math.round(pc.height * scaleDown);
            const dx = Math.round((finalCanvas.width - dw) / 2);
            fCtx.drawImage(pc, dx, curY, dw, dh);
            curY += dh;
          }
        }

        DOM.progressFill.style.width = '100%';
        const dataUrl = finalCanvas.toDataURL(mime, quality);

        if (savePath && typeof require !== 'undefined') {
          const fs = require('fs');
          fs.writeFileSync(savePath, dataURLToBuffer(dataUrl));
        } else {
          triggerBrowserDownload(dataUrl, savePath || defaultFileName);
        }

        showExportSuccessModal(savePath || defaultFileName, I18N.t('ui.export_success'));
      } else {
        let firstSavedPath = '';
        const hasNodeFs = savePath && typeof require !== 'undefined';
        const fs = hasNodeFs ? require('fs') : null;
        const pathMod = hasNodeFs ? require('path') : null;

        for (let i = 0; i < totalPages; i++) {
          const percent = Math.round(((i + 1) / totalPages) * 100);
          DOM.progressFill.style.width = `${percent}%`;
          DOM.progressText.textContent = I18N.t('ui.page_progress', { current: i + 1, total: totalPages });

          const pageCanvas = await renderOffscreenPageCanvas(pages[i], i, totalPages, dpi);
          const dataUrl = pageCanvas.toDataURL(mime, quality);
          const pageSuffix = `_${String(i + 1).padStart(2, '0')}`;

          if (hasNodeFs) {
            const parsed = pathMod.parse(savePath);
            const targetFile = pathMod.join(parsed.dir, `${parsed.name}${pageSuffix}${parsed.ext || '.' + ext}`);
            fs.writeFileSync(targetFile, dataURLToBuffer(dataUrl));
            if (i === 0) firstSavedPath = targetFile;
          } else {
            const fName = `Eagle_Layout_${dateStr}${pageSuffix}.${ext}`;
            triggerBrowserDownload(dataUrl, fName);
            if (i === 0) firstSavedPath = fName;
          }

          await new Promise(r => setTimeout(r, 12));
        }

        showExportSuccessModal(
          firstSavedPath || savePath || defaultFileName,
          I18N.t('ui.export_multi_img_success', { count: totalPages })
        );
      }
    } catch (err) {
      handleExportError(err);
    } finally {
      state.isExporting = false;
    }
  }

  function triggerBrowserDownload(dataUrl, fileName) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function showExportSuccessModal(targetPath, titleText) {
    DOM.progressModal.classList.remove('active');
    DOM.successModalTitle.textContent = titleText || I18N.t('ui.export_success');
    DOM.successPathText.textContent = targetPath;
    DOM.successModal.classList.add('active');

    DOM.btnOpenFile.onclick = () => {
      if (typeof eagle !== 'undefined' && eagle.shell && targetPath) {
        eagle.shell.openPath(targetPath);
      }
    };

    DOM.btnRevealFolder.onclick = () => {
      if (typeof eagle !== 'undefined' && eagle.shell && targetPath) {
        eagle.shell.showItemInFolder(targetPath);
      }
    };
  }

  function handleExportError(err) {
    console.error('Export error:', err);
    DOM.progressModal.classList.remove('active');
    if (typeof eagle !== 'undefined' && eagle.dialog && eagle.dialog.showErrorBox) {
      eagle.dialog.showErrorBox(I18N.t('ui.export_failed'), err.message || String(err));
    } else {
      alert(`${I18N.t('ui.export_failed')}: ${err.message || String(err)}`);
    }
  }

  async function loadMockImages() {
    const mockConfigs = [
      { color: '#3b82f6', w: 900, h: 600, title: '01 Mountain Lake' },
      { color: '#10b981', w: 650, h: 650, title: '02 Forest Path' },
      { color: '#f59e0b', w: 540, h: 800, title: '03 Golden Sunset' },
      { color: '#8b5cf6', w: 640, h: 640, title: '04 Neon Street' },
      { color: '#ec4899', w: 500, h: 750, title: '05 Portrait Studio' },
      { color: '#06b6d4', w: 840, h: 560, title: '06 Ocean Coast' },
      { color: '#f97316', w: 520, h: 720, title: '07 Autumn Leaves' },
      { color: '#6366f1', w: 780, h: 520, title: '08 Starry Night' },
      { color: '#14b8a6', w: 700, h: 540, title: '09 Minimal Arch' },
      { color: '#e11d48', w: 540, h: 780, title: '10 Editorial Cover' }
    ];

    const mockList = mockConfigs.map((cfg, idx) => {
      const c = document.createElement('canvas');
      c.width = cfg.w;
      c.height = cfg.h;
      const cx = c.getContext('2d');
      cx.fillStyle = cfg.color;
      cx.fillRect(0, 0, c.width, c.height);
      cx.fillStyle = 'rgba(255,255,255,0.18)';
      cx.beginPath();
      cx.arc(c.width * 0.8, c.height * 0.25, Math.min(c.width, c.height) * 0.25, 0, Math.PI * 2);
      cx.fill();
      cx.fillStyle = '#ffffff';
      cx.font = 'bold 34px -apple-system, sans-serif';
      cx.textAlign = 'center';
      cx.fillText(cfg.title, c.width / 2, c.height / 2);
      cx.font = '20px -apple-system, sans-serif';
      cx.fillText(`${cfg.w} × ${cfg.h}`, c.width / 2, c.height / 2 + 40);

      const dataUrl = c.toDataURL('image/jpeg', 0.88);
      return {
        id: `mock_${idx}`,
        name: `${cfg.title}.jpg`,
        ext: 'jpg',
        width: cfg.w,
        height: cfg.h,
        thumbnailURL: dataUrl,
        fileURL: dataUrl,
        _custom: getDefaultCustomSettings()
      };
    });

    state.images = mockList;
    applySorting();
    renderImageList();
    updateUIEmptyState();
    requestRenderPreview();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();