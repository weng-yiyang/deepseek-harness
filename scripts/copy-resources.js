'use strict';

// 把 dsh 运行时（官方自包含 npm 包）和独立 node 运行时复制进 resources/，
// 供 electron-builder 打进安装包。用 `node scripts/copy-resources.js` 运行，
// 此时 process.execPath 就是 node 本体，可直接拷作内置 node。
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DSH_VERSION = '0.1.1-rc.2';
const root = path.resolve(__dirname, '..');
const resDsh = path.join(root, 'resources', 'dsh');
const resNode = path.join(root, 'resources', 'node');

fs.mkdirSync(path.join(resDsh, 'node_modules'), { recursive: true });
fs.mkdirSync(resNode, { recursive: true });

// 写一个最小 package.json，保证 --prefix 安装行为稳定
fs.writeFileSync(
  path.join(resDsh, 'package.json'),
  JSON.stringify({ name: 'dsh-runtime', private: true, version: '0.0.0' }, null, 2)
);

console.log('[copy-resources] 安装 @deepseek-ai/dsh@' + DSH_VERSION + ' ...');
const dshBinTarget = path.join(resDsh, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
if (fs.existsSync(dshBinTarget)) {
  // 幂等守卫：已存在则跳过慢安装（升级版本时删掉 resources/dsh/node_modules 再跑）
  console.log('[copy-resources] 检测到已存在的 dsh 运行时，跳过 npm install（升级版本请先删除 resources/dsh/node_modules）。');
} else {
  execSync(
    `npm install @deepseek-ai/dsh@${DSH_VERSION} --no-audit --no-fund --ignore-scripts --prefix "${resDsh}"`,
    { stdio: 'inherit' }
  );
}

const nodeBin = process.execPath; // 由 `node` 运行时调用时为 node 本体
const nodeDest = path.join(resNode, process.platform === 'win32' ? 'node.exe' : 'node');
if (fs.existsSync(nodeDest)) {
  console.log('[copy-resources] 已存在 node 运行时，跳过复制：' + nodeDest);
} else if (fs.existsSync(nodeBin)) {
  fs.copyFileSync(nodeBin, nodeDest);
  console.log('[copy-resources] 已复制 node 运行时 -> ' + nodeDest);
} else {
  console.warn('[copy-resources] 未找到 node 本体，请手动放置 resources/node/node.exe');
}

console.log('[copy-resources] 完成。');
