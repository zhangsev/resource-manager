# AGENTS.md：给 AI 编码助手（Codex / Claude Code 等）的开发说明

需求和验收标准见 `SPEC.md`，那是唯一的需求来源。改功能前先读它；功能有变化时同步更新它。

## 项目概况

- Windows 便携版个人资源管理工具：Tauri 2 + React 19 + TypeScript + SQLite
- 三个窗口共用一个前端入口（`index.html` → `src/main.tsx`），按 **窗口 label** 路由：`main`、`launcher`、`quickadd`（定义在 `src-tauri/tauri.conf.json`）
- 前端同时支持在普通浏览器里运行（"浏览器预览模式"）：`MemoryStore` 存到 localStorage，系统相关功能给出提示。**不要破坏这个模式**，它用来在没有 Rust 环境时查看界面

## 目录结构

```
src/
  main.tsx               入口，按窗口 label 选择视图
  styles.css             全部样式；颜色 token 定义在 :root，深色主题在 [data-theme=dark] 和 prefers-color-scheme
  lib/
    types.ts             Item / Folder / Clip / Settings 类型和默认值
    search.ts            搜索排序（纯函数，拼音函数通过参数注入）
    pinyin.ts            pinyin-pro 封装
    params.ts            {{参数}} 解析和填充
    detect.ts            剪贴板文本 → 类型、标题
    folders.ts           文件夹树工具
    exporter.ts          JSON / Markdown 导出，JSON 导入合并
    clipfilter.ts        剪贴板记录过滤规则
    ai.ts                可选 AI（OpenAI 兼容接口）
    actions.ts           每种类型的主操作 / 次操作
    platform.ts          所有系统调用的唯一出口（Tauri invoke / 插件，外加浏览器回退）
    services.ts          仅主窗口运行：全局快捷键、剪贴板轮询、每日备份
    app.tsx              AppProvider 全局状态、toast、首次运行示例数据
    store/               Store 接口；sqliteStore（桌面）和 memoryStore（浏览器）
  views/                 MainWindow / Launcher / QuickAdd
  components/            通用组件、编辑器、详情页、侧边栏、设置
src-tauri/
  src/helpers.rs         纯 std 实现的系统操作（路径解析、打开、定位、终端执行、备份清理），带单元测试
  src/lib.rs             Tauri 命令、托盘、插件注册、关闭即隐藏
  capabilities/default.json  前端权限
tests/core.test.ts       前端纯逻辑单元测试（node:test + tsx）
ci/build-windows.yml     GitHub Actions 构建便携版，使用前需移动到 .github/workflows/
```

## 常用命令

```bash
npm install                 # 安装前端依赖
npm run dev                 # 浏览器预览：http://localhost:1420 （?view=launcher / ?view=quickadd 看另外两个窗口）
npm test                    # 前端单元测试
npm run typecheck           # TypeScript 类型检查
npx tauri dev               # 桌面版开发运行（需要 Rust 和 VS C++ 生成工具）
npx tauri build --no-bundle # 生成 src-tauri/target/release/resmanager.exe
pwsh ./scripts/package-portable.ps1   # 打包成 dist-portable/ResManager-portable.zip

cd src-tauri && cargo test --lib      # Rust helpers 单元测试
```

Windows 编译环境：Node 20+，Rust stable（rustup，MSVC 工具链），Visual Studio 2022 生成工具（勾选"使用 C++ 的桌面开发"），WebView2（Win10/11 自带）。

开发时把数据放到别处，避免写进 `target/debug`：设置环境变量 `RESMANAGER_HOME=D:\tmp\resmanager-dev`。

## 待验证改动（2026-10-01 第二轮）

快速添加改为精简小窗（需求见 SPEC 4.2）。改动：`src/views/QuickAdd.tsx` 重写，新增 `src/lib/quickparse.ts`（含测试），`platform.ts` 的 `placeBottomRight`，`services.ts` 新增 `EV_EDIT_DRAFT` 和 `EV_TRAY_QUICKADD`，`MainWindow.tsx` 接收草稿，`lib.rs` 托盘"快速添加"改为发事件、由 JS 定位，`tauri.conf.json` 调整 quickadd 窗口尺寸，capabilities 增加窗口定位和显示器相关权限。
需要在 Windows 上确认：
1. 小窗出现在光标所在显示器右下角、任务栏上方；DPI 缩放 125%/150% 下位置正确
2. 点击别处隐藏后草稿保留；Esc 清空草稿
3. Ctrl+E 后主窗口打开新建表单并带入草稿
4. 托盘"快速添加"同样出现在右下角

## 最新验证状态（2026-10-01）

- Windows 实机完成依赖安装、19 项前端测试、TypeScript 类型检查、8 项 Windows Rust 测试、release exe 构建及便携包打包。
- 已确认实际 SQLite 数据库在 exe 同目录 `data/resmanager.db`，完整性检查通过；自动备份、快捷键及冲突提示、隐藏后剪贴板记录、单实例唤回、用户协助的真实文件拖拽已验证。
- 已修复桌面 AI CORS：使用 `platform.ts` 的 HTTP 插件，权限范围包含自定义端口；本机模拟接口验证通过，真实服务商未联调。
- 原始代码不需要类型或 Rust API 编译修复。具体证据、环境、产物和未覆盖项目见 `VALIDATION.md`。以下保留初始验证清单供回归使用。

## 初始状态：首次编译前检查清单（历史记录）

这份代码写在一个**无法下载 npm 和 cargo 依赖**的环境里，下面列出已验证和未验证的部分：

已验证：
- `npm test` 的 17 个前端逻辑测试全部通过
- `helpers.rs` 的 9 个单元测试（Linux 下单独用 rustc 编译）全部通过
- 用 esbuild 打包前端，在 Chromium 中以浏览器预览模式跑通主要流程，控制台没有报错：浏览、新建、参数填写、搜索框、快速添加、设置、深色主题

**未验证（首次编译时请重点检查并修复）**：
1. `npm run typecheck`：React 组件部分还没有在装好 `@types/react` 的环境里做过类型检查，可能会有少量类型错误
2. `cargo build`：`lib.rs` 里 Tauri 相关的 API 没有实际编译过，重点看托盘 `TrayIconBuilder`（`show_menu_on_left_click`、`icon`）和插件初始化写法是否与解析到的版本一致
3. `helpers.rs` 中 `#[cfg(windows)]` 的分支（`raw_arg`、`creation_flags`、rundll32、`explorer /select`、`cmd /c start`）
4. tauri-plugin-sql 接收绝对路径：`Database.load("sqlite:D:\\...\\data\\resmanager.db")`，必须确认数据库文件确实创建在 exe 目录下，而不是 `%APPDATA%`
5. 全局快捷键 `Alt+Space` 能否注册成功（部分系统被窗口菜单占用），失败时应弹出提示
6. 拖拽文件进主窗口（`getCurrentWindow().onDragDropEvent`）
7. 剪贴板轮询在窗口隐藏时是否仍然运行
8. AI 请求从 WebView 直接 `fetch` 可能被 CORS 拦截；如果出现，改用 `tauri-plugin-http` 从 Rust 端发请求

修复原则：保持现有架构和文件划分，改动最小化；每修好一处就跑一次 `npm test` 和 `cargo test --lib`。

## 代码约定

- 系统能力（剪贴板、文件、窗口、事件）**只能**通过 `src/lib/platform.ts` 调用；在视图里直接 import `@tauri-apps/*` 会破坏浏览器预览模式
- 持久化只能通过 `Store` 接口；新增字段时：更新 `types.ts`，同时改两个 Store 实现；SQLite 表结构的变更一律追加到 `sqliteStore.ts` 的 `MIGRATIONS` 末尾，并把 `SCHEMA_VERSION` 加 1，不要修改已有的迁移；迁移语句必须可以重复执行（三个窗口启动时会同时打开数据库），`ALTER TABLE ADD COLUMN` 这类语句要先查 `pragma table_info` 判断列是否已存在
- 纯逻辑放在 `src/lib/*.ts`（不依赖 React 和平台），并在 `tests/` 里加测试
- 窗口之间通过 `broadcast` / `subscribe` 同步（Tauri 事件；浏览器下用 BroadcastChannel）；数据有变化后调用 `AppState` 里的方法，它们会自动广播 `data-changed`
- 界面文案用中文；颜色一律用 `styles.css` 中的 CSS 变量，不写死
- 不引入大型 UI 框架；新增依赖前先考虑是否确有必要
- Rust 侧：能用纯 std 实现的放进 `helpers.rs` 并写测试，`lib.rs` 只负责胶水代码
- 安全：`open_url` 只允许 http/https/mailto/ftp/file；不要把用户内容拼进 shell 字符串（终端执行是先写入临时脚本文件再运行）

## 提交前检查

1. `npm test` 通过
2. `npm run typecheck` 没有错误
3. `cd src-tauri && cargo test --lib` 通过
4. 如果改了界面：`npm run dev` 在浏览器中检查浅色和深色两种主题
5. 功能有变化时，同步更新 `SPEC.md` 中的勾选项
