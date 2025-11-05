document.addEventListener('DOMContentLoaded', async () => {
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
  // Display settings
  document.getElementById('display-days').value = ui.displayDays || 7;
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
        document.getElementById('back-to-main')?.addEventListener('click', () => this.viewManager.show('main-menu'));
        
        // Open Calendar
        document.getElementById('open-main')?.addEventListener('click', () => this.openCalendar());
        
        // Settings Actions
        document.getElementById('save-settings')?.addEventListener('click', () => this.saveSettings());
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
  document.getElementById('github-btn')?.addEventListener('click', () => window.electronAPI.openUrl('https://github.com/your-repo'));
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
            ,displayDays: Number(document.getElementById('display-days').value) || 7
          };
    
          await this.settingsManager.saveSettings(settings);
          alert('Settings saved!');
          this.viewManager.show('main-menu');
        } catch (e) {
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
});