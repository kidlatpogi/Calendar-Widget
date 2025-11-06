// Minimal event loader + renderer for the calendar UI

const listEl = document.getElementById('list');
const statusEl = document.getElementById('status');
const refreshBtn = document.getElementById('refresh');
const homeBtn = document.getElementById('home-btn');
// Prefer explicit placeholders in the controls grid if present
const controlsEl = (document.getElementById('ct-placeholder') || document.getElementById('control-actions-bottom') || document.getElementById('control-actions'));

// click-through toggle button (injected)
let clickThroughEnabled = false;
const ctBtn = document.createElement('button');
ctBtn.id = 'clickthrough-btn';
ctBtn.title = 'Toggle click-through (allow clicks to pass through widget)';
ctBtn.textContent = 'Click-through: Off';
ctBtn.className = 'control-btn';
ctBtn.style.marginLeft = '6px';
ctBtn.style.border = '1px solid rgba(255,255,255,0.16)';
ctBtn.style.background = 'rgba(255,255,255,0.02)';
ctBtn.style.color = '#fff';
ctBtn.style.padding = '6px 8px';
ctBtn.style.borderRadius = '6px';
ctBtn.style.cursor = 'pointer';
// If we found the ct-placeholder, append there; otherwise append to fallback container
const ctSlot = document.getElementById('ct-placeholder');
if (ctSlot) ctSlot.appendChild(ctBtn); else if (controlsEl) controlsEl.appendChild(ctBtn); else document.body.appendChild(ctBtn);

// collapse/expand toggle (injected)
let collapsed = false;
const collapseBtn = document.createElement('button');
collapseBtn.id = 'collapse-btn';
collapseBtn.title = 'Collapse controls';
collapseBtn.textContent = '▾';
collapseBtn.style.marginLeft = '6px';
collapseBtn.style.border = '1px solid rgba(255,255,255,0.12)';
collapseBtn.style.background = 'rgba(0,0,0,0.12)';
collapseBtn.style.color = '#fff';
collapseBtn.style.padding = '4px 8px';
collapseBtn.style.borderRadius = '6px';
collapseBtn.style.cursor = 'pointer';
const collapseSlot = document.getElementById('collapse-placeholder');
if (collapseSlot) collapseSlot.appendChild(collapseBtn); else if (controlsEl) controlsEl.appendChild(collapseBtn); else document.body.appendChild(collapseBtn);

// restore state from localStorage if present
try { collapsed = localStorage.getItem('cw.collapsed') === '1'; } catch (e) { collapsed = false; }
function applyCollapsedState(invokedByKeyboard = false) {
  try {
    const appEl = document.getElementById('app');
    if (!appEl) return;
    if (collapsed) appEl.classList.add('collapsed'); else appEl.classList.remove('collapsed');
    collapseBtn.textContent = collapsed ? '▸' : '▾';
    try { localStorage.setItem('cw.collapsed', collapsed ? '1' : '0'); } catch (e) {}
    // Persist collapsed state in config.json so it survives restarts
    try {
      if (window.electronAPI && window.electronAPI.setConfig) {
        window.electronAPI.setConfig({ ui: { collapsed: !!collapsed } }).catch(() => {});
      }
    } catch (e) { /* ignore */ }
    // show a short left-anchored tip indicating collapsed state only when invoked by keyboard
    try { if (collapsed && invokedByKeyboard && typeof showLeftTip === 'function') showLeftTip('Ctrl+Shift+M to uncollapse', 2000); } catch (e) {}
  } catch (e) { /* ignore */ }
}
collapseBtn.addEventListener('click', () => { collapsed = !collapsed; applyCollapsedState(); });
applyCollapsedState();

// Toast helper
function showToast(text, ms = 1800) {
  try {
    let t = document.getElementById('cw-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'cw-toast';
      t.style.position = 'absolute';
      t.style.right = '12px';
      t.style.top = '12px';
      t.style.padding = '8px 10px';
      t.style.borderRadius = '8px';
      t.style.background = 'rgba(0,0,0,0.6)';
      t.style.color = '#fff';
      t.style.fontSize = '12px';
      t.style.zIndex = '99999';
      document.getElementById('app')?.appendChild(t);
    }
    t.textContent = text;
    t.style.opacity = '1';
    setTimeout(() => { try { t.style.opacity = '0'; } catch (e) {} }, ms);
  } catch (e) { /* ignore */ }
}

// Renderer-level key handler: Ctrl+Shift+M toggles collapse when window is focused
window.addEventListener('keydown', (ev) => {
  try {
    if (ev.ctrlKey && ev.shiftKey && (ev.key === 'M' || ev.key === 'm')) {
      ev.preventDefault();
      collapsed = !collapsed;
      applyCollapsedState(true);
    }
  } catch (e) { /* ignore */ }
});

// If collapsed, clicking the drag-bar should toggle window visibility (hide/show)
try {
  const dragBarEl = document.getElementById('drag-bar');
  if (dragBarEl) {
  // drag handle is the main draggable area; no separate drag label needed
    // Create an 'uncollapse' button inside the drag bar so user can restore the UI
    let uncollapseBtn = document.getElementById('uncollapse-btn');
    if (!uncollapseBtn) {
      uncollapseBtn = document.createElement('button');
      uncollapseBtn.id = 'uncollapse-btn';
      uncollapseBtn.title = 'Restore';
      uncollapseBtn.textContent = '▾';
      // styling: minimal and inline; CSS will manage visibility
      uncollapseBtn.style.border = '1px solid rgba(255,255,255,0.14)';
      uncollapseBtn.style.background = 'rgba(0,0,0,0.2)';
      uncollapseBtn.style.color = '#fff';
      uncollapseBtn.style.padding = '2px 6px';
      uncollapseBtn.style.borderRadius = '6px';
      uncollapseBtn.style.cursor = 'pointer';
      uncollapseBtn.style.fontSize = '12px';
      uncollapseBtn.style.marginLeft = '8px';
      uncollapseBtn.style.display = 'none';
      uncollapseBtn.setAttribute('aria-hidden', 'true');
      // ensure it's clickable even though parent has -webkit-app-region: drag
      uncollapseBtn.style.webkitAppRegion = 'no-drag';
      uncollapseBtn.addEventListener('click', (ev) => {
        try {
          ev.stopPropagation();
          collapsed = false;
          applyCollapsedState();
        } catch (e) { /* ignore */ }
      });
      dragBarEl.appendChild(uncollapseBtn);
    }

    dragBarEl.addEventListener('click', async (ev) => {
      try {
        // if click target is the uncollapse button, let its handler restore the UI
        if (ev.target && ev.target.id === 'uncollapse-btn') return;
        if (collapsed && window.electronAPI && window.electronAPI.toggleVisibility) {
          await window.electronAPI.toggleVisibility('main');
        }
      } catch (e) { /* ignore */ }
    });
  }
} catch (e) { /* ignore */ }

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
    // Parse as-is without timezone conversion
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d;
  }
  
  return null;
}

function render(items, displayDays = 7) {
  if (!Array.isArray(items) || items.length === 0) {
    if (listEl) listEl.innerHTML = '<div class="no-events">No events</div>';
    return;
  }

  // Use browser's local date (same as Google Calendar does)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
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
  const displayDays_clamped = Math.max(1, Math.min(14, displayDays || 7));
  const days = [];
  for (let i = 0; i < displayDays_clamped; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d);
  }
  
  const now = new Date();
  
  // Use DocumentFragment for batch DOM operations (reduces reflows)
  const frag = document.createDocumentFragment();
  
  for (const d of days) {
    const key = formatLocalDateKey(d);
    const isTodayKey = key === todayKey;
    
    const dayDiv = document.createElement('div');
    dayDiv.className = 'day';
    
  const headerDiv = document.createElement('div');
  // Use a separate 'today' class to allow styling the header (day/date) separately
  headerDiv.className = 'day-header' + (isTodayKey ? ' today' : '');
  // Split into day name and date so colors can be applied separately
  const dayName = document.createElement('span');
  dayName.className = 'day-name';
  dayName.textContent = d.toLocaleDateString(undefined, { weekday: 'long' });
  const dateSpan = document.createElement('span');
  dateSpan.className = 'date';
  dateSpan.textContent = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  headerDiv.appendChild(dayName);
  headerDiv.appendChild(dateSpan);
    dayDiv.appendChild(headerDiv);
    
    const group = groups[key] || [];
    
    if (group.length === 0) {
      const noEvDiv = document.createElement('div');
      noEvDiv.className = 'no-events';
      noEvDiv.textContent = 'No events';
      dayDiv.appendChild(noEvDiv);
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
        
        const eventDiv = document.createElement('div');
        eventDiv.className = 'event';

        // Determine event state: past, ongoing, or future
        const startTime = g.start;
        const endTime = parseEventDateObj(ev.end || {}) || startTime; // if no end, treat as point event
        const isPast = endTime < now;
        const isOngoing = startTime <= now && now < endTime;
        if (isPast) {
          eventDiv.classList.add('past');
        } else if (isOngoing) {
          eventDiv.classList.add('ongoing');
        }
        
        if (timeText) {
          const timeSpan = document.createElement('span');
          timeSpan.className = 'time';
          timeSpan.textContent = timeText;
          eventDiv.appendChild(timeSpan);
          eventDiv.appendChild(document.createTextNode(' • '));
        }
        
        const titleSpan = document.createElement('span');
        titleSpan.className = 'title';
        titleSpan.textContent = ev.summary || 'No title';
        eventDiv.appendChild(titleSpan);
        
        dayDiv.appendChild(eventDiv);
      }
    }
    
    frag.appendChild(dayDiv);
  }

  if (listEl) {
    listEl.innerHTML = '';  // Clear old content
    listEl.appendChild(frag);  // Single DOM insertion
  }
  setTimeout(reportAppSize, 80);
}

// (Always use days mode rendering)

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
    
    // Get days to display from config (always days mode)
    let displayDays = Number(cfg.ui?.displayDays) || 7;
    displayDays = Math.max(1, Math.min(14, displayDays));
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
    // Compute full desired height: include header and the full scrollHeight of the list
    const rect = el.getBoundingClientRect();
    let desiredWidth = Math.ceil(rect.width);

    const list = document.getElementById('list');
    const status = document.getElementById('status');
  // Use the full scrollHeight of the app container for an accurate content height
  // This includes all children and any overflow content produced by the list.
  desiredWidth = Math.max(desiredWidth, Math.ceil(el.scrollWidth || rect.width));
  const desiredHeight = Math.ceil((el.scrollHeight || rect.height) + 24); // cushion for rounding and decorations

    try {
      console.log('[reportAppSize] requesting size', { width: desiredWidth, height: desiredHeight });
      await window.electronAPI.setWindowBounds('main', {
        width: desiredWidth,
        height: desiredHeight,
        persist: false
      });
      console.log('[reportAppSize] request completed');
      // Verify applied size and retry with cushion if the system applied a smaller size
      try {
        const applied = await window.electronAPI.getContentSize('main');
        console.log('[reportAppSize] applied content size:', applied);
        if (applied && applied[1] < desiredHeight) {
          const retryH = desiredHeight + 32;
          console.log('[reportAppSize] applied smaller than desired, retrying with', retryH);
          await window.electronAPI.setWindowBounds('main', { width: desiredWidth, height: retryH, persist: false });
          console.log('[reportAppSize] retry completed');
        }
      } catch (e) { /* ignore */ }
    } catch (e) { /* ignore */ }
  } catch (e) { /* ignore */ }
}

async function applyUiFromConfig(cfg) {
  try {
    if (!cfg || !cfg.ui) return;
    const ui = cfg.ui;
    const root = document.documentElement;
    
    if (ui.fontFamily) root.style.setProperty('--app-font-family', ui.fontFamily);
    if (ui.fontSize) {
      const fs = Number(ui.fontSize) || 13;
      root.style.setProperty('--app-font-size', `${fs}px`);
      root.style.setProperty('--app-font-small', `${Math.max(10, fs - 2)}px`);
      root.style.setProperty('--app-font-large', `${Math.max(12, fs + 1)}px`);
    }
  if (ui.scheduleColor) root.style.setProperty('--schedule-color', ui.scheduleColor);
  if (ui.dateTimeColor) root.style.setProperty('--date-time-color', ui.dateTimeColor);
  if (ui.highlightColor) {
    root.style.setProperty('--highlight-color', ui.highlightColor);
    // compute a subtle rgba background for highlights (12% alpha)
    try {
      const hex = ui.highlightColor.replace('#','');
      const r = parseInt(hex.substring(0,2),16);
      const g = parseInt(hex.substring(2,4),16);
      const b = parseInt(hex.substring(4,6),16);
      root.style.setProperty('--highlight-rgba', `rgba(${r}, ${g}, ${b}, 0.12)`);
    } catch (e) { root.style.setProperty('--highlight-rgba', 'rgba(163,255,51,0.12)'); }
  }
  if (ui.dayColor) root.style.setProperty('--day-color', ui.dayColor);
  if (ui.dateColor) root.style.setProperty('--date-color', ui.dateColor);
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
    // button-click toggles click-through; hotkey tip is shown only for keyboard invocations
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
      try { if (typeof showLeftTip === 'function') showLeftTip('Ctrl+Shift+C to toggle click-through', 2000); } catch (e) {}
    }
  } catch (e) { /* ignore */ }
});

// When click-through is enabled, clicks pass through to windows behind.
// However, we want UI controls (buttons, inputs, etc.) to remain clickable.
// Solution: temporarily disable click-through when hovering over UI elements.
(function setupClickThroughHover() {
  const controlElements = document.querySelectorAll('button, input, select, textarea, a, [role="button"]');
  
  const enableClickThrough = async () => {
    if (clickThroughEnabled && window.electronAPI && window.electronAPI.setClickThrough) {
      try { await window.electronAPI.setClickThrough('main', true); } catch (e) { }
    }
  };
  
  const disableClickThrough = async () => {
    if (clickThroughEnabled && window.electronAPI && window.electronAPI.setClickThrough) {
      try { await window.electronAPI.setClickThrough('main', false); } catch (e) { }
    }
  };
  
  // When hovering over interactive elements, disable click-through so they're clickable
  controlElements.forEach(el => {
    el.addEventListener('mouseenter', disableClickThrough);
    el.addEventListener('mouseleave', enableClickThrough);
  });
  
  // Exclude the click-through button itself from this behavior (it should always work)
  const ctBtn = document.getElementById('clickthrough-btn');
  if (ctBtn) {
    ctBtn.removeEventListener('mouseenter', disableClickThrough);
    ctBtn.removeEventListener('mouseleave', enableClickThrough);
  }
})();

// Allow right-click (context menu) to pass through
document.addEventListener('contextmenu', (ev) => {
  // Don't prevent context menu; let it work
}, { capture: true, passive: true });

if (listEl && window.MutationObserver) {
  const mo = new MutationObserver(() => setTimeout(reportAppSize, 80));
  mo.observe(listEl, { childList: true, subtree: true, characterData: true });
}

window.addEventListener('DOMContentLoaded', async () => {
  // Custom drag: allow dragging the window by clicking anywhere inside #drag-handle (including text)
  (function setupCustomDrag() {
    const dragContainer = document.getElementById('drag-handle');
    if (!dragContainer || !window.electronAPI || !window.electronAPI.moveWindowBy) return;

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let pointerId = null;

    const onPointerDown = (ev) => {
      // only start when primary button
      if (ev.button !== 0) return;
      dragging = true;
      pointerId = ev.pointerId;
      lastX = ev.screenX;
      lastY = ev.screenY;
      // capture the pointer to receive moves even when outside
      try { ev.target.setPointerCapture(pointerId); } catch (e) {}
    };

    const onPointerMove = async (ev) => {
      if (!dragging || ev.pointerId !== pointerId) return;
      const dx = ev.screenX - lastX;
      const dy = ev.screenY - lastY;
      if (dx === 0 && dy === 0) return;
      lastX = ev.screenX;
      lastY = ev.screenY;
      try { await window.electronAPI.moveWindowBy(dx, dy); } catch (e) { /* ignore */ }
    };

    const endDrag = (ev) => {
      if (!dragging) return;
      dragging = false;
      pointerId = null;
      try { ev.target.releasePointerCapture && ev.target.releasePointerCapture(ev.pointerId); } catch (e) {}
    };

    dragContainer.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', endDrag, { passive: true });
    window.addEventListener('pointercancel', endDrag, { passive: true });
  })();
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
          const next = !!cfg.ui.clickThrough;
          clickThroughEnabled = next;
          if (ctBtn) ctBtn.textContent = 'Click-through: ' + (clickThroughEnabled ? 'On' : 'Off');
        }
        if (typeof load === 'function') load();
      } catch (e) { /* ignore */ }
    });
  }

  // Listen for toggle-collapse sent from main via global shortcut
  try {
    if (window.electronAPI && window.electronAPI.onToggleCollapse) {
      window.electronAPI.onToggleCollapse(() => {
        try { collapsed = !collapsed; applyCollapsedState(); } catch (e) { /* ignore */ }
      });
    }
  } catch (e) { /* ignore */ }

  load();
  // Ensure layout stabilization: request size twice (immediately and after a short delay)
  setTimeout(() => { try { if (typeof reportAppSize === 'function') reportAppSize(); } catch (e) {} }, 250);
});

// Drag handle behavior: while pressing on drag-handle, make window clickable to allow dragging,
// then restore click-through state afterwards. This makes the widget otherwise click-through.
const dragHandle = document.getElementById('drag-handle');
const dragBar = document.getElementById('drag-bar');
if (dragBar) {
  dragBar.addEventListener('pointerdown', async (ev) => {
    try {
      console.log('drag-bar pointerdown', ev.type, ev.button);
      // Ensure window receives mouse events while dragging
      if (window.electronAPI && window.electronAPI.setClickThrough) await window.electronAPI.setClickThrough('main', false);
    } catch (e) { console.error('drag-bar pointerdown error', e); }
  });

  dragBar.addEventListener('pointerup', async (ev) => {
    try { console.log('drag-bar pointerup', ev.type); } catch (e) {}
    try {
      if (window.electronAPI && window.electronAPI.setClickThrough) await window.electronAPI.setClickThrough('main', clickThroughEnabled);
    } catch (e) { console.error('drag-bar pointerup restore error', e); }
  });

  dragBar.addEventListener('pointercancel', (ev) => { try { console.log('drag-bar pointercancel'); } catch (e) {} });
  dragBar.addEventListener('pointerleave', (ev) => { try { console.log('drag-bar pointerleave'); } catch (e) {} });
}

// Backwards compatible: still handle drag on larger handle container if present
if (dragHandle && !dragBar) {
  dragHandle.addEventListener('pointerdown', async (ev) => {
    try { if (window.electronAPI && window.electronAPI.setClickThrough) await window.electronAPI.setClickThrough('main', false); } catch (e) { }
  });
  const restore = async () => { try { if (window.electronAPI && window.electronAPI.setClickThrough) await window.electronAPI.setClickThrough('main', clickThroughEnabled); } catch (e) { } };
  dragHandle.addEventListener('pointerup', restore);
  dragHandle.addEventListener('pointercancel', restore);
  dragHandle.addEventListener('pointerleave', restore);
}

// Collapsed banner: show message at bottom when collapsed for 2 seconds
function showLeftTip(text, ms = 2000) {
  try {
    let b = document.getElementById('collapsed-banner');
    const appEl = document.getElementById('app');
    if (!b) {
      b = document.createElement('div');
      b.id = 'collapsed-banner';
      // base styling; CSS file contains additional rules
      b.style.position = 'absolute';
      b.style.left = '12px';
      b.style.transform = 'none';
      b.style.right = 'auto';
  b.style.bottom = 'auto';
      b.style.maxWidth = 'calc(100% - 36px)';
      b.style.overflow = 'hidden';
      b.style.textOverflow = 'ellipsis';
      b.style.whiteSpace = 'normal';
      b.style.fontSize = '12px';
      b.style.padding = '6px 10px';
      b.style.borderRadius = '8px';
      b.style.background = 'rgba(0,0,0,0.85)';
      b.style.color = '#fff';
      b.style.zIndex = '99999';
      b.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
      b.style.maxHeight = '160px';
      b.style.overflowY = 'auto';
      if (appEl) appEl.appendChild(b);
    }

    b.textContent = text;
    // Position the banner under the main content area
    try {
      const contentEl = document.getElementById('list') || document.getElementById('drag-handle') || appEl;
      if (contentEl && appEl) {
  const relTop = contentEl.offsetTop + contentEl.offsetHeight + 8;
  b.style.top = relTop + 'px';
  b.style.bottom = 'auto';
      }
    } catch (e) { /* ignore layout compute errors */ }

    // Make sure it's visible
    b.style.display = 'block';
    b.style.opacity = '1';
    try { if (b._hideTimer) clearTimeout(b._hideTimer); } catch (e) {}
    b._hideTimer = setTimeout(() => {
      try { b.style.opacity = '0'; } catch (e) {}
      try { setTimeout(()=>{ b.style.display = 'none'; }, 250); } catch (e) {}
    }, ms);
  } catch (e) { /* ignore */ }
}