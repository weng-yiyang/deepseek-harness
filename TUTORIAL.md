# 手把手教程：在你自己的 Windows 上跑起来

> 目标：把 `dsh-desktop` 从源码跑成桌面应用，并最终打出安装包 + 便携版。
> 工程目录：`D:\Desktop\WorkBuddy\2026-08-22-20-25-56\dsh-desktop`
> （下面的命令默认你已 `cd` 进这个目录。）

---

## 第 0 步：准备环境（只需确认一次）

1. **Node.js 22.19+ 或 24+**
   打开 PowerShell / 终端，执行：
   ```powershell
   node --version
   ```
   期望看到 `v22.19.x` 或 `v24.x`。你本机是 `v22.22.2`，满足。

2. **一个 DeepSeek API Key**
   去 https://platform.deepseek.com 注册并创建 Key（形如 `sk-xxxx`）。
   > 没有 Key 也能启动界面，但**发消息会报错**——对话必须联网 + Key。

3. **Git**（打包用不到，但克隆/跟进源码会用到）：`git --version`。

---

## 第 1 步：安装桌面端依赖（electron 等）

```powershell
cd D:\Desktop\WorkBuddy\2026-08-22-20-25-56\dsh-desktop
npm install
```

- 这一步会下载 **Electron 33**（含其 Chromium 内核，约百 MB 级）和 `electron-builder`、`electron-updater`。
- 首次可能需要几分钟，请耐心等。看到 `added xxx packages` 即成功。

---

## 第 2 步：dsh 运行时（已为你预置，可跳过）

`dsh`（DeepSeek 官方 Agent 框架）的运行时已经预先复制到：

```
dsh-desktop/resources/
├─ dsh/node_modules/@deepseek-ai/dsh/lib/bin.js   ← 官方自包含包（已装好）
└─ node/node.exe                                  ← 独立 node 运行时（已复制）
```

所以你**不用**再跑慢安装（那次要 30 分钟）。但如果你想自己重装 / 升级版本：

```powershell
npm run copy-resources
```

> 该脚本现已加「幂等守卫」：检测到 `resources/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js` 已存在就**跳过慢安装**。
> 要升级 dsh 版本：先改 `scripts/copy-resources.js` 里的 `DSH_VERSION`，再删除 `resources/dsh/node_modules` 后重跑。

---

## 第 3 步：开发模式冒烟（最关键的“看效果”一步）

```powershell
npm start
```

背后发生的事（对照 `src/main.js`）：

1. 主进程 `spawn` 一个子进程：`node resources/node/node.exe resources/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js web --no-open --host 127.0.0.1 --port 3080`
2. 轮询 `http://127.0.0.1:3080` 直到返回 200
3. 打开一个 Electron 浏览器窗口，加载 `http://127.0.0.1:3080`
4. 如果本机还没有 Key，dsh 自带的 Web 界面会弹出“添加 API Key”引导

**你要做的：**

- 在 dsh 引导页填入 DeepSeek API Key 并保存（由 dsh 自行持久化到凭据文件，桌面端不另行存储）
- 发一条消息，确认能正常对话（需联网）

**踩坑排查：**

| 现象 | 原因 / 解决 |
|---|---|
| 窗口一直白屏 / 控制台报 `server timeout` | dsh 服务没起来。看终端里 `[dsh-err]` 开头的报错；多半是 `resources/dsh` 没复制全，重跑 `npm run copy-resources` |
| `EADDRINUSE` / 端口被占用 | 3080 已被另一个 dsh 占用。关掉它，或改 `src/main.js` 顶部的 `PORT` 常量 |
| 能打开界面但发消息报错 | 没联网，或 Key 无效/没填。确认 Key 正确且机器能访问 DeepSeek |
| 窗口打不开、终端闪退 | 看终端报错；多半是 Electron 没装好，重跑 `npm install` |

---

## 第 4 步：打包成安装包 + 便携版

```powershell
npm run dist
```

- 会先（因已预置而秒过）`copy-resources`，再调用 `electron-builder`
- 产物在 `dist/`：
  - `DeepSeek Harness 桌面端 Setup 0.1.0.exe` —— NSIS 安装包（含开始菜单 / 桌面快捷方式，可自选安装目录）
  - `DeepSeek Harness 桌面端 0.1.0.exe` —— 便携版（双击即用，不写注册表）
- 打包命令在 PowerShell 里若报 “无法加载文件 ...\npm.ps1，因为在此系统上禁止运行脚本”，把 `npm` 换成 `npm.cmd` 即可（或一次性执行 `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`）。

> 第一次打包，electron-builder 可能要联网下载 NSIS 等工具链，稍等即可。

---

## 进阶：打包你自己的 fork 源码（而不是官方包）

如果你的 `deepseek-harness` fork 有自改，想打包**你自己的代码**：

1. 把 fork 构建后的产物放到 `resources/dsh/`，并保证存在 `node_modules/@deepseek-ai/dsh/lib/bin.js`；或
2. 开发期直接跑 fork 源码：设置环境变量 `DSH_DEV_DIR` 指向你的克隆目录，
   `main.js` 会用 `node --import tsx/esm apps/cli/src/bin.ts web --no-open` 运行（前提是 fork 已 `pnpm install` + `pnpm run build:official`）。

---

## 收尾：图标与自动更新

- **图标**：放一个 `build/icon.ico`（建议 256×256），托盘和 exe 就有正式图标；不放在仅功能正常、图标不可见。
- **自动更新**：默认走 GitHub Releases，仓库指向 `weng-yiyang/deepseek-harness`（桌面端代码在 `desktop-electron` 分支；Release 为仓库级，需你手动打 tag / 发 Release 后才生效，CI 仅上传 Artifact 不发 Release）。
  内网离线场景：删掉 `publish` 整段，或在 `src/main.js` 注释掉 `setupUpdater()`。
- **开机自启**：默认**关闭**（如需开启，改 `src/main.js` 的 `app.setLoginItemSettings({openAtLogin:false})` 为 `true`，或在系统“启动”项中添加）。
