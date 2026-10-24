import path from 'node:path';
import { collectTasks, isOpen, taskAgeDays } from './tasks.js';
import { listQuestions } from './questions.js';
import { nextPeriod, periodLabel, periodRange, previousPeriod, ymd } from './periods.js';
import { periodNoteRel, reviewDone, RITUALS } from './rituals.js';
import { localIso, writeFileAtomic } from './util.js';

const GLYPH = { open: '[ ]', started: '[/]', done: '[x]', migrated: '[>]', scheduled: '[<]', irrelevant: '[-]' };
const SIG = { priority: '*', inspiration: '!', explore: '?', expand: '+' };

function ref(e) {
  return `[[${e.page}]]:${e.line}`;
}

function sig(e) {
  return e.signifiers?.length ? `${e.signifiers.map((s) => SIG[s]).join('')} ` : '';
}

/**
 * The facts a ritual starts from, computed from the pages (no AI involved): what was written in
 * the period, task states, migration candidates, what's scheduled ahead. Written to
 * .nbd/context/<kind>-<period>.md so any harness can read it.
 */
export function buildRitualContext(ctx, library, kind, period, now = new Date()) {
  const { paths, config } = ctx;
  const { start, end } = periodRange(kind, period);
  const from = ymd(start);
  const to = ymd(end);
  const parsed = library.parsedPages();
  const tasks = collectTasks(parsed);
  const inPeriod = (d) => d && d >= from && d <= to;
  const monthsInPeriod = new Set();
  for (let d = new Date(start); d <= end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    monthsInPeriod.add(ymd(d).slice(0, 7));
  }

  const pages = parsed.filter(({ dates }) => dates.dates.some(inPeriod));
  const entries = [];
  for (const { doc, records } of parsed) {
    for (const r of records) {
      if (!['task', 'event', 'note'].includes(r.kind)) continue;
      // Month-level lines (a monthly log's action list) belong to monthly and longer reviews.
      const monthLevel = kind !== 'weekly' && !r.date && r.month && monthsInPeriod.has(r.month);
      if (inPeriod(r.date) || monthLevel) entries.push({ page: doc.name, ...r });
    }
  }
  const periodTasks = entries.filter((e) => e.kind === 'task');
  const byState = (states) => periodTasks.filter((t) => states.includes(t.state));
  const events = entries.filter((e) => e.kind === 'event');
  const moods = entries.filter((e) => e.kind === 'mood');
  const sparks = entries.filter((e) => e.signifiers?.some((s) => s === 'inspiration' || s === 'explore' || s === 'expand'));
  // The most recent page titled "Intentions" (Bullet Journal 3.0), as the human wrote it.
  const intentions = [...parsed].reverse().find(({ doc }) => /^intentions\b/i.test(doc.title));
  const openAll = tasks
    .filter(isOpen)
    .map((t) => ({ ...t, age: taskAgeDays(t, now) }))
    .sort((a, b) => (b.age ?? -1) - (a.age ?? -1));

  // Entries filed under a later month or date (BuJo future log / scheduled items).
  const next = nextPeriod(kind, period);
  const nextRange = periodRange(kind, next);
  const ahead = [];
  for (const { doc, records } of parsed) {
    for (const r of records) {
      if (!['task', 'event', 'note'].includes(r.kind)) continue;
      const when = r.date ?? (r.month ? `${r.month}-01` : null);
      if (when && when > to && when <= ymd(nextRange.end)) ahead.push({ page: doc.name, ...r });
    }
  }

  const questions = listQuestions(paths).filter((q) => q.status === 'open');
  const prev = previousPeriod(kind, period);
  const recentNotes = library
    .notes()
    .filter((n) => n.mtime >= start.getTime() && n.mtime <= end.getTime() + 86400000 * 3)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 30);

  const L = [];
  L.push(`# ${RITUALS[kind].title} context · ${period}`);
  L.push('');
  L.push(`${periodLabel(kind, period)} · ${from} → ${to}. Generated ${localIso(now)} by \`nbd\` straight from the notebook (no AI).`);
  L.push(`Review note to write: \`${periodNoteRel(kind, period)}\` · previous: \`${periodNoteRel(kind, prev)}\`${reviewDone(paths, kind, prev) ? ' (done)' : ' (not done)'}`);
  L.push('');
  L.push('## Intentions');
  if (intentions) {
    L.push(`From [[${intentions.doc.name}]]:`);
    L.push(...intentions.doc.text.trim().split('\n').slice(1).filter((l) => l.trim()));
  } else {
    L.push('- (no `# Intentions` page yet — see overview.md, or invite the human to write one)');
  }
  L.push('');
  L.push(`## Pages written in this period (${pages.length})`);
  for (const { doc, dates } of pages) {
    L.push(`- [[${doc.name}]] ${doc.title} — ${dates.from}${dates.to !== dates.from ? ` → ${dates.to}` : ''} · ${doc.lines}/${config.page.maxLines} lines`);
  }
  if (!pages.length) L.push('- (none)');
  L.push('');
  L.push(`## Tasks logged in this period (${periodTasks.length})`);
  const section = (title, list) => {
    L.push(`### ${title} (${list.length})`);
    for (const t of list) L.push(`- ${GLYPH[t.state]} ${sig(t)}${t.text} — ${ref(t)}${t.date ? ` · ${t.date}` : ''}`);
    if (!list.length) L.push('- (none)');
  };
  section('Done', byState(['done']));
  section('Still open', byState(['open', 'started']));
  section('Migrated or scheduled', byState(['migrated', 'scheduled']));
  section('Struck as irrelevant', byState(['irrelevant']));
  L.push('');
  L.push(`## Events (${events.length})`);
  for (const e of events) L.push(`- o ${sig(e)}${e.text} — ${ref(e)}${e.date ? ` · ${e.date}` : ''}`);
  if (!events.length) L.push('- (none)');
  L.push('');
  L.push(`## Moods (${moods.length})`);
  for (const e of moods) L.push(`- = ${e.text} — ${ref(e)}${e.date ? ` · ${e.date}` : ''}`);
  if (!moods.length) L.push('- (none)');
  L.push('');
  L.push(`## Inspiration (!), to explore (?), to expand (+) (${sparks.length})`);
  for (const e of sparks) L.push(`- ${sig(e)}${e.text} — ${ref(e)}`);
  if (!sparks.length) L.push('- (none)');
  L.push('');
  L.push(`## Every open task in the notebook, oldest first (${openAll.length}) — migration candidates`);
  for (const t of openAll.slice(0, 80)) {
    L.push(`- ${GLYPH[t.state]} ${sig(t)}${t.text} — ${ref(t)}${t.age != null ? ` · ${t.age} days` : ''}`);
  }
  if (openAll.length > 80) L.push(`- … and ${openAll.length - 80} more`);
  if (!openAll.length) L.push('- (none)');
  L.push('');
  L.push(`## Already dated into the next ${kind.replace('ly', '')} (${next}) (${ahead.length})`);
  for (const e of ahead) L.push(`- ${e.kind === 'event' ? 'o' : GLYPH[e.state] ?? '-'} ${e.text} — ${ref(e)} · ${e.date ?? e.month}`);
  if (!ahead.length) L.push('- (none)');
  L.push('');
  L.push(`## Questions still waiting on the human (${questions.length})`);
  for (const q of questions) L.push(`- ${q.id}: ${q.title} → ${q.rel}`);
  if (!questions.length) L.push('- (none)');
  L.push('');
  L.push(`## Vault notes touched in this period (${recentNotes.length})`);
  for (const n of recentNotes) L.push(`- [[${n.name}]] (${n.type}) — ${n.rel}`);
  if (!recentNotes.length) L.push('- (none)');
  L.push('');
  return L.join('\n');
}

export function writeRitualContext(ctx, library, kind, period, now) {
  const text = buildRitualContext(ctx, library, kind, period, now);
  const file = path.join(ctx.paths.state, 'context', `${kind}-${period}.md`);
  writeFileAtomic(file, text);
  return { file, rel: path.relative(ctx.paths.home, file), text };
}
