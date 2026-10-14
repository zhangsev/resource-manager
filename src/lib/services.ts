import { useEffect, useRef } from 'react';
import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import { toast, type AppState } from './app';
import { compileIgnore, shouldRecordClip } from './clipfilter';
import { stamp } from './exporter';
import { appVersion, broadcast, isTauri, joinPath, lastWrittenByApp, notify, pruneBackups, readClipboard, showWindow, subscribe } from './platform';
import { GUIDE_ID, GUIDE_VERSION, guideUpdate } from './guide';
import { dueReminders, formatDue, hasOfflineReminders, markNotified, ringing } from './todo';

export const EV_LAUNCHER_OPEN = 'resmanager://launcher-open';
export const EV_QUICKADD_OPEN = 'resmanager://quickadd-open';
/** payload: an Item draft to open in the main window's full editor */
export const EV_EDIT_DRAFT = 'resmanager://edit-draft';
export const EV_TRAY_QUICKADD = 'resmanager://tray-quickadd';
/** payload: { offline: boolean } — some reminders came due while the app was not running */
export const EV_REMINDER = 'resmanager://reminder';
/** payload: item id — show it (view mode) in the main window */
export const EV_SHOW_ITEM = 'resmanager://show-item';

const APP_STARTED = Date.now();

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

/**
 * First start of a new version: copy the database to backup/upgrade-…db before anything else touches it.
 * These files do not start with "resmanager-", so the daily pruning never deletes them.
 */
export async function upgradeBackupIfNeeded(app: AppState): Promise<string | null> {
  if (!app.store || !app.paths) return null;
  const cur = await appVersion();
  const last = app.settings.lastVersion;
  if (last === cur) return null;
  let file: string | null = null;
  // only when there is data from an earlier run (a brand-new install has nothing worth backing up)
  if (isTauri && app.items.some((i) => i.createdAt < APP_STARTED - 60_000)) {
    const from = last ? `v${last}-to-` : 'to-';
    file = joinPath(app.paths.backup, `upgrade-${from}v${cur}-${stamp()}.db`);
    await app.store.backupTo(file);
  }
  await app.updateSettings({ lastVersion: cur });
  return file;
}

/** Insert / refresh the built-in 使用说明 (see guide.ts). */
export async function ensureGuide(app: AppState): Promise<void> {
  const existing = app.items.find((i) => i.id === GUIDE_ID);
  const next = guideUpdate(existing, app.settings.guideVersionShown);
  if (next) await app.patchItems([next]);
  if (app.settings.guideVersionShown < GUIDE_VERSION) await app.updateSettings({ guideVersionShown: GUIDE_VERSION });
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

  // ---- startup: upgrade backup first, then the built-in guide, then the daily backup
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      const a = () => appRef.current;
      try {
        const file = await upgradeBackupIfNeeded(a());
        if (file) toast('已升级，升级前的数据已备份到 backup 文件夹');
      } catch (e) {
        toast('升级前备份失败：' + ((e as Error)?.message ?? e), 'error');
      }
      if (cancelled) return;
      await new Promise((r) => setTimeout(r, 300)); // let the reload after updateSettings land
      try {
        await ensureGuide(a());
      } catch {
        /* not critical */
      }
      if (cancelled || !isTauri) return;
      if ((a().settings.lastBackupAt ?? 0) < startOfToday()) {
        await new Promise((r) => setTimeout(r, 2500));
        if (!cancelled) backupNow(a()).catch((e) => toast('自动备份失败：' + (e?.message ?? e), 'error'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready]);

  // ---- todo reminders: every 15 s, plus once shortly after start (catches what came due while closed)
  useEffect(() => {
    if (!ready) return;
    let first = true;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const a = appRef.current;
        const now = Date.now();
        const fresh = dueReminders(a.items, now);
        const pending = first ? ringing(a.items, now) : [];
        const offline = first && hasOfflineReminders(fresh, APP_STARTED);
        first = false;
        if (!fresh.length && !pending.length) return;
        if (fresh.length) await a.patchItems(fresh.map(markNotified));
        await showWindow('reminder');
        await broadcast(EV_REMINDER, { offline });
        if (fresh.length && a.settings.todoSystemNotify) {
          const head = offline ? `有 ${fresh.length} 条待办在程序未运行时到期` : '待办提醒';
          const body = fresh
            .slice(0, 4)
            .map((it) => `${it.title}${it.meta.due ? '（' + formatDue(it.meta.due, now) + '）' : ''}`)
            .join('\n');
          notify(head, body + (fresh.length > 4 ? `\n…等 ${fresh.length} 条` : ''));
        }
      } catch {
        /* try again next tick */
      } finally {
        busy = false;
      }
    };
    const first0 = setTimeout(tick, 4000);
    const h = setInterval(tick, 15_000);
    return () => {
      clearTimeout(first0);
      clearInterval(h);
    };
  }, [ready]);
}
