import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { toastError, useApp } from '../lib/app';
import { detectType } from '../lib/detect';
import { folderPath } from '../lib/folders';
import { broadcast, hideCurrentWindow, isTauri, onWindowFocus, showWindow, subscribe } from '../lib/platform';
import { buildQuickItem, parseMetaLine } from '../lib/quickparse';
import { EV_EDIT_DRAFT, EV_QUICKADD_OPEN } from '../lib/services';
import { ITEM_TYPES, TYPE_LABEL, blankItem, type ItemType } from '../lib/types';
import { Kbd, TypeBadge } from '../components/common';

/**
 * Minimal quick-add bar (bottom-right of the screen): one content box + one optional
 * "meta" line (title #tag @folder). It does NOT read the clipboard.
 * Enter saves, Esc discards the draft, clicking elsewhere only hides it (draft kept).
 * Ctrl+E hands the draft to the main window's full editor.
 */

const CONTENT_HINT: Record<ItemType, string> = {
  command: '命令，可用 {{参数}} 占位',
  text: '文本 / 笔记',
  link: '网址',
  software: '软件说明，或粘贴官网地址',
  file: '文件或文件夹路径',
};

export function QuickAdd() {
  const app = useApp();
  const [content, setContent] = useState('');
  const [type, setType] = useState<ItemType>('text');
  const [typeTouched, setTypeTouched] = useState(false);
  const [metaLine, setMetaLine] = useState('');
  const [flash, setFlash] = useState<string | null>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const metaRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);

  const focusContent = () =>
    setTimeout(() => {
      const el = contentRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 20);

  /** start a fresh draft; `text` is only given when another view hands over content */
  const reset = useCallback((text = '') => {
    const t = text.trim();
    setContent(t);
    setType(t ? detectType(t) : 'text');
    setTypeTouched(false);
    setMetaLine('');
    setFlash(null);
    savingRef.current = false;
    focusContent();
  }, []);

  const reloadRef = useRef(app.reload);
  reloadRef.current = app.reload;

  useEffect(() => {
    let disposed = false;
    const unsubs: (() => void)[] = [];
    const keep = (u: () => void) => (disposed ? u() : unsubs.push(u));
    subscribe<string | null>(EV_QUICKADD_OPEN, (prefill) => {
      reloadRef.current();
      if (prefill) reset(prefill);
      else focusContent(); // hotkey: keep whatever draft is there
    }).then(keep);
    onWindowFocus((focused) => {
      if (!focused && isTauri && !savingRef.current) hideCurrentWindow();
    }).then(keep);
    return () => {
      disposed = true;
      unsubs.forEach((u) => u());
    };
  }, [reset]);

  const onContent = (v: string) => {
    setContent(v);
    if (!typeTouched) setType(detectType(v));
  };

  const cycleType = (dir = 1) => {
    const i = ITEM_TYPES.indexOf(type);
    setType(ITEM_TYPES[(i + dir + ITEM_TYPES.length) % ITEM_TYPES.length]);
    setTypeTouched(true);
  };

  const meta = useMemo(() => parseMetaLine(metaLine, app.folders), [metaLine, app.folders]);
  const dup = useMemo(() => {
    const t = content.trim();
    return t ? app.items.find((i) => i.content.trim() === t || i.meta.website === t) ?? null : null;
  }, [content, app.items]);
  const preview = content.trim() ? buildQuickItem(type, content, meta) : null;

  /** hide but keep the draft */
  const hide = async () => {
    if (isTauri) await hideCurrentWindow();
  };
  /** Esc / ×: throw the draft away */
  const cancel = async () => {
    reset();
    await hide();
  };

  const save = async () => {
    if (!preview || savingRef.current) return;
    savingRef.current = true;
    try {
      await app.saveItem(preview);
      const where = preview.folderId ? `「${folderPath(app.folders, preview.folderId)}」` : '';
      setFlash(`已保存${where ? '到' + where : ''}`);
      setTimeout(async () => {
        await hide();
        reset();
      }, 450);
    } catch (e) {
      savingRef.current = false;
      toastError(e);
    }
  };

  const expand = async () => {
    const draft = preview ?? blankItem(type, { tags: meta.tags, folderId: meta.folderId, title: meta.title });
    await showWindow('main');
    await broadcast(EV_EDIT_DRAFT, draft);
    reset();
    await hide();
  };

  const onKey = (e: KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (e.key === 'Enter' && (ctrl || !e.shiftKey)) {
      e.preventDefault();
      save();
    } else if (ctrl && e.key.toLowerCase() === 't') {
      e.preventDefault();
      cycleType(e.shiftKey ? -1 : 1);
    } else if (ctrl && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      expand();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      (document.activeElement === metaRef.current ? contentRef.current : metaRef.current)?.focus();
    }
  };

  const mono = type === 'command' || type === 'file';

  return (
    <div className="qa" onKeyDown={onKey}>
      <div className="qa-bar" data-tauri-drag-region>
        <button className="qa-type" onClick={() => cycleType()} title="切换类型（Ctrl+T）">
          <TypeBadge type={type} size="sm" /> {TYPE_LABEL[type]} <span className="qa-caret">▾</span>
        </button>
        <span className="qa-status" data-tauri-drag-region>
          {flash ? (
            <span className="flash">✓ {flash}</span>
          ) : dup ? (
            <span className="qa-warn">已收录过：{dup.title}</span>
          ) : preview ? (
            <span className="muted ellipsis">
              {preview.title}
              {preview.folderId && ` · ${folderPath(app.folders, preview.folderId)}`}
            </span>
          ) : null}
        </span>
        <button className="icon-btn" onClick={cancel} aria-label="放弃并关闭" title="放弃并关闭（Esc）">
          ×
        </button>
      </div>

      <textarea
        ref={contentRef}
        className={'qa-content' + (mono ? ' mono' : '')}
        value={content}
        placeholder={CONTENT_HINT[type]}
        onChange={(e) => onContent(e.target.value)}
        spellCheck={false}
        autoFocus
      />
      <input
        ref={metaRef}
        className="qa-meta"
        value={metaLine}
        placeholder="标题（可不填）  #标签  @文件夹"
        onChange={(e) => setMetaLine(e.target.value)}
        spellCheck={false}
      />
      {(meta.tags.length > 0 || meta.folderQuery) && (
        <div className="qa-chips">
          {meta.tags.map((t) => (
            <span key={t} className="tag small">
              #{t}
            </span>
          ))}
          {meta.folderQuery &&
            (meta.folderId ? (
              <span className="tag small on">📁 {folderPath(app.folders, meta.folderId)}</span>
            ) : (
              <span className="qa-warn">没有叫「{meta.folderQuery}」的文件夹，将放入未分类</span>
            ))}
        </div>
      )}

      <div className="qa-foot">
        <span>
          <Kbd>Enter</Kbd> 保存
        </span>
        <span>
          <Kbd>Shift+Enter</Kbd> 换行
        </span>
        <span>
          <Kbd>Tab</Kbd> 切换输入框
        </span>
        <span>
          <Kbd>Ctrl+T</Kbd> 类型
        </span>
        <span>
          <Kbd>Ctrl+E</Kbd> 完整编辑
        </span>
        <span>
          <Kbd>Esc</Kbd> 放弃
        </span>
      </div>
    </div>
  );
}
