import { pinyin } from 'pinyin-pro';
import type { PinyinFns } from './search';

const cache = new Map<string, [string, string]>();

function conv(s: string): [string, string] {
  let v = cache.get(s);
  if (v) return v;
  const full = pinyin(s, { toneType: 'none', type: 'array', nonZh: 'consecutive' })
    .join('')
    .replace(/\s+/g, '')
    .toLowerCase();
  const initials = pinyin(s, { pattern: 'first', toneType: 'none', type: 'array', nonZh: 'consecutive' })
    .map((x) => x.trim().charAt(0))
    .join('')
    .toLowerCase();
  v = [full, initials];
  if (cache.size > 5000) cache.clear();
  cache.set(s, v);
  return v;
}

export const pinyinFns: PinyinFns = {
  full: (s) => conv(s)[0],
  initials: (s) => conv(s)[1],
};
