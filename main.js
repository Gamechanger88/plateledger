const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow;
let serverProcess;
let isCreatingWindow = false; // Guard against multiple concurrent createWindow calls

// Port must match the Next.js dev server port in package.json ("dev": "next dev -p 9002")
const DEV_PORT = 9002;
const PROD_PORT = 8080;

function createWindow() {
  if (isCreatingWindow) return; // Prevent runaway window creation
  isCreatingWindow = true;

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: false,
    }
  });
  
  // If in production (packaged), start the standalone server
  if (app.isPackaged) {
    const serverPath = path.join(process.resourcesPath, 'server.js');
    serverProcess = spawn(process.execPath, [serverPath], {
      env: {
        ...process.env,
        PORT: PROD_PORT,
        NODE_ENV: 'production'
      }
    });
    
    // Wait for server to be ready
    const checkServer = setInterval(() => {
      http.get(`http://localhost:${PROD_PORT}`, (res) => {
        if (res.statusCode === 200) {
          clearInterval(checkServer);
          mainWindow.loadURL(`http://localhost:${PROD_PORT}`);
        }
      }).on('error', () => {});
    }, 500);
  } else {
    // Development mode: connect to the running Next.js dev server (npm run dev)
    mainWindow.loadURL(`http://localhost:${DEV_PORT}`);
  }

  mainWindow.on('closed', function () {
    mainWindow = null;
    isCreatingWindow = false;
  });

  isCreatingWindow = false;
}

app.whenReady().then(createWindow);

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});

app.on('activate', function () {
  // Only create a new window if none exists and we're not already creating one
  if (mainWindow === null && !isCreatingWindow) createWindow();
});
