const { app, BrowserWindow } = require('electron');

function createWindow() {
  // Create the browser window
  const win = new BrowserWindow({
    width: 800,
    height: 700,
    icon: __dirname + '/assets/icon.ico',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Load the app from your local server
  win.loadFile('loading.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
