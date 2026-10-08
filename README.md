# ResManager

个人资源管理工具：命令、文本、链接、软件、文件集中存放，一个快捷键就能搜到并直接使用。Windows 便携版，数据全部保存在程序所在的文件夹里。

- `Alt+Space`：呼出搜索框，输入即搜（支持拼音和首字母）。Enter 复制或打开，Ctrl+Enter 在终端执行或定位文件
- `Alt+Shift+Space`：在右下角弹出添加小窗，只需填内容，可选一行 `标题 #标签 @文件夹`，Enter 保存
- 把文件或安装包拖进主窗口即可收录（只记录路径）
- 命令支持 `{{参数:默认值}}` 占位，使用时填写
- 剪贴板临时历史、每日自动备份、JSON/Markdown 导出，AI 生成标题和标签（可选）

需求与验收标准见 [SPEC.md](SPEC.md)，开发说明见 [AGENTS.md](AGENTS.md)。

## 下载即用（无需自行编译）

1. 打开 [最新发布版本](https://github.com/zhangsev/resource-manager/releases/latest)，在 **Assets** 中下载 `ResManager-portable.zip`（不是 Source code）。
2. 解压整个 ZIP，进入 `ResManager` 文件夹，双击 `ResManager.exe`。
3. 适用于 Windows 10/11 x64，需要 WebView2 运行时；无需安装 Node、Rust 或 Visual Studio。

程序会在所在目录创建 `data/`、`backup/` 等数据目录。升级前退出程序并备份数据，只替换程序文件，保留原数据目录。发布页附带 SHA256 校验文件和已知限制。

## 只看界面（不需要 Rust）

```bash
npm install
npm run dev
```

浏览器打开 http://localhost:1420 。在地址后加 `?view=launcher` 看搜索框，加 `?view=quickadd` 看快速添加。浏览器模式下数据存在 localStorage 里，打开文件、执行命令等系统功能不可用。

## 编译便携版 exe

### 方式一：GitHub Actions（本机不用装 Rust）

1. 把 `ci/build-windows.yml` 移动到 `.github/workflows/build-windows.yml`（这个文件没法直接写进 `.github` 目录，需要手动移动一次）
2. 把本项目推到 GitHub 上的一个私有仓库
3. 在 Actions 页面运行 `build-windows-portable`（推送到 main 分支时也会自动触发）
4. 构建完成后，下载产物 `ResManager-portable.zip`

### 方式二：本机编译

需要准备：Node 20+、[Rust](https://rustup.rs)（stable-msvc）、Visual Studio 2022 生成工具（勾选"使用 C++ 的桌面开发"）。

```powershell
npm install
npx tauri build --no-bundle
pwsh ./scripts/package-portable.ps1   # 生成 dist-portable\ResManager-portable.zip
```

开发调试时运行 `npx tauri dev`。建议先设置 `$env:RESMANAGER_HOME="D:\tmp\resmanager-dev"`，让调试数据和正式数据分开。

## 常见问题

- **快捷键没反应**：多半是被其他软件占用了，在设置 → 常规里换一个，比如 `Ctrl+Alt+Space`
- **首次运行被 SmartScreen 或杀毒软件拦截**：exe 没有代码签名，需要手动放行，或者让 IT 加入白名单
- **提示数据目录不可写**：把整个文件夹放到可写的位置，比如 `D:\tools\ResManager`，不要放在 `C:\Program Files`
- **关掉窗口程序还在运行**：这是正常的，程序会最小化到托盘；要退出，请右键托盘图标选"退出"
