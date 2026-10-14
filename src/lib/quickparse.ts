import { autoTitle } from './detect';
import { parseDue, parsePriority } from './todo';
import { blankItem, type Folder, type Item, type ItemType, type TodoPriority } from './types';

/**
 * Quick-add "meta line": one input that holds title, tags, folder and (for todos) priority / due time.
 *   "清理镜像 #docker #运维 @常用命令"        ->  title 清理镜像, tags [docker, 运维], folder 常用命令
 *   "交周报 !高 ^周五 17:00 #工作"            ->  title 交周报, priority high, due Friday 17:00, tag 工作
 * Tokens: #tag, @folder, !高/!中/!低, ^date [time]. Everything else is the title.
 */
export interface MetaLine {
  title: string;
  tags: string[];
  folderId: string | null;
  /** the @text the user typed (even if nothing matched), for showing a hint */
  folderQuery: string | null;
  priority: TodoPriority | null;
  due: number | null;
  /** text after ^ that could not be understood */
  dueError: string | null;
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

export function parseMetaLine(line: string, folders: Folder[], now = Date.now()): MetaLine {
  const tags: string[] = [];
  const words: string[] = [];
  let folderQuery: string | null = null;
  let priority: TodoPriority | null = null;
  let due: number | null = null;
  let dueError: string | null = null;
  const toks = line.split(/\s+/).filter(Boolean);
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    const pr = parsePriority(tok);
    if (pr) {
      priority = pr;
    } else if (/^[\^＾]/.test(tok)) {
      const first = tok.slice(1);
      const r = parseDue(first, toks[i + 1], now);
      if (r) {
        due = r.due;
        dueError = null;
        i += r.used - 1;
      } else {
        dueError = first || '（空）';
      }
    } else if (/^[#＃]./.test(tok)) {
      const t = tok.slice(1).replace(/[,，]+$/, '');
      if (t && !tags.includes(t)) tags.push(t);
    } else if (/^[@＠]./.test(tok)) {
      folderQuery = tok.slice(1);
    } else {
      words.push(tok);
    }
  }
  const folder = folderQuery ? matchFolder(folders, folderQuery) : null;
  return { title: words.join(' '), tags, folderId: folder?.id ?? null, folderQuery, priority, due, dueError };
}

/** Whether the meta line uses todo-only syntax (used to switch the type to 待办 automatically). */
export function hasTodoTokens(m: MetaLine): boolean {
  return m.priority !== null || m.due !== null || m.dueError !== null;
}

const URL_RE = /^(https?:\/\/|www\.)\S+$/i;

/** Turn the quick-add inputs into an item, or null if there is nothing to save. */
export function buildQuickItem(type: ItemType, content: string, meta: MetaLine): Item | null {
  const text = content.trim();
  const base = { tags: meta.tags, folderId: meta.folderId };
  if (type === 'todo') {
    // the task is the meta-line title; without one, the first content line is the task and the rest are sub-tasks
    let title = meta.title;
    let body = text;
    if (!title) {
      const [first, ...rest] = text.split(/\r?\n/);
      title = first.replace(/^\s*(?:[-*+]\s+)?(?:\[[ xX]\]\s*)?/, '').trim();
      body = rest.join('\n').trim();
    }
    if (!title) return null;
    return blankItem('todo', {
      ...base,
      title,
      content: body,
      meta: {
        priority: meta.priority ?? undefined,
        due: meta.due,
        remindBefore: meta.due ? 0 : null,
        done: false,
      },
    });
  }
  if (!text) return null;
  if (type === 'software' && URL_RE.test(text)) {
    return blankItem('software', {
      ...base,
      title: meta.title || autoTitle(text, 'link').split('/')[0],
      meta: { website: text },
    });
  }
  return blankItem(type, { ...base, content: text, title: meta.title || autoTitle(text, type) || '(无标题)' });
}
