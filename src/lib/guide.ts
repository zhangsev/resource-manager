import { blankItem, type Item } from './types';

/**
 * Built-in 使用说明, kept as a normal (pinned) text item so it is searchable and editable.
 * Bump GUIDE_VERSION when the text changes: an unedited copy is refreshed on the next start,
 * a deleted one comes back once (the new version may describe new features), an edited one is left alone.
 */
export const GUIDE_ID = 'builtin-guide';
export const GUIDE_VERSION = 1;

export const GUIDE_TEXT = `欢迎使用 ResManager。这条说明可以随意编辑或删除；升级到有新功能的版本时会自动更新（你改过的话就不会动它）。

## 快捷键（默认，可在设置里改）

| 按键 | 作用 |
|---|---|
| \`Alt+Space\` | 呼出搜索框 |
| \`Alt+Shift+Space\` | 右下角快速添加 |
| \`Ctrl+F\` / \`Ctrl+N\` | 主窗口里搜索 / 新建 |

## 搜索框

- 输入即搜，支持**拼音和首字母**（如 \`qljx\` 找到「清理镜像」），多个词之间是「且」
- \`↑\` \`↓\` 选择，\`Enter\` 主操作（复制 / 打开 / 完成待办），\`Ctrl+Enter\` 次操作（终端执行 / 在文件夹中显示）
- \`Ctrl+E\` 在主窗口编辑，\`Ctrl+N\` 新建，\`Tab\` 切到剪贴板历史，\`Esc\` 关闭

## 快速添加（右下角小窗）

- 第一行写内容，第二行可选：\`标题 #标签 @文件夹\`
- 类型会自动识别，也可以在左上角下拉框选，或按 \`Ctrl+T\` 切换
- \`Enter\` 保存，\`Shift+Enter\` 换行，\`Esc\` 放弃；点别处只是收起，草稿还在
- \`Ctrl+E\` 转到主窗口填写完整信息（软件官网、注册码等）

## 待办

在快速添加的第二行这样写：

\`\`\`text
交周报 !高 ^周五 17:00 #工作
\`\`\`

- \`!高\` \`!中\` \`!低\` 优先级
- \`^\` 后面是时间：今天 / 明天 / 后天 / 周一…周日 / 下周三 / 10-20 / 2026-12-31，可再加 \`17:00\`、\`9点\`、\`下午3点半\`；只写日期默认 18:00
- 写了 \`!\` 或 \`^\` 会自动切换为「待办」；第一行或后面几行写 \`- [ ] 子任务\`
- 有截止时间的待办默认**准时提醒**，可在编辑里改为提前 15 分钟 / 1 小时 / 1 天或不提醒
- 到点后右下角弹出提醒小窗，可「完成」「10 分钟后」「打开」；同时发一条系统通知
- 程序要在后台运行才能准时提醒；没运行期间到期的，下次启动时集中提示
- 侧边栏「待办」显示未完成数量，红色数字是已过期的数量

## 内容显示

- 网址可直接点击，用系统默认浏览器打开
- 文本、备注支持 **Markdown**：标题、列表、表格、代码块；\`- [ ]\` 清单在详情页点一下就能勾选
- 命令自动按 Shell / PowerShell / CMD / SQL 高亮，识别不准可在编辑里指定语言
- 命令里可以写 \`{{参数}}\` 或 \`{{参数:默认值}}\`，使用时再填

## 文件与剪贴板

- 把文件、文件夹、安装包拖进主窗口即可收录（只记路径，不复制文件）；文件被移走会标「失效」
- 复制过的文本会临时出现在「剪贴板历史」，有用的可以收藏为条目；形似密码的内容不会记录

## 数据、备份与升级

- 所有数据在程序所在文件夹的 \`data\\\` 里，整个文件夹拷走就是全部资料
- 每天自动备份到 \`backup\\\`；设置 → 数据与备份里可以立即备份、导出 JSON / Markdown、从 JSON 导入
- **升级**：右键托盘图标「退出」→ 用新的 \`ResManager.exe\` 覆盖旧的 → 启动。新版本第一次启动会先把数据库备份成 \`backup\\upgrade-…db\`，数据自动沿用
- 关闭窗口只是隐藏到托盘，真正退出请用托盘菜单「退出」

## 常见问题

- **快捷键没反应**：多半被其他软件占用，到设置里换一个
- **没有系统通知**：检查 Windows 通知设置 / 专注助手；右下角提醒小窗不受影响
- **SmartScreen 拦截**：程序没有签名，选择「仍要运行」或请 IT 放行
`;

export function guideItem(now = Date.now()): Item {
  return blankItem('text', {
    id: GUIDE_ID,
    title: '使用说明（ResManager）',
    content: GUIDE_TEXT,
    tags: ['说明'],
    pinned: true,
    meta: { guideVersion: GUIDE_VERSION },
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Decide what to do with the built-in guide. Pure.
 * @returns the item to write, or null to leave things as they are.
 */
export function guideUpdate(existing: Item | undefined, versionShown: number, now = Date.now()): Item | null {
  if (!existing) return versionShown < GUIDE_VERSION ? guideItem(now) : null;
  const v = existing.meta.guideVersion ?? 0;
  if (v >= GUIDE_VERSION) return null;
  // createdAt === updatedAt only while nobody has saved the item (saving bumps updatedAt)
  if (existing.updatedAt !== existing.createdAt) return null;
  return { ...guideItem(now), folderId: existing.folderId, tags: existing.tags, pinned: existing.pinned };
}
