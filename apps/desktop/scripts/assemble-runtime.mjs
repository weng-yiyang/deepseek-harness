// 打包前置步骤：用 `pnpm deploy` 把真正的运行时依赖物化到 dist/runtime，
// 让 electron-builder 作为 extraResources 随包发布，使打包后的 exe 能真正拉起后端。
//
// 为什么不能只 deploy 壳（@deepseek-ai/dsh-desktop）：
//   pnpm deploy 把"被部署的包本身"放在目标根目录（package.json + lib/），
//   它的依赖闭包放在 node_modules/。在 --legacy 模式下 workspace:* 依赖不会被物化，
//   于是 node_modules/@deepseek-ai/* 几乎为空，打包出的 app 找不到
//   runtime/node_modules/@deepseek-ai/dsh/lib/bin.js，主进程 spawn 后端失败 ->
//   30s 超时 -> app 静默退出（表现为"点了没窗口"）。
//
// 正确做法（经本机实测验证）：
//   1. 直接把真正的后端包 @deepseek-ai/dsh deploy 到最终嵌套位置
//      runtime/node_modules/@deepseek-ai/dsh。pnpm 把包自身（lib/、config/、
//      package.json）放在该目录根，依赖闭包放在该目录内的 node_modules/，
//      正好满足 require('@deepseek-ai/dsh')（由 electron main.js 以绝对路径
//      spawn lib/bin.js）及其内部依赖（cordis 等）的解析。
//   2. 必须"直接 deploy 到最终位置"，不能 deploy 到临时目录再搬运：
//      pnpm deploy 产物含 .pnpm 软链（cordis↔cordis-plugin 循环），
//      - cpSync({dereference:true}) 会因循环软链抛错；
//      - mv 会保留指向旧路径的"绝对"软链、导致 dangling（require 失败）。
//      只有 pnpm 现场生成的软链指向正确的最终位置（dshDest/node_modules/.pnpm）。
//   3. 前端由 @deepseek-ai/dsh-web-frontend 的 dist 提供（dsh-web-app 用
//      require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html') 定位）。
//      apps/web 这个包 `pnpm deploy` 会报 For help 失败，因此直接把已构建的
//      apps/web（dist + package.json）拷进 runtime，正是 require.resolve 所需。
//
// pnpm 11 deploy 关键约束（踩坑所得）：
//   - 必须 --filter 选中包，否则 ERR_PNPM_NOTHING_TO_DEPLOY。
//   - 仓库未开 inject-workspace-packages，必须 --legacy，否则 NOTHING_TO_DEPLOY。
//   - 目标目录相对 workspace 根解析，故用绝对路径避免歧义。
import { rmSync, existsSync, mkdirSync, cpSync, copyFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.join(__dirname, '..'); // apps/desktop
const repoRoot = path.join(pkgDir, '..', '..'); // deepseek-harness
const outDir = path.join(pkgDir, 'dist', 'runtime'); // 绝对路径，避免相对解析歧义
const dshDest = path.join(outDir, 'node_modules', '@deepseek-ai', 'dsh');
const webDest = path.join(outDir, 'node_modules', '@deepseek-ai', 'dsh-web-frontend');

// 前端包：apps/web 的 `pnpm deploy` 会报 For help 失败，直接拷贝已构建产物。
// apps/web/dist 是 vite 构建的纯文件（无循环软链），cpSync 安全；require.resolve
// 只依赖 package.json 的 exports('./dist/*') 与 dist 真实文件，不需要其 devDependencies。
function copyWebFrontend() {
  mkdirSync(webDest, { recursive: true });
  cpSync(path.join(repoRoot, 'apps', 'web', 'dist'), path.join(webDest, 'dist'), {
    recursive: true,
    dereference: true,
  });
  copyFileSync(path.join(repoRoot, 'apps', 'web', 'package.json'), path.join(webDest, 'package.json'));
  console.log('[assemble] web-frontend ->', webDest);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
// 确保 dshDest 的父目录存在，避免 pnpm deploy 因中间目录缺失而报错。
mkdirSync(path.dirname(dshDest), { recursive: true });

// 关键：直接 deploy 真正的后端包到最终嵌套位置。pnpm 现场生成的 .pnpm 软链指向
// dshDest/node_modules/.pnpm，解析正确；无需我们 cpSync/mv（都会破坏软链）。
console.log('[assemble] pnpm deploy @deepseek-ai/dsh ->', dshDest);
execSync(`pnpm --filter @deepseek-ai/dsh --legacy --prod deploy "${dshDest}"`, {
  cwd: repoRoot,
  stdio: 'inherit',
});

copyWebFrontend();

// 部署后自检：main.js 依赖的两个入口文件必须存在，否则打包出的 app 会跑不起来。
const cliBin = path.join(dshDest, 'lib', 'bin.js');
const webIndex = path.join(webDest, 'dist', 'index.html');
const missing = [cliBin, webIndex].filter((f) => !existsSync(f));
if (missing.length) {
  console.error('[assemble] 部署产物缺失关键文件：\n' + missing.join('\n'));
  process.exit(1);
}
console.log('[assemble] runtime assembled and verified at', outDir);
