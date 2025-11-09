// lib/ical-processor.js - iCal fetching, parsing, and polling
const http = require('http');
const https = require('https');
const crypto = require('crypto');

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

                                // Ensure we have a map to track inflight requests and body refs
                                try {
                                        if (!this._urlMeta || !(this._urlMeta instanceof Map)) this._urlMeta = new Map();
                                } catch (e) { this._urlMeta = new Map(); }

                                const meta = { req: null, bodyRef: null };
                                try { this._urlMeta.set(url, meta); } catch (e) { /* ignore */ }

                                const req = lib.get(u, opts, (res) => {
                  if (res.statusCode === 304) {
                                        res.resume();
                                        try { this._urlMeta.delete(url); } catch (e) {}
                                        return resolve({ status: 304 });
                  }

                  let body = '';
                                    // expose current body buffer for potential clearing
                                    meta.bodyRef = body;
                  res.setEncoding('utf8');
                  res.on('data', (c) => { body += c; });
                  res.on('end', () => {
                                        const etag = res.headers && res.headers['etag'] ? res.headers['etag'] : null;
                    const lastModified = res.headers && res.headers['last-modified'] ? res.headers['last-modified'] : null;
                    
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        // Successful response: cleanup tracked bodyRef to allow GC and return body
                        try { meta.bodyRef = null; } catch (e) {}
                        try { this._urlMeta.delete(url); } catch (e) {}
                        resolve({ status: res.statusCode, body, etag, lastModified });
                    } else {
                        // HTTP error: cleanup and reject (no console output)
                        try { meta.bodyRef = null; } catch (e) {}
                        try { this._urlMeta.delete(url); } catch (e) {}
                        reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0, 200)}`));
                    }
                  });
                });

                req.on('error', (err) => {
                    // network error - cleanup and reject (silenced)
                    try { this._urlMeta.delete(url); } catch (e) {}
                    reject(err);
                });

                req.on('timeout', () => {
                    try { req.destroy(); } catch (e) {}
                    try { this._urlMeta.delete(url); } catch (e) {}
                    // timeout - reject without logging
                    reject(new Error('timeout'));
                });
            } catch (err) {
                // parse error - reject without logging
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
                // fetch error - skip and mark checked
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

    /**
     * Minimal in-memory cleanup for a given iCal URL.
     * This removes ephemeral metadata stored on the config entry (if any)
     * and attempts to abort any in-flight request if the implementation
     * later tracks controllers/handles.
     */
    clearCacheForUrl(url) {
        try {
            if (!url) return { ok: false, error: 'no url' };

            // Remove ephemeral fields from config entries (non-destructive)
            try {
                const cfg = this.cfgManager && this.cfgManager.config;
                if (cfg && Array.isArray(cfg.icals)) {
                    for (const it of cfg.icals) {
                        const u = (typeof it === 'string') ? it : (it.url || '');
                        if (!u) continue;
                        if (u === url) {
                            // Delete ephemeral / internal fields
                            if (it._lastHash) delete it._lastHash;
                            if (it._lastChecked) delete it._lastChecked;
                            if (it._lastBody) delete it._lastBody;
                            if (it._lastFetch) delete it._lastFetch;
                        }
                    }
                    // Persist config to ensure metadata is cleared on disk as well
                    try { this.cfgManager.saveConfig(); } catch (e) { /* ignore */ }
                }
            } catch (e) {
                // ignore config cleanup errors
            }

            // If a future implementation tracks controllers or bodyRefs per-URL in-memory,
            // delete or abort them here. We check for a private map if it exists.
            try {
                if (this._urlMeta && this._urlMeta instanceof Map) {
                    const meta = this._urlMeta.get(url);
                    if (meta) {
                        if (meta.controller && typeof meta.controller.abort === 'function') {
                            try { meta.controller.abort(); } catch (e) { /* ignore */ }
                        }
                        if (meta.bodyRef) meta.bodyRef = null;
                        this._urlMeta.delete(url);
                    }
                }
            } catch (e) { /* ignore */ }

            return { ok: true };
        } catch (e) {
            return { ok: false, error: String(e) };
        }
    }
}

module.exports = IcalProcessor;
