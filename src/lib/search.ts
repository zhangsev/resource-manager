import type { Item } from './types';

/**
 * Pure search / ranking logic. No UI or platform dependencies so it can be unit tested.
 * Pinyin conversion is injected (see pinyin.ts) so tests can run without the dictionary.
 */

export interface PinyinFns {
  /** full pinyin without tones or spaces, lower-case: "清理镜像" -> "qinglijingxiang" */
  full: (s: string) => string;
  /** initials, lower-case: "清理镜像" -> "qljx" */
  initials: (s: string) => string;
}

export const identityPinyin: PinyinFns = {
  full: (s) => s.toLowerCase(),
  initials: (s) => s.toLowerCase(),
};

export interface SearchKey {
  title: string;
  titlePy: string;
  titleInit: string;
  content: string;
  tags: string[];
  tagsPy: string[];
  extra: string; // folder path, notes, website...
}

const HAS_CJK = /[㐀-鿿]/;

export function buildSearchKey(item: Item, py: PinyinFns, folderPath = ''): SearchKey {
  const title = item.title.toLowerCase();
  const hasCjk = HAS_CJK.test(item.title);
  const m = item.meta || {};
  return {
    title,
    titlePy: hasCjk ? py.full(item.title) : title.replace(/\s+/g, ''),
    titleInit: hasCjk ? py.initials(item.title) : wordInitials(title),
    content: item.content.toLowerCase(),
    tags: item.tags.map((t) => t.toLowerCase()),
    tagsPy: item.tags.map((t) => (HAS_CJK.test(t) ? py.initials(t) : t.toLowerCase())),
    extra: [folderPath, m.notes, m.website, m.version, m.installerPath]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  };
}

/** "docker image prune" -> "dip" */
export function wordInitials(s: string): string {
  return s
    .split(/[\s\-_./\\:]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('');
}

/** subsequence match: every char of q appears in s in order. Returns a compactness score 0..1 or -1. */
export function fuzzy(q: string, s: string): number {
  if (!q) return 1;
  let qi = 0;
  let first = -1;
  let last = -1;
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] === q[qi]) {
      if (first < 0) first = i;
      last = i;
      qi++;
    }
  }
  if (qi < q.length) return -1;
  const span = last - first + 1;
  return q.length / span;
}

function isBoundary(s: string, idx: number): boolean {
  if (idx <= 0) return true;
  return /[\s\-_./\\:]/.test(s[idx - 1]);
}

/** Score one query token against a key. 0 = no match. */
export function scoreToken(tok: string, k: SearchKey): number {
  let best = 0;
  const bump = (v: number) => {
    if (v > best) best = v;
  };

  const ti = k.title.indexOf(tok);
  if (ti === 0) bump(100);
  else if (ti > 0) bump(isBoundary(k.title, ti) ? 80 : 60);

  if (k.titleInit.startsWith(tok)) bump(tok.length >= 2 ? 75 : 40);
  else if (tok.length >= 2 && k.titleInit.includes(tok)) bump(45);

  const pi = k.titlePy.indexOf(tok);
  if (pi === 0) bump(70);
  else if (pi > 0 && tok.length >= 2) bump(50);

  for (let i = 0; i < k.tags.length; i++) {
    if (k.tags[i] === tok || k.tagsPy[i] === tok) bump(65);
    else if (k.tags[i].startsWith(tok) || k.tagsPy[i].startsWith(tok)) bump(50);
  }

  if (best === 0 && tok.length >= 2) {
    const f = fuzzy(tok, k.title);
    if (f > 0) bump(15 + 25 * f);
    else {
      const fp = fuzzy(tok, k.titlePy);
      if (fp > 0.5) bump(10 + 15 * fp);
    }
  }

  if (best === 0) {
    if (k.content.includes(tok)) bump(25);
    else if (k.extra.includes(tok)) bump(20);
  }
  return best;
}

const DAY = 86400000;

export function frecency(item: Item, now: number): number {
  let s = Math.log2(1 + item.useCount) * 6;
  if (item.lastUsedAt) {
    const age = now - item.lastUsedAt;
    if (age < DAY) s += 10;
    else if (age < 7 * DAY) s += 5;
    else if (age < 30 * DAY) s += 2;
  }
  if (item.pinned) s += 12;
  return s;
}

export function tokenize(query: string): string[] {
  return query.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

export interface Ranked {
  item: Item;
  score: number;
}

/**
 * Rank items for a query. Every token must match somewhere (AND semantics).
 * Empty query: pinned first, then most recently used / updated.
 */
export function rank(
  items: Item[],
  keys: Map<string, SearchKey>,
  query: string,
  now = Date.now(),
  limit = 200,
): Item[] {
  const toks = tokenize(query);
  if (toks.length === 0) {
    return [...items]
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        const ra = Math.max(a.lastUsedAt ?? 0, a.updatedAt);
        const rb = Math.max(b.lastUsedAt ?? 0, b.updatedAt);
        return rb - ra;
      })
      .slice(0, limit);
  }
  const out: Ranked[] = [];
  for (const it of items) {
    const k = keys.get(it.id);
    if (!k) continue;
    let total = 0;
    let ok = true;
    for (const t of toks) {
      const s = scoreToken(t, k);
      if (s === 0) {
        ok = false;
        break;
      }
      total += s;
    }
    if (!ok) continue;
    out.push({ item: it, score: total / toks.length + frecency(it, now) });
  }
  out.sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt);
  return out.slice(0, limit).map((r) => r.item);
}
