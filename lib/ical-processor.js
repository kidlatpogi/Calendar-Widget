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

module.exports = IcalProcessor;
