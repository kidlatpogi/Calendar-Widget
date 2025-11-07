const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, globalShortcut } = require('electron');
const { screen } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { shell } = require('electron');
const AutoLaunch = require('auto-launch');

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
          console.log('Copied default config to userData:', cfgPath);
        } catch (e) {
          console.warn('Failed to copy packaged default config to userData', e);
        }
      } else {
        // Write a sensible minimal default
        try { fs.mkdirSync(userCfgDir, { recursive: true }); } catch (e) {}
        const minimal = { icals: [], ui: {}, acceptedTerms: false, windowBounds: {} };
        fs.writeFileSync(cfgPath, JSON.stringify(minimal, null, 2));
        console.log('Wrote minimal config to userData:', cfgPath);
      }
    }
  } catch (e) {
    console.warn('ensureUserConfigExists failed', e);
  }
}

// debug log files: userData if available, and repo local fallback for easy inspection during development
const debugLogPathUser = path.join(app.getPath ? app.getPath('userData') : __dirname, 'resize-debug.log');
const debugLogPathLocal = path.join(__dirname, 'resize-debug.log');

function appendDebugLog(line) {
  const entry = `${new Date().toISOString()} ${line}\n`;
  try { fs.appendFileSync(debugLogPathUser, entry); } catch (e) { /* ignore */ }
  try { fs.appendFileSync(debugLogPathLocal, entry); } catch (e) { /* ignore */ }
}

// Add these declarations so handlers can reference the windows safely
let win = null;
let homeWin = null;
let tray = null;
let windowManager = null;
let cfgManager = null;
let icalProcessor = null;

// --- 1. ConfigManager (Single Responsibility for Persistence) ---

// Fallback IPC handler in case IPC calls arrive before WindowManager sets up handlers
// True click-through: allow clicks to pass through to windows behind (setIgnoreMouseEvents),
// but restore keyboard focus so keyboard shortcuts still work.
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

class ConfigManager {
    constructor(cfgPath) {
        this.cfgPath = cfgPath;
        this.config = this.loadConfig();
        this._saveBoundsTimer = null;
    }

    loadConfig() {
        try {
            const content = fs.readFileSync(this.cfgPath, 'utf8');
            const cfg = JSON.parse(content);
            // Ensure structure
            cfg.icals = Array.isArray(cfg.icals) ? cfg.icals : [];
            cfg.ui = cfg.ui || {};
            cfg.windowBounds = cfg.windowBounds || {};
            cfg.acceptedTerms = !!cfg.acceptedTerms;
            return cfg;
        } catch (e) {
            return { icals: [], ui: {}, acceptedTerms: false, windowBounds: {} };
        }
    }

    saveConfig(cfg = this.config) {
        try {
            this.config = cfg;
            fs.writeFileSync(this.cfgPath, JSON.stringify(cfg, null, 2));
        } catch (e) {
            console.warn('Failed to save config', e);
        }
    }

    // Debounced function to save window bounds (to avoid excessive disk writes)
    persistWindowBoundsDebounced(winKey, bounds) {
        this.config.windowBounds = this.config.windowBounds || {};
        this.config.windowBounds[winKey] = bounds;

        if (this._saveBoundsTimer) clearTimeout(this._saveBoundsTimer);
        this._saveBoundsTimer = setTimeout(() => this.saveConfig(), 250);
    }

    updateConfig(partial) {
        if (!this.config) this.config = {};
        if (!this.config.ui) this.config.ui = {};
        
        Object.assign(this.config.ui, partial);
        this.saveConfig();
    }
}

// --- 2. IcalProcessor (Single Responsibility for Data/Polling) ---

class IcalProcessor {
    constructor(configManager, mainWindow, homeWindow) {
        this.cfgManager = configManager;
        this.mainWindow = mainWindow;
        this.homeWindow = homeWindow;
        this._pollingIntervalId = null;
    }

    // Helper: safe fetch using node's http/https
    fetchText(url, headers = {}, timeout = 10000) {
        return new Promise((resolve, reject) => {
            try {
                const u = new URL(url);
                const lib = u.protocol === 'https:' ? https : http;
                const opts = {
                  headers: {
                    'User-Agent': 'ScheduleWidget/1.0',
                    'Accept': 'text/calendar, */*',
                    ...headers
                  },
                  timeout
                };

                const req = lib.get(u, opts, (res) => {
                  if (res.statusCode === 304) {
                    res.resume();
                    return resolve({ status: 304 });
                  }

                  let body = '';
                  res.setEncoding('utf8');
                  res.on('data', (c) => { body += c; });
                  res.on('end', () => {
                    const etag = res.headers && res.headers['etag'] ? res.headers['etag'] : null;
                    const lastModified = res.headers && res.headers['last-modified'] ? res.headers['last-modified'] : null;
                    
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                      console.log(`fetchText success [${res.statusCode}] ${url.substring(0, 80)}...`);
                      resolve({ status: res.statusCode, body, etag, lastModified });
                    } else {
                      console.warn(`fetchText [${res.statusCode}] ${url}`);
                      reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0, 200)}`));
                    }
                  });
                });

                req.on('error', (err) => {
                  console.error(`fetchText network error: ${url}`, err.message);
                  reject(err);
                });

                req.on('timeout', () => {
                  req.destroy();
                  console.error(`fetchText timeout: ${url}`);
                  reject(new Error('timeout'));
                });
            } catch (err) {
                console.error(`fetchText parse error: ${url}`, err.message);
                reject(err);
            }
        });
    }

    sha256(text) {
        return crypto.createHash('sha256').update(text || '', 'utf8').digest('hex');
    }

    // Poll configured iCals periodically and notify renderer when something changed
    async pollICalsOnce() {
        const cfg = this.cfgManager.config;
        if (!Array.isArray(cfg.icals) || cfg.icals.length === 0) return;

        let changed = false;
        const now = Date.now();

        // Normalize entries to objects
        cfg.icals = cfg.icals.map(it => (typeof it === 'string' ? { url: it } : it || {}));

        for (let entry of cfg.icals) {
            const url = (entry && entry.url || '').trim();
            if (!url) continue;

            const headers = {};
            if (entry.etag) headers['If-None-Match'] = entry.etag;
            if (entry.lastModified) headers['If-Modified-Since'] = entry.lastModified;

            try {
                const res = await this.fetchText(url, headers);

                if (res.status === 304) {
                    entry._lastChecked = now;
                    continue;
                }

                if (res.status >= 200 && res.status < 300 && typeof res.body === 'string') {
                    const newEtag = res.etag || null;
                    const newLastModified = res.lastModified || null;
                    const newHash = this.sha256(res.body);

                    const prevHash = entry._lastHash || entry.hash || null;
                    const prevEtag = entry.etag || null;

                    // Determine if content changed
                    if (newEtag && prevEtag) {
                        if (newEtag !== prevEtag) changed = true;
                    } else {
                        if (prevHash !== newHash) changed = true;
                    }

                    // Update stored metadata
                    entry.etag = newEtag || entry.etag;
                    entry.lastModified = newLastModified || entry.lastModified;
                    entry._lastHash = newHash;
                }
                entry._lastChecked = now;
            } catch (e) {
                console.warn('pollICalsOnce fetch error', url, e.message);
                entry._lastChecked = now;
            }
        }

        if (changed) {
            this.cfgManager.saveConfig(); // Save updated metadata
            
            // Notify renderers to reload data
            const sendRefresh = (win) => { if (win && !win.isDestroyed()) win.webContents.send('refresh-events'); };
            sendRefresh(this.mainWindow);
            sendRefresh(this.homeWindow);
        }
    }

    startPolling(intervalMs = 60000) {
        this.pollICalsOnce().catch(() => {});
        this._pollingIntervalId = setInterval(() => this.pollICalsOnce().catch(() => {}), intervalMs);
    }

    stopPolling() {
        if (this._pollingIntervalId) {
            clearInterval(this._pollingIntervalId);
            this._pollingIntervalId = null;
        }
    }
}


// --- 3. WindowManager (Handles Window Lifecycle and IPC) ---

class WindowManager {
  constructor(configManager, icalProcessor) {
    this.cfgManager = configManager;
    this.processor = icalProcessor;
    this.win = null;
    this.homeWin = null;
    this.tray = null;
  }

  createMainWindow() {
    // Load saved position
    const cfg = this.cfgManager?.config || {};
    const windowPos = cfg.ui?.windowPos || { x: undefined, y: undefined };
    
    // Get screen dimensions to make window full height
    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { height: screenHeight } = primaryDisplay.workAreaSize;
    
    const windowOptions = {
      width: 400,
      height: screenHeight,
      // Use native window chrome so OS provides minimize/maximize/close
      transparent: true,
      frame: false,
      alwaysOnTop: false,
      skipTaskbar: true,
      autoHideMenuBar: true,
      show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false }
    };

    // Only set position if it exists
    if (windowPos.x !== undefined && windowPos.y !== undefined) {
      windowOptions.x = windowPos.x;
      windowOptions.y = windowPos.y;
    }

    this.win = new BrowserWindow(windowOptions);
  // ensure the menu bar is hidden
  try { this.win.setMenuBarVisibility(false); } catch (e) { /* ignore */ }
    this.win.loadFile(path.join(__dirname, 'HTML', 'index.html'));

    // Show without focusing so the window doesn't raise above other windows on creation
    this.win.once('ready-to-show', () => {
      try { this.win.showInactive(); } catch (e) { try { this.win.show(); } catch {} }
    });
    
    const cfg_ui = cfg.ui || {};
    
    // Apply always-on-top setting explicitly (true or false)
    if (typeof cfg_ui.alwaysOnTop === 'boolean') {
      try { this.win.setAlwaysOnTop(!!cfg_ui.alwaysOnTop); } catch (e) { /* ignore */ }
    }
    
    // Apply opacity setting
    if (cfg_ui.opacity !== undefined) {
      const opacity = Math.max(0.2, Math.min(1, cfg_ui.opacity / 100));
      this.win.setOpacity(opacity);
    }

    // Restore window position (default: remember position enabled)
    const rememberPosition = cfg_ui.rememberPosition !== false;
    
    this.win.on('moved', () => {
      if (rememberPosition && this.cfgManager) {
        const [x, y] = this.win.getPosition();
        this.cfgManager.updateConfig({ windowPos: { x, y } });
      }
    });

    this.win.on('resize', () => {
      if (rememberPosition && this.cfgManager) {
        const [x, y] = this.win.getPosition();
        this.cfgManager.updateConfig({ windowPos: { x, y } });
      }
    });
  }

  createHomeWindow() {
    this.homeWin = new BrowserWindow({
      width: 340,
      height: 400,
      // Use native frame for home window as well
      transparent: false,
      frame: true,
      alwaysOnTop: false,
      skipTaskbar: true,
      autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false }
    });

    this.homeWin.loadFile(path.join(__dirname, 'HTML', 'home.html'));
    try { this.homeWin.setMenuBarVisibility(false); } catch (e) { /* ignore */ }
    this.homeWin.once('ready-to-show', () => {
      try { this.homeWin.showInactive(); } catch (e) { try { this.homeWin.show(); } catch {} }
    });
  }

    setupAutoLaunch() {
        try {
      console.log('[setupAutoLaunch] called, app.isPackaged =', app.isPackaged);
      
      // Don't enable auto-launch during development (avoid registering electron.exe)
      if (!app.isPackaged) {
        console.log('[setupAutoLaunch] Skipping in development mode (app not packaged)');
        return;
      }
      
            const exePath = app.getPath('exe');
            console.log('[setupAutoLaunch] app exe path:', exePath);
            
            const autoLauncher = new AutoLaunch({
                name: 'Calendar Widget',
                path: exePath,
              });

            const cfg = this.cfgManager?.config || {};
            const shouldAutoStart = cfg.ui?.autoStart || false;
            console.log('[setupAutoLaunch] config.ui.autoStart =', shouldAutoStart);
            
            if (shouldAutoStart) {
              console.log('[setupAutoLaunch] Enabling auto-launch...');
              autoLauncher.enable().then(() => {
                console.log('[setupAutoLaunch] Auto-launch enabled successfully');
              }).catch((err) => {
                console.error('[setupAutoLaunch] Failed to enable auto-launch:', err);
              });
            } else {
              console.log('[setupAutoLaunch] Disabling auto-launch...');
              autoLauncher.disable().then(() => {
                console.log('[setupAutoLaunch] Auto-launch disabled successfully');
              }).catch((err) => {
                console.error('[setupAutoLaunch] Failed to disable auto-launch:', err);
              });
            }
        } catch (e) {
            console.error('[setupAutoLaunch] exception:', e);
        }
    }

    // Toggle click-through (persist setting and apply to window)
    toggleClickThrough() {
      try {
        const cfg = this.cfgManager.config || {};
        cfg.ui = cfg.ui || {};
        const cur = !!cfg.ui.clickThrough;
        const next = !cur;
        cfg.ui.clickThrough = next;
        this.cfgManager.saveConfig(cfg);

        // Enable true click-through: let clicks pass through to windows behind
        if (this.win && !this.win.isDestroyed()) {
          try { this.win.setIgnoreMouseEvents(!!next, { forward: true }); } catch (e) { }
        }

        // notify renderers about updated config
        const sendUpdate = (w) => { if (w && !w.isDestroyed()) w.webContents.send('config-updated', cfg); };
        sendUpdate(this.win);
        sendUpdate(this.homeWin);

        return next;
      } catch (e) {
        console.error('toggleClickThrough failed', e);
        return null;
      }
    }

    // Handle fetch interval change
    updateFetchInterval() {
        const cfg = this.cfgManager?.config || {};
        const interval = (cfg.ui?.fetchInterval || 1) * 60 * 1000; // Convert to ms
        
        if (this.processor?.stopPolling) {
          this.processor.stopPolling();
        }
        if (this.processor?.startPolling) {
          this.processor.startPolling(interval);
        }
    }

    setupIpcHandlers() {
        ipcMain.handle('accept-terms', async () => {
            this.cfgManager.config.acceptedTerms = true;
            this.cfgManager.saveConfig();
            return true;
        });

        ipcMain.handle('set-config', async (ev, partial) => {
            const cfg = this.cfgManager.config;
            cfg.ui = cfg.ui || {};
            Object.assign(cfg.ui, partial);
            this.cfgManager.saveConfig();
            
            // Update fetch interval if changed
            if (partial.fetchInterval) {
              this.updateFetchInterval();
            }
            
            // Update auto-start if changed
            if (partial.hasOwnProperty('autoStart')) {
              this.setupAutoLaunch();
            }
            
            const sendUpdate = (win) => { if (win && !win.isDestroyed()) win.webContents.send('config-updated', cfg); };
            sendUpdate(this.win);
            sendUpdate(this.homeWin);
            
            return cfg;
        });

        // Allow renderer to request window movement by a delta (used for custom drag)
        ipcMain.handle('move-window-by', (ev, dx, dy) => {
          try {
            const w = win || homeWin;
            if (!w) return false;
            const bounds = w.getBounds();
            w.setBounds({ x: bounds.x + Math.round(dx), y: bounds.y + Math.round(dy), width: bounds.width, height: bounds.height });
            return true;
          } catch (e) {
            console.error('move-window-by failed', e);
            return false;
          }
        });

        ipcMain.handle('open-main', async () => {
            // Singleton: only create main window once; if it exists, just show it
            if (!this.win || this.win.isDestroyed()) {
                this.createMainWindow();
                // Update processor reference to the newly created main window
                if (this.processor) this.processor.mainWindow = this.win;
            }
            // Close home window if it's open
            if (this.homeWin) { try { this.homeWin.close(); } catch {} this.homeWin = null; }
            // Show without focusing so it doesn't steal focus or float above other windows
            try { this.win.showInactive(); } catch (e) { try { this.win.show(); } catch {} }
            return true;
        });
        
        ipcMain.handle('open-home', async () => {
            if (!this.homeWin || this.homeWin.isDestroyed()) {
                this.createHomeWindow();
            } else {
                if (this.homeWin.isMinimized()) this.homeWin.restore();
        try { this.homeWin.showInactive(); } catch (e) { try { this.homeWin.show(); } catch {} }
            }
            return true;
        });

        ipcMain.handle('open-url', async (ev, url) => shell.openExternal(url));

    ipcMain.handle('open-tutorial', async () => {
      try {
        const pdfPath = path.join(__dirname, 'Public', 'How to get ICal link.pdf');
        if (fs.existsSync(pdfPath)) {
          // shell.openPath will open the file with the default app
          const res = await shell.openPath(pdfPath);
          if (res) {
            console.warn('shell.openPath returned:', res);
            return false;
          }
          return true;
        } else {
          console.warn('Tutorial PDF not found at', pdfPath);
          return false;
        }
      } catch (e) {
        console.error('open-tutorial failed', e);
        return false;
      }
    });

        ipcMain.handle('add-ical', async (ev, url) => {
            if (!url || typeof url !== 'string') throw new Error('Invalid URL');
            const cfg = this.cfgManager.config;
            if (!cfg.icals.includes(url)) cfg.icals.push(url);
            this.cfgManager.saveConfig();
            return cfg.icals;
        });

        ipcMain.handle('list-config', async () => this.cfgManager.config);

        ipcMain.handle('home-resize', async (ev, size) => {
            const bw = BrowserWindow.fromWebContents(ev.sender);
            if (!bw || !size) return false;
            const w = Math.max(200, Math.round(size.w || 300));
            const h = Math.max(160, Math.round(size.h || 200));
            bw.setContentSize(w, h);
            bw.center();
            return true;
        });
        
        ipcMain.handle('set-window-bounds', async (ev, which, bounds = {}) => {
            try {
                const persist = !!bounds.persist;
                const desiredW = typeof bounds.width === 'number' ? Math.max(160, Math.round(bounds.width)) : undefined;
                const desiredH = typeof bounds.height === 'number' ? Math.max(120, Math.round(bounds.height)) : undefined;

                const applyFor = (bw) => {
                    if (!bw || bw.isDestroyed()) return;
                    const cur = bw.getContentSize();
                    const curW = cur[0] || 0;
                    const curH = cur[1] || 0;

              // If the resize is persistent, prefer grow-only behavior to avoid shrinking
              // the user's saved window size. For non-persistent requests (like fitting
              // to content), allow both grow and shrink so the window matches the content.
              const newW = typeof desiredW === 'number' ? (persist ? Math.max(curW, desiredW) : desiredW) : curW;
              const newH = typeof desiredH === 'number' ? (persist ? Math.max(curH, desiredH) : desiredH) : curH;

              try { bw.setContentSize(newW, newH); } catch (e) { /* ignore */ }
                    if (persist && typeof bounds.x === 'number' && typeof bounds.y === 'number') {
                        try { bw.setPosition(Math.round(bounds.x), Math.round(bounds.y)); } catch (e) { /* ignore */ }
                    }
                };

                if (which === 'main') applyFor(this.win);
                if (which === 'home') applyFor(this.homeWin);

                // Diagnostic logging: report what was requested and what is applied.
                try { console.log(`[set-window-bounds] requested which=${which} desiredW=${desiredW} desiredH=${desiredH} persist=${persist}`); } catch (e) {}

                if (persist) {
                  const cfg = this.cfgManager.config;
                  cfg.windowBounds = cfg.windowBounds || {};
                  cfg.windowBounds[which] = cfg.windowBounds[which] || {};
                  if (typeof desiredW === 'number') cfg.windowBounds[which].width = desiredW;
                  if (typeof desiredH === 'number') cfg.windowBounds[which].height = desiredH;
                  if (typeof bounds.x === 'number') cfg.windowBounds[which].x = Math.round(bounds.x);
                  if (typeof bounds.y === 'number') cfg.windowBounds[which].y = Math.round(bounds.y);
                  this.cfgManager.saveConfig();
                }

                // If not persistent, cap the requested size to the display work area to avoid
                // requesting a window size larger than the available screen, which can lead
                // to partial clipping or OS-level limitations.
                try {
                  const targetWin = which === 'main' ? this.win : this.homeWin;
                  if (targetWin && !targetWin.isDestroyed()) {
                    const winBounds = targetWin.getBounds();
                    const disp = screen.getDisplayMatching(winBounds) || screen.getPrimaryDisplay();
                    const work = disp.workAreaSize || disp.size || { width: 800, height: 600 };
                    const maxContentH = Math.max(160, Math.floor(work.height - 80));
                    const maxContentW = Math.max(200, Math.floor(work.width - 40));
                    // clamp new sizes
                    if (typeof newH === 'number') newH = Math.min(newH, maxContentH);
                    if (typeof newW === 'number') newW = Math.min(newW, maxContentW);
                    try { targetWin.setContentSize(newW, newH); } catch (e) { /* ignore */ }
                    try { const applied = targetWin.getContentSize(); console.log(`[set-window-bounds] applied contentSize for ${which}: ${applied[0]}x${applied[1]}`); } catch (e) {}
                  }
                } catch (e) { /* ignore display calc errors */ }

                return true;
            } catch (e) {
                console.warn('set-window-bounds failed', e);
                throw e;
            }
        });
        
        ipcMain.handle('fetch-events', async (event) => {
          try {
            if (!windowManager) throw new Error('windowManager not initialized');
            const events = await windowManager._fetchEventsLogic();
            return events;
          } catch (e) {
            console.error('fetch-events failed:', e);
            return [];
          }
        });

        ipcMain.handle('set-always-on-top', async (event, isOnTop) => {
          try {
            if (this.cfgManager) {
              this.cfgManager.updateConfig({ alwaysOnTop: isOnTop });
            }
            if (this.win) {
              this.win.setAlwaysOnTop(isOnTop);
            }
            return true;
          } catch (e) {
            console.error('set-always-on-top failed', e);
            return false;
          }
        });

        // (set-click-through handler is registered earlier as a fallback to avoid race conditions)

        ipcMain.handle('set-event-notifications', async (event, isEnabled) => {
          try {
            if (this.cfgManager) {
              this.cfgManager.updateConfig({ eventNotifications: isEnabled });
            }
            return true;
          } catch (e) {
            console.error('set-event-notifications failed', e);
            return false;
          }
        });

        ipcMain.handle('show-notification', async (event, { title, message }) => {
          const cfg = cfgManager?.config || {};
          if (!cfg.ui?.eventNotifications) return;

          new Notification({
            title: 'Calendar Event',
            body: `${title}\n${message}`,
            sound: true,
          }).show();
          
          return true;
        });

        ipcMain.handle('minimize-window', (event, windowName) => {
          const win = windowName === 'home' ? this.homeWin : this.win;
          if (win) win.minimize();
        });

        ipcMain.handle('toggle-maximize-window', (event, windowName) => {
          const win = windowName === 'home' ? this.homeWin : this.win;
          if (win) {
            if (win.isMaximized()) {
              win.unmaximize();
            } else {
              win.maximize();
            }
          }
        });

        ipcMain.handle('close-window', (event, windowName) => {
          const win = windowName === 'home' ? this.homeWin : this.win;
          if (win) win.close();
        });

        // Toggle visibility: hide if visible, showInactive if hidden
        ipcMain.handle('toggle-visibility', (event, windowName = 'main') => {
          const win = windowName === 'home' ? this.homeWin : this.win;
          if (!win || win.isDestroyed()) return false;
          try {
            if (win.isVisible()) { win.hide(); }
            else { try { win.showInactive(); } catch (e) { try { win.show(); } catch {} } }
            return true;
          } catch (e) { console.error('toggle-visibility failed', e); return false; }
        });

        // Helper to read current content size for diagnostics and verification
        ipcMain.handle('get-content-size', (event, windowName) => {
          try {
            const bw = windowName === 'home' ? this.homeWin : this.win;
            if (!bw || bw.isDestroyed()) return null;
            return bw.getContentSize();
          } catch (e) { return null; }
        });
    }

    async _fetchEventsLogic() {
        try {
            const cfg = this.cfgManager.config;
            const icals = (cfg.icals || [])
                .map(i => (typeof i === 'string' ? { url: i } : i || {}))
                .filter(i => (i.url || '').trim() !== '');

            if (icals.length === 0) {
                console.log('fetch-events: no iCals configured');
                return [];
            }

            let allEvents = [];
            const now = new Date();
            // Set to start of today (midnight) in LOCAL timezone
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
            
            // Respect user-configured displayDays when filtering fetched events so the
            // renderer receives events for all days the user asked to see. Default to 14.
            const configuredDays = Number(this.cfgManager.config?.ui?.displayDays) || 14;
            const daysAhead = Math.max(1, Math.min(30, configuredDays)); // clamp to reasonable range
            // Add 1 to ensure we get the full last day (e.g., if displayDays=9, we want days 0-8, which is 9 days)
            const futureDate = new Date(today);
            futureDate.setDate(today.getDate() + daysAhead);
            futureDate.setHours(23, 59, 59, 999); // End of the last day
            for (const entry of icals) {
                try {
                    const url = (entry.url || '').trim();
                    if (!url) continue;
                    console.log(`Fetching iCal: ${url.substring(0, 80)}...`);
                    const headers = {};
                    if (entry.etag) headers['If-None-Match'] = entry.etag;
                    if (entry.lastModified) headers['If-Modified-Since'] = entry.lastModified;
                    const res = await this.processor.fetchText(url, headers);
                    if (res.status === 304 || !res.body) {
                        console.log(`  -> no changes (304)`);
                        continue;
                    }
                    if (res.body && typeof res.body === 'string') {
                        const events = this._parseIcal(res.body);
                        // Filter to only keep events from TODAY onwards (no past events)
                        const filtered = events.filter(ev => {
                            const start = ev.start?.date || ev.start?.dateTime;
                            if (!start) return true; // keep all-day events with no explicit date
                            const startDate = new Date(start);
                            // Compare at midnight level to include all events starting today
                            const eventDay = new Date(startDate);
                            eventDay.setHours(0, 0, 0, 0);
                            return eventDay >= today && eventDay <= futureDate;
                        });
                        allEvents = allEvents.concat(filtered);
                        // Clear the res.body from memory
                        res.body = null;
                    }
                } catch (err) {
                    console.error(`Failed to fetch/parse ${entry.url}:`, err.message);
                }
            }
            return allEvents;
        } catch (e) {
            console.error('_fetchEventsLogic error', e);
            return [];
        }
    }

    _parseIcal(icsText) {
        const events = [];
        try {
            const eventMatches = icsText.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
            for (const eventBlock of eventMatches) {
                const event = {};
                
                const summaryMatch = eventBlock.match(/SUMMARY:(.+?)(?:\r?\n|$)/);
                event.summary = summaryMatch ? summaryMatch[1].trim() : 'No title';
                
                // Only store necessary fields to minimize memory
                const dtStartMatch = eventBlock.match(/DTSTART(?:;[^:]*)?:(.+?)(?:\r?\n|$)/);
                if (dtStartMatch) {
                    const dtStr = dtStartMatch[1].trim();
                    if (dtStr.includes('T')) {
                        event.start = { dateTime: this._parseIcalDateTime(dtStr) };
                    } else {
                        event.start = { date: this._formatIcalDate(dtStr) };
                    }
                }
                
                const dtEndMatch = eventBlock.match(/DTEND(?:;[^:]*)?:(.+?)(?:\r?\n|$)/);
                if (dtEndMatch) {
                    const dtStr = dtEndMatch[1].trim();
                    if (dtStr.includes('T')) {
                        event.end = { dateTime: this._parseIcalDateTime(dtStr) };
                    } else {
                        event.end = { date: this._formatIcalDate(dtStr) };
                    }
                }
                
                // Check for recurring event (RRULE)
                const rruleMatch = eventBlock.match(/RRULE:(.+?)(?:\r?\n|$)/);
                if (rruleMatch && event.start) {
                    // Expand recurring events for the next 90 days
                    const expandedEvents = this._expandRecurringEvent(event, rruleMatch[1].trim());
                    events.push(...expandedEvents);
                } else {
                    // Only push if we have at least summary or start date (avoid empty events)
                    if ((event.summary && event.summary !== 'No title') || event.start) {
                        events.push(event);
                    }
                }
            }
        } catch (e) {
            console.warn('iCal parse error:', e.message);
        }
        return events;
    }
    
    _expandRecurringEvent(baseEvent, rruleStr) {
        const expanded = [];
        try {
            // Parse RRULE components
            const rruleParts = {};
            rruleStr.split(';').forEach(part => {
                const [key, value] = part.split('=');
                if (key && value) rruleParts[key] = value;
            });
            
            const freq = rruleParts['FREQ'];
            const count = parseInt(rruleParts['COUNT']) || 52; // Default to 52 occurrences
            const interval = parseInt(rruleParts['INTERVAL']) || 1;
            
            if (!freq || !baseEvent.start) return [baseEvent];
            
            // Get start date/time
            const startStr = baseEvent.start.dateTime || baseEvent.start.date;
            if (!startStr) return [baseEvent];
            
            const baseDate = new Date(startStr);
            if (isNaN(baseDate.getTime())) return [baseEvent];
            
            // Calculate duration if end time exists
            let duration = 0;
            if (baseEvent.end) {
                const endStr = baseEvent.end.dateTime || baseEvent.end.date;
                const endDate = new Date(endStr);
                if (!isNaN(endDate.getTime())) {
                    duration = endDate.getTime() - baseDate.getTime();
                }
            }
            
            // Expand based on frequency (limit to reasonable number)
            const maxOccurrences = Math.min(count, 100);
            for (let i = 0; i < maxOccurrences; i++) {
                const occurrenceDate = new Date(baseDate);
                
                // Add interval based on frequency
                if (freq === 'DAILY') {
                    occurrenceDate.setDate(baseDate.getDate() + (i * interval));
                } else if (freq === 'WEEKLY') {
                    occurrenceDate.setDate(baseDate.getDate() + (i * interval * 7));
                } else if (freq === 'MONTHLY') {
                    occurrenceDate.setMonth(baseDate.getMonth() + (i * interval));
                } else if (freq === 'YEARLY') {
                    occurrenceDate.setFullYear(baseDate.getFullYear() + (i * interval));
                } else {
                    // Unsupported frequency, just return base event
                    return [baseEvent];
                }
                
                // Create occurrence event
                const occurrence = {
                    summary: baseEvent.summary,
                    start: null,
                    end: null
                };
                
                // Format start time
                if (baseEvent.start.dateTime) {
                    const y = occurrenceDate.getFullYear();
                    const m = String(occurrenceDate.getMonth() + 1).padStart(2, '0');
                    const d = String(occurrenceDate.getDate()).padStart(2, '0');
                    const hh = String(occurrenceDate.getHours()).padStart(2, '0');
                    const mm = String(occurrenceDate.getMinutes()).padStart(2, '0');
                    const ss = String(occurrenceDate.getSeconds()).padStart(2, '0');
                    occurrence.start = { dateTime: `${y}-${m}-${d}T${hh}:${mm}:${ss}` };
                    
                    // Calculate end time
                    if (duration > 0) {
                        const endDate = new Date(occurrenceDate.getTime() + duration);
                        const ey = endDate.getFullYear();
                        const em = String(endDate.getMonth() + 1).padStart(2, '0');
                        const ed = String(endDate.getDate()).padStart(2, '0');
                        const ehh = String(endDate.getHours()).padStart(2, '0');
                        const emm = String(endDate.getMinutes()).padStart(2, '0');
                        const ess = String(endDate.getSeconds()).padStart(2, '0');
                        occurrence.end = { dateTime: `${ey}-${em}-${ed}T${ehh}:${emm}:${ess}` };
                    }
                } else {
                    // All-day event
                    const y = occurrenceDate.getFullYear();
                    const m = String(occurrenceDate.getMonth() + 1).padStart(2, '0');
                    const d = String(occurrenceDate.getDate()).padStart(2, '0');
                    occurrence.start = { date: `${y}-${m}-${d}` };
                    
                    if (duration > 0) {
                        const endDate = new Date(occurrenceDate.getTime() + duration);
                        const ey = endDate.getFullYear();
                        const em = String(endDate.getMonth() + 1).padStart(2, '0');
                        const ed = String(endDate.getDate()).padStart(2, '0');
                        occurrence.end = { date: `${ey}-${em}-${ed}` };
                    }
                }
                
                expanded.push(occurrence);
            }
        } catch (e) {
            console.warn('RRULE expansion error:', e.message);
            return [baseEvent];
        }
        
        return expanded.length > 0 ? expanded : [baseEvent];
    }

    _formatIcalDate(dateStr) {
        if (!dateStr || dateStr.length < 8) return null;
        const y = dateStr.substring(0, 4);
        const m = dateStr.substring(4, 6);
        const d = dateStr.substring(6, 8);
        return `${y}-${m}-${d}`;
    }

    _parseIcalDateTime(dtStr) {
        try {
            const cleanStr = dtStr.replace(/Z$/, '');
            if (cleanStr.length === 8) {
                return `${cleanStr.substring(0, 4)}-${cleanStr.substring(4, 6)}-${cleanStr.substring(6, 8)}T00:00:00`;
            }
            if (cleanStr.includes('T')) {
                const [date, time] = cleanStr.split('T');
                const y = date.substring(0, 4);
                const m = date.substring(4, 6);
                const d = date.substring(6, 8);
                const hh = time.substring(0, 2) || '00';
                const mm = time.substring(2, 4) || '00';
                const ss = time.substring(4, 6) || '00';
                return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
            }
        } catch (e) { /* ignore */ }
        return dtStr;
    }
    
    setupTray() {
        try {
            const trayIcon = path.join(__dirname, 'calendar.ico');
            if (fs.existsSync(trayIcon)) {
                this.tray = new Tray(trayIcon);
            } else {
                console.warn('Tray icon not found - skipping tray creation');
            }
        } catch (err) {
            console.error('Failed to create tray icon:', err);
        }

        if (this.tray) {
            // Dynamically compute collapse label based on current config
            const collapsedNow = !!(this.cfgManager && this.cfgManager.config && this.cfgManager.config.ui && this.cfgManager.config.ui.collapsed);
            const collapseLabel = collapsedNow ? 'Uncollapse' : 'Collapse';

            const ctxMenu = Menu.buildFromTemplate([
        { label: 'Show Calendar', click: () => { if (this.win) { try { this.win.showInactive(); } catch (e) { try { this.win.show(); } catch {} } } } },
        { label: 'Open Home', click: () => { try { this.createHomeWindow(); } catch (e) { console.error('open home failed', e); } } },
        { label: collapseLabel, click: () => {
              try {
                // Toggle persisted collapsed state and notify renderer(s)
                if (this.cfgManager && this.cfgManager.config) {
                  const cfg = this.cfgManager.config;
                  cfg.ui = cfg.ui || {};
                  cfg.ui.collapsed = !cfg.ui.collapsed;
                  this.cfgManager.saveConfig(cfg);
                  // Notify main and home windows about new config
                  try { if (this.win && !this.win.isDestroyed()) this.win.webContents.send('config-updated', cfg); } catch (e) {}
                  try { if (this.homeWin && !this.homeWin.isDestroyed()) this.homeWin.webContents.send('config-updated', cfg); } catch (e) {}
                }
                // Also send a direct toggle message to the main window so it can update collapse state immediately
                try { if (this.win && !this.win.isDestroyed()) this.win.webContents.send('toggle-collapse'); } catch (e) {}
              } catch (e) { console.error('tray collapse toggle failed', e); }
            } },
        { label: 'Toggle Click-through', click: () => { try { const next = this.toggleClickThrough(); console.log('click-through toggled ->', next); } catch (e) { console.error(e); } } },
        { label: 'Refresh', click: () => { if (this.win) this.win.webContents.send('refresh-events'); } },
                { type: 'separator' },
                { label: 'Quit', click: () => app.quit() }
            ]);

            this.tray.setContextMenu(ctxMenu);
      this.tray.on('click', () => {
        if (this.win) {
          if (this.win.isVisible()) this.win.hide();
          else { try { this.win.showInactive(); } catch (e) { try { this.win.show(); } catch {} } }
        }
      });
        }
    }
}

// --- Application Initialization ---

app.whenReady().then(() => {
  // Ensure a per-user config exists (copy packaged defaults on first run)
  ensureUserConfigExists();
    // Remove the default application menu so File/Edit/etc. are not visible
    try {
      // In development you may still want the menu; gate if needed
      if (process.env.NODE_ENV !== 'development') {
        Menu.setApplicationMenu(null);
      } else {
        // still remove the menu by default for a cleaner dev window; comment out if you want it
        Menu.setApplicationMenu(null);
      }
    } catch (e) {
      console.warn('Failed to clear application menu', e);
    }
  cfgManager = new ConfigManager(cfgPath);
  // Inform where debug logs will be written
  try { console.log('resize debug logs:', debugLogPathUser, debugLogPathLocal); appendDebugLog('app started'); } catch (e) {}
    icalProcessor = new IcalProcessor(cfgManager, null, null);
    windowManager = new WindowManager(cfgManager, icalProcessor);
    
    windowManager.setupIpcHandlers();
    
    // Check if this is the first launch
    const isFirstLaunch = cfgManager.config.firstLaunch === true;
    console.log('[app.whenReady] First launch:', isFirstLaunch);
    
    if (isFirstLaunch) {
      // First launch: show home window for setup
      console.log('[app.whenReady] Showing home window for first-time setup');
      windowManager.createHomeWindow();
      icalProcessor.homeWindow = windowManager.homeWin;
      
      // Mark first launch as done so next startup goes directly to calendar
      cfgManager.updateConfig({ firstLaunch: false });
    } else {
      // Subsequent launches: show calendar directly
      console.log('[app.whenReady] Showing calendar window (not first launch)');
      windowManager.createMainWindow();
      icalProcessor.mainWindow = windowManager.win;
    }
    
    // Don't create the other window yet; it will be created on-demand via IPC or button click
    
    const interval = (cfgManager.config.ui?.fetchInterval || 1) * 60 * 1000;
    icalProcessor.startPolling(interval);
    windowManager.setupTray();

    // Register a global shortcut to toggle click-through quickly (Ctrl+Shift+C)
    try {
      globalShortcut.register('Control+Shift+C', () => {
        try { const next = windowManager.toggleClickThrough(); console.log('Global shortcut toggled click-through ->', next); } catch (e) { console.error(e); }
      });
      // NOTE: removed global Ctrl+Shift+M registration - collapse toggle will be handled in renderer
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