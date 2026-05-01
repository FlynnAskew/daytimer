const { app, BrowserWindow, ipcMain, screen, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');

// Auto-updater (only when running as packaged app, not in dev)
let autoUpdater = null;
if (app.isPackaged) {
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    console.log('electron-updater not available — auto-update disabled');
  }
}

const store = new Store();

let widgetWindow = null;
let mainWindow = null;

// ── Widget Window (floating timer) ──────────────────────────
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
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  widgetWindow.loadFile(path.join(__dirname, '../renderer/widget.html'));

  // Restore saved position only if it's still on a visible display
  const pos = store.get('widgetPosition');
  if (pos && isPositionOnVisibleDisplay(pos.x, pos.y)) {
    widgetWindow.setPosition(pos.x, pos.y);
  } else {
    // Default to primary display top-right
    widgetWindow.setPosition(sw - 340, 40);
  }

  widgetWindow.on('moved', () => {
    const [x, y] = widgetWindow.getPosition();
    store.set('widgetPosition', { x, y });
  });

  widgetWindow.on('closed', () => { widgetWindow = null; });
}

// Check whether (x, y) is inside any connected display
function isPositionOnVisibleDisplay(x, y) {
  const displays = screen.getAllDisplays();
  return displays.some(d => {
    const b = d.bounds;
    return x >= b.x && x < b.x + b.width &&
           y >= b.y && y < b.y + b.height;
  });
}

// ── Main App Window ──────────────────────────────────────────
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
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── App Lifecycle ────────────────────────────────────────────
app.whenReady().then(() => {
  createWidget();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWidget();
  });

  // Check for updates 5 seconds after launch (only in packaged builds)
  if (autoUpdater) {
    setTimeout(() => {
      try {
        autoUpdater.checkForUpdatesAndNotify();
      } catch (e) {
        console.error('Update check failed:', e);
      }
    }, 5000);

    // Check again every 6 hours while app is running
    setInterval(() => {
      try { autoUpdater.checkForUpdatesAndNotify(); } catch (e) { /* ignore */ }
    }, 6 * 60 * 60 * 1000);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── Auto-updater event handlers ──────────────────────────────
if (autoUpdater) {
  autoUpdater.on('update-available', (info) => {
    if (mainWindow) {
      mainWindow.webContents.send('update-available', info);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow) {
      mainWindow.webContents.send('update-downloaded', info);
    }
    // Show dialog asking user to restart
    dialog.showMessageBox({
      type: 'info',
      buttons: ['Restart now', 'Later'],
      title: 'DayTimer update',
      message: `Version ${info.version} has been downloaded.`,
      detail: 'Restart DayTimer to apply the update.'
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('Update error:', err);
  });
}

// IPC: trigger manual update check
ipcMain.handle('check-for-updates', async () => {
  if (!autoUpdater) return { available: false, dev: true };
  try {
    const result = await autoUpdater.checkForUpdates();
    return {
      available: result && result.updateInfo && result.updateInfo.version !== app.getVersion(),
      currentVersion: app.getVersion(),
      latestVersion: result?.updateInfo?.version
    };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// ── IPC: Widget minimise/expand ──────────────────────────────
ipcMain.on('widget-minimise', () => {
  if (widgetWindow) widgetWindow.setSize(320, 48, true);
});

ipcMain.on('widget-expand', () => {
  if (widgetWindow) widgetWindow.setSize(320, 310, true);
});

// Widget asks for a specific height based on whether Coming Up is visible
ipcMain.on('widget-resize', (event, height) => {
  if (widgetWindow && !isMinimised()) {
    const [w] = widgetWindow.getSize();
    widgetWindow.setSize(w, Math.round(height), true);
  }
});

function isMinimised() {
  if (!widgetWindow) return false;
  const [, h] = widgetWindow.getSize();
  return h < 60;
}

// ── IPC: Open main window ────────────────────────────────────
ipcMain.on('open-main', () => {
  if (!mainWindow) createMainWindow();
  else { mainWindow.show(); mainWindow.focus(); }
});

ipcMain.on('reset-widget-position', () => {
  if (!widgetWindow) return;
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
  widgetWindow.setPosition(sw - 340, 40);
  store.set('widgetPosition', { x: sw - 340, y: 40 });
});

// ── IPC: Toggle DevTools ─────────────────────────────────────
ipcMain.on('toggle-devtools-widget', () => {
  if (widgetWindow) widgetWindow.webContents.toggleDevTools({ mode: 'detach' });
});

ipcMain.on('toggle-devtools-main', () => {
  if (mainWindow) mainWindow.webContents.toggleDevTools({ mode: 'detach' });
});

// ── IPC: Notify widget when categories change ────────────────
ipcMain.on('categories-updated', () => {
  if (widgetWindow) widgetWindow.webContents.send('refresh-categories');
});

// ── IPC: Notify widget when theme changes ────────────────────
ipcMain.on('theme-changed', (event, theme) => {
  store.set('theme', theme);
  if (widgetWindow) widgetWindow.webContents.send('theme-changed', theme);
});

// ── IPC: Get saved theme ─────────────────────────────────────
ipcMain.handle('get-theme', () => {
  return store.get('theme', 'teal-dark');
});
