# 一键清理：彻底清除旧版 DeepSeek Harness 自动更新器及其所有残留进程/文件
# 用法：以管理员身份在 PowerShell 里运行此脚本
#   powershell -ExecutionPolicy Bypass -File .\cleanup-old-dsh.ps1

$ErrorActionPreference = 'SilentlyContinue'
Write-Host "===== 第 1 步：杀掉所有相关进程 =====" -ForegroundColor Yellow

# 杀掉所有 Harness/electron/installer 进程
Get-CimInstance Win32_Process | Where-Object {
    $_.Name -match 'Harness|electron' -or $_.Name -match 'installer'
} | ForEach-Object {
    Write-Host "  杀 PID $($_.ProcessId) : $($_.Name) ($($_.ExecutablePath))" -ForegroundColor Cyan
    Stop-Process -Id $_.ProcessId -Force
}
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "===== 第 2 步：删除旧版自动更新器 =====" -ForegroundColor Yellow
$updater = "$env:LOCALAPPDATA\@deepseek-aidsh-desktop-updater"
if (Test-Path $updater) {
    Remove-Item -Recurse -Force $updater
    Write-Host "  [已删] $updater" -ForegroundColor Green
} else {
    Write-Host "  [不存在] $updater" -ForegroundColor Gray
}

Write-Host ""
Write-Host "===== 第 3 步：清理 Temp 中的所有残留副本 =====" -ForegroundColor Yellow
$tempCopies = Get-ChildItem "$env:TEMP" -Directory | Where-Object { $_.Name -match '^3IH|^ns[a-zA-Z0-9]+\.tmp$' }
$count = 0
foreach ($dir in $tempCopies) {
    # 安全检查：只删包含 DeepSeek/Harness 的目录（避免误删其他 3IH 开头的临时目录）
    if ((Get-ChildItem $dir.FullName -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'Harness|deepseek' })) {
        Remove-Item -Recurse -Force $dir.FullName
        Write-Host "  [已删] $($dir.Name)" -ForegroundColor Green
        $count++
    }
}
if ($count -eq 0) { Write-Host "  [无残留]" -ForegroundColor Gray }

Write-Host ""
Write-Host "===== 第 4 步：检查注册表自启项 =====" -ForegroundColor Yellow
$regPaths = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run",
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run"
)
foreach ($rp in $regPaths) {
    try {
        $items = Get-ItemProperty -Path $rp -ErrorAction SilentlyContinue
        if ($items) {
            foreach ($prop in $items.PSObject.Properties) {
                if ($prop.Value -match 'deepseek|harness|dsh') {
                    Write-Host "  [发现!] $rp -> $($prop.Name) = $($prop.Value)" -ForegroundColor Red
                    # 不自动删注册表项（需要用户确认），只报告
                }
            }
        }
    } catch {}
}

Write-Host ""
Write-Host "===== 第 5 步：验证清理结果 =====" -ForegroundColor Yellow
$remaining = Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'Harness|electron' }
if ($remaining) {
    Write-Host "  [警告] 仍有残留进程：" -ForegroundColor Red
    $remaining | ForEach-Object { Write-Host "    PID $($_.ProcessId) : $($_.ExecutablePath)" -ForegroundColor Red }
} else {
    Write-Host "  [OK] 所有相关进程已清除" -ForegroundColor Green
}

# 检查更新器目录是否还在
if (Test-Path $updater) {
    Write-Host "  [警告] 更新器目录仍存在（可能被占用，重启后再删）" -ForegroundColor Red
} else {
    Write-Host "  [OK] 更新器目录已删除" -ForegroundColor Green
}

Write-Host ""
Write-Host "===== 清理完成 =====" -ForegroundColor Yellow
Write-Host "下一步：运行 npm.cmd run dist 重新打包，然后双击 dist 里的便携版。" -ForegroundColor White
Write-Host "如果第 4 步发现红色注册表项，请手动去 regedit 删除对应值。" -ForegroundColor White
