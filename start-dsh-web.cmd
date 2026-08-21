@echo off
cd /d "D:\Desktop\WorkBuddy_WorkSpace\2026-08-08-20-53-17\deepseek-harness"
set DSH_RUNTIME_MODE=node
set DSH_WEB_HOST=127.0.0.1
set DSH_WEB_PORT=3080
REM 如需对话能力，取消下一行注释并填入 key：
REM set DEEPSEEK_API_KEY=sk-...
node --expose-internals apps/cli/lib/bin.js web
