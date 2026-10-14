import { useEffect, useMemo, useState } from 'react';
import { toastError, useApp } from '../lib/app';
import {
  GROUP_LABEL, PRIORITY_LABEL, REMIND_OPTIONS, formatDue, groupTodos, overdueText, setDone, taskProgress, type TodoGroup,
} from '../lib/todo';
import type { Item } from '../lib/types';

/** Round check button with a small "pop" animation. */
export function TodoCheck({
  done,
  priority,
  onToggle,
  size = 'md',
}: {
  done: boolean;
  priority?: Item['meta']['priority'];
  onToggle: () => void;
  size?: 'md' | 'lg';
}) {
  const [anim, setAnim] = useState(false);
  return (
    <button
      type="button"
      className={`todo-check ${size} p-${priority ?? 'none'}${done ? ' done' : ''}${anim ? ' anim' : ''}`}
      title={done ? '标记为未完成' : '标记完成'}
      aria-label={done ? '标记为未完成' : '标记完成'}
      onClick={(e) => {
        e.stopPropagation();
        setAnim(true);
        setTimeout(() => setAnim(false), 400);
        onToggle();
      }}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.5 8.5l3 3 6-7" />
      </svg>
    </button>
  );
}

/** Toggle with a short delay so the check animation is visible before the row moves to another group. */
export function useTodoToggle() {
  const app = useApp();
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const toggle = (it: Item) => {
    setLeaving((s) => new Set(s).add(it.id));
    setTimeout(() => {
      app
        .saveItem(setDone(it, !it.meta.done, Date.now()))
        .catch(toastError)
        .finally(() =>
          setLeaving((s) => {
            const n = new Set(s);
            n.delete(it.id);
            return n;
          }),
        );
    }, 380);
  };
  return { toggle, leaving };
}

export function TodoMeta({ it, now, full = false }: { it: Item; now: number; full?: boolean }) {
  const m = it.meta;
  const prog = taskProgress(it.content);
  const overdue = !m.done && !!m.due && m.due < now;
  const remind = REMIND_OPTIONS.find((o) => o.value === (m.remindBefore ?? null));
  return (
    <div className={'todo-meta' + (full ? ' full' : '')}>
      {m.due ? (
        <span className={'todo-due' + (overdue ? ' overdue' : '')} title={new Date(m.due).toLocaleString()}>
          ⏰ {formatDue(m.due, now)}
          {full && overdue && <b> · {overdueText(m.due, now)}</b>}
        </span>
      ) : (
        full && <span className="todo-due none">无截止时间</span>
      )}
      {m.priority && <span className={'prio-chip p-' + m.priority}>{PRIORITY_LABEL[m.priority]}</span>}
      {full && m.due && remind && <span className="todo-remind">🔔 {remind.label}</span>}
      {prog.total > 0 && (
        <span className="todo-progress" title={`子任务 ${prog.done}/${prog.total}`}>
          <span className="bar">
            <span style={{ width: `${(prog.done / prog.total) * 100}%` }} />
          </span>
          {prog.done}/{prog.total}
        </span>
      )}
    </div>
  );
}

/** "now" that refreshes every 30 s so groups / overdue state stay current. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(h);
  }, [intervalMs]);
  return now;
}

export function TodoList({
  items,
  selectedId,
  onSelect,
}: {
  items: Item[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const now = useNow();
  const { toggle, leaving } = useTodoToggle();
  const [showDone, setShowDone] = useState(false);
  const groups = useMemo(() => groupTodos(items, now), [items, now]);

  return (
    <div className="todo-list">
      {groups.map(({ group, items: rows }) => {
        const collapsed = group === 'done' && !showDone;
        return (
          <section key={group} className={'todo-group g-' + group}>
            <div
              className={'todo-group-head' + (group === 'done' ? ' clickable' : '')}
              onClick={() => group === 'done' && setShowDone((v) => !v)}
            >
              <span>{GROUP_LABEL[group as TodoGroup]}</span>
              <span className="count">{rows.length}</span>
              {group === 'done' && <span className="toggle">{showDone ? '收起' : '展开'}</span>}
            </div>
            {!collapsed &&
              rows.map((it) => (
                <div
                  key={it.id}
                  className={
                    'todo-row' +
                    (it.id === selectedId ? ' sel' : '') +
                    (it.meta.done ? ' done' : '') +
                    (leaving.has(it.id) ? ' leaving' : '')
                  }
                  onClick={() => onSelect(it.id)}
                >
                  <TodoCheck
                    done={!!it.meta.done !== leaving.has(it.id)}
                    priority={it.meta.priority}
                    onToggle={() => toggle(it)}
                  />
                  <div className="todo-main">
                    <div className="todo-title">
                      {it.pinned && <span className="pin">●</span>}
                      {it.title}
                    </div>
                    <TodoMeta it={it} now={now} />
                  </div>
                </div>
              ))}
          </section>
        );
      })}
    </div>
  );
}
