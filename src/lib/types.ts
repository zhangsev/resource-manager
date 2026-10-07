export type ItemType = 'command' | 'text' | 'link' | 'software' | 'file';

export const ITEM_TYPES: ItemType[] = ['command', 'text', 'link', 'software', 'file'];

export const TYPE_LABEL: Record<ItemType, string> = {
  command: '命令',
  text: '文本',
  link: '链接',
  software: '软件',
  file: '文件',
};

export const TYPE_ICON: Record<ItemType, string> = {
  command: '>_',
  text: 'Tx',
  link: '↗',
  software: '◆',
  file: '▤',
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
  /** file: whether the path is a directory (set on drop) */
  isDir?: boolean;
}

/**
 * One resource entry.
 * `content` meaning by type:
 *  - command: the command text (may contain {{param}} placeholders)
 *  - text:    the text / note body
 *  - link:    the URL
 *  - software: description / usage notes
 *  - file:    the absolute path
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
