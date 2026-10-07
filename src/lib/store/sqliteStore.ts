import Database from '@tauri-apps/plugin-sql';
import type { Clip, Folder, Item } from '../types';
import type { Store } from './types';

/**
 * Desktop store on top of tauri-plugin-sql (SQLite via sqlx).
 * Every statement is executed separately; placeholders use $1, $2... (sqlx sqlite style).
 */

const SCHEMA_VERSION = 1;

/**
 * Append new migrations at the end and bump SCHEMA_VERSION. Never edit an existing one.
 * Statements must be idempotent (IF NOT EXISTS, or guarded) because the three windows
 * open the database concurrently at startup.
 */
const MIGRATIONS: string[][] = [
  // v1
  [
    `CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      name TEXT NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      folder_id TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      meta TEXT NOT NULL DEFAULT '{}',
      pinned INTEGER NOT NULL DEFAULT 0,
      use_count INTEGER NOT NULL DEFAULT 0,
      last_used_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_items_folder ON items(folder_id)`,
    `CREATE TABLE IF NOT EXISTS clips (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_clips_created ON clips(created_at)`,
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  ],
];

interface ItemRow {
  id: string;
  type: string;
  title: string;
  content: string;
  folder_id: string | null;
  tags: string;
  meta: string;
  pinned: number;
  use_count: number;
  last_used_at: number | null;
  created_at: number;
  updated_at: number;
}

interface FolderRow {
  id: string;
  parent_id: string | null;
  name: string;
  sort: number;
  created_at: number;
}

function safeJson<T>(s: string, fallback: T): T {
  try {
    const v = JSON.parse(s);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function rowToItem(r: ItemRow): Item {
  return {
    id: r.id,
    type: r.type as Item['type'],
    title: r.title,
    content: r.content,
    folderId: r.folder_id,
    tags: safeJson<string[]>(r.tags, []),
    meta: safeJson(r.meta, {}),
    pinned: !!r.pinned,
    useCount: Number(r.use_count) || 0,
    lastUsedAt: r.last_used_at == null ? null : Number(r.last_used_at),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export class SqliteStore implements Store {
  readonly kind = 'sqlite' as const;
  private db!: Database;

  constructor(private dbPath: string) {}

  async init(): Promise<void> {
    // tauri-plugin-sql joins the part after "sqlite:" onto the app config dir;
    // an absolute path replaces it, which is what makes the data portable.
    this.db = await Database.load(`sqlite:${this.dbPath}`);
    await this.db.execute('PRAGMA journal_mode = WAL');
    await this.db.execute('PRAGMA busy_timeout = 3000');
    await this.db.execute('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
    const rows = await this.db.select<{ version: number }[]>('SELECT version FROM schema_version LIMIT 1');
    let current = rows.length ? Number(rows[0].version) : 0;
    while (current < SCHEMA_VERSION) {
      for (const sql of MIGRATIONS[current]) await this.db.execute(sql);
      current++;
      // single row (rowid 1); all three windows may run init at the same time
      await this.db.execute('INSERT OR REPLACE INTO schema_version (rowid, version) VALUES (1, $1)', [current]);
    }
  }

  async listItems(): Promise<Item[]> {
    const rows = await this.db.select<ItemRow[]>('SELECT * FROM items');
    return rows.map(rowToItem);
  }

  async saveItem(item: Item): Promise<void> {
    await this.db.execute(
      `INSERT OR REPLACE INTO items
        (id, type, title, content, folder_id, tags, meta, pinned, use_count, last_used_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        item.id,
        item.type,
        item.title,
        item.content,
        item.folderId,
        JSON.stringify(item.tags),
        JSON.stringify(item.meta ?? {}),
        item.pinned ? 1 : 0,
        item.useCount,
        item.lastUsedAt,
        item.createdAt,
        item.updatedAt,
      ],
    );
  }

  async saveItems(items: Item[]): Promise<void> {
    for (const it of items) await this.saveItem(it);
  }

  async deleteItem(id: string): Promise<void> {
    await this.db.execute('DELETE FROM items WHERE id = $1', [id]);
  }

  async listFolders(): Promise<Folder[]> {
    const rows = await this.db.select<FolderRow[]>('SELECT * FROM folders');
    return rows.map((r) => ({
      id: r.id,
      parentId: r.parent_id,
      name: r.name,
      sort: Number(r.sort) || 0,
      createdAt: Number(r.created_at),
    }));
  }

  async saveFolder(f: Folder): Promise<void> {
    await this.db.execute(
      'INSERT OR REPLACE INTO folders (id, parent_id, name, sort, created_at) VALUES ($1, $2, $3, $4, $5)',
      [f.id, f.parentId, f.name, f.sort, f.createdAt],
    );
  }

  async deleteFolder(id: string): Promise<void> {
    const rows = await this.db.select<{ parent_id: string | null }[]>(
      'SELECT parent_id FROM folders WHERE id = $1',
      [id],
    );
    const parent = rows.length ? rows[0].parent_id : null;
    await this.db.execute('UPDATE folders SET parent_id = $1 WHERE parent_id = $2', [parent, id]);
    await this.db.execute('UPDATE items SET folder_id = $1 WHERE folder_id = $2', [parent, id]);
    await this.db.execute('DELETE FROM folders WHERE id = $1', [id]);
  }

  async listClips(): Promise<Clip[]> {
    const rows = await this.db.select<{ id: string; content: string; created_at: number }[]>(
      'SELECT * FROM clips ORDER BY created_at DESC',
    );
    return rows.map((r) => ({ id: r.id, content: r.content, createdAt: Number(r.created_at) }));
  }

  async addClip(c: Clip): Promise<void> {
    await this.db.execute('DELETE FROM clips WHERE content = $1', [c.content]);
    await this.db.execute('INSERT INTO clips (id, content, created_at) VALUES ($1, $2, $3)', [
      c.id,
      c.content,
      c.createdAt,
    ]);
  }

  async deleteClip(id: string): Promise<void> {
    await this.db.execute('DELETE FROM clips WHERE id = $1', [id]);
  }

  async clearClips(): Promise<void> {
    await this.db.execute('DELETE FROM clips');
  }

  async pruneClips(maxCount: number, maxAgeMs: number): Promise<void> {
    await this.db.execute('DELETE FROM clips WHERE created_at < $1', [Date.now() - maxAgeMs]);
    await this.db.execute(
      'DELETE FROM clips WHERE id NOT IN (SELECT id FROM clips ORDER BY created_at DESC LIMIT $1)',
      [Math.max(0, maxCount)],
    );
  }

  async getSettingsJson(): Promise<string | null> {
    const rows = await this.db.select<{ value: string }[]>("SELECT value FROM settings WHERE key = 'app'");
    return rows.length ? rows[0].value : null;
  }

  async setSettingsJson(json: string): Promise<void> {
    await this.db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('app', $1)", [json]);
  }

  async backupTo(path: string): Promise<void> {
    // VACUUM INTO produces a consistent single-file copy even while WAL is active.
    const escaped = path.replace(/'/g, "''");
    await this.db.execute(`VACUUM INTO '${escaped}'`);
  }
}
