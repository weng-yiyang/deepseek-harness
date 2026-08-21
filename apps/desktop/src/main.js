import { app, BrowserWindow, shell } from 'electron';
import { spawn, execFile } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isPackaged = app.isPackaged;

// --- Dev hot reload ----------------------------------------------------------
// When DSH_DESKTOP_DEV_SERVER (e.g. http://localhost:5173) is set, the
// BrowserWindow loads the Vite dev server (with HMR) while `dsh web` is still
// spawned as the backend API. Vite must proxy API requests to the backend port
// (see README "Development").
const DEV_SERVER_URL = process.env.DSH_DESKTOP_DEV_SERVER;
// Fixed port in dev-hot-reload mode so the Vite proxy can target a known host.
const DEV_SERVER_PORT = 3080;

// --- Runtime layout ----------------------------------------------------------
// Dev: repo root (two levels up from apps/desktop).
// Packaged: build output lives in process.resourcesPath/runtime.
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const runtimeDir = isPackaged
  ? path.join(process.resourcesPath, 'runtime')
  : repoRoot;

// CLI entry (the `dsh web` bin).
// Dev: points at the source build output; packaged: points at the shipped
// node_modules/@deepseek-ai/dsh.
const cliBin = isPackaged
  ? path.join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  : path.join(repoRoot, 'apps', 'cli', 'lib', 'bin.js');

// --- Profile isolation -------------------------------------------------------
// Put the profile in an app-specific dir so it never clashes with the CLI's ~/.dsh.
const dshHome = path.join(app.getPath('userData'), 'dsh-home');
fs.mkdirSync(dshHome, { recursive: true });

// --- Pick the node binary for the spawned harness ----------------------------
// Production: bundled Node >=22.19 (runtime/node); dev: node from PATH.
function resolveNodeBin() {
  const bundled = path.join(
    runtimeDir,
    'node',
    process.platform === 'win32' ? 'node.exe' : 'node',
  );
  return fs.existsSync(bundled) ? bundled : 'node';
}

// --- Free port ---------------------------------------------------------------
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitForPort(port, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const s = net.connect(port, '127.0.0.1');
      s.on('connect', () => { s.destroy(); resolve(); });
      s.on('error', () => {
        s.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error('server start timeout'));
        else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

// --- Single instance ---------------------------------------------------------
if (!app.requestSingleInstanceLock()) app.quit();

let serverProcess = null;
let mainWindow = null;
let serverPort = null;

async function startServer() {
  // Fixed port in dev-hot-reload mode so the Vite dev server proxy can target it.
  serverPort = DEV_SERVER_URL ? DEV_SERVER_PORT : await getFreePort();
  const env = {
    ...process.env,
    DSH_RUNTIME_MODE: 'node',
    DSH_WEB_HOST: '127.0.0.1',
    DSH_WEB_PORT: String(serverPort),
    DSH_HOME: dshHome,
  };
  // Windows has no native dsh binary, and the HMR plugin requires
  // --expose-internals. detached: true puts the child in its own process group
  // so cleanupAndQuit can reap the whole tree.
  serverProcess = spawn(resolveNodeBin(), ['--expose-internals', cliBin, 'web'], {
    cwd: runtimeDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: true,
  });
  serverProcess.stdout?.on('data', (d) => process.stdout.write(`[dsh] ${d}`));
  serverProcess.stderr?.on('data', (d) => process.stderr.write(`[dsh] ${d}`));
  serverProcess.on('exit', (code) => {
    if (code) console.error(`[dsh] exited with code ${code}`);
  });
  await waitForPort(serverPort);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Inject the app version into the renderer. An env var set on the child
      // process is not reachable from preload; additionalArguments is the
      // standard channel and exposes no Node capability.
      additionalArguments: [`--dsh-desktop-version=${app.getVersion()}`],
    },
  });
  // Dev hot reload: load the Vite dev server; otherwise load the dsh web page
  // from the same port (same origin).
  const target = DEV_SERVER_URL || `http://127.0.0.1:${serverPort}`;
  mainWindow.loadURL(target);
  if (DEV_SERVER_URL) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
  mainWindow.once('ready-to-show', () => mainWindow.show());
  // Open external links in the system browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// --- Auto update (opt-in) ----------------------------------------------------
function setupUpdater() {
  if (process.argv.includes('--no-updater')) return;
  const updateUrl = process.env.DSH_UPDATE_URL;
  if (!updateUrl) return;
  import(path.join(runtimeDir, 'node_modules', 'electron-updater'))
    .then(({ autoUpdater }) => {
      autoUpdater.setFeedURL({ provider: 'generic', url: updateUrl });
      autoUpdater.checkForUpdatesAndNotify().catch((e) => console.error('updater', e));
    })
    .catch((e) => console.error('updater import', e));
}

function cleanupAndQuit() {
  if (!serverProcess || serverProcess.killed) return;
  const proc = serverProcess;
  serverProcess = null;
  const { pid } = proc;
  try {
    if (process.platform === 'win32') {
      // Windows has no signal semantics: SIGTERM is ignored and only kills the
      // shell, not the node child tree. Use taskkill /T /F to reap the whole
      // tree so `dsh web` never lingers holding the port/memory.
      // Note: /F targets leaf processes; taskkill errors when the tree root is
      // already gone, which is expected.
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {});
    } else {
      // POSIX: the detached child is its own process group; a negative pid
      // signals the whole group with SIGTERM.
      try { process.kill(-pid, 'SIGTERM'); } catch {}
    }
  } catch {}
  // Fallback: if the tree was not reaped, SIGKILL the root after 5s so nothing
  // lingers indefinitely.
  const fallback = setTimeout(() => {
    try { proc.kill('SIGKILL'); } catch {}
  }, 5000);
  fallback.unref();
}

app.whenReady().then(async () => {
  try {
    await startServer();
    createWindow();
    setupUpdater();
  } catch (e) {
    console.error('failed to start harness server:', e);
    app.quit();
  }
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') cleanupAndQuit();
});
app.on('before-quit', cleanupAndQuit);
