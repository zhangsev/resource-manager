# Collects the release exe into dist-portable/ResManager and zips it.
# Usage (after `npx tauri build --no-bundle`):  ./scripts/package-portable.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'src-tauri/target/release/resmanager.exe'
if (-not (Test-Path $exe)) { throw "找不到 $exe，请先运行 npx tauri build --no-bundle" }

$out = Join-Path $root 'dist-portable'
$dir = Join-Path $out 'ResManager'
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force $dir | Out-Null

Copy-Item $exe (Join-Path $dir 'ResManager.exe')
@"
ResManager 便携版
=================
双击 ResManager.exe 运行。首次运行会在本文件夹下创建：
  data\      数据库（resmanager.db）和临时文件
  backup\    每日自动备份
  exports\   导出文件
整个文件夹拷走即可迁移全部数据。请放在可写的位置（不要放 C:\Program Files）。

快捷键：Alt+Space 搜索，Alt+Shift+Space 快速添加（可在设置中修改）。
关闭窗口只是隐藏到托盘，退出请右键托盘图标选「退出」。

依赖：Windows 10/11 自带的 WebView2 运行时。
"@ | Set-Content -Encoding UTF8 (Join-Path $dir '使用说明.txt')

Compress-Archive -Path $dir -DestinationPath (Join-Path $out 'ResManager-portable.zip') -Force
Write-Host "OK -> $out"
