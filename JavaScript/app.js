// Minimal event loader + renderer for the calendar UI

const listEl = document.getElementById('list');
const statusEl = document.getElementById('status');
const refreshBtn = document.getElementById('refresh');
const homeBtn = document.getElementById('home-btn');

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

if (listEl && window.MutationObserver) {
  const mo = new MutationObserver(() => setTimeout(reportAppSize, 80));
  mo.observe(listEl, { childList: true, subtree: true, characterData: true });
}

window.addEventListener('DOMContentLoaded', async () => {
  try {
    if (window.electronAPI && window.electronAPI.listConfig) {
      const cfg = await window.electronAPI.listConfig();
      await applyUiFromConfig(cfg);
    }
  } catch (e) { /* ignore */ }

  if (window.electronAPI && window.electronAPI.onConfigUpdated) {
    window.electronAPI.onConfigUpdated((cfg) => {
      applyUiFromConfig(cfg);
      if (typeof load === 'function') load();
    });
  }

  load();
});