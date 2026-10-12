import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import dos from 'highlight.js/lib/languages/dos';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import nginx from 'highlight.js/lib/languages/nginx';
import plaintext from 'highlight.js/lib/languages/plaintext';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import DOMPurify from 'dompurify';
import { createMarkdown, escapeHtml } from './markdown';

// Only the grammars listed in codelang.ts LANGS are bundled (keeps the exe small).
const GRAMMARS = {
  bash, dockerfile, dos, go, ini, java, javascript, json, nginx, plaintext, powershell, python, sql, typescript, xml, yaml,
};
for (const [name, grammar] of Object.entries(GRAMMARS)) hljs.registerLanguage(name, grammar);

/** Highlight `code` as `lang`; returns escaped HTML. Unknown languages fall back to plain escaped text. */
export function highlight(code: string, lang: string): string {
  if (!lang || lang === 'plaintext' || !hljs.getLanguage(lang)) return escapeHtml(code);
  try {
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}

const render = createMarkdown(highlight);

/** Markdown source -> sanitized HTML, safe to inject. */
export function renderMarkdown(src: string): string {
  return DOMPurify.sanitize(render(src), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style'],
  });
}
