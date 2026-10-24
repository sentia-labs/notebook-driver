import fs from 'node:fs';
import path from 'node:path';
import { countLines, parseLines } from './bujo.js';
import { unifiedDiff } from './diff.js';
import { listPages, numberLines } from './pages.js';
import { listQuestions, nextQuestionId } from './questions.js';
import { headlessInvocation, runHeadless } from './harness.js';
import { Lock } from './state.js';
import { localIso, sha1, walkFiles } from './util.js';
import { splitFrontmatter } from './frontmatter.js';
import { Library } from './library.js';
import { writeIndex } from './vaultindex.js';
import { lintVault } from './lint.js';
import { loggerFor } from './log.js';

/**
 * Pages whose text differs from what the agent last processed, plus pages that disappeared.
 * Each: { id, num, path, text, hash, lines, status: new|modified|deleted, snapshot, startDate }
 */
export function pendingPages(paths, state) {
  const out = [];
  const seen = new Set();
  let ctx = {};
  for (const p of listPages(paths.notebook)) {
    seen.add(p.id);
    const text = fs.readFileSync(p.path, 'utf8');
    const parsed = parseLines(text, ctx);
    // Only worth saying when the page has entries before its first dated heading.
    const firstDated = parsed.records.findIndex((r) => r.kind === 'heading' && r.dated);
    const leading = (firstDated < 0 ? parsed.records : parsed.records.slice(0, firstDated)).some((r) =>
      ['task', 'event', 'note', 'text'].includes(r.kind),
    );
    const startDate = leading ? (ctx.date ?? null) : null;
    const undated = firstDated < 0;
    ctx = parsed.context;
    const hash = sha1(text);
    const rec = state.data.pages[p.id];
    if (rec?.processedHash === hash) continue;
    if (!rec?.processedHash && !text.trim()) continue; // a freshly turned, still blank page
    out.push({
      ...p,
      text,
      hash,
      lines: countLines(text),
      status: rec?.processedHash ? 'modified' : 'new',
      snapshot: rec?.processedHash ? state.readSnapshot(p.id) : null,
      startDate,
      undated,
      mtimeMs: fs.statSync(p.path).mtimeMs,
    });
  }
  for (const [id, rec] of Object.entries(state.data.pages)) {
    if (!seen.has(id) && rec.processedHash) {
      out.push({ id, num: Number(id.slice(1)), status: 'deleted', text: '', snapshot: state.readSnapshot(id), lines: 0 });
    }
  }
  return out.sort((a, b) => a.num - b.num);
}

export function answeredQuestions(paths) {
  return listQuestions(paths).filter((q) => q.status === 'answered');
}

/** Hash of every vault file, to report what an agent run changed. */
export function vaultFingerprint(paths) {
  const map = new Map();
  for (const rel of walkFiles(paths.vault)) {
    try {
      map.set(rel, sha1(fs.readFileSync(path.join(paths.vault, rel))));
    } catch {}
  }
  return map;
}

export function compareFingerprints(before, after) {
  const created = [];
  const updated = [];
  const deleted = [];
  for (const [rel, h] of after) {
    if (!before.has(rel)) created.push(rel);
    else if (before.get(rel) !== h) updated.push(rel);
  }
  for (const rel of before.keys()) if (!after.has(rel)) deleted.push(rel);
  return { created, updated, deleted };
}

function fenceFor(text, ch = '`') {
  const runs = text.match(new RegExp(`${ch === '`' ? '`' : '~'}+`, 'g')) ?? [];
  const longest = runs.reduce((m, r) => Math.max(m, r.length), 0);
  return ch.repeat(Math.max(3, longest + 1));
}

export function buildIngestPrompt(ctx, { pages, answered, open, nextId, vaultCount, now = new Date(), reason = '' }) {
  const max = ctx.config.page.maxLines;
  const day = now.toLocaleDateString('en-US', { weekday: 'short' });
  const L = [];
  L.push(`# Ingest · ${day} ${localIso(now).slice(0, 16).replace('T', ' ')} (${localIso(now).slice(19)})`);
  L.push('');
  L.push('The human changed their notebook. Run the **Ingest** procedure from AGENTS.md on the changes below.');
  L.push('Read anything; write only inside `vault/`. The notebook is the human\'s source of truth: never edit it.');
  if (reason) L.push(`(Triggered by: ${reason}.)`);
  L.push('');
  if (pages.length) {
    L.push(`## Changed pages (${pages.length})`);
    for (const p of pages) {
      L.push('');
      if (p.status === 'deleted') {
        L.push(`### ${p.id} · deleted`);
        L.push(`The human removed notebook/${p.id}.md. Notes citing [[${p.id}]] need their claims re-checked; drop or re-source what no longer has support.`);
        continue;
      }
      L.push(`### ${p.id} · ${p.status} · ${p.lines}/${max} lines${p.lines >= max ? ' (full)' : ''} · notebook/${p.id}.md`);
      if (p.startDate && p.undated) L.push(`No date heading on this page: it was written on or after ${p.startDate}, where the previous page left off.`);
      else if (p.startDate) L.push(`Lines before the page's first dated heading belong to ${p.startDate} (carried over from the previous page).`);
      if (p.status === 'modified' && p.snapshot != null) {
        const diff = unifiedDiff(p.snapshot, p.text, { oldName: 'last ingest', newName: 'now' });
        const f = fenceFor(diff);
        L.push('');
        L.push('What changed since your last ingest (hunk line numbers refer to the page as it is now):');
        L.push(`${f}diff`, diff, f);
      }
      const numbered = numberLines(p.text);
      const f = fenceFor(numbered);
      L.push('');
      L.push('The page now:');
      L.push(`${f}text`, numbered, f);
    }
    L.push('');
  }
  if (answered.length) {
    L.push(`## Answered questions to apply (${answered.length})`);
    for (const q of answered) L.push(`- ${q.id} — ${q.title} → ${q.rel}`);
    L.push('Apply each answer across the vault, then mark the question resolved (see AGENTS.md "Questions").');
    L.push('');
  }
  L.push('## Housekeeping');
  if (open.length) {
    L.push(`- Questions still waiting on the human (don't ask them again): ${open.map((q) => `${q.id} "${q.title}"`).join('; ')}`);
  }
  L.push(`- Next free question id: ${nextId}.`);
  L.push(`- Pages hold ${max} lines.`);
  L.push(`- The vault has ${vaultCount} notes. Start from vault/index.md.`);
  L.push('');
  L.push('Finish with a 1–3 line plain summary of what you changed and any questions you asked.');
  return L.join('\n');
}

/**
 * Run one ingest. Options:
 *   pages: ids to limit to; dryRun: build the prompt but don't call the agent;
 *   reason: logged; batchIds: (daemon) only include these pending page ids.
 * Returns a run record (also written to .nbd/runs/).
 */
export async function runIngest(ctx, state, { pages: only = null, dryRun = false, reason = 'manual', onSpawn, onEvent } = {}) {
  const { paths, config } = ctx;
  const log = loggerFor(ctx, 'ingest');
  const lock = new Lock(path.join(paths.state, 'ingest.lock'));
  if (!dryRun && !lock.acquire()) {
    return { status: 'busy', error: `another ingest is running (pid ${lock.holder()})` };
  }
  try {
    state.reload();
    let pages = pendingPages(paths, state);
    if (only) pages = pages.filter((p) => only.includes(p.id));
    pages = pages.slice(0, config.ingest.maxPagesPerRun);
    const answered = answeredQuestions(paths);
    if (!pages.length && !answered.length) return { status: 'nothing', pages: [], answered: [] };

    const allQ = listQuestions(paths);
    const open = allQ.filter((q) => q.status === 'open');
    const vaultCount = walkFiles(paths.vault, { filter: (r) => r.endsWith('.md') }).length;
    const prompt = buildIngestPrompt(ctx, { pages, answered, open, nextId: nextQuestionId(paths), vaultCount, reason });
    log.info('prepared run', {
      pages: pages.map((p) => `${p.id}:${p.status}`).join(' '),
      answered: answered.map((q) => q.id).join(' '),
      promptChars: prompt.length,
      dryRun: dryRun || undefined,
    });
    const startedAt = new Date().toISOString();
    const run = {
      kind: 'ingest',
      startedAt,
      reason,
      pages: pages.map((p) => `${p.id}:${p.status}`),
      answered: answered.map((q) => q.id),
      harness: config.harness.kind,
      model: config.harness.model,
    };
    if (dryRun) return { ...run, status: 'dry-run', prompt };

    const inv = headlessInvocation(ctx, { prompt, purpose: 'ingest', name: `nbd ingest ${pages.map((p) => p.id).join(' ')}`.trim() });
    const before = vaultFingerprint(paths);
    const notebookBefore = new Map(pages.filter((p) => p.status !== 'deleted').map((p) => [p.id, p.hash]));
    const result = await runHeadless(ctx, inv, { onSpawn, onEvent });
    let changes = compareFingerprints(before, vaultFingerprint(paths));
    const repair = result.ok && config.ingest.repair ? await repairPass(ctx, changes, result, { onSpawn, onEvent }) : null;
    // The catalog is code-generated from frontmatter, so it is always in step with the files.
    try {
      writeIndex(new Library(paths, config).scan());
    } catch (err) {
      log.error('could not regenerate vault/index.md', { err });
    }
    changes = compareFingerprints(before, vaultFingerprint(paths));

    // The notebook must come out of a run untouched by the agent. (A human edit during the run
    // also changes it; the next run simply picks that up.)
    const notebookChanged = [...notebookBefore.keys()].filter((id) => {
      try {
        return sha1(fs.readFileSync(path.join(paths.notebook, `${id}.md`), 'utf8')) !== notebookBefore.get(id);
      } catch {
        return true;
      }
    });

    const newQuestions = changes.created
      .filter((r) => /^inbox\/q\d+\.md$/.test(r))
      .map((r) => {
        const text = fs.readFileSync(path.join(paths.vault, r), 'utf8');
        const { data, body } = splitFrontmatter(text);
        return { id: path.basename(r, '.md'), status: String(data.status ?? 'open'), title: /^#\s+(.+)$/m.exec(body)?.[1] ?? r };
      })
      .filter((q) => q.status === 'open');

    const record = {
      ...run,
      finishedAt: new Date().toISOString(),
      status: result.ok ? 'ok' : 'failed',
      error: result.error,
      durationMs: result.durationMs,
      costUsd: result.costUsd ?? null,
      turns: result.turns ?? null,
      sessionId: result.sessionId ?? null,
      permissionDenials: result.permissionDenials?.length ? result.permissionDenials : undefined,
      repair: repair ?? undefined,
      summary: (result.text ?? '').slice(0, 4000),
      changes,
      newQuestions,
      notebookChanged: notebookChanged.length ? notebookChanged : undefined,
    };
    record.summaryLine = summarize(record);

    state.mutate((d) => {
      if (result.ok) {
        // Snapshot what the agent saw, not what's on disk now: edits made during the run stay pending.
        markProcessed(state, d, pages, record.finishedAt);
        d.ingest = { lastRunAt: record.finishedAt, lastStatus: 'ok', failures: 0 };
      } else {
        const failures = (d.ingest.failures ?? 0) + 1;
        d.ingest = { ...d.ingest, lastRunAt: record.finishedAt, lastStatus: 'failed', lastError: record.error, failures };
      }
      d.ingest.lastRun = { startedAt: record.startedAt, status: record.status, summaryLine: record.summaryLine, error: record.error };
    });
    record.recordFile = state.recordRun({ ...record, prompt });
    return record;
  } finally {
    if (!dryRun) lock.release();
  }
}

/** Record pages as read: the next ingest diffs against this text. Call inside state.mutate. */
function markProcessed(state, d, pages, at, how = undefined) {
  for (const p of pages) {
    if (p.status === 'deleted') {
      delete d.pages[p.id];
      state.deleteSnapshot(p.id);
      continue;
    }
    state.writeSnapshot(p.id, p.text);
    d.pages[p.id] = { ...(d.pages[p.id] ?? {}), processedHash: p.hash, processedAt: at, ...(how ? { skipped: true } : { skipped: undefined }) };
  }
}

/**
 * `nbd sync --skip`: mark changed pages as read without running the agent (a typo fix, or pages
 * whose vault notes already exist). ids limits it to some pages. Returns the ids skipped.
 */
export function skipPages(ctx, state, ids = null) {
  const log = loggerFor(ctx, 'ingest');
  let pages = pendingPages(ctx.paths, state.reload());
  if (ids?.length) pages = pages.filter((p) => ids.includes(p.id));
  if (!pages.length) return [];
  state.mutate((d) => markProcessed(state, d, pages, new Date().toISOString(), 'skipped'));
  log.info(`marked as read without the agent: ${pages.map((p) => p.id).join(' ')}`);
  return pages.map((p) => p.id);
}

/** Lint problems worth a second look, limited to notes this run created or changed. */
export function repairableIssues(library, touched) {
  const mine = new Set(touched.map((r) => `vault/${r}`));
  return lintVault(library).filter(
    (i) =>
      mine.has(i.rel) &&
      (i.level === 'error' || /broken link|is not on p\d+|no frontmatter|has no type/.test(i.message)),
  );
}

/** One follow-up turn that fixes what lint found in the notes the agent just wrote. */
async function repairPass(ctx, changes, first, { onSpawn, onEvent } = {}) {
  const { paths, config } = ctx;
  const issues = repairableIssues(new Library(paths, config).scan(), [...changes.created, ...changes.updated]);
  if (!issues.length) return null;
  const prompt = [
    '# Repair: `nbd lint` found problems in notes you just wrote',
    '',
    'Fix each one (AGENTS.md rules apply; write only in vault/), then reply with one line.',
    '- Frontmatter must be valid YAML: double-quote any value containing ": " or starting with a special character.',
    '- A citation quote must be copied exactly from the page (don\'t escape inner quotes); re-read the page.',
    '- A broken [[link]] needs the right slug, or no link.',
    '',
    ...issues.map((i) => `- ${i.rel}: ${i.message.split('\n')[0]}`),
  ].join('\n');
  const inv = headlessInvocation(ctx, {
    prompt,
    purpose: 'ingest',
    name: 'nbd repair',
    resume: config.harness.kind === 'claude' ? first.sessionId : null,
  });
  const log = loggerFor(ctx, 'ingest');
  log.info(`repair pass for ${issues.length} lint issue(s)`, { first: `${issues[0].rel}: ${issues[0].message.split('\n')[0]}` });
  onEvent?.({ kind: 'text', text: `Repair pass: ${issues.length} lint issue(s) in the notes it just wrote.` });
  const r = await runHeadless(ctx, inv, { onSpawn, onEvent });
  const left = repairableIssues(new Library(paths, config).scan(), [...changes.created, ...changes.updated]);
  if (left.length) log.warn(`${left.length} lint issue(s) remain after the repair pass`, { first: `${left[0].rel}: ${left[0].message.split('\n')[0]}` });
  return { issues: issues.length, remaining: left.length, status: r.ok ? 'ok' : 'failed', costUsd: r.costUsd ?? null, error: r.error };
}

function summarize(r) {
  if (r.status !== 'ok') return `failed: ${r.error}`;
  const parts = [];
  const pages = r.pages.map((p) => p.split(':')[0]);
  if (pages.length) parts.push(`from ${pages.join(', ')}`);
  if (r.answered.length) parts.push(`applied ${r.answered.join(', ')}`);
  const c = r.changes;
  parts.push(`${c.created.length} new, ${c.updated.length} updated${c.deleted.length ? `, ${c.deleted.length} removed` : ''}`);
  if (r.newQuestions.length) parts.push(`${r.newQuestions.length} question${r.newQuestions.length > 1 ? 's' : ''}`);
  if (r.repair) parts.push(`repaired ${r.repair.issues - r.repair.remaining}/${r.repair.issues} lint issues`);
  return `Vault ${parts.join(' · ')}`;
}
