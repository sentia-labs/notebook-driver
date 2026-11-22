import { createNextPage, listPages } from '../pages.js';
import { State } from '../state.js';
import { runIngest, pendingPages, skipPages } from '../ingest.js';
import { recordAnswer, dismissQuestion } from '../questions.js';
import { RITUALS, conversationRun, ritualStatus, saveRitualRun } from '../rituals.js';
import { periodRange } from '../periods.js';
import { writeRitualContext } from '../context.js';
import { lintVault, writeLintReport } from '../lint.js';
import { writeIndex } from '../vaultindex.js';
import { Conversations, askPrompt, skillPrompt } from '../conversations.js';
import { commandsFor } from '../command.js';
import { openInEditor, editorCommand } from '../editor.js';
import { tailEntries } from '../logview.js';
import { doctorChecks } from '../doctor.js';
import { logFile } from '../log.js';
import { stopAndWait } from '../harness.js';
import { weekdayShort, ymd } from '../periods.js';

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/**
 * Everything the viewer can do besides showing files. Each action answers with the CLI command
 * that does the same (`cli`), so the browser can show it next to the result.
 *
 * `agent` comes from the daemon ({ ingest(opts), isRunning() }); null under `nbd serve`, where
 * agent actions answer 409 with the command that turns them on.
 */
export function createApi(ctx, { library, jobs, agent, daemon = null, changed, log }) {
  const { paths, config } = ctx;
  const cmd = commandsFor(ctx);
  const conversations = new Conversations(ctx);
  const turning = new Set();
  const children = new Set(); // agent processes of conversation turns, stopped on shutdown

  const needAgent = () => {
    if (!agent) {
      throw new HttpError(409, 'Agent actions are off: this viewer was started with `nbd serve`. Run the daemon instead.', { cli: cmd.daemon() });
    }
  };

  // ------------------------------------------------------------------------------- ingest

  function sync({ pages = [] } = {}) {
    needAgent();
    const ids = pages.filter((p) => /^p\d{4,}$/.test(p));
    if (agent.isRunning()) throw new HttpError(409, 'An ingest is already running.', { href: '/activity' });
    let job = null;
    agent
      .ingest({ pages: ids.length ? ids : null, reason: ids.length ? `viewer: ${ids.join(', ')}` : 'viewer: sync now', onJob: (j) => (job = j) })
      .catch((err) => log.error('sync from the viewer failed', { err }));
    return { ok: true, job: job?.id ?? null, href: '/activity', cli: cmd.sync(ids) };
  }

  function skip({ pages = [] } = {}) {
    const ids = pages.filter((p) => /^p\d{4,}$/.test(p));
    if (agent?.isRunning()) throw new HttpError(409, 'An ingest is running; skip when it finishes.');
    const done = skipPages(ctx, new State(paths.state), ids.length ? ids : null);
    daemon?.refreshStatus();
    return { ok: true, skipped: done, cli: cmd.skip(ids) };
  }

  function demoReset({ fresh = false } = {}) {
    if (!config.demo?.seed) throw new HttpError(404, 'This notebook is not the demo.');
    if (!daemon) throw new HttpError(409, 'No daemon to reset the demo with.', { cli: cmd.demoReset(Boolean(fresh)) });
    const r = daemon.resetDemo({ fresh: Boolean(fresh) });
    if (r.status !== 'ok') throw new HttpError(409, `Can't reset now: ${r.error}`, { cli: cmd.demoReset(Boolean(fresh)) });
    return { ok: true, pages: r.pages, fresh: r.fresh, href: '/', cli: cmd.demoReset(Boolean(fresh)) };
  }

  async function syncPreview() {
    const r = await runIngest(ctx, new State(paths.state), { dryRun: true, reason: 'preview' });
    return { prompt: r.prompt ?? null, status: r.status, cli: cmd.syncPreview() };
  }

  // ------------------------------------------------------------------------------- pages

  function newPage({ topic = '' } = {}) {
    const t = String(topic ?? '').trim().slice(0, 120);
    const today = new Date();
    const p = createNextPage(paths.notebook, { firstLine: t ? `# ${t}` : `# ${ymd(today)} ${weekdayShort(ymd(today))}` });
    const rel = `notebook/${p.id}.md`;
    library.update(rel);
    changed(rel);
    log.info(`new page ${p.id} from the viewer`, { topic: t || undefined });
    return { ok: true, id: p.id, path: p.path, href: `/n/${p.id}`, cli: cmd.newPage(t || null) };
  }

  async function editPage(id, { line = 1 } = {}) {
    const page = listPages(paths.notebook).find((p) => p.id === id);
    if (!page) throw new HttpError(404, `No page ${id}`);
    const n = Math.max(1, Number(line) || 1);
    try {
      const argv = await openInEditor(config, page.path, n);
      log.info(`opened ${id} in the editor`, { argv: argv.join(' ') });
      return { ok: true, cli: cmd.edit(id) };
    } catch (err) {
      log.warn(`could not open ${id} in the editor`, { err });
      throw new HttpError(400, `Couldn't open an editor: ${err.message}`, { cli: cmd.edit(id) });
    }
  }

  // ------------------------------------------------------------------------------- questions

  function answer(id, { answer: text = '' } = {}) {
    const q = recordAnswer(paths, id, String(text), { via: 'web' });
    library.update(q.rel);
    changed(q.rel);
    log.info(`answer recorded for ${id}`, { chars: String(text).length });
    return { ok: true, status: q.status, cli: cmd.answer(id, String(text)) };
  }

  function dismiss(id) {
    dismissQuestion(paths, id);
    library.update(`vault/inbox/${id}.md`);
    changed(`vault/inbox/${id}.md`);
    log.info(`dismissed ${id}`);
    return { ok: true, cli: cmd.dismiss(id) };
  }

  // ------------------------------------------------------------------------------- conversations

  function convCli(conv) {
    const c = { start: conv.cli?.start ?? null, resume: conv.sessionId && config.harness.kind === 'claude' ? cmd.resume(conv.sessionId) : null };
    if (conv.kind === 'ask' && conv.sessionId) c.reply = cmd.askResume(conv.sessionId);
    return c;
  }

  function startTurn(conv) {
    if (turning.has(conv.id)) throw new HttpError(409, 'The agent is still replying.');
    turning.add(conv.id);
    const job = jobs.begin({ kind: 'conversation', title: conv.title, convId: conv.id, href: `/c/${conv.id}`, cli: conv.cli?.start });
    conversations
      .agentTurn(conv, {
        onEvent: job.event,
        onSpawn: (child) => {
          children.add(child);
          child.once('close', () => children.delete(child));
        },
      })
      .then((turn) => {
        if (conv.kind === 'ritual') saveRitualRun(paths, conversationRun(paths, conv));
        return turn;
      })
      .then((turn) => job.finish({ ok: turn.ok, text: turn.ok ? turn.text.split('\n').find((l) => l.trim())?.slice(0, 200) ?? '' : '', error: turn.ok ? null : turn.text, costUsd: turn.costUsd }))
      .catch((err) => {
        log.error(`conversation ${conv.id} turn failed`, { err });
        job.finish({ ok: false, error: err.message });
      })
      .finally(() => turning.delete(conv.id));
    return job;
  }

  function ask({ question = '' } = {}) {
    needAgent();
    const q = String(question).trim().slice(0, 4000);
    if (!q) throw new HttpError(400, 'Ask something first.');
    const conv = conversations.create({
      kind: 'ask',
      title: q.length > 80 ? `${q.slice(0, 77)}…` : q,
      purpose: 'ask',
      firstPrompt: askPrompt(q),
      opening: q,
      cli: { start: cmd.ask(q) },
    });
    const job = startTurn(conv);
    return { ok: true, id: conv.id, job: job.id, href: `/c/${conv.id}`, cli: cmd.ask(q) };
  }

  function reply(id, { text = '' } = {}) {
    needAgent();
    const conv = conversations.get(id);
    if (!conv) throw new HttpError(404, 'No such conversation.');
    const t = String(text).trim().slice(0, 8000);
    if (!t) throw new HttpError(400, 'Write something first.');
    if (turning.has(conv.id)) throw new HttpError(409, 'The agent is still replying.');
    conversations.addHuman(conv, t);
    const job = startTurn(conv);
    return { ok: true, job: job.id, cli: convCli(conv).reply ?? convCli(conv).resume ?? conv.cli?.start };
  }

  function startRitual(kind, { period } = {}) {
    needAgent();
    const r = RITUALS[kind];
    if (!r) throw new HttpError(404, `No ritual ${kind}`);
    const status = rituals().find((x) => x.kind === kind);
    const p = String(period || status?.period || '');
    try {
      periodRange(kind, p);
    } catch (err) {
      throw new HttpError(400, err.message);
    }
    // Pick up an unfinished conversation for the same review instead of starting over.
    const existing = conversations.list({ kind: 'ritual' }).find((c) => c.meta?.ritual === kind && c.meta?.period === p && !c.meta?.closed);
    if (existing) return { ok: true, id: existing.id, href: `/c/${existing.id}`, resumed: true, cli: cmd.ritual(kind, p) };
    const c = writeRitualContext(ctx, library, kind, p);
    const conv = conversations.create({
      kind: 'ritual',
      title: `${r.title} · ${p}`,
      purpose: 'ingest',
      firstPrompt: skillPrompt(ctx, r.skill, `${p} ${c.rel}`),
      opening: `Let's do the ${r.title.toLowerCase()} for ${p}.`,
      cli: { start: cmd.ritual(kind, p) },
      meta: { ritual: kind, period: p, note: `vault/journal/${r.folder}/${p}.md` },
    });
    const job = startTurn(conv);
    return { ok: true, id: conv.id, job: job.id, href: `/c/${conv.id}`, cli: cmd.ritual(kind, p) };
  }

  function lintFix() {
    needAgent();
    const issues = lintVault(library);
    const rel = writeLintReport(paths, issues);
    const conv = conversations.create({
      kind: 'lint',
      title: `Vault clean-up · ${issues.length} issue${issues.length === 1 ? '' : 's'}`,
      purpose: 'ingest',
      firstPrompt: skillPrompt(ctx, 'nbd-lint', rel),
      opening: `Let's clean up the vault (${issues.length} mechanical issue${issues.length === 1 ? '' : 's'} found).`,
      cli: { start: cmd.lintFix() },
    });
    const job = startTurn(conv);
    return { ok: true, id: conv.id, job: job.id, href: `/c/${conv.id}`, cli: cmd.lintFix() };
  }

  function closeConversation(id) {
    const conv = conversations.get(id);
    if (!conv) throw new HttpError(404, 'No such conversation.');
    conv.meta = { ...(conv.meta ?? {}), closed: true };
    conversations.save(conv);
    return { ok: true };
  }

  // ------------------------------------------------------------------------------- vault

  function rebuildIndex() {
    const wrote = writeIndex(library);
    if (wrote) {
      library.update('vault/index.md');
      changed('vault/index.md');
    }
    log.info(`index ${wrote ? 'rewritten' : 'already up to date'} (viewer)`);
    return { ok: true, wrote, cli: cmd.index() };
  }

  // ------------------------------------------------------------------------------- status

  function rituals() {
    const parsed = library.parsedPages();
    return ritualStatus(paths, config, new Date(), {
      hasActivity: (from, to) => parsed.some(({ dates }) => dates.dates.some((d) => d >= from && d <= to)),
    });
  }

  function pending() {
    try {
      return pendingPages(paths, new State(paths.state));
    } catch {
      return [];
    }
  }

  function logs({ level = null, n = 150 } = {}) {
    const lvl = ['error', 'warn', 'info', 'debug'].includes(level) ? level : null;
    return { entries: tailEntries(logFile(paths), { lines: Math.min(500, Number(n) || 150), level: lvl }), cli: cmd.logs(lvl) };
  }

  async function doctor() {
    return { checks: await doctorChecks(ctx), cli: cmd.doctor() };
  }

  /** Everything the command palette (Ctrl-K) offers, each with its command. */
  async function palette({ currentPage = null } = {}) {
    const go = (label, href, cli = null, hint = '') => ({ kind: 'go', label, href, cli, hint });
    const post = (label, url, cli, hint = '', body = {}) => ({ kind: 'post', label, url, cli, hint, body, agent: false });
    const items = [
      post('New page', '/api/pages/new', cmd.newPage(), 'Turn the page'),
      { ...post('Sync now', '/api/sync', cmd.sync(), 'Run the agent on changed pages and answered questions'), agent: true },
      go('Ask the second brain…', '/ask', cmd.ask('…'), 'Read-only questions, with follow-ups'),
    ];
    for (const r of rituals()) {
      items.push({ ...post(`Start the ${r.title.toLowerCase()} (${r.period})`, `/api/rituals/${r.kind}/start`, cmd.ritual(r.kind, r.period), r.due ? 'Due now' : r.label, { period: r.period }), agent: true });
    }
    if (currentPage) {
      items.push(post(`Open p.${Number(currentPage.slice(1))} in the editor`, `/api/pages/${currentPage}/edit`, cmd.edit(currentPage), (await editorCommand(config)) ? '' : 'Set editor.command in nbd.json'));
      items.push({ ...post(`Ingest p.${Number(currentPage.slice(1))} now`, '/api/sync', cmd.sync([currentPage]), '', { pages: [currentPage] }), agent: true });
    }
    items.push(
      go('Preview the ingest prompt', '/activity#prompt', cmd.syncPreview(), 'What the agent would be told, without running it'),
      go('Check the vault', '/activity#health', cmd.lint(), 'Broken links, misquoted citations, missing sources'),
      { ...post('Clean up the vault with the agent', '/api/lint/fix', cmd.lintFix()), agent: true },
      post('Rebuild the vault index', '/api/index', cmd.index(), 'vault/index.md from frontmatter'),
      go('Logs', '/activity#logs', cmd.logs()),
      go('Setup checks', '/activity#setup', cmd.doctor()),
      go('Status', '/activity', cmd.status()),
      go('Today', '/'),
      go('Pages', '/notebook'),
      go('Tasks', '/tasks', cmd.tasks()),
      go('Inbox', '/inbox', cmd.questions()),
      go('Rituals', '/rituals', cmd.rituals()),
      go('Activity', '/activity'),
      go('Key: bullets & signifiers', '/key'),
    );
    if (config.demo?.seed) {
      items.unshift(
        post('Reset the demo', '/api/demo/reset', cmd.demoReset(), 'Back to the seed: its pages, and the vault built from them'),
        post('Reset the demo to pages only', '/api/demo/reset', cmd.demoReset(true), 'Empty vault; the first ingest builds it', { fresh: true }),
      );
    }
    return { items: items.map((i) => ({ ...i, disabled: i.agent && !agent })) };
  }

  // ------------------------------------------------------------------------------- routing

  /** GET /api/... → JSON value, or undefined when not ours. */
  async function get(p, params) {
    if (p === '/api/sync/preview') return syncPreview();
    if (p === '/api/logs') return logs({ level: params.get('level'), n: params.get('n') });
    if (p === '/api/doctor') return doctor();
    if (p === '/api/palette') return palette({ currentPage: /^p\d{4,}$/.test(params.get('page') ?? '') ? params.get('page') : null });
    if (p === '/api/jobs') return { jobs: jobs.list() };
    let m = /^\/api\/conversations\/(c[0-9a-z]+)$/.exec(p);
    if (m) {
      const conv = conversations.get(m[1]);
      if (!conv) throw new HttpError(404, 'No such conversation.');
      return { ...conv, firstPrompt: undefined, busy: turning.has(conv.id), cli: convCli(conv) };
    }
    return undefined;
  }

  /** POST /api/... → JSON value, or undefined when not ours. */
  async function post(p, body) {
    if (p === '/api/sync') return sync(body);
    if (p === '/api/sync/skip') return skip(body);
    if (p === '/api/demo/reset') return demoReset(body);
    if (p === '/api/pages/new') return newPage(body);
    if (p === '/api/index') return rebuildIndex();
    if (p === '/api/ask') return ask(body);
    if (p === '/api/lint/fix') return lintFix();
    let m = /^\/api\/pages\/(p\d{4,})\/edit$/.exec(p);
    if (m) return editPage(m[1], body);
    m = /^\/api\/questions\/(q\d{4,})\/answer$/.exec(p);
    if (m) return wrap400(() => answer(m[1], body));
    m = /^\/api\/questions\/(q\d{4,})\/dismiss$/.exec(p);
    if (m) return wrap400(() => dismiss(m[1]));
    m = /^\/api\/rituals\/(\w+)\/start$/.exec(p);
    if (m) return startRitual(m[1], body);
    m = /^\/api\/conversations\/(c[0-9a-z]+)\/reply$/.exec(p);
    if (m) return reply(m[1], body);
    m = /^\/api\/conversations\/(c[0-9a-z]+)\/close$/.exec(p);
    if (m) return closeConversation(m[1]);
    return undefined;
  }

  function wrap400(fn) {
    try {
      return fn();
    } catch (err) {
      throw new HttpError(400, err.message);
    }
  }

  /** Shutdown: don't leave conversation agents running after the daemon exits. */
  async function stopAll() {
    if (children.size) log.warn(`stopping ${children.size} conversation agent(s)`);
    await Promise.all([...children].map((c) => stopAndWait(c)));
  }

  return { get, post, conversations, convCli, rituals, pending, isBusy: (id) => turning.has(id), cmd, agentOn: () => Boolean(agent), stopAll };
}

