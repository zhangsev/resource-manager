/** Pure rules for whether a clipboard text should be recorded in history. */

export const MAX_CLIP_LENGTH = 20000;

export function compileIgnore(patterns: string): RegExp[] {
  const out: RegExp[] = [];
  for (const line of patterns.split(/\r?\n/)) {
    const p = line.trim();
    if (!p || p.startsWith('#')) continue;
    try {
      out.push(new RegExp(p, 'i'));
    } catch {
      /* invalid pattern: skip */
    }
  }
  return out;
}

/**
 * Heuristic for secrets that should never land in history even without user patterns:
 * a single token of 12-128 chars mixing upper, lower, digits and symbols, no spaces.
 */
export function looksLikePassword(text: string): boolean {
  const t = text.trim();
  if (t.length < 12 || t.length > 128 || /\s/.test(t)) return false;
  if (/^(https?:\/\/|[a-zA-Z]:\\|\/)/.test(t)) return false;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((r) => r.test(t)).length;
  return classes >= 4;
}

export function shouldRecordClip(text: string, ignore: RegExp[]): boolean {
  const t = text.trim();
  if (!t || t.length > MAX_CLIP_LENGTH) return false;
  if (looksLikePassword(t)) return false;
  return !ignore.some((r) => r.test(t));
}
