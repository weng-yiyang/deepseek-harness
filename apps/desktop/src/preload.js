import { contextBridge } from 'electron';

// 极小的桥接面：只暴露只读元信息，不暴露任何 Node/Electron 能力。
// 版本号由主进程通过 additionalArguments 注入（见 main.js createWindow）。
function parseVersion() {
  const arg = process.argv.find((a) => a.startsWith('--dsh-desktop-version='));
  return arg ? arg.slice('--dsh-desktop-version='.length) : 'dev';
}

contextBridge.exposeInMainWorld('dshDesktop', {
  platform: process.platform,
  version: parseVersion(),
});
