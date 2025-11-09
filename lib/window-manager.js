// lib/window-manager.js - Window lifecycle, IPC handlers, and event fetching
const { BrowserWindow, ipcMain, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const EventParser = require('./event-parser');

// Lazy-load AutoLaunch only when needed (saves ~2MB on startup)
let AutoLaunch = null;
const getAutoLauncher = () => {
  if (!AutoLaunch) {
    AutoLaunch = require('auto-launch');
  }
  return AutoLaunch;
};

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
      icon: path.join(__dirname, '..', 'assets', 'calendar.ico'),
      webPreferences: { 
        preload: path.join(__dirname, '..', 'preload.js'), 
        nodeIntegration: false,
        enableRemoteModule: false,
        sandbox: true,
        contextIsolation: true,
        // Memory optimizations for lightweight widget
        enableBlinkFeatures: [],
        disableBlinkFeatures: ['AutomationControlled']
      }
    };

    // Only set position if it exists
    if (windowPos.x !== undefined && windowPos.y !== undefined) {
      windowOptions.x = windowPos.x;
      windowOptions.y = windowPos.y;
    }

    this.win = new BrowserWindow(windowOptions);
    try { this.win.setMenuBarVisibility(false); } catch (e) { /* ignore */ }
    this.win.loadFile(path.join(__dirname, '..', 'HTML', 'index.html'));

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
      try { this.win.setOpacity(opacity); } catch (e) { /* ignore */ }
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
    // Get screen dimensions for responsive sizing
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
    
    // Use 90% of screen width/height, with max sizes for larger screens
    const windowWidth = Math.min(1200, Math.floor(screenWidth * 0.9));
    const windowHeight = Math.min(700, Math.floor(screenHeight * 0.85));
    
    this.homeWin = new BrowserWindow({
      width: windowWidth,
      height: windowHeight,
      minWidth: 400,
      minHeight: 500,
      // Use native frame for home window as well
      transparent: false,
      frame: true,
      alwaysOnTop: false,
      skipTaskbar: false,
      autoHideMenuBar: true,
      icon: path.join(__dirname, '..', 'assets', 'calendar.ico'),
      webPreferences: { 
        preload: path.join(__dirname, '..', 'preload.js'), 
        nodeIntegration: false,
        enableRemoteModule: false,
        sandbox: true,
        contextIsolation: true,
        // Memory optimizations for lightweight widget
        enableBlinkFeatures: [],
        disableBlinkFeatures: ['AutomationControlled']
      }
    });

    this.homeWin.loadFile(path.join(__dirname, '..', 'HTML', 'home.html'));
    try { this.homeWin.setMenuBarVisibility(false); } catch (e) { /* ignore */ }
    this.homeWin.once('ready-to-show', () => {
      try { this.homeWin.showInactive(); } catch (e) { try { this.homeWin.show(); } catch {} }
      
      // Trigger lazy loading of home.js script (code-splitting)
      try {
        this.homeWin.webContents.executeJavaScript(`
          if (typeof initializeHomeWindow === 'function') {
            initializeHomeWindow().catch(() => {});
          }
        `).catch(() => {});
      } catch (err) {
        // ignore lazy-load failures
      }
    });
    
    // Clean up homeWin reference when closed to free memory
    this.homeWin.on('closed', () => {
      this.homeWin = null;
    });
  }

    setupAutoLaunch() {
        try {
      // Don't enable auto-launch during development (avoid registering electron.exe)
      if (!require('electron').app.isPackaged) {
        return;
      }
      
            const exePath = require('electron').app.getPath('exe');
            const AutoLauncherClass = getAutoLauncher();
            
            const autoLauncher = new AutoLauncherClass({
                name: 'Calendar Widget',
                path: exePath,
              });

            const cfg = this.cfgManager?.config || {};
            const shouldAutoStart = cfg.ui?.autoStart || false;
            
            if (shouldAutoStart) {
              autoLauncher.enable().catch((err) => {
                  // ignore auto-launch enable failures
              });
            } else {
              autoLauncher.disable().catch((err) => {
                  // ignore auto-launch disable failures
              });
            }
    } catch (e) {
      // ignore auto-launch exceptions
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
          // ignore toggleClickThrough failures
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
                  // ignore fetch-events failures
            
            return cfg;
        });

        // Allow renderer to request window movement by a delta (used for custom drag)
        ipcMain.handle('move-window-by', (ev, dx, dy) => {
          try {
            const w = this.win || this.homeWin;
            if (!w) return false;
            const bounds = w.getBounds();
            w.setBounds({ x: bounds.x + Math.round(dx), y: bounds.y + Math.round(dy), width: bounds.width, height: bounds.height });
            return true;
          } catch (e) {
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
        const pdfPath = path.join(__dirname, '..', 'Public', 'How to get ICal link.pdf');
        if (fs.existsSync(pdfPath)) {
          const res = await shell.openPath(pdfPath);
          if (res) return false;
          return true;
        }
        return false;
      } catch (e) {
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

        ipcMain.handle('get-config', async () => this.cfgManager.config);

        ipcMain.handle('save-config', async (ev, cfg) => {
          if (this.cfgManager && cfg) {
            // Merge with existing config
            Object.assign(this.cfgManager.config, cfg);
            await this.cfgManager.saveConfig();
            
            // Broadcast config update to all windows
            const sendUpdate = (win) => { if (win && !win.isDestroyed()) win.webContents.send('config-updated', this.cfgManager.config); };
            sendUpdate(this.win);
            sendUpdate(this.homeWin);
            
            return true;
          }
          return false;
        });

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
                    let finalH = newH;
                    let finalW = newW;
                    if (typeof finalH === 'number') finalH = Math.min(finalH, maxContentH);
                    if (typeof finalW === 'number') finalW = Math.min(finalW, maxContentW);
                    try { targetWin.setContentSize(finalW, finalH); } catch (e) { /* ignore */ }
                    try { targetWin.getContentSize(); } catch (e) {}
                  }
                } catch (e) { /* ignore display calc errors */ }

                return true;
      } catch (e) {
        throw e;
      }
        });
        
        ipcMain.handle('fetch-events', async (event) => {
          try {
            const events = await this._fetchEventsLogic();
            return events;
          } catch (e) {
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
            return false;
          }
        });

        // (set-click-through handler is registered in main.js as a fallback)

        ipcMain.handle('set-event-notifications', async (event, isEnabled) => {
          try {
            if (this.cfgManager) {
              this.cfgManager.updateConfig({ eventNotifications: isEnabled });
            }
            return true;
          } catch (e) {
            return false;
          }
        });

        ipcMain.handle('show-notification', async (event, { title, message }) => {
          const { Notification } = require('electron');
          const cfg = this.cfgManager?.config || {};
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
          } catch (e) { return false; }
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
            
            const eventIds = new Set(); // Deduplicate events by ID
            
            for (const entry of icals) {
        try {
                    const url = (entry.url || '').trim();
                    if (!url) continue;
                    const headers = {};
                    if (entry.etag) headers['If-None-Match'] = entry.etag;
                    if (entry.lastModified) headers['If-Modified-Since'] = entry.lastModified;
                    const res = await this.processor.fetchText(url, headers);
                    if (res.status === 304 || !res.body) {
                        continue;
                    }
                    if (res.body && typeof res.body === 'string') {
                        const events = EventParser.parseIcal(res.body);
                        // Filter to only keep events from TODAY onwards (no past events)
                        for (const ev of events) {
                            const start = ev.start?.date || ev.start?.dateTime;
                            if (!start) continue;
                            const startDate = new Date(start);
                            // Compare at midnight level to include all events starting today
                            const eventDay = new Date(startDate);
                            eventDay.setHours(0, 0, 0, 0);
                            if (eventDay < today || eventDay > futureDate) continue;
                            
                            // Deduplicate by creating event fingerprint (summary + start time)
                            const eventId = `${ev.summary || ''}|${start}`;
                            if (!eventIds.has(eventId)) {
                                eventIds.add(eventId);
                                allEvents.push(ev);
                            }
                        }
                        // Clear res.body from memory immediately
                        res.body = null;
                    }
        } catch (err) {
          // ignore fetch/parse failures
        }
            }
        // ignore fetch/parse failures
            return allEvents;
    } catch (e) {
      return [];
    }
    }

    setupTray() {
        const { Tray, Menu, app } = require('electron');
        try {
            const trayIcon = path.join(__dirname, '..', 'assets', 'calendar.ico');
            if (fs.existsSync(trayIcon)) {
                this.tray = new Tray(trayIcon);
      } else {
        // Tray icon not found - skipping tray creation
      }
    } catch (err) {
      // Failed to create tray icon: intentionally silenced
    }

    if (this.tray) {
            const ctxMenu = Menu.buildFromTemplate([
    { label: 'Show Calendar', click: () => { if (this.win) { try { this.win.showInactive(); } catch (e) { try { this.win.show(); } catch {} } } } },
    { label: 'Open Home', click: () => { try { this.createHomeWindow(); } catch (e) { /* open home failed - silenced */ } } },
        { label: 'Show/Hide Buttons', click: () => {
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
      } catch (e) { /* tray collapse toggle failed - silenced */ }
            } },
    { label: 'Toggle Click-through', click: () => { try { this.toggleClickThrough(); } catch (e) { /* silenced */ } } },
        { label: 'Refresh', click: () => { 
            // FIX: Trigger actual polling + send IPC to renderer
            if (this.processor) {
              this.processor.pollICalsOnce().catch(() => {});
            }
            if (this.win) this.win.webContents.send('refresh-events'); 
        } },
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

module.exports = WindowManager;
