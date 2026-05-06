// ═══════════════════════════════════════════════════════════
//  DayTimer — Troop Mode (presence)
//
//  This module is loaded into BOTH the widget and the main app.
//  It heartbeats the current user's "I'm tracking right now" status
//  to a shared `presence` table, and subscribes to realtime updates
//  so each window can show "🐒 N in the troop".
//
//  Dependencies (must be set on window before init):
//    window.dbClient, window.currentUserId, window.currentUser
//    (in widget there's no currentUser obj; we just need an email)
// ═══════════════════════════════════════════════════════════

(function attachTroop(global) {
  if (global.dtTroop) return;

  const HEARTBEAT_INTERVAL_MS = 30_000;
  const ACTIVE_WINDOW_MS = 90_000;

  let heartbeat = null;
  let isActive = false;
  let currentTask = null;
  let currentCategory = null;
  let realtimeChannel = null;
  let listeners = [];
  let cachedRoster = [];

  function getDisplayName() {
    try {
      const email = (global.currentUser && global.currentUser.email)
        || (global.currentUserEmail)
        || '';
      const local = email.split('@')[0] || '';
      const part = local.split(/[\.\-_]/)[0] || local;
      return part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : 'Someone';
    } catch (e) { return 'Someone'; }
  }

  async function pushPresence() {
    if (!global.dbClient || !global.currentUserId) return;
    try {
      await global.dbClient.from('presence').upsert({
        user_id:          global.currentUserId,
        display_name:     getDisplayName(),
        current_category: currentCategory,
        current_task:     currentTask,
        last_seen:        new Date().toISOString(),
        updated_at:       new Date().toISOString()
      }, { onConflict: 'user_id' });
    } catch (e) {
      console.warn('[troop] heartbeat failed', e);
    }
  }

  async function clearPresence() {
    if (!global.dbClient || !global.currentUserId) return;
    try {
      await global.dbClient.from('presence').delete().eq('user_id', global.currentUserId);
    } catch (e) {}
  }

  async function loadRoster() {
    if (!global.dbClient) return;
    try {
      const cutoff = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();
      const { data, error } = await global.dbClient.from('presence')
        .select('user_id, display_name, current_category, current_task, last_seen')
        .gte('last_seen', cutoff);
      if (error) {
        console.warn('[troop] roster query error:', error);
        return;
      }
      // Filter out yourself
      cachedRoster = (data || []).filter(r => r.user_id !== global.currentUserId);
      notifyListeners();
    } catch (e) {
      console.warn('[troop] loadRoster failed', e);
    }
  }

  function notifyListeners() {
    listeners.forEach(fn => { try { fn(cachedRoster); } catch (e) {} });
  }

  function subscribeRealtime() {
    if (!global.dbClient) return;
    try {
      realtimeChannel = global.dbClient.channel('presence-room')
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'presence' },
            () => loadRoster()
        )
        .subscribe();
    } catch (e) {
      console.warn('[troop] subscribe failed', e);
    }
  }

  // ── Public API ─────────────────────────────────────────────
  global.dtTroop = {
    // Call when the user starts tracking
    start({ task, category } = {}) {
      currentTask = task || null;
      currentCategory = category || null;
      if (!isActive) {
        isActive = true;
        pushPresence();
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = setInterval(pushPresence, HEARTBEAT_INTERVAL_MS);
      } else {
        // Already active, just refresh task/category
        pushPresence();
      }
    },

    // Call when the user stops/pauses tracking or ends day
    stop() {
      if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
      isActive = false;
      currentTask = null;
      currentCategory = null;
      clearPresence();
    },

    // Update task/category without changing active state
    update({ task, category }) {
      if (task !== undefined) currentTask = task;
      if (category !== undefined) currentCategory = category;
      if (isActive) pushPresence();
    },

    // Subscribe to roster updates. Returns an unsubscribe function.
    onRoster(fn) {
      listeners.push(fn);
      // Fire immediately with current roster
      try { fn(cachedRoster); } catch (e) {}
      return () => { listeners = listeners.filter(f => f !== fn); };
    },

    // Force-refresh the roster (useful on window focus)
    refresh: loadRoster,

    // Initialise after auth becomes ready
    init() {
      loadRoster();
      subscribeRealtime();
      // Refresh whenever window regains focus
      window.addEventListener('focus', loadRoster);
    },

    // Get current roster (cached)
    getRoster() { return cachedRoster.slice(); }
  };
})(window);
