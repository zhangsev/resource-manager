export type ItemType = 'command' | 'text' | 'link' | 'software' | 'file' | 'todo';

export const ITEM_TYPES: ItemType[] = ['command', 'text', 'link', 'software', 'file', 'todo'];

export type TodoPriority = 'high' | 'mid' | 'low';

export const TYPE_LABEL: Record<ItemType, string> = {
  command: '命令',
  text: '文本',
  link: '链接',
  software: '软件',
  file: '文件',
  todo: '待办',
};

export const TYPE_ICON: Record<ItemType, string> = {
  command: '>_',
  text: 'Tx',
  link: '↗',
  software: '◆',
  file: '▤',
  todo: '✓',
};

/** Type-specific extra fields. All optional. */
export interface ItemMeta {
  /** link / file / software: free-form remarks */
  notes?: string;
  /** software: website or download page */
  website?: string;
  /** software: version string */
  version?: string;
  /** software: where the installer / portable package lives */
  installerPath?: string;
  /** software: license key, account hint, etc. Masked in the UI. */
  secret?: string;
  /** command: highlight language chosen by the user; empty = auto-detect (see codelang.ts) */
  lang?: string;
  /** file: whether the path is a directory (set on drop) */
  isDir?: boolean;

  // ---- todo (see todo.ts)
  /** due time, ms since epoch */
  due?: number | null;
  priority?: TodoPriority;
  /** minutes before `due` to remind; 0 = on time; null/undefined = no reminder */
  remindBefore?: number | null;
  done?: boolean;
  doneAt?: number | null;
  /** "remind me again later" */
  snoozeUntil?: number | null;
  /** reminder time that has already been shown (prevents repeats) */
  notifiedAt?: number | null;
  /** reminder time the user dismissed with ×（关闭） */
  ackAt?: number | null;

  // ---- built-in guide
  /** version of the built-in 使用说明 this item was generated from */
  guideVersion?: number;
}

/**
 * One resource entry.
 * `content` meaning by type:
 *  - command: the command text (may contain {{param}} placeholders)
 *  - text:    the text / note body
 *  - link:    the URL
 *  - software: description / usage notes
 *  - file:    the absolute path
 *  - todo:    notes / sub-tasks as Markdown ("- [ ] ..."); the task itself is the title
 */
export interface Item {
  id: string;
  type: ItemType;
  title: string;
  content: string;
  folderId: string | null;
  tags: string[];
  meta: ItemMeta;
  pinned: boolean;
  useCount: number;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Folder {
  id: string;
  parentId: string | null;
  name: string;
  sort: number;
  createdAt: number;
}

export interface Clip {
  id: string;
  content: string;
  createdAt: number;
}

export interface Settings {
  hotkeyLauncher: string;
  hotkeyQuickAdd: string;
  clipEnabled: boolean;
  clipMaxCount: number;
  clipMaxDays: number;
  /** one regex per line; matching clipboard text is not recorded */
  clipIgnorePatterns: string;
  terminal: 'cmd' | 'powershell';
  backupKeep: number;
  lastBackupAt: number | null;
  aiEnabled: boolean;
  aiBaseUrl: string;
  aiApiKey: string;
  aiModel: string;
  theme: 'system' | 'light' | 'dark';
  seeded: boolean;
  /** also send a Windows notification when a todo reminder pops up */
  todoSystemNotify: boolean;
  /** app version that last ran on this data (for the upgrade backup) */
  lastVersion: string;
  /** highest built-in guide version already placed into the data */
  guideVersionShown: number;
}

export const DEFAULT_SETTINGS: Settings = {
  hotkeyLauncher: 'Alt+Space',
  hotkeyQuickAdd: 'Alt+Shift+Space',
  clipEnabled: true,
  clipMaxCount: 200,
  clipMaxDays: 7,
  clipIgnorePatterns: '',
  terminal: 'cmd',
  backupKeep: 14,
  lastBackupAt: null,
  aiEnabled: false,
  aiBaseUrl: 'https://api.openai.com/v1',
  aiApiKey: '',
  aiModel: 'gpt-4o-mini',
  theme: 'system',
  seeded: false,
  todoSystemNotify: true,
  lastVersion: '',
  guideVersionShown: 0,
};

export function newId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return Date.now().toString(36) + rand;
}

export function blankItem(type: ItemType, partial: Partial<Item> = {}): Item {
  const now = Date.now();
  return {
    id: newId(),
    type,
    title: '',
    content: '',
    folderId: null,
    tags: [],
    meta: {},
    pinned: false,
    useCount: 0,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}
