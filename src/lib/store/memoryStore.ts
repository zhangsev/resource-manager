import type { Clip, Folder, Item } from '../types';
import type { Store } from './types';

interface Snapshot {
  items: Item[];
  folders: Folder[];
  clips: Clip[];
  settings: string | null;
}

/** Browser preview store. Everything lives in memory and is mirrored to localStorage when available. */
export class MemoryStore implements Store {
  readonly kind = 'memory' as const;
  private s: Snapshot = { items: [], folders: [], clips: [], settings: null };

  constructor(private key = 'resmanager-preview', private persist = true) {}

  async init(): Promise<void> {
    if (!this.persist) return;
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) this.s = { ...this.s, ...JSON.parse(raw) };
    } catch {
      /* storage unavailable: stay in memory */
    }
  }

  private save() {
    if (!this.persist) return;
    try {
      localStorage.setItem(this.key, JSON.stringify(this.s));
    } catch {
      /* ignore */
    }
  }

  async listItems() {
    return this.s.items.map((i) => ({ ...i, tags: [...i.tags], meta: { ...i.meta } }));
  }
  async saveItem(item: Item) {
    await this.saveItems([item]);
  }
  async saveItems(items: Item[]) {
    for (const item of items) {
      const idx = this.s.items.findIndex((i) => i.id === item.id);
      if (idx >= 0) this.s.items[idx] = { ...item };
      else this.s.items.push({ ...item });
    }
    this.save();
  }
  async deleteItem(id: string) {
    this.s.items = this.s.items.filter((i) => i.id !== id);
    this.save();
  }

  async listFolders() {
    return this.s.folders.map((f) => ({ ...f }));
  }
  async saveFolder(folder: Folder) {
    const idx = this.s.folders.findIndex((f) => f.id === folder.id);
    if (idx >= 0) this.s.folders[idx] = { ...folder };
    else this.s.folders.push({ ...folder });
    this.save();
  }
  async deleteFolder(id: string) {
    const f = this.s.folders.find((x) => x.id === id);
    const parent = f?.parentId ?? null;
    this.s.folders = this.s.folders
      .filter((x) => x.id !== id)
      .map((x) => (x.parentId === id ? { ...x, parentId: parent } : x));
    this.s.items = this.s.items.map((i) => (i.folderId === id ? { ...i, folderId: parent } : i));
    this.save();
  }

  async listClips() {
    return [...this.s.clips].sort((a, b) => b.createdAt - a.createdAt);
  }
  async addClip(clip: Clip) {
    this.s.clips = this.s.clips.filter((c) => c.content !== clip.content);
    this.s.clips.push(clip);
    this.save();
  }
  async deleteClip(id: string) {
    this.s.clips = this.s.clips.filter((c) => c.id !== id);
    this.save();
  }
  async clearClips() {
    this.s.clips = [];
    this.save();
  }
  async pruneClips(maxCount: number, maxAgeMs: number) {
    const cutoff = Date.now() - maxAgeMs;
    this.s.clips = this.s.clips
      .filter((c) => c.createdAt >= cutoff)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(0, maxCount));
    this.save();
  }

  async getSettingsJson() {
    return this.s.settings;
  }
  async setSettingsJson(json: string) {
    this.s.settings = json;
    this.save();
  }

  async backupTo(_path: string): Promise<void> {
    throw new Error('浏览器预览模式不支持备份，请使用桌面版');
  }
}
