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
      contextIsolation: false,
      webviewTag: true
    }
  });

  loginWindow.loadFile(path.join(__dirname, '../renderer/login.html'));
  loginWindow.setMenuBarVisibility(false);

  // Handle OAuth popup windows (Microsoft sign-in opens in a child window)
  loginWindow.webContents.setWindowOpenHandler(({ url }) => {
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 600,
        height: 750,
        title: 'Sign in with Microsoft',
        center: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      }
    };
  });

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
    backgroundColor: '#00000000',  // Fully transparent — fixes the outline issue
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: false,
    hasShadow: false,              // Remove Windows drop shadow that creates border
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
ipcMain.on('login-success', (event, user) => {
  currentUser = user;
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

ipcMain.on('widget-resize', (event, height) => {
  if (widgetWindow) {
    const [w] = widgetWindow.getSize();
    const [, h] = widgetWindow.getSize();
    if (h > 60) widgetWindow.setSize(w, Math.max(200, Math.round(height)), true);
  }
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
