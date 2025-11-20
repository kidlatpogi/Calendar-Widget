// lib/config-manager.js - Configuration persistence and management
const fs = require('fs');

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
            // ignore save errors silently
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

    updateRootConfig(partial) {
        if (!this.config) this.config = {};
        Object.assign(this.config, partial);
        this.saveConfig();
    }
}

module.exports = ConfigManager;
