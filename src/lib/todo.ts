import type { Item, TodoPriority } from './types';

/**
 * Pure logic for todo items: due-time parsing, grouping/sorting, reminders, sub-task checkboxes.
 * Everything takes `now` explicitly so it is deterministic in tests.
 */

const MIN = 60_000;
const DAY = 86_400_000;

export const PRIORITY_LABEL: Record<TodoPriority, string> = { high: '高', mid: '中', low: '低' };
export const PRIORITY_RANK: Record<TodoPriority, number> = { high: 0, mid: 1, low: 2 };

export const REMIND_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: '不提醒' },
  { value: 0, label: '准时' },
  { value: 15, label: '提前 15 分钟' },
  { value: 60, label: '提前 1 小时' },
  { value: 1440, label: '提前 1 天' },
];

/** time used when only a date is given */
export const DEFAULT_HOUR = 18;

// ---------------------------------------------------------------- date helpers

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function atTime(dayStart: number, h: number, m: number): number {
  const d = new Date(dayStart);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

function addDays(dayStart: number, n: number): number {
  const d = new Date(dayStart);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

const WEEK_CHARS: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 0 };
const WEEK_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const pad = (n: number) => String(n).padStart(2, '0');

// ---------------------------------------------------------------- parsing "^周五 17:00"

const TIME_RE = /^(上午|早上|中午|下午|晚上)?(\d{1,2})(?:[:：](\d{2})|点(?:(半)|(\d{1,2})分?)?)$/;

/** "17:00", "9点", "下午3点半", "晚上8点15" -> [h, m] */
export function parseTime(tok: string): [number, number] | null {
  const m = tok.trim().match(TIME_RE);
  if (!m) return null;
  let h = Number(m[2]);
  const min = m[3] ? Number(m[3]) : m[4] ? 30 : m[5] ? Number(m[5]) : 0;
  const ap = m[1];
  if ((ap === '下午' || ap === '晚上') && h < 12) h += 12;
  if (ap === '中午' && h < 11) h += 12;
  if (h > 23 || min > 59) return null;
  return [h, min];
}

/** date part -> start of that day, or null if not a date */
export function parseDay(tok: string, now: number): number | null {
  const t = tok.trim();
  const today = startOfDay(now);
  if (t === '' || t === '今天' || t === '今日') return today;
  if (t === '明天' || t === '明日') return addDays(today, 1);
  if (t === '后天') return addDays(today, 2);
  if (t === '大后天') return addDays(today, 3);
  let m = t.match(/^(下)?(?:周|星期|礼拜)([一二三四五六日天1-7])$/);
  if (m) {
    const target = WEEK_CHARS[m[2]];
    const cur = new Date(today).getDay();
    if (m[1]) {
      // 下周X: X of next Monday-based week
      const toMonday = ((8 - cur) % 7) || 7;
      const nextMonday = addDays(today, toMonday);
      return addDays(nextMonday, (target + 6) % 7);
    }
    return addDays(today, (target - cur + 7) % 7);
  }
  m = t.match(/^(?:(\d{4})[-/.年])?(\d{1,2})[-/.月](\d{1,2})[日号]?$/);
  if (m) {
    const year = m[1] ? Number(m[1]) : new Date(today).getFullYear();
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    let d = new Date(year, month - 1, day).getTime();
    if (new Date(d).getMonth() !== month - 1) return null; // e.g. 2-30
    if (!m[1] && d < today) d = new Date(year + 1, month - 1, day).getTime();
    return d;
  }
  return null;
}

export interface DueParse {
  due: number;
  /** how many tokens (1 or 2) were consumed */
  used: number;
}

/**
 * Parse the tokens following "^". `first` is the text right after ^ (may be empty),
 * `second` the next token (maybe a time).
 *   ^明天            -> tomorrow 18:00
 *   ^周五 17:00      -> this Friday 17:00
 *   ^10-20 9点       -> Oct 20 09:00
 *   ^17:00           -> today 17:00 (tomorrow if already past)
 *   ^明天17:00       -> combined in one token
 */
export function parseDue(first: string, second: string | undefined, now: number): DueParse | null {
  // pure time
  const onlyTime = parseTime(first);
  if (onlyTime) {
    let due = atTime(startOfDay(now), onlyTime[0], onlyTime[1]);
    if (due <= now) due = atTime(addDays(startOfDay(now), 1), onlyTime[0], onlyTime[1]);
    return { due, used: 1 };
  }
  // combined "明天17:00" / "周五下午3点"
  const combo = first.match(/^(.*?)((?:上午|早上|中午|下午|晚上)?\d{1,2}(?:[:：]\d{2}|点.*))$/);
  if (combo && combo[1]) {
    const day = parseDay(combo[1], now);
    const tm = parseTime(combo[2]);
    if (day !== null && tm) return { due: atTime(day, tm[0], tm[1]), used: 1 };
  }
  const day = parseDay(first, now);
  if (day === null) return null;
  const tm = second !== undefined ? parseTime(second) : null;
  if (tm) return { due: atTime(day, tm[0], tm[1]), used: 2 };
  return { due: atTime(day, DEFAULT_HOUR, 0), used: 1 };
}

export function parsePriority(tok: string): TodoPriority | null {
  const m = tok.match(/^[!！](高|中|低|h|m|l|1|2|3)$/i);
  if (!m) return null;
  const v = m[1].toLowerCase();
  if (v === '高' || v === 'h' || v === '1') return 'high';
  if (v === '中' || v === 'm' || v === '2') return 'mid';
  return 'low';
}

// ---------------------------------------------------------------- display

export function formatDue(due: number, now: number): string {
  const d = new Date(due);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const diff = Math.round((startOfDay(due) - startOfDay(now)) / DAY);
  if (diff === 0) return `今天 ${hm}`;
  if (diff === 1) return `明天 ${hm}`;
  if (diff === -1) return `昨天 ${hm}`;
  if (diff > 1 && diff < 7) return `${WEEK_NAMES[d.getDay()]} ${hm}`;
  if (d.getFullYear() === new Date(now).getFullYear()) return `${d.getMonth() + 1}-${d.getDate()} ${hm}`;
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${hm}`;
}

/** full form for confirmation hints: "10-17 周五 17:00" */
export function formatDueFull(due: number): string {
  const d = new Date(due);
  return `${d.getMonth() + 1}-${d.getDate()} ${WEEK_NAMES[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "已过期 2 天" / "已过期 3 小时" / "已过期 5 分钟" */
export function overdueText(due: number, now: number): string {
  const ms = now - due;
  if (ms < 60 * MIN) return `已过期 ${Math.max(1, Math.floor(ms / MIN))} 分钟`;
  if (ms < DAY) return `已过期 ${Math.floor(ms / (60 * MIN))} 小时`;
  return `已过期 ${Math.floor(ms / DAY)} 天`;
}

/** value for <input type="datetime-local"> */
export function toLocalInput(t: number | null | undefined): string {
  if (!t) return '';
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

// ---------------------------------------------------------------- grouping / sorting

export type TodoGroup = 'overdue' | 'today' | 'tomorrow' | 'later' | 'nodate' | 'done';

export const GROUP_ORDER: TodoGroup[] = ['overdue', 'today', 'tomorrow', 'later', 'nodate', 'done'];
export const GROUP_LABEL: Record<TodoGroup, string> = {
  overdue: '已过期',
  today: '今天',
  tomorrow: '明天',
  later: '以后',
  nodate: '无日期',
  done: '已完成',
};

export function todoGroup(it: Item, now: number): TodoGroup {
  const m = it.meta;
  if (m.done) return 'done';
  if (!m.due) return 'nodate';
  if (m.due < now) return 'overdue';
  const diff = Math.round((startOfDay(m.due) - startOfDay(now)) / DAY);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  return 'later';
}

function prioRank(it: Item): number {
  return it.meta.priority ? PRIORITY_RANK[it.meta.priority] : 3;
}

export function compareTodos(a: Item, b: Item): number {
  if (a.meta.done && b.meta.done) return (b.meta.doneAt ?? 0) - (a.meta.doneAt ?? 0);
  const p = prioRank(a) - prioRank(b);
  if (p) return p;
  const da = a.meta.due ?? Infinity;
  const db = b.meta.due ?? Infinity;
  if (da !== db) return da < db ? -1 : 1;
  return a.createdAt - b.createdAt;
}

export function groupTodos(items: Item[], now: number): { group: TodoGroup; items: Item[] }[] {
  const map = new Map<TodoGroup, Item[]>();
  for (const it of items) {
    if (it.type !== 'todo') continue;
    const g = todoGroup(it, now);
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(it);
  }
  return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({ group: g, items: map.get(g)!.sort(compareTodos) }));
}

export function todoCounts(items: Item[], now: number): { open: number; overdue: number } {
  let open = 0;
  let overdue = 0;
  for (const it of items) {
    if (it.type !== 'todo' || it.meta.done) continue;
    open++;
    if (it.meta.due && it.meta.due < now) overdue++;
  }
  return { open, overdue };
}

/** completed / reopened copy of a todo */
export function setDone(it: Item, done: boolean, now: number): Item {
  return { ...it, meta: { ...it.meta, done, doneAt: done ? now : null, snoozeUntil: null, ackAt: null } };
}

// ---------------------------------------------------------------- reminders

/** When this todo should pop up, or null if never. Snooze overrides the regular time. */
export function reminderTime(it: Item): number | null {
  const m = it.meta;
  if (it.type !== 'todo' || m.done || !m.due || m.remindBefore === null || m.remindBefore === undefined) return null;
  const regular = m.due - m.remindBefore * MIN;
  return m.snoozeUntil && m.snoozeUntil > regular ? m.snoozeUntil : regular;
}

/** Called for fresh reminders on the first scheduler tick, without a grace period. */
export function hasOfflineReminders(items: Item[], startedAt: number): boolean {
  return items.some((it) => {
    const time = reminderTime(it);
    return time !== null && time < startedAt;
  });
}

/** Todos whose reminder time has arrived and that have not been shown for that time yet. */
export function dueReminders(items: Item[], now: number): Item[] {
  return items
    .filter((it) => {
      const r = reminderTime(it);
      return r !== null && r <= now && it.meta.notifiedAt !== r;
    })
    .sort((a, b) => (a.meta.due ?? 0) - (b.meta.due ?? 0));
}

/** Reminders that were shown and are still waiting for the user (not done, not snoozed, not dismissed). */
export function ringing(items: Item[], now: number): Item[] {
  return items
    .filter((it) => {
      const r = reminderTime(it);
      return r !== null && r <= now && it.meta.notifiedAt === r && it.meta.ackAt !== r;
    })
    .sort((a, b) => (a.meta.due ?? 0) - (b.meta.due ?? 0));
}

export function dismiss(it: Item): Item {
  return { ...it, meta: { ...it.meta, ackAt: reminderTime(it) } };
}

export function markNotified(it: Item): Item {
  return { ...it, meta: { ...it.meta, notifiedAt: reminderTime(it) } };
}

export function snooze(it: Item, minutes: number, now: number): Item {
  return { ...it, meta: { ...it.meta, snoozeUntil: now + minutes * MIN } };
}

// ---------------------------------------------------------------- sub-tasks (- [ ] in Markdown)

const FENCE_RE = /^\s*(`{3,}|~{3,})/;
const TASK_RE = /^((?:\s*>)*\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])(?=\s|$)/;

/** Visit task-list markers in source order, skipping fenced code. */
function eachTask(src: string, fn: (lineIdx: number, checked: boolean) => void): string[] {
  const lines = src.split('\n');
  let fence: string | null = null;
  lines.forEach((line, i) => {
    const f = line.match(FENCE_RE);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      return;
    }
    if (fence) return;
    const m = line.match(TASK_RE);
    if (m) fn(i, m[2] !== ' ');
  });
  return lines;
}

export function taskProgress(src: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  eachTask(src ?? '', (_i, checked) => {
    total++;
    if (checked) done++;
  });
  return { done, total };
}

/** Toggle the n-th task checkbox (0-based, source order). Returns the source unchanged if out of range. */
export function toggleTask(src: string, n: number): string {
  let k = 0;
  let target = -1;
  const lines = eachTask(src, (i) => {
    if (k === n) target = i;
    k++;
  });
  if (target < 0) return src;
  lines[target] = lines[target].replace(TASK_RE, (_a, pre: string, mark: string, post: string) => pre + (mark === ' ' ? 'x' : ' ') + post);
  return lines.join('\n');
}
