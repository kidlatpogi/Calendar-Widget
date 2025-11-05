const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { shell } = require('electron');
const AutoLaunch = require('auto-launch');

// define path to persistent config file used by loadConfig/saveConfig
const cfgPath = path.join(__dirname, 'config.json');

// Add these declarations so handlers can reference the windows safely
let win = null;
let homeWin = null;
let tray = null;
let windowManager = null;
let cfgManager = null;
let icalProcessor = null;

// --- 1. ConfigManager (Single Responsibility for Persistence) ---

// Fallback IPC handler in case IPC calls arrive before WindowManager sets up handlers
try {
  ipcMain.handle('set-click-through', async (event, which, enabled) => {
    try {
      const bw = which === 'home' ? (windowManager && windowManager.homeWin) : (windowManager && windowManager.win);
      if (!bw || bw.isDestroyed()) return false;
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
    
    const windowOptions = {
      width: 400,
      height: 600,
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
            const autoLauncher = new AutoLaunch({
                name: 'Calendar Widget',
                path: app.getPath('exe'),
              });

            const cfg = this.cfgManager?.config || {};
            if (cfg.ui?.autoStart) {
              autoLauncher.enable();
            } else {
              autoLauncher.disable();
            }
        } catch (e) {
            console.error('autoLaunch setup failed', e);
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

        ipcMain.handle('open-main', async () => {
            this.createMainWindow();
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

                    const newW = typeof desiredW === 'number' ? (persist ? desiredW : Math.max(curW, desiredW)) : curW;
                    const newH = typeof desiredH === 'number' ? (persist ? desiredH : Math.max(curH, desiredH)) : curH;

                    try { bw.setContentSize(newW, newH); } catch (e) { /* ignore */ }
                    if (persist && typeof bounds.x === 'number' && typeof bounds.y === 'number') {
                        try { bw.setPosition(Math.round(bounds.x), Math.round(bounds.y)); } catch (e) { /* ignore */ }
                    }
                };

                if (which === 'main') applyFor(this.win);
                if (which === 'home') applyFor(this.homeWin);

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
                        console.log(`  -> parsed ${events.length} events from iCal`);
                        allEvents = allEvents.concat(events);
                    }
                } catch (err) {
                    console.error(`Failed to fetch/parse ${entry.url}:`, err.message);
                }
            }
            console.log(`fetch-events returning ${allEvents.length} total events`);
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
                if (event.summary || event.start) events.push(event);
            }
        } catch (e) {
            console.warn('iCal parse error:', e.message);
        }
        return events;
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
                return `${cleanStr.substring(0, 4)}-${cleanStr.substring(4, 6)}-${cleanStr.substring(6, 8)}T00:00:00Z`;
            }
            if (cleanStr.includes('T')) {
                const [date, time] = cleanStr.split('T');
                const y = date.substring(0, 4);
                const m = date.substring(4, 6);
                const d = date.substring(6, 8);
                const hh = time.substring(0, 2) || '00';
                const mm = time.substring(2, 4) || '00';
                const ss = time.substring(4, 6) || '00';
                return `${y}-${m}-${d}T${hh}:${mm}:${ss}Z`;
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
            const ctxMenu = Menu.buildFromTemplate([
        { label: 'Show Calendar', click: () => { if (this.win) { try { this.win.showInactive(); } catch (e) { try { this.win.show(); } catch {} } } } },
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
    icalProcessor = new IcalProcessor(cfgManager, null, null);
    windowManager = new WindowManager(cfgManager, icalProcessor);
    
    windowManager.setupIpcHandlers();
    windowManager.createMainWindow();
    
    // Update processor references to windows
    icalProcessor.mainWindow = windowManager.win;
    icalProcessor.homeWindow = windowManager.homeWin;
    
    if (!cfgManager.config.acceptedTerms) {
        windowManager.createHomeWindow();
        icalProcessor.homeWindow = windowManager.homeWin;
    }
    
    const interval = (cfgManager.config.ui?.fetchInterval || 1) * 60 * 1000;
    icalProcessor.startPolling(interval);
    windowManager.setupTray();

    // Register a global shortcut to toggle click-through quickly (Ctrl+Shift+C)
    try {
      globalShortcut.register('Control+Shift+C', () => {
        try { const next = windowManager.toggleClickThrough(); console.log('Global shortcut toggled click-through ->', next); } catch (e) { console.error(e); }
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