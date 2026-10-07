import type { Folder } from './types';

export interface FolderNode extends Folder {
  children: FolderNode[];
  depth: number;
}

export function buildTree(folders: Folder[]): FolderNode[] {
  const map = new Map<string, FolderNode>();
  for (const f of folders) map.set(f.id, { ...f, children: [], depth: 0 });
  const roots: FolderNode[] = [];
  for (const n of map.values()) {
    const p = n.parentId ? map.get(n.parentId) : undefined;
    if (p && !isAncestor(map, n.id, p.id)) p.children.push(n);
    else roots.push(n);
  }
  const sortRec = (arr: FolderNode[], depth: number) => {
    arr.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh-CN'));
    for (const n of arr) {
      n.depth = depth;
      sortRec(n.children, depth + 1);
    }
  };
  sortRec(roots, 0);
  return roots;
}

/** true if `maybeAncestor` is `id` itself or one of its ancestors (cycle guard). */
function isAncestor(map: Map<string, Folder>, maybeAncestor: string, id: string): boolean {
  let cur: string | null = id;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (cur === maybeAncestor) return true;
    seen.add(cur);
    cur = map.get(cur)?.parentId ?? null;
  }
  return false;
}

export function flattenTree(nodes: FolderNode[]): FolderNode[] {
  const out: FolderNode[] = [];
  const walk = (arr: FolderNode[]) => {
    for (const n of arr) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

export function folderPath(folders: Folder[], id: string | null): string {
  if (!id) return '';
  const map = new Map(folders.map((f) => [f.id, f]));
  const parts: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = id;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const f = map.get(cur);
    if (!f) break;
    parts.unshift(f.name);
    cur = f.parentId;
  }
  return parts.join(' / ');
}

/** id plus all descendant folder ids */
export function descendantIds(folders: Folder[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
    }
  }
  return out;
}
