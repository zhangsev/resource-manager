import { useEffect, useRef } from 'react';
import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import { toast, type AppState } from './app';
import { compileIgnore, shouldRecordClip } from './clipfilter';
import { stamp } from './exporter';
import { broadcast, isTauri, joinPath, lastWrittenByApp, pruneBackups, readClipboard, showWindow, subscribe } from './platform';

export const EV_LAUNCHER_OPEN = 'resmanager://launcher-open';
export const EV_QUICKADD_OPEN = 'resmanager://quickadd-open';
/** payload: an Item draft to open in the main window's full editor */
export const EV_EDIT_DRAFT = 'resmanager://edit-draft';
export const EV_TRAY_QUICKADD = 'resmanager://tray-quickadd';

export async function openLauncher() {
  await showWindow('launcher');
  await broadcast(EV_LAUNCHER_OPEN);
}

/** Hotkey opens it with the existing draft (no clipboard); other views may hand over text. */
export async function openQuickAdd(prefill?: string) {
  await showWindow('quickadd');
  await broadcast(EV_QUICKADD_OPEN, prefill ?? null);
}

export async function backupNow(app: AppState): Promise<string> {
  if (!app.store || !app.paths) throw new Error('数据尚未加载');
  const file = joinPath(app.paths.backup, `resmanager-${stamp()}.db`);
  await app.store.backupTo(file);
  await pruneBackups(app.paths.backup, Math.max(1, app.settings.backupKeep));
  await app.updateSettings({ lastBackupAt: Date.now() });
  return file;
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Runs only in the main window: hotkeys, clipboard watcher, daily backup. */
export function useBackgroundServices(app: AppState) {
  const appRef = useRef(app);
  appRef.current = app;
  const { ready, settings } = app;

  // ---- global hotkeys
  useEffect(() => {
    if (!ready || !isTauri) return;
    let cancelled = false;
    (async () => {
      try {
        await unregisterAll();
      } catch {
        /* ignore */
      }
      if (cancelled) return;
      const failed: string[] = [];
      const bind = async (accel: string, fn: () => void) => {
        if (!accel.trim()) return;
        try {
          await register(accel, (e) => {
            if (e.state === 'Pressed') fn();
          });
        } catch {
          failed.push(accel);
        }
      };
      await bind(settings.hotkeyLauncher, () => void openLauncher());
      await bind(settings.hotkeyQuickAdd, () => void openQuickAdd());
      if (failed.length) toast(`快捷键 ${failed.join('、')} 注册失败（可能被占用），请在设置中修改`, 'error');
    })();
    return () => {
      cancelled = true;
      unregisterAll().catch(() => {});
    };
  }, [ready, settings.hotkeyLauncher, settings.hotkeyQuickAdd]);

  // ---- tray menu "快速添加" (the tray lives in Rust; positioning is done here)
  useEffect(() => {
    let disposed = false;
    let un: (() => void) | undefined;
    subscribe(EV_TRAY_QUICKADD, () => void openQuickAdd()).then((u) => (disposed ? u() : (un = u)));
    return () => {
      disposed = true;
      un?.();
    };
  }, []);

  // ---- clipboard watcher (polling; the OS offers no portable change event to the webview)
  useEffect(() => {
    if (!ready || !isTauri || !settings.clipEnabled) return;
    const ignore = compileIgnore(settings.clipIgnorePatterns);
    let last: string | null = null;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const text = await readClipboard();
        if (last === null) {
          last = text; // don't record whatever was on the clipboard before we started
          return;
        }
        if (text === last) return;
        last = text;
        if (text === lastWrittenByApp()) return;
        if (!shouldRecordClip(text, ignore)) return;
        await appRef.current.addClip(text);
      } catch {
        /* ignore transient clipboard errors */
      } finally {
        busy = false;
      }
    };
    const h = setInterval(tick, 1000);
    tick();
    return () => clearInterval(h);
  }, [ready, settings.clipEnabled, settings.clipIgnorePatterns]);

  // ---- daily automatic backup
  useEffect(() => {
    if (!ready || !isTauri) return;
    const last = appRef.current.settings.lastBackupAt ?? 0;
    if (last >= startOfToday()) return;
    const t = setTimeout(() => {
      backupNow(appRef.current).catch((e) => toast('自动备份失败：' + (e?.message ?? e), 'error'));
    }, 3000);
    return () => clearTimeout(t);
  }, [ready]);
}
