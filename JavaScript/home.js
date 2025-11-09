// Initialize home window settings - can be called multiple times (idempotent)
async function initializeHomeSettings() {
    class SettingsManager {
      constructor() {
        this.config = null;
      }
  
      async loadConfig() {
        if (!window.electronAPI?.listConfig) throw new Error('IPC not available');
        this.config = await window.electronAPI.listConfig();
        return this.config;
      }
  
      async saveSettings(settings) {
        if (!window.electronAPI?.setConfig) throw new Error('setConfig not available');
        await window.electronAPI.setConfig(settings);
      }
  
      getUIConfig() {
        return this.config?.ui || {};
      }
    }
    
    class ViewManager {
      constructor() {
        this.currentView = null;
      }
    
      hideAll() {
        document.getElementById('after')?.classList.add('hidden');
        document.getElementById('main-menu')?.classList.add('hidden');
        document.getElementById('settings')?.classList.add('hidden');
        document.getElementById('add-ical-view')?.classList.add('hidden');
        // Ensure manage-calendars view is hidden when switching views
        document.getElementById('manage-calendars')?.classList.add('hidden');
        // Also ensure terms modal is hidden when switching views
        document.getElementById('terms-modal')?.classList.add('hidden');
      }
    
      show(viewId) {
        this.hideAll();
        const view = document.getElementById(viewId);
        if (view) {
          view.classList.remove('hidden');
          this.currentView = viewId;
        }
        // hide terms modal proactively (in case it was shown)
        document.getElementById('terms-modal')?.classList.add('hidden');
        setTimeout(() => this.reportSize(), 100);
      }
    
      async reportSize() {
        try {
          const wrap = document.getElementById('wrap');
          if (!wrap || !window.electronAPI?.reportHomeSize) return;
          const rect = wrap.getBoundingClientRect();
          await window.electronAPI.reportHomeSize({ w: Math.ceil(rect.width) + 20, h: Math.ceil(rect.height) + 40 });
        } catch (e) { /* ignore */ }
      }
    }
    
    class AppController {
      constructor() {
        this.settingsManager = new SettingsManager();
        this.viewManager = new ViewManager();
      }
    
      async init() {
        try {
          await this.settingsManager.loadConfig();
          const config = this.settingsManager.config;
          
          // Initialize terms checkbox from persisted config
          const termsCheck = document.getElementById('terms-check');
          const acceptBtn = document.getElementById('accept-btn');
          if (termsCheck) termsCheck.checked = !!config.acceptedTerms;
          if (acceptBtn) acceptBtn.disabled = !termsCheck.checked;

          if (config.acceptedTerms) {
            this.viewManager.show('main-menu');
          } else {
            this.viewManager.show('after');
          }
          
          this.loadSettingsUI();
          this.setupEventListeners();
        } catch (e) {
          console.error('Init failed', e);
          this.viewManager.show('after');
        }
      }
    
      loadSettingsUI() {
        const ui = this.settingsManager.getUIConfig();
        
        document.getElementById('auto-start').checked = ui.autoStart || false;
        document.getElementById('fetch-interval').value = ui.fetchInterval || 1;
        document.getElementById('font-family').value = ui.fontFamily || 'Segoe UI';
          document.getElementById('font-size').value = ui.fontSize || 13;
        document.getElementById('schedule-color').value = ui.scheduleColor || '#ffffff';
        document.getElementById('datetime-color').value = ui.dateTimeColor || '#cfe9ff';
        document.getElementById('highlight-color').value = ui.highlightColor || '#a3ff33';
  document.getElementById('day-color').value = ui.dayColor || '#ffffff';
  document.getElementById('date-color').value = ui.dateColor || '#cfe9ff';
  document.getElementById('upcoming-color').value = ui.upcomingColor || '#a3ff33';
  // Display settings
  document.getElementById('display-days').value = ui.displayDays || 7;
  document.getElementById('date-spacing').value = ui.dateSpacing || 16;
  // Clock settings
  document.getElementById('show-clock').checked = ui.showClock !== false;
  document.getElementById('clock-color').value = ui.clockColor || '#ffffff';
  document.getElementById('clock-font-family').value = ui.clockFontFamily || 'Segoe UI';
  document.getElementById('clock-size').value = ui.clockSize || 18;
  document.getElementById('clock-alignment').value = ui.clockAlignment || 'left';
  document.getElementById('clock-12hour').checked = ui.clock12Hour === true;
  // Mark as done settings
  document.getElementById('enable-mark-done').checked = ui.enableMarkDone !== false;
  document.getElementById('mark-done-method').value = ui.markDoneMethod || 'right-click';
  document.getElementById('show-completed-events').checked = ui.showCompletedEvents !== false;
  document.getElementById('show-empty-days').checked = ui.showEmptyDays !== false;
  document.getElementById('auto-clear-on-refresh').checked = ui.autoClearOnRefresh === true;
      }
    
      setupEventListeners() {
        // Accept Terms
        const termsCheckEl = document.getElementById('terms-check');
        const acceptBtnEl = document.getElementById('accept-btn');
        if (termsCheckEl) {
          termsCheckEl.addEventListener('change', (ev) => {
            try { if (acceptBtnEl) acceptBtnEl.disabled = !ev.target.checked; } catch (e) { /* ignore */ }
          });
        }
        if (acceptBtnEl) acceptBtnEl.addEventListener('click', () => this.acceptTerms());
        
        // Navigation
        document.getElementById('settings-btn')?.addEventListener('click', () => this.viewManager.show('settings'));
        document.getElementById('add-ical-btn')?.addEventListener('click', () => this.viewManager.show('add-ical-view'));
        // Manage Calendars
        // Create a 'Manage' button in main menu if not present
        let manageBtn = document.getElementById('manage-calendars-btn');
        if (!manageBtn) {
          // Insert a visible Manage Calendars button into the main menu
          manageBtn = document.createElement('button');
          manageBtn.id = 'manage-calendars-btn';
          manageBtn.type = 'button';
          manageBtn.textContent = 'Manage Calendars';
          manageBtn.className = 'primary';
          const mm = document.getElementById('main-menu');
          if (mm) mm.appendChild(manageBtn);
        }
        manageBtn.addEventListener('click', async () => {
          try {
            this.viewManager.show('manage-calendars');
            // Populate list once the view is visible
            try { await this.populateCalendarList(); } catch (e) { /* ignore */ }
          } catch (e) { console.error('manage btn click failed', e); }
        });
        document.getElementById('back-from-manage')?.addEventListener('click', () => this.viewManager.show('main-menu'));
        document.getElementById('back-to-main')?.addEventListener('click', () => this.viewManager.show('main-menu'));
        
        // Open Calendar
        document.getElementById('open-main')?.addEventListener('click', () => this.openCalendar());
        
        // Settings Actions
        document.getElementById('save-settings')?.addEventListener('click', () => this.saveSettings());
        
        // Handle fetch interval change (show/hide custom input)
        const fetchIntervalEl = document.getElementById('fetch-interval');
        const customIntervalEl = document.getElementById('custom-fetch-interval');
        const customIntervalGroupEl = document.getElementById('custom-interval-group');
        if (fetchIntervalEl) {
          fetchIntervalEl.addEventListener('change', (ev) => {
            // Custom interval feature can be added later if needed
            // For now, just sync the value
          });
        }
        
        // Live preview & persist font-size on change (debounced)
        const fontSizeEl = document.getElementById('font-size');
        if (fontSizeEl) {
          let _t = null;
          fontSizeEl.addEventListener('input', (ev) => {
            try {
              const v = Number(ev.target.value) || 13;
              document.documentElement.style.setProperty('--app-font-size', v + 'px');
              // update derived sizes too (small/large)
              document.documentElement.style.setProperty('--app-font-small', Math.max(10, v - 2) + 'px');
              document.documentElement.style.setProperty('--app-font-large', Math.max(12, v + 1) + 'px');
              if (_t) clearTimeout(_t);
              _t = setTimeout(async () => {
                try { await window.electronAPI.setConfig({ fontSize: Number(v) }); } catch (e) {}
              }, 350);
            } catch (e) { /* ignore */ }
          });
        }
        document.getElementById('cancel-settings')?.addEventListener('click', () => this.viewManager.show('main-menu'));
        
        // Add Calendar
        document.getElementById('add-ical')?.addEventListener('click', () => this.addCalendar());
        
        // Terms & GitHub
        document.getElementById('view-terms')?.addEventListener('click', () => this.showTermsModal());
        document.getElementById('close-terms')?.addEventListener('click', () => this.hideTermsModal());
  document.getElementById('github-btn')?.addEventListener('click', () => window.electronAPI.openUrl('https://github.com/kidlatpogi/Calendar-Widget'));
  // Footer external links - open in default browser via preload
  document.getElementById('footer-github')?.addEventListener('click', () => window.electronAPI.openUrl('https://github.com/kidlatpogi'));
  document.getElementById('footer-portfolio')?.addEventListener('click', () => window.electronAPI.openUrl('https://www.zeusbautista.site/'));
        // Tutorial
        document.getElementById('tutorial-btn')?.addEventListener('click', async () => {
          try {
            const ok = await window.electronAPI.openTutorial();
            if (!ok) alert('Unable to open tutorial PDF.');
          } catch (e) {
            alert('Failed to open tutorial: ' + e.message);
          }
        });
        // Debug: clear memory button wiring (if present)
        document.getElementById('dbg-clear-memory')?.addEventListener('click', async () => {
          try {
            const resEl = document.getElementById('dbg-clear-result');
            if (resEl) resEl.textContent = 'Clearing...';
            const r = await window.electronAPI.clearMemory();
            if (r && r.ok) {
              if (resEl) resEl.textContent = 'Memory cleared (main+renderer notified)';
            } else {
              if (resEl) resEl.textContent = 'Error: ' + (r && r.error ? r.error : 'unknown');
            }
          } catch (e) {
            const resEl = document.getElementById('dbg-clear-result');
            if (resEl) resEl.textContent = 'Failed: ' + e.message;
          }
        });
        
  // Use native window controls (OS title bar) — no custom handlers needed
      }
    
      async acceptTerms() {
        const termsCheck = document.getElementById('terms-check');
        if (!termsCheck?.checked) {
          alert('Please accept the terms first');
          return;
        }
        try {
          await window.electronAPI.acceptTerms();
          this.viewManager.show('main-menu');
        } catch (e) {
          alert('Failed to accept terms');
        }
      }
    
      async openCalendar() {
        const btn = document.getElementById('open-main');
        try {
          btn.disabled = true;
          btn.textContent = 'Opening...';
          await window.electronAPI.openMain();
          setTimeout(() => {
            btn.disabled = false;
            btn.textContent = 'Open Calendar';
          }, 1000);
        } catch (e) {
          console.error('Failed to open calendar', e);
          btn.disabled = false;
          btn.textContent = 'Open Calendar';
        }
      }
    
      async addCalendar() {
        const url = document.getElementById('ical-url').value.trim();
        if (!url) {
          alert('Please enter a valid iCal URL');
          return;
        }
    
        const btn = document.getElementById('add-ical');
        const status = document.getElementById('status');
        try {
          btn.disabled = true;
          btn.textContent = 'Adding...';
          
          await window.electronAPI.addIcal(url);
          
          status.textContent = '✓ Calendar added! Please refresh your calendar.';
          status.classList.remove('error');
          status.classList.add('success');
          status.textContent = '✓ Calendar added! Please refresh your calendar.';
          
          document.getElementById('ical-url').value = '';
          
          setTimeout(() => {
            status.textContent = '';
            status.classList.remove('success');
            btn.disabled = false;
            btn.textContent = 'Add';
          }, 3000);
        } catch (e) {
          alert('Failed to add calendar: ' + e.message);
          btn.disabled = false;
          btn.textContent = 'Add';
        }
      }

      // Populate calendar list in Manage view
      async populateCalendarList() {
        try {
          const cfg = await window.electronAPI.listConfig();
          const list = document.getElementById('cal-list');
          if (!list) return;
          list.innerHTML = '';
          const icals = Array.isArray(cfg.icals) ? cfg.icals : [];
          if (icals.length === 0) {
            list.innerHTML = '<div class="no-events">No calendars added</div>';
            return;
          }
          let idx = 1;
          for (const it of icals) {
            const url = (typeof it === 'string') ? it : (it.url || '');
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.justifyContent = 'space-between';
            row.style.alignItems = 'center';
            row.style.padding = '6px 4px';
            const txt = document.createElement('div');
            // Mask the URL for privacy: show hostname + short label, full URL in tooltip
            let label = url;
            try {
              const u = new URL(url);
              const pathParts = u.pathname.split('/').filter(Boolean);
              const last = pathParts.length > 0 ? pathParts[pathParts.length-1] : '';
              label = `${u.hostname}${last ? ' / ' + last : ''} (${idx})`;
            } catch (e) {
              // fallback to short display
              label = (url.length > 40) ? url.slice(0, 28) + '…' + url.slice(-8) : url;
            }
            txt.textContent = label;
            txt.title = url; // full URL on hover
            txt.style.flex = '1';
            // Force single-line truncation to avoid vertical char stacking
            txt.style.whiteSpace = 'nowrap';
            txt.style.overflow = 'hidden';
            txt.style.textOverflow = 'ellipsis';
            txt.style.wordBreak = 'normal';
            const del = document.createElement('button');
            del.textContent = 'Delete';
            del.style.marginLeft = '8px';
            del.className = 'secondary';
            del.addEventListener('click', async () => {
              if (!confirm('Delete this calendar? This will remove it from the app.')) return;
              try {
                const res = await window.electronAPI.removeIcal(url);
                if (res && res.ok) {
                  row.remove();
                  // Also request renderer cleanup (main process already triggers refresh+cleanup)
                } else {
                  alert('Failed to remove calendar: ' + (res && res.error ? res.error : 'unknown'));
                }
              } catch (e) {
                alert('Failed to remove calendar: ' + e.message);
              }
            });
            row.appendChild(txt);
            row.appendChild(del);
            list.appendChild(row);
            idx++;
          }
        } catch (e) { /* ignore */ }
      }
    
      async saveSettings() {
        try {
          const settings = {
            autoStart: document.getElementById('auto-start').checked,
            fetchInterval: Number(document.getElementById('fetch-interval').value),
            fontFamily: document.getElementById('font-family').value,
            fontSize: Number(document.getElementById('font-size').value),
            scheduleColor: document.getElementById('schedule-color').value,
            dateTimeColor: document.getElementById('datetime-color').value,
            highlightColor: document.getElementById('highlight-color').value
            ,dayColor: document.getElementById('day-color').value
            ,dateColor: document.getElementById('date-color').value
            ,upcomingColor: document.getElementById('upcoming-color').value
            ,displayDays: Number(document.getElementById('display-days').value) || 7
            ,dateSpacing: Number(document.getElementById('date-spacing').value) || 16
            ,showClock: document.getElementById('show-clock').checked
            ,clockColor: document.getElementById('clock-color').value
            ,clockFontFamily: document.getElementById('clock-font-family').value
            ,clockSize: Number(document.getElementById('clock-size').value) || 18
            ,clockAlignment: document.getElementById('clock-alignment').value
            ,clock12Hour: document.getElementById('clock-12hour').checked
            ,enableMarkDone: document.getElementById('enable-mark-done').checked
            ,markDoneMethod: document.getElementById('mark-done-method').value
            ,showCompletedEvents: document.getElementById('show-completed-events').checked
            ,showEmptyDays: document.getElementById('show-empty-days').checked
            ,autoClearOnRefresh: document.getElementById('auto-clear-on-refresh').checked
          };
    
          await this.settingsManager.saveSettings(settings);
          // Keep the settings view open (do not automatically navigate away).
          // Refresh local copy of config and update UI so persisted values are reflected.
          try {
            await this.settingsManager.loadConfig();
            this.loadSettingsUI();
          } catch (e) { /* ignore reload errors */ }
          // Show a brief status message instead of closing the settings view
          const status = document.getElementById('status');
          if (status) {
            status.textContent = 'Settings saved!';
            status.classList.add('success');
            setTimeout(() => { try { status.textContent = ''; status.classList.remove('success'); } catch (e) {} }, 1800);
          }
        } catch (e) {
          console.error('[saveSettings] error:', e);
          alert('Failed to save settings: ' + e.message);
        }
      }
    
      showTermsModal() {
        document.getElementById('terms-modal')?.classList.remove('hidden');
      }
    
      hideTermsModal() {
        document.getElementById('terms-modal')?.classList.add('hidden');
      }
    }
    
    // Initialize app on DOMContentLoaded
    const app = new AppController();
    await app.init();
}

// Start initialization immediately if DOM is ready, or wait for DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeHomeSettings);
} else {
  // DOM already loaded (happens with dynamic script loading)
  initializeHomeSettings().catch(err => console.error('Error initializing home settings:', err));
}