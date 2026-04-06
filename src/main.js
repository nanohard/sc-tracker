const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { initPromise } = require('./database');
const sync = require('./sync');
const mining = require('./mining');
require('./inventory');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false, // Required for nodeIntegration in modern Electron
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../index.html'));
  
  sync.setMainWindow(mainWindow);
  mining.setMainWindow(mainWindow);
}

app.whenReady().then(async () => {
  await initPromise;
  await sync.initSync();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle('show-confirm-dialog', async (event, message) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Yes', 'No'],
    defaultId: 1,
    title: 'Confirm',
    message: message,
  });
  return result.response === 0;
});

ipcMain.handle('show-alert-dialog', async (event, message) => {
  await dialog.showMessageBox(mainWindow, {
    type: 'info',
    buttons: ['OK'],
    title: 'Alert',
    message: message,
  });
});

ipcMain.handle('save-csv', async (event, csvContent) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export to CSV',
    defaultPath: path.join(app.getPath('documents'), 'ore_yields.csv'),
    filters: [{ name: 'CSV Files', extensions: ['csv'] }]
  });

  if (filePath) {
    fs.writeFileSync(filePath, csvContent);
    return true;
  }
  return false;
});
