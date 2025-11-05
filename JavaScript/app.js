// Minimal event loader + renderer for the calendar UI

const listEl = document.getElementById('list');
const statusEl = document.getElementById('status');
const refreshBtn = document.getElementById('refresh');
const homeBtn = document.getElementById('home-btn');
const controlsEl = document.getElementById('control-actions');

// click-through toggle button (injected)
let clickThroughEnabled = false;
const ctBtn = document.createElement('button');
ctBtn.id = 'clickthrough-btn';
ctBtn.title = 'Toggle click-through (allow clicks to pass through widget)';
ctBtn.textContent = 'Click-through: Off';
ctBtn.style.marginLeft = '6px';
ctBtn.style.border = '1px solid rgba(255,255,255,0.16)';
ctBtn.style.background = 'rgba(255,255,255,0.02)';
ctBtn.style.color = '#fff';
ctBtn.style.padding = '6px 8px';
ctBtn.style.borderRadius = '6px';
ctBtn.style.cursor = 'pointer';
if (controlsEl) controlsEl.appendChild(ctBtn);
else document.body.appendChild(ctBtn);

// Make the toggle button keyboard-accessible and show hotkey
ctBtn.tabIndex = 0;
ctBtn.title = ctBtn.title + ' — Hotkey: Ctrl+Shift+C';
ctBtn.addEventListener('keydown', async (ev) => {
  try {
    if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
      ev.preventDefault();
      ctBtn.click();
    }
  } catch (e) { /* ignore */ }
});

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg || '';
}

function formatLocalDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function parseEventDateObj(dtObj) {
  if (!dtObj) return null;
  
  if (dtObj.date) {
    const parts = dtObj.date.split('-').map(Number);
    const d = new Date(parts[0], parts[1]-1, parts[2], 12, 0, 0);
    return d;
  }
  
  if (dtObj.dateTime) {
    let dateStr = dtObj.dateTime;
    if (dateStr.endsWith('Z')) {
      return new Date(dateStr);
    } else {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) return d;
    }
  }
  
  return null;
}

function render(items, displayDays = 7) {
  if (!Array.isArray(items) || items.length === 0) {
    if (listEl) listEl.innerHTML = '<div class="no-events">No events</div>';
    return;
  }

  const today = new Date();
  today.setHours(0,0,0,0);
  const todayKey = formatLocalDateKey(today);
  
  // Include past events within 24 hours
  const oneDayAgo = new Date(today);
  oneDayAgo.setDate(today.getDate() - 1);
  
  const groups = {};
  
  for (const ev of items) {
    const start = parseEventDateObj(ev.start || {});
    if (!start || isNaN(start.getTime())) continue;
    
    const eventDate = new Date(start);
    eventDate.setHours(0,0,0,0);
    
    // Include past events (within 24 hrs) + today + future events
    if (eventDate < oneDayAgo) continue;
    
    const key = formatLocalDateKey(start);
    groups[key] = groups[key] || [];
    groups[key].push({ ev, start });
  }

  // Build display: show displayDays days starting from today (even if empty)
  const displayDays_clamped = Math.max(5, Math.min(14, displayDays || 7));
  const days = [];
  for (let i = 0; i < displayDays_clamped; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d);
  }
  
  const now = new Date();
  let out = '';
  for (const d of days) {
    const key = formatLocalDateKey(d);
    const isTodayKey = key === todayKey;
    
    out += `<div class="day"><div class="day-header ${isTodayKey ? 'highlight' : ''}">${d.toDateString()}</div>`;
    const group = groups[key] || [];
    
    if (group.length === 0) {
      out += `<div class="no-events">No events</div>`;
    } else {
      group.sort((a,b)=> a.start - b.start);
      for (const g of group) {
        const ev = g.ev;
        let timeText = '';
        
        if (ev.start && ev.start.date) {
          timeText = 'All day';
        } else {
          const s = parseEventDateObj(ev.start || {});
          if (s && !isNaN(s.getTime())) {
            timeText = s.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
            const e = parseEventDateObj(ev.end || {});
            if (e && !isNaN(e.getTime()) && e.getTime() !== s.getTime()) {
              timeText += ' – ' + e.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
            }
          }
        }
        
        // Check if event is in the past
        const isPast = g.start < now;
        const strikethrough = isPast ? 'text-decoration: line-through; opacity: 0.6;' : '';
        
        out += `<div class="event" style="${strikethrough}">${timeText ? `<span class="time">${timeText}</span> • ` : ''}<span class="title">${ev.summary || 'No title'}</span></div>`;
      }
    }
    out += `</div>`;
  }

  if (listEl) listEl.innerHTML = out;
  setTimeout(reportAppSize, 80);
}

async function load() {
  setStatus('Loading events...');
  try {
    if (!window.electronAPI || !window.electronAPI.listConfig) throw new Error('IPC not available');
    
    const cfg = await window.electronAPI.listConfig();
    if (!cfg.acceptedTerms) {
      if (listEl) listEl.innerHTML = '<div class="no-events">Please accept Terms & Conditions first.</div>';
      setStatus('');
      return;
    }

    if (!window.electronAPI.fetchEvents) throw new Error('fetchEvents not available');
    const items = await window.electronAPI.fetchEvents();
    
    // Get display days from config (default 7, min 5, max 14)
    const displayDays = cfg.ui?.displayDays || 7;
    render(items, displayDays);
    
    // Check for upcoming events and show notification if enabled
    if (cfg.ui?.eventNotifications && items.length > 0) {
      const now = new Date();
      const soon = new Date(now.getTime() + 15 * 60000); // Next 15 minutes
      
      for (const ev of items) {
        const start = parseEventDateObj(ev.start || {});
        if (start && start > now && start <= soon) {
          const timeText = start.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
          if (window.electronAPI?.showNotification) {
            await window.electronAPI.showNotification(ev.summary, timeText);
          }
        }
      }
    }
    
    setStatus('');
  } catch (err) {
    console.error('load failed', err);
    setStatus('Failed to load events');
    if (listEl) listEl.innerHTML = '<div class="no-events">Error loading events</div>';
  }
}

async function reportAppSize() {
  try {
    const el = document.getElementById('app');
    if (!el || !window.electronAPI || !window.electronAPI.setWindowBounds) return;
    const rect = el.getBoundingClientRect();
    await window.electronAPI.setWindowBounds('main', { 
      width: Math.ceil(rect.width), 
      height: Math.ceil(rect.height), 
      persist: false 
    });
  } catch (e) { /* ignore */ }
}

async function applyUiFromConfig(cfg) {
  try {
    if (!cfg || !cfg.ui) return;
    const ui = cfg.ui;
    const root = document.documentElement;
    
    if (ui.fontFamily) root.style.setProperty('--app-font-family', ui.fontFamily);
    if (ui.fontSize) root.style.setProperty('--app-font-size', `${ui.fontSize}px`);
    if (ui.scheduleColor) root.style.setProperty('--schedule-color', ui.scheduleColor);
    if (ui.dateTimeColor) root.style.setProperty('--date-time-color', ui.dateTimeColor);
    if (ui.highlightColor) root.style.setProperty('--highlight-color', ui.highlightColor);
  } catch (e) { /* ignore */ }
}

if (refreshBtn) refreshBtn.addEventListener('click', load);
if (homeBtn) homeBtn.addEventListener('click', async () => {
  try { await window.electronAPI.openHome(); }
  catch (e) { console.error('openHome failed', e); setStatus('Failed to open welcome'); }
});

// Toggle click-through permanently
if (ctBtn) ctBtn.addEventListener('click', async () => {
  try {
    clickThroughEnabled = !clickThroughEnabled;
    ctBtn.textContent = 'Click-through: ' + (clickThroughEnabled ? 'On' : 'Off');
    if (window.electronAPI && window.electronAPI.setClickThrough) {
      await window.electronAPI.setClickThrough('main', clickThroughEnabled);
    }
    // Persist setting in config UI
    if (window.electronAPI && window.electronAPI.setConfig) {
      await window.electronAPI.setConfig({ clickThrough: !!clickThroughEnabled });
    }
  } catch (e) { console.error('toggle click-through failed', e); }
});

// Keyboard fallback: Ctrl+Shift+C toggles click-through from the renderer in case the on-screen control is unreachable
window.addEventListener('keydown', async (ev) => {
  try {
    if (ev.ctrlKey && ev.shiftKey && (ev.code === 'KeyC' || ev.key === 'C' || ev.key === 'c')) {
      ev.preventDefault();
      clickThroughEnabled = !clickThroughEnabled;
      if (ctBtn) ctBtn.textContent = 'Click-through: ' + (clickThroughEnabled ? 'On' : 'Off');
      if (window.electronAPI && window.electronAPI.setClickThrough) await window.electronAPI.setClickThrough('main', clickThroughEnabled);
      if (window.electronAPI && window.electronAPI.setConfig) await window.electronAPI.setConfig({ clickThrough: !!clickThroughEnabled });
    }
  } catch (e) { /* ignore */ }
});

// When click-through is enabled, the window may forward pointer events but still ignore mouse events.
// To keep the UI usable, listen for pointer events at the document level and manually dispatch clicks
// to interactive elements under the pointer using elementFromPoint.
document.addEventListener('pointerdown', async (ev) => {
  try {
    if (!clickThroughEnabled) return;
    // Use elementsFromPoint to find all elements at the pointer position (more robust)
    const x = ev.clientX;
    const y = ev.clientY;
    const elems = document.elementsFromPoint(x, y);
    if (!elems || elems.length === 0) return;

    // Helper: check if an element is visible and accepts pointer events
    const isInteractiveCandidate = (el) => {
      if (!el) return false;
      if (!(el instanceof Element)) return false;
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') return false;
      return true;
    };

    let target = null;
    for (const el of elems) {
      if (!isInteractiveCandidate(el)) continue;
      const interactive = el.closest('button, a, input, select, textarea, [role="button"]');
      if (interactive && isInteractiveCandidate(interactive)) { target = interactive; break; }
      // fallback: clickable element itself
      if (el.matches && el.matches('button, a, input, select, textarea, [role="button"]')) { target = el; break; }
    }

    if (!target) return;

    try { ev.preventDefault(); ev.stopPropagation(); } catch (e) { /* ignore */ }

    // If disabled, ignore
    if (target.disabled) return;

    const tag = (target.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      target.focus();
      if (target.type === 'checkbox' || target.type === 'radio') {
        target.checked = !target.checked;
        target.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else if (tag === 'SELECT') {
      target.focus();
      // Try to open native dropdown; calling click() may help in many environments
      try { target.click(); } catch (e) { /* ignore */ }
    } else {
      // Use the element's native click() to ensure attached listeners run
      try { target.click(); } catch (e) { try { target.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (ee) { /* ignore */ } }
    }
  } catch (e) { /* ignore */ }
}, { capture: true, passive: false });

if (listEl && window.MutationObserver) {
  const mo = new MutationObserver(() => setTimeout(reportAppSize, 80));
  mo.observe(listEl, { childList: true, subtree: true, characterData: true });
}

window.addEventListener('DOMContentLoaded', async () => {
  try {
    if (window.electronAPI && window.electronAPI.listConfig) {
      const cfg = await window.electronAPI.listConfig();
      await applyUiFromConfig(cfg);
      // apply click-through from config
      if (cfg.ui && typeof cfg.ui.clickThrough === 'boolean') {
        clickThroughEnabled = !!cfg.ui.clickThrough;
        if (ctBtn) ctBtn.textContent = 'Click-through: ' + (clickThroughEnabled ? 'On' : 'Off');
        if (window.electronAPI && window.electronAPI.setClickThrough) {
          await window.electronAPI.setClickThrough('main', clickThroughEnabled);
        }
      }
    }
  } catch (e) { /* ignore */ }

  if (window.electronAPI && window.electronAPI.onConfigUpdated) {
    window.electronAPI.onConfigUpdated((cfg) => {
      try {
        // Keep UI settings in sync
        applyUiFromConfig(cfg);
        // Sync click-through state if changed externally (tray/global shortcut)
        if (cfg && cfg.ui && typeof cfg.ui.clickThrough === 'boolean') {
          clickThroughEnabled = !!cfg.ui.clickThrough;
          if (ctBtn) ctBtn.textContent = 'Click-through: ' + (clickThroughEnabled ? 'On' : 'Off');
        }
        if (typeof load === 'function') load();
      } catch (e) { /* ignore */ }
    });
  }

  load();
});

// Drag handle behavior: while pressing on drag-handle, make window clickable to allow dragging,
// then restore click-through state afterwards. This makes the widget otherwise click-through.
const dragHandle = document.getElementById('drag-handle');
if (dragHandle) {
  dragHandle.addEventListener('pointerdown', async (ev) => {
    try {
      // Ensure window receives mouse events while dragging
      if (window.electronAPI && window.electronAPI.setClickThrough) await window.electronAPI.setClickThrough('main', false);
    } catch (e) { /* ignore */ }
  });

  const restore = async () => {
    try {
      if (window.electronAPI && window.electronAPI.setClickThrough) await window.electronAPI.setClickThrough('main', clickThroughEnabled);
    } catch (e) { /* ignore */ }
  };

  dragHandle.addEventListener('pointerup', restore);
  dragHandle.addEventListener('pointercancel', restore);
  dragHandle.addEventListener('pointerleave', restore);
}