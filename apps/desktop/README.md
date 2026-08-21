# DeepSeek Harness 桌面客户端（`apps/desktop`）

把现有 `dsh web`（Node 后端 + Vite 前端）封装为跨平台桌面应用，**业务逻辑零改动**。

## 架构
Electron 主进程只做三件事：
1. 以子进程拉起 `node --expose-internals apps/cli/lib/bin.js web`（固定/随机空闲端口）；
2. `BrowserWindow` 加载 `http://127.0.0.1:<port>`；
3. 管理窗口生命周期、单实例锁、退出时回收子进程。

前端仍走同源（服务端同时提供页面与 API），无 CORS 改动。

## 目录
- `src/main.js` — Electron 主进程（启动/拉起/窗口/单实例/更新）
- `src/preload.js` — 渲染进程桥接（最小）
- `scripts/assemble-runtime.mjs` — 打包前置：归集运行时到 `dist/runtime`
- `electron-builder.yml` — 安装包配置
- `docs/` — 安装运行与签名方案文档
  - [`docs/本地安装运行手册.md`](docs/本地安装运行手册.md)
  - [`docs/个人自用免签名运行方案.md`](docs/个人自用免签名运行方案.md)
  - [`docs/跨平台安装包方案.md`](docs/跨平台安装包方案.md)

> 本包已通过 `pnpm-workspace.yaml` 的 `apps/*` 自动纳入 workspace，无需改根配置。

## 开发调试
两种模式，均从仓库根安装依赖后用 Electron 启动：
```bash
pnpm install
```

### 模式 A：直接加载生产构建（无 HMR）
```bash
pnpm --filter @deepseek-ai/dsh-web-frontend run build   # 先构建前端
pnpm --filter @deepseek-ai/dsh-desktop run dev           # 加载 dsh web 同端口页面
```
`main.js` 直接用仓库根的 `apps/cli/lib/bin.js` 与 `node_modules`，沿用已验证的启动方式。

### 模式 B：前端热更新（Vite HMR）
前端由 Vite dev server 提供（带 HMR），后端 API 仍由 dsh web 子进程提供。
开发热更新模式下后端固定在 `3080`，所以先给 `apps/web/vite.config.*` 加 proxy 把 API 转到该端口：
```ts
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      // 按 dsh web 实际 API 前缀调整（示例）
      '/api': 'http://127.0.0.1:3080',
      '/ws':  { target: 'http://127.0.0.1:3080', ws: true },
    },
  },
});
```
然后三步走：
```bash
# 1) 另开终端起 Vite dev server
pnpm --filter @deepseek-ai/dsh-web-frontend run dev

# 2) 让桌面端指向 dev server 启动 Electron
#    Windows (PowerShell)
$env:DSH_DESKTOP_DEV_SERVER="http://localhost:5173"; pnpm --filter @deepseek-ai/dsh-desktop run dev
#    macOS / Linux
DSH_DESKTOP_DEV_SERVER=http://localhost:5173 pnpm --filter @deepseek-ai/dsh-desktop run dev
```
`main.js` 检测到 `DSH_DESKTOP_DEV_SERVER` 后会加载该地址并自动打开 DevTools；改 Vite 代码即实时热更新。

## 生产打包
```bash
pnpm --filter @deepseek-ai/dsh-web-frontend run build   # 先构建前端
pnpm --filter @deepseek-ai/dsh-desktop run dist:win      # 或 dist:mac / dist:linux / dist
```
`dist` 会先跑 `assemble-runtime` 把 `node_modules`（解引用）+ `apps/web/dist` 归集到 `dist/runtime`，
再交给 electron-builder 产出安装包到 `release/`。

## 发布注意
- **Windows**：`--expose-internals` 必带（HMR 要求）；`DSH_RUNTIME_MODE=node` 必带（无原生二进制）。
  生产建议 `sign: true` + CI 代码签名证书，否则 SmartScreen 会拦截。
- **macOS**：需 Apple 开发者签名 + 公证（notarize），否则 Gatekeeper 拦截；`hardenedRuntime: true` 已开。
- **Linux**：AppImage / deb 即可，注意 `.desktop` 分类。
- **Node 版本**：被拉起的 `dsh web` 需 Node `^22.19.0 || >=24.0.0`。
  开发用 PATH 上的 node；生产在 `node-bin/` 内置一份 Node>=22.19 并启用 `electron-builder.yml` 中对应的 extraResources。
- **包体优化**：`assemble-runtime` 当前整份复制 `node_modules`，较大。
  推荐改用 `pnpm deploy --filter @deepseek-ai/dsh --prod` 生成仅生产依赖的 `node_modules` 以显著瘦身。
- **数据目录**：profile 通过 `DSH_HOME` 隔离到应用 `userData/dsh-home`，与命令行版 `~/.dsh` 互不干扰。
- **自动更新**：默认关闭（`--no-updater`）。开启需设环境变量 `DSH_UPDATE_URL` 指向托管
  `latest.yml` + 安装包的静态地址（GitHub Releases 或内网均可）。

## CI 自动构建与代码签名
`.github/workflows/build-desktop.yml` 提供三平台矩阵（windows / macos / ubuntu），
在 push tag（`v*`）或手动 `workflow_dispatch` 时自动构建、签名、上传产物；
推 tag 时额外发到 GitHub Release。

### 仓库 Secrets（按需配置）
| Secret | 用途 | 平台 |
|---|---|---|
| `WIN_CSC_LINK` | 含私钥的 p12 证书 base64 | Windows |
| `WIN_CSC_KEY_PASSWORD` | 证书密码 | Windows |
| `MAC_CSC_LINK` | 含私钥的 p12 证书 base64 | macOS |
| `MAC_CSC_KEY_PASSWORD` | 证书密码 | macOS |
| `APPLE_ID` | Apple 开发者账号邮箱 | macOS |
| `APPLE_APP_SPECIFIC_PASSWORD` | App 专用密码 | macOS |
| `APPLE_TEAM_ID` | 团队 ID | macOS |

### 构建 / 签名开关
- **Windows**：配置 `WIN_CSC_LINK` 后 CI 自动用 `electron-builder --win --config.win.sign=true` 签名；未配置则出未签名包。
- **macOS**：配置 `MAC_CSC_LINK` + Apple ID 系列后 CI 用 `electron-builder --mac --config.mac.notarize=true` 完成签名并公证；未配置则出未签名包。
- **Linux**：AppImage / deb，无需签名。
- 未配置 Secrets 时对应平台跳过签名，仍可构建出自测包。

### 注意
- CI 安装依赖设置 `npm_config_node_linker=hoisted`，复现本机 Windows 上的 junction 方案，规避 symlink 权限 / 空目录问题。
- 后端构建走根脚本 `pnpm run build:lib` + `pnpm --filter @deepseek-ai/dsh-web-frontend run build`，再 `assemble-runtime`，最后 `dist:<平台>`。
- Node 版本固定 `22.x`（满足 `^22.19.0`）。
- 产物先上传到 Actions Artifact；推 tag 时额外发到 GitHub Release（`softprops/action-gh-release`）。

## 已知约束
- `files` 仅含 `src` 与 `package.json`；harness 运行时通过 `extraResources` 的 `dist/runtime` 随包发布。
- 部分包 `exports` 指向 `./src/*`（如类型/补丁 yml），纯 `lib` 复制可能缺失；如运行报错，扩展
  `assemble-runtime.mjs` 的复制范围或采用 `pnpm deploy`。
