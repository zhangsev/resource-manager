import { useMemo, useState, type ReactNode } from 'react';
import { toastError, useApp } from '../lib/app';
import { buildTree, descendantIds, type FolderNode } from '../lib/folders';
import { ITEM_TYPES, TYPE_LABEL, newId, type ItemType } from '../lib/types';
import { TypeBadge } from './common';

export type Filter =
  | { kind: 'all' }
  | { kind: 'pinned' }
  | { kind: 'recent' }
  | { kind: 'unfiled' }
  | { kind: 'type'; type: ItemType }
  | { kind: 'folder'; id: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'clips' };

export function sameFilter(a: Filter, b: Filter): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'type' && b.kind === 'type') return a.type === b.type;
  if (a.kind === 'folder' && b.kind === 'folder') return a.id === b.id;
  if (a.kind === 'tag' && b.kind === 'tag') return a.tag === b.tag;
  return true;
}

type EditState = { mode: 'new'; parentId: string | null } | { mode: 'rename'; id: string } | null;

export function Sidebar({ filter, onFilter }: { filter: Filter; onFilter: (f: Filter) => void }) {
  const app = useApp();
  const { items, folders, allTags, clips } = app;
  const [edit, setEdit] = useState<EditState>(null);
  const [name, setName] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showAllTags, setShowAllTags] = useState(false);

  const tree = useMemo(() => buildTree(folders), [folders]);

  const counts = useMemo(() => {
    const byType = new Map<ItemType, number>();
    const byFolder = new Map<string, number>();
    let pinned = 0;
    let unfiled = 0;
    for (const it of items) {
      byType.set(it.type, (byType.get(it.type) ?? 0) + 1);
      if (it.folderId) byFolder.set(it.folderId, (byFolder.get(it.folderId) ?? 0) + 1);
      else unfiled++;
      if (it.pinned) pinned++;
    }
    return { byType, byFolder, pinned, unfiled };
  }, [items]);

  const folderTotal = (id: string) => {
    let n = 0;
    for (const f of descendantIds(folders, id)) n += counts.byFolder.get(f) ?? 0;
    return n;
  };

  const commit = async () => {
    const n = name.trim();
    const e = edit;
    setEdit(null);
    setName('');
    if (!n || !e) return;
    try {
      if (e.mode === 'new') {
        const siblings = folders.filter((f) => f.parentId === e.parentId);
        await app.saveFolder({
          id: newId(),
          parentId: e.parentId,
          name: n,
          sort: siblings.length,
          createdAt: Date.now(),
        });
        if (e.parentId) setCollapsed((c) => {
          const s = new Set(c);
          s.delete(e.parentId!);
          return s;
        });
      } else {
        const f = folders.find((x) => x.id === e.id);
        if (f) await app.saveFolder({ ...f, name: n });
      }
    } catch (err) {
      toastError(err);
    }
  };

  const nameInput = (
    <input
      className="side-input"
      autoFocus
      value={name}
      placeholder="文件夹名称"
      onChange={(e) => setName(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setEdit(null);
          setName('');
        }
      }}
    />
  );

  const Row = ({ f, label, count, icon }: { f: Filter; label: string; count?: number; icon?: ReactNode }) => (
    <div className={'side-row' + (sameFilter(filter, f) ? ' on' : '')} onClick={() => onFilter(f)}>
      {icon && <span className="side-icon">{icon}</span>}
      <span className="side-label">{label}</span>
      {count !== undefined && <span className="side-count">{count}</span>}
    </div>
  );

  const renderFolder = (n: FolderNode) => {
    const isOpen = !collapsed.has(n.id);
    const on = filter.kind === 'folder' && filter.id === n.id;
    return (
      <div key={n.id}>
        {edit?.mode === 'rename' && edit.id === n.id ? (
          <div className="side-row" style={{ paddingLeft: 10 + n.depth * 14 }}>
            {nameInput}
          </div>
        ) : (
          <div
            className={'side-row folder' + (on ? ' on' : '')}
            style={{ paddingLeft: 10 + n.depth * 14 }}
            onClick={() => onFilter({ kind: 'folder', id: n.id })}
            onDoubleClick={() => {
              setEdit({ mode: 'rename', id: n.id });
              setName(n.name);
            }}
          >
            <span
              className={'caret' + (n.children.length ? '' : ' hidden')}
              onClick={(e) => {
                e.stopPropagation();
                setCollapsed((c) => {
                  const s = new Set(c);
                  if (s.has(n.id)) s.delete(n.id);
                  else s.add(n.id);
                  return s;
                });
              }}
            >
              {isOpen ? '▾' : '▸'}
            </span>
            <span className="side-label">{n.name}</span>
            <span className="side-actions">
              <button
                title="新建子文件夹"
                onClick={(e) => {
                  e.stopPropagation();
                  setEdit({ mode: 'new', parentId: n.id });
                  setName('');
                }}
              >
                +
              </button>
              <button
                title="重命名"
                onClick={(e) => {
                  e.stopPropagation();
                  setEdit({ mode: 'rename', id: n.id });
                  setName(n.name);
                }}
              >
                ✎
              </button>
              <DeleteFolderButton id={n.id} onDeleted={() => on && onFilter({ kind: 'all' })} />
            </span>
            <span className="side-count">{folderTotal(n.id)}</span>
          </div>
        )}
        {isOpen && n.children.map(renderFolder)}
        {edit?.mode === 'new' && edit.parentId === n.id && (
          <div className="side-row" style={{ paddingLeft: 24 + n.depth * 14 }}>
            {nameInput}
          </div>
        )}
      </div>
    );
  };

  const tags = showAllTags ? allTags : allTags.slice(0, 16);

  return (
    <aside className="sidebar">
      <div className="side-group">
        <Row f={{ kind: 'all' }} label="全部" count={items.length} icon="≡" />
        <Row f={{ kind: 'pinned' }} label="置顶" count={counts.pinned} icon="●" />
        <Row f={{ kind: 'recent' }} label="最近使用" icon="◷" />
        <Row f={{ kind: 'clips' }} label="剪贴板历史" count={clips.length} icon="⎘" />
      </div>

      <div className="side-title">类型</div>
      <div className="side-group">
        {ITEM_TYPES.map((t) => (
          <Row
            key={t}
            f={{ kind: 'type', type: t }}
            label={TYPE_LABEL[t]}
            count={counts.byType.get(t) ?? 0}
            icon={<TypeBadge type={t} size="sm" />}
          />
        ))}
      </div>

      <div className="side-title row between">
        <span>文件夹</span>
        <button
          className="icon-btn small"
          title="新建文件夹"
          onClick={() => {
            setEdit({ mode: 'new', parentId: null });
            setName('');
          }}
        >
          +
        </button>
      </div>
      <div className="side-group">
        <Row f={{ kind: 'unfiled' }} label="未分类" count={counts.unfiled} icon="○" />
        {tree.map(renderFolder)}
        {edit?.mode === 'new' && edit.parentId === null && <div className="side-row">{nameInput}</div>}
      </div>

      {allTags.length > 0 && (
        <>
          <div className="side-title">标签</div>
          <div className="side-tags">
            {tags.map((t) => (
              <button
                key={t}
                className={'tag' + (filter.kind === 'tag' && filter.tag === t ? ' on' : '')}
                onClick={() => onFilter({ kind: 'tag', tag: t })}
              >
                #{t}
              </button>
            ))}
            {allTags.length > 16 && (
              <button className="tag more" onClick={() => setShowAllTags((v) => !v)}>
                {showAllTags ? '收起' : `更多 ${allTags.length - 16}`}
              </button>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

function DeleteFolderButton({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const app = useApp();
  const [armed, setArmed] = useState(false);
  return (
    <button
      title={armed ? '再点一次删除（条目会移到上级）' : '删除文件夹'}
      className={armed ? 'armed' : ''}
      onMouseLeave={() => setArmed(false)}
      onClick={async (e) => {
        e.stopPropagation();
        if (!armed) {
          setArmed(true);
          return;
        }
        try {
          await app.deleteFolder(id);
          onDeleted();
        } catch (err) {
          toastError(err);
        }
      }}
    >
      {armed ? '删?' : '×'}
    </button>
  );
}
