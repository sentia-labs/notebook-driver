import path from 'node:path';
import { splitFrontmatter } from './frontmatter.js';
import { KINDS, availableAt, periodLabel, periodOf, periodRange, previousPeriod, reviewablePeriod, ymd } from './periods.js';
import { readText } from './util.js';

export const RITUALS = {
  weekly: { kind: 'weekly', title: 'Weekly review', skill: 'nbd-weekly-review', folder: 'weekly' },
  monthly: { kind: 'monthly', title: 'Monthly review & migration', skill: 'nbd-monthly-review', folder: 'monthly' },
  quarterly: { kind: 'quarterly', title: 'Quarterly review', skill: 'nbd-quarterly-review', folder: 'quarterly' },
  yearly: { kind: 'yearly', title: 'Yearly review & migration', skill: 'nbd-yearly-review', folder: 'yearly' },
};

/** The periodic note a ritual completes, e.g. vault/journal/weekly/2026-W43.md */
export function periodNoteRel(kind, period) {
  return `vault/journal/${RITUALS[kind].folder}/${period}.md`;
}

/** A review counts as done when its periodic note says `review: done` in frontmatter. */
export function reviewDone(paths, kind, period) {
  const text = readText(path.join(paths.home, periodNoteRel(kind, period)));
  if (text == null) return false;
  const { data } = splitFrontmatter(text);
  return ['done', 'completed', 'complete', true].includes(data.review);
}

/**
 * Status of every enabled ritual at `now`. `hasActivity(from, to)` lets the caller say whether the
 * notebook has entries in a period, so a fresh notebook isn't nagged about reviewing empty weeks.
 */
export function ritualStatus(paths, config, now = new Date(), { hasActivity = () => true } = {}) {
  const out = [];
  for (const kind of KINDS) {
    const opts = config.rituals[kind];
    if (!opts?.enabled) continue;
    const period = reviewablePeriod(kind, now, opts);
    const done = reviewDone(paths, kind, period);
    const prev = previousPeriod(kind, period);
    const { start, end } = periodRange(kind, period);
    const active = hasActivity(ymd(start), ymd(end));
    const current = periodOf(kind, now);
    out.push({
      kind,
      title: RITUALS[kind].title,
      period,
      label: periodLabel(kind, period),
      from: ymd(start),
      to: ymd(end),
      availableAt: availableAt(kind, period, opts).toISOString(),
      due: !done && active,
      done,
      active,
      note: periodNoteRel(kind, period),
      previous: { period: prev, done: reviewDone(paths, kind, prev), note: periodNoteRel(kind, prev) },
      // The period in progress, whose review opens later (shown so "nothing due" isn't a dead end).
      upcoming:
        current !== period
          ? { period: current, label: periodLabel(kind, current), availableAt: availableAt(kind, current, opts).toISOString() }
          : null,
    });
  }
  return out;
}
