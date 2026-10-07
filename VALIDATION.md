# Windows 首次编译与运行验收

日期：2026-10-01。目录：`D:\dev\project\resource-manager`。

## 执行结果

1. `npm install --registry=https://registry.npmjs.org` 成功，审计 0 vulnerabilities。未修改全局 npm registry。
2. 原始代码 `npm test` 17/17、`npm run typecheck` 通过，无类型错误。
3. 原始代码 `cargo test --lib` 8/8 通过，无 Tauri API 编译错误。第 9 个测试是 Unix 专用，在 Windows 不编译。
4. 修复 AI 后每次重新运行测试；最终前端 19/19、类型检查通过，Rust 8/8。
5. 最终 `npx tauri build --no-bundle` 成功。
6. `pwsh ./scripts/package-portable.ps1` 成功；ZIP 内容与 exe 哈希已检查。

## AGENTS.md 的 8 项清单

| 项目 | 实际证据及边界 |
|---|---|
| 1. React/TypeScript 类型 | 完整 `tsc --noEmit` 通过，未修改原始组件类型。 |
| 2. Tauri API/托盘/插件 | Windows 单元测试与 release 构建均成功，exe 正常启动。托盘菜单的全部操作尚未逐项人工点击。 |
| 3. Windows helpers 分支 | Windows 编译覆盖 `raw_arg`、`creation_flags`；直接调用原始 helpers 打开测试目录、定位文件，进程启动成功；cmd、PowerShell 在含中文和空格的测试目录写出预期结果后退出。没有遍历所有 URL 协议、UNC 路径和默认文件处理程序。 |
| 4. 数据库绝对路径 | 未设置 `RESMANAGER_HOME` 启动 release exe，实际生成 `D:\dev\project\resource-manager\src-tauri\target\release\data\resmanager.db`；只读查询 `PRAGMA database_list` 返回此路径，`PRAGMA integrity_check` 为 `ok`，首次启动有 6 个示例条目。未在 `%APPDATA%\com.resmanager.app\resmanager.db` 或 `%APPDATA%\ResManager\data\resmanager.db` 发现数据库。不可写目录的回退尚未实机模拟。 |
| 5. Alt+Space | 实际呼出搜索窗口。将快速添加也设为 Alt+Space 后，界面出现“注册失败（可能被占用），请在设置中修改”；已恢复 Alt+Shift+Space。 |
| 6. 原生拖拽 | 自动化跨窗口拖拽被工具的窗口边界限制拦截；用户协助拖入 `portable-smoke.txt` 后，界面显示第 7 个条目，SQLite 查询确认 type=file、content 为完整源路径。未全面验收多文件、目录、重复项和不同目标文件夹组合。 |
| 7. 隐藏后剪贴板轮询 | Alt+F4 后窗口列表没有 ResManager，进程仍运行；写入测试文本并等待 5 秒，数据库确认记录 1 条。原剪贴板文本已恢复。再次启动 exe 唤回同一个进程。未进行长时间隐藏、锁屏、睡眠唤醒测试。 |
| 8. AI/CORS | 本机 `127.0.0.1:18765` 模拟接口不发送任何 CORS 响应头：修复前只收到 OPTIONS，未收到 POST；改用 HTTP 插件并补齐自定义端口 scope 后，收到 POST，界面标题变为“本地 AI 验证通过”，标签加入“测试”。未保存模拟生成内容；已恢复 AI 默认关闭及默认接口地址。没有调用真实服务商或使用真实 API Key。 |

此外：自动备份文件已生成；浏览器预览浅色、深色主题均可运行，检查时无浏览器 error 日志。

## 修改范围

- `src/lib/platform.ts`：新增桌面原生 HTTP / 浏览器 fetch 分流。
- `src/lib/ai.ts`：注入请求函数，默认仍为浏览器 fetch；保持解析逻辑可独立测试。
- `src/components/ItemEditor.tsx`：传入平台请求函数，不直接调用 Tauri 插件。
- `src-tauri/src/lib.rs`、`src-tauri/Cargo.toml`、`src-tauri/capabilities/default.json`：注册 HTTP 插件并仅允许 HTTP/HTTPS（包括用户自定义端口）。
- `package.json`、`package-lock.json`、`src-tauri/Cargo.lock`：HTTP 依赖及解析版本锁定。
- `tests/core.test.ts`：新增请求传输与 HTTP 错误处理两项回归测试。
- `.gitignore`：忽略项目本地工具链和测试材料 `.build-tools/`。
- `SPEC.md`、`AGENTS.md` 和本文：同步需求和真实验收状态。

没有修改 Store、SQLite 迁移、系统 helpers、界面布局或打包脚本。

## 构建环境及复现

Node 24.14.0、npm 11.9.0、Rust 1.98.1 stable x86_64-pc-windows-msvc；使用机器已有 Visual Studio 18 BuildTools/MSVC 14.50。
系统最初没有可用 Cargo，已从官方 rustup 下载最小工具链到项目 `.build-tools`，没有修改系统 PATH。

在项目根目录的 PowerShell 中复用此次工具链：

```powershell
$env:CARGO_HOME = Join-Path $PWD '.build-tools/cargo'
$env:RUSTUP_HOME = Join-Path $PWD '.build-tools/rustup'
$env:PATH = "$env:CARGO_HOME/bin;$env:PATH"
npm test
npm run typecheck
cargo test --lib --manifest-path src-tauri/Cargo.toml
npx tauri build --no-bundle
pwsh ./scripts/package-portable.ps1
```

运行便携数据定位检查时，不要设置 `RESMANAGER_HOME`；日常开发仍按 AGENTS.md 设置独立数据目录。

## 产物

- exe：`D:\dev\project\resource-manager\src-tauri\target\release\resmanager.exe`
- 解压目录：`D:\dev\project\resource-manager\dist-portable\ResManager`
- ZIP：`D:\dev\project\resource-manager\dist-portable\ResManager-portable.zip`
- ZIP 只含 `ResManager.exe`（8,289,280 字节）和 `使用说明.txt`，不含测试数据库、剪贴板或 AI 配置。
- 构建 exe 与打包 exe SHA256 相同：`939FEBA5AA40303BE6C5FFA253FA9117FDC09B60120D8ED61B43337E7341C873`
- ZIP SHA256：`8D17C21B70AEEAA7592E428D35FBA634D724C9B5460FD15F536BA426197C7FC5`

## 尚存警告和未覆盖项

- Vite 主 JS chunk 约 623 kB，超过默认 500 kB 提示线；不影响本次构建，为最小改动未做拆包。
- Tauri 提示 identifier 以 `.app` 结尾可能与 macOS bundle 扩展名冲突；本项目 Windows 专用，保留现有 identifier。
- MSVC 链接器“正在创建库/对象”被 Rust 作为 linker_messages 警告输出，不是链接失败。
- 真正的外部 AI 服务、企业代理/证书环境、其他 Windows 版本、不可写目录回退、长时间后台轮询及完整拖拽组合仍需进一步验收。
- 当前目录不是 Git 工作树，未创建提交。

## 第二轮：快速添加小窗验收（2026-10-08）

### 工具链与执行顺序

沿用上文项目本地工具链，未安装新依赖、未更改全局环境：

```powershell
$env:CARGO_HOME = Join-Path $PWD '.build-tools/cargo'
$env:RUSTUP_HOME = Join-Path $PWD '.build-tools/rustup'
$env:PATH = "$env:CARGO_HOME/bin;$env:PATH"
npm test
npm run typecheck
cargo test --lib --manifest-path src-tauri/Cargo.toml
npx tauri build --no-bundle
```

- 修复前按上述顺序执行：前端 21/21、TypeScript 通过、Windows Rust 8/8、release exe 构建成功。
- 首次沙箱内 Cargo build-script 出现 `os error 5`（拒绝访问）；经批准在沙箱外使用同一工具链重跑通过，未因此修改源代码。
- 下述 DPI 修复后再次按上述顺序全部重跑：前端 21/21、TypeScript 通过、Rust 8/8、release 构建成功。没有类型错误或 Rust 编译错误需要修复。
- 保留既有非阻断警告：Vite 主 chunk 约 627 kB、identifier 的 `.app` 后缀提醒、MSVC linker_messages。

### 发现的问题与最小修复

运行中将 Windows 从 100% 改成 125% 后，已创建但隐藏的小窗仍保留旧物理像素尺寸，截图逻辑宽度约 480，底部快捷键提示被裁切。

- `src/lib/platform.ts`：`placeBottomRight` 先移至目标显示器，再按该显示器 `scaleFactor` 将 600×230 逻辑像素换算为物理尺寸；取得实际 `outerSize` 后计算工作区右下角位置。
- `src-tauri/capabilities/default.json`：仅补充 `core:window:allow-set-size` 权限。
- `SPEC.md`：仅勾选实际验证的草稿保留与 Ctrl+E 条目；包含其他未测行为的复合条目继续保留未勾选。

未改动 Store、SQLite 迁移、Rust 命令、快捷键/草稿事件架构、QuickAdd 组件或依赖。

### AGENTS.md 第二轮 4 点

测试使用实际 release exe 与独立 `RESMANAGER_HOME=D:\dev\project\resource-manager\.build-tools\validation-round2`，避免污染便携版原数据库。此轮不重复第一轮“未设置覆盖变量”的数据库定位验收。

| 项目 | 结果与实际证据 |
|---|---|
| 1. 右下角、任务栏上方、125%/150% | 单显示器 1920×1080 已实测。获用户批准后实际切换 Windows 显示缩放，不是浏览器缩放。修复后 125%→150%→125% 均完整显示两行输入与底部提示，窗口位于屏幕右下区域。125% 复测截图逻辑尺寸 602×232、屏幕原点 (1140,702)；150% 为 603×233、原点 (983,626)，包含边框。125% 冷启动首次显示曾为 602×262，内容未裁切，后续唤起为约 600×230。已在设置中确认恢复原始 100%。只验证当前单屏，未覆盖跨显示器/混合 DPI、侧边任务栏或自动隐藏任务栏。 |
| 2. 点击别处保留；Esc 清空 | 通过。填写内容 `round2 draft keep 20261008` 和元信息 `保留测试 #round2 @常用命令`；点击主窗口空白处后窗口列表不再有快速添加；快捷键重开两项均保留。另输入 `discard me 20261008` 后按 Esc，隐藏后重开两项均为空。 |
| 3. Ctrl+E 传入完整表单 | 通过。主窗口实际显示“新建条目”，内容、标题“保留测试”、标签 `round2`、文件夹“常用命令”均带入；再次打开快速添加为空。未保存这份测试草稿。 |
| 4. 托盘“快速添加” | 待用户协助实测。代码路径已核对：Rust 菜单 `add` 发 `resmanager://tray-quickadd`，主窗口订阅后调用与快捷键相同的 `openQuickAdd` / `showWindow` 定位路径。自动化窗口清单未暴露可操作的任务栏，不能把代码检查或快捷键测试冒充托盘点击验收；已请用户操作当前运行的测试版。 |

第 2、3 点在此次修复前的第二轮 release 上实测；尺寸修复只涉及平台窗口定位与权限。修复后的 release 已完成上述 DPI 回归。

### 浏览器回归与产物

- `npm run dev` 浏览器预览的快速添加浅色、深色主题均正常显示；重新加载后确认主题，无 error 日志，测试后恢复浅色。浏览器预览没有依赖原生窗口调用。
- 最新 exe：`D:\dev\project\resource-manager\src-tauri\target\release\resmanager.exe`，8,290,816 字节。
- SHA256：`AC567FF0C3A63B9590BAFCE57D03CF0C0753E6DD3F1305464BD8125B1D4C7DFD`。
- 本轮请求未要求重新打包，故 `dist-portable` 中仍是上轮产物，不应当作本轮修复版分发。
- 剩余边界：多显示器混合 DPI、托盘人工点击结果，以及 125% 冷启动首次窗口高度略大现象。没有未解决的类型或编译错误。

### 第二轮补充：便携包打包与哈希核验（2026-10-08）

- 沿用上述 `CARGO_HOME`、`RUSTUP_HOME` 和 `PATH` 环境变量，执行 `pwsh ./scripts/package-portable.ps1`，退出码 0。
- 执行前确认清理目标为项目内 `D:\dev\project\resource-manager\dist-portable`，原目录仅包含旧便携包及 exe/说明文件，没有数据库或用户数据。
- 最新 ZIP：`D:\dev\project\resource-manager\dist-portable\ResManager-portable.zip`，4,083,857 字节。本次已替换上轮便携包；上文“本轮未重新打包”的状态至此更新。
- 直接读取 ZIP 条目流计算 SHA256，确认 ZIP 内 exe、打包目录 exe、release 源 exe 均与第二轮记录一致：`AC567FF0C3A63B9590BAFCE57D03CF0C0753E6DD3F1305464BD8125B1D4C7DFD`。
- ZIP SHA256：`6583E3B0C8165283DA7F34B03903C149730C66A5CFB157A8A071FE04C70A7D99`。
- ZIP 仅包含 `ResManager/ResManager.exe`（8,290,816 字节）和 `ResManager/使用说明.txt`（566 字节），不含数据库、备份或测试材料。
- 本次没有重新编译或修改源代码，未重复运行单元测试；第二轮列出的运行时待验收项仍然保留。
