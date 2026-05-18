const { app, BrowserWindow, ipcMain, screen, dialog, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');
const graph = require('./graph');

// Auto-updater (only in packaged builds)
let autoUpdater = null;
if (app.isPackaged) {
  try {
    autoUpdater = require('electron-updater').autoUpdater;
    autoUpdater.disableDifferentialDownload = false;
    // Pipe updater logs to renderer DevTools so we can actually see what's
    // happening. The main process console isn't visible in installed builds.
    const sendLog = (level, msg) => {
      const line = '[updater] ' + (typeof msg === 'string' ? msg : JSON.stringify(msg));
      console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](line);
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('updater-log', { level, line });
        }
      } catch (e) {}
    };
    autoUpdater.logger = {
      info:  (m) => sendLog('info',  m),
      warn:  (m) => sendLog('warn',  m),
      error: (m) => sendLog('error', m),
      debug: (m) => sendLog('info',  m)
    };
  } catch (e) {
    console.log('electron-updater not available');
  }
}

const store = new Store();

// Apply stored prerelease preference to updater (admin staging toggle)
if (autoUpdater) {
  autoUpdater.allowPrerelease = store.get('allowPrerelease', false);
}

let loginWindow  = null;
let widgetWindow = null;
let mainWindow   = null;
let currentUser  = null;
let pendingFirstLogin = false;
let pendingWhatsNew   = false; // true when returning user opens a new version

const DEFAULT_QUICK_ACTIONS = [
  { id: 'phone', emoji: '📞', name: 'Inbound call', category: null, entryType: 'inbound_call' }
];
const DEFAULT_WIDGET_PREFS = {
  showStreak:   true,
  neonOutline:  { enabled: false, color: '#FF7D00', syncToCategory: false }
};

// ── Register custom protocol for OAuth callbacks ──────────────
// This makes Windows recognise daytimer:// links and open this app
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('daytimer', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('daytimer');
}

// Single instance lock — required for protocol handler to forward to existing window
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    // Someone tried to run a second instance — focus existing window
    if (loginWindow) {
      if (loginWindow.isMinimized()) loginWindow.restore();
      loginWindow.focus();
    }
    // Look for a daytimer:// URL in the command line args (Windows)
    const url = commandLine.find(arg => arg.startsWith('daytimer://'));
    if (url) handleDeepLink(url);
  });
}

// macOS deep link handler
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

function handleDeepLink(url) {
  console.log('Deep link received:', url);
  // Route by host/path: graph callbacks go to the Graph module,
  // everything else is treated as a Supabase auth callback.
  try {
    const u = new URL(url);
    if (u.host === 'graph-callback' || u.pathname === '/graph-callback') {
      try { graph.handleAuthCallback(url); } catch (e) { console.error('graph callback failed', e); }
      // Bring the main app to the front so the user sees the connection update
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
      else if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.focus();
      return;
    }
  } catch (e) { /* fall through to Supabase handling */ }

  // Default: Supabase auth callback into the login window
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.webContents.send('oauth-callback', url);
    loginWindow.focus();
  }
}

// ══════════════════════════════════════════════════════════════
//  LOGIN WINDOW
// ══════════════════════════════════════════════════════════════
function createLoginWindow() {
  loginWindow = new BrowserWindow({
    width: 480,
    height: 600,
    resizable: false,
    frame: true,
    title: 'DayTimer — Sign In',
    center: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  loginWindow.loadFile(path.join(__dirname, '../renderer/login.html'));
  loginWindow.setMenuBarVisibility(false);

  loginWindow.on('closed', () => {
    loginWindow = null;
    if (!widgetWindow && !mainWindow) {
      app.quit();
    }
  });
}

// ══════════════════════════════════════════════════════════════
//  WIDGET WINDOW
// ══════════════════════════════════════════════════════════════
function createWidget() {
  const primary = screen.getPrimaryDisplay();
  const { width: sw } = primary.workAreaSize;

  // If launched with --hidden (auto-startup case), don't show widget on top.
  // The user can bring it back via system tray or restart, but we don't want
  // to interrupt them when Windows logs in.
  const startHidden = process.argv.includes('--hidden');

  widgetWindow = new BrowserWindow({
    // 24px transparent body padding on all sides → +48 to width & height.
    // Lets the widget's box-shadow / neon glow render without being clipped
    // by the window frame.
    width: 368,
    height: 358,
    x: sw - 364,
    y: 16,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: false,
    hasShadow: false,
    thickFrame: false,
    roundedCorners: false,
    show: !startHidden,         // Don't auto-show if launched hidden
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  widgetWindow.loadFile(path.join(__dirname, '../renderer/widget.html'));

  // Restore saved position only if on a visible display
  const pos = store.get('widgetPosition');
  if (pos && isPositionOnVisibleDisplay(pos.x, pos.y)) {
    widgetWindow.setPosition(pos.x, pos.y);
  } else {
    widgetWindow.setPosition(sw - 364, 16);
  }

  widgetWindow.on('moved', () => {
    const [x, y] = widgetWindow.getPosition();
    store.set('widgetPosition', { x, y });
  });

  widgetWindow.on('focus', () => maybeRefreshOnFocus());

  widgetWindow.on('closed', () => { widgetWindow = null; });

  // Pass user info to widget renderer
  widgetWindow.webContents.once('did-finish-load', () => {
    if (currentUser) {
      widgetWindow.webContents.send('user-info', currentUser);
    }
  });
}

// ══════════════════════════════════════════════════════════════
//  MAIN APP WINDOW
// ══════════════════════════════════════════════════════════════
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    frame: true,
    title: 'DayTimer',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/main.html'));
  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.once('did-finish-load', () => {
    if (currentUser) {
      mainWindow.webContents.send('user-info', currentUser);
    }
  });

  mainWindow.on('focus', () => maybeRefreshOnFocus());
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ══════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════
function isPositionOnVisibleDisplay(x, y) {
  return screen.getAllDisplays().some(d => {
    const b = d.bounds;
    return x >= b.x && x < b.x + b.width &&
           y >= b.y && y < b.y + b.height;
  });
}

// ══════════════════════════════════════════════════════════════
//  APP LIFECYCLE
// ══════════════════════════════════════════════════════════════
app.whenReady().then(() => {
  // When the laptop wakes from sleep, the refresh timer may have fired
  // (or missed) while suspended. Force a check on resume.
  try {
    const { powerMonitor } = require('electron');
    powerMonitor.on('resume', () => {
      console.log('[main] system resumed — checking auth token');
      maybeRefreshOnFocus();
    });
    powerMonitor.on('unlock-screen', () => {
      maybeRefreshOnFocus();
    });
  } catch (e) {
    console.warn('powerMonitor not available', e);
  }

  // Initialise Microsoft Graph integration. Tenant + client IDs come
  // from the same Azure app registration used for Supabase sign-in.
  // We read them from src/ms-config.js (generated at build time from
  // GitHub secrets) and fall back to existing supabase-config if needed.
  let msTenantId = null, msClientId = null;
  try {
    const msCfg = require('../ms-config');
    msTenantId = msCfg.tenantId || msCfg.tenant_id || null;
    msClientId = msCfg.clientId || msCfg.client_id || null;
  } catch (e) { /* ms-config.js not present in dev */ }

  graph.init({
    store,
    getMainWindow: () => mainWindow,
    tenantId: msTenantId,
    clientId: msClientId
  });

  // Always start with login
  createLoginWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (currentUser) createWidget();
      else createLoginWindow();
    }
  });

  // Auto-update check
  if (autoUpdater) {
    setTimeout(() => {
      try { autoUpdater.checkForUpdatesAndNotify(); } catch (e) {}
    }, 10000); // 10s after launch

    setInterval(() => {
      try { autoUpdater.checkForUpdatesAndNotify(); } catch (e) {}
    }, 6 * 60 * 60 * 1000);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Handle OAuth callback URLs (deep links)
app.on('open-url', (event, url) => {
  event.preventDefault();
  // The OAuth callback will be handled by Supabase's client-side listener
  // Just ensure the login window is focused if it exists
  if (loginWindow) loginWindow.focus();
});

// ══════════════════════════════════════════════════════════════
//  IPC: LOGIN FLOW
// ══════════════════════════════════════════════════════════════
// ── Session broker — main is the source of truth for auth ────
// Each Electron renderer has its own localStorage, so the widget can't
// see the login window's Supabase session. The login renderer pushes
// the session here, and any other renderer pulls it via get-session.
let cachedSession = null;
let refreshTimer  = null;

ipcMain.handle('get-session', () => cachedSession);

ipcMain.on('set-session', (_evt, session) => {
  cachedSession = session;
  scheduleRefresh();
});

// ── Automatic token refresh ───────────────────────────────────
// Microsoft access tokens expire after ~1 hour. Without refresh,
// every save fails until the user signs in again. We use the refresh
// token to mint a new access token before expiry and push the new
// session to every renderer window so their RLS calls keep working.

function scheduleRefresh() {
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
  if (!cachedSession || !cachedSession.expires_at) return;

  const expiresAtMs = cachedSession.expires_at * 1000;
  // Refresh 5 minutes before expiry, but not less than 10 seconds away
  const refreshIn = Math.max(10_000, expiresAtMs - Date.now() - 5 * 60 * 1000);
  console.log('[main] token refresh scheduled in', Math.round(refreshIn / 1000), 's');
  refreshTimer = setTimeout(() => { refreshSession(); }, refreshIn);
}

// HTTP via Electron's net module — uses Chromium's network stack which
// respects the OS certificate store. Crucial on corporate networks with
// SSL inspection (Sophos/Zscaler etc) — Node's built-in fetch will fail
// with an opaque "fetch failed" error in that situation.
function netPost(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const { net } = require('electron');
    const request = net.request({ method: 'POST', url });
    Object.entries(opts.headers || {}).forEach(([k, v]) => request.setHeader(k, v));
    request.on('response', (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) {}
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text:   () => Promise.resolve(text),
          json:   () => Promise.resolve(json)
        });
      });
      res.on('error', reject);
    });
    request.on('error', reject);
    if (opts.body) request.write(typeof opts.body === 'string' ? opts.body : opts.body.toString());
    request.end();
  });
}

let refreshAttempts = 0;       // consecutive failed attempts
const MAX_BACKOFF_MS = 5 * 60 * 1000;  // cap at 5 mins between retries

function broadcastAuthState(state) {
  // state: 'refreshed' | 'failing' | 'dead'
  [widgetWindow, mainWindow, loginWindow].forEach(win => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('auth-state', state);
    }
  });
}

async function refreshSession() {
  if (!cachedSession || !cachedSession.refresh_token) return;
  try {
    // Read Supabase config from the same file the renderers use
    const cfg = require(path.join(__dirname, '..', 'supabase-config.js'));
    if (!cfg.url || !cfg.anonKey) {
      console.error('[main] supabase config missing — cannot refresh');
      return;
    }

    const res = await netPost(
      `${cfg.url}/auth/v1/token?grant_type=refresh_token`,
      {
        headers: {
          'Content-Type': 'application/json',
          'apikey': cfg.anonKey,
          'Authorization': `Bearer ${cfg.anonKey}`
        },
        body: JSON.stringify({ refresh_token: cachedSession.refresh_token })
      }
    );

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error('[main] token refresh failed', res.status, txt);
      // 4xx auth errors mean the refresh token is dead — only re-login fixes it
      if (res.status >= 400 && res.status < 500) {
        broadcastAuthState('dead');
        return; // don't retry — would just keep failing
      }
      // 5xx or network: retry with backoff
      throw new Error(`refresh status ${res.status}`);
    }

    const fresh = await res.json();
    if (!fresh || !fresh.access_token || !fresh.refresh_token) {
      console.error('[main] token refresh returned no tokens', fresh);
      throw new Error('no tokens in refresh response');
    }

    // Merge the new tokens into the cached session
    cachedSession = {
      ...cachedSession,
      access_token:  fresh.access_token,
      refresh_token: fresh.refresh_token,
      expires_at:    fresh.expires_at,
      expires_in:    fresh.expires_in,
      token_type:    fresh.token_type || cachedSession.token_type
    };
    refreshAttempts = 0;
    console.log('[main] token refreshed, new expiry:', new Date(cachedSession.expires_at * 1000).toISOString());

    // Push fresh tokens to every renderer
    [widgetWindow, mainWindow, loginWindow].forEach(win => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('session-refreshed', cachedSession);
      }
    });
    broadcastAuthState('refreshed');

    // Schedule the next refresh
    scheduleRefresh();
  } catch (e) {
    refreshAttempts++;
    // Exponential backoff: 30s, 60s, 2m, 4m, capped at 5m. Keep retrying
    // forever — there's no good reason to stop trying. Most failures are
    // transient network issues (VPN drop, captive portal etc).
    const backoff = Math.min(MAX_BACKOFF_MS, 30_000 * Math.pow(2, Math.min(refreshAttempts - 1, 5)));
    console.error(`[main] token refresh threw (attempt ${refreshAttempts}, retrying in ${Math.round(backoff/1000)}s):`, e.message || e);
    if (refreshAttempts >= 3) broadcastAuthState('failing');
    refreshTimer = setTimeout(() => { refreshSession(); }, backoff);
  }
}

// Try a refresh whenever any window regains focus — catches the case
// where a laptop lid was closed past the token's expiry and the timer
// missed its slot. Cheap to run; refreshSession bails fast if not needed.
function maybeRefreshOnFocus() {
  if (!cachedSession || !cachedSession.expires_at) return;
  const ms = cachedSession.expires_at * 1000 - Date.now();
  // If less than 5 minutes of life left, refresh now
  if (ms < 5 * 60 * 1000) refreshSession();
}

ipcMain.on('login-success', (event, payload) => {
  // payload may be the user object (legacy) or { user, session } (new)
  const user    = payload?.user    || payload;
  const session = payload?.session || null;

  currentUser = user;
  if (session) {
    cachedSession = session;
    scheduleRefresh();
  }

  // Detect first-time login per user — if we've never stored their UID
  // before, mark this session as needing a tour.
  const seenKey = 'tourSeenUsers';
  const seenUsers = store.get(seenKey, []);
  const userId = user && user.id;
  const isFirstLogin = userId && !seenUsers.includes(userId);
  if (isFirstLogin) {
    store.set(seenKey, [...seenUsers, userId]);
    pendingFirstLogin = true;
  }

  // For returning users: check if the app version has changed since last run
  const lastSeenVersion = store.get('lastSeenVersion', '0.0.0');
  const currentVersion  = app.getVersion();
  if (!isFirstLogin && lastSeenVersion !== currentVersion) {
    pendingWhatsNew = true;
  }
  store.set('lastSeenVersion', currentVersion);

  store.set('lastUser', user);

  // Close login window and open the app
  if (loginWindow) {
    loginWindow.close();
    loginWindow = null;
  }

  createWidget();

  // For first-time users we open the main window straight away so the
  // tour can run there. The widget sees the same flag and shows a
  // brief "Welcome — let's take a tour" prompt that opens main on click.
  if (isFirstLogin) {
    setTimeout(() => {
      if (!mainWindow) createMainWindow();
      mainWindow.webContents.once('did-finish-load', () => {
        // Hide widget before tour — it's alwaysOnTop and would overlay tour tooltips
        if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.hide();
        mainWindow.webContents.send('start-tour');
      });
    }, 600);
  } else if (pendingWhatsNew) {
    pendingWhatsNew = false;
    setTimeout(() => {
      if (!mainWindow) createMainWindow();
      const send = () => mainWindow.webContents.send('start-whats-new-tour', currentVersion);
      if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', send);
      else send();
    }, 800);
  }
});

ipcMain.on('logout', async () => {
  currentUser = null;
  cachedSession = null;
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
  store.delete('lastUser');

  // Close all windows
  if (widgetWindow) { widgetWindow.close(); widgetWindow = null; }
  if (mainWindow)   { mainWindow.close();   mainWindow = null; }

  // Re-open login
  createLoginWindow();
});

// ══════════════════════════════════════════════════════════════
//  IPC: WIDGET
// ══════════════════════════════════════════════════════════════
ipcMain.on('widget-minimise', () => {
  if (widgetWindow) widgetWindow.setSize(368, 96, true); // 320+48, 48+48
});

// Forward idle-interval changes from main app → widget so it can re-arm
ipcMain.on('idle-interval-changed', (_evt, mins) => {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.webContents.send('idle-interval-changed', mins);
  }
});

// ── Quick-action buttons (customisable widget bar) ────────────
ipcMain.handle('get-quick-actions', () => store.get('quickActions', DEFAULT_QUICK_ACTIONS));

ipcMain.on('set-quick-actions', (_evt, actions) => {
  store.set('quickActions', actions);
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.webContents.send('quick-actions-updated', actions);
  }
});

// ── Widget preferences (streak, neon outline, etc.) ──────────
ipcMain.handle('get-widget-prefs', () => store.get('widgetPrefs', DEFAULT_WIDGET_PREFS));

ipcMain.on('set-widget-pref', (_evt, { key, value }) => {
  const prefs = store.get('widgetPrefs', { ...DEFAULT_WIDGET_PREFS });
  prefs[key] = value;
  store.set('widgetPrefs', prefs);
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.webContents.send('widget-pref-updated', { key, value });
  }
});

ipcMain.on('widget-hide', () => {
  // The widget may not exist yet on first-login (tour fires very early).
  // Retry a few times so the hide actually lands when the window appears.
  let attempts = 0;
  const tryHide = () => {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.hide();
      return;
    }
    attempts++;
    if (attempts < 30) setTimeout(tryHide, 100);
  };
  tryHide();
});

ipcMain.on('widget-show', () => {
  if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.show();
});

ipcMain.on('widget-expand', () => {
  if (widgetWindow) widgetWindow.setSize(368, 358, true); // 320+48, 310+48
});

// Smart click-through — renderer reports when pointer is over the visible widget area
// vs over the transparent margin so that clicks pass through to whatever is underneath.
ipcMain.on('widget-set-clickthrough', (event, ignore) => {
  if (!widgetWindow) return;
  if (ignore) {
    // forward:true keeps mouse-move events flowing so we can detect re-entry
    widgetWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    widgetWindow.setIgnoreMouseEvents(false);
  }
});

ipcMain.on('widget-resize', (event, height) => {
  if (widgetWindow) {
    const [w] = widgetWindow.getSize();
    const [, h] = widgetWindow.getSize();
    if (h > 60) widgetWindow.setSize(w, Math.max(200, Math.round(height)), true);
  }
});

ipcMain.on('quit-app', () => {
  app.quit();
});

ipcMain.on('open-external', (event, url) => {
  shell.openExternal(url);
});

ipcMain.on('reset-widget-position', () => {
  if (!widgetWindow) return;
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
  widgetWindow.setPosition(sw - 364, 16);
  store.set('widgetPosition', { x: sw - 364, y: 16 });
});

// ══════════════════════════════════════════════════════════════
//  IPC: MAIN APP
// ══════════════════════════════════════════════════════════════
ipcMain.on('open-main', () => {
  if (!mainWindow) createMainWindow();
  else { mainWindow.show(); mainWindow.focus(); }
});

ipcMain.on('categories-updated', () => {
  if (widgetWindow) widgetWindow.webContents.send('refresh-categories');
});

ipcMain.on('theme-changed', (event, theme) => {
  store.set('theme', theme);
  if (widgetWindow) widgetWindow.webContents.send('theme-changed', theme);
  if (loginWindow)  loginWindow.webContents.send('theme-changed', theme);
});

ipcMain.handle('get-theme', () => store.get('theme', 'howler-light'));

ipcMain.handle('get-current-user', () => currentUser);

ipcMain.handle('get-app-version', () => app.getVersion());

// ── Admin staging: pre-release toggle ───────────────────────
ipcMain.handle('get-allow-prerelease', () => store.get('allowPrerelease', false));
ipcMain.on('set-allow-prerelease', (_evt, enabled) => {
  store.set('allowPrerelease', !!enabled);
  if (autoUpdater) autoUpdater.allowPrerelease = !!enabled;
});

// ── Auto-launch on Windows startup ──────────────────────────
// Uses Electron's built-in setLoginItemSettings which adds a registry
// entry under HKCU (current user only — no admin required).
ipcMain.handle('get-autolaunch', () => {
  try {
    const settings = app.getLoginItemSettings({ args: ['--hidden'] });
    return {
      enabled:    settings.openAtLogin,
      startHidden: !!store.get('autolaunchHidden', false)
    };
  } catch (e) {
    return { enabled: false, startHidden: false };
  }
});

ipcMain.handle('set-autolaunch', (_evt, { enabled, startHidden }) => {
  try {
    store.set('autolaunchHidden', !!startHidden);
    if (enabled) {
      app.setLoginItemSettings({
        openAtLogin: true,
        args: startHidden ? ['--hidden'] : []
      });
    } else {
      app.setLoginItemSettings({ openAtLogin: false });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('is-first-login', () => {
  const v = pendingFirstLogin;
  pendingFirstLogin = false; // consume — only true once per session
  return v;
});

ipcMain.on('replay-tour', () => {
  if (!mainWindow) createMainWindow();
  else { mainWindow.show(); mainWindow.focus(); }
  const send = () => mainWindow && mainWindow.webContents.send('start-tour');
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }
});

ipcMain.handle('check-for-updates', async () => {
  if (!autoUpdater) return { available: false, dev: true };
  try {
    const result = await autoUpdater.checkForUpdates();
    return {
      available: result?.updateInfo?.version !== app.getVersion(),
      currentVersion: app.getVersion(),
      latestVersion: result?.updateInfo?.version
    };
  } catch (e) {
    return { error: e.message };
  }
});

// ══════════════════════════════════════════════════════════════
//  IPC: DEVTOOLS
// ══════════════════════════════════════════════════════════════
ipcMain.on('toggle-devtools-widget', () => {
  if (widgetWindow) widgetWindow.webContents.toggleDevTools({ mode: 'detach' });
});

ipcMain.on('toggle-devtools-main', () => {
  if (mainWindow) mainWindow.webContents.toggleDevTools({ mode: 'detach' });
});

ipcMain.on('toggle-devtools-login', () => {
  if (loginWindow) loginWindow.webContents.toggleDevTools({ mode: 'detach' });
});

// ══════════════════════════════════════════════════════════════
//  AUTO-UPDATER EVENTS
// ══════════════════════════════════════════════════════════════
if (autoUpdater) {
  autoUpdater.on('update-available', (info) => {
    if (mainWindow) mainWindow.webContents.send('update-available', info);
  });

  autoUpdater.on('download-progress', (progress) => {
    if (mainWindow) mainWindow.webContents.send('update-progress', progress);
  });

  autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow) mainWindow.webContents.send('update-downloaded', info);
    dialog.showMessageBox({
      type: 'info',
      buttons: ['Restart now', 'Later'],
      title: 'DayTimer update ready',
      message: `Version ${info.version} is ready to install.`,
      detail: 'Restart DayTimer to apply the update.'
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('Updater error:', err);
  });
}
