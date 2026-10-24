import fs from 'node:fs';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Library } from './library.js';
import { MarkdownRenderer } from './render/markdown.js';
import { createViewer } from './server/server.js';
import { State, Lock } from './state.js';
import { notify } from './notify.js';
import { pendingPages, answeredQuestions, runIngest } from './ingest.js';
import { listQuestions } from './questions.js';
import { ritualStatus } from './rituals.js';
import { ritualCommand, stopAndWait } from './harness.js';
import { writeIndex } from './vaultindex.js';
import { loggerFor } from './log.js';
import { commandsFor } from './command.js';
import { isSeed, resetDemo } from './demo.js';
import { watchTree } from './watch.js';

const TICK_MS = 5000;
const RESCAN_MS = 60_000;
const HEALTH_MS = 60_000;
// The event loop serves every viewer request; a stall this long means something blocked it.
const STALL_MS = 250;

/**
 * The long-running process: watches the notebook and vault, serves the viewer, decides when the
 * agent should ingest, sends notifications and keeps .nbd/status.json fresh for nvim.
 */
export async function runDaemon(ctx, { serve = true, agent = true, notifications = true, tickMs = TICK_MS } = {}) {
  const { paths } = ctx;
  const log = loggerFor(ctx, 'daemon');
  const wlog = loggerFor(ctx, 'watch');
  const ilog = loggerFor(ctx, 'ingest');
  const started = Date.now();
  log.info('starting', {
    pid: process.pid,
    node: process.versions.node,
    home: paths.home,
    serve,
    ingest: agent ? ctx.config.ingest.mode : 'off',
    harness: ctx.config.harness.kind,
    model: ctx.config.harness.model,
    logFile: ctx.logger?.file,
  });
  // A viewer-only process watches too, but leaves the nudging to the real daemon.
  const config = notifications ? ctx.config : { ...ctx.config, notify: { ...ctx.config.notify, enabled: false } };
  if (isSeed(paths.home)) {
    throw new Error(`${paths.home} is the demo seed, which stays as committed. Run \`nbd demo\` for a working copy (reset any time with \`nbd demo --reset\`).`);
  }
  for (const dir of [paths.notebook, paths.vault, paths.inbox, paths.state]) fs.mkdirSync(dir, { recursive: true });

  const daemonLock = new Lock(path.join(paths.state, 'daemon.pid'));
  if (!daemonLock.acquire()) throw new Error(`A daemon is already running for ${paths.home} (pid ${daemonLock.holder()})`);

  const state = new State(paths.state);
  let t0 = performance.now();
  const library = new Library(paths, config).scan();
  log.info('library scanned', { pages: library.pages().length, notes: library.notes().length, ms: ms(t0) });
  let viewer = null;
  let url = null;
  let status = {};

  if (serve) {
    t0 = performance.now();
    const renderer = await new MarkdownRenderer().init();
    log.debug('renderer ready', { ms: ms(t0) });
    viewer = createViewer(ctx, {
      library,
      renderer,
      getStatus: () => status,
      // Agent actions in the viewer go through the daemon, so its bookkeeping stays right.
      // `nbd serve` (agent off) leaves them out and the viewer says how to turn them on.
      agent: agent ? { ingest: (opts) => ingestNow(opts), isRunning: () => Boolean(running) } : null,
      daemon: { resetDemo: (opts) => resetDemoNow(opts), refreshStatus: () => writeStatusSoon() },
    });
    try {
      url = await viewer.listen();
    } catch (err) {
      daemonLock.release();
      if (err.code === 'EADDRINUSE') err.message = `port ${config.server.port} is in use (another nbd serve? set server.port or --port)`;
      throw err;
    }
    log.info(`viewer listening at ${url}`);
  }
  const link = (p) => (url ? `${url}${p}` : null);

  // Page bookkeeping: line counts as last seen (to notice "just became full") and change times.
  const lastLines = new Map(library.pages().map((p) => [p.name, p.lines]));
  const lastChange = new Map();
  let running = null; // { child, startedAt, pages }
  let backoffUntil = 0;
  let dirty = true;

  // ------------------------------------------------------------------------------- watching

  const queue = new Set();
  let flushTimer = null;
  const watchers = [];
  for (const root of ['notebook', 'vault']) {
    try {
      const onChange = (filename) => {
        const rel = `${root}/${filename}`;
        if (rel.split('/').some((part) => part.startsWith('.')) || rel.endsWith('~') || /\.(swp|tmp)$/.test(rel)) return;
        wlog.debug('fs event', { rel });
        queue.add(rel);
        clearTimeout(flushTimer);
        flushTimer = setTimeout(flush, 150);
      };
      const onError = (err) => wlog.error(`watcher failed for ${root}/; relying on periodic rescans`, { err });
      watchers.push(watchTree(paths[root], onChange, { onError }));
    } catch (err) {
      wlog.warn(`cannot watch ${paths[root]}; relying on periodic rescans`, { err });
    }
  }

  function flush() {
    const rels = [...queue];
    queue.clear();
    for (const rel of rels) {
      const before = library.get(rel);
      const doc = library.update(rel);
      if (!doc && !before && !rel.endsWith('.md')) continue;
      if (doc && before && doc.mtime === before.mtime && doc.size === before.size) continue;
      wlog.info(doc ? (before ? 'changed' : 'added') : 'removed', { rel, lines: doc?.kind === 'page' ? doc.lines : undefined });
      viewer?.changed(rel);
      dirty = true;
      if (doc?.kind === 'page' || before?.kind === 'page') onPageChange(doc ?? before, !doc);
      if (rel.startsWith('vault/') && rel !== 'vault/index.md' && rel.endsWith('.md')) indexSoon();
    }
    writeStatusSoon();
  }

  // Keep the catalog in step with notes changed outside an agent run (a run rewrites it itself).
  let indexTimer = null;
  function indexSoon() {
    clearTimeout(indexTimer);
    indexTimer = setTimeout(() => {
      if (running) return indexSoon();
      try {
        if (writeIndex(library)) log.info('rewrote vault/index.md');
      } catch (err) {
        log.error('could not write vault/index.md', { err });
      }
    }, 3000);
  }

  /** Safety net for missed watch events (editors that replace files, network filesystems...). */
  function rescan() {
    const t = performance.now();
    for (const w of watchers) w.sync();
    const known = new Map([...library.docs.values()].map((d) => [d.rel, d]));
    const seen = new Set();
    for (const root of ['notebook', 'vault']) {
      for (const sub of walk(paths[root])) {
        const rel = `${root}/${sub}`;
        seen.add(rel);
        if (!rel.endsWith('.md')) continue;
        const st = safeStat(path.join(paths.home, rel));
        const d = known.get(rel);
        if (!d || (st && (st.mtimeMs !== d.mtime || st.size !== d.size))) queue.add(rel);
      }
    }
    for (const rel of known.keys()) if (!seen.has(rel)) queue.add(rel);
    if (queue.size) {
      // Normally the watcher has seen everything already; finding changes here means it missed some.
      wlog.warn(`rescan found ${queue.size} change(s) the watcher missed`, { files: [...queue].slice(0, 10).join(' '), ms: ms(t) });
      flush();
    } else wlog.debug('rescan clean', { files: seen.size, ms: ms(t) });
  }

  function onPageChange(doc, deleted) {
    lastChange.set(doc.name, Date.now());
    if (deleted) {
      lastLines.delete(doc.name);
      return;
    }
    const max = config.page.maxLines;
    const prev = lastLines.get(doc.name) ?? 0;
    lastLines.set(doc.name, doc.lines);
    if (!config.notify.onPageFull) return;
    if (doc.lines > max && prev <= max && state.markNotified(`overflow:${doc.name}`)) {
      log.info(`notify: ${doc.name} overflows`, { lines: doc.lines, max });
      notify(config, {
        title: `Page ${doc.num} overflows`,
        body: `${doc.lines}/${max} lines. Move ${doc.lines - max} line${doc.lines - max > 1 ? 's' : ''} to the next page.`,
        url: link(doc.route),
        urgency: 'critical',
      });
    } else if (doc.lines >= max && prev < max && state.markNotified(`full:${doc.name}`)) {
      log.info(`notify: ${doc.name} is full`, { lines: doc.lines, max });
      notify(config, {
        title: `Page ${doc.num} is full`,
        body: `${max}/${max} lines. Turn the page: :NotebookNew in nvim, or nbd new.`,
        url: link(doc.route),
      });
    }
  }

  // ------------------------------------------------------------------------------- ingest

  async function scheduleIngest() {
    if (!agent || running || config.ingest.mode !== 'auto' || Date.now() < backoffUntil) return;
    if (!dirty) return;
    const now = Date.now();
    const pending = pendingPages(paths, state.reload());
    const answered = answeredQuestions(paths).filter(
      (q) => !q.answered || now - Date.parse(q.answered) >= config.ingest.answerDelaySeconds * 1000,
    );
    dirty = pending.length > 0 || answeredQuestions(paths).length > 0; // stay awake while work is waiting
    if (!pending.length && !answered.length) return;

    const max = config.page.maxLines;
    const idleMs = (p) => now - (lastChange.get(p.id) ?? p.mtimeMs ?? 0);
    const newest = Math.max(0, ...library.pages().filter((d) => d.text.trim()).map((d) => d.num));
    const turned = (p) => config.ingest.eagerWhenTurned && (p.lines >= max || newest > p.num);
    const ready = pending.filter(
      (p) =>
        p.status === 'deleted' ||
        idleMs(p) >= config.ingest.idleSeconds * 1000 ||
        (turned(p) && idleMs(p) >= config.ingest.batchSeconds * 1000),
    );
    if (!ready.length && !answered.length) return;
    const batch = pending.filter((p) => ready.includes(p) || idleMs(p) >= config.ingest.batchSeconds * 1000).map((p) => p.id);
    const reason = ready.length
      ? `${ready.map((p) => p.id).join(', ')} ${ready.some((p) => turned(p)) ? 'turned/full' : 'settled'}`
      : `${answered.length} answered question${answered.length > 1 ? 's' : ''}`;
    await ingestNow({ pages: batch, reason });
  }

  async function ingestNow({ pages = null, reason = 'manual', onJob } = {}) {
    if (running) return { status: 'busy', error: 'an ingest is already running' };
    running = { startedAt: new Date().toISOString(), pages: pages ?? [], child: null };
    writeStatusSoon();
    ilog.info(`starting: ${reason}`, { pages: pages?.join(' ') });
    // Every run, automatic or requested, shows up live in the viewer's Activity.
    const job = viewer?.jobs.begin({
      kind: 'ingest',
      title: pages?.length ? `Ingest ${pages.join(', ')}` : 'Ingest',
      cli: commandsFor(ctx).sync(pages ?? []),
      href: '/activity',
    });
    onJob?.(job);
    job?.event({ kind: 'text', text: `Why: ${reason}` });
    let record;
    try {
      record = await runIngest(ctx, state, { pages, reason, onEvent: job?.event, onSpawn: (child) => (running.child = child) });
    } catch (err) {
      ilog.error('ingest crashed', { err });
      record = { status: 'failed', error: err.message };
    }
    running = null;
    dirty = true;
    afterIngest(record);
    job?.finish({
      ok: record.status === 'ok' || record.status === 'nothing',
      text: record.status === 'nothing' ? 'Nothing to ingest: the vault is up to date.' : record.summaryLine ?? record.status,
      error: record.status === 'ok' || record.status === 'nothing' ? null : record.error ?? record.status,
      costUsd: record.costUsd ?? null,
      links: [...(record.changes?.created ?? []), ...(record.changes?.updated ?? [])]
        .filter((r) => r.endsWith('.md') && r !== 'index.md' && r !== 'log.md')
        .slice(0, 12)
        .map((r) => ({ href: `/v/${r.slice(0, -3)}`, label: r.slice(0, -3) })),
    });
    writeStatusSoon();
    return record;
  }

  function afterIngest(r) {
    if (r.status === 'busy' || r.status === 'nothing') {
      ilog.info(`skipped: ${r.status}`, { reason: r.error });
      return;
    }
    const fields = {
      ms: r.durationMs,
      costUsd: r.costUsd?.toFixed(3),
      turns: r.turns,
      created: r.changes?.created?.length,
      updated: r.changes?.updated?.length,
      deleted: r.changes?.deleted?.length,
      questions: r.newQuestions?.length,
      session: r.sessionId,
      record: r.recordFile,
    };
    if (r.status === 'ok') ilog.info(`finished: ${r.summaryLine ?? ''}`, fields);
    else ilog.error(`failed: ${r.error ?? 'unknown error'}`, fields);
    if (r.permissionDenials?.length) ilog.warn(`the agent hit ${r.permissionDenials.length} permission denial(s)`, { denials: r.permissionDenials.slice(0, 5) });
    if (r.notebookChanged?.length) ilog.warn(`notebook pages changed during the run: ${r.notebookChanged.join(', ')}`);
    if (r.status === 'ok') {
      backoffUntil = 0;
      if (r.newQuestions?.length && config.notify.onQuestions) {
        notify(config, {
          title: `${r.newQuestions.length} question${r.newQuestions.length > 1 ? 's' : ''} from your notebook`,
          body: r.newQuestions.map((q) => `${q.id}: ${q.title}`).join('\n'),
          url: link('/inbox'),
        });
      }
      if (config.notify.onIngest) notify(config, { title: 'Vault updated', body: r.summaryLine ?? '', url: link('/') });
    } else {
      const failures = state.reload().data.ingest.failures ?? 1;
      const wait = Math.min(3600, 60 * 2 ** (failures - 1));
      backoffUntil = Date.now() + wait * 1000;
      ilog.warn(`backing off after ${failures} consecutive failure(s); next automatic attempt in ${wait}s`);
      if (failures === 1 && config.notify.onErrors) {
        notify(config, { title: 'Notebook agent failed', body: String(r.error ?? 'unknown error').slice(0, 200), urgency: 'critical' });
      }
    }
  }

  // ------------------------------------------------------------------------------- rituals

  function rituals() {
    const parsed = library.parsedPages();
    return ritualStatus(paths, config, new Date(), {
      hasActivity: (from, to) => parsed.some(({ dates }) => dates.dates.some((d) => d >= from && d <= to)),
    });
  }

  function checkRituals() {
    if (!config.notify.onRituals) return;
    for (const r of rituals()) {
      if (!r.due) continue;
      if (!state.markNotified(`ritual:${r.kind}:${r.period}`, { everyHours: config.rituals.remindEveryHours })) continue;
      log.info(`notify: ${r.kind} review due`, { period: r.period });
      notify(config, { title: `${r.title} is ready`, body: `${r.label}\nRun: ${ritualCommand(r.kind)}`, url: link('/rituals') });
    }
  }

  // ------------------------------------------------------------------------------- status

  let statusTimer = null;
  function writeStatusSoon() {
    clearTimeout(statusTimer);
    statusTimer = setTimeout(writeStatus, 300);
  }

  function writeStatus() {
    const pages = library.pages();
    const cur = pages[pages.length - 1];
    const qs = listQuestions(paths);
    let pending = [];
    try {
      pending = pendingPages(paths, state.reload()).map((p) => p.id);
    } catch {}
    status = {
      updatedAt: new Date().toISOString(),
      pid: process.pid,
      home: paths.home,
      url,
      currentPage: cur ? { id: cur.name, num: cur.num, lines: cur.lines, maxLines: cur.maxLines, full: cur.full } : null,
      questions: { open: qs.filter((q) => q.status === 'open').length, answered: qs.filter((q) => q.status === 'answered').length },
      rituals: rituals().map((r) => ({ kind: r.kind, period: r.period, due: r.due, done: r.done })),
      ingest: {
        mode: agent ? config.ingest.mode : 'off',
        running: running ? { startedAt: running.startedAt, pages: running.pages } : null,
        pending,
        backoffUntil: backoffUntil ? new Date(backoffUntil).toISOString() : null,
        lastRun: state.data.ingest.lastRun ?? null,
      },
    };
    try {
      state.writeStatus(status);
    } catch (err) {
      log.warn('could not write .nbd/status.json', { err });
    }
    viewer?.broadcast({ type: 'status' });
  }

  // ------------------------------------------------------------------------------- lifecycle

  const tick = setInterval(() => scheduleIngest().catch((err) => ilog.error('scheduling failed', { err })), tickMs);
  const rescanTimer = setInterval(() => {
    try {
      rescan();
    } catch (err) {
      wlog.error('rescan failed', { err });
    }
  }, RESCAN_MS);
  const ritualTimer = setInterval(checkRituals, 60_000);
  setTimeout(checkRituals, 3000);
  writeStatus();
  log.info(`watching ${paths.home}`, { ingest: agent ? config.ingest.mode : 'off', startupMs: Date.now() - started });

  // Health: event-loop stalls (slow viewer, blocking work) and memory, once a minute.
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  const healthTimer = setInterval(() => {
    const maxMs = loop.max / 1e6;
    const fields = {
      loopP99Ms: (loop.percentile(99) / 1e6).toFixed(1),
      loopMaxMs: maxMs.toFixed(1),
      rssMB: Math.round(process.memoryUsage().rss / 1048576),
      viewers: viewer?.clientCount(),
      ingesting: running ? running.pages.join(' ') || 'yes' : undefined,
    };
    if (maxMs >= STALL_MS) log.warn(`event loop stalled up to ${Math.round(maxMs)}ms in the last minute`, fields);
    else log.debug('health', fields);
    loop.reset();
  }, HEALTH_MS);
  healthTimer.unref();

  // `nbd sync` talks to a running daemon through this file: the daemon picks the request up.
  const syncFile = path.join(paths.state, 'sync-request');
  const syncTimer = setInterval(() => {
    // A viewer-only process (`nbd serve`) never runs the agent; `nbd sync` runs it directly instead.
    if (!agent || !fs.existsSync(syncFile) || running) return;
    fs.rmSync(syncFile, { force: true });
    dirty = true;
    ilog.info('sync requested (nbd sync)');
    ingestNow({ reason: 'sync requested' }).catch((err) => ilog.error('sync failed', { err }));
  }, Math.min(1000, tickMs));

  // ------------------------------------------------------------------------------- demo reset

  /** Put the demo back to its seed, in place, and pick everything up again. CLI and viewer both land here. */
  function resetDemoNow({ fresh = false } = {}) {
    if (!config.demo?.seed) return { status: 'refused', error: 'this notebook is not a demo' };
    if (running || viewer?.jobs.running().length) return { status: 'busy', error: 'an agent run is in progress; reset when it finishes' };
    log.warn(`resetting the demo to its seed${fresh ? ' (pages only)' : ''}`, { seed: config.demo.seed });
    const r = resetDemo({ home: paths.home, fresh });
    for (const w of watchers) w.sync();
    library.scan();
    state.reload();
    lastLines.clear();
    for (const p of library.pages()) lastLines.set(p.name, p.lines);
    lastChange.clear();
    backoffUntil = 0;
    dirty = true;
    viewer?.reset();
    writeStatusSoon();
    log.info('demo reset', { pages: r.pages, notes: library.notes().length, fresh, read: r.skipped.join(' ') || undefined });
    return { status: 'ok', ...r };
  }

  const resetFile = path.join(paths.state, 'reset-request');
  const resetTimer = setInterval(() => {
    if (!fs.existsSync(resetFile)) return;
    let req = {};
    try {
      req = JSON.parse(fs.readFileSync(resetFile, 'utf8'));
    } catch {}
    fs.rmSync(resetFile, { force: true });
    const r = resetDemoNow(req);
    try {
      fs.writeFileSync(path.join(paths.state, 'reset-result'), JSON.stringify({ ...r, at: new Date().toISOString() }));
    } catch {}
  }, 500);

  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    for (const t of [tick, rescanTimer, ritualTimer, syncTimer, healthTimer, resetTimer]) clearInterval(t);
    loop.disable();
    clearTimeout(indexTimer);
    for (const w of watchers) w.close();
    if (running?.child) {
      ilog.warn('stopping the running agent', { pid: running.child.pid });
      await stopAndWait(running.child);
      ilog.info('the agent stopped', { pid: running.child.pid, signal: running.child.signalCode ?? undefined });
    }
    await viewer?.close();
    daemonLock.release();
    try {
      fs.rmSync(path.join(paths.state, 'status.json'), { force: true });
    } catch {}
  }

  return { stop, ingestNow, resetDemo: resetDemoNow, library, url, status: () => status };
}

function* walk(dir, rel = '') {
  let entries = [];
  try {
    entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) yield* walk(dir, r);
    else if (e.isFile()) yield r;
  }
}

function safeStat(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function ms(t0) {
  return Math.round(performance.now() - t0);
}
