import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { parseParams, fillParams } from '../lib/params';
import { TYPE_ICON, TYPE_LABEL, type ItemType } from '../lib/types';

export function TypeBadge({ type, size = 'md' }: { type: ItemType; size?: 'sm' | 'md' }) {
  return (
    <span className={`type-badge t-${type} ${size}`} title={TYPE_LABEL[type]}>
      {TYPE_ICON[type]}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/** Two-step button: first click arms, second click confirms. Avoids blocking native dialogs. */
export function ConfirmButton({
  onConfirm,
  children,
  confirmText = '再点一次确认',
  className = 'btn danger',
}: {
  onConfirm: () => void;
  children: ReactNode;
  confirmText?: string;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={className + (armed ? ' armed' : '')}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmText : children}
    </button>
  );
}

export function TagInput({
  value,
  onChange,
  suggestions,
  placeholder = '输入标签后回车',
}: {
  value: string[];
  onChange: (v: string[]) => void;
  suggestions: string[];
  placeholder?: string;
}) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const parts = raw
      .split(/[,，\s]+/)
      .map((t) => t.trim().replace(/^#/, ''))
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) if (!next.includes(p)) next.push(p);
    onChange(next);
    setText('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
      if (text.trim()) {
        e.preventDefault();
        e.stopPropagation();
        add(text);
      }
    } else if (e.key === 'Backspace' && !text && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  const q = text.trim().toLowerCase();
  const sugg = q ? suggestions.filter((s) => s.toLowerCase().includes(q) && !value.includes(s)).slice(0, 6) : [];
  return (
    <div className="tag-input">
      {value.map((t) => (
        <span key={t} className="tag">
          #{t}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label="移除">
            ×
          </button>
        </span>
      ))}
      <input
        value={text}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => text.trim() && add(text)}
      />
      {sugg.length > 0 && (
        <div className="tag-sugg">
          {sugg.map((s) => (
            <button type="button" key={s} onMouseDown={(e) => e.preventDefault()} onClick={() => add(s)}>
              #{s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 520,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onClose]);
  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Fill {{params}} of a command. Enter confirms. */
export function ParamForm({
  template,
  onDone,
  onCancel,
  confirmLabel = '确定',
}: {
  template: string;
  onDone: (filled: string) => void;
  onCancel: () => void;
  confirmLabel?: string;
}) {
  const params = parseParams(template);
  const [values, setValues] = useState<Record<string, string>>({});
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    first.current?.focus();
  }, []);
  const preview = fillParams(template, values);
  return (
    <form
      className="param-form"
      onSubmit={(e) => {
        e.preventDefault();
        onDone(preview);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      {params.map((p, i) => (
        <label key={p.name} className="field">
          <span>{p.name}</span>
          <input
            ref={i === 0 ? first : undefined}
            value={values[p.name] ?? ''}
            placeholder={p.defaultValue ? `默认：${p.defaultValue}` : ''}
            onChange={(e) => setValues({ ...values, [p.name]: e.target.value })}
          />
        </label>
      ))}
      <pre className="code preview">{preview}</pre>
      <div className="row end">
        <button type="button" className="btn" onClick={onCancel}>
          取消
        </button>
        <button type="submit" className="btn primary">
          {confirmLabel}
        </button>
      </div>
    </form>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
    </div>
  );
}

export function timeAgo(ts: number | null): string {
  if (!ts) return '从未';
  const d = Date.now() - ts;
  if (d < 60000) return '刚刚';
  if (d < 3600000) return `${Math.floor(d / 60000)} 分钟前`;
  if (d < 86400000) return `${Math.floor(d / 3600000)} 小时前`;
  if (d < 30 * 86400000) return `${Math.floor(d / 86400000)} 天前`;
  const t = new Date(ts);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}
