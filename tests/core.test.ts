import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchKey, fuzzy, rank, wordInitials, type PinyinFns, type SearchKey } from '../src/lib/search';
import { fillParams, parseParams } from '../src/lib/params';
import { autoTitle, basename, detectType, typeForDroppedPath } from '../src/lib/detect';
import { buildTree, descendantIds, flattenTree, folderPath } from '../src/lib/folders';
import { mergeImport, parseImport, toExportJson, toMarkdown } from '../src/lib/exporter';
import { compileIgnore, looksLikePassword, shouldRecordClip } from '../src/lib/clipfilter';
import { parseSuggestion, suggestTitleAndTags } from '../src/lib/ai';
import { buildQuickItem, matchFolder, parseMetaLine } from '../src/lib/quickparse';
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
  const c = buildQuickItem('command', '  docker ps -a \n', empty);
  assert.equal(c.title, 'docker ps -a');
  assert.equal(c.content, 'docker ps -a');
  const s = buildQuickItem('software', 'https://www.7-zip.org/download.html', parseMetaLine('7-Zip #压缩', []));
  assert.equal(s.title, '7-Zip');
  assert.equal(s.meta.website, 'https://www.7-zip.org/download.html');
  assert.equal(s.content, '');
  assert.deepEqual(s.tags, ['压缩']);
  assert.equal(buildQuickItem('software', 'https://www.7-zip.org/x', empty).title, '7-zip.org');
});
