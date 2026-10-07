import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { toast, toastError, useApp } from '../lib/app';
import { basename, typeForDroppedPath } from '../lib/detect';
import { descendantIds, folderPath } from '../lib/folders';
import { copyText, isTauri, onFileDrop, pathInfo, subscribe } from '../lib/platform';
import { rank } from '../lib/search';
import { EV_EDIT_DRAFT, openLauncher, openQuickAdd, useBackgroundServices } from '../lib/services';
import { ITEM_TYPES, TYPE_LABEL, blankItem, type Item, type ItemType } from '../lib/types';
import { ConfirmButton, EmptyState, Kbd, TypeBadge, timeAgo } from '../components/common';
import { ItemDetail } from '../components/ItemDetail';
import { ItemEditor } from '../components/ItemEditor';
import { SettingsDialog } from '../components/SettingsDialog';
import { Sidebar, type Filter } from '../components/Sidebar';
import { EV_FOCUS_ITEM } from './Launcher';

type Pane = { mode: 'view'; id: string } | { mode: 'edit'; id: string } | { mode: 'new'; draft: Item } | null;

export function MainWindow() {
  const app = useApp();
  useBackgroundServices(app);

  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [pane, setPane] = useState<Pane>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [newMenu, setNewMenu] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  // theme
  useEffect(() => {
    const root = document.documentElement;
    if (app.settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', app.settings.theme);
  }, [app.settings.theme]);

  // focus item requested by the launcher (Ctrl+E)
  useEffect(() => {
    let disposed = false;
    let un: (() => void) | undefined;
    subscribe<string>(EV_FOCUS_ITEM, (id) => {
      setFilter({ kind: 'all' });
      setQuery('');
      setPane({ mode: 'edit', id });
    }).then((u) => (disposed ? u() : (un = u)));
    return () => {
      disposed = true;
      un?.();
    };
  }, []);

  // draft handed over from the quick-add bar (Ctrl+E)
  useEffect(() => {
    let disposed = false;
    let un: (() => void) | undefined;
    subscribe<Item>(EV_EDIT_DRAFT, (draft) => {
      setFilter({ kind: 'all' });
      setQuery('');
      setPane({ mode: 'new', draft });
    }).then((u) => (disposed ? u() : (un = u)));
    return () => {
      disposed = true;
      un?.();
    };
  }, []);

  // file drops
  const appRef = useRef(app);
  appRef.current = app;
  const filterRef = useRef(filter);
  filterRef.current = filter;
  useEffect(() => {
    let disposed = false;
    let un: (() => void) | undefined;
    onFileDrop(
      async (paths) => {
        try {
          const infos = await pathInfo(paths);
          const a = appRef.current;
          const f = filterRef.current;
          const folderId = f.kind === 'folder' ? f.id : null;
          let last: Item | null = null;
          let added = 0;
          for (const info of infos) {
            if (a.items.some((i) => i.content === info.path || i.meta.installerPath === info.path)) continue;
            const type = typeForDroppedPath(info.path, info.isDir);
            const name = basename(info.path);
            const item =
              type === 'software'
                ? blankItem('software', {
                    title: name.replace(/\.(exe|msi|lnk|zip|7z|rar|appx|msix)$/i, ''),
                    folderId,
                    meta: { installerPath: info.path },
                  })
                : blankItem('file', { title: name, content: info.path, folderId, meta: { isDir: info.isDir } });
            last = await a.saveItem(item);
            added++;
          }
          if (added) toast(`已收录 ${added} 个${added < infos.length ? `（${infos.length - added} 个已存在）` : ''}`);
          else toast('这些路径都已收录过');
          if (last) setPane({ mode: 'view', id: last.id });
        } catch (e) {
          toastError(e);
        }
      },
      (h) => setDragging(h),
    ).then((u) => (disposed ? u() : (un = u)));
    return () => {
      disposed = true;
      un?.();
    };
  }, []);

  // check which file paths are missing (on load and when items change)
  const pathSig = useMemo(
    () =>
      app.items
        .filter((i) => i.type === 'file' || (i.type === 'software' && i.meta.installerPath))
        .map((i) => i.id + '|' + (i.type === 'file' ? i.content : i.meta.installerPath))
        .join('\n'),
    [app.items],
  );
  useEffect(() => {
    if (!app.ready || !isTauri) return;
    const t = setTimeout(async () => {
      const list = pathSig
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const i = l.indexOf('|');
          return { id: l.slice(0, i), path: l.slice(i + 1) };
        });
      try {
        const infos = await pathInfo(list.map((x) => x.path));
        setMissing(new Set(list.filter((_, i) => !infos[i]?.exists).map((x) => x.id)));
      } catch {
        /* ignore */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [pathSig, app.ready]);

  // keyboard shortcuts inside the main window
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (ctrl && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        startNew('command');
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const filtered = useMemo(() => {
    let base = app.items;
    switch (filter.kind) {
      case 'pinned':
        base = base.filter((i) => i.pinned);
        break;
      case 'recent':
        base = base.filter((i) => i.lastUsedAt).sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
        break;
      case 'unfiled':
        base = base.filter((i) => !i.folderId);
        break;
      case 'type':
        base = base.filter((i) => i.type === filter.type);
        break;
      case 'folder': {
        const ids = descendantIds(app.folders, filter.id);
        base = base.filter((i) => i.folderId && ids.has(i.folderId));
        break;
      }
      case 'tag':
        base = base.filter((i) => i.tags.includes(filter.tag));
        break;
    }
    if (filter.kind === 'recent' && !query.trim()) return base.slice(0, 100);
    return rank(base, app.keys, query, Date.now(), 1000);
  }, [app.items, app.folders, app.keys, filter, query]);

  const selectedId = pane && pane.mode !== 'new' ? pane.id : null;
  const selected = selectedId ? app.items.find((i) => i.id === selectedId) ?? null : null;

  // keep a selection when the list changes
  useEffect(() => {
    if (pane === null && filtered.length && filter.kind !== 'clips') setPane({ mode: 'view', id: filtered[0].id });
    if (pane && pane.mode !== 'new' && app.ready && !app.items.some((i) => i.id === pane.id)) setPane(null);
  }, [filtered, pane, app.items, app.ready, filter.kind]);

  function startNew(type: ItemType) {
    setNewMenu(false);
    const folderId = filter.kind === 'folder' ? filter.id : null;
    const tags = filter.kind === 'tag' ? [filter.tag] : [];
    setPane({ mode: 'new', draft: blankItem(type, { folderId, tags }) });
  }

  const onListKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const idx = filtered.findIndex((i) => i.id === selectedId);
    const next = e.key === 'ArrowDown' ? Math.min(idx + 1, filtered.length - 1) : Math.max(idx - 1, 0);
    if (filtered[next]) setPane({ mode: 'view', id: filtered[next].id });
  };

  const heading = (() => {
    switch (filter.kind) {
      case 'all':
        return '全部';
      case 'pinned':
        return '置顶';
      case 'recent':
        return '最近使用';
      case 'unfiled':
        return '未分类';
      case 'type':
        return TYPE_LABEL[filter.type];
      case 'folder':
        return folderPath(app.folders, filter.id);
      case 'tag':
        return '#' + filter.tag;
      case 'clips':
        return '剪贴板历史';
    }
  })();

  if (app.error) {
    return (
      <div className="fatal">
        <h2>启动失败</h2>
        <pre>{app.error}</pre>
        <p>如果提示数据库无法打开，请确认程序所在目录可写，或查看 README 中的常见问题。</p>
      </div>
    );
  }

  return (
    <div className="main">
      <header className="topbar">
        <div className="brand">
          <span className="logo">R</span> ResManager
        </div>
        <div className="search">
          <input
            ref={searchRef}
            value={query}
            placeholder={filter.kind === 'clips' ? '搜索剪贴板…' : `在「${heading}」中搜索（拼音/首字母均可）  Ctrl+F`}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('');
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') onListKey(e);
            }}
          />
        </div>
        <div className="top-actions">
          <div className="dropdown">
            <button className="btn primary" onClick={() => setNewMenu((v) => !v)}>
              + 新建
            </button>
            {newMenu && (
              <>
                <div className="dropdown-mask" onClick={() => setNewMenu(false)} />
                <div className="dropdown-menu">
                  {ITEM_TYPES.map((t) => (
                    <button key={t} onClick={() => startNew(t)}>
                      <TypeBadge type={t} size="sm" /> {TYPE_LABEL[t]}
                    </button>
                  ))}
                  <div className="dropdown-sep" />
                  <button onClick={() => (setNewMenu(false), openQuickAdd())}>快速添加</button>
                </div>
              </>
            )}
          </div>
          <button className="btn" onClick={() => openLauncher()} title={app.settings.hotkeyLauncher}>
            搜索框
          </button>
          <button className="btn icon" onClick={() => setShowSettings(true)} title="设置">
            ⚙
          </button>
        </div>
      </header>

      <div className="layout">
        <Sidebar
          filter={filter}
          onFilter={(f) => {
            setFilter(f);
            setPane(null);
          }}
        />

        {filter.kind === 'clips' ? (
          <ClipsPanel query={query} />
        ) : (
          <>
            <section className="list" tabIndex={0} onKeyDown={onListKey}>
              <div className="list-head">
                <span className="ellipsis">{heading}</span>
                <span className="muted">{filtered.length} 条</span>
              </div>
              <div className="list-body">
                {filtered.map((it) => (
                  <div
                    key={it.id}
                    className={'row-item' + (it.id === selectedId ? ' sel' : '')}
                    onClick={() => setPane({ mode: 'view', id: it.id })}
                    onDoubleClick={() => setPane({ mode: 'edit', id: it.id })}
                  >
                    <TypeBadge type={it.type} size="sm" />
                    <div className="ri-main">
                      <div className="ri-title">
                        {it.pinned && <span className="pin">●</span>}
                        <span className="ellipsis">{it.title}</span>
                        {missing.has(it.id) && <span className="badge-warn">失效</span>}
                      </div>
                      <div className="ri-sub ellipsis">{subline(it)}</div>
                      {it.tags.length > 0 && (
                        <div className="ri-tags">
                          {it.tags.slice(0, 4).map((t) => (
                            <span key={t} className="tag small">
                              #{t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {app.ready && filtered.length === 0 && (
                  <EmptyState
                    title={query ? '没有匹配的条目' : '这里还是空的'}
                    hint={query ? '换个关键词，或试试拼音首字母' : '点「+ 新建」，或把文件拖进窗口'}
                  />
                )}
              </div>
            </section>

            <section className="pane">
              {pane?.mode === 'new' && (
                <div className="pane-inner">
                  <h2 className="pane-title">新建条目</h2>
                  <ItemEditor
                    key={pane.draft.id}
                    initial={pane.draft}
                    onCancel={() => setPane(null)}
                    onSave={async (it) => {
                      const saved = await app.saveItem(it);
                      toast('已保存');
                      setPane({ mode: 'view', id: saved.id });
                    }}
                  />
                </div>
              )}
              {pane?.mode === 'edit' && selected && (
                <div className="pane-inner">
                  <h2 className="pane-title">编辑</h2>
                  <ItemEditor
                    key={selected.id}
                    initial={selected}
                    onCancel={() => setPane({ mode: 'view', id: selected.id })}
                    onSave={async (it) => {
                      await app.saveItem(it);
                      toast('已保存');
                      setPane({ mode: 'view', id: it.id });
                    }}
                  />
                </div>
              )}
              {pane?.mode === 'view' && selected && (
                <div className="pane-inner">
                  <ItemDetail
                    item={selected}
                    missing={missing.has(selected.id)}
                    onEdit={() => setPane({ mode: 'edit', id: selected.id })}
                    onDeleted={() => setPane(null)}
                  />
                </div>
              )}
              {!pane && app.ready && (
                <EmptyState
                  title="选择左侧条目查看详情"
                  hint={`${app.settings.hotkeyLauncher} 随时呼出搜索，${app.settings.hotkeyQuickAdd} 快速添加`}
                />
              )}
            </section>
          </>
        )}
      </div>

      <footer className="statusbar">
        <span>
          {app.items.length} 条 · {app.folders.length} 个文件夹
        </span>
        <span className="ellipsis" title={app.paths?.data}>
          数据：{app.paths?.data ?? '…'}
        </span>
        <span>
          <Kbd>{app.settings.hotkeyLauncher || '未设置'}</Kbd> 搜索 <Kbd>{app.settings.hotkeyQuickAdd || '未设置'}</Kbd>{' '}
          添加
        </span>
        {!isTauri && <span className="preview-flag">浏览器预览模式</span>}
      </footer>

      {dragging && (
        <div className="drop-mask">
          <div className="drop-card">
            松开以收录（只记录路径，不复制文件）
            {filter.kind === 'folder' && <div className="muted">将放入「{heading}」</div>}
          </div>
        </div>
      )}

      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
    </div>
  );
}

function subline(it: Item): string {
  switch (it.type) {
    case 'software':
      return [it.meta.version && 'v' + it.meta.version, it.content || it.meta.website || it.meta.installerPath]
        .filter(Boolean)
        .join(' · ');
    default:
      return it.content.replace(/\s+/g, ' ').slice(0, 160);
  }
}

function ClipsPanel({ query }: { query: string }) {
  const app = useApp();
  const q = query.trim().toLowerCase();
  const list = q ? app.clips.filter((c) => c.content.toLowerCase().includes(q)) : app.clips;
  return (
    <section className="clips">
      <div className="list-head">
        <span>
          剪贴板历史
          {!app.settings.clipEnabled && <span className="muted">（已关闭，可在设置中开启）</span>}
        </span>
        <span className="row gap-s">
          <span className="muted">
            保留最近 {app.settings.clipMaxCount} 条 / {app.settings.clipMaxDays} 天
          </span>
          {app.clips.length > 0 && (
            <ConfirmButton className="btn small danger" onConfirm={() => app.clearClips()}>
              清空
            </ConfirmButton>
          )}
        </span>
      </div>
      <div className="clips-body">
        {list.map((c) => (
          <div key={c.id} className="clip-card">
            <pre className="mono">{c.content.length > 1200 ? c.content.slice(0, 1200) + '…' : c.content}</pre>
            <div className="clip-foot">
              <span className="muted">{timeAgo(c.createdAt)}</span>
              <span className="row gap-s">
                <button
                  className="link-btn"
                  onClick={() =>
                    copyText(c.content)
                      .then(() => toast('已复制'))
                      .catch(toastError)
                  }
                >
                  复制
                </button>
                <button className="link-btn" onClick={() => openQuickAdd(c.content)}>
                  收藏为条目
                </button>
                <button className="link-btn danger" onClick={() => app.deleteClip(c.id)}>
                  删除
                </button>
              </span>
            </div>
          </div>
        ))}
        {list.length === 0 && (
          <EmptyState
            title="暂无剪贴板记录"
            hint={isTauri ? '复制的文本会临时出现在这里，觉得有用就收藏' : '浏览器预览模式不监听剪贴板'}
          />
        )}
      </div>
    </section>
  );
}
