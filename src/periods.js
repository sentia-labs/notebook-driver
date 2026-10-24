import { pad } from './util.js';

// Period ids: daily 2026-10-22 · weekly 2026-W43 (ISO, Monday start) · monthly 2026-10 ·
// quarterly 2026-Q4 · yearly 2026. All computations use local calendar dates.

export const KINDS = ['weekly', 'monthly', 'quarterly', 'yearly'];

export function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // Thursday decides the ISO year
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return { year: d.getUTCFullYear(), week: Math.ceil(((d - yearStart) / 86400000 + 1) / 7) };
}

function isoWeekMonday(year, week) {
  const jan4 = new Date(year, 0, 4);
  const day = jan4.getDay() || 7;
  return new Date(year, 0, 4 - day + 1 + (week - 1) * 7);
}

export function periodOf(kind, date) {
  switch (kind) {
    case 'daily':
      return ymd(date);
    case 'weekly': {
      const { year, week } = isoWeek(date);
      return `${year}-W${pad(week)}`;
    }
    case 'monthly':
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
    case 'quarterly':
      return `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`;
    case 'yearly':
      return String(date.getFullYear());
    default:
      throw new Error(`Unknown period kind: ${kind}`);
  }
}

/** First and last calendar day of a period (local Dates at midnight). */
export function periodRange(kind, id) {
  let m;
  if (kind === 'daily') {
    const d = parseYmd(id);
    return { start: d, end: d };
  }
  if (kind === 'weekly' && (m = /^(\d{4})-W(\d{2})$/.exec(id))) {
    const start = isoWeekMonday(+m[1], +m[2]);
    return { start, end: addDays(start, 6) };
  }
  if (kind === 'monthly' && (m = /^(\d{4})-(\d{2})$/.exec(id))) {
    return { start: new Date(+m[1], +m[2] - 1, 1), end: new Date(+m[1], +m[2], 0) };
  }
  if (kind === 'quarterly' && (m = /^(\d{4})-Q([1-4])$/.exec(id))) {
    const q = +m[2] - 1;
    return { start: new Date(+m[1], q * 3, 1), end: new Date(+m[1], q * 3 + 3, 0) };
  }
  if (kind === 'yearly' && (m = /^(\d{4})$/.exec(id))) {
    return { start: new Date(+m[1], 0, 1), end: new Date(+m[1], 11, 31) };
  }
  throw new Error(`Bad ${kind} period id: ${id}`);
}

export function previousPeriod(kind, id) {
  return periodOf(kind, addDays(periodRange(kind, id).start, -1));
}

export function nextPeriod(kind, id) {
  return periodOf(kind, addDays(periodRange(kind, id).end, 1));
}

export function periodContains(kind, id, dateStr) {
  const { start, end } = periodRange(kind, id);
  return dateStr >= ymd(start) && dateStr <= ymd(end);
}

/** When a period's review becomes available: `leadDays` before its last day, at `time` (HH:MM). */
export function availableAt(kind, id, { leadDays = 0, time = '00:00' } = {}) {
  const { end } = periodRange(kind, id);
  const [hh, mm] = time.split(':').map(Number);
  const d = addDays(end, -leadDays);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh || 0, mm || 0);
}

/** The most recent period whose review is available at `now`. */
export function reviewablePeriod(kind, now, opts = {}) {
  const cur = periodOf(kind, now);
  return now >= availableAt(kind, cur, opts) ? cur : previousPeriod(kind, cur);
}

/** Human label, e.g. "Week 43 (Oct 19 – Oct 25, 2026)". */
export function periodLabel(kind, id) {
  const { start, end } = periodRange(kind, id);
  const fmt = (d, withYear) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) });
  switch (kind) {
    case 'daily':
      return start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    case 'weekly':
      return `Week ${+id.slice(6)} (${fmt(start)} – ${fmt(end, true)})`;
    case 'monthly':
      return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    case 'quarterly':
      return `${id.slice(5)} ${id.slice(0, 4)} (${fmt(start)} – ${fmt(end)})`;
    case 'yearly':
      return id;
    default:
      return id;
  }
}

export function weekdayShort(dateStr) {
  return parseYmd(dateStr).toLocaleDateString('en-US', { weekday: 'short' });
}
