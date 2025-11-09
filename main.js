const { app, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

// Memory optimizations: disable GPU acceleration for lightweight widget
app.disableHardwareAcceleration();
// Reduce V8 memory usage
app.commandLine.appendSwitch('v8-cache-options', 'none');

// Import modular classes
const ConfigManager = require('./lib/config-manager');
const IcalProcessor = require('./lib/ical-processor');
const WindowManager = require('./lib/window-manager');

// define path to persistent config file used by loadConfig/saveConfig
// At runtime we prefer a per-user writable location under app.getPath('userData').
// Packaged defaults are stored inside the app resources (assets/default-config.json).
const packagedDefaultCfg = path.join(__dirname, 'assets', 'default-config.json');
const userCfgDir = app.getPath ? app.getPath('userData') : __dirname;
const cfgPath = path.join(userCfgDir, 'config.json');

// Ensure that if no user config exists we copy the packaged default into userData
function ensureUserConfigExists() {
  try {
    if (!fs.existsSync(cfgPath)) {
      // Try to copy from packaged default; if not found, write a minimal default
      if (fs.existsSync(packagedDefaultCfg)) {
        try {
          // Ensure user directory exists
          try { fs.mkdirSync(userCfgDir, { recursive: true }); } catch (e) {}
          fs.copyFileSync(packagedDefaultCfg, cfgPath);
        } catch (e) {
          console.warn('Failed to copy packaged default config to userData', e);
        }
      } else {
        // Write a sensible minimal default
        try { fs.mkdirSync(userCfgDir, { recursive: true }); } catch (e) {}
        const minimal = { icals: [], ui: {}, acceptedTerms: false, windowBounds: {} };
        fs.writeFileSync(cfgPath, JSON.stringify(minimal, null, 2));
      }
    }
  } catch (e) {
    console.warn('ensureUserConfigExists failed', e);
  }
}

// Global instance references
let windowManager = null;
let cfgManager = null;
let icalProcessor = null;

// Fallback IPC handler for set-click-through (registered early to avoid race conditions)
try {
  ipcMain.handle('set-click-through', async (event, which, enabled) => {
    try {
      const bw = which === 'home' ? (windowManager && windowManager.homeWin) : (windowManager && windowManager.win);
      if (!bw || bw.isDestroyed()) return false;
      // Enable click-through: let clicks pass through to windows behind
      bw.setIgnoreMouseEvents(!!enabled, { forward: true });
      return true;
    } catch (e) {
      console.error('fallback set-click-through failed', e);
      return false;
    }
  });
} catch (e) { /* ignore if handler already exists */ }

// Fallback IPC handler for remove-ical: register early so renderers can call it
// even if the WindowManager hasn't finished setting up handlers yet.
try {
  ipcMain.handle('remove-ical', async (ev, url) => {
    try {
      if (!url || typeof url !== 'string') throw new Error('Invalid URL');
      if (!cfgManager) return { ok: false, error: 'Config manager not ready' };
      const cfg = cfgManager.config;
      cfg.icals = (cfg.icals || []).filter(i => {
        const u = (typeof i === 'string') ? i : (i.url || '');
        return u !== url;
      });
      cfgManager.saveConfig();

      // Let processor attempt to free any in-memory metadata
      try { if (icalProcessor && typeof icalProcessor.clearCacheForUrl === 'function') icalProcessor.clearCacheForUrl(url); } catch (e) {}

      // Notify windows if available
      try { if (windowManager && windowManager.win && !windowManager.win.isDestroyed()) { windowManager.win.webContents.send('refresh-events'); windowManager.win.webContents.send('perform-memory-clean'); } } catch (e) {}
      try { if (windowManager && windowManager.homeWin && !windowManager.homeWin.isDestroyed()) { windowManager.homeWin.webContents.send('refresh-events'); windowManager.homeWin.webContents.send('perform-memory-clean'); } } catch (e) {}

      return { ok: true, icals: cfg.icals };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });
} catch (e) { /* ignore if already registered */ }

// Fallback handler for request-main-gc so renderers can call it before WindowManager sets handlers
try {
  ipcMain.handle('request-main-gc', async () => {
    try {
      if (typeof global.gc === 'function') {
        try { global.gc(); } catch (e) {}
        return { ok: true };
      }
      return { ok: false, error: 'global.gc not available' };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });
} catch (e) { /* ignore if already registered */ }

// --- Application Initialization ---

app.whenReady().then(() => {
  // Ensure a per-user config exists (copy packaged defaults on first run)
  ensureUserConfigExists();
  
  // Remove the default application menu so File/Edit/etc. are not visible
  try {
    // In development you may still want the menu; gate if needed
    if (process.env.NODE_ENV !== 'development') {
      const { Menu } = require('electron');
      Menu.setApplicationMenu(null);
    } else {
      // still remove the menu by default for a cleaner dev window; comment out if you want it
      const { Menu } = require('electron');
      Menu.setApplicationMenu(null);
    }
  } catch (e) {
    console.warn('Failed to clear application menu', e);
  }
  
  // Initialize managers
  cfgManager = new ConfigManager(cfgPath);
  icalProcessor = new IcalProcessor(cfgManager, null, null);
  windowManager = new WindowManager(cfgManager, icalProcessor);
  
  // Setup IPC handlers
  windowManager.setupIpcHandlers();
  
  // Check if this is the first launch
  const isFirstLaunch = cfgManager.config.firstLaunch === true;
  
  if (isFirstLaunch) {
    // First launch: show home window for setup
    windowManager.createHomeWindow();
    icalProcessor.homeWindow = windowManager.homeWin;
    
    // Mark first launch as done so next startup goes directly to calendar
    cfgManager.updateConfig({ firstLaunch: false });
  } else {
    // Subsequent launches: show calendar directly
    windowManager.createMainWindow();
    icalProcessor.mainWindow = windowManager.win;
  }
  
  // Start polling for iCal updates
  const interval = (cfgManager.config.ui?.fetchInterval || 1) * 60 * 1000;
  icalProcessor.startPolling(interval);
  
  // Setup tray menu
  windowManager.setupTray();

  // Register a global shortcut to toggle click-through quickly (Ctrl+Shift+C)
  try {
    globalShortcut.register('Control+Shift+C', () => {
      try { windowManager.toggleClickThrough(); } catch (e) { console.error(e); }
    });
  } catch (e) {
    console.warn('Failed to register global shortcut', e);
  }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Listen for config updates and apply changes
ipcMain.on('config-updated', (event, cfg) => {
  if (windowManager) {
    windowManager.updateFetchInterval();
  }
});