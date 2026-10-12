import { Marked, type Tokens } from 'marked';
import { normalizeLang } from './codelang';
import { isSafeHref, toHref } from './linkify';

/**
 * Markdown -> HTML string. Pure (no DOM), so it is unit tested in node.
 * The UI still passes the result through DOMPurify before inserting it.
 *
 * Rules (see SPEC 4.7):
 *  - raw HTML in the source is shown as text, never interpreted
 *  - links keep only http/https/mailto; clicks are intercepted by the UI and opened in the system browser
 *  - remote images are NOT loaded (privacy on company machines): rendered as a link instead
 *  - fenced code is highlighted only when the fence names a language; every block gets a copy button
 */

export type Highlighter = (code: string, lang: string) => string;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escAttr(s: string): string {
  return escapeHtml(s);
}

export function codeBlockHtml(code: string, lang: string | null, highlight?: Highlighter): string {
  const body = lang && lang !== 'plaintext' && highlight ? highlight(code, lang) : escapeHtml(code);
  const label = lang && lang !== 'plaintext' ? `<span class="code-lang">${escapeHtml(lang)}</span>` : '';
  return (
    `<div class="code-block">${label}<button type="button" class="code-copy" data-copy="1">复制</button>` +
    `<pre><code class="hljs${lang ? ' language-' + escAttr(lang) : ''}">${body}</code></pre></div>`
  );
}

export function createMarkdown(highlight?: Highlighter) {
  const md = new Marked({ gfm: true, breaks: true, async: false });
  md.use({
    renderer: {
      html({ text }: Tokens.HTML | Tokens.Tag) {
        return escapeHtml(text);
      },
      code({ text, lang }: Tokens.Code) {
        return codeBlockHtml(text.replace(/\n$/, ''), normalizeLang(lang), highlight);
      },
      link(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, { href, title, tokens }: Tokens.Link) {
        const inner = this.parser.parseInline(tokens);
        const h = toHref(href ?? '');
        if (!isSafeHref(h)) return inner;
        const t = title ? ` title="${escAttr(title)}"` : ` title="${escAttr(h)}"`;
        return `<a href="${escAttr(h)}" class="ext-link"${t}>${inner}</a>`;
      },
      image({ href, text }: Tokens.Image) {
        const h = href ?? '';
        if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(h)) {
          return `<img src="${escAttr(h)}" alt="${escAttr(text ?? '')}">`;
        }
        const label = escapeHtml(text || '图片');
        if (isSafeHref(h)) {
          return `<a href="${escAttr(h)}" class="ext-link img-link" title="外部图片未加载，点击在浏览器中查看：${escAttr(h)}">🖼 ${label}</a>`;
        }
        return `<span class="img-link">🖼 ${label}</span>`;
      },
    },
  });
  return (src: string): string => md.parse(src ?? '') as string;
}
