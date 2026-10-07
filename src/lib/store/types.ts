import type { Clip, Folder, Item } from '../types';

/**
 * Persistence boundary. The UI never talks SQL directly.
 * - SqliteStore: desktop (Tauri + tauri-plugin-sql), data in <exe dir>/data/resmanager.db
 * - MemoryStore: browser preview (`npm run dev` in a normal browser), persisted to localStorage
 * A future web/HTTP mode would add a third implementation here.
 */
export interface Store {
  readonly kind: 'sqlite' | 'memory';
  init(): Promise<void>;

  listItems(): Promise<Item[]>;
  saveItem(item: Item): Promise<void>;
  saveItems(items: Item[]): Promise<void>;
  deleteItem(id: string): Promise<void>;

  listFolders(): Promise<Folder[]>;
  saveFolder(folder: Folder): Promise<void>;
  deleteFolder(id: string): Promise<void>;

  listClips(): Promise<Clip[]>;
  addClip(clip: Clip): Promise<void>;
  deleteClip(id: string): Promise<void>;
  clearClips(): Promise<void>;
  /** keep at most maxCount newest clips and drop those older than maxAgeMs */
  pruneClips(maxCount: number, maxAgeMs: number): Promise<void>;

  getSettingsJson(): Promise<string | null>;
  setSettingsJson(json: string): Promise<void>;

  /** Write a consistent copy of the database to `path`. */
  backupTo(path: string): Promise<void>;
}
