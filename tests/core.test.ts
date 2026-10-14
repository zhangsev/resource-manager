import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchKey, fuzzy, rank, wordInitials, type PinyinFns, type SearchKey } from '../src/lib/search';
import { fillParams, parseParams } from '../src/lib/params';
import { autoTitle, basename, detectType, typeForDroppedPath } from '../src/lib/detect';
import { buildTree, descendantIds, flattenTree, folderPath } from '../src/lib/folders';
import { mergeImport, parseImport, toExportJson, toMarkdown } from '../src/lib/exporter';
import { compileIgnore, looksLikePassword, shouldRecordClip } from '../src/lib/clipfilter';
import { parseSuggestion, suggestTitleAndTags } from '../src/lib/ai';
import { buildQuickItem, hasTodoTokens, matchFolder, parseMetaLine } from '../src/lib/quickparse';
import { MemoryStore } from '../src/lib/store/memoryStore';
import { DEFAULT_SETTINGS, blankItem, type Folder, type Item } from '../src/lib/types';

test('ai: injected transport sends request and parses response', async () => {
  let calls = 0;
  const request: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, 'http://127.0.0.1:18765/v1/chat/completions');
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-key');
    const body = JSON.parse(init?.body as string);
    assert.equal(body.model, 'test-model');
    assert.ok(body.messages[0].content.includes('测试内容'));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"title":"测试标题","tags":["测试"]}' } }] }));
  };
  const result = await suggestTitleAndTags({ ...DEFAULT_SETTINGS, aiBaseUrl: 'http://127.0.0.1:18765/v1/', aiApiKey: 'test-key', aiModel: 'test-model' }, 'text', '测试内容', [], request);
  assert.equal(calls, 1);
  assert.deepEqual(result, { title: '测试标题', tags: ['测试'] });
});

test('ai: transport HTTP errors remain visible', async () => {
  await assert.rejects(
    suggestTitleAndTags(DEFAULT_SETTINGS, 'text', '测试', [], async () => new Response('', { status: 401 })),
    /AI 请求失败：HTTP 401/,
  );
});

// tiny fake pinyin table so tests don't need the dictionary
const table: Record<string, string> = { 清: 'qing', 理: 'li', 镜: 'jing', 像: 'xiang', 端: 'duan', 口: 'kou', 查: 'cha', 看: 'kan', 服: 'fu', 务: 'wu', 器: 'qi' };
const fakePy: PinyinFns = {
  full: (s) => [...s].map((c) => table[c] ?? c.toLowerCase()).join('').replace(/\s+/g, ''),
  initials: (s) => [...s].map((c) => (table[c] ?? c.toLowerCase())[0]).join('').replace(/\s+/g, ''),
};

function keysFor(items: Item[]): Map<string, SearchKey> {
  return new Map(items.map((i) => [i.id, buildSearchKey(i, fakePy)]));
}

test('search: chinese title matched by pinyin and initials', () => {
  const a = blankItem('command', { title: '清理镜像', content: 'docker image prune -a' });
  const b = blankItem('command', { title: '查看端口', content: 'netstat -ano' });
  const items = [a, b];
  const keys = keysFor(items);
  assert.equal(rank(items, keys, 'qljx')[0].id, a.id);
  assert.equal(rank(items, keys, 'qingli')[0].id, a.id);
  assert.equal(rank(items, keys, 'ckdk')[0].id, b.id);
  assert.equal(rank(items, keys, '端口')[0].id, b.id);
});

test('search: every token must match (AND)', () => {
  const a = blankItem('command', { title: 'docker logs', content: 'docker logs -f x' });
  const b = blankItem('command', { title: 'docker ps', content: 'docker ps -a' });
  const items = [a, b];
  const r = rank(items, keysFor(items), 'docker logs');
  assert.equal(r.length, 1);
  assert.equal(r[0].id, a.id);
});

test('search: title prefix beats content match; content still found', () => {
  const a = blankItem('text', { title: 'nginx 配置', content: 'server {}' });
  const b = blankItem('text', { title: '部署笔记', content: '改完 nginx 要 reload' });
  const items = [b, a];
  const r = rank(items, keysFor(items), 'nginx');
  assert.deepEqual(r.map((x) => x.id), [a.id, b.id]);
});

test('search: frequently used item ranks higher among equals', () => {
  const a = blankItem('command', { title: 'git status', useCount: 0 });
  const b = blankItem('command', { title: 'git stash', useCount: 30, lastUsedAt: Date.now() });
  const items = [a, b];
  assert.equal(rank(items, keysFor(items), 'git')[0].id, b.id);
});

test('search: tags and folder path are searchable', () => {
  const a = blankItem('link', { title: 'Grafana', content: 'http://g', tags: ['监控'] });
  const k = new Map([[a.id, buildSearchKey(a, fakePy, '运维 / 看板')]]);
  assert.equal(rank([a], k, '监控').length, 1);
  assert.equal(rank([a], k, '看板').length, 1);
});

test('search: empty query puts pinned first', () => {
  const a = blankItem('text', { title: 'a', updatedAt: 10 });
  const b = blankItem('text', { title: 'b', pinned: true, updatedAt: 1 });
  const items = [a, b];
  assert.equal(rank(items, keysFor(items), '')[0].id, b.id);
});

test('search helpers', () => {
  assert.equal(wordInitials('docker image prune'), 'dip');
  assert.ok(fuzzy('dkr', 'docker') > 0);
  assert.equal(fuzzy('xyz', 'docker'), -1);
});

test('params: parse and fill with defaults', () => {
  const t = 'ssh {{user:root}}@{{host}} -p {{port:22}} # {{host}}';
  assert.deepEqual(parseParams(t), [
    { name: 'user', defaultValue: 'root' },
    { name: 'host', defaultValue: '' },
    { name: 'port', defaultValue: '22' },
  ]);
  assert.equal(fillParams(t, { host: '10.0.0.1' }), 'ssh root@10.0.0.1 -p 22 # 10.0.0.1');
  assert.equal(fillParams(t, { host: 'h', user: 'app', port: '' }), 'ssh app@h -p 22 # h');
  assert.deepEqual(parseParams('no params'), []);
});

test('detect: types from clipboard text', () => {
  assert.equal(detectType('https://github.com/tauri-apps/tauri'), 'link');
  assert.equal(detectType('www.baidu.com'), 'link');
  assert.equal(detectType('D:\\dev\\project\\a.docx'), 'file');
  assert.equal(detectType('\\\\fileserver\\share\\x.xlsx'), 'file');
  assert.equal(detectType('docker ps -a'), 'command');
  assert.equal(detectType('$ kubectl get pods -n prod'), 'command');
  assert.equal(detectType('SELECT * FROM users WHERE id = 1'), 'command');
  assert.equal(detectType('Get-Process | Sort-Object CPU'), 'command');
  assert.equal(detectType('今天开会记得带电脑，还有周报'), 'text');
  assert.equal(detectType('账号: test\n密码在群里'), 'text');
});

test('detect: auto titles', () => {
  assert.equal(autoTitle('https://www.example.com/docs/intro', 'link'), 'example.com/docs/intro');
  assert.equal(autoTitle('D:\\a\\b\\周报.docx', 'file'), '周报.docx');
  assert.equal(autoTitle('$ git log --oneline\nmore', 'command'), 'git log --oneline');
  assert.equal(basename('C:\\x\\y\\'), 'y');
  assert.equal(typeForDroppedPath('C:\\soft\\Everything-1.4.exe', false), 'software');
  assert.equal(typeForDroppedPath('C:\\soft\\notes.txt', false), 'file');
  assert.equal(typeForDroppedPath('C:\\soft', true), 'file');
});

test('folders: tree, path, descendants, cycle safe', () => {
  const f = (id: string, parentId: string | null, name: string): Folder => ({ id, parentId, name, sort: 0, createdAt: 0 });
  const folders = [f('a', null, '常用'), f('b', 'a', 'Docker'), f('c', 'b', '清理'), f('x', 'y', 'X'), f('y', 'x', 'Y')];
  const tree = buildTree(folders);
  const flat = flattenTree(tree);
  assert.equal(flat.length, 5);
  assert.equal(folderPath(folders, 'c'), '常用 / Docker / 清理');
  assert.deepEqual([...descendantIds(folders, 'a')].sort(), ['a', 'b', 'c']);
  assert.equal(flat.find((n) => n.id === 'c')!.depth, 2);
});

test('export/import roundtrip and merge rules', () => {
  const old = blankItem('text', { id: 'i1', title: 'old', updatedAt: 100 });
  const json = toExportJson([{ ...old, title: 'new', updatedAt: 200 }, blankItem('link', { id: 'i2', title: 'L', content: 'http://x' })], [
    { id: 'f1', parentId: null, name: 'F', sort: 0, createdAt: 1 },
  ]);
  const data = parseImport(json);
  const r = mergeImport({ items: [old], folders: [] }, data);
  assert.equal(r.added, 1);
  assert.equal(r.updated, 1);
  assert.equal(r.folders.length, 1);
  const r2 = mergeImport({ items: [{ ...old, updatedAt: 999 }], folders: data.folders }, data);
  assert.equal(r2.updated, 0);
  assert.equal(r2.folders.length, 0);
  assert.throws(() => parseImport('{"foo":1}'));
});

test('markdown export hides secrets by default', () => {
  const s = blankItem('software', { title: 'Tool', meta: { secret: 'ABC-123' } });
  assert.ok(!toMarkdown([s], []).includes('ABC-123'));
  assert.ok(toMarkdown([s], [], true).includes('ABC-123'));
  const c = blankItem('command', { title: 'x', content: 'echo ```' });
  assert.ok(toMarkdown([c], []).includes('````bash'));
});

test('clipboard filter', () => {
  assert.ok(looksLikePassword('Abcdef12345!@'));
  assert.ok(!looksLikePassword('hello world 123'));
  assert.ok(!looksLikePassword('https://Example.com/A1!b'));
  const ign = compileIgnore('^sk-\n# comment\n[invalid(');
  assert.equal(ign.length, 1);
  assert.ok(!shouldRecordClip('sk-abc', ign));
  assert.ok(shouldRecordClip('docker ps', ign));
  assert.ok(!shouldRecordClip('   ', ign));
});

test('ai suggestion parsing', () => {
  const r = parseSuggestion('好的：\n```json\n{"title":"清理镜像","tags":["#docker","运维"]}\n```');
  assert.equal(r.title, '清理镜像');
  assert.deepEqual(r.tags, ['docker', '运维']);
  assert.throws(() => parseSuggestion('no json'));
});

test('memory store: folders delete moves children and items up', async () => {
  const s = new MemoryStore('t', false);
  await s.init();
  await s.saveFolder({ id: 'p', parentId: null, name: 'P', sort: 0, createdAt: 0 });
  await s.saveFolder({ id: 'c', parentId: 'p', name: 'C', sort: 0, createdAt: 0 });
  await s.saveFolder({ id: 'g', parentId: 'c', name: 'G', sort: 0, createdAt: 0 });
  await s.saveItem(blankItem('text', { id: 'it', folderId: 'c' }));
  await s.deleteFolder('c');
  const fs = await s.listFolders();
  assert.equal(fs.find((f) => f.id === 'g')!.parentId, 'p');
  assert.equal((await s.listItems())[0].folderId, 'p');
});

test('memory store: clips dedupe and prune', async () => {
  const s = new MemoryStore('t', false);
  const now = Date.now();
  await s.addClip({ id: '1', content: 'a', createdAt: now - 10 * 86400000 });
  await s.addClip({ id: '2', content: 'b', createdAt: now - 2 });
  await s.addClip({ id: '3', content: 'c', createdAt: now - 1 });
  await s.addClip({ id: '4', content: 'b', createdAt: now });
  assert.equal((await s.listClips()).length, 3);
  await s.pruneClips(1, 7 * 86400000);
  const left = await s.listClips();
  assert.equal(left.length, 1);
  assert.equal(left[0].id, '4');
});

test('quick add: meta line parses title, #tags and @folder', () => {
  const f = (id: string, name: string): Folder => ({ id, parentId: null, name, sort: 0, createdAt: 0 });
  const folders = [f('a', '常用命令'), f('b', 'Docker'), f('c', '常用')];
  const m = parseMetaLine('清理 镜像 #docker #运维 #docker @dock', folders);
  assert.equal(m.title, '清理 镜像');
  assert.deepEqual(m.tags, ['docker', '运维']);
  assert.equal(m.folderId, 'b');
  assert.equal(parseMetaLine('＃全角 ＠常用', folders).folderId, 'c'); // exact beats prefix
  assert.deepEqual(parseMetaLine('＃全角', folders).tags, ['全角']);
  const miss = parseMetaLine('@不存在', folders);
  assert.equal(miss.folderId, null);
  assert.equal(miss.folderQuery, '不存在');
  assert.equal(parseMetaLine('', folders).title, '');
  assert.equal(matchFolder(folders, '命令')!.id, 'a');
});

test('quick add: builds items with auto title', () => {
  const empty = parseMetaLine('', []);
  const c = buildQuickItem('command', '  docker ps -a \n', empty)!;
  assert.equal(c.title, 'docker ps -a');
  assert.equal(c.content, 'docker ps -a');
  const s = buildQuickItem('software', 'https://www.7-zip.org/download.html', parseMetaLine('7-Zip #压缩', []))!;
  assert.equal(s.title, '7-Zip');
  assert.equal(s.meta.website, 'https://www.7-zip.org/download.html');
  assert.equal(s.content, '');
  assert.deepEqual(s.tags, ['压缩']);
  assert.equal(buildQuickItem('software', 'https://www.7-zip.org/x', empty)!.title, '7-zip.org');
});

// ---------------------------------------------------------------- links, languages, markdown

import { isSafeHref, linkify } from '../src/lib/linkify';
import { commandLang, detectLang, normalizeLang } from '../src/lib/codelang';
import { codeBlockHtml, createMarkdown } from '../src/lib/markdown';

test('linkify: finds urls and trims sentence punctuation', () => {
  const segs = linkify('文档见 https://v2.tauri.app/start/。另一个：www.example.com/a?b=1, 完');
  const urls = segs.filter((s) => s.kind === 'url');
  assert.deepEqual(
    urls.map((u) => (u.kind === 'url' ? [u.text, u.href] : [])),
    [
      ['https://v2.tauri.app/start/', 'https://v2.tauri.app/start/'],
      ['www.example.com/a?b=1', 'https://www.example.com/a?b=1'],
    ],
  );
  assert.equal(segs.map((s) => s.text).join(''), '文档见 https://v2.tauri.app/start/。另一个：www.example.com/a?b=1, 完');
  const paren = linkify('(see https://en.wikipedia.org/wiki/Foo_(bar))');
  assert.equal(paren.find((s) => s.kind === 'url')!.text, 'https://en.wikipedia.org/wiki/Foo_(bar)');
  assert.deepEqual(linkify('no links here'), [{ kind: 'text', text: 'no links here' }]);
  assert.ok(isSafeHref('https://a.b') && isSafeHref('mailto:x@y.z'));
  assert.ok(!isSafeHref('javascript:alert(1)') && !isSafeHref('file:///C:/x'));
});

test('code language: detection and aliases', () => {
  assert.equal(detectLang('docker ps -a'), 'bash');
  assert.equal(detectLang('Get-Process | Sort-Object CPU'), 'powershell');
  assert.equal(detectLang('$p = Get-Item .'), 'powershell');
  assert.equal(detectLang('SELECT * FROM t'), 'sql');
  assert.equal(detectLang('netstat -ano | findstr :8080'), 'dos');
  assert.equal(detectLang('echo %PATH%'), 'dos');
  assert.equal(commandLang('docker ps', 'python'), 'python');
  assert.equal(commandLang('docker ps', 'nonsense'), 'bash');
  assert.equal(normalizeLang('Bash'), 'bash');
  assert.equal(normalizeLang('ps1'), 'powershell');
  assert.equal(normalizeLang('yml'), 'yaml');
  assert.equal(normalizeLang('mermaid'), null);
  assert.equal(normalizeLang(''), null);
});

test('markdown: renders gfm, escapes raw html, guards links and images', () => {
  const hl = (code: string, lang: string) => `<span class="hl-${lang}">${code.replace(/</g, '&lt;')}</span>`;
  const render = createMarkdown(hl);
  const html = render(
    [
      '# 标题',
      '- [ ] 待办',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '<script>alert(1)</script>',
      '[ok](https://x.com) [bad](javascript:alert(1))',
      'https://bare.example.com/path',
      '![pic](https://img.example.com/a.png)',
      '```ps1',
      'Get-Date',
      '```',
      '```',
      '<b>plain</b>',
      '```',
      '```mermaid',
      'graph TD',
      '```',
    ].join('\n'),
  );
  assert.ok(html.includes('<h1'));
  assert.ok(html.includes('type="checkbox"'));
  assert.ok(html.includes('<table>'));
  assert.ok(!html.includes('<script>'), 'raw html must be escaped');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('href="https://x.com"'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(html.includes('href="https://bare.example.com/path"'), 'bare urls are autolinked');
  assert.ok(!html.includes('<img'), 'remote images are not loaded');
  assert.ok(html.includes('img-link'));
  assert.ok(html.includes('class="hl-powershell"'), 'named fence is highlighted');
  assert.ok(html.includes('&lt;b&gt;plain&lt;/b&gt;'), 'unnamed fence is escaped, not highlighted');
  assert.ok(!html.includes('hl-mermaid'), 'unknown language is not highlighted');
  assert.equal((html.match(/class="code-copy"/g) ?? []).length, 3, 'every code block has a copy button');
  assert.ok(codeBlockHtml('<x>', null).includes('&lt;x&gt;'));
});

// ---------------------------------------------------------------- todo

import {
  dismiss, dueReminders, formatDue, ringing, formatDueFull, groupTodos, markNotified, parseDue, parsePriority, parseTime,
  reminderTime, setDone, snooze, taskProgress, todoCounts, toggleTask,
} from '../src/lib/todo';

// Wed 2026-10-14 10:30 local time
const NOW = new Date(2026, 9, 14, 10, 30).getTime();
const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

test('todo: time and date parsing', () => {
  assert.deepEqual(parseTime('17:00'), [17, 0]);
  assert.deepEqual(parseTime('下午3点半'), [15, 30]);
  assert.deepEqual(parseTime('晚上8点15'), [20, 15]);
  assert.deepEqual(parseTime('9点'), [9, 0]);
  assert.equal(parseTime('25:00'), null);
  assert.equal(parseDue('明天', undefined, NOW)!.due, at(2026, 10, 15, 18));
  assert.deepEqual(parseDue('周五', '17:00', NOW), { due: at(2026, 10, 16, 17), used: 2 });
  assert.equal(parseDue('周三', undefined, NOW)!.due, at(2026, 10, 14, 18), 'same weekday = today');
  assert.equal(parseDue('周一', undefined, NOW)!.due, at(2026, 10, 19, 18));
  assert.equal(parseDue('下周一', '9:00', NOW)!.due, at(2026, 10, 19, 9));
  assert.equal(parseDue('下周三', undefined, NOW)!.due, at(2026, 10, 21, 18));
  assert.equal(parseDue('10-20', '9点', NOW)!.due, at(2026, 10, 20, 9));
  assert.equal(parseDue('1-5', undefined, NOW)!.due, at(2027, 1, 5, 18), 'past month-day rolls to next year');
  assert.equal(parseDue('2026-12-31', '23:59', NOW)!.due, at(2026, 12, 31, 23, 59));
  assert.equal(parseDue('12月1日', undefined, NOW)!.due, at(2026, 12, 1, 18));
  assert.equal(parseDue('明天17:00', undefined, NOW)!.due, at(2026, 10, 15, 17));
  assert.equal(parseDue('周五下午3点', undefined, NOW)!.due, at(2026, 10, 16, 15));
  assert.equal(parseDue('15:00', undefined, NOW)!.due, at(2026, 10, 14, 15));
  assert.equal(parseDue('9:00', undefined, NOW)!.due, at(2026, 10, 15, 9), 'past time-only means tomorrow');
  assert.equal(parseDue('', '16:00', NOW)!.due, at(2026, 10, 14, 16));
  assert.equal(parseDue('2-30', undefined, NOW), null);
  assert.equal(parseDue('随便', undefined, NOW), null);
  assert.equal(parsePriority('!高'), 'high');
  assert.equal(parsePriority('！低'), 'low');
  assert.equal(parsePriority('!m'), 'mid');
  assert.equal(parsePriority('!!'), null);
});

test('todo: formatting', () => {
  assert.equal(formatDue(at(2026, 10, 14, 15), NOW), '今天 15:00');
  assert.equal(formatDue(at(2026, 10, 15, 9), NOW), '明天 09:00');
  assert.equal(formatDue(at(2026, 10, 13, 9), NOW), '昨天 09:00');
  assert.equal(formatDue(at(2026, 10, 16, 17), NOW), '周五 17:00');
  assert.equal(formatDue(at(2026, 11, 3, 8), NOW), '11-3 08:00');
  assert.equal(formatDueFull(at(2026, 10, 16, 17)), '10-16 周五 17:00');
});

test('todo: grouping, sorting and counts', () => {
  const t = (id: string, meta: object, created = 0) => blankItem('todo', { id, title: id, meta: meta as Item['meta'], createdAt: created });
  const items = [
    t('later', { due: at(2026, 10, 20, 9) }),
    t('overdue', { due: at(2026, 10, 13, 9) }),
    t('todayLow', { due: at(2026, 10, 14, 12), priority: 'low' }),
    t('todayHigh', { due: at(2026, 10, 14, 17), priority: 'high' }),
    t('earlierToday', { due: at(2026, 10, 14, 9) }),
    t('tomorrow', { due: at(2026, 10, 15, 9) }),
    t('nodate', {}),
    t('done1', { done: true, doneAt: 5 }),
    t('done2', { done: true, doneAt: 9 }),
    blankItem('text', { id: 'not-a-todo' }),
  ];
  const groups = groupTodos(items, NOW);
  assert.deepEqual(groups.map((g) => g.group), ['overdue', 'today', 'tomorrow', 'later', 'nodate', 'done']);
  assert.deepEqual(groups[0].items.map((i) => i.id), ['overdue', 'earlierToday'], 'earlier today already passed = overdue');
  assert.deepEqual(groups[1].items.map((i) => i.id), ['todayHigh', 'todayLow'], 'priority first');
  assert.deepEqual(groups[5].items.map((i) => i.id), ['done2', 'done1'], 'recently done first');
  assert.deepEqual(todoCounts(items, NOW), { open: 7, overdue: 2 });
  const d = setDone(items[0], true, NOW);
  assert.equal(d.meta.done, true);
  assert.equal(d.meta.doneAt, NOW);
  assert.equal(setDone(d, false, NOW).meta.doneAt, null);
});

test('todo: offline classification includes reminders overdue by less than a minute', async () => {
  const { hasOfflineReminders } = await import('../src/lib/todo');
  const item = blankItem('todo', { meta: { due: NOW - 5000, remindBefore: 0 } });
  assert.equal(hasOfflineReminders([item], NOW), true);
  assert.equal(hasOfflineReminders([{ ...item, meta: { ...item.meta, due: NOW } }], NOW), false);
  assert.equal(hasOfflineReminders([snooze(item, 10, NOW)], NOW), false);
  assert.equal(hasOfflineReminders([setDone(item, true, NOW)], NOW), false);
});

test('todo: reminders fire once, snooze, offline', () => {
  const due = at(2026, 10, 14, 11);
  const a = blankItem('todo', { id: 'a', meta: { due, remindBefore: 60 } }); // remind 10:00 -> due now
  const b = blankItem('todo', { id: 'b', meta: { due, remindBefore: 15 } }); // 10:45 -> not yet
  const c = blankItem('todo', { id: 'c', meta: { due } }); // no reminder
  const d = blankItem('todo', { id: 'd', meta: { due: at(2026, 10, 10, 9), remindBefore: 0, done: true } });
  assert.equal(reminderTime(a), at(2026, 10, 14, 10));
  assert.equal(reminderTime(c), null);
  assert.deepEqual(dueReminders([a, b, c, d], NOW).map((i) => i.id), ['a']);
  const shown = markNotified(a);
  assert.deepEqual(dueReminders([shown], NOW), [], 'not repeated');
  const later = snooze(shown, 10, NOW);
  assert.deepEqual(dueReminders([later], NOW + 5 * 60000), []);
  assert.deepEqual(dueReminders([later], NOW + 10 * 60000).map((i) => i.id), ['a'], 'snoozed fires again');
  const offline = blankItem('todo', { id: 'o', meta: { due: at(2026, 10, 12, 9), remindBefore: 0 } });
  assert.deepEqual(dueReminders([offline], NOW).map((i) => i.id), ['o'], 'missed while app was closed still shows');
});

test('todo: sub-task progress and toggling skip code fences', () => {
  const src = ['- [ ] 一', '- [x] 二', '```', '- [ ] 代码里的不算', '```', '  * [ ] 三', '1. [X] 四', '> - [ ] 引用里', '- [] 不是任务'].join('\n');
  assert.deepEqual(taskProgress(src), { done: 2, total: 5 });
  const t0 = toggleTask(src, 0);
  assert.ok(t0.startsWith('- [x] 一'));
  const t2 = toggleTask(src, 2);
  assert.ok(t2.includes('  * [x] 三'));
  assert.ok(t2.includes('- [ ] 代码里的不算'));
  assert.ok(toggleTask(src, 3).includes('1. [ ] 四'));
  assert.equal(toggleTask(src, 99), src);
  const html = createMarkdown()(src);
  assert.equal((html.match(/data-task="/g) ?? []).length, 5, 'renderer numbers the same tasks');
  assert.ok(html.includes('data-task="1" checked'));
});

test('quick add: todo shortcut syntax', () => {
  const m = parseMetaLine('交周报 !高 ^周五 17:00 #工作', [], NOW);
  assert.equal(m.title, '交周报');
  assert.equal(m.priority, 'high');
  assert.equal(m.due, at(2026, 10, 16, 17));
  assert.deepEqual(m.tags, ['工作']);
  assert.ok(hasTodoTokens(m));
  assert.equal(parseMetaLine('买菜 ^明天', [], NOW).due, at(2026, 10, 15, 18));
  assert.equal(parseMetaLine('开会 ^ 16:00', [], NOW).due, at(2026, 10, 14, 16));
  assert.equal(parseMetaLine('开会 ^下午3点', [], NOW).due, at(2026, 10, 14, 15));
  const bad = parseMetaLine('x ^某天', [], NOW);
  assert.equal(bad.due, null);
  assert.equal(bad.dueError, '某天');
  assert.equal(bad.title, 'x');
  assert.ok(!hasTodoTokens(parseMetaLine('普通标题 #a', [], NOW)));

  const t = buildQuickItem('todo', '- [ ] 写初稿\n- [ ] 发给老板', m)!;
  assert.equal(t.type, 'todo');
  assert.equal(t.title, '交周报');
  assert.equal(t.meta.priority, 'high');
  assert.equal(t.meta.remindBefore, 0, 'with a due time, remind on time by default');
  assert.ok(t.content.includes('发给老板'));
  const t2 = buildQuickItem('todo', '整理桌面\n- [ ] 扔垃圾', parseMetaLine('', [], NOW))!;
  assert.equal(t2.title, '整理桌面');
  assert.equal(t2.content, '- [ ] 扔垃圾');
  assert.equal(t2.meta.remindBefore, null);
  assert.equal(buildQuickItem('todo', '', parseMetaLine('', [], NOW)), null);
  assert.equal(buildQuickItem('text', '  ', parseMetaLine('标题', [], NOW)), null);
});

test('todo: ringing reminders until done, snoozed or dismissed', () => {
  const a = markNotified(blankItem('todo', { id: 'a', meta: { due: at(2026, 10, 14, 10), remindBefore: 0 } }));
  assert.deepEqual(ringing([a], NOW).map((i) => i.id), ['a']);
  assert.deepEqual(ringing([dismiss(a)], NOW), []);
  assert.deepEqual(ringing([setDone(a, true, NOW)], NOW), []);
  assert.deepEqual(ringing([snooze(a, 10, NOW)], NOW), [], 'snoozed: no longer ringing');
  const fresh = blankItem('todo', { id: 'f', meta: { due: at(2026, 10, 14, 10), remindBefore: 0 } });
  assert.deepEqual(ringing([fresh], NOW), [], 'not shown yet: scheduler fires it first');
});

// ---------------------------------------------------------------- built-in guide

import { GUIDE_ID, GUIDE_TEXT, GUIDE_VERSION, guideItem, guideUpdate } from '../src/lib/guide';

test('guide: inserted once, refreshed only when unedited, respects deletion', () => {
  const g = guideUpdate(undefined, 0, 1000)!;
  assert.equal(g.id, GUIDE_ID);
  assert.equal(g.meta.guideVersion, GUIDE_VERSION);
  assert.equal(guideUpdate(undefined, GUIDE_VERSION), null, 'deleted by the user: not re-added for the same version');
  assert.equal(guideUpdate(g, 0), null, 'already current');
  const old = { ...guideItem(5), meta: { guideVersion: 0 } };
  assert.equal(guideUpdate(old, 0, 9)!.meta.guideVersion, GUIDE_VERSION, 'unedited old copy is refreshed');
  const edited = { ...old, updatedAt: 7 };
  assert.equal(guideUpdate(edited, 0, 9), null, 'edited copy is left alone');
  assert.ok(GUIDE_TEXT.includes('`data\\`'), 'windows path renders with one backslash');
  assert.ok(GUIDE_TEXT.includes('^周五 17:00'));
});
