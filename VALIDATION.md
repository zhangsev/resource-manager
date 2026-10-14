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

## v0.1.0 发布构建（2026-10-08）

- 沿用本文工具链，重新运行 `npm test`（21/21）、`npm run typecheck`、`cargo test --lib`（8/8），全部通过。
- 重新执行 `npx tauri build --no-bundle`：首次因之前验收进程占用 exe 而失败；关闭确认属于本项目的测试进程后重建成功，没有修改业务代码。
- 重新执行 `pwsh ./scripts/package-portable.ps1` 成功；直接读取 ZIP 内 exe 的流校验，确认与本次 release 源 exe 哈希一致。
- 本次重新编译产物取代先前已记录的二进制；exe 为 8,290,816 字节，SHA256：`AEE1714E7A1ADA5C66862BCD06A65963D542AC9A9159C7271D7AB8F06CADCA29`。
- ZIP 为 4,083,858 字节，SHA256：`3D1A5E60E70DAFD58E8C406CE1F4585B24C3EED29576CD25DE29EC9E285526EF`。
- ZIP 仅含 `ResManager/ResManager.exe` 和 `ResManager/使用说明.txt`，没有数据库或本地测试数据；另生成 `dist-portable/SHA256SUMS.txt` 供下载者校验 ZIP。
- README 新增“下载即用”入口。发布说明保留第二轮已知限制；本次未重做 GUI 验收，也没有声称解决尚未覆盖的运行时问题。

### 发布完成与公开下载验证

- 已发布公开 Release：[ResManager v0.1.0](https://github.com/zhangsev/resource-manager/releases/tag/v0.1.0)，标签指向 `eac5916f558ddb0c656d4debe51563adb283b1eb`。
- 附件：`ResManager-portable.zip` 和 `SHA256SUMS.txt`。上传后 GitHub 返回的两份附件 SHA256 均与本地一致，再将草稿设为公开发布。
- 使用不含登录凭据的请求读取 latest Release 并实际下载 ZIP，复算 SHA256 为 `3D1A5E60E70DAFD58E8C406CE1F4585B24C3EED29576CD25DE29EC9E285526EF`，与本地包一致。
- 用户可直接下载 ZIP、解压后运行，不需要自行编译。

## 第三轮：链接 / Markdown / 代码高亮验收（2026-10-13）

### 安装、测试与构建

已阅读 AGENTS.md 第三轮清单及 SPEC 4.7。保留工作区中已有的第三轮实现，只执行依赖锁定和验收，没有修改业务代码、架构、数据库迁移或现有功能需求。

先执行 `npm install`，成功新增 4 个包，更新 `package-lock.json`；实际解析为 `marked@18.1.1`、`dompurify@3.4.17`、`highlight.js@11.12.0`，以及 DOMPurify 的可选类型依赖 `@types/trusted-types@2.0.7`。沿用机器现有 npm registry（新条目的 resolved 指向 registry.npmmirror.com），未修改全局 npm 配置。

随后沿用本文工具链环境，按顺序执行：

```powershell
$env:CARGO_HOME = Join-Path $PWD '.build-tools/cargo'
$env:RUSTUP_HOME = Join-Path $PWD '.build-tools/rustup'
$env:PATH = "$env:CARGO_HOME/bin;$env:PATH"
npm test
npm run typecheck
cargo test --lib --manifest-path src-tauri/Cargo.toml
npx tauri build --no-bundle
```

结果：前端 **24/24**、TypeScript 无错误、Windows Rust **8/8**、release 构建成功。无需类型错误、Rust 编译或运行时逻辑修复，因此未额外改变源代码。构建仍有既有的 `.app` identifier、Vite 大 chunk、MSVC linker_messages 非阻断警告；本次主 JS 为 778.93 kB，gzip 290.60 kB。

### 桌面版 4 点逐项验证

运行实际 release exe，设置 `RESMANAGER_HOME=D:\dev\project\resource-manager\.build-tools\validation-round3`。通过 SQLite `VACUUM INTO` 复制上轮测试数据库至独立目录，保留其中 3 条旧命令（`meta` 均为 `{}`，没有 `lang`）；只向该副本加入 Markdown / 普通链接测试条目。没有写入用户数据库或发布包中的数据。

| 项目 | 实测结果与证据 |
|---|---|
| 1. Markdown 和普通文本链接在默认浏览器打开，主窗口不跳转 | **通过。** Windows HTTP 默认关联为 `ChromeHTML`。在主窗口实际点击 Markdown 命名链接、Markdown 文本内自动识别的裸网址、普通 `LinkText` 网址，分别访问本机测试页 `/markdown`、`/autolink`、`/plain`。窗口清单出现对应标题的 `chrome.exe`，本机服务收到 Chrome/155 的 document 请求。主窗口可访问性树始终保留 `http://tauri.localhost/` 与当前条目标题，未跳转到测试网页。 |
| 2. 代码块复制写入系统剪贴板，不重复进入历史 | **通过。** 实际点击 JavaScript、SQL 两个代码块各自的“复制”，使用系统剪贴板读取与预期字符串逐字比较均为 True：只含对应块正文，不含语言标签、按钮文字、另一块或 Markdown 围栏。每次等待 3 秒（覆盖多次 1 秒轮询），SQLite 历史计数仍为 0。另从应用外写入 `round3 external clipboard control 20261013` 作为阳性对照，3 秒后历史增加为 1；再复制第一段代码，历史仍只有该对照文本，没有应用自身复制的记录。 |
| 3. 没有 `meta.lang` 的旧命令显示正常 | **通过。** 逐项查看复制自第二轮数据库的 Docker、SSH、netstat 命令：原文和 `{{参数}}` 均完整；前两项显示 `Shell (bash)（自动识别）`，netstat 显示 `CMD / 批处理（自动识别）`，高亮正常。结束后只读查询确认 3 条记录的 `meta` 仍为 `{}`，数据库 integrity_check 为 `ok`，无需迁移或回写语言字段。 |
| 4. exe 体积变化 | **通过，已测量。** 上轮发布 exe 8,290,816 字节，本次 8,339,968 字节，增加 **49,152 字节 = 48 KiB ≈ 49.152 kB，约 0.593%**。低于清单预估的 150～250 KB；此处记录实际最终 exe 增量，而非前端未压缩 JS 的增量。 |

补充观察：桌面浅色、深色下 Markdown 和 JavaScript/SQL/CMD 高亮均可读；原始 `<script>` 显示为文本，没有弹出脚本对话框；外部图片显示为链接，本机请求日志中没有 `/should-not-load.png` 请求。此为针对测试样例的检查，不代表完整安全审计。SPEC 4.7 含其他复合验收条件，本轮没有一并全部勾选；未重复全部浏览器预览和编辑器交互测试。

### 产物、修改范围与清理

- exe：`D:\dev\project\resource-manager\src-tauri\target\release\resmanager.exe`。
- SHA256：`CA983DFBA8A4754DAC54A2FC5638D844CE9E6F56F89AE0955AD726D9644E5B60`。
- 本轮新增修改仅为 `package-lock.json` 和本文；用户先前提供的第三轮代码、AGENTS.md、SPEC.md 等工作区改动均原样保留，未自动提交或推送。
- 测试进程和仅监听 `127.0.0.1:18766` 的本机测试服务已停止；确认剪贴板仍为测试内容后恢复了原剪贴板文本。隔离测试数据和脚本保留在被 Git 忽略的 `.build-tools/`。
- 本轮未重新打包 ZIP、未上传或覆盖 GitHub v0.1.0 Release；现有公开下载及 dist-portable 仍是此前发布版本。
- 本轮 4 点未发现阻断问题；多显示器、托盘人工点击等此前未覆盖项目仍不因本轮验收而视为通过。

## v0.2.0 发布构建（2026-10-13）

- `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 统一升级为 **0.2.0**，同步 `package-lock.json` 和 `src-tauri/Cargo.lock` 的根项目版本。
- 使用本文既有工具链，重新执行前端测试 **24/24**、TypeScript 类型检查、Rust 测试 **8/8**，全部通过；`npx tauri build --no-bundle` 成功，exe 内嵌 ProductVersion 已确认为 `0.2.0`。
- `pwsh ./scripts/package-portable.ps1` 成功，生成 `dist-portable/ResManager-portable.zip` 及单独的 `dist-portable/SHA256SUMS.txt`。执行前已确认打包脚本清理范围仅为项目内 dist-portable，且其中不含用户数据库。
- ZIP 仅包含 `ResManager/ResManager.exe`（8,339,968 字节）与 `ResManager/使用说明.txt`（566 字节）；直接读取 ZIP 内 exe 流校验，确认与 release 源 exe 一致。
- exe SHA256：`A8BB3A078D7685ED22F39956683EA0002A820C9052F73DCBE37F1A1E598052D3`。
- ZIP：4,132,207 字节；SHA256：`D0921BFA056E24A6D5D6AA3F3AFD233AF6257F924809EC15A35446E88B5A26E8`。
- 发布说明包含两项功能：**精简版快速添加（右下角小窗）**、**可点击链接 / Markdown 渲染 / 代码高亮**；保留第三轮实测结论及此前已知限制，不覆盖旧 v0.1.0 Release。

### v0.2.0 发布完成与匿名下载复核

- 已提交并推送发布源码：`ded8732d7b59c2ee8e5446740e171f45888fc687`；远程标签 `v0.2.0` 指向该提交。
- 公开 Release：[ResManager v0.2.0](https://github.com/zhangsev/resource-manager/releases/tag/v0.2.0)，已设置为 latest；说明中的两项新功能已通过公开 API 读取核对。
- 先创建草稿，上传 `ResManager-portable.zip` 与 `SHA256SUMS.txt`，检查 GitHub 返回的附件大小、状态和 SHA256 均匹配后再发布；旧 v0.1.0 未修改。
- 使用不带 Authorization、Cookie 或登录会话的请求实际下载这两个公开附件；ZIP SHA256 为 `D0921BFA056E24A6D5D6AA3F3AFD233AF6257F924809EC15A35446E88B5A26E8`，与本地完全一致。
- 下载的 `SHA256SUMS.txt` 自身 SHA256 为 `53773E9C9F6B67C5F7DF3075D67843FE7BEED417B31DE9CA42DD3C27940AC415`，与本地一致；其中记录的 ZIP 哈希和文件名也与下载文件匹配。
- 再读取下载 ZIP 内的 exe，SHA256 为 `A8BB3A078D7685ED22F39956683EA0002A820C9052F73DCBE37F1A1E598052D3`，与本次构建的 0.2.0 exe 一致。
- 公开直链：https://github.com/zhangsev/resource-manager/releases/download/v0.2.0/ResManager-portable.zip 。解压后运行，无需自行编译。

## 第四轮：待办 / 提醒 / 升级备份 / 使用说明（2026-10-15，0.3.0）

### 安装、工具链与最终测试

已阅读 AGENTS.md 第四轮清单及 SPEC 4.2 / 4.5 / 4.8。保留用户已有第四轮实现和版本号，不改变数据结构或 Store 架构。本轮不发布 Release、不打包、不提交或推送。

沿用本文工具链：

```powershell
$env:CARGO_HOME = Join-Path $PWD '.build-tools/cargo'
$env:RUSTUP_HOME = Join-Path $PWD '.build-tools/rustup'
$env:PATH = "$env:CARGO_HOME/bin;$env:PATH"
npm install
npm test
npm run typecheck
cargo test --lib --manifest-path src-tauri/Cargo.toml
npx tauri build --no-bundle
```

- 首次安装成功；前端 32/32、类型检查、Rust 8/8 均通过，没有类型或 Rust API 编译错误。
- 首次 Tauri 构建被通知插件版本检查阻止：npm 自动解析为 2.7.0，Rust 为 2.5.0。把 npm 范围由 `^2.2.0` 收紧为 `~2.5.0`，实际安装 **@tauri-apps/plugin-notification 2.5.1**，与 **tauri-plugin-notification 2.5.0** 的主/次版本一致。同步更新 npm/Cargo lock；Cargo 新增 4 个通知相关包，没有批量升级已有依赖。
- 每轮修复后均重跑前端和 Rust 测试；最终完整顺序测试为 **npm test 33/33、typecheck 无错误、Rust 9/9、release exe 构建成功**。
- 保留原有非阻断警告：`.app` identifier、Vite 大 chunk、MSVC linker_messages。最终主 JS 803.49 kB（gzip 300.14 kB）。

### 最小修复

1. **依赖版本对齐**：仅收紧新增通知插件的 npm 版本范围并更新锁文件。
2. **离线标题**：`services.ts` 原先要求提醒时间早于启动时间至少一分钟，导致刚过期便重启时标题错误。改为首次调度时判断提醒时间是否早于启动时间；纯逻辑放入 `todo.ts` 的 `hasOfflineReminders`，增加「仅过期 5 秒」及边界/稍后/完成状态的回归测试。运行中新增的过期任务不被标为离线提醒。
3. **Windows 无焦点弹窗**：`focus: false` 仅约束初始创建，Tao 后续 `show()` 使用 `SW_SHOW`。新增仅针对应用自身 reminder 窗口的 Rust `set_reminder_visible` 命令，由 `helpers.rs` 使用 `SW_SHOWNOACTIVATE` / `SW_HIDE` 成对显示隐藏；`lib.rs` 仅取得 HWND 和注册命令，`platform.ts` 保持唯一系统调用出口。关闭窗口事件也走相同隐藏路径。没有增加 Windows 依赖或修改系统焦点/安全设置；提醒仍可由用户主动点击。新增空 HWND 拒绝测试。
4. **首次 DPI 尺寸**：隐藏窗口首次显示时原生边框会再次调整尺寸；在显示后补做一次现有右下角定位/尺寸设置，并避免对提醒调用 `unminimize()`。修复前 150% 冷启动提醒截图为 383×331，最终为 383×303（均含边框）。

### 数据隔离与升级路径

- 所有桌面测试均显式设置 `RESMANAGER_HOME`；从未以真实数据目录启动测试版。
- 先将历史第三轮验证库用 SQLite `VACUUM INTO` 复制到 `.build-tools/validation-round4/old/data/resmanager.db`，在副本中关闭剪贴板记录；用已发布的 **0.2.0** exe 实际打开，确认 8 条条目可读。该 exe ProductVersion 为 0.2.0，SHA256 与 v0.2.0 发布记录一致：`A8BB3A078D7685ED22F39956683EA0002A820C9052F73DCBE37F1A1E598052D3`。
- 退出这个旧版测试实例，再用 `VACUUM INTO` 复制到 `.build-tools/validation-round4/upgrade/data/resmanager.db`，保存旧条目/文件夹的完整字段快照，随后仅对这份副本运行 0.3.0。
- 定时提醒用例以 SQL 写入隔离副本，再启动实际 exe 等待真实时间；快速添加、提醒按钮和分组通过 Windows 界面实际操作。未修改系统时间。

### 六项逐项结果

| 项目 | 结果与证据 |
|---|---|
| 1. 0.2.0 → 0.3.0 升级、备份、旧数据、说明、幂等 | **通过。** 首启生成 `backup/upgrade-to-v0.3.0-20261015-034915.db`；SQLite `integrity_check=ok`，备份内 8 条旧条目完整字段与升级前快照一致；运行库中旧条目及 3 个文件夹同样逐字段一致。新增 `builtin-guide`，标题「使用说明（ResManager）」且 pinned=1。多次重启及最终构建复查仍只有 1 份升级备份、1 条说明，lastVersion=0.3.0。0.2.0 没有 lastVersion 字段，因此文件名不含无法得知的旧版本段；没有伪造旧版本号。本轮 SCHEMA_VERSION 仍为 1，没有实际结构迁移用例。 |
| 2. 在线提醒、焦点、系统通知、按钮、不重复 | **通过（系统通知由 Ethan 人工确认）。** 03:51:20 建立 03:53:20 到期的 4 个待办，实际等待两分钟后出现右下角提醒；notifiedAt 等于该次提醒时间。「10 分钟后」写入 snoozeUntil=04:04:00，并在真实十分钟后再次进入提醒列表、notifiedAt 更新为 snoozeUntil；「完成」写入 done/doneAt 并移出提醒；「打开」定位主窗口相应条目；「×」写入 ackAt 并隐藏，等待超过两个 15 秒调度周期没有重复弹出。最终原生修复版另用 30 秒用例回归：提醒出现时快速添加窗口仍在，蓝色输入焦点及 `R4 native focus retained` 草稿保留，未因失焦隐藏；观察期间不执行激活/输入操作。随后再次实际点击完成、打开和 ×，数据及隐藏结果正确。通知设置为开启；自动化未捕获 Windows 系统通知，Ethan 随后针对约 03:53:20 的测试明确确认“看到了系统通知，输入未受影响”，据此将系统通知可见性记为人工验收通过。此确认对应初次两分钟用例，不冒充最终构建的新一次通知实测。 |
| 3. 离线一分钟到期 | **修复后通过。** 初测：03:55:19 创建、03:55:29 退出、03:56:19 到期、03:56:24 重启，错误显示「待办提醒（1）」。修复后：03:59:46 创建、03:59:56 退出、04:00:46 到期、04:00:52 启动修复版，实际标题为「离线期间有 1 条待办到期」。未将“过期不足一分钟”排除。 |
| 4. 快速添加类型与快捷语法 | **通过。** 实际打开类型下拉框（命令/文本/链接/软件/文件/待办）并选择待办；填写 `R4 周报验收` 和 `!高 ^周五 17:00 #round4`，提示 `10-16 周五 17:00`、高优先级；Enter 显示已保存，主窗口「待办」的「明天」分组出现该条目。SQLite 确认 type=todo、priority=high、due=1792141200000、remindBefore=0。浏览器预览另从默认文本输入同样语法，确认自动切换待办。 |
| 5. 125% / 150% 缩放 | **当前单显示器通过。** 实际切换 Windows 显示缩放，分辨率 1920×1080；不是浏览器缩放。最终版 125%：提醒 382×302、原点(1415,615)，快速添加 602×232、原点(1140,702)；150%：提醒 383×303、原点(1313,521)，快速添加 603×233、原点(983,626)。均为工具返回的逻辑截图尺寸（含边框）和屏幕原点，窗口完整显示并位于右下区域；同时出现可重叠。修复后冷启动提醒未再出现多约 30 像素高度。已在设置界面确认恢复原始 **100%**。未测试多显示器混合 DPI、侧边或自动隐藏任务栏。 |
| 6. exe 体积变化 | **已记录。** v0.2.0 为 8,339,968 字节；最终 v0.3.0 为 **8,496,128 字节**，增加 **156,160 字节 = 152.5 KiB，约 1.872%**。 |

### 浏览器回归、产物与剩余项

- 普通浏览器预览中测试快速添加待办识别/保存，主窗口持久化与待办详情浅色/深色均可用，最终冷启动页面控制台 error 列表为空，结束后恢复浅色。
- 开发服务器在本轮修改 services/todo 并触发 HMR 时曾出现重复 `createRoot` / `removeChild` 错误；完整重新打开页面后不复现。此为开发热更新的剩余观察项，未扩展改造入口/HMR 结构，也未将该过程描述成全程零错误；release 不使用 HMR。
- 最终 exe：`D:\dev\project\resource-manager\src-tauri\target\release\resmanager.exe`，内嵌版本 **0.3.0**。
- 最终 exe SHA256：`E5A41C394FAD8105DC4525A79B338BE7E7AC5F550B4E64BAF448B4AF285E76E3`。用于最后原生焦点、提醒按钮和 125%/150% 回归的副本与该源 exe 哈希一致。
- 隔离材料保留在 Git 忽略的 `.build-tools/validation-round4/`：旧数据快照、升级首启/重启/最终一致性检查 JSON、提醒时刻及按钮结果 JSON、测试脚本与测试 exe。测试进程和本机 Vite 服务均已停止。
- **未解决/未覆盖**：多显示器/混合 DPI、托盘人工点击仍保留以前的待验证状态；开发 HMR 上述问题未修复。未据部分用例把 SPEC 所有复合验收项全部勾选。
- 本轮新增修改范围：`package.json` / `package-lock.json` / `src-tauri/Cargo.lock`、`src/lib/todo.ts` / `services.ts` / `platform.ts`、`src-tauri/src/helpers.rs` / `lib.rs`、`tests/core.test.ts` 和本文。其余用户已提供的第四轮代码保留；版本号原本已是 0.3.0。
- **未重新打包 ZIP，未创建或修改 GitHub Release，未提交或推送。** `dist-portable` 和公开 v0.2.0 发布产物不变。

### 第四轮补充：系统通知人工确认（2026-10-15）

- Ethan 回复约 03:53:20 的隔离测试提醒询问：**“看到了系统通知，输入未受影响”**。已同步更新上表第 2 项及剩余项；该证据来自用户实际观察，并非自动化捕获。
- 本次仅补充验证记录，未修改代码、重新构建或运行测试，最终 exe 及其哈希不变；未打包或发布。

## v0.3.0 发布打包（2026-10-15）

- 按用户新的发布指令，打包第四轮已验证的现有 0.3.0 构建，不重新编译或改动功能。发布前沿用本文工具链重跑：前端 **33/33**、TypeScript 类型检查、Rust **9/9** 全部通过。
- 已确认打包脚本的清理目标为项目内 `dist-portable`，其中没有运行数据库；执行 `pwsh ./scripts/package-portable.ps1` 成功，并生成 UTF-8 无 BOM 的 `dist-portable/SHA256SUMS.txt`（记录 ZIP 的 SHA256）。
- ZIP 仅含 `ResManager/ResManager.exe`（8,496,128 字节）和 `ResManager/使用说明.txt`（566 字节），不含测试数据或工具链。读取 ZIP 内 exe 流复核，其 SHA256 与第四轮记录完全一致：`E5A41C394FAD8105DC4525A79B338BE7E7AC5F550B4E64BAF448B4AF285E76E3`；源 exe 内嵌版本为 **0.3.0**。
- ZIP：**4,201,999 字节**；SHA256：`CB8F5AE3E42BA469B20EB5CD82A6BB019D72D3070C43434B02B39B5D4643786E`。
- `SHA256SUMS.txt` 自身 SHA256：`7B93AD0D0091B5E836EDE55A8B3C8784ED60B7CD9A8F7BE43D820BD9EB9A23E1`。
- 发布说明准备列出待办（截止时间/优先级/子任务/右下角提醒）、快速添加类型下拉框及 `!高 ^周五 17:00` 写法、升级自动备份、内置使用说明；升级步骤明确为 **托盘退出 → 同目录覆盖 exe（保留 data/backup）→ 启动**。公开发布和匿名下载复核结果在完成后追加。

### v0.3.0 发布完成与匿名下载复核

- 已提交并推送发布源码：`80db6fbc8b46a35a65bf35f4dd4bca9506693d7c`；公开 API 确认标签 `v0.3.0` 指向该提交。
- 公开 Release：[ResManager v0.3.0](https://github.com/zhangsev/resource-manager/releases/tag/v0.3.0)，已设置为 latest，非预发布。先创建草稿，上传 ZIP 与 `SHA256SUMS.txt`，逐一核对 GitHub 返回的上传状态、文件大小及 SHA256 后才公开；旧 Release 未修改。
- 匿名读取公开发布说明，确认包含用户要求的四项功能，以及 **托盘退出 → 覆盖 exe → 启动**；说明明确保留 `data/`、`backup/`、`exports/`，并建议升级前复制备份旧程序目录。已知限制与第四轮验证范围一并保留。
- **2026-10-15 04:24:56（UTC+8）** 完成匿名下载：独立 HttpClient 禁用 Cookie 与默认凭据，不读取 Git 凭据、不设置 Authorization，也不使用浏览器登录会话，实际下载两个公开附件。
- 下载 ZIP 为 **4,201,999 字节**，SHA256：`CB8F5AE3E42BA469B20EB5CD82A6BB019D72D3070C43434B02B39B5D4643786E`，与本地打包产物完全一致。
- 下载的 `SHA256SUMS.txt` 为 **90 字节**，自身 SHA256：`7B93AD0D0091B5E836EDE55A8B3C8784ED60B7CD9A8F7BE43D820BD9EB9A23E1`；与本地文件完全一致，内容记录的 ZIP 哈希及文件名也与下载文件匹配。
- 读取下载 ZIP 内 exe 流，确认大小 **8,496,128 字节**、SHA256：`E5A41C394FAD8105DC4525A79B338BE7E7AC5F550B4E64BAF448B4AF285E76E3`，与第四轮已验证 0.3.0 exe 完全一致。
- 本机复核材料在 Git 忽略的 `.build-tools/verify-v0.3.0/`，仅源码和验证文档进入 Git，附件通过 Release 提供。
- 直接下载：[Windows 便携 ZIP](https://github.com/zhangsev/resource-manager/releases/download/v0.3.0/ResManager-portable.zip) · [SHA256SUMS.txt](https://github.com/zhangsev/resource-manager/releases/download/v0.3.0/SHA256SUMS.txt)。解压即可运行，无需自行打包。
