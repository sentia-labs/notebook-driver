import fs from 'node:fs';
import path from 'node:path';
import { splitFrontmatter } from './frontmatter.js';
import { KINDS, availableAt, periodLabel, periodOf, periodRange, previousPeriod, reviewablePeriod, ymd } from './periods.js';
import { readJson, readText, writeJson } from './util.js';

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

// ------------------------------------------------------------------------------- run timings
// Every ritual run is timed by nbd (not the agent), one file per run in .nbd/ritual-runs/, so the
// rituals themselves can be reviewed: how long each takes, where the time goes, which ones finish.

/** A pause longer than this between turns is time away, not time spent on the review. */
export const IDLE_MS = 15 * 60_000;

const minutes = (ms) => Math.round(ms / 6000) / 10;

function runsDir(paths) {
  return path.join(paths.state, 'ritual-runs');
}

export function saveRitualRun(paths, run) {
  writeJson(path.join(runsDir(paths), `${run.id}.json`), run);
  return run;
}

/** Newest first. */
export function listRitualRuns(paths) {
  let names = [];
  try {
    names = fs.readdirSync(runsDir(paths)).filter((n) => n.endsWith('.json'));
  } catch {}
  return names
    .map((n) => readJson(path.join(runsDir(paths), n), null))
    .filter(Boolean)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** A terminal run (`nbd ritual`): only the wall clock is known. */
export function terminalRun(paths, kind, period, startedAt, endedAt) {
  const ms = endedAt - startedAt;
  return {
    id: `t${startedAt.getTime().toString(36)}`,
    kind,
    period,
    via: 'terminal',
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    minutes: minutes(ms),
    activeMinutes: minutes(ms),
    agentMinutes: null,
    yourMinutes: null,
    replies: null,
    costUsd: null,
    done: reviewDone(paths, kind, period),
  };
}

/**
 * A viewer run, from its conversation: the agent's time is the sum of its turns; your time is the
 * rest, leaving out pauses longer than IDLE_MS (you came back later).
 */
export function conversationRun(paths, conv) {
  const { ritual: kind, period } = conv.meta;
  const start = Date.parse(conv.createdAt);
  let agentMs = 0;
  let yourMs = 0;
  let prev = start;
  for (const t of conv.turns.slice(1)) {
    const at = Date.parse(t.at);
    if (t.role === 'agent') {
      agentMs += t.ms ?? 0;
      prev = at;
    } else {
      const gap = at - prev;
      if (gap <= IDLE_MS) yourMs += gap;
      prev = at;
    }
  }
  return {
    id: conv.id,
    kind,
    period,
    via: 'viewer',
    startedAt: conv.createdAt,
    endedAt: new Date(prev).toISOString(),
    minutes: minutes(prev - start),
    activeMinutes: minutes(agentMs + yourMs),
    agentMinutes: minutes(agentMs),
    yourMinutes: minutes(yourMs),
    replies: conv.turns.filter((t) => t.role === 'human').length - 1,
    costUsd: conv.costUsd ?? null,
    done: reviewDone(paths, kind, period),
  };
}
