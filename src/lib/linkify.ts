/** Split plain text into text / URL segments so URLs can be rendered as clickable links. Pure. */

export type Segment = { kind: 'text'; text: string } | { kind: 'url'; text: string; href: string };

// http(s):// or www. followed by non-space, non-CJK characters
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'　-〿㐀-鿿＀-￯]+/gi;

// punctuation that usually ends a sentence rather than the URL
const TRAILING = /[.,;:!?'")\]}>]+$/;

function trimUrl(raw: string): string {
  let url = raw;
  // keep balanced closing parens, e.g. https://en.wikipedia.org/wiki/Foo_(bar)
  while (TRAILING.test(url)) {
    const last = url[url.length - 1];
    if (last === ')' && (url.match(/\(/g)?.length ?? 0) >= (url.match(/\)/g)?.length ?? 0)) break;
    url = url.slice(0, -1);
  }
  return url;
}

export function toHref(url: string): string {
  return /^www\./i.test(url) ? 'https://' + url : url;
}

/** Only these schemes may ever be opened from rendered content. */
export function isSafeHref(href: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(href.trim());
}

export function linkify(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    const url = trimUrl(m[0]);
    if (!url || url.length < 5) continue;
    if (start > last) out.push({ kind: 'text', text: text.slice(last, start) });
    out.push({ kind: 'url', text: url, href: toHref(url) });
    last = start + url.length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}
