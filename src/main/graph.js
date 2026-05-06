// ═══════════════════════════════════════════════════════════
//  DayTimer — Microsoft Graph integration (main process)
//
//  Handles a separate Microsoft auth flow (in addition to the Supabase
//  sign-in) so we can request Calendar + To Do scopes opt-in, without
//  forcing those permissions on everyone who logs in.
// ═══════════════════════════════════════════════════════════

const { shell, ipcMain, BrowserWindow, net } = require('electron');
const crypto = require('crypto');
const path = require('path');

// ── HTTP via Electron's net module ────────────────────────────
// We deliberately do NOT use Node's fetch here. On corporate networks
// with SSL inspection (very common with Sophos/Zscaler/etc), the
// firewall presents its own certificate signed by a corporate root
// that's installed in the OS trust store. Node fetch only trusts the
// CAs bundled with Node, so it fails with an opaque "fetch failed"
// error. Electron's `net` module uses Chromium's network stack which
// DOES respect the OS trust store — same as Chrome and Edge.
function httpRequest(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const request = net.request({
      method: opts.method || 'GET',
      url
    });

    Object.entries(opts.headers || {}).forEach(([k, v]) => request.setHeader(k, v));

    request.on('response', (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) {}
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: () => Promise.resolve(text),
          json: () => Promise.resolve(json)
        });
      });
      res.on('error', (e) => reject(e));
    });
    request.on('error', (e) => reject(e));

    if (opts.body) {
      const body = typeof opts.body === 'string' ? opts.body : opts.body.toString();
      request.write(body);
    }
    request.end();
  });
}

let store = null;          // electron-store instance (passed in from main.js)
let getMainWindow = null;  // function returning the main window (for IPC)
let tenantId = null;       // Azure tenant ID
let clientId = null;       // Azure client ID
let refreshTimer = null;

// PKCE state for the in-flight auth flow
let pkceVerifier = null;
let authState    = null;

const STORE_KEY = 'msGraphTokens';

const SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'Calendars.Read',
  'Tasks.ReadWrite'
].join(' ');

// ── PKCE helpers ──────────────────────────────────────────────
function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function makeVerifier() {
  return base64url(crypto.randomBytes(32));
}
function makeChallenge(verifier) {
  return base64url(crypto.createHash('sha256').update(verifier).digest());
}

// ── Token storage ─────────────────────────────────────────────
function getTokens() {
  if (!store) return null;
  return store.get(STORE_KEY) || null;
}
function setTokens(tokens) {
  if (!store) return;
  store.set(STORE_KEY, tokens);
}
function clearTokens() {
  if (!store) return;
  store.delete(STORE_KEY);
}

// ── Auth flow: initiate ──────────────────────────────────────
function buildAuthUrl(redirectUri) {
  pkceVerifier = makeVerifier();
  const challenge = makeChallenge(pkceVerifier);
  authState = base64url(crypto.randomBytes(16));

  const params = new URLSearchParams({
    client_id:             clientId,
    response_type:         'code',
    redirect_uri:          redirectUri,
    response_mode:         'query',
    scope:                 SCOPES,
    state:                 authState,
    code_challenge:        challenge,
    code_challenge_method: 'S256',
    prompt:                'select_account'
  });
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
}

async function exchangeCode(code, redirectUri) {
  const body = new URLSearchParams({
    client_id:     clientId,
    grant_type:    'authorization_code',
    code,
    redirect_uri:  redirectUri,
    code_verifier: pkceVerifier,
    scope:         SCOPES
  });

  const res = await httpRequest(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.error || 'Token exchange failed');
  }
  return data;
}

async function refreshAccessToken() {
  const tokens = getTokens();
  if (!tokens || !tokens.refresh_token) {
    return null;
  }
  const body = new URLSearchParams({
    client_id:     clientId,
    grant_type:    'refresh_token',
    refresh_token: tokens.refresh_token,
    scope:         SCOPES
  });
  const res = await httpRequest(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('[graph] refresh failed', data);
    // If refresh token is revoked/expired, force user to re-connect
    if (data.error === 'invalid_grant') clearTokens();
    return null;
  }
  saveAndScheduleRefresh(data);
  return data.access_token;
}

function saveAndScheduleRefresh(tokenResponse) {
  const expiresAt = Date.now() + (tokenResponse.expires_in - 60) * 1000;
  const tokens = {
    access_token:  tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token,
    expires_at:    expiresAt,
    scope:         tokenResponse.scope,
    saved_at:      Date.now()
  };
  setTokens(tokens);

  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
  const refreshIn = Math.max(10_000, expiresAt - Date.now() - 5 * 60 * 1000);
  console.log('[graph] next refresh in', Math.round(refreshIn / 1000), 's');
  refreshTimer = setTimeout(() => { refreshAccessToken().catch(e => console.error('[graph] refresh error', e)); }, refreshIn);

  // Notify renderers that connection state changed
  notifyConnectionState();
}

async function getValidAccessToken() {
  const tokens = getTokens();
  if (!tokens) return null;
  if (tokens.expires_at > Date.now() + 30_000) return tokens.access_token;
  return await refreshAccessToken();
}

// ── Graph API calls ──────────────────────────────────────────
async function graphFetch(path, opts = {}) {
  const token = await getValidAccessToken();
  if (!token) throw new Error('Not connected to Microsoft');

  const res = await httpRequest(`https://graph.microsoft.com/v1.0${path}`, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      'Authorization': `Bearer ${token}`,
      'Accept':        'application/json',
      'Prefer':        'outlook.timezone="UTC"'
    }
  });
  if (res.status === 401) {
    // Try one refresh and retry
    const fresh = await refreshAccessToken();
    if (!fresh) throw new Error('Microsoft auth expired — please reconnect');
    const retry = await httpRequest(`https://graph.microsoft.com/v1.0${path}`, {
      ...opts,
      headers: {
        ...(opts.headers || {}),
        'Authorization': `Bearer ${fresh}`,
        'Accept':        'application/json',
        'Prefer':        'outlook.timezone="UTC"'
      }
    });
    return retry;
  }
  return res;
}

async function listCalendarEvents(startISO, endISO) {
  // calendarView gives us recurring instances expanded — much better than /events
  const params = new URLSearchParams({
    startDateTime: startISO,
    endDateTime:   endISO,
    $select:       'id,subject,organizer,location,start,end,isAllDay,isCancelled',
    $top:          '250',
    $orderby:      'start/dateTime'
  });
  const res = await graphFetch(`/me/calendarView?${params.toString()}`);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Calendar fetch failed: ${res.status} ${txt}`);
  }
  const data = await res.json();
  return (data.value || []).map(e => ({
    ms_event_id:  e.id,
    subject:      e.subject || '(no subject)',
    organiser:    e.organizer?.emailAddress?.name || null,
    location:     e.location?.displayName || null,
    starts_at:    e.start?.dateTime ? new Date(e.start.dateTime + (e.start.dateTime.endsWith('Z') ? '' : 'Z')).toISOString() : null,
    ends_at:      e.end?.dateTime ? new Date(e.end.dateTime + (e.end.dateTime.endsWith('Z') ? '' : 'Z')).toISOString() : null,
    is_all_day:   !!e.isAllDay,
    is_cancelled: !!e.isCancelled
  })).filter(e => e.starts_at && e.ends_at);
}

// ── Microsoft To Do ──────────────────────────────────────────
async function listTaskLists() {
  const res = await graphFetch('/me/todo/lists?$top=50');
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Task lists fetch failed: ${res.status} ${txt}`);
  }
  const data = await res.json();
  return (data.value || []).map(l => ({
    id:         l.id,
    name:       l.displayName,
    is_shared:  !!l.isShared,
    well_known: l.wellknownListName || null   // e.g. 'defaultList', 'flaggedEmails'
  }));
}

// Encode a Graph entity ID for safe inclusion in a URL path segment.
// Graph IDs are base64-ish strings that may contain '=' and '+' which are
// unsafe in URL paths (query parsers interpret '=' as key-value separator
// even mid-path on some routing layers, and '+' is sometimes interpreted
// as space). We don't use encodeURIComponent because that mangles other
// characters that Graph expects to receive raw. This minimal encoding is
// the same approach the official Microsoft Graph JS SDK uses.
function encodeGraphId(id) {
  if (!id) return '';
  return id.replace(/=/g, '%3D').replace(/\+/g, '%2B');
}

async function listTasksInList(listId, includeCompleted = false) {
  const encodedId = encodeGraphId(listId);
  const win = getMainWindow && getMainWindow();
  const sendLog = (level, msg) => {
    console[level === 'error' ? 'error' : 'log']('[graph]', msg);
    if (win && !win.isDestroyed()) {
      win.webContents.send('updater-log', { level, line: '[graph] ' + msg });
    }
  };

  // ── Diagnostic: try multiple URL variants to isolate the bug ────
  // We try them in order until one succeeds.
  const variants = [
    { label: 'no-query',      path: `/me/todo/lists/${encodedId}/tasks` },
    { label: 'no-query-raw',  path: `/me/todo/lists/${listId}/tasks` },
    { label: 'top-only',      path: `/me/todo/lists/${encodedId}/tasks?$top=100` },
    { label: 'with-select',   path: `/me/todo/lists/${encodedId}/tasks?$top=100&$select=id,title,status,importance,dueDateTime,createdDateTime` }
  ];

  let workingResult = null;
  for (const v of variants) {
    const fullUrl = 'https://graph.microsoft.com/v1.0' + v.path;
    sendLog('info', `Try [${v.label}] ${fullUrl}`);
    try {
      const res = await graphFetch(v.path);
      if (res.ok) {
        sendLog('info', `✓ [${v.label}] succeeded`);
        workingResult = res;
        break;
      } else {
        const txt = await res.text().catch(() => '');
        sendLog('error', `✗ [${v.label}] status=${res.status} body=${txt}`);
      }
    } catch (e) {
      sendLog('error', `✗ [${v.label}] threw ${e.message}`);
    }
  }

  if (!workingResult) {
    throw new Error(`Tasks fetch failed: all URL variants failed`);
  }

  const data = await workingResult.json();
  let tasks = (data.value || []).map(t => ({
    id:           t.id,
    list_id:      listId,
    title:        t.title || '(untitled)',
    status:       t.status,
    importance:   t.importance,
    due_date:     t.dueDateTime?.dateTime || null,
    created_at:   t.createdDateTime || null
  }));
  if (!includeCompleted) {
    tasks = tasks.filter(t => t.status !== 'completed');
  }
  return tasks;
}

async function completeTask(listId, taskId) {
  const res = await graphFetch(
    `/me/todo/lists/${encodeGraphId(listId)}/tasks/${encodeGraphId(taskId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ status: 'completed' })
    }
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Task complete failed: ${res.status} ${txt}`);
  }
  return await res.json();
}

// ── Connection state notifications ───────────────────────────
function notifyConnectionState() {
  if (!getMainWindow) return;
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('graph-connection-changed', !!getTokens());
  }
}

// ── Public IPC API ───────────────────────────────────────────
function registerIpc() {
  ipcMain.handle('graph-is-connected', () => !!getTokens());

  ipcMain.handle('graph-connect', async () => {
    if (!clientId || !tenantId) {
      throw new Error('Microsoft Graph not configured (missing tenant or client ID).');
    }
    // Use the existing daytimer:// custom protocol — same as Supabase sign-in
    // We'll route /graph-callback specifically to this module
    const redirectUri = 'daytimer://graph-callback';
    const url = buildAuthUrl(redirectUri);
    shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle('graph-disconnect', () => {
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
    clearTokens();
    notifyConnectionState();
    return { ok: true };
  });

  ipcMain.handle('graph-list-events', async (_evt, { startISO, endISO }) => {
    try {
      const events = await listCalendarEvents(startISO, endISO);
      return { ok: true, events };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('graph-list-todo-lists', async () => {
    try {
      const lists = await listTaskLists();
      return { ok: true, lists };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('graph-list-todo-tasks', async (_evt, { listId, includeCompleted }) => {
    try {
      const tasks = await listTasksInList(listId, !!includeCompleted);
      return { ok: true, tasks };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('graph-complete-todo-task', async (_evt, { listId, taskId }) => {
    try {
      const updated = await completeTask(listId, taskId);
      return { ok: true, task: updated };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

// Called from main.js when a daytimer://graph-callback URL is received
async function handleAuthCallback(url) {
  try {
    const u = new URL(url);
    const code  = u.searchParams.get('code');
    const state = u.searchParams.get('state');
    const error = u.searchParams.get('error_description') || u.searchParams.get('error');
    if (error) {
      console.error('[graph] auth error:', error);
      const win = getMainWindow && getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('graph-auth-error', error);
      }
      return;
    }
    if (!code) return;
    if (state !== authState) {
      console.error('[graph] state mismatch — ignoring callback');
      return;
    }
    const tokens = await exchangeCode(code, 'daytimer://graph-callback');
    saveAndScheduleRefresh(tokens);
    console.log('[graph] connected');
  } catch (e) {
    console.error('[graph] callback handling failed', e);
    // Surface as much detail as possible so users can copy it for support
    let detail = e.message || 'Unknown error';
    if (e.code) detail += ' (code: ' + e.code + ')';
    if (e.cause && e.cause.message && e.cause.message !== e.message) {
      detail += ' — ' + e.cause.message;
    }
    const win = getMainWindow && getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('graph-auth-error', detail);
    }
  }
}

// ── Bootstrap ────────────────────────────────────────────────
function init({ store: storeInstance, getMainWindow: gmw, tenantId: tid, clientId: cid }) {
  store = storeInstance;
  getMainWindow = gmw;
  tenantId = tid;
  clientId = cid;

  registerIpc();

  // If we already have tokens, schedule a refresh based on their expiry
  const tokens = getTokens();
  if (tokens) {
    const refreshIn = Math.max(10_000, tokens.expires_at - Date.now() - 5 * 60 * 1000);
    refreshTimer = setTimeout(() => { refreshAccessToken().catch(() => {}); }, refreshIn);
  }
}

module.exports = { init, handleAuthCallback };
