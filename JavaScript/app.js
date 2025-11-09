// Minimal event loader + renderer for the calendar UI

const listEl = document.getElementById('list');
const statusEl = document.getElementById('status');
const refreshBtn = document.getElementById('refresh');
const homeBtn = document.getElementById('home-btn');
// Prefer explicit placeholders in the controls grid if present
const controlsEl = (document.getElementById('ct-placeholder') || document.getElementById('control-actions-bottom') || document.getElementById('control-actions'));

// Object pool for DOM elements to reduce GC pressure during renders
const domElementPool = {
  divs: [],
  spans: [],
  textNodes: [],
  
  getDiv() {
    if (this.divs.length > 0) {
      const div = this.divs.pop();
      div.className = '';
      div.innerHTML = '';
      div.style.cssText = '';
      return div;
    }
    return document.createElement('div');
  },
  
  putDiv(div) {
    // Keep a smaller pool to avoid holding too many detached elements in memory
    if (this.divs.length < 120) { // Pool max 120 divs
      this.divs.push(div);
    }
  },
  
  getSpan() {
    if (this.spans.length > 0) {
      const span = this.spans.pop();
      span.className = '';
      span.textContent = '';
      span.style.cssText = '';
      return span;
    }
    return document.createElement('span');
  },
  
  putSpan(span) {
    // Keep a smaller pool to avoid holding too many detached elements in memory
    if (this.spans.length < 120) { // Pool max 120 spans
      this.spans.push(span);
    }
  },
  
  clearPool() {
    this.divs = [];
    this.spans = [];
    this.textNodes = [];
  }
};

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

let clockInterval = null;
let globalClock12Hour = false; // Store 12-hour preference globally

function updateClock(clockDiv, use12Hour = null) {
  // Use provided value or fall back to global preference
  const format12 = use12Hour !== null ? use12Hour : globalClock12Hour;
  
  const now = new Date();
  let hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, '0');
  
  let timeStr;
  if (format12) {
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // 0 becomes 12
    timeStr = `${hours}:${minutes} ${ampm}`;
  } else {
    hours = String(hours).padStart(2, '0');
    timeStr = `${hours}:${minutes}`;
  }
  
  clockDiv.textContent = timeStr;
}

function startClockUpdates(config) {
  // Clear any existing interval
  if (clockInterval) {
    clearInterval(clockInterval);
    clockInterval = null;
  }
  
  // Only start clock if enabled
  if (!config?.ui?.showClock) {
    // Hide existing clock element
    const clockEl = document.querySelector('.clock');
    if (clockEl) clockEl.classList.add('hidden');
    return;
  }
  
  // Show clock element
  const clockEl = document.querySelector('.clock');
  if (clockEl) clockEl.classList.remove('hidden');
  
  // Store format preference in global variable so interval updates use it
  globalClock12Hour = config?.ui?.clock12Hour === true;
  
  // Update clock every second
  clockInterval = setInterval(() => {
    const clockDiv = document.querySelector('.clock');
    if (clockDiv) {
      updateClock(clockDiv);
    }
  }, 1000);
  
  // Initial update
  if (clockEl) {
    updateClock(clockEl);
  }
}
function render(items, displayDays = 7, config = null) {
  if (!Array.isArray(items) || items.length === 0) {
    if (listEl) listEl.innerHTML = '<div class="no-events">No events</div>';
    return;
  }

  // Use browser's local date (same as Google Calendar does)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = formatLocalDateKey(today);
  
  const groups = {};
  
  for (const ev of items) {
    const start = parseEventDateObj(ev.start || {});
    if (!start || isNaN(start.getTime())) continue;
    
    const eventDate = new Date(start);
    eventDate.setHours(0,0,0,0);
    
    // Only include events from today onwards
    if (eventDate < today) continue;
    
    const key = formatLocalDateKey(start);
    groups[key] = groups[key] || [];
    groups[key].push({ ev, start });
  }

  // Build display: show displayDays days starting from TODAY
  const displayDays_clamped = displayDays;
  const showEmptyDays = config?.ui?.showEmptyDays !== false; // Default to true
  const days = [];
  
  // Optimization: only render days with events (unless showEmptyDays is enabled)
  const daysWithEvents = new Set(Object.keys(groups));
  daysWithEvents.add(todayKey); // Always show today
  
  for (let i = 0; i < displayDays_clamped; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const key = formatLocalDateKey(d);
    // Add day if: (1) showEmptyDays is ON, OR (2) it has events, OR (3) it's today
    if (showEmptyDays || daysWithEvents.has(key)) {
      days.push(d);
    }
  }
  
  const now = new Date();
  const use12Hour = config?.ui?.clock12Hour === true;
  
  // Clear old pool before rendering (allows GC of old elements)
  domElementPool.clearPool();
  
  // Use DocumentFragment for batch DOM operations (reduces reflows)
  const frag = document.createDocumentFragment();
  
  for (const d of days) {
    const key = formatLocalDateKey(d);
    const isTodayKey = key === todayKey;
    
    const dayDiv = domElementPool.getDiv();
    dayDiv.className = 'day';
    
    // Add clock for today if enabled - BEFORE the header
    if (isTodayKey) {
      const clockDiv = domElementPool.getDiv();
      clockDiv.className = 'clock';
      clockDiv.dataset.clockElement = 'today';
      dayDiv.appendChild(clockDiv);
      updateClock(clockDiv);
    }
    
  const headerDiv = domElementPool.getDiv();
  // Use a separate 'today' class to allow styling the header (day/date) separately
  headerDiv.className = 'day-header' + (isTodayKey ? ' today' : '');
  // Split into day name and date so colors can be applied separately
  const dayName = domElementPool.getSpan();
  dayName.className = 'day-name';
  dayName.textContent = d.toLocaleDateString(undefined, { weekday: 'long' });
  const dateSpan = domElementPool.getSpan();
  dateSpan.className = 'date';
  dateSpan.textContent = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  headerDiv.appendChild(dayName);
  headerDiv.appendChild(dateSpan);
    dayDiv.appendChild(headerDiv);
    
    const group = groups[key] || [];
    
    if (group.length === 0) {
      // Show "No events" message for empty days
      const noEvDiv = domElementPool.getDiv();
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
        
        const eventDiv = domElementPool.getDiv();
        eventDiv.className = 'event';

        // Determine event state: past, ongoing, or future
        const startTime = g.start;
        const endTime = parseEventDateObj(ev.end || {}) || startTime; // if no end, treat as point event
        const isPast = endTime < now;
        const isOngoing = startTime <= now && now < endTime;
        const isFuture = startTime > now;
        
        if (isPast) {
          eventDiv.classList.add('past');
        } else if (isOngoing) {
          eventDiv.classList.add('ongoing');
        } else if (isFuture && isTodayKey) {
          // Only apply 'future' styling for future events on TODAY
          eventDiv.classList.add('future');
        }
        
        if (timeText) {
          const timeSpan = domElementPool.getSpan();
          timeSpan.className = 'time';
          timeSpan.textContent = timeText;
          eventDiv.appendChild(timeSpan);
          eventDiv.appendChild(document.createTextNode(' • '));
        }
        
        const titleSpan = domElementPool.getSpan();
        titleSpan.className = 'title';
        titleSpan.textContent = ev.summary || 'No title';
        eventDiv.appendChild(titleSpan);
        
        // Create a unique ID for this event
        const eventId = `${formatLocalDateKey(d)}-${ev.summary}-${timeText}`;
        eventDiv.dataset.eventId = eventId;
        
        dayDiv.appendChild(eventDiv);
      }
    }
    
    frag.appendChild(dayDiv);
  }

  if (listEl) {
    listEl.innerHTML = '';  // Clear old content
    listEl.appendChild(frag);  // Single DOM insertion
    applyCompletedEventStyles();  // Apply done styles after rendering
    setupEventMarkDoneDelegate();  // Setup event delegation for mark-done
  }
  setTimeout(reportAppSize, 80);
}

// Setup mark as done functionality using event delegation (memory efficient)
function setupEventMarkDoneDelegate() {
  if (!listEl) return;
  
  window.electronAPI.getConfig().then(config => {
    if (!config.ui || !config.ui.enableMarkDone) {
      return;
    }
    
    const method = config.ui.markDoneMethod || 'right-click';
    
    // Remove old delegation listeners first
    listEl.removeEventListener('contextmenu', handleEventContextMenu);
    listEl.removeEventListener('dblclick', handleEventDblClick);
    
    // Right-click context menu using delegation
    if (method === 'right-click') {
      listEl.addEventListener('contextmenu', handleEventContextMenu);
    }
    
    // Double-click toggle using delegation
    if (method === 'double-click') {
      listEl.addEventListener('dblclick', handleEventDblClick);
    }
  }).catch(err => {
    // Silently ignore config errors
  });
}

function handleEventContextMenu(e) {
  const eventDiv = e.target.closest('.event');
  if (!eventDiv) return;
  
  e.preventDefault();
  const eventId = eventDiv.dataset.eventId;
  if (eventId) {
    showEventContextMenu(eventDiv, eventId, e.clientX, e.clientY);
  }
}

function handleEventDblClick(e) {
  const eventDiv = e.target.closest('.event');
  if (!eventDiv) return;
  
  e.preventDefault();
  const eventId = eventDiv.dataset.eventId;
  if (eventId) {
    toggleEventDone(eventDiv, eventId);
  }
}

// Setup mark as done functionality for an event (legacy - kept for compatibility)
function setupEventMarkDone(eventDiv, eventId) {
  // No longer needed with delegation, but kept for compatibility
  return;
}

// Show context menu for event
function showEventContextMenu(eventDiv, eventId, x, y) {
  // Remove existing context menu if any
  const existing = document.getElementById('event-context-menu');
  if (existing) {
    existing.remove();
  }
  
  const menu = document.createElement('div');
  menu.id = 'event-context-menu';
  menu.style.cssText = `
    position: fixed;
    left: ${x}px;
    top: ${y}px;
    background: #1a1a1a;
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 6px;
    padding: 4px;
    z-index: 10000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    font-size: 13px;
    pointer-events: auto;
  `;
  
  const isCompleted = eventDiv.classList.contains('completed');
  
  const button = document.createElement('button');
  button.style.cssText = `
    display: block;
    width: 100%;
    padding: 8px 12px;
    background: transparent;
    border: none;
    color: #fff;
    cursor: pointer;
    text-align: left;
    border-radius: 4px;
    pointer-events: auto;
  `;
  button.textContent = isCompleted ? '✓ Mark as Pending' : '✗ Mark as Done';
  button.onmouseover = () => button.style.background = 'rgba(255,255,255,0.1)';
  button.onmouseout = () => button.style.background = 'transparent';
  button.onclick = () => {
    toggleEventDone(eventDiv, eventId);
    menu.remove();
  };
  
  menu.appendChild(button);
  document.body.appendChild(menu);
  
  // Close menu when clicking elsewhere
  setTimeout(() => {
    document.addEventListener('click', function closeMenu() {
      try { menu.remove(); } catch (e) {}
      document.removeEventListener('click', closeMenu);
    }, { once: true });
  }, 100);
}

// Toggle event done status
function toggleEventDone(eventDiv, eventId) {
  eventDiv.classList.toggle('completed');
  
  // Save to config
  window.electronAPI.getConfig().then(config => {
    if (!config.completedEvents) config.completedEvents = {};
    
    if (eventDiv.classList.contains('completed')) {
      config.completedEvents[eventId] = true;
      // Hide completed event if showCompletedEvents is disabled
      if (!config.ui || config.ui.showCompletedEvents === false) {
        eventDiv.classList.add('hidden');
      }
    } else {
      delete config.completedEvents[eventId];
      // Show event again if it was hidden
      eventDiv.classList.remove('hidden');
    }
    
    // Save the updated config to persist changes
    window.electronAPI.saveConfig(config).catch(err => {
      // Revert the visual change if save failed
      eventDiv.classList.toggle('completed');
      if (!eventDiv.classList.contains('completed')) {
        eventDiv.classList.remove('hidden');
      }
    });
  }).catch(err => {
    // Revert the visual change if get failed
    eventDiv.classList.toggle('completed');
  });
}

// Apply completed event styles after rendering
function applyCompletedEventStyles() {
  window.electronAPI.getConfig().then(config => {
    if (!config.completedEvents) return;
    // Collect currently rendered event IDs
    const currentIds = new Set();
    document.querySelectorAll('.event').forEach(eventDiv => {
      const eventId = eventDiv.dataset.eventId;
      if (eventId) currentIds.add(eventId);
      if (config.completedEvents[eventId]) {
        eventDiv.classList.add('completed');
      }
      
      // Hide completed AND past events when showCompletedEvents is OFF
      const isPast = eventDiv.classList.contains('past');
      const isCompleted = eventDiv.classList.contains('completed');
      
      if (!config.ui || config.ui.showCompletedEvents === false) {
        // Hide both completed events and past events
        if (isCompleted || isPast) {
          eventDiv.classList.add('hidden');
        }
      } else {
        // Show all events when setting is ON
        eventDiv.classList.remove('hidden');
      }
    });

    // Remove any completedEvents entries that no longer correspond to rendered events
    let removed = false;
    for (const k of Object.keys(config.completedEvents)) {
      if (!currentIds.has(k)) {
        delete config.completedEvents[k];
        removed = true;
      }
    }
    // Persist config if we removed stale entries
    if (removed) {
      window.electronAPI.saveConfig(config).catch(() => {});
    }
  });
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
    let displayDays = Number(cfg.ui?.displayDays) || 14;  // Match main.js default of 14, not 7
    displayDays = Math.max(1, Math.min(30, displayDays));  // Also match main.js clamp to 30, not 14
    render(items, displayDays, cfg);
    
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
    setStatus('Failed to load events');
    if (listEl) {
      const errorMsg = err ? err.toString() : 'Unknown error';
      listEl.innerHTML = `<div class="no-events">Error: ${errorMsg}</div>`;
    }
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
      await window.electronAPI.setWindowBounds('main', {
        width: desiredWidth,
        height: desiredHeight,
        persist: false
      });
      // Verify applied size and retry with cushion if the system applied a smaller size
      try {
        const applied = await window.electronAPI.getContentSize('main');
        if (applied && applied[1] < desiredHeight) {
          const retryH = desiredHeight + 32;
          await window.electronAPI.setWindowBounds('main', { width: desiredWidth, height: retryH, persist: false });
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
    // Also use highlightColor for ongoing events by default
    root.style.setProperty('--ongoing-color', ui.highlightColor);
    root.style.setProperty('--ongoing-rgba', `rgba(${parseInt(ui.highlightColor.substring(1,3),16)}, ${parseInt(ui.highlightColor.substring(3,5),16)}, ${parseInt(ui.highlightColor.substring(5,7),16)}, 0.12)`);
  }
  // Use upcomingColor if available, fallback to highlightColor for backward compatibility
  if (ui.upcomingColor) {
    root.style.setProperty('--upcoming-color', ui.upcomingColor);
    // compute a subtle rgba background for upcoming events (12% alpha)
    try {
      const hex = ui.upcomingColor.replace('#','');
      const r = parseInt(hex.substring(0,2),16);
      const g = parseInt(hex.substring(2,4),16);
      const b = parseInt(hex.substring(4,6),16);
      root.style.setProperty('--upcoming-rgba', `rgba(${r}, ${g}, ${b}, 0.12)`);
    } catch (e) { root.style.setProperty('--upcoming-rgba', 'rgba(163,255,51,0.12)'); }
  } else if (ui.highlightColor) {
    // Fallback to highlightColor if upcomingColor not set
    root.style.setProperty('--upcoming-color', ui.highlightColor);
    try {
      const hex = ui.highlightColor.replace('#','');
      const r = parseInt(hex.substring(0,2),16);
      const g = parseInt(hex.substring(2,4),16);
      const b = parseInt(hex.substring(4,6),16);
      root.style.setProperty('--upcoming-rgba', `rgba(${r}, ${g}, ${b}, 0.12)`);
    } catch (e) { root.style.setProperty('--upcoming-rgba', 'rgba(163,255,51,0.12)'); }
  }
  if (ui.dayColor) root.style.setProperty('--day-color', ui.dayColor);
  if (ui.dateColor) root.style.setProperty('--date-color', ui.dateColor);
  if (ui.dateSpacing) root.style.setProperty('--date-spacing', ui.dateSpacing + 'px');
  if (ui.clockColor) root.style.setProperty('--clock-color', ui.clockColor);
  if (ui.clockFontFamily) root.style.setProperty('--clock-font-family', ui.clockFontFamily);
  if (ui.clockSize) root.style.setProperty('--clock-size', ui.clockSize + 'px');
  if (ui.clockAlignment) root.style.setProperty('--clock-alignment', ui.clockAlignment);
  
  // Start/stop clock updates based on config
  startClockUpdates(cfg);
  } catch (e) { /* ignore */ }
}

if (refreshBtn) refreshBtn.addEventListener('click', load);
if (homeBtn) homeBtn.addEventListener('click', async () => {
  try { await window.electronAPI.openHome(); }
  catch (e) { setStatus('Failed to open welcome'); }
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
  } catch (e) { }
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

  // Listen for refresh event sent from tray menu (FIX for refresh button)
  try {
    if (window.electronAPI && window.electronAPI.onRefresh) {
      window.electronAPI.onRefresh(() => {
        try { if (typeof load === 'function') load(); } catch (e) { /* ignore */ }
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
      // Ensure window receives mouse events while dragging
      if (window.electronAPI && window.electronAPI.setClickThrough) await window.electronAPI.setClickThrough('main', false);
    } catch (e) { }
  });

  dragBar.addEventListener('pointerup', async (ev) => {
    try {
      if (window.electronAPI && window.electronAPI.setClickThrough) await window.electronAPI.setClickThrough('main', clickThroughEnabled);
    } catch (e) { }
  });

  dragBar.addEventListener('pointercancel', (ev) => { });
  dragBar.addEventListener('pointerleave', (ev) => { });
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