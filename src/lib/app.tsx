import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { folderPath } from './folders';
import { pinyinFns } from './pinyin';
import { getAppPaths, isTauri, broadcast, subscribe, type AppPaths } from './platform';
import { buildSearchKey, type SearchKey } from './search';
import { MemoryStore } from './store/memoryStore';
import { SqliteStore } from './store/sqliteStore';
import type { Store } from './store/types';
import { DEFAULT_SETTINGS, blankItem, newId, type Clip, type Folder, type Item, type Settings } from './types';

// ---------------------------------------------------------------- store singleton

let storePromise: Promise<{ store: Store; paths: AppPaths }> | null = null;

export function getStore(): Promise<{ store: Store; paths: AppPaths }> {
  if (!storePromise) {
    storePromise = (async () => {
      const paths = await getAppPaths();
      const store: Store = isTauri ? new SqliteStore(paths.db, paths.backup) : new MemoryStore();
      await store.init();
      return { store, paths };
    })();
  }
  return storePromise;
}

export async function loadSettings(store: Store): Promise<Settings> {
  const raw = await store.getSettingsJson();
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

// ---------------------------------------------------------------- toast

type ToastKind = 'info' | 'error';
interface Toast {
  id: number;
  text: string;
  kind: ToastKind;
}
let toastListener: ((t: Toast) => void) | null = null;
let toastSeq = 0;
export function toast(text: string, kind: ToastKind = 'info') {
  toastListener?.({ id: ++toastSeq, text, kind });
}
export function toastError(e: unknown) {
  toast(e instanceof Error ? e.message : String(e), 'error');
}

export function Toasts() {
  const [list, setList] = useState<Toast[]>([]);
  useEffect(() => {
    toastListener = (t) => {
      setList((l) => [...l, t]);
      setTimeout(() => setList((l) => l.filter((x) => x.id !== t.id)), t.kind === 'error' ? 4500 : 1800);
    };
    return () => {
      toastListener = null;
    };
  }, []);
  return (
    <div className="toasts">
      {list.map((t) => (
        <div key={t.id} className={'toast ' + t.kind}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- context

export interface AppState {
  ready: boolean;
  error: string | null;
  store: Store | null;
  paths: AppPaths | null;
  items: Item[];
  folders: Folder[];
  clips: Clip[];
  settings: Settings;
  keys: Map<string, SearchKey>;
  allTags: string[];
  reload: () => Promise<void>;
  saveItem: (item: Item) => Promise<Item>;
  /** save bookkeeping changes (reminder state…) without bumping updatedAt; one broadcast */
  patchItems: (items: Item[]) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  markUsed: (id: string) => Promise<void>;
  saveFolder: (f: Folder) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  addClip: (content: string) => Promise<void>;
  deleteClip: (id: string) => Promise<void>;
  clearClips: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside provider');
  return v;
}

const DATA_CHANGED = 'resmanager://data-changed';

/** `primary` = the main window: only it seeds sample data, so hidden windows starting in parallel don't duplicate it. */
export function AppProvider({ children, primary = false }: { children: ReactNode; primary?: boolean }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [paths, setPaths] = useState<AppPaths | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const storeRef = useRef<Store | null>(null);

  const reload = useCallback(async () => {
    const s = storeRef.current;
    if (!s) return;
    const [its, fs, cs, st] = await Promise.all([s.listItems(), s.listFolders(), s.listClips(), loadSettings(s)]);
    setItems(its);
    setFolders(fs);
    setClips(cs);
    setSettings(st);
  }, []);

  useEffect(() => {
    let disposed = false;
    let unsub: (() => void) | null = null;
    (async () => {
      try {
        const { store: s, paths: p } = await getStore();
        storeRef.current = s;
        setStore(s);
        setPaths(p);
        if (primary) await (seedOnce ??= seedIfEmpty(s));
        await reload();
        if (primary) await broadcast(DATA_CHANGED);
        const u = await subscribe(DATA_CHANGED, () => {
          reload().catch(() => {});
        });
        if (disposed) u();
        else unsub = u;
        setReady(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      disposed = true;
      unsub?.();
    };
  }, [reload, primary]);

  const changed = useCallback(async () => {
    await reload();
    await broadcast(DATA_CHANGED);
  }, [reload]);

  const keys = useMemo(() => {
    const m = new Map<string, SearchKey>();
    const pathCache = new Map<string | null, string>();
    for (const it of items) {
      let fp = pathCache.get(it.folderId);
      if (fp === undefined) {
        fp = folderPath(folders, it.folderId);
        pathCache.set(it.folderId, fp);
      }
      m.set(it.id, buildSearchKey(it, pinyinFns, fp));
    }
    return m;
  }, [items, folders]);

  const allTags = useMemo(() => {
    const c = new Map<string, number>();
    for (const it of items) for (const t of it.tags) c.set(t, (c.get(t) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN')).map((e) => e[0]);
  }, [items]);

  const value: AppState = {
    ready,
    error,
    store,
    paths,
    items,
    folders,
    clips,
    settings,
    keys,
    allTags,
    reload,
    saveItem: async (item) => {
      const s = storeRef.current!;
      const next = { ...item, title: item.title.trim(), updatedAt: Date.now() };
      await s.saveItem(next);
      await changed();
      return next;
    },
    patchItems: async (list) => {
      if (!list.length) return;
      await storeRef.current!.saveItems(list);
      await changed();
    },
    deleteItem: async (id) => {
      await storeRef.current!.deleteItem(id);
      await changed();
    },
    markUsed: async (id) => {
      const s = storeRef.current!;
      const it = (await s.listItems()).find((x) => x.id === id);
      if (!it) return;
      await s.saveItem({ ...it, useCount: it.useCount + 1, lastUsedAt: Date.now() });
      await changed();
    },
    saveFolder: async (f) => {
      await storeRef.current!.saveFolder(f);
      await changed();
    },
    deleteFolder: async (id) => {
      await storeRef.current!.deleteFolder(id);
      await changed();
    },
    updateSettings: async (patch) => {
      const s = storeRef.current!;
      const cur = await loadSettings(s);
      await s.setSettingsJson(JSON.stringify({ ...cur, ...patch }));
      await changed();
    },
    addClip: async (content) => {
      const s = storeRef.current!;
      await s.addClip({ id: newId(), content, createdAt: Date.now() });
      const st = await loadSettings(s);
      await s.pruneClips(st.clipMaxCount, st.clipMaxDays * 86400000);
      await changed();
    },
    deleteClip: async (id) => {
      await storeRef.current!.deleteClip(id);
      await changed();
    },
    clearClips: async () => {
      await storeRef.current!.clearClips();
      await changed();
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ---------------------------------------------------------------- first-run samples

let seedOnce: Promise<void> | null = null;

function tomorrowAt(h: number): number {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(h, 0, 0, 0);
  return d.getTime();
}

async function seedIfEmpty(s: Store) {
  const st = await loadSettings(s);
  if (st.seeded) return;
  const existing = await s.listItems();
  if (existing.length === 0) {
    const now = Date.now();
    const fCmd: Folder = { id: newId(), parentId: null, name: '常用命令', sort: 0, createdAt: now };
    const fDocker: Folder = { id: newId(), parentId: fCmd.id, name: 'Docker', sort: 0, createdAt: now };
    const fSoft: Folder = { id: newId(), parentId: null, name: '工具软件', sort: 1, createdAt: now };
    for (const f of [fCmd, fDocker, fSoft]) await s.saveFolder(f);
    const samples: Item[] = [
      // the full 使用说明 is added by services.ensureGuide (also for users upgrading from older versions)
      blankItem('todo', {
        title: '试试待办：整理常用命令',
        tags: ['示例'],
        content: '- [x] 打开 ResManager\n- [ ] 用 Alt+Shift+Space 收录一条命令\n- [ ] 在详情页点一下这里的方框试试',
        meta: { due: tomorrowAt(10), priority: 'mid', remindBefore: 0, done: false },
      }),
      blankItem('command', {
        title: 'Docker 清理无用镜像',
        folderId: fDocker.id,
        tags: ['docker', '清理'],
        content: 'docker image prune -a',
      }),
      blankItem('command', {
        title: 'SSH 登录服务器',
        folderId: fCmd.id,
        tags: ['ssh', '服务器'],
        content: 'ssh {{user:root}}@{{host}} -p {{port:22}}',
      }),
      blankItem('command', {
        title: '查看端口占用',
        folderId: fCmd.id,
        tags: ['网络', 'windows'],
        content: 'netstat -ano | findstr :{{port:8080}}',
      }),
      blankItem('software', {
        title: 'Everything 文件搜索',
        folderId: fSoft.id,
        tags: ['效率'],
        content: '按文件名秒搜全盘文件。',
        meta: { website: 'https://www.voidtools.com/', version: '1.4' },
      }),
      blankItem('link', {
        title: 'Tauri 文档',
        tags: ['开发'],
        content: 'https://v2.tauri.app/',
      }),
    ];
    await s.saveItems(samples);
  }
  await s.setSettingsJson(JSON.stringify({ ...st, seeded: true }));
}
