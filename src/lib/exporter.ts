import { folderPath } from './folders';
import { TYPE_LABEL, type Folder, type Item } from './types';

export interface ExportData {
  app: 'ResManager';
  version: 1;
  exportedAt: number;
  folders: Folder[];
  items: Item[];
}

export function toExportJson(items: Item[], folders: Folder[]): string {
  const data: ExportData = { app: 'ResManager', version: 1, exportedAt: Date.now(), folders, items };
  return JSON.stringify(data, null, 2);
}

export function parseImport(text: string): ExportData {
  const data = JSON.parse(text);
  if (!data || data.app !== 'ResManager' || !Array.isArray(data.items)) {
    throw new Error('不是 ResManager 导出的 JSON 文件');
  }
  return {
    app: 'ResManager',
    version: 1,
    exportedAt: Number(data.exportedAt) || Date.now(),
    folders: Array.isArray(data.folders) ? data.folders : [],
    items: data.items,
  };
}

/**
 * Merge imported records into existing ones.
 * Same id: keep whichever was updated later. New ids: added.
 */
export function mergeImport(
  existing: { items: Item[]; folders: Folder[] },
  incoming: ExportData,
): { items: Item[]; folders: Folder[]; added: number; updated: number } {
  const byId = new Map(existing.items.map((i) => [i.id, i]));
  const changedItems: Item[] = [];
  let added = 0;
  let updated = 0;
  for (const raw of incoming.items) {
    if (!raw || typeof raw.id !== 'string') continue;
    const it = normalizeItem(raw);
    const cur = byId.get(it.id);
    if (!cur) {
      added++;
      changedItems.push(it);
    } else if (it.updatedAt > cur.updatedAt) {
      updated++;
      changedItems.push(it);
    }
  }
  const folderIds = new Set(existing.folders.map((f) => f.id));
  const newFolders = incoming.folders.filter((f) => f && typeof f.id === 'string' && !folderIds.has(f.id));
  return { items: changedItems, folders: newFolders, added, updated };
}

function normalizeItem(raw: Partial<Item>): Item {
  const now = Date.now();
  return {
    id: String(raw.id),
    type: (['command', 'text', 'link', 'software', 'file'] as const).includes(raw.type as never)
      ? (raw.type as Item['type'])
      : 'text',
    title: String(raw.title ?? ''),
    content: String(raw.content ?? ''),
    folderId: raw.folderId ?? null,
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : {},
    pinned: !!raw.pinned,
    useCount: Number(raw.useCount) || 0,
    lastUsedAt: raw.lastUsedAt ? Number(raw.lastUsedAt) : null,
    createdAt: Number(raw.createdAt) || now,
    updatedAt: Number(raw.updatedAt) || now,
  };
}

export function toMarkdown(items: Item[], folders: Folder[], includeSecrets = false): string {
  const groups = new Map<string, Item[]>();
  for (const it of items) {
    const key = folderPath(folders, it.folderId) || '未分类';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(it);
  }
  const lines: string[] = [`# ResManager 导出`, '', `导出时间：${fmtDate(Date.now())}，共 ${items.length} 条`, ''];
  const keys = [...groups.keys()].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  for (const k of keys) {
    lines.push(`## ${k}`, '');
    for (const it of groups.get(k)!) {
      lines.push(`### ${it.title || '(无标题)'}`, '');
      const tagStr = it.tags.length ? ' · ' + it.tags.map((t) => '#' + t).join(' ') : '';
      lines.push(`*${TYPE_LABEL[it.type]}*${tagStr}`, '');
      const m = it.meta || {};
      if (it.type === 'command') lines.push(fence(it.content, 'bash'));
      else if (it.type === 'link') lines.push(`<${it.content}>`);
      else if (it.type === 'file') lines.push('`' + it.content + '`');
      else if (it.content) lines.push(it.content);
      if (m.website) lines.push('', `- 官网：${m.website}`);
      if (m.version) lines.push(`- 版本：${m.version}`);
      if (m.installerPath) lines.push(`- 安装包：\`${m.installerPath}\``);
      if (m.secret) lines.push(`- 敏感信息：${includeSecrets ? m.secret : '（已隐藏）'}`);
      if (m.notes) lines.push('', m.notes);
      lines.push('');
    }
  }
  return lines.join('\n');
}

function fence(s: string, lang: string): string {
  const ticks = s.includes('```') ? '````' : '```';
  return `${ticks}${lang}\n${s}\n${ticks}`;
}

export function fmtDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function stamp(ts = Date.now()): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
