import { useMemo, useState, type MouseEvent, type Ref } from 'react';
import { toast, toastError } from '../lib/app';
import { highlight, renderMarkdown } from '../lib/highlight';
import { isSafeHref, linkify } from '../lib/linkify';
import { copyText, openUrl } from '../lib/platform';

/** Open safe links in the system browser; never navigate the app's own webview. */
function openExternal(href: string) {
  if (!isSafeHref(href)) return;
  openUrl(href).catch(toastError);
}

/** Plain text where every http(s)/www URL is a clickable link. */
export function LinkText({ text, className = '' }: { text: string; className?: string }) {
  const segs = useMemo(() => linkify(text), [text]);
  return (
    <span className={'link-text ' + className}>
      {segs.map((s, i) =>
        s.kind === 'url' ? (
          <a
            key={i}
            href={s.href}
            className="ext-link"
            title={s.href}
            onClick={(e) => {
              e.preventDefault();
              openExternal(s.href);
            }}
          >
            {s.text}
          </a>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </span>
  );
}

/** Rendered Markdown (sanitized). Links open externally; code blocks have a copy button. */
export function Markdown({
  source,
  className = '',
  onToggleTask,
}: {
  source: string;
  className?: string;
  /** when given, task-list checkboxes are clickable; receives the task index in source order */
  onToggleTask?: (index: number) => void;
}) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.classList.contains('task-box')) {
      e.preventDefault(); // state comes from the source, re-rendered after saving
      if (onToggleTask) onToggleTask(Number(target.dataset.task));
      return;
    }
    const btn = target.closest('.code-copy');
    if (btn) {
      e.preventDefault();
      const code = btn.closest('.code-block')?.querySelector('code')?.textContent ?? '';
      copyText(code)
        .then(() => toast('代码已复制'))
        .catch(toastError);
      return;
    }
    const a = target.closest('a');
    if (a) {
      e.preventDefault();
      openExternal(a.getAttribute('href') ?? '');
    }
  };
  return (
    <div
      className={'md ' + (onToggleTask ? 'tasks-live ' : '') + className}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Highlighted code (command items). */
export function CodeView({ code, lang }: { code: string; lang: string }) {
  const html = useMemo(() => highlight(code, lang), [code, lang]);
  return (
    <pre className="content-box mono code-view">
      <code className={'hljs language-' + lang} dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}

/** Textarea with an 编辑 / 预览 switch for Markdown fields. */
export function MarkdownField({
  value,
  onChange,
  rows = 6,
  placeholder,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  inputRef?: Ref<HTMLTextAreaElement>;
}) {
  const [preview, setPreview] = useState(false);
  return (
    <div className="md-field">
      <div className="md-tabs">
        <button type="button" className={preview ? '' : 'on'} onClick={() => setPreview(false)}>
          编辑
        </button>
        <button type="button" className={preview ? 'on' : ''} onClick={() => setPreview(true)}>
          预览
        </button>
        <span className="md-hint">支持 Markdown</span>
      </div>
      {preview ? (
        <div className="md-preview" style={{ minHeight: rows * 21 + 14 }}>
          {value.trim() ? <Markdown source={value} /> : <span className="muted">（空）</span>}
        </div>
      ) : (
        <textarea ref={inputRef} rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
      )}
    </div>
  );
}
