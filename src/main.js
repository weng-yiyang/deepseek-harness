'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');

// 隔离用户数据目录：旧版(同 appId com.wyy.dsh-desktop)会占用 Roaming\dsh-desktop 与 3080 端口，
// 这里把当前实例的用户数据改到独立目录，彻底避开与旧版共用单实例锁/用户数据的冲突。
try { app.setPath('userData', path.join(app.getPath('appData'), 'dsh-desktop-local')); } catch (e) {}

let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch (e) {
  log('[updater] electron-updater 未安装或不可用（不影响启动）');
}

// ===== 文件日志：写到隔离后的 userData 目录（dsh-desktop-local/），确定可写且调试环境能读到 =====
function pickLogPath() {
  let base = path.dirname(process.execPath);
  try { base = app.getPath('userData'); } catch (e) {}
  const cands = [
    path.join(base, 'dsh-desktop-runtime.log'),
    path.join(path.dirname(process.execPath), 'dsh-desktop-runtime.log'),
  ];
  for (const c of cands) {
    try { fs.writeFileSync(c, ''); return c; } catch {}
  }
  return cands[cands.length - 1];
}
const LOG_PATH = pickLogPath();
try { fs.writeFileSync(LOG_PATH, ''); } catch {}
function log(...args) {
  const msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 2))).join(' ');
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(LOG_PATH, line); } catch {}
  console.log(msg);
}
log('[boot] 日志文件:', LOG_PATH);
log('[boot] isPackaged =', app.isPackaged, '| execPath =', process.execPath);
log('[boot] resourcesPath =', process.resourcesPath);

process.on('uncaughtException', (e) => log('[FATAL uncaughtException]', (e && e.stack) || e));
process.on('unhandledRejection', (e) => log('[FATAL unhandledRejection]', (e && e.stack) || e));

const PORT = 3080;
const HOST = '127.0.0.1';
const isDev = !app.isPackaged;

let serverProcess = null;
let mainWindow = null;
let tray = null;
let quitting = false;

// 资源目录：
//   开发期 -> 工程根/resources
//   打包后 -> process.resourcesPath/resources
//   （extraResources 配置为 from: resources to: resources，故多一层 resources）
function resourcesDir() {
  if (isDev) return path.resolve(__dirname, '..', 'resources');
  return path.join(process.resourcesPath, 'resources');
}

// dsh 目录：优先用官方自包含包；找不到时回退到 fork 源码（开发期）
function dshDir() {
  const official = path.join(resourcesDir(), 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  if (fs.existsSync(official)) return path.join(resourcesDir(), 'dsh');
  return process.env.DSH_DEV_DIR || path.resolve(__dirname, '..', '..', 'deepseek-harness');
}

// 运行 dsh 服务的 node：打包后用内置 node.exe，开发期用 PATH 里的 node
function nodeBin() {
  if (isDev) return 'node';
  return path.join(resourcesDir(), 'node', process.platform === 'win32' ? 'node.exe' : 'node');
}

// dsh 入口：官方包是 lib/bin.js（纯 JS）；fork 源码是 apps/cli/src/bin.ts（需 tsx）
function dshBin() {
  const dir = dshDir();
  const official = path.join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  if (fs.existsSync(official)) return official;
  return path.join(dir, 'apps', 'cli', 'src', 'bin.ts');
}

function startServer() {
  const bin = dshBin();
  const node = nodeBin();
  const args = [];
  if (bin.endsWith('.ts')) args.push('--import', 'tsx/esm');
  // 强制绑定 127.0.0.1：默认宿主会绑到 LAN IP，会把 UI 暴露到局域网
  args.push(bin, 'web', '--no-open', '--host', HOST, '--port', String(PORT));

  log('[dsh] nodeBin      :', node, '| exists:', fs.existsSync(node));
  log('[dsh] bin          :', bin, '| exists:', fs.existsSync(bin));
  log('[dsh] cwd          :', dshDir());
  log('[dsh] spawn args   :', [node, ...args].join(' '));

  if (!fs.existsSync(node)) { log('[dsh] ⚠️ node 运行时缺失，无法启动服务'); return; }
  if (!fs.existsSync(bin)) { log('[dsh] ⚠️ dsh 入口缺失，无法启动服务'); return; }

  serverProcess = spawn(node, args, {
    cwd: dshDir(),
    // 继承父进程环境（如系统级 DEEPSEEK_API_KEY 仍可被 dsh 读取）；
    // DeepSeek Key 由 dsh 自身 Web 引导页管理并持久化，桌面端不再另行注入/存储
    env: { ...process.env },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProcess.stdout?.on('data', (d) => log('[dsh] ' + d.toString().trim()));
  serverProcess.stderr?.on('data', (d) => log('[dsh-err] ' + d.toString().trim()));
  serverProcess.on('error', (e) => log('[dsh] spawn error:', e.message));
  serverProcess.on('exit', (code, sig) => {
    if (!quitting) log('[dsh] 服务进程异常退出 code=', code, 'sig=', sig);
  });
  log('[dsh] spawn 已提交');
}

function stopServer() {
  if (serverProcess) {
    try { serverProcess.kill(); } catch {}
    serverProcess = null;
  }
}

// 轮询本地服务直到就绪（最多约 36s）
function waitForServer(retries = 120, delay = 300) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const req = http.get(`http://${HOST}:${PORT}/`, (res) => { res.destroy(); resolve(true); });
      req.on('error', () => { if (n <= 0) return reject(new Error('server timeout')); setTimeout(() => attempt(n - 1), delay); });
      req.setTimeout(1500, () => { req.destroy(); if (n <= 0) return reject(new Error('server timeout')); else setTimeout(() => attempt(n - 1), delay); });
    };
    attempt(retries);
  });
}

function showFallbackPage(html) {
  if (!mainWindow) return;
  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    .catch((e) => log('[window] fallback 页失败:', e.message));
}

function createWindow() {
  log('[window] createWindow() 调用');
  mainWindow = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.once('ready-to-show', () => { log('[window] ready-to-show -> show()'); mainWindow.show(); mainWindow.focus(); });
  mainWindow.once('did-fail-load', (e, code, desc) => log('[window] did-fail-load code=', code, 'desc=', desc));
  mainWindow.on('page-title-updated', () => log('[window] page-title-updated'));
  mainWindow.setMenuBarVisibility(false);

  // 先显示启动占位页，保证窗口立即可见（避免用户误以为"没窗口"）
  showFallbackPage(
    '<!doctype html><meta charset="utf-8">' +
    '<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;' +
    'font-family:sans-serif;background:#0f172a;color:#94a3b8">正在启动 DeepSeek Harness 本地服务…</body>'
  );
  log('[window] 已加载启动占位页');

  mainWindow.on('close', (e) => { if (!quitting) { e.preventDefault(); mainWindow.hide(); } });
  return mainWindow;
}

// 1x1 透明 PNG，仅在没有 icon.ico 时兜底，避免托盘创建崩溃
const FALLBACK_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC';

// 定位托盘图标：打包后走 resources/build/icon.ico，开发期走 build/icon.ico
// （extraResources: from build to build -> process.resourcesPath/build/icon.ico）
function trayIconPath() {
  const candidates = [
    path.join(process.resourcesPath, 'build', 'icon.ico'),
    path.join(__dirname, '..', 'build', 'icon.ico'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function createTray() {
  try {
    const p = trayIconPath();
    const icon = p ? nativeImage.createFromPath(p) : nativeImage.createFromDataURL(FALLBACK_ICON);
    if (p) log('[tray] 图标:', p);
    else log('[tray] 未找到 icon.ico，使用透明兜底');
    tray = new Tray(icon);
    const ctx = Menu.buildFromTemplate([
      { label: '打开主界面', click: () => mainWindow?.show() },
      { type: 'separator' },
      { label: '退出', click: () => { quitting = true; app.quit(); } },
    ]);
    tray.setToolTip('DeepSeek Harness 桌面端');
    tray.setContextMenu(ctx);
    tray.on('click', () => mainWindow?.show());
    log('[tray] 创建成功');
  } catch (e) {
    log('[tray] 创建失败：', e.message);
  }
}

function setupUpdater() {
  if (!autoUpdater) { log('[updater] 跳过（模块不可用）'); return; }
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.on('update-available', () => mainWindow?.webContents.send('updater', { type: 'available' }));
    autoUpdater.on('update-downloaded', () => mainWindow?.webContents.send('updater', { type: 'downloaded' }));
    autoUpdater.on('error', () => {});
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    log('[updater] 初始化完成');
  } catch (e) {
    log('[updater] 初始化失败（可忽略）：', e.message);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  log('[lock] 已有实例在运行，本实例退出（把已有实例前置）');
  app.quit();
} else {
  app.on('second-instance', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });

  // 提前启动 dsh 本地服务，与 Electron 自身初始化并行，缩短用户等待
  try { startServer(); } catch (e) { log('[dsh] 预启动失败：', e.message); }

  app.whenReady().then(async () => {
    log('[boot] app ready');
    // 先建窗口并显示占位页，确保用户能立刻看到窗口
    createWindow();
    createTray();
    try { setupUpdater(); } catch (e) { log('[updater] err', e.message); }
    // 开机自启：当前默认关闭，避免把临时目录(Temp)里的 exe 路径注册成自启项导致越攒越多实例。
    // 待用户在稳定安装位置(如安装版或固定便携目录)跑通后，可改为 true 重新启用。
    app.setLoginItemSettings({ openAtLogin: false, path: process.execPath, args: [] });

    try {
      await waitForServer();
      log('[boot] dsh 服务就绪 (' + PORT + ')，加载 UI');
      mainWindow.loadURL(`http://${HOST}:${PORT}/`).catch((e) => log('[window] loadURL error', e.message));
    } catch (e) {
      log('[boot] dsh 服务未启动（超时）：', e.message);
      showFallbackPage(
        '<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:24px;' +
        'background:#0f172a;color:#e2e8f0"><h2>DeepSeek Harness 桌面端</h2>' +
        '<p>本地服务未能在 36 秒内启动。</p>' +
        '<p>请检查：① 是否已经退出旧实例（任务管理器结束同名进程）；② dist 目录下的 resources 是否完整；' +
        '③ 查看同目录的 <code>dsh-desktop-runtime.log</code>。</p></body>'
      );
    }
    log('[boot] 初始化完成');
  }).catch((e) => log('[boot] whenReady 失败：', (e && e.stack) || e));
}

app.on('window-all-closed', () => { log('[boot] window-all-closed'); });
app.on('activate', () => { if (mainWindow) mainWindow.show(); });
app.on('before-quit', () => { quitting = true; stopServer(); });
