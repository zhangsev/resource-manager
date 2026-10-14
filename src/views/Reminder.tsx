import { useEffect, useMemo, useRef, useState } from 'react';
import { toastError, useApp } from '../lib/app';
import { broadcast, hideCurrentWindow, isTauri, showWindow, subscribe } from '../lib/platform';
import { EV_REMINDER, EV_SHOW_ITEM } from '../lib/services';
import { PRIORITY_LABEL, dismiss, formatDue, overdueText, ringing, setDone, snooze } from '../lib/todo';
import type { Item } from '../lib/types';
import { useNow } from '../components/todo';

/**
 * Bottom-right reminder window. What it lists is derived from the data (todo.ringing),
 * so it survives restarts and stays in sync with the main window.
 */
export function Reminder() {
  const app = useApp();
  const now = useNow(5_000);
  const [offline, setOffline] = useState(false);
  const list = useMemo(() => ringing(app.items, now), [app.items, now]);
  const reloadRef = useRef(app.reload);
  reloadRef.current = app.reload;

  useEffect(() => {
    let disposed = false;
    let un: (() => void) | undefined;
    subscribe<{ offline?: boolean }>(EV_REMINDER, (p) => {
      setOffline(!!p?.offline);
      reloadRef.current();
    }).then((u) => (disposed ? u() : (un = u)));
    return () => {
      disposed = true;
      un?.();
    };
  }, []);

  // nothing left to show: get out of the way
  useEffect(() => {
    if (app.ready && list.length === 0 && isTauri) {
      setOffline(false);
      hideCurrentWindow();
    }
  }, [app.ready, list.length]);

  const act = (it: Item, next: Item) => app.saveItem(next).catch(toastError);
  const patch = (items: Item[]) => app.patchItems(items).catch(toastError);

  const open = async (it: Item) => {
    await showWindow('main');
    await broadcast(EV_SHOW_ITEM, it.id);
  };

  return (
    <div className="rm">
      <div className="rm-head" data-tauri-drag-region>
        <span data-tauri-drag-region>⏰ {offline ? `离线期间有 ${list.length} 条待办到期` : `待办提醒（${list.length}）`}</span>
        {list.length > 1 && (
          <button className="link-btn" onClick={() => patch(list.map((it) => snooze(it, 10, Date.now())))}>
            全部 10 分钟后
          </button>
        )}
        <button className="icon-btn" title="知道了（关闭这些提醒）" onClick={() => patch(list.map(dismiss))}>
          ×
        </button>
      </div>
      <div className="rm-list">
        {list.map((it) => {
          const due = it.meta.due ?? 0;
          const late = due < now;
          return (
            <div key={it.id} className={'rm-item' + (it.meta.priority ? ' p-' + it.meta.priority : '')}>
              <div className="rm-title">{it.title}</div>
              <div className="rm-sub">
                <span className={late ? 'late' : ''}>
                  {formatDue(due, now)}
                  {late && ` · ${overdueText(due, now)}`}
                </span>
                {it.meta.priority && <span className={'prio-chip p-' + it.meta.priority}>{PRIORITY_LABEL[it.meta.priority]}</span>}
              </div>
              <div className="rm-actions">
                <button className="btn small primary" onClick={() => act(it, setDone(it, true, Date.now()))}>
                  ✓ 完成
                </button>
                <button className="btn small" onClick={() => patch([snooze(it, 10, Date.now())])}>
                  10 分钟后
                </button>
                <button className="btn small" onClick={() => patch([snooze(it, 60, Date.now())])}>
                  1 小时后
                </button>
                <button className="link-btn" onClick={() => open(it)}>
                  打开
                </button>
              </div>
            </div>
          );
        })}
        {list.length === 0 && <div className="rm-empty">没有需要提醒的待办</div>}
      </div>
    </div>
  );
}
