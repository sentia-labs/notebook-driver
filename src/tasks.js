import { parseYmd } from './periods.js';

/**
 * Every task in the notebook, read straight from the pages (the human's marks are the truth).
 * `parsed` is Library#parsedPages() output.
 */
export function collectTasks(parsed) {
  const tasks = [];
  for (const { doc, records } of parsed) {
    for (const r of records) {
      if (r.kind !== 'task') continue;
      tasks.push({
        page: doc.name,
        line: r.line,
        text: r.text,
        state: r.state,
        signifiers: r.signifiers,
        date: r.date,
        month: r.month,
        week: r.week,
        indent: r.indent,
      });
    }
  }
  return tasks;
}

export function isOpen(task) {
  return task.state === 'open' || task.state === 'started';
}

/** Days since the task was logged (from its date context; month-level entries count from the 1st). */
export function taskAgeDays(task, now = new Date()) {
  const ref = task.date ?? (task.month ? `${task.month}-01` : null);
  if (!ref) return null;
  const d = parseYmd(ref);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - d) / 86400000);
}

/** Entries (any kind) whose date falls inside [from, to] (YYYY-MM-DD strings, inclusive). */
export function entriesBetween(parsed, from, to) {
  const out = [];
  for (const { doc, records } of parsed) {
    for (const r of records) {
      if (!['task', 'event', 'note'].includes(r.kind)) continue;
      const day = r.date;
      if (day && day >= from && day <= to) out.push({ page: doc.name, ...r });
    }
  }
  return out;
}

/** Pages whose date context overlaps [from, to]. */
export function pagesBetween(parsed, from, to) {
  return parsed
    .filter(({ dates }) => dates.dates.some((d) => d >= from && d <= to))
    .map(({ doc }) => doc);
}
