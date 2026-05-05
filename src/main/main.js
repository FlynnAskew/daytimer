const { app, BrowserWindow, ipcMain, screen, dialog, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');

// Auto-updater (only in packaged builds)
let autoUpdater = null;
if (app.isPackaged) {
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    console.log('electron-updater not available');
  }
}

const store = new Store();

let loginWindow  = null;
let widgetWindow = null;
let mainWindow   = null;
let currentUser  = null;

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
  // Pass the full URL to the login window
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

  widgetWindow = new BrowserWindow({
    width: 320,
    height: 310,
    x: sw - 340,
    y: 40,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: false,
    hasShadow: false,
    thickFrame: false,         // Windows-only — removes the 1px border
    roundedCorners: false,     // Disable Windows-style rounded corners (we draw our own)
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
    widgetWindow.setPosition(sw - 340, 40);
  }

  widgetWindow.on('moved', () => {
    const [x, y] = widgetWindow.getPosition();
    store.set('widgetPosition', { x, y });
  });

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

ipcMain.handle('get-session', () => cachedSession);

ipcMain.on('set-session', (_evt, session) => {
  cachedSession = session;
});

ipcMain.on('login-success', (event, payload) => {
  // payload may be the user object (legacy) or { user, session } (new)
  const user    = payload?.user    || payload;
  const session = payload?.session || null;

  currentUser = user;
  if (session) cachedSession = session;
  store.set('lastUser', user);

  // Close login window and open the app
  if (loginWindow) {
    loginWindow.close();
    loginWindow = null;
  }

  createWidget();
});

ipcMain.on('logout', async () => {
  currentUser = null;
  cachedSession = null;
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
  if (widgetWindow) widgetWindow.setSize(320, 48, true);
});

ipcMain.on('widget-expand', () => {
  if (widgetWindow) widgetWindow.setSize(320, 310, true);
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
  widgetWindow.setPosition(sw - 340, 40);
  store.set('widgetPosition', { x: sw - 340, y: 40 });
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

ipcMain.handle('get-theme', () => store.get('theme', 'teal-dark'));

ipcMain.handle('get-current-user', () => currentUser);

ipcMain.handle('get-app-version', () => app.getVersion());

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
