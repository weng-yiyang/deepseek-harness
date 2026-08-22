# DeepSeek Harness 桌面端（dsh-desktop）

把 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（简称 `dsh`）包装成 Windows 桌面应用。
本质是 **Electron 窗口 + 本地 `dsh web` 服务** 的组合：Electron 只负责显示，真正的“脑子”是后台用独立 Node 跑起来的 `dsh web` 服务（监听 `127.0.0.1:3080`），它再去调用 DeepSeek 云端 API。

> ⚠️ 关键认知：这不是把模型塞进本地。对话必须 **联网 + DeepSeek API Key**。桌面端只是“壳”。

---

## 架构

```
Windows 桌面 (.exe)
├─ Electron 主进程
│   ├─ 启动/守护 dsh 服务子进程
│   ├─ 创建浏览器窗口加载 http://127.0.0.1:3080
│   ├─ 系统托盘 / 开机自启 / 自动更新
├─ dsh web 服务（内置 node 子进程，运行 dsh web --no-open，端口 3080）
└─ DeepSeek 云端 API（HTTPS，需 DEEPSEEK_API_KEY）
```

## 目录结构

```
dsh-desktop/
├─ package.json            # 依赖与脚本
├─ electron-builder.yml    # NSIS 安装包 + 便携版 + GitHub 发布
├─ src/
│  └─ main.js              # 主进程：spawn 服务 / 窗口 / 托盘 / 自启 / 更新
├─ scripts/
│  └─ copy-resources.js    # 把 dsh 包 + node 运行时复制进 resources/
├─ resources/              # 由 copy-resources 生成（已 gitignore）
│  ├─ dsh/                 # 官方自包含 npm 包 @deepseek-ai/dsh
│  └─ node/                # 内置 node.exe
└─ build/                  # 放 icon.ico（自行提供）
```

## 前置条件

- **Node.js 22.19+ 或 24+**（仅用于本机安装依赖与运行脚本；打包后的 exe 自带 node）
- Windows 10/11（本工程面向 Windows 桌面端）
- 一个 **DeepSeek API Key**（https://platform.deepseek.com）

## 快速开始（开发模式）

```powershell
cd dsh-desktop
npm install                 # 安装 electron / electron-builder / electron-updater
npm run copy-resources     # 安装 @deepseek-ai/dsh 并复制 node 运行时到 resources/
npm start                  # 启动桌面端（开发模式，未打包）
```

`npm start` 会：拉起 `dsh web --no-open` → 轮询 3080 → 打开窗口。
首次无 Key 时，dsh 自带 Web 界面会弹出“添加 API Key”引导，填入 Key 后即可对话（Key 由 dsh 自行持久化）。

> 想调试 fork 源码？设置环境变量 `DSH_DEV_DIR` 指向你的 `deepseek-harness` 克隆目录，
> `main.js` 会优先用它（以 `node --import tsx/esm apps/cli/src/bin.ts web --no-open` 运行）。

## 打包（安装包 + 便携版）

```powershell
npm run dist            # 同时产出 NSIS 安装包(.exe) 与 便携版(文件夹)
# 或分开：
npm run dist:nsis       # 仅安装包
npm run dist:portable   # 仅便携版
```

产物在 `dist/`：
- `DeepSeek Harness 桌面端-0.1.0-setup.exe`（NSIS 安装包，含开始菜单/桌面快捷方式）
- `DeepSeek Harness 桌面端-0.1.0-portable.exe`（便携版，解压即用）

## 关于 dsh 运行时（官方包 vs fork 源码）

默认用**官方自包含 npm 包 `@deepseek-ai/dsh`**（已验证 `bin = lib/bin.js`），原因是：
- 自包含、无 pnpm 符号链接，打包最稳；
- 与 README 的 `npx @deepseek-ai/dsh web` 同源。

若你的 `deepseek-harness` **fork 有自改**，需要打包你自己的代码，二选一：
1. 把你 fork 的构建产物（`apps/`、`packages/`、`node_modules` 等）放进 `resources/dsh/`，
   并保证存在 `node_modules/@deepseek-ai/dsh/lib/bin.js`（或改 `src/main.js` 的 `dshBin()` 指向你的入口）；
2. 或用 `DSH_DEV_DIR` 在开发期直接跑 fork 源码。

## 关于 API Key

- 由 **dsh 自身** 管理：首次启动的 Web 界面会弹出“添加 API Key”引导，填入后持久化到其凭据文件（如 `~/.dsh/.credentials.yaml`），完全在 dsh 内部完成。
- 桌面端**不**另行存储或注入 Key，保持“壳”的最小职责。若系统环境已设置 `DEEPSEEK_API_KEY`，dsh 也会作为只读凭据继承。

## 开机自启 / 托盘 / 自动更新

- **开机自启**：默认开启（基于 `app.setLoginItemSettings`），如需关闭可在系统“启动”项中移除。
- **托盘**：关闭主窗口只是最小化到托盘，不退出进程；右键托盘可打开/退出。
- **自动更新**：基于 `electron-updater`，默认走 **GitHub Releases**。
  注意：发布端点应指向“桌面端应用”自己的仓库（发布 dsh-desktop 的 exe），
  在 `electron-builder.yml` 的 `publish` 里把 `owner/repo` 改成你自己的仓库。
  内网离线场景：把 `publish` 整段删掉，或在 `main.js` 里注释 `setupUpdater()`。

## 图标

放置一个 `build/icon.ico`（建议 256x256）即可拥有正式图标与托盘图标。
未提供时托盘会用 1x1 透明兜底（功能正常，仅图标不可见）。

## 实测验证（构建环境已跑通）

以下是在本机（Windows / Node 22.22.2）实际执行验证的结果，**不是纸上谈兵**：

| 验证项 | 结果 |
|---|---|
| 官方包 `@deepseek-ai/dsh@0.1.1-rc.2` 安装 | ✅ 成功（`bin = lib/bin.js`） |
| `node .../lib/bin.js web --no-open` 启动 | ✅ 成功启动 web 服务 |
| `curl http://127.0.0.1:3080/` | ✅ 返回 **HTTP 200**（Web 界面可加载） |
| 联网 + DeepSeek 链路 | ✅ 服务主动向 DeepSeek API（`183.204.78.251:443`）发起连接，证明网络与凭据链路打通 |
| Key 读取方式 | ✅ 确认为环境变量 `DEEPSEEK_API_KEY`；包内 `dsh-credentials-local` 文档写明「启动环境优先」，即我们 spawn 时注入的 env 会被作为只读凭据继承 |

> ⚠️ 实测发现：dsh 默认宿主会绑定到 **LAN IP**（如 `192.168.x.x:3080`）而非 `127.0.0.1`，会把 UI 暴露到局域网。
> 因此 `src/main.js` 已强制 `--host 127.0.0.1 --port 3080`，桌面端只在本机回环监听，安全。

## 已知限制

- 体积较大：Electron + dsh 依赖 + 内置 node，安装包约数百 MB。
- `deepseek-harness` 处于 developer preview，版本可能破坏性变更；`copy-resources.js` 里已锁定 `0.1.1-rc.2`，升级时改此处版本号并回归测试。
- 自动更新只升“桌面端壳”，不会自动升 dsh 代码；要跟进新 dsh 版本需重新 `npm run dist`。
