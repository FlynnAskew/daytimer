// ═══════════════════════════════════════════════════════════
//  DAYTIMER — Main App
// ═══════════════════════════════════════════════════════════

const { ipcRenderer } = require('electron');

// Load Supabase config
let supabaseConfig = { url: 'YOUR_SUPABASE_PROJECT_URL', anonKey: 'YOUR_SUPABASE_ANON_KEY' };
try {
  supabaseConfig = require('../supabase-config.js');
} catch (e) {
  console.warn('supabase-config.js not found');
}

// ── Initialise Supabase ────────────────────────────────────────
// Each Electron window has its own localStorage so we can't rely on
// persistSession to share auth across windows. Pull the session from
// the main process via IPC and apply it to this window's client.
let dbClient = null;
let dbReady = false;
let currentUser = null;
let currentUserId = null;

(async () => {
  try {
    if (!supabaseConfig.url || supabaseConfig.url.includes('YOUR_') ||
        !supabaseConfig.anonKey || supabaseConfig.anonKey.includes('YOUR_')) {
      console.warn('Main: Supabase config missing');
      return;
    }

    dbClient = window.supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const session = await ipcRenderer.invoke('get-session');
    if (!session) {
      console.warn('Main: no session from main process — auth not ready');
      return;
    }

    const { error } = await dbClient.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token
    });
    if (error) {
      console.error('Main: setSession failed', error);
      return;
    }

    currentUserId = session.user.id;
    currentUser = session.user;
    dbReady = true;
    window.dbClient = dbClient;
    window.currentUserId = currentUserId;
    window.currentUser = currentUser;
    console.log('Main: signed in as', session.user.email, 'uid:', currentUserId);
    updateSidebarLogo();

    // Troop Mode — initialise presence subscription
    try {
      if (window.dtTroop) {
        window.dtTroop.init();
        window.dtTroop.onRoster(updateTroopBar);
      }
    } catch (e) { console.warn('Troop init failed', e); }

    // Listen for refreshed tokens from the main process
    ipcRenderer.on('session-refreshed', async (_evt, fresh) => {
      try {
        await dbClient.auth.setSession({
          access_token:  fresh.access_token,
          refresh_token: fresh.refresh_token
        });
        console.log('Main: session refreshed, expires', new Date(fresh.expires_at * 1000).toISOString());
        // Reload whatever page they're currently on so any data fetched
        // with a stale token gets refreshed. Without this, queries that
        // ran during the refresh window can leave the UI showing empty.
        try {
          const page = state.currentPage;
          if (page === 'tracker' && typeof loadTracker === 'function') loadTracker();
          else if (page === 'planner' && typeof loadPlanner === 'function') loadPlanner();
          else if (page === 'todos' && typeof loadTodos === 'function') loadTodos();
          else if (page === 'insights' && typeof loadInsights === 'function') loadInsights();
          else if (page === 'stats' && typeof loadStats === 'function') loadStats();
        } catch (e) { console.error('Reload after refresh failed:', e); }
      } catch (e) {
        console.error('Main: failed to apply refreshed session', e);
      }
    });

    // Listen for auth-state messages from the main process
    ipcRenderer.on('auth-state', (_evt, state) => {
      if (state === 'dead') {
        // Refresh token is no longer valid — the user must sign in again.
        // Surface this clearly rather than letting queries silently fail.
        if (window.dtFun) {
          window.dtFun.toast(
            'Your sign-in has expired. Please sign out and back in to continue.',
            { emoji: '🔒', duration: 30000 }
          );
        }
      } else if (state === 'failing') {
        // Multiple refresh attempts failed — show a quieter warning
        if (window.dtFun) {
          window.dtFun.toast(
            'Trouble reaching auth server — retrying. If this persists, check your network.',
            { emoji: '⚠️', duration: 6000 }
          );
        }
      }
    });

    // Re-load any data that was attempted before auth was ready
    try { if (typeof loadCategoriesFromDb === 'function') await loadCategoriesFromDb(); } catch (e) {}
    try { if (typeof loadTracker         === 'function') loadTracker();         } catch (e) {}
    try { if (typeof loadPlanner         === 'function') loadPlanner();         } catch (e) {}
    try { if (typeof loadLocalTodos      === 'function') loadLocalTodos();      } catch (e) {}
    // Notify any other code paths waiting for auth
    window.dispatchEvent(new Event('auth-ready'));
  } catch (e) {
    console.error('Main: Supabase init failed:', e);
  }
})();

// Helper: stamp user_id on every row before insert
function withUid(row) {
  if (!currentUserId) {
    console.error('withUid called before auth ready — row will be rejected', row);
  } else {
    row.user_id = currentUserId;
  }
  return row;
}

function updateSidebarLogo() {
  const logo = document.getElementById('sidebarLogo');
  if (!logo || !currentUser || !currentUser.email) return;
  const local = currentUser.email.split('@')[0] || '';
  const namePart = local.split(/[\.\-_]/)[0] || local;
  if (namePart) logo.textContent = namePart.charAt(0).toUpperCase();
}

// Receive user info from main process
ipcRenderer.on('user-info', (event, user) => {
  currentUser = user;
  updateSidebarLogo();
});

// Get current user on load
(async () => {
  try {
    currentUser = await ipcRenderer.invoke('get-current-user');
    updateSidebarLogo();
  } catch (e) {}
})();

// ── Theme definitions (for the picker UI) ──────────────────
const THEMES = {
  dark: [
    { id: 'howler-dark',  name: 'Howler',  bg: '#0d0d0d', surf: '#1a1a1a', acc: '#FF7D00' },
    { id: 'teal-dark',    name: 'Teal',    bg: '#0f0f13', surf: '#1a1a22', acc: '#6ee7b7' },
    { id: 'mono-dark',    name: 'Mono',    bg: '#0a0a0a', surf: '#141414', acc: '#ffffff' },
    { id: 'sky-dark',     name: 'Sky',     bg: '#0d1117', surf: '#161b22', acc: '#58a6ff' },
    { id: 'rose-dark',    name: 'Rose',    bg: '#130f12', surf: '#1e181c', acc: '#fb7185' },
    { id: 'amber-dark',   name: 'Amber',   bg: '#13110e', surf: '#1f1b14', acc: '#fbbf24' },
    { id: 'purple-dark',  name: 'Purple',  bg: '#100f18', surf: '#1a1826', acc: '#a78bfa' },
    { id: 'forest-dark',  name: 'Forest',  bg: '#0c1210', surf: '#151d19', acc: '#4ade80' },
    { id: 'crimson-dark', name: 'Crimson', bg: '#110e0e', surf: '#1c1616', acc: '#ff6b6b' },
    { id: 'slate-dark',   name: 'Slate',   bg: '#0d1117', surf: '#161b22', acc: '#94a3b8' },
    { id: 'alpine-dark',  name: 'Alpine',  bg: '#091210', surf: '#111e1a', acc: '#2dd4bf' },
    { id: 'sage-dark',    name: 'Sage',    bg: '#0f1410', surf: '#181f17', acc: '#86efac' }
  ],
  light: [
    { id: 'howler-light', name: 'Howler',  bg: '#fafaf8', surf: '#ffffff', acc: '#FF7D00' },
    { id: 'teal-light',   name: 'Teal',    bg: '#f6f9f7', surf: '#ffffff', acc: '#0d9488' },
    { id: 'mono-light',   name: 'Mono',    bg: '#fafaf7', surf: '#ffffff', acc: '#0a0a0a' },
    { id: 'sky-light',    name: 'Sky',     bg: '#f6f8fc', surf: '#ffffff', acc: '#0369a1' },
    { id: 'rose-light',   name: 'Rose',    bg: '#fcf7f8', surf: '#ffffff', acc: '#be123c' },
    { id: 'amber-light',  name: 'Amber',   bg: '#fcf9f4', surf: '#ffffff', acc: '#b45309' },
    { id: 'purple-light', name: 'Purple',  bg: '#faf8ff', surf: '#ffffff', acc: '#7c3aed' },
    { id: 'forest-light', name: 'Forest',  bg: '#f4fbf6', surf: '#ffffff', acc: '#16a34a' },
    { id: 'alpine-light', name: 'Alpine',  bg: '#f0faf8', surf: '#ffffff', acc: '#0f766e' },
    { id: 'sage-light',   name: 'Sage',    bg: '#f5faf5', surf: '#ffffff', acc: '#4d7c52' }
  ]
};

const CATEGORY_COLOURS = [
  // Reds
  '#ef4444', '#f87171', '#fca5a5',
  // Oranges
  '#f97316', '#fb923c', '#fdba74',
  // Yellows / Ambers
  '#f59e0b', '#fbbf24', '#fde68a',
  // Greens
  '#22c55e', '#4ade80', '#6ee7b7',
  // Teals / Cyans
  '#14b8a6', '#2dd4bf', '#22d3ee',
  // Blues
  '#3b82f6', '#58a6ff', '#93c5fd',
  // Purples / Violets
  '#8b5cf6', '#a78bfa', '#c4b5fd',
  // Pinks
  '#ec4899', '#f472b6', '#e879f9'
];

const DEFAULT_CATEGORIES = [
  { name: 'Emails',      colour: '#58a6ff', sort_order: 1 },
  { name: 'Admin work',  colour: '#fbbf24', sort_order: 2 },
  { name: 'Meetings',    colour: '#a78bfa', sort_order: 3 }
];

// ── State ──────────────────────────────────────────────────
const state = {
  currentTheme: 'howler-light',
  currentPage: 'tracker',
  categories: [],
  trackerDate: new Date(),
  plannerDate: new Date(),
  plannerView: 'plan',
  plannerZoom: 1, // 1 = default, 2 = 2x zoom, etc
  extendedHours: false, // Toggle to expand planner to 4am–10pm
  analysisRange: 'week',
  customFrom: null,
  customTo: null
};

// ── Utilities ──────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

function pad(n) { return String(n).padStart(2, '0'); }

function dateToString(d) {
  // Use local date parts — avoids timezone rollover bug with toISOString()
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  return `${y}-${m}-${day}`;
}

function stringToDate(s) {
  return new Date(s + 'T00:00:00');
}

function formatDate(d, fullMonth = true) {
  const opts = {
    weekday: 'long', day: 'numeric',
    month: fullMonth ? 'long' : 'short', year: 'numeric'
  };
  return d.toLocaleDateString('en-GB', opts);
}

function formatDuration(secs, short = false) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (short) {
    if (h === 0) return m + 'm';
    return h + 'h ' + m + 'm';
  }
  const s = secs % 60;
  return pad(h) + ':' + pad(m) + ':' + pad(s);
}

function formatHM(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return pad(h) + ':' + pad(m);
}

function formatHoursMins(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h === 0) return m + 'm';
  return h + 'h ' + m + 'm';
}

function formatTime(iso) {
  const d = new Date(iso);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function isSameDate(d1, d2) {
  return dateToString(d1) === dateToString(d2);
}

function addDays(d, n) {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + n);
  return nd;
}

function categoryColour(name) {
  const cat = state.categories.find(c => c.name === name);
  return cat ? cat.colour : 'var(--accent)';
}

// ── Routing ────────────────────────────────────────────────
function navigateTo(pageName) {
  state.currentPage = pageName;
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.page === pageName);
  });
  document.querySelectorAll('.page').forEach(p => {
    p.classList.toggle('active', p.id === 'page-' + pageName);
  });

  // Trigger page-specific load
  if (pageName === 'tracker')  loadTracker();
  if (pageName === 'planner') {
    if ($('plannerZoom')) {
      $('plannerZoom').value = state.plannerZoom;
      $('zoomLabel').textContent = state.plannerZoom + '×';
    }
    loadPlanner();
  }
  if (pageName === 'todos')    loadTodos();
  if (pageName === 'insights') loadInsights();
  if (pageName === 'stats')    loadStats();
  if (pageName === 'settings') loadSettings();
}

document.querySelectorAll('.nav-btn[data-page]').forEach(btn => {
  btn.addEventListener('click', () => navigateTo(btn.dataset.page));
});

// ── Theme Management ───────────────────────────────────────
async function loadAndApplyTheme() {
  try {
    const theme = await ipcRenderer.invoke('get-theme');
    state.currentTheme = theme || 'howler-light';
  } catch (e) {
    state.currentTheme = 'howler-light';
  }
  document.documentElement.setAttribute('data-theme', state.currentTheme);
}

function setTheme(themeId) {
  state.currentTheme = themeId;
  document.documentElement.setAttribute('data-theme', themeId);
  ipcRenderer.send('theme-changed', themeId);
  // Update the swatches in settings
  document.querySelectorAll('.theme-swatch').forEach(sw => {
    sw.classList.toggle('active', sw.dataset.theme === themeId);
  });
}

// ── Modal Helper ───────────────────────────────────────────
function openModal(html) {
  const modal = $('modal');
  modal.innerHTML = html;
  $('modalBackdrop').classList.add('visible');
}

function closeModal() {
  $('modalBackdrop').classList.remove('visible');
}

// Expose for inline onclick handlers in modals
window.closeModal = closeModal;

$('modalBackdrop').addEventListener('click', (e) => {
  if (e.target === $('modalBackdrop')) closeModal();
});

// Wait for the async auth setup to finish before doing DB work.
// Returns true if dbReady became true within the timeout, false otherwise.
function waitForAuth(timeoutMs = 5000) {
  return new Promise(resolve => {
    if (dbReady) return resolve(true);
    const started = Date.now();
    const tick = () => {
      if (dbReady) return resolve(true);
      if (Date.now() - started > timeoutMs) return resolve(false);
      setTimeout(tick, 100);
    };
    tick();
  });
}

// ═══════════════════════════════════════════════════════════
//  CATEGORIES
// ═══════════════════════════════════════════════════════════
async function loadCategoriesFromDb() {
  // Don't bail to defaults just because dbReady isn't true yet — the
  // async auth setup may still be running. Wait briefly first.
  await waitForAuth();

  if (!dbReady) {
    console.warn('loadCategoriesFromDb: auth not ready after 5s, using defaults');
    state.categories = DEFAULT_CATEGORIES.map((c, i) => ({ ...c, id: 'local-' + i }));
    return;
  }

  try {
    const { data, error } = await dbClient.from('categories')
      .select('*').order('sort_order', { ascending: true });
    if (error) throw error;

    if (!data || data.length === 0) {
      // Seed defaults — stamp user_id on each
      const { data: inserted, error: insErr } = await dbClient
        .from('categories').insert(DEFAULT_CATEGORIES.map(c => withUid({...c}))).select();
      if (insErr) throw insErr;
      state.categories = inserted || [];
    } else {
      state.categories = data;
    }
  } catch (e) {
    console.error('Load categories error:', e);
    state.categories = DEFAULT_CATEGORIES.map((c, i) => ({ ...c, id: 'local-' + i }));
  }
}

// ═══════════════════════════════════════════════════════════
//  TRACKER PAGE
// ═══════════════════════════════════════════════════════════
async function loadTracker() {
  const dateStr = dateToString(state.trackerDate);
  $('trackerDate').textContent = formatDate(state.trackerDate);

  const isToday = isSameDate(state.trackerDate, new Date());
  $('trackerToday').textContent = isToday ? 'Today' : dateToString(state.trackerDate);

  let entries = [];
  if (dbReady) {
    try {
      const { data, error } = await dbClient.from('time_entries')
        .select('*').eq('date', dateStr)
        .order('started_at', { ascending: true });
      if (!error) entries = data || [];
    } catch (e) {
      console.error('Load tracker error:', e);
    }
  }

  // Separate task entries from breaks/day markers for stats
  const taskEntries = entries.filter(e => !e.entry_type || e.entry_type === 'task');
  const allVisible  = entries.filter(e => e.entry_type !== 'day_start' && e.entry_type !== 'day_end');

  renderTrackerStats(taskEntries);
  renderTrackerRows(allVisible);
}

function renderTrackerStats(entries) {
  const total = entries.reduce((s, e) => s + e.duration_secs, 0);
  $('statTotal').textContent = formatHoursMins(total) || '0m';
  $('statCount').textContent = entries.length;

  // Top category
  const byCat = {};
  entries.forEach(e => {
    const c = e.category || 'Uncategorised';
    byCat[c] = (byCat[c] || 0) + e.duration_secs;
  });
  const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
  $('statTop').textContent = top ? `${top[0]} · ${formatHoursMins(top[1])}` : '—';

  // First / Last
  if (entries.length > 0) {
    const first = formatTime(entries[0].started_at);
    const last = formatTime(entries[entries.length - 1].ended_at);
    $('statSpan').textContent = `${first} → ${last}`;
  } else {
    $('statSpan').textContent = '—';
  }
}

function renderTrackerRows(entries) {
  const rows = $('trackerRows');
  if (entries.length === 0) {
    rows.innerHTML = '<div class="empty-state"><div class="big">⏱</div><div>No entries yet for this day.<br>Use the floating widget to start logging.</div></div>';
    return;
  }

  rows.innerHTML = entries.map(e => {
    const isPaused = e.entry_type === 'paused';
    const isBreak  = e.entry_type === 'break'; // legacy entries pre-v5.5.5
    const isPlaceholder = isPaused || isBreak;
    const isTouched = !isPlaceholder && (e.is_manual || e.edited_at);
    const touchedTitle = e.is_manual ? 'Added manually' : 'Edited';
    const touchedMark = isTouched
      ? `<span class="touched-mark" title="${touchedTitle}">✎</span>`
      : '';
    let catCell, taskCell;
    if (isPaused) {
      catCell  = `<span style="color:var(--text-dim);font-size:11px;font-weight:500;">⏸ Paused</span>`;
      taskCell = `<span style="color:var(--text-dim);font-style:italic;">Paused — not counted</span>`;
    } else if (isBreak) {
      catCell  = `<span style="color:#fbbf24;font-size:11px;font-weight:500;">☕ Break</span>`;
      taskCell = `<span style="color:var(--text-dim);font-style:italic;">${escapeHtml(e.task_name)}</span>`;
    } else {
      catCell = e.category
        ? `<span class="cat-chip" style="background:${colourToSoft(categoryColour(e.category))};color:${categoryColour(e.category)}">${escapeHtml(e.category)}</span>`
        : '<span style="color:var(--text-dim);font-size:11px;">—</span>';
      taskCell = `${touchedMark}${escapeHtml(e.task_name)}`;
    }
    const rowClass = `table-row${isTouched ? ' touched-row' : ''}`;
    const rowStyle = isPlaceholder ? 'style="opacity:0.55;"' : '';
    // Paused placeholders aren't editable — they're just a visual record of
    // unaccounted time, not a task entry.
    const actionsCell = isPaused
      ? `<div class="row-actions"><button class="mini-btn danger" data-action="delete" data-id="${e.id}" title="Delete">✕</button></div>`
      : `<div class="row-actions">
           <button class="mini-btn" data-action="edit" data-id="${e.id}" title="Edit">✎</button>
           <button class="mini-btn danger" data-action="delete" data-id="${e.id}" title="Delete">✕</button>
         </div>`;
    return `
    <div class="${rowClass}" data-id="${e.id}" ${rowStyle}>
      <div class="time-col">${formatTime(e.started_at)}</div>
      <div class="time-col">${formatTime(e.ended_at)}</div>
      <div class="task-col" title="${escapeHtml(e.task_name)}">${taskCell}</div>
      <div>${catCell}</div>
      <div class="duration-col">${formatDuration(e.duration_secs)}</div>
      ${actionsCell}
    </div>
    `;
  }).join('');

  rows.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => confirmDelete(btn.dataset.id));
  });
  rows.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => openEditEntry(btn.dataset.id, entries));
  });
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function colourToSoft(colour) {
  if (!colour || !colour.startsWith('#')) return 'var(--accent-soft)';
  // Convert hex to rgba with 12% opacity
  const hex = colour.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r},${g},${b},0.12)`;
}

function confirmDelete(id) {
  openModal(`
    <div class="modal-title">Delete this entry?</div>
    <div style="color:var(--text-dim);font-size:13px;">This can't be undone.</div>
    <div class="modal-footer">
      <button class="modal-btn" onclick="closeModal()">Cancel</button>
      <button class="modal-btn danger" id="confirmDeleteBtn">Delete</button>
    </div>
  `);
  $('confirmDeleteBtn').addEventListener('click', async () => {
    if (dbReady) {
      await dbClient.from('time_entries').delete().eq('id', id);
    }
    closeModal();
    loadTracker();
  });
}

function openEditEntry(id, entries) {
  const entry = entries.find(e => e.id === id);
  if (!entry) return;

  const catOptions = '<option value="">— None —</option>' +
    state.categories.map(c =>
      `<option value="${escapeHtml(c.name)}" ${c.name === entry.category ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
    ).join('');

  openModal(`
    <div class="modal-title">Edit Entry</div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Task</div>
        <input type="text" class="field-input" id="editTask" value="${escapeHtml(entry.task_name)}" style="width:100%;">
      </div>
      <div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Category</div>
        <select class="field-input" id="editCategory" style="width:100%;">${catOptions}</select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div>
          <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Start time</div>
          <input type="time" class="field-input" id="editStart" value="${formatTime(entry.started_at)}" style="width:100%;">
        </div>
        <div>
          <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">End time</div>
          <input type="time" class="field-input" id="editEnd" value="${formatTime(entry.ended_at)}" style="width:100%;">
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="modal-btn" onclick="closeModal()">Cancel</button>
      <button class="modal-btn primary" id="saveEditBtn">Save</button>
    </div>
  `);

  $('saveEditBtn').addEventListener('click', async () => {
    const task = $('editTask').value.trim();
    const cat  = $('editCategory').value || null;
    const startT = $('editStart').value;
    const endT   = $('editEnd').value;
    if (!task || !startT || !endT) return;

    const dateStr = entry.date;
    const startIso = new Date(dateStr + 'T' + startT + ':00').toISOString();
    const endIso   = new Date(dateStr + 'T' + endT + ':00').toISOString();
    const duration = Math.max(0, Math.round((new Date(endIso) - new Date(startIso)) / 1000));

    if (dbReady) {
      await dbClient.from('time_entries').update({
        task_name: task,
        category: cat,
        started_at: startIso,
        ended_at: endIso,
        duration_secs: duration,
        edited_at: new Date().toISOString()
      }).eq('id', id);
    }
    closeModal();
    loadTracker();
  });
}

// ── Add manual entry ──────────────────────────────────────────
function openAddManualEntry() {
  const dateStr = dateToString(state.trackerDate);
  const catOptions = '<option value="">— None —</option>' +
    state.categories.map(c =>
      `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`
    ).join('');

  // Default times: 09:00 to 09:30
  let defaultStart = '09:00';
  let defaultEnd = '09:30';
  // If today and current time is reasonable, use last entry's end -> now
  const now = new Date();
  if (isSameDate(state.trackerDate, now)) {
    defaultEnd = pad(now.getHours()) + ':' + pad(now.getMinutes());
    const earlier = new Date(now.getTime() - 30 * 60 * 1000);
    defaultStart = pad(earlier.getHours()) + ':' + pad(earlier.getMinutes());
  }

  openModal(`
    <div class="modal-title">Add manual entry</div>
    <div style="font-size:11px;color:var(--text-dim);margin-bottom:14px;">For when you forgot to track \u2014 marked with a small ✎ on the entry so it's clear it was added by hand.</div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Task</div>
        <input type="text" class="field-input" id="manualTask" placeholder="What were you doing?" style="width:100%;">
      </div>
      <div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Category</div>
        <select class="field-input" id="manualCategory" style="width:100%;">${catOptions}</select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div>
          <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Start time</div>
          <input type="time" class="field-input" id="manualStart" value="${defaultStart}" style="width:100%;">
        </div>
        <div>
          <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">End time</div>
          <input type="time" class="field-input" id="manualEnd" value="${defaultEnd}" style="width:100%;">
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="modal-btn" onclick="closeModal()">Cancel</button>
      <button class="modal-btn primary" id="saveManualBtn">Add entry</button>
    </div>
  `);

  // Focus the task field
  setTimeout(() => $('manualTask').focus(), 60);

  $('saveManualBtn').addEventListener('click', async () => {
    const task = $('manualTask').value.trim();
    const cat  = $('manualCategory').value || null;
    const startT = $('manualStart').value;
    const endT   = $('manualEnd').value;
    if (!task) { $('manualTask').focus(); return; }
    if (!startT || !endT) return;

    const startIso = new Date(dateStr + 'T' + startT + ':00').toISOString();
    const endIso   = new Date(dateStr + 'T' + endT + ':00').toISOString();
    if (new Date(endIso) <= new Date(startIso)) {
      alert('End time must be after start time.');
      return;
    }
    const duration = Math.round((new Date(endIso) - new Date(startIso)) / 1000);

    if (dbReady) {
      const { error } = await dbClient.from('time_entries').insert(withUid({
        task_name:     task,
        category:      cat,
        started_at:    startIso,
        ended_at:      endIso,
        duration_secs: duration,
        date:          dateStr,
        entry_type:    'task',
        is_manual:     true
      }));
      if (error) {
        console.error('Manual entry insert failed:', error);
        alert('Could not save: ' + error.message);
        return;
      }
    }
    closeModal();
    loadTracker();
  });
}

// Tracker date navigation
$('trackerPrev').addEventListener('click', () => {
  state.trackerDate = addDays(state.trackerDate, -1);
  loadTracker();
});
$('trackerNext').addEventListener('click', () => {
  state.trackerDate = addDays(state.trackerDate, 1);
  loadTracker();
});
$('trackerToday').addEventListener('click', () => {
  state.trackerDate = new Date();
  loadTracker();
});

if ($('addManualEntryBtn')) {
  $('addManualEntryBtn').addEventListener('click', openAddManualEntry);
}

// ═══════════════════════════════════════════════════════════
//  PLANNER PAGE
// ═══════════════════════════════════════════════════════════
const SLOT_MINUTES = 15;
// Default planner window — clean, compact view for most users
const DAY_START_HOUR_DEFAULT  = 6;   // 6am
const DAY_END_HOUR_DEFAULT    = 18;  // 6pm (last slot 17:30)
// Extended planner window — toggle in UI to reveal early-bird/late hours
const DAY_START_HOUR_EXTENDED = 4;   // 4am
const DAY_END_HOUR_EXTENDED   = 22;  // 10pm

// Active values — switched at runtime by the toggle
let DAY_START_HOUR = DAY_START_HOUR_DEFAULT;
let DAY_END_HOUR   = DAY_END_HOUR_DEFAULT;

function generateTimeSlots() {
  const slots = [];
  for (let h = DAY_START_HOUR; h < DAY_END_HOUR; h++) {
    for (let m = 0; m < 60; m += 30) {
      slots.push(pad(h) + ':' + pad(m));
    }
  }
  return slots;
}

async function loadPlanner() {
  const dateStr = dateToString(state.plannerDate);
  $('plannerDate').textContent = formatDate(state.plannerDate);

  const isToday = isSameDate(state.plannerDate, new Date());
  $('plannerToday').textContent = isToday ? 'Today' : dateToString(state.plannerDate);

  let planItems = [];
  let entries = [];
  let calendarEvents = [];     // timed events from MS calendar (today only)
  let allDayEvents   = [];     // all-day events (rendered as a strip)

  if (dbReady) {
    try {
      const [planRes, entryRes] = await Promise.all([
        dbClient.from('day_plans').select('*').eq('date', dateStr).order('planned_start', { ascending: true }),
        dbClient.from('time_entries').select('*').eq('date', dateStr).order('started_at', { ascending: true })
      ]);
      planItems = planRes.data || [];
      const allEntries = entryRes.data || [];
      // Show task entries AND breaks on the planner — breaks render greyed
      entries = allEntries.filter(e =>
        !e.entry_type || e.entry_type === 'task' || e.entry_type === 'break'
      );
    } catch (e) {
      console.error('Load planner error:', e);
    }
  }

  // Pull calendar events from Microsoft Graph (if connected)
  try {
    const connected = await ipcRenderer.invoke('graph-is-connected');
    if (connected) {
      // Day boundaries in the user's local timezone, sent as ISO
      const dayStart = new Date(state.plannerDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const result = await ipcRenderer.invoke('graph-list-events', {
        startISO: dayStart.toISOString(),
        endISO:   dayEnd.toISOString()
      });
      if (result && result.ok) {
        // Look up any saved category assignments for these events
        let assignmentMap = {};
        if (dbReady && result.events.length > 0) {
          try {
            const ids = result.events.map(e => e.ms_event_id);
            const { data: cached } = await dbClient.from('calendar_events')
              .select('ms_event_id, category')
              .eq('date', dateStr)
              .in('ms_event_id', ids);
            (cached || []).forEach(c => { if (c.category) assignmentMap[c.ms_event_id] = c.category; });
          } catch (e) { /* table may not exist yet — ignore */ }
        }

        result.events.forEach(ev => {
          if (ev.is_cancelled) return;
          ev.category = assignmentMap[ev.ms_event_id] || null;
          if (ev.is_all_day) {
            allDayEvents.push(ev);
          } else {
            // Convert to plan-item-like shape so the existing render path works
            const start = new Date(ev.starts_at);
            const end   = new Date(ev.ends_at);
            calendarEvents.push({
              _isCalendarEvent: true,
              ms_event_id:   ev.ms_event_id,
              task_name:     ev.subject,
              category:      ev.category || null,
              location:      ev.location,
              organiser:     ev.organiser,
              planned_start: pad(start.getHours()) + ':' + pad(start.getMinutes()),
              planned_end:   pad(end.getHours())   + ':' + pad(end.getMinutes()),
              date:          dateStr
            });
          }
        });
      }
    }
  } catch (e) {
    console.error('Calendar fetch failed:', e);
  }

  // Calendar events are pseudo-plan-items — merge them into planItems
  // so they go through the same render path. They're rendered with a
  // distinct visual style in placeItemBlock by checking _isCalendarEvent.
  planItems = [...planItems, ...calendarEvents];

  // Determine the active hour range (extended toggle OR auto-expand if data falls outside default window)
  const needsExtendedForData = (() => {
    const outsideDefault = (mins) =>
      mins < DAY_START_HOUR_DEFAULT * 60 || mins >= DAY_END_HOUR_DEFAULT * 60;
    for (const p of planItems) {
      const [sh, sm] = p.planned_start.split(':').map(Number);
      const [eh, em] = p.planned_end.split(':').map(Number);
      if (outsideDefault(sh * 60 + sm) || outsideDefault(eh * 60 + em - 1)) return true;
    }
    for (const e of entries) {
      const s = new Date(e.started_at);
      const en = new Date(e.ended_at);
      if (outsideDefault(s.getHours() * 60 + s.getMinutes()) ||
          outsideDefault(en.getHours() * 60 + en.getMinutes() - 1)) return true;
    }
    return false;
  })();

  const useExtended = state.extendedHours || needsExtendedForData;
  DAY_START_HOUR = useExtended ? DAY_START_HOUR_EXTENDED : DAY_START_HOUR_DEFAULT;
  DAY_END_HOUR   = useExtended ? DAY_END_HOUR_EXTENDED   : DAY_END_HOUR_DEFAULT;

  // Reflect auto-expand visually so the user knows why the view widened
  const toggle = $('extendedHoursToggle');
  if (toggle) toggle.checked = useExtended;

  // Update stats
  const plannedSecs = planItems.reduce((s, p) => {
    const start = p.planned_start;
    const end   = p.planned_end;
    return s + timeRangeToSecs(start, end);
  }, 0);
  $('planTotal').textContent = formatHoursMins(plannedSecs) || '—';

  const matchScore = calculatePlanMatch(planItems, entries);
  $('planMatchScore').textContent = (matchScore === null ? '—' : matchScore + '%');

  // All-day events strip — only shown if there are any
  renderAllDayStrip(allDayEvents, dateStr);

  // Render the views
  applyPlannerZoom();
  if (state.plannerView === 'split') {
    $('plannerSingle').style.display = 'none';
    $('plannerSplit').style.display = 'grid';
    renderPlannerGrid($('plannerGridPlanned'), 'plan', planItems, entries, true);
    renderPlannerGrid($('plannerGridActual'),  'actual', planItems, entries, true);
  } else {
    $('plannerSingle').style.display = 'block';
    $('plannerSplit').style.display = 'none';
    renderPlannerGrid($('plannerGridSingle'), state.plannerView, planItems, entries, false);
  }
}

function renderAllDayStrip(allDayEvents, dateStr) {
  const strip = $('allDayStrip');
  if (!strip) return;
  if (!allDayEvents || allDayEvents.length === 0) {
    strip.style.display = 'none';
    strip.innerHTML = '';
    return;
  }
  strip.style.display = 'flex';
  const items = allDayEvents.map(ev => {
    const cat = ev.category ? `<span class="all-day-event-cat">${escapeHtml(ev.category)}</span>` : '';
    return `<div class="all-day-event" data-id="${escapeHtml(ev.ms_event_id)}">📅 ${escapeHtml(ev.subject)} ${cat}</div>`;
  }).join('');
  strip.innerHTML = `<span class="all-day-label">All day</span>${items}`;

  // Click to assign category
  strip.querySelectorAll('.all-day-event').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      const ev = allDayEvents.find(e => e.ms_event_id === id);
      if (!ev) return;
      // Reuse the same picker, with synthesised time fields
      openCalendarEventCategoryPicker({
        _isCalendarEvent: true,
        ms_event_id:   ev.ms_event_id,
        task_name:     ev.subject,
        category:      ev.category || null,
        location:      ev.location,
        organiser:     ev.organiser,
        planned_start: '00:00',
        planned_end:   '23:59',
        date:          dateStr,
        is_all_day:    true
      });
    });
  });
}

function applyPlannerZoom() {
  const px = (30 * state.plannerZoom) + 'px';
  document.querySelectorAll('.planner-grid').forEach(grid => {
    grid.style.setProperty('--slot-height', px);
  });
}

function timeRangeToSecs(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return Math.max(0, (eh * 3600 + em * 60) - (sh * 3600 + sm * 60));
}

function calculatePlanMatch(plans, actuals) {
  if (plans.length === 0 && actuals.length === 0) return null;
  if (plans.length === 0) return 0;

  // Build per-15-min category map for plan
  const planMap = {};
  plans.forEach(p => {
    const [sh, sm] = p.planned_start.split(':').map(Number);
    const [eh, em] = p.planned_end.split(':').map(Number);
    const startSlot = sh * 4 + Math.floor(sm / 15);
    const endSlot   = eh * 4 + Math.floor(em / 15);
    for (let i = startSlot; i < endSlot; i++) {
      planMap[i] = p.category || '_nocat_';
    }
  });

  // Build per-15-min category map for actual
  const actualMap = {};
  actuals.forEach(a => {
    const s = new Date(a.started_at);
    const e = new Date(a.ended_at);
    const startSlot = s.getHours() * 4 + Math.floor(s.getMinutes() / 15);
    const endSlot   = e.getHours() * 4 + Math.floor(e.getMinutes() / 15);
    for (let i = startSlot; i <= endSlot; i++) {
      actualMap[i] = a.category || '_nocat_';
    }
  });

  // Compare overlapping slots
  const allSlots = new Set([...Object.keys(planMap), ...Object.keys(actualMap)]);
  if (allSlots.size === 0) return null;
  let matching = 0;
  allSlots.forEach(s => {
    if (planMap[s] && actualMap[s] && planMap[s] === actualMap[s]) matching++;
  });

  return Math.round((matching / allSlots.size) * 100);
}

function renderPlannerGrid(container, mode, planItems, entries, compact) {
  container.innerHTML = '';
  const slots = generateTimeSlots();

  slots.forEach((slot, idx) => {
    const slotDiv = document.createElement('div');
    slotDiv.className = 'time-slot';
    slotDiv.innerHTML = `
      <div class="time-label">${slot}</div>
      <div class="slot-content" data-slot="${slot}"></div>
    `;
    container.appendChild(slotDiv);
  });

  // Render plan items
  if (mode === 'plan' || mode === 'actual') {
    const items = mode === 'plan' ? planItems : entries;
    // Pre-compute column assignments for overlapping items
    const positioned = assignColumns(items, mode);
    positioned.forEach(info => {
      placeItemBlock(container, info.item, mode, compact, planItems, entries, info.column, info.totalColumns);
    });
  }
}

// Compute column layout for overlapping tasks
// Returns [{item, column, totalColumns}] — column is 0-indexed
function assignColumns(items, mode) {
  if (items.length === 0) return [];

  // Get minutes-from-midnight for start/end
  const timed = items.map(item => {
    if (mode === 'plan') {
      const [sh, sm] = item.planned_start.split(':').map(Number);
      const [eh, em] = item.planned_end.split(':').map(Number);
      return { item, startMins: sh * 60 + sm, endMins: eh * 60 + em };
    } else {
      const s = new Date(item.started_at);
      const e = new Date(item.ended_at);
      return { item, startMins: s.getHours() * 60 + s.getMinutes(), endMins: e.getHours() * 60 + e.getMinutes() };
    }
  }).sort((a, b) => a.startMins - b.startMins || a.endMins - b.endMins);

  // Group into clusters of items that overlap (transitively)
  const clusters = [];
  let currentCluster = [];
  let clusterEnd = -1;

  timed.forEach(t => {
    if (currentCluster.length === 0 || t.startMins < clusterEnd) {
      currentCluster.push(t);
      clusterEnd = Math.max(clusterEnd, t.endMins);
    } else {
      clusters.push(currentCluster);
      currentCluster = [t];
      clusterEnd = t.endMins;
    }
  });
  if (currentCluster.length > 0) clusters.push(currentCluster);

  // For each cluster, assign columns greedily
  const result = [];
  clusters.forEach(cluster => {
    const columns = []; // array of endMins — each column's latest task end
    const assignments = cluster.map(t => {
      // Find first column that ended before this task starts
      let col = columns.findIndex(end => end <= t.startMins);
      if (col === -1) {
        columns.push(t.endMins);
        col = columns.length - 1;
      } else {
        columns[col] = t.endMins;
      }
      return { ...t, column: col };
    });
    const totalColumns = columns.length;
    assignments.forEach(a => {
      result.push({ item: a.item, column: a.column, totalColumns });
    });
  });

  return result;
}

function placeItemBlock(container, item, mode, compact, planItems, entries, column = 0, totalColumns = 1) {
  const isPlan = mode === 'plan';
  const startStr = isPlan ? item.planned_start : formatTime(item.started_at);
  const endStr   = isPlan ? item.planned_end   : formatTime(item.ended_at);

  // SLOT_HEIGHT scales with zoom level — 30px base × zoom
  const SLOT_HEIGHT = 30 * state.plannerZoom;
  const MINS_PER_SLOT = 30;
  const PX_PER_MIN = SLOT_HEIGHT / MINS_PER_SLOT;

  const [sh, sm] = startStr.split(':').map(Number);

  // Find the slot this task starts in (round DOWN to nearest 30-min grid)
  const slotH = sh;
  const slotM = sm < 30 ? 0 : 30;
  const slotTime = pad(slotH) + ':' + pad(slotM);
  const slotContent = container.querySelector(`[data-slot="${slotTime}"]`);
  if (!slotContent) return;

  // Minutes offset from the start of this slot
  const offsetMins = (sh * 60 + sm) - (slotH * 60 + slotM);
  const offsetPx = offsetMins * PX_PER_MIN;

  // Duration in minutes
  const durMins = timeRangeToSecs(startStr, endStr) / 60;
  const pixelHeight = Math.max(15, durMins * PX_PER_MIN - 2);

  const block = document.createElement('div');
  block.className = 'task-block';
  // Position absolutely so it can overflow/span multiple 30-min slots
  block.style.position = 'absolute';
  block.style.top = (offsetPx + 3) + 'px';

  // Horizontal positioning — split width across columns for overlapping tasks
  if (totalColumns > 1) {
    const colWidth = 100 / totalColumns;
    const leftPct = column * colWidth;
    block.style.left = `calc(${leftPct}% + 6px)`;
    block.style.width = `calc(${colWidth}% - 8px)`;
  } else {
    block.style.left = '6px';
    block.style.right = '6px';
  }

  block.style.height = pixelHeight + 'px';
  block.style.zIndex = '2';

  if (mode === 'actual' && !compact) {
    const cat = state.categories.find(c => c.name === item.category);
    if (cat) block.style.borderLeftColor = cat.colour;
  }

  // Break entries get a distinct greyed look
  if (item.entry_type === 'break') {
    block.classList.add('break-block');
  }

  // Calendar events from Microsoft — distinct dotted style + 📅 badge
  if (item._isCalendarEvent) {
    block.classList.add('calendar-event-block');
    if (item.category) {
      const cat = state.categories.find(c => c.name === item.category);
      if (cat) block.style.borderLeftColor = cat.colour;
    }
  }

  // Compact split-view colours (match / mismatch)
  if (compact && mode === 'actual') {
    const match = isActualMatchingPlan(item, planItems);
    if (match === 'match') block.classList.add('match');
    else if (item.category === 'Time Wasting') block.classList.add('mismatch-bad');
    else block.classList.add('mismatch');
  }

  // High-priority planned tasks get a red flag immediately to the left of
  // the category badge. Only shown on plan blocks (not actual entries or
  // calendar events).
  const priorityFlag = (mode === 'plan' && item.is_high_priority)
    ? `<span class="task-block-priority" title="High priority" style="flex-shrink:0;margin-left:4px;font-size:11px;color:#ef4444;">🚩</span>`
    : '';

  if (item._isCalendarEvent) {
    block.innerHTML = `
      <div style="overflow:hidden;min-width:0;flex:1;">
        <div class="task-block-title" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📅 ${escapeHtml(item.task_name)}</div>
      </div>
      <div class="task-block-cat" style="flex-shrink:0;margin-left:6px;">${escapeHtml(item.category || 'Set…')}</div>
    `;
  } else {
    block.innerHTML = `
      <div style="overflow:hidden;min-width:0;flex:1;">
        <div class="task-block-title" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(item.task_name)}</div>
      </div>
      ${priorityFlag}
      <div class="task-block-cat" style="flex-shrink:0;margin-left:6px;">${escapeHtml(item.category || 'Uncat.')}</div>
    `;
  }

  // slotContent needs relative positioning so child can be absolute
  slotContent.style.position = 'relative';
  slotContent.appendChild(block);
  slotContent.classList.add('has-task');

  // For tasks that span beyond this slot, mark the spanned slots so they don't accept clicks
  const endMinsTotal = sh * 60 + sm + durMins;
  const slotEndMinsTotal = slotH * 60 + slotM + MINS_PER_SLOT;
  if (endMinsTotal > slotEndMinsTotal) {
    // Mark subsequent slots as occupied
    let cursorMins = slotEndMinsTotal;
    while (cursorMins < endMinsTotal) {
      const ch = Math.floor(cursorMins / 60);
      const cm = cursorMins % 60;
      const nextSlot = container.querySelector(`[data-slot="${pad(ch)}:${pad(cm)}"]`);
      if (nextSlot) nextSlot.classList.add('has-task');
      cursorMins += MINS_PER_SLOT;
    }
  }

  // Drag-to-resize and drag-to-move are only available on the single plan view
  // (and never on calendar events — those are read-only)
  if (isPlan && !compact && !item._isCalendarEvent) {
    attachResizeHandle(block, item, PX_PER_MIN);
    attachDragToMove(block, item, PX_PER_MIN);
  }

  // Click to edit (only if it wasn't a drag action)
  block.addEventListener('click', (e) => {
    if (block.dataset.wasDragged === 'true') {
      block.dataset.wasDragged = 'false';
      return;
    }
    if (item._isCalendarEvent) {
      openCalendarEventCategoryPicker(item);
    } else if (isPlan) {
      openEditPlanItem(item);
    }
  });
}

function attachResizeHandle(block, item, pxPerMin) {
  const SNAP_MINS = 15;
  const snapPx = SNAP_MINS * pxPerMin;

  const handle = document.createElement('div');
  handle.className = 'resize-handle';
  handle.style.cssText = 'position:absolute;bottom:-3px;left:0;right:0;height:7px;cursor:ns-resize;z-index:5;';
  handle.title = 'Drag to resize';
  block.appendChild(handle);

  let isResizing = false;
  let startY = 0;
  let startHeight = 0;

  const onDown = (e) => {
    e.stopPropagation();
    e.preventDefault();
    isResizing = true;
    startY = e.clientY;
    startHeight = block.offsetHeight;
    document.body.style.cursor = 'ns-resize';
    block.dataset.wasDragged = 'true';
  };

  const onMove = (e) => {
    if (!isResizing) return;
    const delta = e.clientY - startY;
    const rawHeight = Math.max(snapPx, startHeight + delta);
    // Snap to 15-min increments
    const snapped = Math.round(rawHeight / snapPx) * snapPx - 2;
    block.style.height = Math.max(snapPx - 2, snapped) + 'px';
  };

  const onUp = async () => {
    if (!isResizing) return;
    isResizing = false;
    document.body.style.cursor = '';

    const finalHeight = parseInt(block.style.height) || block.offsetHeight;
    const slotsCount = Math.max(1, Math.round((finalHeight + 2) / snapPx));
    const newDurMins = slotsCount * SNAP_MINS;

    const [sh, sm] = item.planned_start.split(':').map(Number);
    const newEndMins = sh * 60 + sm + newDurMins;
    if (newEndMins > 24 * 60) return;
    const newEnd = pad(Math.floor(newEndMins / 60)) + ':' + pad(newEndMins % 60);

    if (dbReady && newEnd !== item.planned_end.substring(0, 5)) {
      try {
        await dbClient.from('day_plans').update({ planned_end: newEnd }).eq('id', item.id);
        loadPlanner();
      } catch (err) { console.error('Resize failed', err); }
    }
  };

  handle.addEventListener('mousedown', onDown);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function attachDragToMove(block, item, pxPerMin) {
  const SNAP_MINS = 15;
  const snapPx = SNAP_MINS * pxPerMin;

  let isDragging = false;
  let dragStartY = 0;
  let movedSnaps = 0;

  const onDown = (e) => {
    if (e.target.classList.contains('resize-handle')) return;
    if (!e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    isDragging = true;
    dragStartY = e.clientY;
    block.style.opacity = '0.6';
    block.style.zIndex = '20';
    document.body.style.cursor = 'grabbing';
    block.dataset.wasDragged = 'true';
  };

  const onMove = (e) => {
    if (!isDragging) return;
    const delta = e.clientY - dragStartY;
    movedSnaps = Math.round(delta / snapPx);
    block.style.transform = `translateY(${movedSnaps * snapPx}px)`;
  };

  const onUp = async () => {
    if (!isDragging) return;
    isDragging = false;
    block.style.opacity = '';
    block.style.transform = '';
    block.style.zIndex = '';
    document.body.style.cursor = '';

    if (movedSnaps === 0) return;

    const [sh, sm] = item.planned_start.split(':').map(Number);
    const [eh, em] = item.planned_end.split(':').map(Number);
    const minsDelta = movedSnaps * SNAP_MINS;
    const newStartMins = sh * 60 + sm + minsDelta;
    const newEndMins   = eh * 60 + em + minsDelta;
    if (newStartMins < 0 || newEndMins > 24 * 60) return;

    const newStart = pad(Math.floor(newStartMins / 60)) + ':' + pad(newStartMins % 60);
    const newEnd   = pad(Math.floor(newEndMins / 60))   + ':' + pad(newEndMins % 60);

    if (dbReady) {
      try {
        await dbClient.from('day_plans').update({
          planned_start: newStart,
          planned_end:   newEnd
        }).eq('id', item.id);
        loadPlanner();
      } catch (err) { console.error('Move failed', err); }
    }
  };

  block.addEventListener('mousedown', onDown);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function isActualMatchingPlan(actual, plans) {
  const s = new Date(actual.started_at);
  const aStart = s.getHours() * 60 + s.getMinutes();
  for (const p of plans) {
    const [ph, pm] = p.planned_start.split(':').map(Number);
    const [eh, em] = p.planned_end.split(':').map(Number);
    const pStart = ph * 60 + pm;
    const pEnd   = eh * 60 + em;
    if (aStart >= pStart && aStart < pEnd && actual.category === p.category) {
      return 'match';
    }
  }
  return 'mismatch';
}

// ═══════════════════════════════════════════════════════════
//  DRAG-ACROSS-SLOTS to create a new plan item (15-min snapping)
// ═══════════════════════════════════════════════════════════
let slotDragState = null;

function getMinsFromMouse(e) {
  // Figure out what 15-min time the mouse is over
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const slot = el && el.closest('.slot-content[data-slot]');
  if (!slot) return null;
  const rect = slot.getBoundingClientRect();
  const yOffset = e.clientY - rect.top;
  const slotHeight = rect.height || 30;
  // 0..29px maps to 0 or 15 min offset
  const minsIntoSlot = yOffset < slotHeight / 2 ? 0 : 15;
  const [h, m] = slot.dataset.slot.split(':').map(Number);
  return h * 60 + m + minsIntoSlot;
}

document.addEventListener('mousedown', (e) => {
  const slot = e.target.closest('.slot-content');
  if (!slot || slot.classList.contains('has-task')) return;
  if (!slot.closest('#plannerGridSingle')) return;
  if (state.plannerView !== 'plan') return;
  if (e.button !== 0) return;

  const startMins = getMinsFromMouse(e);
  if (startMins === null) return;

  slotDragState = {
    startMins,
    endMins: startMins,
    startX: e.clientX,
    startY: e.clientY,
    dragged: false
  };
});

document.addEventListener('mousemove', (e) => {
  if (!slotDragState) return;

  if (!slotDragState.dragged) {
    const dx = Math.abs(e.clientX - slotDragState.startX);
    const dy = Math.abs(e.clientY - slotDragState.startY);
    if (dx < 4 && dy < 4) return;
    slotDragState.dragged = true;
  }

  const mins = getMinsFromMouse(e);
  if (mins === null) return;
  slotDragState.endMins = mins;

  // Visual preview
  document.querySelectorAll('#plannerGridSingle .slot-content').forEach(s => {
    s.style.backgroundColor = '';
  });

  const loMins = Math.min(slotDragState.startMins, slotDragState.endMins);
  const hiMins = Math.max(slotDragState.startMins, slotDragState.endMins);

  document.querySelectorAll('#plannerGridSingle .slot-content[data-slot]').forEach(s => {
    const [sh, sm] = s.dataset.slot.split(':').map(Number);
    const slotMins = sh * 60 + sm;
    // Slot covers [slotMins, slotMins+30)
    if (slotMins + 30 > loMins && slotMins <= hiMins && !s.classList.contains('has-task')) {
      s.style.backgroundColor = 'var(--accent-soft)';
    }
  });
});

document.addEventListener('mouseup', (e) => {
  if (!slotDragState) return;

  document.querySelectorAll('#plannerGridSingle .slot-content').forEach(s => {
    s.style.backgroundColor = '';
  });

  const wasDragged = slotDragState.dragged;
  const loMins = Math.min(slotDragState.startMins, slotDragState.endMins);
  let hiMins = Math.max(slotDragState.startMins, slotDragState.endMins);

  // If we didn't drag (just a click), default to 30-min task
  // If we dragged but start == end, bump by 15 min so we have a valid range
  if (!wasDragged) {
    hiMins = loMins + 30;
  } else if (hiMins === loMins) {
    hiMins = loMins + 15;
  } else {
    // Include the 15-min block being pointed at
    hiMins = hiMins + 15;
  }

  const newStart = pad(Math.floor(loMins / 60)) + ':' + pad(loMins % 60);
  const newEnd   = pad(Math.floor(hiMins / 60)) + ':' + pad(hiMins % 60);

  slotDragState = null;

  openAddPlanItem(newStart, newEnd);
});

// Track the most recent planned task end time so new plan items can default to it
let lastPlanEndTime = null;

async function openAddPlanItem(startTime, explicitEndTime, opts = {}) {
  // opts.sourceTodoId — if set, this plan task came from a To-Do; we stamp
  //                     todos.scheduled_date on save so the "Scheduled" badge appears.
  const sourceTodoId = opts.sourceTodoId || null;

  // If no explicit start, try to use the last plan item's end as default
  if (!startTime || startTime === '00:00') {
    if (lastPlanEndTime) {
      startTime = lastPlanEndTime;
    } else {
      // Fall back to fetching last plan item from today
      const lastEnd = await getLastPlannedEndTime();
      if (lastEnd) startTime = lastEnd;
    }
  }

  let endTime;
  if (explicitEndTime) {
    endTime = explicitEndTime;
  } else {
    const [h, m] = (startTime || '09:00').split(':').map(Number);
    const endMins = h * 60 + m + 30;
    const endH = Math.floor(endMins / 60);
    const endM = endMins % 60;
    endTime = pad(endH) + ':' + pad(endM);
  }

  const catOptions = '<option value="">— None —</option>' +
    state.categories.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');

  // Default the date to whatever day the planner is currently showing.
  const defaultDate = dateToString(state.plannerDate);

  openModal(`
    <div class="modal-title">Add planned task</div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <input type="text" class="field-input" id="planTask" placeholder="Task name" style="width:100%;" autofocus>
      <select class="field-input" id="planCategory" style="width:100%;">${catOptions}</select>
      <div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Date</div>
        <input type="date" class="field-input" id="planDate" value="${defaultDate}" style="width:100%;font-family:'DM Mono',monospace;">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div>
          <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Start (e.g. 9:30 or 0930)</div>
          <input type="text" class="field-input" id="planStart" value="${startTime}" placeholder="HH:MM" style="width:100%;font-family:'DM Mono',monospace;">
        </div>
        <div>
          <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">End</div>
          <input type="text" class="field-input" id="planEnd" value="${endTime}" placeholder="HH:MM" style="width:100%;font-family:'DM Mono',monospace;">
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:2px;">
        <span style="font-size:10px;color:var(--text-dim);align-self:center;margin-right:4px;">Quick duration:</span>
        <button type="button" class="quick-dur-btn" data-mins="15">15m</button>
        <button type="button" class="quick-dur-btn" data-mins="30">30m</button>
        <button type="button" class="quick-dur-btn" data-mins="45">45m</button>
        <button type="button" class="quick-dur-btn" data-mins="60">1h</button>
        <button type="button" class="quick-dur-btn" data-mins="90">1h 30</button>
        <button type="button" class="quick-dur-btn" data-mins="120">2h</button>
      </div>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:var(--text);margin-top:2px;">
        <input type="checkbox" id="planPriority">
        <span>🚩 High priority</span>
      </label>
    </div>
    <div class="modal-footer">
      <button class="modal-btn" onclick="closeModal()">Cancel</button>
      <button class="modal-btn primary" id="savePlanBtn">Add</button>
    </div>
  `);

  setTimeout(() => $('planTask').focus(), 50);

  // Quick duration buttons set end based on start
  $('modal').querySelectorAll('.quick-dur-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mins = parseInt(btn.dataset.mins);
      const startVal = parseTimeInput($('planStart').value);
      if (startVal === null) return;
      const endMins = Math.min(24 * 60 - 1, startVal + mins);
      $('planEnd').value = pad(Math.floor(endMins / 60)) + ':' + pad(endMins % 60);
    });
  });

  const save = async () => {
    const task = $('planTask').value.trim();
    const category = $('planCategory').value || null;
    const startMins = parseTimeInput($('planStart').value);
    const endMins   = parseTimeInput($('planEnd').value);
    if (!task || startMins === null || endMins === null || endMins <= startMins) {
      // Highlight invalid fields briefly
      ['planStart', 'planEnd'].forEach(id => {
        const el = $(id);
        if (parseTimeInput(el.value) === null) {
          el.style.borderColor = 'var(--danger)';
          setTimeout(() => el.style.borderColor = '', 1000);
        }
      });
      return;
    }

    const start = pad(Math.floor(startMins / 60)) + ':' + pad(startMins % 60);
    const end   = pad(Math.floor(endMins / 60))   + ':' + pad(endMins % 60);

    // Picked date — fall back to today if blank/invalid.
    const pickedDate = $('planDate').value || dateToString(state.plannerDate);
    const isPriority = $('planPriority').checked;

    if (dbReady) {
      await dbClient.from('day_plans').insert([withUid({
        date: pickedDate,
        task_name: task,
        category,
        planned_start: start,
        planned_end: end,
        is_high_priority: isPriority,
        source_todo_id: sourceTodoId
      })]);

      // If this plan came from a To-Do, stamp the scheduled date on the
      // To-Do so the "Scheduled" outline appears in the in-app to-do list.
      if (sourceTodoId) {
        try {
          await dbClient.from('todos')
            .update({ scheduled_date: pickedDate })
            .eq('id', sourceTodoId);
        } catch (e) { console.error('Failed to stamp scheduled_date on todo', e); }
      }
    }

    // Remember this end time for the next "add plan" defaults
    lastPlanEndTime = end;

    // If the picked date differs from the currently-viewed planner date,
    // navigate to it so the user sees their new entry.
    if (pickedDate !== dateToString(state.plannerDate)) {
      state.plannerDate = stringToDate(pickedDate);
    }

    closeModal();
    loadPlanner();
    // Refresh the to-do list too so the "Scheduled" badge updates.
    if (sourceTodoId) loadLocalTodos();
  };

  $('savePlanBtn').addEventListener('click', save);
  $('planTask').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  $('planEnd').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
}

// Parse loose time inputs: "9:30", "09:30", "0930", "930" → minutes since midnight, or null
function parseTimeInput(s) {
  if (!s) return null;
  s = s.trim().replace(/\s/g, '');

  // "9:30" or "09:30"
  const colonMatch = s.match(/^(\d{1,2}):(\d{2})$/);
  if (colonMatch) {
    const h = parseInt(colonMatch[1]);
    const m = parseInt(colonMatch[2]);
    if (h >= 0 && h < 24 && m >= 0 && m < 60) return h * 60 + m;
  }

  // "0930" or "930"
  const digitMatch = s.match(/^(\d{3,4})$/);
  if (digitMatch) {
    const n = digitMatch[1];
    const m = parseInt(n.slice(-2));
    const h = parseInt(n.slice(0, -2));
    if (h >= 0 && h < 24 && m >= 0 && m < 60) return h * 60 + m;
  }

  return null;
}

async function getLastPlannedEndTime() {
  if (!dbReady) return null;
  try {
    const { data } = await dbClient.from('day_plans')
      .select('planned_end')
      .eq('date', dateToString(state.plannerDate))
      .order('planned_end', { ascending: false })
      .limit(1);
    if (data && data.length > 0) {
      return data[0].planned_end.substring(0, 5);
    }
  } catch (e) { console.error(e); }
  return null;
}

function openEditPlanItem(item) {
  const catOptions = '<option value="">— None —</option>' +
    state.categories.map(c => `<option value="${escapeHtml(c.name)}" ${c.name === item.category ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');

  openModal(`
    <div class="modal-title">Edit planned task</div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <input type="text" class="field-input" id="planTask" value="${escapeHtml(item.task_name)}" style="width:100%;">
      <select class="field-input" id="planCategory" style="width:100%;">${catOptions}</select>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div>
          <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Start (e.g. 9:30 or 0930)</div>
          <input type="text" class="field-input" id="planStart" value="${item.planned_start.substring(0,5)}" style="width:100%;font-family:'DM Mono',monospace;">
        </div>
        <div>
          <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">End</div>
          <input type="text" class="field-input" id="planEnd" value="${item.planned_end.substring(0,5)}" style="width:100%;font-family:'DM Mono',monospace;">
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:2px;">
        <span style="font-size:10px;color:var(--text-dim);align-self:center;margin-right:4px;">Quick duration:</span>
        <button type="button" class="quick-dur-btn" data-mins="15">15m</button>
        <button type="button" class="quick-dur-btn" data-mins="30">30m</button>
        <button type="button" class="quick-dur-btn" data-mins="45">45m</button>
        <button type="button" class="quick-dur-btn" data-mins="60">1h</button>
        <button type="button" class="quick-dur-btn" data-mins="90">1h 30</button>
        <button type="button" class="quick-dur-btn" data-mins="120">2h</button>
      </div>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:var(--text);margin-top:2px;">
        <input type="checkbox" id="planPriority" ${item.is_high_priority ? 'checked' : ''}>
        <span>🚩 High priority</span>
      </label>
    </div>
    <div class="modal-footer">
      <button class="modal-btn danger" id="deletePlanBtn">Delete</button>
      <div style="flex:1;"></div>
      <button class="modal-btn" onclick="closeModal()">Cancel</button>
      <button class="modal-btn primary" id="savePlanEditBtn">Save</button>
    </div>
  `);

  $('modal').querySelectorAll('.quick-dur-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mins = parseInt(btn.dataset.mins);
      const startVal = parseTimeInput($('planStart').value);
      if (startVal === null) return;
      const endMins = Math.min(24 * 60 - 1, startVal + mins);
      $('planEnd').value = pad(Math.floor(endMins / 60)) + ':' + pad(endMins % 60);
    });
  });

  $('savePlanEditBtn').addEventListener('click', async () => {
    const task = $('planTask').value.trim();
    const category = $('planCategory').value || null;
    const startMins = parseTimeInput($('planStart').value);
    const endMins   = parseTimeInput($('planEnd').value);
    if (!task || startMins === null || endMins === null || endMins <= startMins) return;

    const start = pad(Math.floor(startMins / 60)) + ':' + pad(startMins % 60);
    const end   = pad(Math.floor(endMins / 60))   + ':' + pad(endMins % 60);

    if (dbReady) {
      await dbClient.from('day_plans').update({
        task_name: task,
        category,
        planned_start: start,
        planned_end: end,
        is_high_priority: $('planPriority').checked
      }).eq('id', item.id);
    }
    closeModal();
    loadPlanner();
  });

  $('deletePlanBtn').addEventListener('click', async () => {
    if (dbReady) {
      // If this plan was created from a To-Do, clear the scheduled_date on
      // that To-Do so the blue "Scheduled" outline disappears with the plan.
      if (item.source_todo_id) {
        try {
          await dbClient.from('todos')
            .update({ scheduled_date: null })
            .eq('id', item.source_todo_id);
        } catch (e) { console.error('Failed to clear scheduled_date', e); }
      }
      await dbClient.from('day_plans').delete().eq('id', item.id);
    }
    closeModal();
    loadPlanner();
    // Refresh the to-do list too so the badge state updates immediately
    // if the user is currently on the To-Dos page or visits it next.
    if (item.source_todo_id && typeof loadLocalTodos === 'function') {
      loadLocalTodos();
    }
  });
}

// Planner nav
$('plannerPrev').addEventListener('click', () => {
  state.plannerDate = addDays(state.plannerDate, -1);
  loadPlanner();
});
$('plannerNext').addEventListener('click', () => {
  state.plannerDate = addDays(state.plannerDate, 1);
  loadPlanner();
});
$('plannerToday').addEventListener('click', () => {
  state.plannerDate = new Date();
  loadPlanner();
});

// Extended hours toggle — saves preference and reloads planner
const extToggle = $('extendedHoursToggle');
if (extToggle) {
  // Restore saved preference (defaults to off)
  try {
    state.extendedHours = localStorage.getItem('extendedHours') === 'true';
    extToggle.checked = state.extendedHours;
  } catch (e) { /* ignore */ }
  extToggle.addEventListener('change', () => {
    state.extendedHours = extToggle.checked;
    try { localStorage.setItem('extendedHours', state.extendedHours); } catch (e) {}
    loadPlanner();
  });
}

document.querySelectorAll('.view-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.plannerView = tab.dataset.view;
    loadPlanner();
  });
});

// Zoom slider on the planner
$('plannerZoom').addEventListener('input', (e) => {
  state.plannerZoom = parseFloat(e.target.value);
  $('zoomLabel').textContent = state.plannerZoom + '×';
  // Reload the planner to re-render tasks at the new zoom
  loadPlanner();
});

// ═══════════════════════════════════════════════════════════
//  CALENDAR EVENT CATEGORY PICKER
// ═══════════════════════════════════════════════════════════
function openCalendarEventCategoryPicker(item) {
  const catOptions = '<option value="">— None —</option>' +
    state.categories.map(c => `<option value="${escapeHtml(c.name)}" ${c.name === item.category ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');

  const detailLine = [
    item.organiser ? 'Organiser: ' + item.organiser : null,
    item.location  ? 'Location: '  + item.location  : null,
    item.planned_start + '–' + item.planned_end
  ].filter(Boolean).join(' · ');

  openModal(`
    <div class="modal-title">📅 ${escapeHtml(item.task_name)}</div>
    <div style="font-size:12px;color:var(--text-dim);margin-bottom:14px;">${escapeHtml(detailLine)}</div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Category for this event</div>
        <select class="field-input" id="calEventCategory" style="width:100%;">${catOptions}</select>
      </div>
      <div style="font-size:11px;color:var(--text-dim);line-height:1.5;">
        Calendar events are read-only — to change the time, edit it in Outlook.
      </div>
    </div>
    <div class="modal-footer">
      <button class="modal-btn" onclick="closeModal()">Cancel</button>
      <button class="modal-btn primary" id="calEventSaveBtn">Save</button>
    </div>
  `);

  $('calEventSaveBtn').addEventListener('click', async () => {
    const newCategory = $('calEventCategory').value || null;
    if (!dbReady) { closeModal(); return; }
    try {
      // Upsert into calendar_events. The unique constraint on
      // (user_id, ms_event_id) means we either insert or update the row.
      const row = withUid({
        ms_event_id: item.ms_event_id,
        subject:     item.task_name,
        organiser:   item.organiser  || null,
        location:    item.location   || null,
        starts_at:   new Date(item.date + 'T' + item.planned_start + ':00').toISOString(),
        ends_at:     new Date(item.date + 'T' + item.planned_end   + ':00').toISOString(),
        is_all_day:  !!item.is_all_day,
        date:        item.date,
        category:    newCategory,
        last_synced_at: new Date().toISOString()
      });
      const { error } = await dbClient.from('calendar_events')
        .upsert(row, { onConflict: 'user_id,ms_event_id' });
      if (error) throw error;
    } catch (e) {
      console.error('Save calendar category failed:', e);
    }
    closeModal();
    loadPlanner();
  });
}

// ═══════════════════════════════════════════════════════════
//  ANALYSIS PAGE
// ═══════════════════════════════════════════════════════════
async function loadInsights() {
  const [from, to] = getRangeDates();
  $('insightsSubtitle').textContent = rangeLabel();

  let entries = [];
  let goals = [];
  if (dbReady) {
    try {
      const [entriesRes, goalsRes] = await Promise.all([
        dbClient.from('time_entries')
          .select('*')
          .gte('date', dateToString(from))
          .lte('date', dateToString(to))
          .eq('entry_type', 'task')
          .order('started_at', { ascending: true }),
        dbClient.from('goals').select('*')
      ]);
      entries = entriesRes.data || [];
      goals = goalsRes.data || [];
    } catch (e) {
      console.error('Load insights error:', e);
    }
  }

  renderInsightCharts(entries, from, to);
  renderGoals(goals, entries);
}

function getRangeDates() {
  const now = new Date();
  let from, to;
  switch (state.analysisRange) {
    case 'day':
      from = new Date(now); to = new Date(now);
      break;
    case 'week':
      from = addDays(now, -6); to = new Date(now);
      break;
    case 'month':
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      to = new Date(now);
      break;
    case 'year':
      from = new Date(now.getFullYear(), 0, 1);
      to = new Date(now);
      break;
    case 'custom':
      from = state.customFrom ? stringToDate(state.customFrom) : addDays(now, -6);
      to   = state.customTo   ? stringToDate(state.customTo)   : new Date(now);
      break;
  }
  return [from, to];
}

function rangeLabel() {
  const [from, to] = getRangeDates();
  const nDays = Math.round((to - from) / 86400000) + 1;
  return `${dateToString(from)} → ${dateToString(to)} · ${nDays} day${nDays !== 1 ? 's' : ''}`;
}

function renderInsightCharts(entries, from, to) {
  // ── Category bars ──
  const byCat = {};
  entries.forEach(e => {
    const c = e.category || 'Uncategorised';
    byCat[c] = (byCat[c] || 0) + e.duration_secs;
  });
  const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const maxVal = sorted[0] ? sorted[0][1] : 1;

  if (sorted.length === 0) {
    $('chartCategoryBars').innerHTML = '<div class="empty-state"><div>No data in this range.</div></div>';
  } else {
    $('chartCategoryBars').innerHTML = sorted.map(([cat, secs]) => {
      const cc = categoryColour(cat);
      return `
        <div class="cat-bar-row">
          <div>${escapeHtml(cat)}</div>
          <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${(secs/maxVal)*100}%;background:${cc};"></div></div>
          <div class="cat-bar-value">${formatHoursMins(secs)}</div>
        </div>
      `;
    }).join('');
  }

  // ── Daily hours bar chart ──
  const byDate = {};
  entries.forEach(e => {
    byDate[e.date] = (byDate[e.date] || 0) + e.duration_secs;
  });

  const dates = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    dates.push(dateToString(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  let chartData;
  if (dates.length > 31) {
    const byWeek = {};
    dates.forEach(d => {
      const dt = stringToDate(d);
      const weekStart = addDays(dt, -dt.getDay());
      const wk = dateToString(weekStart);
      byWeek[wk] = (byWeek[wk] || 0) + (byDate[d] || 0);
    });
    chartData = Object.entries(byWeek).map(([k, v]) => ({
      label: 'W ' + k.substring(5),
      secs: v
    }));
  } else {
    chartData = dates.map(d => ({
      label: stringToDate(d).toLocaleDateString('en-GB', { weekday: 'short' }).substring(0, 3) +
             ' ' + d.substring(8),
      secs: byDate[d] || 0
    }));
  }

  const chartMax = Math.max(1, ...chartData.map(x => x.secs));

  $('chartDailyHours').innerHTML = chartData.length === 0
    ? '<div class="empty-state"><div>No data in this range.</div></div>'
    : chartData.map(d => {
      const heightPct = (d.secs / chartMax) * 100;
      return `
        <div class="bar-column">
          <div class="bar-fill" style="height:${heightPct}%;">
            ${d.secs > 0 ? `<div class="bar-value">${formatHoursMins(d.secs)}</div>` : ''}
          </div>
          <div class="bar-label">${d.label}</div>
        </div>
      `;
    }).join('');

  // ── Heatmap (time of day × day of week) ──
  renderHeatmap(entries);

  // ── High Payoff per day (replaces the old Week-on-Week chart) ──
  renderHighPayoff(entries, from, to);

  // ── Summary ──
  const totalSecs = entries.reduce((s, e) => s + e.duration_secs, 0);
  $('summaryHours').textContent = formatHoursMins(totalSecs) || '0m';
  $('summaryTasks').textContent = entries.length;
  $('summaryCats').textContent = new Set(entries.map(e => e.category).filter(Boolean)).size;
  $('summaryAvg').textContent = entries.length > 0
    ? formatHoursMins(Math.round(totalSecs / entries.length))
    : '0m';
}

function renderHeatmap(entries) {
  // Build a 7 (days) × 12 (hour-ranges 7am-7pm) grid
  const HOURS = Array.from({ length: 12 }, (_, i) => i + 7); // 7am to 6pm
  const DOW_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // grid[dow][hour] = total seconds
  const grid = Array.from({ length: 7 }, () => Array(12).fill(0));

  entries.forEach(e => {
    const start = new Date(e.started_at);
    const end = new Date(e.ended_at);
    // Mon=0 ... Sun=6
    const dow = (start.getDay() + 6) % 7;
    const startHour = start.getHours();
    const endHour = end.getHours();
    // Distribute duration across hours covered
    const totalMins = e.duration_secs / 60;
    const hoursSpanned = Math.max(1, endHour - startHour + 1);
    const perHour = totalMins / hoursSpanned;
    for (let h = startHour; h <= endHour; h++) {
      const idx = HOURS.indexOf(h);
      if (idx !== -1) grid[dow][idx] += perHour * 60; // store as secs
    }
  });

  const maxCell = Math.max(1, ...grid.flat());

  if (entries.length === 0) {
    $('chartHeatmap').innerHTML = '<div class="empty-state"><div>No data in this range.</div></div>';
    return;
  }

  let html = '<div class="heatmap">';
  html += '<div></div>';
  HOURS.forEach(h => html += `<div class="heatmap-hour">${pad(h)}</div>`);

  for (let d = 0; d < 7; d++) {
    html += `<div class="heatmap-label">${DOW_NAMES[d]}</div>`;
    for (let h = 0; h < 12; h++) {
      const v = grid[d][h];
      let level = 0;
      if (v > 0) {
        const pct = v / maxCell;
        if (pct > 0.75) level = 4;
        else if (pct > 0.5) level = 3;
        else if (pct > 0.25) level = 2;
        else level = 1;
      }
      const tooltip = v > 0
        ? `${DOW_NAMES[d]} ${pad(HOURS[h])}:00 · ${formatHoursMins(Math.round(v))}`
        : '';
      html += `<div class="heatmap-cell" data-level="${level}" data-tooltip="${tooltip}"></div>`;
    }
  }

  html += '</div>';
  $('chartHeatmap').innerHTML = html;
}

// High Payoff per day — bar chart filtered to categories with is_high_payoff,
// plus a total/avg headline. Lives in the slot the old Week-on-Week chart was in.
function renderHighPayoff(entries, from, to) {
  const container = $('chartHighPayoff');
  const totalEl   = $('highPayoffTotal');
  if (!container) return;

  const highPayoffCats = new Set(
    (state.categories || []).filter(c => c.is_high_payoff).map(c => c.name)
  );

  if (highPayoffCats.size === 0) {
    container.innerHTML = '<div class="empty-state"><div>Tick "💎 High payoff" on a category in <strong>Settings → Categories</strong> to start tracking it here.</div></div>';
    if (totalEl) totalEl.textContent = '—';
    return;
  }

  // Sum high-payoff seconds per day
  const byDate = {};
  entries.forEach(e => {
    if (highPayoffCats.has(e.category)) {
      byDate[e.date] = (byDate[e.date] || 0) + e.duration_secs;
    }
  });

  // Walk the range so empty days still get a column
  const dates = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    dates.push(dateToString(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  // Same week-rollup rule as Daily Hours for ranges > 31 days
  let chartData;
  if (dates.length > 31) {
    const byWeek = {};
    dates.forEach(d => {
      const dt = stringToDate(d);
      const weekStart = addDays(dt, -dt.getDay());
      const wk = dateToString(weekStart);
      byWeek[wk] = (byWeek[wk] || 0) + (byDate[d] || 0);
    });
    chartData = Object.entries(byWeek).map(([k, v]) => ({ label: 'W ' + k.substring(5), secs: v }));
  } else {
    chartData = dates.map(d => ({
      label: stringToDate(d).toLocaleDateString('en-GB', { weekday: 'short' }).substring(0, 3) +
             ' ' + d.substring(8),
      secs: byDate[d] || 0
    }));
  }

  // Headline numbers
  const totalSecs = chartData.reduce((s, x) => s + x.secs, 0);
  const daysWithAny = chartData.filter(x => x.secs > 0).length;
  const avgSecs = daysWithAny > 0 ? Math.round(totalSecs / daysWithAny) : 0;
  if (totalEl) {
    totalEl.textContent = totalSecs > 0
      ? `${formatHoursMins(totalSecs)} total · ${formatHoursMins(avgSecs)} / active day`
      : '0m total';
  }

  if (totalSecs === 0) {
    container.innerHTML = '<div class="empty-state"><div>No high-payoff time logged in this range yet.</div></div>';
    return;
  }

  const chartMax = Math.max(1, ...chartData.map(x => x.secs));
  container.innerHTML = chartData.map(d => {
    const heightPct = (d.secs / chartMax) * 100;
    return `
      <div class="bar-column">
        <div class="bar-fill" style="height:${heightPct}%;background:#10b981;">
          ${d.secs > 0 ? `<div class="bar-value">${formatHoursMins(d.secs)}</div>` : ''}
        </div>
        <div class="bar-label">${d.label}</div>
      </div>
    `;
  }).join('');
}

function renderWeekTrend(entries) {
  // Group entries into ISO weeks
  const byWeek = {};
  entries.forEach(e => {
    const dt = stringToDate(e.date);
    const weekStart = addDays(dt, -((dt.getDay() + 6) % 7));
    const wk = dateToString(weekStart);
    byWeek[wk] = (byWeek[wk] || 0) + e.duration_secs;
  });

  const weeks = Object.entries(byWeek).sort((a, b) => a[0].localeCompare(b[0])).slice(-8);

  if (weeks.length === 0) {
    $('chartWeekTrend').innerHTML = '<div class="empty-state"><div>No data in this range.</div></div>';
    return;
  }

  const maxSecs = Math.max(1, ...weeks.map(w => w[1]));

  $('chartWeekTrend').innerHTML = weeks.map(([weekStart, secs]) => {
    const heightPct = (secs / maxSecs) * 100;
    const label = 'W/C ' + weekStart.substring(5);
    return `
      <div class="bar-column">
        <div class="bar-fill" style="height:${heightPct}%;">
          ${secs > 0 ? `<div class="bar-value">${formatHoursMins(secs)}</div>` : ''}
        </div>
        <div class="bar-label">${label}</div>
      </div>
    `;
  }).join('');
}

function renderGoals(goals, entries) {
  const container = $('goalsContent');
  if (goals.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:20px;"><div>No goals set. Click "Add Goal" to create one.</div></div>';
    return;
  }

  container.innerHTML = goals.map(g => renderGoalRow(g, entries)).join('');

  container.querySelectorAll('[data-action="delete-goal"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteGoal(btn.dataset.id);
    });
  });

  container.querySelectorAll('[data-action="edit-goal"]').forEach(row => {
    row.addEventListener('click', () => {
      const goalId = row.dataset.id;
      const goal = goals.find(g => g.id === goalId);
      if (goal) openEditGoalModal(goal);
    });
  });
}

function renderGoalRow(goal, entries) {
  // Compute progress based on frequency
  const now = new Date();
  let periodStart;
  if (goal.frequency === 'daily') {
    periodStart = new Date(now);
    periodStart.setHours(0, 0, 0, 0);
  } else {
    // Weekly — Monday this week
    periodStart = addDays(now, -((now.getDay() + 6) % 7));
    periodStart.setHours(0, 0, 0, 0);
  }

  const periodEntries = entries.filter(e => {
    const d = new Date(e.started_at);
    return e.category === goal.category && d >= periodStart && d <= now;
  });
  const actualMins = Math.round(periodEntries.reduce((s, e) => s + e.duration_secs, 0) / 60);
  const targetMins = goal.target_mins;

  const pct = Math.min(100, (actualMins / targetMins) * 100);

  let barClass = 'ok';
  let barWidth = pct;

  if (goal.limit_type === 'max') {
    // Over limit = bad
    if (actualMins > targetMins) { barClass = 'bad'; barWidth = 100; }
    else if (pct > 80) barClass = 'warn';
  } else {
    // Under limit = bad
    if (pct < 50) barClass = 'bad';
    else if (pct < 100) barClass = 'warn';
    else barClass = 'ok';
  }

  const freqLabel = goal.frequency === 'daily' ? 'Daily' : 'Weekly';
  const limitLabel = goal.limit_type === 'max' ? 'Max' : 'Min';

  // Detect first-time goal completion → sparkle celebration
  // Track per-day to avoid celebrating again the same day after a refresh.
  try {
    const todayKey = 'goalCelebrated:' + goal.id + ':' + new Date().toISOString().slice(0,10);
    const isComplete = (goal.limit_type === 'min' && actualMins >= targetMins) ||
                       (goal.limit_type === 'max' && actualMins >= targetMins);
    if (isComplete && goal.limit_type === 'min' && !sessionStorage.getItem(todayKey)) {
      sessionStorage.setItem(todayKey, '1');
      setTimeout(() => {
        const row = document.querySelector(`.goal-row[data-id="${goal.id}"]`);
        if (row && window.dtFun) {
          window.dtFun.sparkle(row, { count: 7 });
          window.dtFun.toast(`🎯 Goal hit: ${goal.category}!`, { emoji: '✨', duration: 3500 });
        }
      }, 200);
    }
  } catch (e) {}

  return `
    <div class="goal-row" data-action="edit-goal" data-id="${goal.id}" title="Click to edit" style="cursor:pointer;">
      <div class="goal-label">
        <div class="goal-cat">${escapeHtml(goal.category)}</div>
        <div class="goal-freq">${freqLabel} · ${limitLabel}</div>
      </div>
      <div class="goal-progress-track">
        <div class="goal-progress-fill ${barClass}" style="width:${barWidth}%;"></div>
      </div>
      <div class="goal-values"><span class="current">${formatMinsShort(actualMins)}</span> / ${formatMinsShort(targetMins)}</div>
      <button class="mini-btn danger" data-action="delete-goal" data-id="${goal.id}" title="Delete goal">✕</button>
    </div>
  `;
}

function formatMinsShort(mins) {
  if (mins < 60) return mins + 'm';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? h + 'h' : h + 'h ' + m + 'm';
}

// Range tab switching
document.querySelectorAll('.range-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.range-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.analysisRange = tab.dataset.range;

    const showCustom = tab.dataset.range === 'custom';
    $('customRange').classList.toggle('visible', showCustom);

    if (!showCustom) loadInsights();
    else {
      // Set default dates if not set
      if (!state.customFrom) state.customFrom = dateToString(addDays(new Date(), -6));
      if (!state.customTo)   state.customTo = dateToString(new Date());
      $('customFrom').value = state.customFrom;
      $('customTo').value   = state.customTo;
    }
  });
});

$('customApply').addEventListener('click', () => {
  state.customFrom = $('customFrom').value;
  state.customTo   = $('customTo').value;
  loadInsights();
});

// ═══════════════════════════════════════════════════════════
//  SETTINGS PAGE
// ═══════════════════════════════════════════════════════════
function loadSettings() {
  renderThemePickers();
  renderCategoryList();

  // Show current user's email
  if ($('profileEmail') && currentUser) {
    $('profileEmail').textContent = currentUser.email || '—';
  }

  // Logout button
  const logoutBtn = $('logoutBtn');
  if (logoutBtn && !logoutBtn.dataset.wired) {
    logoutBtn.addEventListener('click', () => {
      openModal(`
        <div class="modal-title">Sign out?</div>
        <div style="color:var(--text-dim);font-size:13px;">You'll need to sign in again next time you open DayTimer.</div>
        <div class="modal-footer">
          <button class="modal-btn" onclick="closeModal()">Cancel</button>
          <button class="modal-btn danger" id="confirmLogoutBtn">Sign out</button>
        </div>
      `);
      $('confirmLogoutBtn').addEventListener('click', async () => {
        if (dbReady) {
          try { await dbClient.auth.signOut(); } catch (e) {}
        }
        closeModal();
        ipcRenderer.send('logout');
      });
    });
    logoutBtn.dataset.wired = 'true';
  }

  // Reset widget position button
  const resetBtn = $('resetWidgetBtn');
  if (resetBtn && !resetBtn.dataset.wired) {
    resetBtn.addEventListener('click', () => {
      ipcRenderer.send('reset-widget-position');
      resetBtn.textContent = 'Reset ✓';
      setTimeout(() => { resetBtn.textContent = 'Reset position to main screen'; }, 1500);
    });
    resetBtn.dataset.wired = 'true';
  }

  // Version & updates
  loadAppVersion();
  const updBtn = $('checkUpdateBtn');
  if (updBtn && !updBtn.dataset.wired) {
    updBtn.addEventListener('click', checkForUpdates);
    updBtn.dataset.wired = 'true';
  }

  // Replay tour button
  const replayBtn = $('replayTourBtn');
  if (replayBtn && !replayBtn.dataset.wired) {
    replayBtn.addEventListener('click', () => {
      try { localStorage.removeItem('daytimer_tour_completed'); } catch (e) {}
      startOnboardingTour();
    });
    replayBtn.dataset.wired = 'true';
  }

  // ── Admin-only: Beta updates toggle ────────────────────────
  const ADMIN_EMAIL = 'flynn@howleruk.com';
  const betaRow = $('betaUpdatesRow');
  const betaToggle = $('betaUpdatesToggle');
  if (betaRow && betaToggle && currentUser && currentUser.email === ADMIN_EMAIL) {
    betaRow.style.display = '';
    if (!betaToggle.dataset.wired) {
      (async () => {
        try {
          const current = await ipcRenderer.invoke('get-allow-prerelease');
          betaToggle.checked = !!current;
        } catch (e) {}
      })();
      betaToggle.addEventListener('change', e => {
        ipcRenderer.send('set-allow-prerelease', e.target.checked);
      });
      betaToggle.dataset.wired = 'true';
    }
  }

  // ── Microsoft Calendar integration ─────────────────────────
  setupMsIntegration();

  // ── Auto-launch on Windows startup ─────────────────────────
  setupAutolaunch();

  // ── Troop Mode visibility toggle ───────────────────────────
  const troopT = $('troopVisibleToggle');
  if (troopT && !troopT.dataset.wired) {
    let hidden = false;
    try { hidden = localStorage.getItem('troopHidden') === '1'; } catch (e) {}
    troopT.checked = !hidden;
    troopT.addEventListener('change', () => {
      try {
        if (troopT.checked) localStorage.removeItem('troopHidden');
        else localStorage.setItem('troopHidden', '1');
      } catch (e) {}
      if (window.dtTroop) updateTroopBar(window.dtTroop.getRoster());
    });
    troopT.dataset.wired = 'true';
  }

  // ── Idle check-in interval ─────────────────────────────────
  const idleSel = $('idleCheckInterval');
  if (idleSel && !idleSel.dataset.wired) {
    let saved = '60';
    try { saved = localStorage.getItem('idleCheckInterval') || '60'; } catch (e) {}
    idleSel.value = saved;
    idleSel.addEventListener('change', () => {
      try { localStorage.setItem('idleCheckInterval', idleSel.value); } catch (e) {}
      ipcRenderer.send('idle-interval-changed', parseInt(idleSel.value, 10) || 0);
    });
    idleSel.dataset.wired = 'true';
  }

  // ── Widget Bar (quick-action buttons) ──────────────────────
  loadQuickActionsSettings();

  // ── Feature Requests ───────────────────────────────────────
  loadFeatureRequests();
  loadFeatureRequestsAdmin();

  // ── Teams (admin only) ─────────────────────────────────────
  loadTeamsAdmin();

  // ── Streak badge toggle ────────────────────────────────────
  const streakT = $('showStreakToggle');
  if (streakT && !streakT.dataset.wired) {
    ipcRenderer.invoke('get-widget-prefs').then(prefs => {
      streakT.checked = prefs.showStreak !== false;
    }).catch(() => {});
    streakT.addEventListener('change', () => {
      ipcRenderer.send('set-widget-pref', { key: 'showStreak', value: streakT.checked });
    });
    streakT.dataset.wired = 'true';
  }

  // ── Neon outline ───────────────────────────────────────────
  const neonToggle = $('neonOutlineToggle');
  const neonOptions = $('neonOutlineOptions');
  const neonPicker  = $('neonColorPicker');
  const neonFixed   = $('neonColorFixed');
  const neonSync    = $('neonColorSync');
  if (neonToggle && !neonToggle.dataset.wired) {
    ipcRenderer.invoke('get-widget-prefs').then(prefs => {
      const n = prefs.neonOutline || {};
      neonToggle.checked = !!n.enabled;
      if (neonOptions) neonOptions.style.display = n.enabled ? 'flex' : 'none';
      if (neonPicker)  neonPicker.value = n.color || '#FF7D00';
      if (n.syncToCategory) { if (neonSync) neonSync.checked = true; }
      else                  { if (neonFixed) neonFixed.checked = true; }
    }).catch(() => {});

    const saveNeon = () => {
      const pref = {
        enabled:         neonToggle.checked,
        color:           neonPicker  ? neonPicker.value  : '#FF7D00',
        syncToCategory:  neonSync    ? neonSync.checked  : false
      };
      if (neonOptions) neonOptions.style.display = neonToggle.checked ? 'flex' : 'none';
      ipcRenderer.send('set-widget-pref', { key: 'neonOutline', value: pref });
    };
    neonToggle.addEventListener('change', saveNeon);
    if (neonPicker)  neonPicker.addEventListener('input', saveNeon);
    if (neonFixed)   neonFixed.addEventListener('change', saveNeon);
    if (neonSync)    neonSync.addEventListener('change', saveNeon);
    neonToggle.dataset.wired = 'true';
  }
}

// ── Widget Bar settings ──────────────────────────────────────
async function loadQuickActionsSettings() {
  const list    = $('quickActionsList');
  const addBtn  = $('addQuickActionBtn');
  if (!list) return;

  let actions = [];
  try { actions = await ipcRenderer.invoke('get-quick-actions'); } catch (e) {}

  // Build the available categories list for the dropdowns
  let catNames = ['(no category)'];
  try {
    const { data } = await dbClient.from('categories').select('name').order('sort_order', { ascending: true });
    if (data && data.length) catNames = ['(no category)', ...data.map(c => c.name)];
  } catch (e) {}

  function renderActionList() {
    list.innerHTML = '';
    actions.forEach((action, idx) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;';
      row.innerHTML = `
        <input type="text" value="${escapeAttr(action.emoji)}" maxlength="2"
          style="width:36px;text-align:center;font-size:18px;padding:4px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);"
          data-field="emoji" data-idx="${idx}">
        <input type="text" value="${escapeAttr(action.name)}" placeholder="Button name (tooltip)"
          style="flex:1;padding:5px 8px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;font-size:13px;color:var(--text);"
          data-field="name" data-idx="${idx}">
        <select style="padding:5px 8px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;font-size:12px;color:var(--text);" data-field="category" data-idx="${idx}">
          ${catNames.map(c => `<option value="${c === '(no category)' ? '' : c}" ${(action.category || '') === (c === '(no category)' ? '' : c) ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
        <button data-del="${idx}" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:16px;padding:2px 4px;">✕</button>
      `;
      list.appendChild(row);
    });

    list.querySelectorAll('input, select').forEach(el => {
      el.addEventListener('change', () => {
        const idx   = parseInt(el.dataset.idx);
        const field = el.dataset.field;
        actions[idx][field] = el.value;
        ipcRenderer.send('set-quick-actions', actions);
      });
      el.addEventListener('input', () => {
        const idx   = parseInt(el.dataset.idx);
        const field = el.dataset.field;
        actions[idx][field] = el.value;
        ipcRenderer.send('set-quick-actions', actions);
      });
    });
    list.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        actions.splice(parseInt(btn.dataset.del), 1);
        ipcRenderer.send('set-quick-actions', actions);
        renderActionList();
      });
    });
  }

  function escapeAttr(s) { return String(s || '').replace(/"/g, '&quot;'); }

  if (addBtn && !addBtn.dataset.wired) {
    addBtn.addEventListener('click', () => {
      if (actions.length >= 4) {
        if (window.dtFun) window.dtFun.toast('Maximum 4 quick-action buttons', { emoji: '⚠️', duration: 3000 });
        return;
      }
      const id = 'qa_' + Date.now();
      actions.push({ id, emoji: '⭐', name: 'New button', category: null, entryType: 'quick_action' });
      ipcRenderer.send('set-quick-actions', actions);
      renderActionList();
    });
    addBtn.dataset.wired = 'true';
  }

  renderActionList();
}

// ── Feature Requests ─────────────────────────────────────────
const FR_ADMIN_EMAIL = 'flynn@howleruk.com';
const FR_STATUS_STYLE = {
  new:       { label: 'New',       bg: 'var(--accent)', fg: '#fff' },
  planned:   { label: 'Planned',   bg: '#3b82f6',       fg: '#fff' },
  complete:  { label: 'Complete',  bg: '#22c55e',       fg: '#fff' },
  cancelled: { label: 'Cancelled', bg: 'var(--surface2)', fg: 'var(--text-dim)' }
};

function frStatusBadge(status, onToggle) {
  const s = FR_STATUS_STYLE[status] || FR_STATUS_STYLE.new;
  const span = document.createElement('span');
  span.textContent = s.label;
  span.style.cssText = `font-size:10px;font-weight:600;border-radius:10px;padding:2px 8px;background:${s.bg};color:${s.fg};white-space:nowrap;`;
  // Admin-only quick toggle: click the chip to flip between New ↔ Planned.
  // Complete / Cancelled chips aren't toggleable here — use the action buttons.
  if (onToggle && (status === 'new' || status === 'planned')) {
    span.style.cursor = 'pointer';
    span.title = status === 'new'
      ? 'Click to mark as Planned'
      : 'Click to revert to New';
    span.addEventListener('click', () => onToggle(status === 'new' ? 'planned' : 'new'));
  }
  return span;
}

// User-facing: submit a request + see your own submissions
async function loadFeatureRequests() {
  const input  = $('featureRequestInput');
  const btn    = $('submitFeatureRequestBtn');
  const myList = $('myFeatureRequests');
  if (!input || !btn) return;

  async function renderMine() {
    if (!myList || !dbReady) return;
    try {
      const { data } = await dbClient.from('feature_requests')
        .select('*')
        .eq('user_id', currentUserId)
        .order('created_at', { ascending: false });
      myList.innerHTML = '';
      if (!data || !data.length) return;
      const heading = document.createElement('div');
      heading.textContent = 'Your requests';
      heading.style.cssText = 'font-size:11px;font-weight:600;color:var(--text-dim);margin-bottom:2px;';
      myList.appendChild(heading);
      data.forEach(r => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:flex-start;gap:8px;padding:8px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;';
        const text = document.createElement('div');
        text.textContent = r.request_text;
        text.style.cssText = 'flex:1;font-size:12px;color:var(--text);line-height:1.4;white-space:pre-wrap;';
        row.appendChild(text);
        row.appendChild(frStatusBadge(r.status));
        myList.appendChild(row);
      });
    } catch (e) { console.error('renderMine failed', e); }
  }

  if (!btn.dataset.wired) {
    btn.addEventListener('click', async () => {
      const text = input.value.trim();
      if (!text) return;
      btn.disabled = true;
      try {
        const { error } = await dbClient.from('feature_requests').insert([withUid({
          user_email:   (currentUser && currentUser.email) || null,
          request_text: text,
          status:       'new'
        })]);
        if (error) throw error;
        input.value = '';
        if (window.dtFun) window.dtFun.toast('Request registered — thanks!', { emoji: '✅', duration: 3000 });
        renderMine();
      } catch (e) {
        console.error('Feature request submit failed', e);
        if (window.dtFun) window.dtFun.toast('Could not submit request', { emoji: '⚠️', duration: 3000 });
      }
      btn.disabled = false;
    });
    btn.dataset.wired = 'true';
  }

  renderMine();
}

// Admin-only: review every request, change status, delete
async function loadFeatureRequestsAdmin() {
  const section = $('featureRequestsAdminSection');
  const list    = $('featureRequestsAdminList');
  const countEl = $('frAdminCount');
  if (!section || !list) return;

  if (!currentUser || currentUser.email !== FR_ADMIN_EMAIL) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';

  async function setStatus(id, status) {
    try {
      const { error } = await dbClient.from('feature_requests')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      render();
    } catch (e) { console.error('setStatus failed', e); }
  }

  async function deleteRequest(id) {
    try {
      const { error } = await dbClient.from('feature_requests').delete().eq('id', id);
      if (error) throw error;
      render();
    } catch (e) { console.error('deleteRequest failed', e); }
  }

  function adminBtn(label, colour, onClick) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:${colour};cursor:pointer;`;
    b.addEventListener('click', onClick);
    return b;
  }

  async function render() {
    if (!dbReady) return;
    try {
      const { data } = await dbClient.from('feature_requests')
        .select('*')
        .order('created_at', { ascending: false });
      list.innerHTML = '';
      const rows = data || [];
      const openCount = rows.filter(r => r.status === 'new' || r.status === 'planned').length;
      if (countEl) countEl.textContent = String(openCount);

      if (!rows.length) {
        const empty = document.createElement('div');
        empty.textContent = 'No feature requests yet.';
        empty.style.cssText = 'font-size:12px;color:var(--text-dim);';
        list.appendChild(empty);
        return;
      }

      rows.forEach(r => {
        const card = document.createElement('div');
        card.style.cssText = 'padding:10px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;display:flex;flex-direction:column;gap:6px;';
        if (r.status === 'cancelled' || r.status === 'complete') card.style.opacity = '0.6';

        const topRow = document.createElement('div');
        topRow.style.cssText = 'display:flex;align-items:flex-start;gap:8px;';
        const text = document.createElement('div');
        text.textContent = r.request_text;
        text.style.cssText = 'flex:1;font-size:13px;color:var(--text);line-height:1.4;white-space:pre-wrap;';
        topRow.appendChild(text);
        topRow.appendChild(frStatusBadge(r.status, (newStatus) => setStatus(r.id, newStatus)));
        card.appendChild(topRow);

        const meta = document.createElement('div');
        const when = r.created_at ? new Date(r.created_at).toLocaleDateString() : '';
        meta.textContent = `${r.user_email || 'unknown'}${when ? ' · ' + when : ''}`;
        meta.style.cssText = 'font-size:10px;color:var(--text-dim);';
        card.appendChild(meta);

        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
        if (r.status !== 'planned')
          actions.appendChild(adminBtn('Plan it', '#3b82f6', () => setStatus(r.id, 'planned')));
        if (r.status !== 'complete')
          actions.appendChild(adminBtn('Mark complete', '#22c55e', () => setStatus(r.id, 'complete')));
        if (r.status !== 'cancelled')
          actions.appendChild(adminBtn('Cancel', 'var(--text-dim)', () => setStatus(r.id, 'cancelled')));
        actions.appendChild(adminBtn('Delete', 'var(--danger)', () => deleteRequest(r.id)));
        card.appendChild(actions);

        list.appendChild(card);
      });
    } catch (e) { console.error('Feature requests admin render failed', e); }
  }

  render();
}

// ── Teams (admin-only build/edit) ─────────────────────────────
// Only Flynn sees this section. Lets him create teams, assign managers
// and members by email, and delete teams. The dashboard built on top
// of this data ships in 5.6.0-beta.2.
const TEAMS_ADMIN_EMAIL = 'flynn@howleruk.com';

async function loadTeamsAdmin() {
  const section = $('teamsAdminSection');
  const list    = $('teamsList');
  const addBtn  = $('addTeamBtn');
  if (!section || !list || !addBtn) return;

  if (!currentUser || currentUser.email !== TEAMS_ADMIN_EMAIL) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';

  if (!addBtn.dataset.wired) {
    addBtn.addEventListener('click', () => openTeamModal(null));
    addBtn.dataset.wired = 'true';
  }

  if (!dbReady) return;
  try {
    // Pull everything in parallel: teams + their managers + their members
    const [teamsRes, mgrsRes, mbrsRes, profsRes] = await Promise.all([
      dbClient.from('teams').select('*').order('name', { ascending: true }),
      dbClient.from('team_managers').select('*'),
      dbClient.from('team_members').select('*'),
      dbClient.from('profiles').select('id,email')
    ]);

    const teams    = teamsRes.data || [];
    const mgrs     = mgrsRes.data || [];
    const mbrs     = mbrsRes.data || [];
    const profsArr = profsRes.data || [];
    const profById = {};
    profsArr.forEach(p => { profById[p.id] = p.email; });

    if (teams.length === 0) {
      list.innerHTML = '<div style="font-size:12px;color:var(--text-dim);padding:8px 0;">No teams yet. Click <strong>+ Add team</strong> to create one.</div>';
      return;
    }

    list.innerHTML = '';
    teams.forEach(team => {
      const teamMgrs = mgrs.filter(m => m.team_id === team.id).map(m => profById[m.user_id]).filter(Boolean);
      const teamMbrs = mbrs.filter(m => m.team_id === team.id).map(m => profById[m.user_id]).filter(Boolean);

      const card = document.createElement('div');
      card.style.cssText = 'padding:12px 14px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;display:flex;flex-direction:column;gap:6px;';

      const headerRow = document.createElement('div');
      headerRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';
      const nameEl = document.createElement('div');
      nameEl.style.cssText = 'font-size:14px;font-weight:600;color:var(--text);';
      nameEl.textContent = team.name;
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:6px;';
      const editBtn = document.createElement('button');
      editBtn.className = 'modal-btn';
      editBtn.style.cssText = 'font-size:11px;padding:4px 10px;';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => openTeamModal({ team, managerEmails: teamMgrs, memberEmails: teamMbrs }));
      const delBtn = document.createElement('button');
      delBtn.className = 'modal-btn';
      delBtn.style.cssText = 'font-size:11px;padding:4px 10px;color:var(--danger);';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => deleteTeam(team));
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      headerRow.appendChild(nameEl);
      headerRow.appendChild(actions);

      const mgrsLine = document.createElement('div');
      mgrsLine.style.cssText = 'font-size:11px;color:var(--text-dim);';
      mgrsLine.innerHTML = `<strong>Managers:</strong> ${teamMgrs.length ? escapeHtml(teamMgrs.join(', ')) : '<em>none assigned</em>'}`;

      const mbrsLine = document.createElement('div');
      mbrsLine.style.cssText = 'font-size:11px;color:var(--text-dim);';
      mbrsLine.innerHTML = `<strong>Members (${teamMbrs.length}):</strong> ${teamMbrs.length ? escapeHtml(teamMbrs.join(', ')) : '<em>none assigned</em>'}`;

      card.appendChild(headerRow);
      card.appendChild(mgrsLine);
      card.appendChild(mbrsLine);
      list.appendChild(card);
    });
  } catch (e) {
    console.error('loadTeamsAdmin failed', e);
    list.innerHTML = '<div style="font-size:12px;color:var(--danger);">⚠ Could not load teams. Have you run supabase-v5.6.0.sql?</div>';
  }
}

// Resolve a comma/semicolon/newline-separated list of emails to user_ids
// via the profiles table. Returns { resolved: [{email, id}], missing: [email] }.
async function resolveEmailsToIds(emailString) {
  const emails = (emailString || '')
    .split(/[,;\n]/)
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  if (emails.length === 0) return { resolved: [], missing: [] };

  const { data, error } = await dbClient.from('profiles').select('id,email').in('email', emails);
  if (error) throw error;
  const found = new Map((data || []).map(p => [p.email.toLowerCase(), p.id]));

  const resolved = [];
  const missing = [];
  emails.forEach(e => {
    if (found.has(e)) resolved.push({ email: e, id: found.get(e) });
    else missing.push(e);
  });
  return { resolved, missing };
}

function openTeamModal(existing) {
  // existing = null for new team, or { team, managerEmails:[], memberEmails:[] }
  const isEdit = !!existing;
  const teamName     = isEdit ? existing.team.name : '';
  const managerEmails = isEdit ? existing.managerEmails.join(', ') : '';
  const memberEmails  = isEdit ? existing.memberEmails.join(', ')  : '';

  openModal(`
    <div class="modal-title">${isEdit ? 'Edit' : 'Add'} team</div>
    <div style="display:flex;flex-direction:column;gap:12px;">
      <div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Team name</div>
        <input type="text" class="field-input" id="teamName" value="${escapeHtml(teamName)}" placeholder="e.g. Sales Team" style="width:100%;" autofocus>
      </div>
      <div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Managers (email addresses, comma-separated)</div>
        <textarea class="field-input" id="teamManagers" placeholder="ben@howleruk.com" rows="2" style="width:100%;resize:vertical;font-size:12px;">${escapeHtml(managerEmails)}</textarea>
      </div>
      <div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Members (email addresses, comma-separated)</div>
        <textarea class="field-input" id="teamMembers" placeholder="randall@howleruk.com, logan@howleruk.com" rows="3" style="width:100%;resize:vertical;font-size:12px;">${escapeHtml(memberEmails)}</textarea>
      </div>
      <div id="teamModalStatus" style="font-size:11px;color:var(--text-dim);min-height:14px;"></div>
    </div>
    <div class="modal-footer">
      <button class="modal-btn" onclick="closeModal()">Cancel</button>
      <button class="modal-btn primary" id="saveTeamBtn">${isEdit ? 'Save' : 'Create'}</button>
    </div>
  `);

  $('saveTeamBtn').addEventListener('click', async () => {
    const status = $('teamModalStatus');
    const name = $('teamName').value.trim();
    if (!name) {
      status.textContent = '⚠ Team name is required';
      status.style.color = 'var(--danger)';
      return;
    }

    try {
      // Resolve emails to user_ids via profiles. Anyone who hasn't logged
      // into DayTimer at least once won't be in profiles yet — flag them.
      const [mgrLookup, mbrLookup] = await Promise.all([
        resolveEmailsToIds($('teamManagers').value),
        resolveEmailsToIds($('teamMembers').value)
      ]);

      const allMissing = [...mgrLookup.missing, ...mbrLookup.missing];
      if (allMissing.length > 0) {
        status.textContent = `⚠ Unknown / not yet signed in: ${allMissing.join(', ')}. They must open DayTimer once before being added.`;
        status.style.color = 'var(--danger)';
        return;
      }

      let teamId;
      if (isEdit) {
        teamId = existing.team.id;
        await dbClient.from('teams').update({ name }).eq('id', teamId);
        // Wipe and replace managers + members — simplest correct approach
        // for edit, since it's a small admin-only operation.
        await dbClient.from('team_managers').delete().eq('team_id', teamId);
        await dbClient.from('team_members').delete().eq('team_id', teamId);
      } else {
        const ins = await dbClient.from('teams').insert([{ name }]).select().single();
        if (ins.error) throw ins.error;
        teamId = ins.data.id;
      }

      if (mgrLookup.resolved.length > 0) {
        const mgrRows = mgrLookup.resolved.map(r => ({ team_id: teamId, user_id: r.id }));
        const r = await dbClient.from('team_managers').insert(mgrRows);
        if (r.error) throw r.error;
      }
      if (mbrLookup.resolved.length > 0) {
        const mbrRows = mbrLookup.resolved.map(r => ({ team_id: teamId, user_id: r.id }));
        const r = await dbClient.from('team_members').insert(mbrRows);
        if (r.error) throw r.error;
      }

      closeModal();
      loadTeamsAdmin();
      if (window.dtFun) window.dtFun.toast(isEdit ? 'Team updated' : 'Team created', { emoji: '✅', duration: 2500 });
    } catch (e) {
      console.error('Save team failed', e);
      status.textContent = '⚠ Could not save team: ' + (e.message || 'unknown error');
      status.style.color = 'var(--danger)';
    }
  });
}

async function deleteTeam(team) {
  if (!confirm(`Delete "${team.name}"? Managers and members will lose access (their personal time entries are unaffected).`)) return;
  try {
    await dbClient.from('teams').delete().eq('id', team.id);
    loadTeamsAdmin();
    if (window.dtFun) window.dtFun.toast('Team deleted', { emoji: '🗑️', duration: 2500 });
  } catch (e) {
    console.error('Delete team failed', e);
    if (window.dtFun) window.dtFun.toast('Could not delete team', { emoji: '⚠️', duration: 3000 });
  }
}

async function setupAutolaunch() {
  const t  = $('autolaunchToggle');
  const ht = $('autolaunchHiddenToggle');
  const hl = $('autolaunchHiddenLabel');
  if (!t || !ht || !hl) return;

  // Load current state from main process
  try {
    const cur = await ipcRenderer.invoke('get-autolaunch');
    t.checked  = !!cur.enabled;
    ht.checked = !!cur.startHidden;
    hl.style.opacity = cur.enabled ? '1' : '0.5';
  } catch (e) {}

  const apply = async () => {
    hl.style.opacity = t.checked ? '1' : '0.5';
    try {
      await ipcRenderer.invoke('set-autolaunch', {
        enabled: t.checked,
        startHidden: ht.checked
      });
    } catch (e) {
      console.error('Set autolaunch failed', e);
    }
  };

  if (!t.dataset.wired) {
    t.addEventListener('change', apply);
    t.dataset.wired = 'true';
  }
  if (!ht.dataset.wired) {
    ht.addEventListener('change', apply);
    ht.dataset.wired = 'true';
  }
}

async function setupMsIntegration() {
  const connectBtn    = $('msConnectBtn');
  const disconnectBtn = $('msDisconnectBtn');
  const status        = $('msStatus');
  const lookahead     = $('msLookahead');
  if (!connectBtn || !lookahead) return;

  // Restore saved lookahead (default 7 days)
  try {
    const saved = localStorage.getItem('msLookahead');
    lookahead.value = saved !== null ? saved : '7';
  } catch (e) { lookahead.value = '7'; }

  if (!lookahead.dataset.wired) {
    lookahead.addEventListener('change', () => {
      try { localStorage.setItem('msLookahead', lookahead.value); } catch (e) {}
      // Refresh planner so it picks up the new range
      if (state.currentPage === 'planner' || typeof loadPlanner === 'function') loadPlanner();
    });
    lookahead.dataset.wired = 'true';
  }

  const refreshConnState = async () => {
    const connected = await ipcRenderer.invoke('graph-is-connected');
    status.textContent = connected ? 'Connected' : 'Not connected';
    status.style.color = connected ? 'var(--accent)' : 'var(--text-dim)';
    connectBtn.style.display    = connected ? 'none' : '';
    disconnectBtn.style.display = connected ? '' : 'none';
  };

  await refreshConnState();

  if (!connectBtn.dataset.wired) {
    connectBtn.addEventListener('click', async () => {
      status.textContent = 'Opening Microsoft sign-in…';
      try {
        await ipcRenderer.invoke('graph-connect');
      } catch (e) {
        status.textContent = '⚠ ' + e.message;
      }
    });
    connectBtn.dataset.wired = 'true';
  }
  if (!disconnectBtn.dataset.wired) {
    disconnectBtn.addEventListener('click', async () => {
      await ipcRenderer.invoke('graph-disconnect');
      await refreshConnState();
      // Refresh planner so events disappear
      if (typeof loadPlanner === 'function') loadPlanner();
    });
    disconnectBtn.dataset.wired = 'true';
  }

  // Listen for changes from the main process (e.g. after auth callback)
  if (!window._msListenerWired) {
    ipcRenderer.on('graph-connection-changed', async () => {
      await refreshConnState();
      if (typeof loadPlanner === 'function') loadPlanner();
    });
    ipcRenderer.on('graph-auth-error', (_evt, msg) => {
      if ($('msStatus')) {
        $('msStatus').textContent = '⚠ ' + msg;
        $('msStatus').style.color = 'var(--danger)';
      }
    });
    window._msListenerWired = true;
  }
}

async function loadAppVersion() {
  try {
    const v = await ipcRenderer.invoke('get-app-version');
    if ($('appVersion')) $('appVersion').textContent = 'v' + v;
  } catch (e) {
    if ($('appVersion')) $('appVersion').textContent = 'dev build';
  }
}

async function checkForUpdates() {
  const status = $('updateStatus');
  const btn = $('checkUpdateBtn');
  const progressBar = $('updateProgressBar');
  const progressFill = $('updateProgressFill');
  const manualLink = $('updateManualLink');

  status.textContent = 'Checking…';
  btn.disabled = true;
  progressBar.style.display = 'none';
  manualLink.style.display = 'none';

  try {
    const result = await ipcRenderer.invoke('check-for-updates');
    if (result.dev) {
      status.textContent = 'Updates only available in installed builds.';
    } else if (result.error) {
      status.textContent = '⚠ ' + result.error;
    } else if (result.available) {
      status.textContent = `Update available: v${result.latestVersion} — downloading…`;
      progressBar.style.display = 'block';
      // Show manual link right away — many users are on networks that
      // throttle large downloads, so the fallback should be obvious.
      manualLink.style.display = 'block';
      const link = $('manualDownloadLink');
      // Direct .exe asset URL — colleagues' corporate accounts may not be
      // able to browse github.com freely, but the direct asset URL is
      // just a binary download and goes through.
      const v = result.latestVersion;
      link.href = v
        ? `https://github.com/FlynnAskew/daytimer/releases/download/v${v}/DayTimer-Setup-${v}.exe`
        : `https://github.com/FlynnAskew/daytimer/releases/latest`;
      link.onclick = (e) => {
        e.preventDefault();
        ipcRenderer.send('open-external', link.href);
      };
    } else {
      status.textContent = `You're on the latest version.`;
      setTimeout(() => { if (status.textContent.startsWith("You're")) status.textContent = ''; }, 4000);
    }
  } catch (e) {
    status.textContent = '⚠ Update check failed';
  } finally {
    btn.disabled = false;
  }
}

// Listen for update events from main process
ipcRenderer.on('update-available', (event, info) => {
  if ($('updateStatus')) {
    $('updateStatus').textContent = `Update v${info.version} available — downloading…`;
    if ($('updateProgressBar')) $('updateProgressBar').style.display = 'block';
  }
});

ipcRenderer.on('update-progress', (event, progress) => {
  const fill = $('updateProgressFill');
  const status = $('updateStatus');
  if (fill && progress.percent !== undefined) {
    fill.style.width = Math.round(progress.percent) + '%';
  }
  if (status && progress.percent !== undefined) {
    const mb = progress.transferred ? (progress.transferred / 1024 / 1024).toFixed(1) : '?';
    const total = progress.total ? (progress.total / 1024 / 1024).toFixed(0) : '?';
    status.textContent = `Downloading update… ${Math.round(progress.percent)}% (${mb}/${total} MB)`;
  }
});

ipcRenderer.on('update-downloaded', (event, info) => {
  if ($('updateStatus')) {
    $('updateStatus').textContent = `Update v${info.version} downloaded — restart to install.`;
  }
  if ($('updateProgressBar')) $('updateProgressBar').style.display = 'none';
  if ($('updateManualLink')) $('updateManualLink').style.display = 'none';
});

function renderThemePickers() {
  $('themeGridDark').innerHTML = THEMES.dark.map(t => themeSwatchHtml(t)).join('');
  $('themeGridLight').innerHTML = THEMES.light.map(t => themeSwatchHtml(t)).join('');

  document.querySelectorAll('.theme-swatch').forEach(sw => {
    sw.classList.toggle('active', sw.dataset.theme === state.currentTheme);
    sw.addEventListener('click', () => setTheme(sw.dataset.theme));
  });
}

function themeSwatchHtml(t) {
  return `
    <button class="theme-swatch" data-theme="${t.id}">
      <div class="theme-preview">
        <div class="theme-preview-bg" style="background:${t.bg}"></div>
        <div style="background:${t.surf}"></div>
        <div style="background:${t.acc}"></div>
      </div>
      <div class="theme-name">${t.name}<span class="theme-check">✓</span></div>
    </button>
  `;
}

function renderCategoryList() {
  $('categoryList').innerHTML = state.categories.map(c => `
    <div class="cat-row" data-id="${c.id}">
      <div class="cat-dot" style="background:${c.colour}" data-action="colour" data-id="${c.id}"></div>
      <input type="text" class="cat-name-input" value="${escapeHtml(c.name)}" data-action="rename" data-id="${c.id}">
      <label class="cat-payoff" title="High payoff — this category's time aggregates into the High Payoff chart on Insights" style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-dim);cursor:pointer;white-space:nowrap;">
        <input type="checkbox" data-action="toggle-payoff" data-id="${c.id}" ${c.is_high_payoff ? 'checked' : ''}>
        <span>💎 High payoff</span>
      </label>
      <div class="cat-actions">
        <button class="mini-btn danger" data-action="delete-cat" data-id="${c.id}" title="Delete">✕</button>
      </div>
    </div>
  `).join('');

  // High-payoff toggle
  $('categoryList').querySelectorAll('[data-action="toggle-payoff"]').forEach(cb => {
    cb.addEventListener('change', async () => {
      const id = cb.dataset.id;
      const cat = state.categories.find(c => c.id === id);
      if (!cat) return;
      cat.is_high_payoff = cb.checked;
      if (dbReady) {
        try {
          await dbClient.from('categories')
            .update({ is_high_payoff: cb.checked })
            .eq('id', id);
        } catch (e) {
          console.error('Failed to toggle high payoff', e);
          // Revert UI on failure
          cb.checked = !cb.checked;
          cat.is_high_payoff = cb.checked;
        }
      }
    });
  });

  // Colour picker
  $('categoryList').querySelectorAll('[data-action="colour"]').forEach(dot => {
    dot.addEventListener('click', () => openColourPicker(dot.dataset.id));
  });

  // Rename on blur
  $('categoryList').querySelectorAll('[data-action="rename"]').forEach(input => {
    input.addEventListener('blur', async () => {
      const id = input.dataset.id;
      const newName = input.value.trim();
      if (!newName) return;
      const cat = state.categories.find(c => c.id === id);
      if (cat && cat.name !== newName) {
        if (dbReady && !String(id).startsWith('local-')) {
          await dbClient.from('categories').update({ name: newName }).eq('id', id);
        }
        cat.name = newName;
        ipcRenderer.send('categories-updated');
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
    });
  });

  // Delete
  $('categoryList').querySelectorAll('[data-action="delete-cat"]').forEach(btn => {
    btn.addEventListener('click', () => deleteCategory(btn.dataset.id));
  });
}

function openColourPicker(id) {
  openModal(`
    <div class="modal-title">Pick a colour</div>
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-top:6px;">
      ${CATEGORY_COLOURS.map(c => `
        <button class="cat-dot" style="background:${c};width:36px;height:36px;border-radius:50%;border:2px solid transparent;cursor:pointer;transition:transform 0.12s,border-color 0.12s;" data-colour="${c}"
          onmouseover="this.style.transform='scale(1.15)';this.style.borderColor='var(--text)'"
          onmouseout="this.style.transform='scale(1)';this.style.borderColor='transparent'">
        </button>
      `).join('')}
    </div>
    <div class="modal-footer">
      <button class="modal-btn" onclick="closeModal()">Cancel</button>
    </div>
  `);
  $('modal').querySelectorAll('[data-colour]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newColour = btn.dataset.colour;
      const cat = state.categories.find(c => c.id === id);
      if (cat) {
        cat.colour = newColour;
        if (dbReady && !String(id).startsWith('local-')) {
          await dbClient.from('categories').update({ colour: newColour }).eq('id', id);
        }
      }
      closeModal();
      renderCategoryList();
    });
  });
}

async function deleteCategory(id) {
  const cat = state.categories.find(c => c.id === id);
  if (!cat) return;
  openModal(`
    <div class="modal-title">Delete "${escapeHtml(cat.name)}"?</div>
    <div style="color:var(--text-dim);font-size:13px;">Existing entries using this category will keep their label but you won't be able to select it going forward.</div>
    <div class="modal-footer">
      <button class="modal-btn" onclick="closeModal()">Cancel</button>
      <button class="modal-btn danger" id="confirmCatDeleteBtn">Delete</button>
    </div>
  `);
  $('confirmCatDeleteBtn').addEventListener('click', async () => {
    if (dbReady && !String(id).startsWith('local-')) {
      await dbClient.from('categories').delete().eq('id', id);
    }
    state.categories = state.categories.filter(c => c.id !== id);
    closeModal();
    renderCategoryList();
    ipcRenderer.send('categories-updated');
  });
}

$('addCategoryBtn').addEventListener('click', async () => {
  const newName = 'New Category';
  const newColour = CATEGORY_COLOURS[state.categories.length % CATEGORY_COLOURS.length];
  const sortOrder = state.categories.length + 1;

  if (dbReady) {
    const { data, error } = await dbClient.from('categories').insert([withUid({
      name: newName, colour: newColour, sort_order: sortOrder
    })]).select();
    if (!error && data) {
      state.categories.push(data[0]);
    }
  } else {
    state.categories.push({
      id: 'local-' + Date.now(),
      name: newName, colour: newColour, sort_order: sortOrder
    });
  }
  renderCategoryList();
  ipcRenderer.send('categories-updated');

  // Auto-focus the new category's input
  setTimeout(() => {
    const inputs = $('categoryList').querySelectorAll('.cat-name-input');
    const lastInput = inputs[inputs.length - 1];
    if (lastInput) { lastInput.focus(); lastInput.select(); }
  }, 50);
});

// DevTools
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'I') {
    ipcRenderer.send('toggle-devtools-main');
  }
});

// ═══════════════════════════════════════════════════════════
//  GOALS
// ═══════════════════════════════════════════════════════════
$('addGoalBtn').addEventListener('click', openAddGoalModal);

function openAddGoalModal() {
  const catOptions = state.categories.map(c =>
    `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`
  ).join('');

  openModal(`
    <div class="modal-title">Add a goal</div>
    <div style="display:flex;flex-direction:column;gap:12px;">
      <div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Category</div>
        <select class="field-input" id="goalCategory" style="width:100%;">${catOptions}</select>
      </div>
      <div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Frequency</div>
        <select class="field-input" id="goalFrequency" style="width:100%;">
          <option value="daily">Daily</option>
          <option value="weekly" selected>Weekly</option>
        </select>
      </div>
      <div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Limit type</div>
        <select class="field-input" id="goalLimitType" style="width:100%;">
          <option value="min">Minimum (spend at least)</option>
          <option value="max">Maximum (don't exceed)</option>
        </select>
      </div>
      <div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Target (in minutes)</div>
        <input type="number" class="field-input" id="goalTarget" value="60" min="1" style="width:100%;">
        <div style="font-size:10px;color:var(--text-dim);margin-top:4px;">e.g. 60 = 1 hour, 300 = 5 hours</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="modal-btn" onclick="closeModal()">Cancel</button>
      <button class="modal-btn primary" id="saveGoalBtn">Add Goal</button>
    </div>
  `);

  $('saveGoalBtn').addEventListener('click', async () => {
    const goal = {
      category:    $('goalCategory').value,
      frequency:   $('goalFrequency').value,
      limit_type:  $('goalLimitType').value,
      target_mins: parseInt($('goalTarget').value) || 60
    };
    if (!goal.category) return;

    if (dbReady) {
      await dbClient.from('goals').insert([withUid(goal)]);
    }
    closeModal();
    loadInsights();
  });
}

async function deleteGoal(id) {
  if (dbReady) {
    await dbClient.from('goals').delete().eq('id', id);
  }
  loadInsights();
}

window.deleteGoal = deleteGoal;

function openEditGoalModal(goal) {
  const catOptions = state.categories.map(c =>
    `<option value="${escapeHtml(c.name)}" ${c.name === goal.category ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
  ).join('');

  openModal(`
    <div class="modal-title">Edit goal</div>
    <div style="display:flex;flex-direction:column;gap:12px;">
      <div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Category</div>
        <select class="field-input" id="goalCategory" style="width:100%;">${catOptions}</select>
      </div>
      <div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Frequency</div>
        <select class="field-input" id="goalFrequency" style="width:100%;">
          <option value="daily" ${goal.frequency === 'daily' ? 'selected' : ''}>Daily</option>
          <option value="weekly" ${goal.frequency === 'weekly' ? 'selected' : ''}>Weekly</option>
        </select>
      </div>
      <div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Limit type</div>
        <select class="field-input" id="goalLimitType" style="width:100%;">
          <option value="min" ${goal.limit_type === 'min' ? 'selected' : ''}>Minimum (spend at least)</option>
          <option value="max" ${goal.limit_type === 'max' ? 'selected' : ''}>Maximum (don't exceed)</option>
        </select>
      </div>
      <div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Target (in minutes)</div>
        <input type="number" class="field-input" id="goalTarget" value="${goal.target_mins}" min="1" style="width:100%;">
        <div style="font-size:10px;color:var(--text-dim);margin-top:4px;">e.g. 60 = 1 hour, 300 = 5 hours</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="modal-btn danger" id="deleteGoalBtn">Delete</button>
      <div style="flex:1;"></div>
      <button class="modal-btn" onclick="closeModal()">Cancel</button>
      <button class="modal-btn primary" id="saveGoalBtn">Save</button>
    </div>
  `);

  $('saveGoalBtn').addEventListener('click', async () => {
    const changes = {
      category:    $('goalCategory').value,
      frequency:   $('goalFrequency').value,
      limit_type:  $('goalLimitType').value,
      target_mins: parseInt($('goalTarget').value) || 60
    };
    if (!changes.category) return;

    if (dbReady) {
      await dbClient.from('goals').update(changes).eq('id', goal.id);
    }
    closeModal();
    loadInsights();
  });

  $('deleteGoalBtn').addEventListener('click', async () => {
    if (dbReady) {
      await dbClient.from('goals').delete().eq('id', goal.id);
    }
    closeModal();
    loadInsights();
  });
}

// ═══════════════════════════════════════════════════════════
//  CALENDAR PICKER
// ═══════════════════════════════════════════════════════════
const calendar = {
  viewMonth: new Date(),    // month being viewed
  selected: new Date(),     // selected date
  target: null,             // 'tracker' or 'planner'
  dateSet: new Set(),       // set of YYYY-MM-DD strings with data
  visible: false
};

async function openCalendar(target, anchorButton) {
  calendar.target = target;
  calendar.selected = target === 'tracker' ? new Date(state.trackerDate) : new Date(state.plannerDate);
  calendar.viewMonth = new Date(calendar.selected);

  const popover = $('calendarPopover');
  popover.classList.add('visible');
  calendar.visible = true;

  await loadCalendarData();
  renderCalendar();

  // Position the popover — use offsetWidth AFTER it's visible and measured
  const rect = anchorButton.getBoundingClientRect();
  const popWidth = popover.offsetWidth || 320;
  const viewportWidth = window.innerWidth;

  // Align the right edge of the popover with the right edge of the anchor
  // so it stays inside the window
  let leftPos = rect.right - popWidth;

  // If that would push it off the left, clamp it
  if (leftPos < 10) leftPos = 10;
  // If there's more room centred under the button, prefer that
  if (rect.right + 10 < viewportWidth && rect.left - (popWidth - rect.width) / 2 > 10) {
    leftPos = rect.left - (popWidth - rect.width) / 2;
  }
  // Safety: never let it spill off the right
  if (leftPos + popWidth > viewportWidth - 10) {
    leftPos = viewportWidth - popWidth - 10;
  }

  popover.style.top = (rect.bottom + 6) + 'px';
  popover.style.left = leftPos + 'px';
}

function closeCalendar() {
  $('calendarPopover').classList.remove('visible');
  calendar.visible = false;
}

async function loadCalendarData() {
  if (!dbReady) return;
  const monthStart = new Date(calendar.viewMonth.getFullYear(), calendar.viewMonth.getMonth(), 1);
  const monthEnd   = new Date(calendar.viewMonth.getFullYear(), calendar.viewMonth.getMonth() + 1, 0);
  const fromStr = dateToString(monthStart);
  const toStr   = dateToString(monthEnd);

  try {
    const table = calendar.target === 'tracker' ? 'time_entries' : 'day_plans';
    const { data } = await dbClient.from(table)
      .select('date')
      .gte('date', fromStr)
      .lte('date', toStr);
    calendar.dateSet = new Set((data || []).map(d => d.date));
  } catch (e) {
    console.error('Calendar data error:', e);
  }
}

function renderCalendar() {
  const year = calendar.viewMonth.getFullYear();
  const month = calendar.viewMonth.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const firstDow = (firstOfMonth.getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysPrevMonth = new Date(year, month, 0).getDate();

  const monthName = firstOfMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  $('calMonth').textContent = monthName;

  let html = '';
  // Day-of-week labels
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(d => {
    html += `<div class="calendar-dow">${d}</div>`;
  });

  // Previous month's trailing days
  for (let i = firstDow - 1; i >= 0; i--) {
    const d = daysPrevMonth - i;
    html += `<div class="calendar-day other-month">${d}</div>`;
  }

  // Current month
  const todayStr = dateToString(new Date());
  const selectedStr = dateToString(calendar.selected);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${pad(month + 1)}-${pad(d)}`;
    const classes = ['calendar-day'];
    if (dateStr === todayStr) classes.push('today');
    if (dateStr === selectedStr) classes.push('selected');
    if (calendar.dateSet.has(dateStr)) classes.push('has-data');
    html += `<div class="${classes.join(' ')}" data-date="${dateStr}">${d}</div>`;
  }

  // Next month's leading days to fill grid (to multiple of 7)
  const totalCells = firstDow + daysInMonth;
  const trailingNeeded = (7 - (totalCells % 7)) % 7;
  for (let d = 1; d <= trailingNeeded; d++) {
    html += `<div class="calendar-day other-month">${d}</div>`;
  }

  $('calGrid').innerHTML = html;

  // Legend
  const markedCount = Array.from(calendar.dateSet).filter(d =>
    d.startsWith(`${year}-${pad(month + 1)}`)).length;
  const legendLabel = calendar.target === 'tracker' ? 'tracked' : 'planned';
  $('calLegend').textContent = `${markedCount} day${markedCount !== 1 ? 's' : ''} ${legendLabel} this month`;

  // Wire up day clicks
  $('calGrid').querySelectorAll('[data-date]').forEach(cell => {
    cell.addEventListener('click', () => {
      const picked = stringToDate(cell.dataset.date);
      if (calendar.target === 'tracker') {
        state.trackerDate = picked;
        loadTracker();
      } else {
        state.plannerDate = picked;
        loadPlanner();
      }
      closeCalendar();
    });
  });
}

$('calPrev').addEventListener('click', async () => {
  calendar.viewMonth.setMonth(calendar.viewMonth.getMonth() - 1);
  await loadCalendarData();
  renderCalendar();
});

$('calNext').addEventListener('click', async () => {
  calendar.viewMonth.setMonth(calendar.viewMonth.getMonth() + 1);
  await loadCalendarData();
  renderCalendar();
});

$('calTodayBtn').addEventListener('click', () => {
  calendar.viewMonth = new Date();
  if (calendar.target === 'tracker') {
    state.trackerDate = new Date();
    loadTracker();
  } else {
    state.plannerDate = new Date();
    loadPlanner();
  }
  closeCalendar();
});

// Close calendar when clicking outside
document.addEventListener('click', (e) => {
  if (!calendar.visible) return;
  const popover = $('calendarPopover');
  const trigger = e.target.closest('[data-calendar]');
  if (popover.contains(e.target)) return;
  if (trigger) return;
  closeCalendar();
});

// Wire up the Today buttons to open calendar
document.querySelectorAll('[data-calendar]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (calendar.visible && calendar.target === btn.dataset.calendar) {
      closeCalendar();
    } else {
      closeCalendar();
      openCalendar(btn.dataset.calendar, btn);
    }
  });
});

// ═══════════════════════════════════════════════════════════
//  STATS PAGE
// ═══════════════════════════════════════════════════════════
async function loadStats() {
  if (!dbReady) return;

  // Load last 90 days of entries for pattern analysis
  const from = addDays(new Date(), -90);
  const to   = new Date();

  try {
    const { data } = await dbClient.from('time_entries')
      .select('*')
      .gte('date', dateToString(from))
      .lte('date', dateToString(to))
      .eq('entry_type', 'task')
      .order('started_at', { ascending: true });

    const entries = data || [];
    renderStats(entries);
  } catch (e) {
    console.error('Stats load error:', e);
  }
}

function renderStats(entries) {
  // ── Streaks ──
  const dateSet = new Set(entries.map(e => e.date));
  const allDates = Array.from(dateSet).sort();

  // Current streak (consecutive days ending today or yesterday)
  const todayStr = dateToString(new Date());
  const yesterdayStr = dateToString(addDays(new Date(), -1));
  let currentStreak = 0;
  if (dateSet.has(todayStr) || dateSet.has(yesterdayStr)) {
    let cursor = dateSet.has(todayStr) ? new Date() : addDays(new Date(), -1);
    while (dateSet.has(dateToString(cursor))) {
      currentStreak++;
      cursor = addDays(cursor, -1);
    }
  }

  // Longest streak
  let longestStreak = 0;
  let running = 0;
  let prevDate = null;
  allDates.forEach(d => {
    const dt = stringToDate(d);
    if (prevDate && (dt - prevDate) / 86400000 === 1) {
      running++;
    } else {
      running = 1;
    }
    if (running > longestStreak) longestStreak = running;
    prevDate = dt;
  });

  $('streakValue').textContent = currentStreak;
  $('longestStreakValue').textContent = longestStreak;
  $('streakSub').textContent = currentStreak > 0 ? 'days logged in a row' : 'Start tracking today!';

  // Total days
  $('totalDaysValue').textContent = dateSet.size;

  // ── Best day of week ──
  const byDow = [0, 0, 0, 0, 0, 0, 0];
  const countDow = [0, 0, 0, 0, 0, 0, 0];
  entries.forEach(e => {
    const dt = stringToDate(e.date);
    const dow = (dt.getDay() + 6) % 7;
    byDow[dow] += e.duration_secs;
    countDow[dow] += 1;
  });
  const avgDow = byDow.map((s, i) => countDow[i] > 0 ? s / (new Set(entries.filter(e => (stringToDate(e.date).getDay() + 6) % 7 === i).map(e => e.date)).size || 1) : 0);
  const DOW_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const bestDowIdx = avgDow.indexOf(Math.max(...avgDow));
  if (avgDow[bestDowIdx] > 0) {
    $('bestDayValue').textContent = DOW_NAMES[bestDowIdx];
    $('bestDaySub').textContent = `avg ${formatHoursMins(Math.round(avgDow[bestDowIdx]))} tracked`;
  } else {
    $('bestDayValue').textContent = '—';
    $('bestDaySub').textContent = 'not enough data';
  }

  // ── Peak productivity windows per category ──
  renderPeakWindows(entries);

  // ── Categories trending ──
  renderTrendingCats(entries);

  // ── Work pattern ──
  renderWorkPattern(entries);

  // ── Plan adherence ──
  renderPlanAdherence();
}

function renderPeakWindows(entries) {
  // For each category, find the hour-range where the most time is spent
  const catHours = {};
  entries.forEach(e => {
    if (!e.category) return;
    const start = new Date(e.started_at);
    const hour = start.getHours();
    if (!catHours[e.category]) catHours[e.category] = Array(24).fill(0);
    catHours[e.category][hour] += e.duration_secs;
  });

  const cats = Object.keys(catHours).sort();
  if (cats.length === 0) {
    $('peakWindows').innerHTML = '<div class="empty-state"><div>Not enough data yet</div></div>';
    return;
  }

  $('peakWindows').innerHTML = cats.slice(0, 6).map(cat => {
    const hours = catHours[cat];
    const maxHour = hours.indexOf(Math.max(...hours));
    const window = `${pad(maxHour)}:00 – ${pad(maxHour + 1)}:00`;
    return `
      <div class="peak-row">
        <div class="peak-cat">${escapeHtml(cat)}</div>
        <div style="color:var(--text-dim);font-size:11px;">Most active at</div>
        <div class="peak-window">${window}</div>
      </div>
    `;
  }).join('');
}

function renderTrendingCats(entries) {
  // Compare last 7 days to previous 21 days
  const now = new Date();
  const sevenDaysAgo = addDays(now, -7);
  const twentyEightDaysAgo = addDays(now, -28);

  const last7 = {};
  const prior21 = {};

  entries.forEach(e => {
    if (!e.category) return;
    const dt = new Date(e.started_at);
    if (dt >= sevenDaysAgo && dt <= now) {
      last7[e.category] = (last7[e.category] || 0) + e.duration_secs;
    } else if (dt >= twentyEightDaysAgo && dt < sevenDaysAgo) {
      prior21[e.category] = (prior21[e.category] || 0) + e.duration_secs;
    }
  });

  const allCats = new Set([...Object.keys(last7), ...Object.keys(prior21)]);
  if (allCats.size === 0) {
    $('trendingCats').innerHTML = '<div class="empty-state"><div>Not enough data yet</div></div>';
    return;
  }

  // Normalise: last 7 days vs average of prior 21 days (per week)
  const rows = Array.from(allCats).map(cat => {
    const l7 = last7[cat] || 0;
    const p21 = (prior21[cat] || 0) / 3; // per-week average
    const delta = p21 > 0 ? ((l7 - p21) / p21) * 100 : (l7 > 0 ? 100 : 0);
    return { cat, l7, p21, delta };
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  $('trendingCats').innerHTML = rows.slice(0, 6).map(r => {
    let arrow, cls;
    if (Math.abs(r.delta) < 10) { arrow = '→'; cls = 'flat'; }
    else if (r.delta > 0)       { arrow = '↑'; cls = 'up'; }
    else                        { arrow = '↓'; cls = 'down'; }

    const deltaStr = r.delta === Infinity || r.p21 === 0
      ? 'new'
      : (r.delta > 0 ? '+' : '') + Math.round(r.delta) + '%';

    return `
      <div class="trend-row">
        <div class="trend-cat">${escapeHtml(r.cat)}</div>
        <div class="trend-arrow ${cls}">${arrow}</div>
        <div class="trend-value">${deltaStr}</div>
      </div>
    `;
  }).join('');
}

function renderWorkPattern(entries) {
  if (entries.length < 5) {
    $('workPattern').innerHTML = '<div class="empty-state"><div>Not enough data yet</div></div>';
    return;
  }

  // Average start time, end time, total hours, break %
  const byDate = {};
  entries.forEach(e => {
    if (!byDate[e.date]) byDate[e.date] = { starts: [], ends: [], durations: 0 };
    byDate[e.date].starts.push(new Date(e.started_at));
    byDate[e.date].ends.push(new Date(e.ended_at));
    byDate[e.date].durations += e.duration_secs;
  });

  const days = Object.values(byDate);
  if (days.length === 0) {
    $('workPattern').innerHTML = '<div class="empty-state"><div>Not enough data yet</div></div>';
    return;
  }

  const startMinutes = days.map(d => {
    const earliest = d.starts.reduce((a, b) => a < b ? a : b);
    return earliest.getHours() * 60 + earliest.getMinutes();
  });
  const endMinutes = days.map(d => {
    const latest = d.ends.reduce((a, b) => a > b ? a : b);
    return latest.getHours() * 60 + latest.getMinutes();
  });

  const avgStart = Math.round(startMinutes.reduce((s, x) => s + x, 0) / startMinutes.length);
  const avgEnd   = Math.round(endMinutes.reduce((s, x) => s + x, 0) / endMinutes.length);
  const avgDuration = Math.round(days.reduce((s, d) => s + d.durations, 0) / days.length);

  $('workPattern').innerHTML = `
    <div class="pattern-row">
      <div class="pattern-label">Typical start</div>
      <div></div>
      <div class="pattern-value">${pad(Math.floor(avgStart/60))}:${pad(avgStart%60)}</div>
    </div>
    <div class="pattern-row">
      <div class="pattern-label">Typical finish</div>
      <div></div>
      <div class="pattern-value">${pad(Math.floor(avgEnd/60))}:${pad(avgEnd%60)}</div>
    </div>
    <div class="pattern-row">
      <div class="pattern-label">Daily average</div>
      <div></div>
      <div class="pattern-value">${formatHoursMins(avgDuration)}</div>
    </div>
    <div class="pattern-row">
      <div class="pattern-label">Days tracked</div>
      <div></div>
      <div class="pattern-value">${days.length}</div>
    </div>
  `;
}

async function renderPlanAdherence() {
  if (!dbReady) return;
  try {
    const from = addDays(new Date(), -30);
    const to = new Date();
    const { data: plans } = await dbClient.from('day_plans')
      .select('*')
      .gte('date', dateToString(from))
      .lte('date', dateToString(to));

    const { data: entries } = await dbClient.from('time_entries')
      .select('*')
      .gte('date', dateToString(from))
      .lte('date', dateToString(to))
      .eq('entry_type', 'task');

    if (!plans || plans.length === 0) {
      $('planAdherence').innerHTML = '<div class="empty-state"><div>Not enough data yet</div></div>';
      return;
    }

    // Group by date
    const byDate = {};
    plans.forEach(p => {
      if (!byDate[p.date]) byDate[p.date] = { plans: [], entries: [] };
      byDate[p.date].plans.push(p);
    });
    (entries || []).forEach(e => {
      if (!byDate[e.date]) byDate[e.date] = { plans: [], entries: [] };
      byDate[e.date].entries.push(e);
    });

    let totalMatchScore = 0;
    let daysCounted = 0;
    Object.entries(byDate).forEach(([date, d]) => {
      if (d.plans.length === 0) return;
      const score = calculatePlanMatch(d.plans, d.entries);
      if (score !== null) {
        totalMatchScore += score;
        daysCounted++;
      }
    });

    const avgScore = daysCounted > 0 ? Math.round(totalMatchScore / daysCounted) : null;

    $('planAdherence').innerHTML = `
      <div class="pattern-row">
        <div class="pattern-label">Avg plan match</div>
        <div></div>
        <div class="pattern-value">${avgScore !== null ? avgScore + '%' : '—'}</div>
      </div>
      <div class="pattern-row">
        <div class="pattern-label">Days planned</div>
        <div></div>
        <div class="pattern-value">${Object.keys(byDate).filter(d => byDate[d].plans.length > 0).length}</div>
      </div>
      <div class="pattern-row">
        <div class="pattern-label">Planned tasks</div>
        <div></div>
        <div class="pattern-value">${plans.length}</div>
      </div>
    `;
  } catch (e) {
    console.error(e);
  }
}

// ═══════════════════════════════════════════════════════════
//  TO-DO LIST
// ═══════════════════════════════════════════════════════════
let todoState = {
  showDone: false,
  todos: []
};

async function loadTodos() {
  // Populate category dropdown for new todos
  const sel = $('todoNewCategory');
  if (sel) {
    sel.innerHTML = '<option value="">— No category —</option>' +
      state.categories.map(c =>
        `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`
      ).join('');
  }

  // Load both columns in parallel
  await Promise.all([
    loadLocalTodos(),
    loadMsTodos()
  ]);
}

// ── Microsoft To Do ─────────────────────────────────────────
async function loadMsTodos() {
  const connectEl = $('msTodoConnect');
  const listsEl   = $('msTodoLists');
  const loadingEl = $('msTodoLoading');
  const errorEl   = $('msTodoError');
  const refreshBtn = $('todoMsRefreshBtn');
  if (!connectEl || !listsEl || !loadingEl || !errorEl) return;

  // Hide everything to start
  connectEl.style.display = 'none';
  listsEl.style.display   = 'none';
  errorEl.style.display   = 'none';

  // Check connection
  let connected = false;
  try { connected = await ipcRenderer.invoke('graph-is-connected'); } catch (e) {}

  if (!connected) {
    connectEl.style.display = 'block';
    if (refreshBtn) refreshBtn.style.display = 'none';
    return;
  }

  if (refreshBtn) refreshBtn.style.display = '';
  loadingEl.style.display = 'block';

  try {
    const listsRes = await ipcRenderer.invoke('graph-list-todo-lists');
    if (!listsRes || !listsRes.ok) {
      throw new Error(listsRes?.error || 'Failed to load lists');
    }

    // Fetch tasks for each list sequentially — fetching all in parallel
    // hits Microsoft Graph's per-app throttle and triggers 429s on a
    // typical 5-7 list account. Sequencing with a small gap is fast
    // enough (sub-second total) and never throttles.
    const tasksByList = [];
    for (const list of listsRes.lists) {
      const tasksRes = await ipcRenderer.invoke('graph-list-todo-tasks', { listId: list.id, includeCompleted: false });
      if (tasksRes && tasksRes.ok) {
        tasksByList.push({ list, tasks: tasksRes.tasks, error: null });
      } else {
        tasksByList.push({ list, tasks: [], error: tasksRes?.error || 'Unknown error' });
      }
    }

    loadingEl.style.display = 'none';
    listsEl.style.display = 'block';
    renderMsTodoLists(tasksByList);
  } catch (e) {
    loadingEl.style.display = 'none';
    errorEl.style.display = 'block';
    $('msTodoErrorText').textContent = '⚠ ' + e.message;
  }
}

function renderMsTodoLists(tasksByList) {
  const container = $('msTodoLists');
  if (!container) return;

  if (tasksByList.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:30px;"><div>No task lists found in your Microsoft account.</div></div>`;
    return;
  }

  // If any list had a fetch error, show that prominently
  const errorLists = tasksByList.filter(l => l.error);
  if (errorLists.length > 0) {
    const errs = errorLists.map(l => `<div style="font-size:11px;color:var(--danger);">⚠ ${escapeHtml(l.list.name)}: ${escapeHtml(l.error)}</div>`).join('');
    container.innerHTML = `<div class="settings-section" style="margin-bottom:12px;">${errs}</div>` +
      `<div style="font-size:11px;color:var(--text-dim);padding:8px 4px;">If you see "Insufficient privileges" your IT admin may need to grant the <code>Tasks.ReadWrite</code> permission.</div>`;
    return;
  }

  // Sort: lists with tasks first, then empty lists
  const sortedLists = [...tasksByList].sort((a, b) => {
    if (a.tasks.length === 0 && b.tasks.length > 0) return 1;
    if (b.tasks.length === 0 && a.tasks.length > 0) return -1;
    return 0;
  });

  const totalOpen = sortedLists.reduce((sum, l) => sum + l.tasks.length, 0);

  if (totalOpen === 0) {
    // Show the lists we DID find so users have visual confirmation we connected
    const listNames = sortedLists.map(l => `<span class="ms-todo-list-count" style="margin-right:6px;">${escapeHtml(l.list.name)}</span>`).join('');
    container.innerHTML = `
      <div class="empty-state" style="padding:30px;">
        <div style="margin-bottom:14px;">🎉 All caught up — no open tasks.</div>
        <div style="font-size:11px;color:var(--text-dim);">Connected to: ${listNames}</div>
      </div>`;
    return;
  }

  // Render lists that have tasks
  const visibleLists = sortedLists.filter(l => l.tasks.length > 0);
  container.innerHTML = visibleLists.map(({ list, tasks }) => `
    <div class="ms-todo-list">
      <div class="ms-todo-list-name">
        <span>${escapeHtml(list.name)}</span>
        <span class="ms-todo-list-count">${tasks.length}</span>
      </div>
      ${tasks.map(t => msTodoTaskHtml(t, list.id)).join('')}
    </div>
  `).join('');

  // Wire up checkbox-tick (mark complete) + drag to plan
  container.querySelectorAll('.ms-todo-task').forEach(el => {
    const checkbox = el.querySelector('.ms-todo-checkbox');
    if (checkbox) {
      checkbox.addEventListener('click', async (e) => {
        e.stopPropagation();
        const listId = el.dataset.listId;
        const taskId = el.dataset.taskId;
        el.classList.add('completing');
        try {
          const res = await ipcRenderer.invoke('graph-complete-todo-task', { listId, taskId });
          if (res && res.ok) {
            setTimeout(() => el.remove(), 300);
          } else {
            el.classList.remove('completing');
            alert('Could not mark task complete: ' + (res?.error || 'unknown error'));
          }
        } catch (err) {
          el.classList.remove('completing');
          alert('Could not mark task complete: ' + err.message);
        }
      });
    }

    // Drag to day plan: store task data in dataTransfer
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      el.classList.add('dragging');
      const payload = {
        type:     'ms-todo',
        title:    el.dataset.title,
        listId:   el.dataset.listId,
        taskId:   el.dataset.taskId
      };
      try {
        e.dataTransfer.setData('application/x-daytimer-todo', JSON.stringify(payload));
        e.dataTransfer.setData('text/plain', payload.title);
      } catch (err) {}
      e.dataTransfer.effectAllowed = 'copy';
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
  });
}

function msTodoTaskHtml(task, listId) {
  const importanceClass = task.importance === 'high' ? 'high' : '';
  const importanceMark  = task.importance === 'high' ? '<span class="ms-todo-task-importance high">! High</span>' : '';
  let dueMark = '';
  if (task.due_date) {
    const due = new Date(task.due_date);
    const overdue = due < new Date();
    dueMark = `<span class="ms-todo-task-due ${overdue ? 'overdue' : ''}">Due ${due.toLocaleDateString()}</span>`;
  }
  return `
    <div class="ms-todo-task" data-list-id="${escapeHtml(listId)}" data-task-id="${escapeHtml(task.id)}" data-title="${escapeHtml(task.title)}">
      <div class="ms-todo-checkbox" title="Mark complete in Microsoft To Do"></div>
      <div style="flex:1;min-width:0;">
        <div class="ms-todo-task-title">${escapeHtml(task.title)}</div>
        ${importanceMark || dueMark ? `<div class="ms-todo-task-meta">${importanceMark}${dueMark}</div>` : ''}
      </div>
      <button class="todo-add-to-plan" data-action="ms-to-plan" title="Add to today's plan" style="flex-shrink:0;">→ Plan</button>
    </div>
  `;
}

async function loadLocalTodos() {
  if (!dbReady) return;
  try {
    // High-priority items rise to the top within each (open / done) group.
    let result = await dbClient.from('todos')
      .select('*')
      .order('is_done', { ascending: true })
      .order('is_high_priority', { ascending: false })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (result.error) {
      // Likely the v5.5.5 migration hasn't been run yet — fall back to
      // the legacy ordering so the list still loads. Priority sort just
      // won't apply until the migration is run.
      console.warn(
        'To-dos: fell back to legacy ordering. Run supabase-v5.5.5.sql to enable priority sort.',
        result.error
      );
      result = await dbClient.from('todos')
        .select('*')
        .order('is_done', { ascending: true })
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
    }
    todoState.todos = result.data || [];
    renderLocalTodos();
  } catch (e) { console.error('Load todos error:', e); }
}

function renderLocalTodos() {
  const open = todoState.todos.filter(t => !t.is_done);
  const done = todoState.todos.filter(t => t.is_done);
  const list = todoState.showDone ? [...open, ...done] : open;

  $('todoListTitle').textContent =
    todoState.showDone ? `All (${todoState.todos.length})` : `Open (${open.length})`;
  $('todoToggleDone').textContent = todoState.showDone
    ? `Hide done (${done.length})`
    : `Show done (${done.length})`;

  if (list.length === 0) {
    $('todoList').innerHTML = '<div class="empty-state" style="padding:30px;"><div>No to-dos yet. Add one above.</div></div>';
    return;
  }

  $('todoList').innerHTML = list.map(t => {
    const catColour = t.category ? categoryColour(t.category) : 'var(--text-dim)';
    const catSoft = t.category ? colourToSoft(catColour) : 'transparent';
    const priorityBtn = `<button class="mini-btn" data-action="toggle-priority" data-id="${t.id}" title="${t.is_high_priority ? 'Remove priority flag' : 'Mark as high priority'}" style="color:${t.is_high_priority ? '#ef4444' : 'var(--text-dim)'};font-size:13px;line-height:1;">${t.is_high_priority ? '🚩' : '⚐'}</button>`;
    // Scheduled state shows as a blue outline on the row + a tooltip
    // with the date — no extra column needed.
    const scheduledClass = t.scheduled_date ? ' scheduled' : '';
    const rowTitle = t.scheduled_date ? `Scheduled for ${escapeHtml(t.scheduled_date)}` : '';
    // Category cell occupies the slot whether or not a category is set —
    // keeps the grid columns aligned across rows.
    const catCell = t.category
      ? `<span class="todo-cat" style="background:${catSoft};color:${catColour};">${escapeHtml(t.category)}</span>`
      : `<span></span>`;
    return `
      <div class="todo-row ${t.is_done ? 'done' : ''}${scheduledClass} ${t.is_high_priority ? 'high-priority' : ''}" data-id="${t.id}" draggable="true" title="${rowTitle}">
        <div class="todo-checkbox ${t.is_done ? 'checked' : ''}" data-action="toggle" data-id="${t.id}">
          ${t.is_done ? '✓' : ''}
        </div>
        <div class="todo-name" data-action="edit" data-id="${t.id}">${escapeHtml(t.task_name)}</div>
        ${catCell}
        ${priorityBtn}
        <button class="todo-add-to-plan" data-action="to-plan" data-id="${t.id}" title="Add to today's plan">→ Plan</button>
        <button class="mini-btn danger" data-action="delete" data-id="${t.id}" title="Delete">✕</button>
      </div>
    `;
  }).join('');

  // Wire up actions
  $('todoList').querySelectorAll('[data-action="toggle"]').forEach(el => {
    el.addEventListener('click', () => toggleTodo(el.dataset.id));
  });
  $('todoList').querySelectorAll('[data-action="toggle-priority"]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePriority(el.dataset.id);
    });
  });
  $('todoList').querySelectorAll('[data-action="edit"]').forEach(el => {
    el.addEventListener('click', () => editTodo(el.dataset.id));
  });
  $('todoList').querySelectorAll('[data-action="delete"]').forEach(el => {
    el.addEventListener('click', () => deleteTodo(el.dataset.id));
  });
  $('todoList').querySelectorAll('[data-action="to-plan"]').forEach(el => {
    el.addEventListener('click', () => addTodoToPlan(el.dataset.id));
  });
}

async function toggleTodo(id) {
  const todo = todoState.todos.find(t => t.id === id);
  if (!todo) return;
  const newDone = !todo.is_done;
  if (dbReady) {
    await dbClient.from('todos').update({
      is_done: newDone,
      done_at: newDone ? new Date().toISOString() : null
    }).eq('id', id);
  }
  loadLocalTodos();
}

async function deleteTodo(id) {
  if (dbReady) await dbClient.from('todos').delete().eq('id', id);
  loadLocalTodos();
}

async function togglePriority(id) {
  const todo = todoState.todos.find(t => t.id === id);
  if (!todo) return;
  if (dbReady) {
    await dbClient.from('todos')
      .update({ is_high_priority: !todo.is_high_priority })
      .eq('id', id);
  }
  loadLocalTodos();
}

function editTodo(id) {
  const todo = todoState.todos.find(t => t.id === id);
  if (!todo) return;
  const catOptions = '<option value="">— No category —</option>' +
    state.categories.map(c =>
      `<option value="${escapeHtml(c.name)}" ${c.name === todo.category ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
    ).join('');
  openModal(`
    <div class="modal-title">Edit to-do</div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <input type="text" class="field-input" id="editTodoName" value="${escapeHtml(todo.task_name)}" style="width:100%;">
      <select class="field-input" id="editTodoCat" style="width:100%;">${catOptions}</select>
      <textarea class="field-input" id="editTodoNotes" placeholder="Notes (optional)" rows="3" style="width:100%;resize:vertical;">${escapeHtml(todo.notes || '')}</textarea>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:var(--text);">
        <input type="checkbox" id="editTodoPriority" ${todo.is_high_priority ? 'checked' : ''}>
        <span>🚩 High priority — sorts to top of the list</span>
      </label>
    </div>
    <div class="modal-footer">
      <button class="modal-btn" onclick="closeModal()">Cancel</button>
      <button class="modal-btn primary" id="saveTodoBtn">Save</button>
    </div>
  `);
  $('saveTodoBtn').addEventListener('click', async () => {
    const name = $('editTodoName').value.trim();
    if (!name) return;
    if (dbReady) {
      await dbClient.from('todos').update({
        task_name: name,
        category: $('editTodoCat').value || null,
        notes: $('editTodoNotes').value.trim() || null,
        is_high_priority: $('editTodoPriority').checked
      }).eq('id', id);
    }
    closeModal();
    loadLocalTodos();
  });
}

async function addTodoToPlan(id) {
  const todo = todoState.todos.find(t => t.id === id);
  if (!todo) return;

  // Switch to planner page first
  navigateTo('planner');

  // Wait a tick for DOM
  await new Promise(r => setTimeout(r, 60));

  // Get default start time
  let startTime = '09:00';
  const lastEnd = await getLastPlannedEndTime();
  if (lastEnd) startTime = lastEnd;

  // Open the add modal pre-filled. Pass sourceTodoId so the save step
  // stamps the scheduled_date back onto the to-do row.
  await openAddPlanItem(startTime, undefined, { sourceTodoId: id });

  setTimeout(() => {
    if ($('planTask')) {
      $('planTask').value = todo.task_name;
      if (todo.category) {
        const catSel = $('planCategory');
        const opt = Array.from(catSel.options).find(o => o.value === todo.category);
        if (opt) catSel.value = todo.category;
      }
      // Carry the to-do's priority flag onto the planned task by default.
      if (todo.is_high_priority && $('planPriority')) {
        $('planPriority').checked = true;
      }
      // Focus start time so user can adjust quickly
      $('planStart').focus();
      $('planStart').select();
    }
  }, 100);
}

async function addMsTaskToPlan(title) {
  navigateTo('planner');
  await new Promise(r => setTimeout(r, 60));
  let startTime = '09:00';
  const lastEnd = await getLastPlannedEndTime();
  if (lastEnd) startTime = lastEnd;
  await openAddPlanItem(startTime);
  setTimeout(() => {
    if ($('planTask')) {
      $('planTask').value = title;
      $('planStart').focus();
      $('planStart').select();
    }
  }, 100);
}

// Click handler for the MS → Plan button (delegated)
document.addEventListener('click', (e) => {
  if (e.target && e.target.dataset && e.target.dataset.action === 'ms-to-plan') {
    e.stopPropagation();
    const taskEl = e.target.closest('.ms-todo-task');
    if (taskEl) addMsTaskToPlan(taskEl.dataset.title);
  }
});

$('todoAddBtn').addEventListener('click', addNewTodo);
$('todoNewInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addNewTodo();
});

async function addNewTodo() {
  const name = $('todoNewInput').value.trim();
  if (!name) return;
  const category = $('todoNewCategory').value || null;
  if (dbReady) {
    await dbClient.from('todos').insert([withUid({
      task_name: name,
      category,
      sort_order: (todoState.todos.length || 0) + 1
    })]);
  }
  $('todoNewInput').value = '';
  $('todoNewCategory').value = '';
  $('todoNewInput').focus();
  loadLocalTodos();
}

$('todoToggleDone').addEventListener('click', () => {
  todoState.showDone = !todoState.showDone;
  renderLocalTodos();
});

// MS To Do — connect button (within the To-Do page) → triggers Graph auth flow
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'msTodoConnectBtn') {
    ipcRenderer.invoke('graph-connect').catch(() => {});
  }
});

// MS To Do — refresh button
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'todoMsRefreshBtn') {
    loadMsTodos();
  }
});

// When Graph connection state changes, reload the MS To-Do column
ipcRenderer.on('graph-connection-changed', () => {
  if (state.currentPage === 'todos') loadMsTodos();
});

// ═══════════════════════════════════════════════════════════
//  ONBOARDING TOUR
// ═══════════════════════════════════════════════════════════
function getFirstName() {
  const email = (currentUser && currentUser.email) || '';
  const local = email.split('@')[0] || '';
  // Try to extract a first name from the local part (e.g. "flynn.askew" -> "Flynn")
  const namePart = local.split(/[\.\-_]/)[0] || local;
  if (!namePart) return 'there';
  return namePart.charAt(0).toUpperCase() + namePart.slice(1).toLowerCase();
}

// SVG illustration of the widget — used as visual aid for widget tour
// steps so we don't have to literally spotlight elements across windows.
function widgetSvg(highlightId) {
  const isHL = (id) => highlightId === id;
  const hl = (id) => isHL(id) ? '#6ee7b7' : 'transparent';
  const hlWidth = (id) => isHL(id) ? 2.5 : 0;
  const dim = (id) => highlightId && !isHL(id) ? 0.35 : 1;
  return `
  <svg viewBox="0 0 320 230" width="100%" style="display:block;border-radius:12px;background:#0f0f13;">
    <!-- widget shell -->
    <rect x="4" y="4" width="312" height="222" rx="14" fill="#1a1a22" stroke="#2e2e3e" stroke-width="1"/>
    <!-- title bar -->
    <g opacity="${dim('titlebar')}">
      <rect x="4" y="4" width="312" height="36" rx="14" fill="#22222e"/>
      <rect x="4" y="22" width="312" height="18" fill="#22222e"/>
      <rect x="${isHL('titlebar') ? 4 : 0}" y="${isHL('titlebar') ? 4 : 0}" width="${isHL('titlebar') ? 312 : 0}" height="${isHL('titlebar') ? 36 : 0}" rx="14" fill="none" stroke="${hl('titlebar')}" stroke-width="${hlWidth('titlebar')}"/>
      <circle cx="20" cy="22" r="4" fill="#6ee7b7"/>
      <text x="32" y="26" font-family="DM Sans, sans-serif" font-size="11" fill="#aaaabb" font-weight="600">DayTimer</text>
    </g>
    <!-- minimise button -->
    <g opacity="${dim('minimise')}">
      <rect x="234" y="12" width="22" height="20" rx="5" fill="${isHL('minimise') ? '#6ee7b7' : '#2a2a35'}"/>
      <line x1="240" y1="22" x2="250" y2="22" stroke="${isHL('minimise') ? '#0f0f13' : '#aaaabb'}" stroke-width="1.6" stroke-linecap="round"/>
      <rect x="234" y="12" width="22" height="20" rx="5" fill="none" stroke="${hl('minimise')}" stroke-width="${hlWidth('minimise')}"/>
    </g>
    <!-- open-main button -->
    <g opacity="${dim('openmain')}">
      <rect x="260" y="12" width="22" height="20" rx="5" fill="${isHL('openmain') ? '#6ee7b7' : '#2a2a35'}"/>
      <rect x="266" y="17" width="10" height="10" rx="1.5" fill="none" stroke="${isHL('openmain') ? '#0f0f13' : '#aaaabb'}" stroke-width="1.4"/>
      <line x1="266" y1="22" x2="276" y2="22" stroke="${isHL('openmain') ? '#0f0f13' : '#aaaabb'}" stroke-width="1.2"/>
      <line x1="271" y1="17" x2="271" y2="27" stroke="${isHL('openmain') ? '#0f0f13' : '#aaaabb'}" stroke-width="1.2"/>
      <rect x="260" y="12" width="22" height="20" rx="5" fill="none" stroke="${hl('openmain')}" stroke-width="${hlWidth('openmain')}"/>
    </g>
    <!-- close button -->
    <g opacity="${dim('close')}">
      <rect x="286" y="12" width="22" height="20" rx="5" fill="${isHL('close') ? '#6ee7b7' : '#2a2a35'}"/>
      <line x1="291" y1="17" x2="303" y2="27" stroke="${isHL('close') ? '#0f0f13' : '#aaaabb'}" stroke-width="1.6" stroke-linecap="round"/>
      <line x1="303" y1="17" x2="291" y2="27" stroke="${isHL('close') ? '#0f0f13' : '#aaaabb'}" stroke-width="1.6" stroke-linecap="round"/>
      <rect x="286" y="12" width="22" height="20" rx="5" fill="none" stroke="${hl('close')}" stroke-width="${hlWidth('close')}"/>
    </g>
    <!-- timer display -->
    <text x="160" y="80" text-anchor="middle" font-family="DM Mono, monospace" font-size="28" fill="#e8e8f0" font-weight="500">00:00:00</text>
    <!-- task input -->
    <g opacity="${dim('task')}">
      <rect x="16" y="100" width="288" height="32" rx="6" fill="#15151c" stroke="#2e2e3e"/>
      <text x="26" y="120" font-family="DM Sans, sans-serif" font-size="12" fill="#666677">What are you working on?</text>
      <rect x="16" y="100" width="288" height="32" rx="6" fill="none" stroke="${hl('task')}" stroke-width="${hlWidth('task')}"/>
    </g>
    <!-- category dropdown -->
    <g opacity="${dim('category')}">
      <rect x="16" y="140" width="288" height="32" rx="6" fill="#15151c" stroke="#2e2e3e"/>
      <text x="26" y="160" font-family="DM Sans, sans-serif" font-size="12" fill="#aaaabb">Emails</text>
      <path d="M 290 153 l 6 6 l 6 -6" stroke="#aaaabb" stroke-width="1.4" fill="none" stroke-linecap="round"/>
      <rect x="16" y="140" width="288" height="32" rx="6" fill="none" stroke="${hl('category')}" stroke-width="${hlWidth('category')}"/>
    </g>
    <!-- start/next button -->
    <g opacity="${dim('start')}">
      <rect x="16" y="180" width="288" height="36" rx="8" fill="${isHL('start') ? '#6ee7b7' : '#2a2a35'}"/>
      <text x="160" y="203" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="13" fill="${isHL('start') ? '#0f0f13' : '#e8e8f0'}" font-weight="600">Start Day</text>
      <rect x="16" y="180" width="288" height="36" rx="8" fill="none" stroke="${hl('start')}" stroke-width="${hlWidth('start')}"/>
    </g>
  </svg>`;
}

function buildTourSteps() {
  const name = getFirstName();
  const widgetIllustration = (highlight) => `<div style="margin-bottom:12px;">${widgetSvg(highlight)}</div>`;

  // Track when we've transitioned from widget illustration tour into main app tour
  let widgetTourEnded = false;
  const ensureWidgetHidden = () => {
    if (!widgetTourEnded) {
      widgetTourEnded = true;
      // Send several times in case widget IPC isn't yet bound on first launch.
      // Each attempt is cheap; main process just calls .hide() repeatedly.
      const attempt = () => { try { ipcRenderer.send('widget-hide'); } catch (e) {} };
      attempt();
      setTimeout(attempt, 200);
      setTimeout(attempt, 600);
      setTimeout(attempt, 1500);
    }
  };

  return [
    // ── Widget tour (illustrated) ─────────────────────────────
    {
      target: null,
      title: `Hey ${name}! 👋`,
      body: widgetIllustration(null) +
        `Welcome to DayTimer. The widget pictured above is what sits on top of your screen all day, so you can track your time without breaking flow. Let's take a quick look around.`
    },
    {
      target: null,
      title: 'The title bar',
      body: widgetIllustration('titlebar') +
        `Grab this bar to drag the widget anywhere on screen. Most people tuck it in a corner out of the way.`
    },
    {
      target: null,
      title: 'Minimise',
      body: widgetIllustration('minimise') +
        `Shrinks the widget to just the title bar. Still there, barely noticeable.`
    },
    {
      target: null,
      title: 'Close',
      body: widgetIllustration('close') +
        `Closes DayTimer. Don't worry — everything's saved before it shuts.`
    },
    {
      target: null,
      title: 'Task input',
      body: widgetIllustration('task') +
        `Type what you're working on right now. Short is fine — <em>"Writing proposal"</em> or <em>"Teams call with Geoff"</em> works perfectly.`
    },
    {
      target: null,
      title: 'Category',
      body: widgetIllustration('category') +
        `Assign your task to a category. You'll set up your own in Settings — we'll get to that shortly!`
    },
    {
      target: null,
      title: 'Start Day / Next Task',
      body: widgetIllustration('start') +
        `Hit <strong>Start Day</strong> to begin tracking. It then becomes <strong>Next Task</strong> — tap it whenever you switch tasks and it logs what you just did. If you planned your day ahead, your next task fills in automatically. When you're done for the day, hit <strong>Pause</strong> then <strong>→ End Day</strong>.`
    },
    {
      target: null,
      title: 'Open the main dashboard',
      body: widgetIllustration('openmain') +
        `Widget tour done! The grid button (⊞) on the widget opens the main dashboard — that's where all your time data lives. Click <strong>Next</strong> and we'll take a look.`
    },

    // ── Main app tour (real-element spotlights) ───────────────
    {
      target: () => document.querySelector('.app-shell, .sidebar, body'),
      title: 'The dashboard',
      body: `Welcome to the DayTimer dashboard. All your tracked time, charts, planning tools and settings live here.`,
      placement: 'auto',
      onShow: async () => {
        ensureWidgetHidden();
        navigateTo('tracker');
      }
    },
    {
      target: () => document.querySelector('.sidebar'),
      title: 'Sidebar',
      body: `Six sections on the left — <strong>Tracker</strong>, <strong>Planner</strong>, <strong>To-Do</strong>, <strong>Insights</strong>, <strong>Stats</strong>, and <strong>Settings</strong>. We'll walk through each one.`,
      placement: 'right'
    },
    {
      target: () => document.querySelector('#page-tracker'),
      title: 'Tracker',
      body: `Everything you've logged today appears here. Edit task names, swap categories, or delete entries that went wrong. It's your running record of the day.`,
      placement: 'auto',
      onShow: () => navigateTo('tracker')
    },
    {
      target: () => document.querySelector('#page-planner'),
      title: 'Day Planner',
      body: `Plan your day in advance — block out time for tasks before you start. Click any slot to add a task, or drag across multiple slots for longer blocks.`,
      placement: 'auto',
      onShow: () => navigateTo('planner')
    },
    {
      target: () => document.querySelector('.view-tabs') || document.querySelector('[data-view="split"]'),
      title: 'Plan vs Actual',
      body: `Switch between <strong>Plan</strong>, <strong>Actual</strong>, and <strong>Split View</strong>. Split View is the most useful — it shows your plan side-by-side with what actually happened, so you can see where the day diverged.`,
      placement: 'bottom',
      onShow: async () => {
        navigateTo('planner');
        // Switch to split view for visual emphasis
        await new Promise(r => setTimeout(r, 80));
        const btn = document.querySelector('[data-view="split"]');
        if (btn) btn.click();
      }
    },
    {
      target: () => document.querySelector('#page-todos'),
      title: 'To-Do list',
      body: `Park ideas and tasks here when they pop into your head — drop them into the Day Planner when you're ready. Connect Microsoft and your <strong>MS To Do</strong> tasks appear alongside in the right-hand column. Tick them off here and they sync back.`,
      placement: 'auto',
      onShow: () => navigateTo('todos')
    },
    {
      target: () => document.querySelector('#page-insights'),
      title: 'Insights',
      body: `Your time visualised — daily breakdowns, category splits, and trends. The further back you look, the more obvious your patterns get.`,
      placement: 'auto',
      onShow: () => navigateTo('insights')
    },
    {
      target: () => document.querySelector('#goalsCard'),
      title: 'Goals',
      body: `Set daily or weekly time targets for any category — like "no more than 2 hours a day on emails" or "at least 4 hours of deep work". Progress shows live as you track.`,
      placement: 'top',
      onShow: async () => {
        navigateTo('insights');
        await new Promise(r => setTimeout(r, 100));
        const el = document.querySelector('#goalsCard');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    },
    {
      target: () => document.querySelector('#page-stats'),
      title: 'Stats',
      body: `The data view — totals, averages, and how each category stacks up over time. Useful for end-of-week or end-of-month reviews.`,
      placement: 'auto',
      onShow: () => navigateTo('stats')
    },
    {
      target: () => document.querySelector('#categoryList')?.closest('.settings-section'),
      title: 'Categories',
      body: `Set up your own categories here so your time tracking matches how you actually work. Add, rename, recolour or delete — these are the labels that show up in the widget dropdown.`,
      placement: 'auto',
      onShow: async () => {
        navigateTo('settings');
        await new Promise(r => setTimeout(r, 100));
        const el = document.querySelector('#categoryList')?.closest('.settings-section');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    },
    {
      target: () => {
        // Look for the Appearance section by its title text
        const titles = document.querySelectorAll('.section-title');
        for (const t of titles) {
          if (t.textContent.trim() === 'Appearance') return t.closest('.settings-section');
        }
        return null;
      },
      title: 'Themes',
      body: `Pick a colour theme to make DayTimer feel like yours. There's a range of light and dark themes to choose from.`,
      placement: 'auto',
      onShow: async () => {
        navigateTo('settings');
        await new Promise(r => setTimeout(r, 100));
        const titles = document.querySelectorAll('.section-title');
        for (const t of titles) {
          if (t.textContent.trim() === 'Appearance') {
            t.closest('.settings-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            break;
          }
        }
      }
    },
    {
      target: () => document.querySelector('#msConnectBtn')?.closest('.settings-section'),
      title: 'Connect your calendar',
      body: `Connect your Outlook calendar under <strong>Integrations</strong> and your meetings will auto-fill the Day Planner. No more planning from scratch every day.`,
      placement: 'auto',
      onShow: async () => {
        navigateTo('settings');
        await new Promise(r => setTimeout(r, 100));
        const el = document.querySelector('#msConnectBtn')?.closest('.settings-section');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    },
    {
      target: () => {
        const titles = document.querySelectorAll('.section-title');
        for (const t of titles) {
          if (t.textContent.trim().startsWith('Feature Requests')) return t.closest('.settings-section');
        }
        return null;
      },
      title: 'Got an idea? 💡',
      body: `Spotted something that would make DayTimer better? Head to <strong>Settings → Feature Requests</strong>, type your idea, and hit <strong>Register request</strong>. It goes straight to the team — we read every one, and you can see the status of yours right here.`,
      placement: 'auto',
      onShow: async () => {
        navigateTo('settings');
        await new Promise(r => setTimeout(r, 100));
        const titles = document.querySelectorAll('.section-title');
        for (const t of titles) {
          if (t.textContent.trim().startsWith('Feature Requests')) {
            t.closest('.settings-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            break;
          }
        }
      }
    },
    {
      target: null,
      title: `You're all set, ${name}! 🎉`,
      body: `That's the lot. All the best with DayTimer — hope it makes time tracking feel less like a faff.<br><br>If you ever want to run through this tour again, you can find a <strong>Replay tour</strong> button in <strong>Settings → About</strong>.`,
      onShow: () => {
        // Return to tracker view as a clean exit
        navigateTo('tracker');
      }
    }
  ];
}

async function startOnboardingTour() {
  if (typeof window.tourRun !== 'function') {
    console.warn('Tour runner not loaded');
    return;
  }
  // Make sure the user data has loaded so getFirstName works
  await waitForAuth(2000);
  const steps = buildTourSteps();
  window.tourRun(steps, {
    storageKey: 'daytimer_tour_completed',
    finalLabel: 'Finish',
    onFinish: () => {
      // Bring the widget back (it was hidden during the main app tour)
      try { ipcRenderer.send('widget-show'); } catch (e) {}
      // Land on the tracker view
      try { navigateTo('tracker'); } catch (e) {}
    }
  });
}

// Listen for trigger from main process
ipcRenderer.on('start-tour', () => {
  startOnboardingTour();
});

// ── "What's new" tour (shown to returning users on first run of a new version) ──
const WHATS_NEW = {
  '5.5.0': [
    {
      title: "What's new in v5.5.0 🎉",
      body: "A quick look at what's changed since you last opened DayTimer. Use <strong>Next</strong> to step through."
    },
    {
      title: "Customisable widget bar",
      body: "The quick-action buttons in the widget header are now yours to configure. Add emoji shortcuts for anything you do regularly — 🚨 disturbances, 🍌 snack breaks, 🚽 comfort breaks. Head to <strong>Settings → Widget Bar</strong> to set them up."
    },
    {
      title: "Calendar events in the widget",
      body: "If you've connected your Microsoft 365 calendar and assigned a category to a meeting, it now appears in the <strong>Coming Up</strong> panel on your widget automatically."
    },
    {
      title: "Smarter auto end-of-day",
      body: "DayTimer now auto-ends your day after 1 hour of inactivity from <strong>5:30pm</strong> (previously 5pm), and gives you a <strong>5-minute warning toast</strong> before it does so."
    },
    {
      title: "Streak badge & neon outline",
      body: "You can now <strong>hide the 🔥 streak badge</strong> to free up space for more widget buttons. There's also a new <strong>neon glow outline</strong> for the widget — pick a colour or sync it to your current category. Both in <strong>Settings → Appearance</strong>."
    }
  ],
  '5.5.3': [
    {
      title: "What's new in v5.5.3 🎉",
      body: "A quick look at what's changed since you last opened DayTimer. Use <strong>Next</strong> to step through."
    },
    {
      title: "Got an idea? Tell us 💡",
      body: "DayTimer now has a <strong>Feature Requests</strong> box. Spotted something that would make it better? Head to <strong>Settings → Feature Requests</strong>, type your idea and hit <strong>Register request</strong> — it goes straight to the team. You can see the status of your requests right there too."
    },
    {
      title: "Polish & fixes",
      body: "Plenty of smaller fixes: the minimised widget no longer blocks clicks on whatever's behind it, the widget's neon glow renders cleanly, quick-action buttons always show, and the streak badge hides instantly when you turn it off."
    }
  ],
  // 5.5.6 — first build the wider team receives after 5.5.4. Covers the
  // 5.5.5 + 5.5.6 changes (pause rework, priority/scheduled flags, High
  // Payoff tracking, etc) in one consolidated tour.
  '5.5.6': [
    {
      title: "What's new in DayTimer 🎉",
      body: "A few useful additions since you last opened DayTimer. Use <strong>Next</strong> to step through."
    },
    {
      title: "Smarter pause",
      body: "Paused time no longer bleeds into the next task. Hit <strong>Pause</strong> and your current task is logged then; the pause shows as a greyed-out 'Paused' row in the Tracker and doesn't count towards your day total. The timer also keeps counting while paused so you can see how long you've been on a break."
    },
    {
      title: "Priorities & scheduling",
      body: "To-Dos now have a 🚩 <strong>high-priority</strong> flag — flagged items rise to the top of the list. The same flag works on Day Planner blocks. Adding a To-Do to the plan tags it with a subtle blue outline so you know it's scheduled."
    },
    {
      title: "Plan future days in one click",
      body: "The <strong>Add planned task</strong> dialog now has a date picker — defaults to today, click to pick any day. No more navigating to a future date first."
    },
    {
      title: "Track your high-payoff time 💎",
      body: "Tick <strong>'💎 High payoff'</strong> on any category in <strong>Settings → Categories</strong>. A new chart on the Insights page tracks how many hours you're spending on the work that actually moves the needle — daily total + per-active-day average."
    },
    {
      title: "Got an idea? Tell us 💡",
      body: "There's a <strong>Feature Requests</strong> box in Settings. Type your idea, hit <strong>Register request</strong>, and it goes straight to the team. You'll see the status of your requests right there."
    }
  ],
  // 5.5.4 is the first build the wider team receives (everyone else jumps
  // straight from 5.4.1), so this entry rolls up *every* feature added
  // across 5.5.0 → 5.5.3 into one tour.
  '5.5.4': [
    {
      title: "What's new in DayTimer 🎉",
      body: "Quite a lot has changed since you last opened DayTimer. Here's a quick tour of the highlights — use <strong>Next</strong> to step through."
    },
    {
      title: "Customisable widget bar",
      body: "The quick-action buttons in the widget header are now yours to configure. Add emoji shortcuts for anything you do regularly — 🚨 disturbances, ☕ breaks, 📞 inbound calls. One click logs your current task and starts the new activity; <strong>Return to task</strong> then picks up where you left off. Set them up in <strong>Settings → Widget Bar</strong>."
    },
    {
      title: "Calendar events in the widget",
      body: "Connect your Microsoft 365 calendar and any meeting you've given a category to will appear automatically in the <strong>Coming Up</strong> panel on your widget."
    },
    {
      title: "Smarter auto end-of-day",
      body: "DayTimer now auto-ends your day after 1 hour of inactivity from <strong>5:30pm</strong>, with a <strong>5-minute warning</strong> before it does — so you won't lose track if you forget to end the day."
    },
    {
      title: "Streak badge & neon outline",
      body: "Keep a 🔥 <strong>streak</strong> going for every working day you track — weekends and bank holidays don't break it. Prefer a cleaner look? Hide the badge in <strong>Settings → Appearance</strong>, where you'll also find a new <strong>neon glow outline</strong> for the widget."
    },
    {
      title: "Got an idea? Tell us 💡",
      body: "There's now a <strong>Feature Requests</strong> box. Spotted something that would make DayTimer better? Head to <strong>Settings → Feature Requests</strong>, type your idea and hit <strong>Register request</strong> — it goes straight to the team, and you can track its status there."
    }
  ]
};

async function startWhatsNewTour(version) {
  await waitForAuth(2000);
  const steps = WHATS_NEW[version];
  if (!steps || !steps.length) return;
  if (typeof window.tourRun !== 'function') return;
  window.tourRun(
    steps.map(s => ({ target: null, title: s.title, body: s.body })),
    {
      storageKey: `daytimer_whatsnew_${version}`,
      finalLabel: 'Got it — let\'s go!',
      onFinish: () => { try { navigateTo('tracker'); } catch (e) {} }
    }
  );
}

ipcRenderer.on('start-whats-new-tour', (_evt, version) => {
  startWhatsNewTour(version);
});

// Listen for updater logs from main process so they appear in DevTools
ipcRenderer.on('updater-log', (_evt, { level, line }) => {
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
});

// Safety net — if first-login flag is set and we missed the IPC, run anyway
window.addEventListener('load', async () => {
  try {
    const isFirst = await ipcRenderer.invoke('is-first-login');
    if (isFirst) {
      // Slight delay so the dashboard has rendered
      setTimeout(startOnboardingTour, 500);
    }
  } catch (e) { /* ignore */ }
});

// ═══════════════════════════════════════════════════════════
//  TROOP MODE BAR (top of dashboard)
// ═══════════════════════════════════════════════════════════
function updateTroopBar(roster) {
  const bar = document.getElementById('troopBar');
  if (!bar) return;
  let hidden = false;
  try { hidden = localStorage.getItem('troopHidden') === '1'; } catch (e) {}
  if (hidden || !roster || roster.length === 0) {
    bar.style.display = 'none';
    return;
  }

  const members = roster.map(r => {
    const cat = r.current_category;
    const colour = cat ? categoryColour(cat) : 'var(--text-dim)';
    const catLabel = cat ? `<span class="troop-member-cat">· ${escapeHtml(cat)}</span>` : '';
    return `<div class="troop-member"><span class="troop-member-dot" style="background:${colour};"></span>${escapeHtml(r.display_name || 'Someone')}${catLabel}</div>`;
  }).join('');

  bar.innerHTML = `
    <span class="troop-bar-icon">🐒</span>
    <span><span class="troop-bar-count">${roster.length}</span> in the troop</span>
    <div class="troop-bar-list">${members}</div>
    <button class="troop-bar-hide" id="troopHideBtn" title="Hide troop bar">Hide</button>
  `;
  bar.style.display = 'flex';

  // Wire the hide button
  const hideBtn = document.getElementById('troopHideBtn');
  if (hideBtn && !hideBtn.dataset.wired) {
    hideBtn.addEventListener('click', () => {
      try { localStorage.setItem('troopHidden', '1'); } catch (e) {}
      bar.style.display = 'none';
      // Show a toast confirming where to bring it back
      if (window.dtFun) {
        window.dtFun.toast('Troop bar hidden — re-enable it in Settings', { emoji: '🐒', duration: 5000 });
      }
    });
    hideBtn.dataset.wired = 'true';
  }
}

// ═══════════════════════════════════════════════════════════
//  END OF WEEK SUMMARY (Friday afternoon)
// ═══════════════════════════════════════════════════════════
async function maybeShowWeekSummary() {
  try {
    const now = new Date();
    // Friday = 5, only after 3pm
    if (now.getDay() !== 5 || now.getHours() < 15) return;

    const todayKey = 'weekSummaryShown:' + now.toISOString().slice(0,10);
    if (localStorage.getItem(todayKey)) return;

    if (!dbReady) return;
    await waitForAuth(2000);
    if (!dbReady) return;

    // Sum up this week's task entries
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + (weekStart.getDay() === 0 ? -6 : 1)); // Monday
    weekStart.setHours(0,0,0,0);

    const { data } = await dbClient.from('time_entries')
      .select('category, duration_secs, entry_type')
      .gte('started_at', weekStart.toISOString())
      .lte('started_at', now.toISOString());

    if (!data || data.length === 0) return;

    const taskRows = data.filter(r => !r.entry_type || r.entry_type === 'task');
    const totalSecs = taskRows.reduce((s, r) => s + (r.duration_secs || 0), 0);
    const totalHours = (totalSecs / 3600).toFixed(1);

    // Top category
    const catTotals = {};
    taskRows.forEach(r => {
      if (!r.category) return;
      catTotals[r.category] = (catTotals[r.category] || 0) + (r.duration_secs || 0);
    });
    const topCat = Object.entries(catTotals).sort((a,b) => b[1]-a[1])[0];
    const topCatName = topCat ? topCat[0] : null;

    const firstName = (() => {
      const email = (currentUser && currentUser.email) || '';
      const local = email.split('@')[0] || '';
      const part = local.split(/[\.\-_]/)[0] || local;
      return part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : '';
    })();

    const greeting = firstName ? `Nice week, ${firstName}!` : 'Nice week!';
    let body = `${totalHours}h tracked this week`;
    if (topCatName) body += `, mostly ${topCatName}`;
    body += '. Have a good weekend 🍻';

    if (window.dtFun) {
      window.dtFun.toast(`${greeting} ${body}`, { emoji: '🎉', duration: 8000 });
    }
    localStorage.setItem(todayKey, '1');
  } catch (e) {
    console.error('week summary failed', e);
  }
}

// ═══════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════
(async () => {
  await loadAndApplyTheme();
  await loadCategoriesFromDb();
  loadTracker();
  // Run after a short delay so the dashboard has rendered first
  setTimeout(maybeShowWeekSummary, 2000);
})();
