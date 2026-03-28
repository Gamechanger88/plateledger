const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');

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
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
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

// ESC/POS cash drawer pulse: ESC p 0 25 250
ipcMain.handle('open-cash-drawer', async () => {
  const drawerCmd = Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA]);
  const tmpPath = path.join(os.tmpdir(), `drawer_${Date.now()}.bin`);

  return new Promise((resolve) => {
    fs.writeFile(tmpPath, drawerCmd, (writeErr) => {
      if (writeErr) {
        resolve({ success: false, error: writeErr.message });
        return;
      }

      // macOS/Linux: lpr -l sends raw bytes to the default printer
      // Windows: copy /b to the printer port
      const cmd = process.platform === 'win32'
        ? `copy /b "${tmpPath}" LPT1`
        : `lpr -l "${tmpPath}"`;

      exec(cmd, (execErr) => {
        fs.unlink(tmpPath, () => {});
        resolve({ success: !execErr, error: execErr?.message });
      });
    });
  });
});
