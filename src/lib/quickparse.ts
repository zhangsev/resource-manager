import { autoTitle } from './detect';
import { blankItem, type Folder, type Item, type ItemType } from './types';

/**
 * Quick-add "meta line": one input that holds title, tags and folder.
 *   "清理镜像 #docker #运维 @常用命令"  ->  title 清理镜像, tags [docker, 运维], folder 常用命令
 * Tokens starting with # are tags, a token starting with @ picks a folder, the rest is the title.
 */
export interface MetaLine {
  title: string;
  tags: string[];
  folderId: string | null;
  /** the @text the user typed (even if nothing matched), for showing a hint */
  folderQuery: string | null;
}

export function matchFolder(folders: Folder[], q: string): Folder | null {
  const s = q.trim().toLowerCase();
  if (!s) return null;
  const exact = folders.find((f) => f.name.toLowerCase() === s);
  if (exact) return exact;
  const prefix = folders.filter((f) => f.name.toLowerCase().startsWith(s));
  if (prefix.length) return prefix.sort((a, b) => a.name.length - b.name.length)[0];
  const inc = folders.filter((f) => f.name.toLowerCase().includes(s));
  return inc.length ? inc.sort((a, b) => a.name.length - b.name.length)[0] : null;
}

export function parseMetaLine(line: string, folders: Folder[]): MetaLine {
  const tags: string[] = [];
  const words: string[] = [];
  let folderQuery: string | null = null;
  for (const tok of line.split(/\s+/)) {
    if (!tok) continue;
    if (/^[#＃]./.test(tok)) {
      const t = tok.slice(1).replace(/[,，]+$/, '');
      if (t && !tags.includes(t)) tags.push(t);
    } else if (/^[@＠]./.test(tok)) {
      folderQuery = tok.slice(1);
    } else {
      words.push(tok);
    }
  }
  const folder = folderQuery ? matchFolder(folders, folderQuery) : null;
  return { title: words.join(' '), tags, folderId: folder?.id ?? null, folderQuery };
}

const URL_RE = /^(https?:\/\/|www\.)\S+$/i;

/** Turn the quick-add inputs into an item. A URL typed as "software" becomes its website. */
export function buildQuickItem(type: ItemType, content: string, meta: MetaLine): Item {
  const text = content.trim();
  const base = { tags: meta.tags, folderId: meta.folderId };
  if (type === 'software' && URL_RE.test(text)) {
    return blankItem('software', {
      ...base,
      title: meta.title || autoTitle(text, 'link').split('/')[0],
      meta: { website: text },
    });
  }
  return blankItem(type, { ...base, content: text, title: meta.title || autoTitle(text, type) || '(无标题)' });
}
