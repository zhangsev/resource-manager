/**
 * Everything that touches the OS goes through here, with a browser fallback so the
 * UI can be previewed with `npm run dev` in a normal browser (no Rust needed).
 */
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { PhysicalPosition, PhysicalSize, cursorPosition, getCurrentWindow, monitorFromPoint, primaryMonitor } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { fetch as nativeFetch } from '@tauri-apps/plugin-http';

export const isTauri: boolean =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as unknown as Record<string, unknown>);

export type ViewName = 'main' | 'launcher' | 'quickadd';

/** Desktop requests use Rust HTTP to avoid WebView CORS; preview keeps browser fetch. */
export const httpFetch: typeof fetch = (input, init) =>
  isTauri ? nativeFetch(input, init) : globalThis.fetch(input, init);

export function currentView(): ViewName {
  if (isTauri) {
    const label = getCurrentWindow().label;
    if (label === 'launcher' || label === 'quickadd') return label;
    return 'main';
  }
  const v = new URLSearchParams(location.search).get('view');
  return v === 'launcher' || v === 'quickadd' ? v : 'main';
}

// ---------------------------------------------------------------- paths

export interface AppPaths {
  base: string;
  data: string;
  db: string;
  backup: string;
  exports: string;
  tmp: string;
  portable: boolean;
}

export async function getAppPaths(): Promise<AppPaths> {
  if (isTauri) return invoke<AppPaths>('app_paths');
  return {
    base: '(浏览器预览)',
    data: '(浏览器预览)/data',
    db: 'localStorage',
    backup: '(浏览器预览)/backup',
    exports: '(浏览器预览)/exports',
    tmp: '(浏览器预览)/tmp',
    portable: false,
  };
}

export function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  return dir.replace(/[\\/]+$/, '') + sep + name;
}

// ---------------------------------------------------------------- clipboard

/** text we wrote ourselves, so the clipboard watcher can ignore it */
let lastWritten = '';
export function lastWrittenByApp(): string {
  return lastWritten;
}

export async function copyText(text: string): Promise<void> {
  lastWritten = text;
  if (isTauri) return writeText(text);
  await navigator.clipboard.writeText(text);
}

export async function readClipboard(): Promise<string> {
  try {
    if (isTauri) return (await readText()) ?? '';
    return await navigator.clipboard.readText();
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------- shell / files

export interface PathInfo {
  path: string;
  exists: boolean;
  isDir: boolean;
  size: number;
}

export async function pathInfo(paths: string[]): Promise<PathInfo[]> {
  if (!paths.length) return [];
  if (isTauri) return invoke<PathInfo[]>('path_info', { paths });
  return paths.map((p) => ({ path: p, exists: true, isDir: /[\\/]$/.test(p), size: 0 }));
}

function browserOnly(what: string): never {
  throw new Error(`浏览器预览模式不支持「${what}」，请使用桌面版`);
}

export async function openPath(path: string): Promise<void> {
  if (isTauri) return invoke('open_path', { path });
  browserOnly('打开文件');
}

export async function revealPath(path: string): Promise<void> {
  if (isTauri) return invoke('reveal_path', { path });
  browserOnly('在文件夹中显示');
}

export async function openUrl(url: string): Promise<void> {
  const u = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url;
  if (isTauri) return invoke('open_url', { url: u });
  window.open(u, '_blank', 'noopener');
}

export async function runInTerminal(command: string, shell: 'cmd' | 'powershell'): Promise<void> {
  if (isTauri) return invoke('run_in_terminal', { command, shell });
  browserOnly('在终端执行');
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  if (isTauri) return invoke('write_text_file', { path, content });
  // browser: download instead
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = path.split(/[\\/]/).pop() || 'export.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function readTextFile(path: string): Promise<string> {
  if (isTauri) return invoke<string>('read_text_file', { path });
  browserOnly('读取文件');
}

export async function pruneBackups(dir: string, keep: number): Promise<number> {
  if (isTauri) return invoke<number>('prune_backups', { dir, keep });
  return 0;
}

export async function pickFile(opts: { directory?: boolean; filters?: { name: string; extensions: string[] }[] } = {}): Promise<string | null> {
  if (!isTauri) {
    const v = window.prompt('浏览器预览：请输入路径');
    return v || null;
  }
  const r = await openDialog({ multiple: false, directory: !!opts.directory, filters: opts.filters });
  return typeof r === 'string' ? r : null;
}

export async function pickSavePath(defaultPath: string, ext: string): Promise<string | null> {
  if (!isTauri) return defaultPath;
  const r = await saveDialog({ defaultPath, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  return r ?? null;
}

// ---------------------------------------------------------------- windows

export async function showWindow(label: ViewName): Promise<void> {
  if (!isTauri) {
    const size = label === 'quickadd' ? 'width=600,height=230' : 'width=720,height=520';
    window.open(`?view=${label}`, `resmanager-${label}`, size);
    return;
  }
  const w = await WebviewWindow.getByLabel(label);
  if (!w) return;
  if (label === 'quickadd') await placeBottomRight(w);
  await w.show();
  await w.unminimize();
  await w.setFocus();
}

/** Put a window in the bottom-right corner of the work area (above the taskbar) of the monitor under the cursor. */
async function placeBottomRight(w: WebviewWindow, margin = 16): Promise<void> {
  try {
    const c = await cursorPosition();
    const m = (await monitorFromPoint(c.x, c.y)) ?? (await primaryMonitor());
    if (!m) return;
    const wa = (m as { workArea?: { position: { x: number; y: number }; size: { width: number; height: number } } })
      .workArea;
    const area = wa ?? { position: m.position, size: { width: m.size.width, height: m.size.height - Math.round(48 * m.scaleFactor) } };
    // Hidden windows can retain their old physical size after a DPI change.
    // Move onto the target monitor first, then restore the configured 600×230 DIP size.
    await w.setPosition(new PhysicalPosition(area.position.x, area.position.y));
    await w.setSize(new PhysicalSize(Math.round(600 * m.scaleFactor), Math.round(230 * m.scaleFactor)));
    const size = await w.outerSize();
    const pad = Math.round(margin * m.scaleFactor);
    await w.setPosition(
      new PhysicalPosition(
        area.position.x + area.size.width - size.width - pad,
        area.position.y + area.size.height - size.height - pad,
      ),
    );
  } catch {
    /* positioning is best-effort; the window still shows */
  }
}

export async function hideCurrentWindow(): Promise<void> {
  if (isTauri) await getCurrentWindow().hide();
}

export async function onWindowFocus(cb: (focused: boolean) => void): Promise<() => void> {
  if (!isTauri) {
    const f = () => cb(true);
    const b = () => cb(false);
    window.addEventListener('focus', f);
    window.addEventListener('blur', b);
    return () => {
      window.removeEventListener('focus', f);
      window.removeEventListener('blur', b);
    };
  }
  return getCurrentWindow().onFocusChanged(({ payload }) => cb(payload));
}

export async function onFileDrop(
  cb: (paths: string[]) => void,
  onHover?: (hovering: boolean) => void,
): Promise<() => void> {
  if (!isTauri) return () => {};
  return getCurrentWindow().onDragDropEvent((e) => {
    const p = e.payload;
    if (p.type === 'over' || p.type === 'enter') onHover?.(true);
    else if (p.type === 'leave') onHover?.(false);
    else if (p.type === 'drop') {
      onHover?.(false);
      cb(p.paths);
    }
  });
}

// ---------------------------------------------------------------- cross-window events

const channel: BroadcastChannel | null =
  !isTauri && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('resmanager') : null;

export async function broadcast(event: string, payload: unknown = null): Promise<void> {
  if (isTauri) return emit(event, payload);
  channel?.postMessage({ event, payload });
}

export async function subscribe<T = unknown>(event: string, cb: (payload: T) => void): Promise<() => void> {
  if (isTauri) return listen<T>(event, (e) => cb(e.payload));
  if (!channel) return () => {};
  const h = (m: MessageEvent) => {
    if (m.data?.event === event) cb(m.data.payload as T);
  };
  channel.addEventListener('message', h);
  return () => channel.removeEventListener('message', h);
}
