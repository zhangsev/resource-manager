import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { primaryAction, secondaryAction, type ActionDef } from '../lib/actions';
import { toastError, useApp } from '../lib/app';
import { folderPath } from '../lib/folders';
import { broadcast, copyText, hideCurrentWindow, isTauri, onWindowFocus, showWindow, subscribe } from '../lib/platform';
import { rank } from '../lib/search';
import { EV_LAUNCHER_OPEN, openQuickAdd } from '../lib/services';
import { TYPE_LABEL, type Clip, type Item } from '../lib/types';
import { Kbd, ParamForm, TypeBadge, timeAgo } from '../components/common';

export const EV_FOCUS_ITEM = 'resmanager://focus-item';

type Mode = 'items' | 'clips';

export function Launcher() {
  const app = useApp();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<Mode>('items');
  const [sel, setSel] = useState(0);
  const [pending, setPending] = useState<{ item: Item; action: ActionDef } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const reset = useCallback(() => {
    setQuery('');
    setMode('items');
    setSel(0);
    setPending(null);
    setFlash(null);
    setTimeout(() => inputRef.current?.focus(), 20);
  }, []);

  const reloadRef = useRef(app.reload);
  reloadRef.current = app.reload;

  useEffect(() => {
    let disposed = false;
    const unsubs: (() => void)[] = [];
    const keep = (u: () => void) => (disposed ? u() : unsubs.push(u));
    subscribe(EV_LAUNCHER_OPEN, () => {
      reset();
      reloadRef.current();
    }).then(keep);
    onWindowFocus((focused) => {
      if (!focused && isTauri) hideCurrentWindow();
    }).then(keep);
    inputRef.current?.focus();
    return () => {
      disposed = true;
      unsubs.forEach((u) => u());
    };
  }, [reset]);

  const results: Item[] = useMemo(
    () => (mode === 'items' ? rank(app.items, app.keys, query, Date.now(), 60) : []),
    [mode, app.items, app.keys, query],
  );
  const clipResults: Clip[] = useMemo(() => {
    if (mode !== 'clips') return [];
    const q = query.trim().toLowerCase();
    return (q ? app.clips.filter((c) => c.content.toLowerCase().includes(q)) : app.clips).slice(0, 100);
  }, [mode, app.clips, query]);

  const count = mode === 'items' ? results.length : clipResults.length;
  useEffect(() => setSel(0), [query, mode]);
  useEffect(() => {
    listRef.current?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const finish = async (msg: string) => {
    setFlash(msg);
    await new Promise((r) => setTimeout(r, 380));
    if (isTauri) await hideCurrentWindow();
    reset();
  };

  const execute = async (item: Item, action: ActionDef | null, filled?: string) => {
    if (!action) return;
    if (action.needsParams && filled === undefined) {
      setPending({ item, action });
      return;
    }
    try {
      const msg = await action.run(item, app.settings, filled);
      setPending(null);
      app.markUsed(item.id).catch(() => {});
      await finish(msg);
    } catch (e) {
      toastError(e);
    }
  };

  const copyClip = async (c: Clip) => {
    try {
      await copyText(c.content);
      await finish('已复制');
    } catch (e) {
      toastError(e);
    }
  };

  const openInMain = async (item: Item) => {
    await showWindow('main');
    await broadcast(EV_FOCUS_ITEM, item.id);
    if (isTauri) await hideCurrentWindow();
  };

  const onKey = (e: KeyboardEvent) => {
    if (pending) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, Math.max(0, count - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Tab') {
      e.preventDefault();
      setMode((m) => (m === 'items' ? 'clips' : 'items'));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (query) setQuery('');
      else if (isTauri) hideCurrentWindow();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (mode === 'items') {
        const it = results[sel];
        if (it) execute(it, e.ctrlKey || e.metaKey ? secondaryAction(it) : primaryAction(it));
      } else {
        const c = clipResults[sel];
        if (!c) return;
        if (e.ctrlKey || e.metaKey) {
          openQuickAdd(c.content);
          if (isTauri) hideCurrentWindow();
        } else copyClip(c);
      }
    } else if (mode === 'items' && e.key.toLowerCase() === 'e' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const it = results[sel];
      if (it) openInMain(it);
    } else if (mode === 'items' && e.key.toLowerCase() === 'n' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      openQuickAdd(query || undefined);
      if (isTauri) hideCurrentWindow();
    } else if (mode === 'clips' && e.key === 'Delete') {
      const c = clipResults[sel];
      if (c) app.deleteClip(c.id);
    }
  };

  const cur = mode === 'items' ? results[sel] : null;
  const curClip = mode === 'clips' ? clipResults[sel] : null;
  const prim = cur ? primaryAction(cur) : null;
  const sec = cur ? secondaryAction(cur) : null;

  return (
    <div className="launcher" onKeyDown={onKey}>
      <div className="launcher-top" data-tauri-drag-region>
        <div className="mode-pill" onClick={() => setMode((m) => (m === 'items' ? 'clips' : 'items'))}>
          {mode === 'items' ? '资源' : '剪贴板'}
        </div>
        <input
          ref={inputRef}
          className="launcher-input"
          value={query}
          placeholder={mode === 'items' ? '搜索命令、文本、链接、软件、文件…（支持拼音）' : '搜索剪贴板历史…'}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
          autoFocus
        />
      </div>

      {pending ? (
        <div className="launcher-param">
          <div className="launcher-param-title">
            <TypeBadge type="command" size="sm" /> {pending.item.title} · 填写参数
          </div>
          <ParamForm
            template={pending.item.content}
            confirmLabel={pending.action.label}
            onCancel={() => {
              setPending(null);
              setTimeout(() => inputRef.current?.focus(), 10);
            }}
            onDone={(filled) => execute(pending.item, pending.action, filled)}
          />
        </div>
      ) : (
        <div className="launcher-body">
          <div className="launcher-list" ref={listRef}>
            {mode === 'items' &&
              results.map((it, i) => (
                <div
                  key={it.id}
                  className={'l-row' + (i === sel ? ' sel' : '')}
                  onMouseMove={() => i !== sel && setSel(i)}
                  onClick={() => execute(it, primaryAction(it))}
                >
                  <TypeBadge type={it.type} size="sm" />
                  <div className="l-main">
                    <div className="l-title">
                      {it.pinned && <span className="pin">●</span>}
                      {it.title}
                    </div>
                    <div className="l-sub">{oneLine(it)}</div>
                  </div>
                </div>
              ))}
            {mode === 'clips' &&
              clipResults.map((c, i) => (
                <div
                  key={c.id}
                  className={'l-row' + (i === sel ? ' sel' : '')}
                  onMouseMove={() => i !== sel && setSel(i)}
                  onClick={() => copyClip(c)}
                >
                  <span className="clip-time">{timeAgo(c.createdAt)}</span>
                  <div className="l-main">
                    <div className="l-title mono">{c.content.split(/\r?\n/)[0].slice(0, 120)}</div>
                  </div>
                </div>
              ))}
            {count === 0 && (
              <div className="l-empty">
                {mode === 'items'
                  ? query
                    ? `没有找到「${query}」。Ctrl+N 把它作为新条目添加`
                    : '还没有任何条目，按 Ctrl+N 添加'
                  : app.settings.clipEnabled
                    ? '剪贴板历史为空'
                    : '剪贴板记录已关闭（可在设置中开启）'}
              </div>
            )}
          </div>
          <div className="launcher-preview">
            {cur && (
              <>
                <div className="pv-head">
                  <TypeBadge type={cur.type} />
                  <div>
                    <div className="pv-title">{cur.title}</div>
                    <div className="pv-meta">
                      {TYPE_LABEL[cur.type]}
                      {cur.folderId ? ' · ' + folderPath(app.folders, cur.folderId) : ''}
                    </div>
                  </div>
                </div>
                <pre className={'pv-body' + (cur.type === 'command' || cur.type === 'file' ? ' mono' : '')}>
                  {previewText(cur)}
                </pre>
                {cur.tags.length > 0 && (
                  <div className="pv-tags">
                    {cur.tags.map((t) => (
                      <span key={t} className="tag">
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
            {curClip && <pre className="pv-body mono">{curClip.content}</pre>}
          </div>
        </div>
      )}

      <div className="launcher-foot">
        {flash ? (
          <span className="flash">✓ {flash}</span>
        ) : mode === 'items' ? (
          <>
            {prim && (
              <span>
                <Kbd>Enter</Kbd> {prim.label}
              </span>
            )}
            {sec && (
              <span>
                <Kbd>Ctrl+Enter</Kbd> {sec.label}
              </span>
            )}
            <span>
              <Kbd>Ctrl+E</Kbd> 编辑
            </span>
            <span>
              <Kbd>Ctrl+N</Kbd> 新建
            </span>
            <span>
              <Kbd>Tab</Kbd> 剪贴板
            </span>
          </>
        ) : (
          <>
            <span>
              <Kbd>Enter</Kbd> 复制
            </span>
            <span>
              <Kbd>Ctrl+Enter</Kbd> 收藏为条目
            </span>
            <span>
              <Kbd>Del</Kbd> 删除
            </span>
            <span>
              <Kbd>Tab</Kbd> 资源
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function oneLine(it: Item): string {
  if (it.type === 'software') return [it.meta.version && 'v' + it.meta.version, it.meta.website, it.content].filter(Boolean).join(' · ');
  return it.content.replace(/\s+/g, ' ').slice(0, 140);
}

function previewText(it: Item): string {
  if (it.type === 'software') {
    const m = it.meta;
    return [
      it.content,
      m.website && `官网：${m.website}`,
      m.version && `版本：${m.version}`,
      m.installerPath && `安装包：${m.installerPath}`,
      m.secret && '敏感信息：••••••',
    ]
      .filter(Boolean)
      .join('\n');
  }
  return [it.content, it.meta.notes].filter(Boolean).join('\n\n');
}
