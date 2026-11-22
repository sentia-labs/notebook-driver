import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { html } from './html.js';
import * as V from './views.js';
import { listQuestions } from '../questions.js';
import { listRitualRuns, ritualStatus, RITUALS } from '../rituals.js';
import { collectTasks, isOpen, taskAgeDays } from '../tasks.js';
import { periodOf, periodLabel } from '../periods.js';
import { escapeHtml, safeJoin } from '../util.js';
import { notebookIndex } from '../nbindex.js';
import { loggerFor } from '../log.js';
import { State } from '../state.js';
import { lintVault } from '../lint.js';
import { periodRange } from '../periods.js';
import { buildRitualContext } from '../context.js';
import { Jobs } from './jobs.js';
import { createApi, HttpError } from './api.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STATIC = {
  '/assets/': path.join(ROOT, 'web'),
  '/vendor/mermaid/': path.join(ROOT, 'node_modules/mermaid/dist'),
  '/vendor/katex/': path.join(ROOT, 'node_modules/katex/dist'),
};
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};
const CSP =
  "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; " +
  "script-src 'self' 'sha256-%THEME%'; connect-src 'self'; font-src 'self' data:; object-src 'none'; " +
  "base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

/**
 * The read-mostly web viewer. `library` is a scanned Library kept fresh by the caller; call
 * `changed(rel)` after updating it so open browsers live-reload.
 */
export function createViewer(ctx, { library, renderer, getStatus = () => null, agent = null, daemon = null }) {
  const { paths, config } = ctx;
  const log = loggerFor(ctx, 'viewer');
  const blog = loggerFor(ctx, 'browser');
  const slowMs = config.server.slowRequestMs ?? 500;
  const clients = new Set();
  let seq = 0;
  let sseWarned = 0;
  const clientLogBudget = { tokens: 30, at: Date.now() };
  const cache = new Map();
  const themeHash = inlineScriptHash();
  const jobs = new Jobs((event) => broadcast(event));
  const api = createApi(ctx, { library, jobs, agent, daemon, changed: (rel) => changed(rel), log });
  const cmd = api.cmd;
  // The Activity page tails the log live.
  const unsubscribeLog = ctx.logger?.subscribe?.(({ level, line }) => broadcast({ type: 'log', level, line })) ?? (() => {});

  const resolveFor = (doc) => ({
    resolveWikilink(target) {
      const d = library.resolve(target);
      if (d) return { href: d.route, label: d.kind === 'page' ? `p.${d.num}` : null, exists: true, kind: d.kind };
      const asset = library.resolveAsset(target);
      if (asset) return { href: `/file/${asset}`, label: null, exists: true, kind: 'asset' };
      return null;
    },
    resolveHref(href, { asset = false } = {}) {
      if (!href || href.startsWith('#') || href.startsWith('/')) return href;
      const [p, frag = ''] = href.split('#');
      let rel;
      try {
        rel = path.posix.normalize(path.posix.join(path.posix.dirname(doc.rel), decodeURI(p)));
      } catch {
        return href;
      }
      if (!asset && rel.endsWith('.md')) {
        const target = library.get(rel);
        return target ? target.route + (frag ? `#${frag}` : '') : href;
      }
      return `/file/${rel.split('/').map(encodeURIComponent).join('/')}`;
    },
  });

  async function render(doc, res) {
    const key = `${doc.rel}:${doc.mtime}:${doc.size}`;
    if (cache.has(key)) {
      if (res?.nbd) res.nbd.cache = 'hit';
      return cache.get(key);
    }
    const t0 = performance.now();
    const env = { mode: doc.kind === 'page' ? 'notebook' : 'vault', lineOffset: doc.bodyLine ?? 0, ...resolveFor(doc) };
    const out = { html: await renderer.renderAsync(doc.body, env), toc: env.toc };
    cache.set(key, out);
    if (res?.nbd) {
      res.nbd.cache = 'miss';
      res.nbd.renderMs = performance.now() - t0;
    }
    return out;
  }

  function counts() {
    const qs = library.notes().filter((n) => n.rel.startsWith('vault/inbox/') && String(n.frontmatter.status ?? 'open') === 'open');
    const status = getStatus();
    return {
      questions: qs.length,
      rituals: rituals().filter((r) => r.due).length,
      agent: {
        on: Boolean(agent),
        mode: agent ? config.ingest.mode : 'off',
        running: jobs.running().length,
        pending: status?.ingest?.pending?.length ?? 0,
      },
    };
  }

  function rituals() {
    const parsed = library.parsedPages();
    return ritualStatus(paths, config, new Date(), {
      hasActivity: (from, to) => parsed.some(({ dates }) => dates.dates.some((d) => d >= from && d <= to)),
    });
  }

  function page(res, { title, active, currentRel, main, aside, bodyClass, status = 200 }) {
    const body = V.layout({ title, active, counts: counts(), sidebar: V.sidebar(library, currentRel, cmd), main, aside, bodyClass, name: config.name || 'Notebook', demo: Boolean(config.demo?.seed), currentPage: /^notebook\/(p\d{4,})\.md$/.exec(currentRel ?? '')?.[1] ?? null });
    send(res, status, String(body), 'text/html; charset=utf-8', { 'Content-Security-Policy': CSP.replace('%THEME%', themeHash) });
  }

  function renderValue(v) {
    if (Array.isArray(v)) return v.map(renderValue).join(', ');
    if (v && typeof v === 'object') return escapeHtml(JSON.stringify(v));
    const s = String(v ?? '');
    return escapeHtml(s).replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (m, t, label) => {
      const d = library.resolve(t.replaceAll('&amp;', '&'));
      const text = label ?? (d?.kind === 'page' ? `p.${d.num}` : t);
      const href = escapeHtml(d?.route ?? '');
      return d ? `<a href="${href}" data-preview="${href}">${text}</a>` : `<span class="wikilink missing">${text}</span>`;
    });
  }

  // -------------------------------------------------------------------------------------------

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    let p;
    try {
      p = decodeURIComponent(url.pathname);
    } catch {
      return send(res, 400, 'Bad request');
    }

    if (!hostAllowed(req, config)) {
      log.warn('rejected request for an unknown Host (add it to server.allowedHosts if it is yours)', { host: req.headers.host, path: p });
      return send(res, 403, 'Forbidden host');
    }

    if (req.method === 'POST') return handlePost(req, res, p);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');

    for (const [prefix, dir] of Object.entries(STATIC)) {
      if (p.startsWith(prefix)) return serveFile(res, dir, p.slice(prefix.length), prefix === '/assets/' ? 'no-cache' : 'public, max-age=86400');
    }
    if (p.startsWith('/file/')) {
      const rel = p.slice(6);
      if (!/^(notebook|vault)\//.test(rel)) return send(res, 404, 'Not found');
      return serveFile(res, paths.home, rel, 'no-cache');
    }
    if (p.startsWith('/raw/')) {
      const doc = library.get(p.slice(5));
      return doc ? send(res, 200, doc.text, 'text/plain; charset=utf-8') : send(res, 404, 'Not found');
    }
    if (p === '/events') return sse(req, res);
    if (p === '/api/search') return searchApi(res, url.searchParams.get('q') ?? '');
    if (p === '/api/preview') return previewApi(res, url.searchParams.get('route') ?? '');
    if (p === '/api/status') return json(res, 200, { ...(getStatus() ?? {}), counts: counts() });
    if (p.startsWith('/api/')) {
      try {
        const out = await api.get(p, url.searchParams);
        if (out !== undefined) return json(res, 200, out);
      } catch (err) {
        return apiError(res, p, err);
      }
      return json(res, 404, { error: 'not found' });
    }

    if (p === '/') return homeRoute(res);
    if (p === '/notebook') return notebookRoute(res);
    if (p.startsWith('/n/')) return pageRoute(res, p.slice(3), url.searchParams.get('view'));
    if (p === '/v' || p.startsWith('/v/')) return vaultRoute(res, p.slice(3));
    if (p.startsWith('/f/')) return fileRoute(res, p.slice(3));
    if (p === '/search') return searchRoute(res, url.searchParams.get('q') ?? '');
    if (p === '/inbox') return inboxRoute(res);
    if (p === '/tasks') return tasksRoute(res);
    if (p === '/rituals') return ritualsRoute(res);
    if (p === '/key') return keyRoute(res);
    if (p === '/ask') return askRoute(res);
    if (p === '/activity') return activityRoute(res);
    if (p.startsWith('/c/')) return conversationRoute(res, p.slice(3));
    const rc = /^\/rituals\/(\w+)\/([\w-]+)\/context$/.exec(p);
    if (rc) return ritualContextRoute(res, rc[1], rc[2]);
    return page(res, { title: 'Not found', main: V.notFoundMain(p), status: 404 });
  }

  async function homeRoute(res) {
    const pages = library.pages();
    const current = pages[pages.length - 1] ?? null;
    const rendered = current ? (await render(current, res)).html : '';
    const tasks = collectTasks(library.parsedPages()).filter(isOpen);
    const recent = library
      .notes()
      .filter((n) => !['index', 'log'].includes(n.name))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 8);
    const status = getStatus();
    page(res, {
      title: 'Today',
      currentRel: current?.rel,
      main: V.homeMain({
        current,
        rendered,
        questions: counts().questions,
        rituals: rituals(),
        openTasks: tasks.length,
        recent,
        lastRun: status?.ingest?.lastRun ?? null,
        cmd,
        agentOn: Boolean(agent),
        pending: status?.ingest?.pending ?? [],
      }),
    });
  }

  function notebookRoute(res) {
    const all = library.parsedPages();
    const parsed = new Map(all.map((x) => [x.doc.name, x]));
    page(res, { title: 'Pages', active: 'notebook', main: V.notebookMain(library.pages(), parsed, notebookIndex(all), cmd) });
  }

  async function pageRoute(res, name, view) {
    const doc = library.get(`notebook/${name}.md`);
    if (!doc || doc.kind !== 'page') return page(res, { title: 'Not found', main: V.notFoundMain(`No page ${name}`), status: 404 });
    const pages = library.pages();
    const i = pages.findIndex((x) => x.rel === doc.rel);
    const parsed = library.parsedPages().find((x) => x.doc.rel === doc.rel);
    const recs = parsed?.records ?? [];
    const count = (pred) => recs.filter(pred).length;
    const stats = [
      ['Lines', `${doc.lines} / ${doc.maxLines}`],
      ['Open tasks', count((r) => r.kind === 'task' && (r.state === 'open' || r.state === 'started'))],
      ['Done', count((r) => r.kind === 'task' && r.state === 'done')],
      ['Migrated / scheduled', count((r) => r.kind === 'task' && (r.state === 'migrated' || r.state === 'scheduled'))],
      ['Events', count((r) => r.kind === 'event')],
      ['Notes', count((r) => r.kind === 'note')],
      ['Last edited', new Date(doc.mtime).toLocaleString()],
    ];
    const { html: rendered } = await render(doc, res);
    page(res, {
      title: `p.${doc.num} ${doc.title}`,
      currentRel: doc.rel,
      bodyClass: 'is-page',
      main: V.pageMain({
        doc,
        rendered,
        prev: pages[i - 1],
        next: pages[i + 1],
        dates: parsed?.dates,
        view: view === 'source' ? 'source' : 'rendered',
        cmd,
        agentOn: Boolean(agent),
        pending: (getStatus()?.ingest?.pending ?? api.pending().map((x) => x.id)).includes(doc.name),
        isLast: i === pages.length - 1,
      }),
      aside: V.pageAside({ doc, derived: library.derivedFrom(doc.name), backlinks: library.backlinks(doc.rel), stats }),
    });
  }

  async function vaultRoute(res, sub) {
    const clean = sub.replace(/^\/+|\/+$/g, '');
    const doc = clean ? library.get(`vault/${clean}.md`) : null;
    const crumbs = crumbsFor(clean);
    if (doc) {
      const { html: rendered, toc } = await render(doc, res);
      const sources = doc.sources.map((s) => library.get(`notebook/${s}.md`)).filter(Boolean);
      return page(res, {
        title: doc.title,
        currentRel: doc.rel,
        main: V.noteMain({ doc, rendered, crumbs: crumbs.slice(0, -1) }),
        aside: V.noteAside({ doc, sources, backlinks: library.backlinks(doc.rel), toc, propsHtml: String(V.propsTable(doc.frontmatter, renderValue)) }),
      });
    }
    const prefix = clean ? `vault/${clean}/` : 'vault/';
    const notes = library.notes().filter((n) => n.rel.startsWith(prefix));
    if (!notes.length && clean) return page(res, { title: 'Not found', main: V.notFoundMain(`Nothing at vault/${clean}`), status: 404 });
    page(res, { title: clean || 'Vault', currentRel: prefix, main: V.folderMain({ folder: clean, notes, crumbs }) });
  }

  async function fileRoute(res, sub) {
    const doc = library.get(`${sub}.md`);
    if (!doc) return page(res, { title: 'Not found', main: V.notFoundMain(sub), status: 404 });
    const { html: rendered } = await render(doc, res);
    page(res, { title: doc.title, currentRel: doc.rel, main: V.noteMain({ doc, rendered, crumbs: [{ href: '/', label: 'home' }] }) });
  }

  function searchRoute(res, q) {
    page(res, { title: `Search: ${q}`, main: V.searchMain({ q, results: q.trim() ? library.search(q, { limit: 60 }) : [] }) });
  }

  function searchApi(res, q) {
    const results = q.trim() ? library.search(q, { limit: 12 }) : [];
    json(res, 200, results.map((r) => ({
      title: r.doc.kind === 'page' ? `p.${r.doc.num} · ${r.doc.title}` : r.doc.title,
      route: r.doc.route,
      kind: r.doc.kind,
      type: r.doc.type,
      snippet: String(html`${V.highlightSnippet(r.snippet)}`),
    })));
  }

  async function previewApi(res, route) {
    const doc = library.byRoute(route.split('#')[0]);
    if (!doc) return json(res, 404, { error: 'not found' });
    const body = doc.kind === 'page' ? doc.body : doc.body.slice(0, 2500);
    const env = { mode: doc.kind === 'page' ? 'notebook' : 'vault', ...resolveFor(doc) };
    const rendered = await renderer.renderAsync(body, env);
    json(res, 200, {
      title: doc.kind === 'page' ? `p.${doc.num} · ${doc.title}` : doc.title,
      kind: doc.kind,
      type: doc.type,
      html: rendered,
    });
  }

  async function inboxRoute(res) {
    const qs = listQuestions(paths).reverse();
    const bodies = new Map();
    for (const q of qs.filter((x) => x.status === 'open')) {
      const doc = library.get(q.rel) ?? { rel: q.rel };
      const body = q.body.replace(/^#\s+.*$/m, '').replace(/^##\s+Answer\s*$[\s\S]*$/im, '');
      bodies.set(q.id, await renderer.renderAsync(body, { mode: 'vault', ...resolveFor(doc) }));
    }
    page(res, {
      title: 'Inbox',
      active: 'inbox',
      main: V.inboxMain({
        cmd,
        agentOn: Boolean(agent),
        open: qs.filter((q) => q.status === 'open'),
        answered: qs.filter((q) => q.status === 'answered'),
        closed: qs.filter((q) => q.status === 'resolved' || q.status === 'dismissed'),
        renderQuestion: (q) => bodies.get(q.id) ?? '',
      }),
    });
  }

  function tasksRoute(res) {
    const now = new Date();
    const all = collectTasks(library.parsedPages());
    const open = all.filter(isOpen).map((t) => ({ ...t, age: taskAgeDays(t, now) }));
    const thisMonth = periodOf('monthly', now);
    const groups = new Map();
    for (const t of open) {
      const month = t.date?.slice(0, 7) ?? t.month ?? 'undated';
      const key = month === 'undated' ? 'Undated' : month === thisMonth ? 'This month' : periodLabel('monthly', month);
      if (!groups.has(key)) groups.set(key, { title: key, sort: month, tasks: [] });
      groups.get(key).tasks.push(t);
    }
    const ordered = [...groups.values()].sort((a, b) => (a.sort < b.sort ? -1 : 1));
    const by = (s) => all.filter((t) => t.state === s).length;
    page(res, {
      title: 'Tasks',
      active: 'tasks',
      main: V.tasksMain({
        groups: ordered,
        counts: [['Open', by('open') + by('started')], ['Done', by('done')], ['Migrated', by('migrated')], ['Scheduled', by('scheduled')], ['Struck', by('irrelevant')]],
        now,
      }),
    });
  }

  function ritualsRoute(res) {
    const history = library
      .notes()
      .filter((n) => n.rel.startsWith('vault/journal/') && ['done', 'completed', true].includes(n.frontmatter.review))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 20);
    const open = api.conversations.list({ kind: 'ritual' }).filter((c) => !c.meta?.closed);
    page(res, { title: 'Rituals', active: 'rituals', main: V.ritualsMain({ rituals: rituals(), history, runs: listRitualRuns(paths), cmd, agentOn: Boolean(agent), open }) });
  }

  async function ritualContextRoute(res, kind, period) {
    if (!RITUALS[kind]) return page(res, { title: 'Not found', main: V.notFoundMain(`No ritual ${kind}`), status: 404 });
    try {
      periodRange(kind, period);
    } catch (err) {
      return page(res, { title: 'Not found', main: V.notFoundMain(err.message), status: 404 });
    }
    const text = buildRitualContext(ctx, library, kind, period);
    const rendered = await renderer.renderAsync(text, { mode: 'vault', ...resolveFor({ rel: 'vault/x.md' }) });
    page(res, { title: `${RITUALS[kind].title} · ${period}`, active: 'rituals', main: V.ritualContextMain({ kind, period, title: RITUALS[kind].title, rendered, cmd, agentOn: Boolean(agent) }) });
  }

  // ------------------------------------------------------------------------------- agent pages

  function askRoute(res) {
    const recent = api.conversations.list({ limit: 40 });
    page(res, { title: 'Ask', active: 'ask', main: V.askMain({ recent, cmd, agentOn: Boolean(agent) }) });
  }

  async function conversationRoute(res, id) {
    const conv = api.conversations.get(id);
    if (!conv) return page(res, { title: 'Not found', main: V.notFoundMain(`No conversation ${id}`), status: 404 });
    const env = () => ({ mode: 'vault', ...resolveFor({ rel: 'vault/x.md' }) });
    const turns = [];
    for (const t of conv.turns) turns.push({ ...t, html: await renderer.renderAsync(t.text, env()) });
    const job = jobs.running('conversation').find((j) => j.convId === conv.id) ?? null;
    const note = conv.meta?.note ? library.get(conv.meta.note) : null;
    page(res, {
      title: conv.title,
      active: conv.kind === 'ritual' ? 'rituals' : conv.kind === 'ask' ? 'ask' : 'activity',
      bodyClass: 'is-convo',
      main: V.conversationMain({ conv, turns, busy: api.isBusy(conv.id), job, cli: api.convCli(conv), agentOn: Boolean(agent), note, cmd }),
    });
  }

  function activityRoute(res) {
    const status = getStatus();
    const state = new State(paths.state);
    const issues = lintVault(library);
    page(res, {
      title: 'Activity',
      active: 'activity',
      main: V.activityMain({
        agent: { on: Boolean(agent), mode: agent ? config.ingest.mode : 'off', harness: config.harness.kind, model: config.harness.model, idleSeconds: config.ingest.idleSeconds },
        jobs: jobs.list(),
        pending: api.pending(),
        runs: state.listRuns(12),
        status,
        issues,
        logLevel: config.log?.level ?? 'info',
        logFile: ctx.logger?.file ?? null,
        conversations: api.conversations.list({ limit: 8 }),
        cmd,
        demo: config.demo?.seed ? config.demo : null,
      }),
    });
  }

  async function keyRoute(res) {
    let text;
    try {
      text = fs.readFileSync(path.join(paths.home, 'KEY.md'), 'utf8');
    } catch {
      return page(res, { title: 'Key', main: V.notFoundMain('No KEY.md in this notebook home (nbd init creates one).'), status: 404 });
    }
    const doc = { rel: 'KEY.md', kind: 'file', body: text };
    const rendered = await renderer.renderAsync(text, { mode: 'notebook', ...resolveFor(doc) });
    page(res, { title: 'Key', main: V.keyMain(rendered) });
  }

  // -------------------------------------------------------------------------------------------

  async function handlePost(req, res, p) {
    const origin = req.headers.origin;
    if (req.headers['x-nbd'] !== '1' || (origin && new URL(origin).host !== req.headers.host)) {
      return json(res, 403, { error: 'forbidden' });
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { error: 'bad json' });
    }
    if (p === '/api/client-log') return clientLog(req, res, body);
    try {
      const out = await api.post(p, body ?? {});
      if (out !== undefined) return json(res, 200, out);
    } catch (err) {
      return apiError(res, p, err);
    }
    json(res, 404, { error: 'not found' });
  }

  function apiError(res, p, err) {
    if (!(err instanceof HttpError)) throw err;
    log.info(`${p}: ${err.message}`, { status: err.status });
    return json(res, err.status, { error: err.message, ...err.extra });
  }

  /** Errors and slow page loads reported by the browser (web/app.js), rate-limited. */
  function clientLog(req, res, body) {
    const now = Date.now();
    clientLogBudget.tokens = Math.min(30, clientLogBudget.tokens + ((now - clientLogBudget.at) / 60_000) * 30);
    clientLogBudget.at = now;
    if (clientLogBudget.tokens < 1) return json(res, 429, { error: 'slow down' });
    clientLogBudget.tokens -= 1;
    const level = ['error', 'warn', 'info'].includes(body?.level) ? body.level : 'info';
    const clip = (v, n) => (v == null ? undefined : String(v).slice(0, n));
    const data = body?.data && typeof body.data === 'object' ? JSON.stringify(body.data).slice(0, 1000) : undefined;
    const msg = clip(body?.msg, 500) ?? '(no message)';
    // Shaped as an Error so the stack prints like a server-side one, on indented lines.
    const err = body?.stack ? Object.assign(new Error('stack'), { stack: clip(body.stack, 2000) }) : undefined;
    blog[level](msg, { page: clip(body?.url, 300), data, ua: clip(req.headers['user-agent'], 120), err });
    json(res, 200, { ok: true });
  }

  function sse(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    clients.add(res);
    const opened = Date.now();
    log.debug('live-reload stream opened', { rid: res.nbd?.rid, open: clients.size });
    if (clients.size >= SSE_WARN_AT && Date.now() - sseWarned > 60_000) {
      sseWarned = Date.now();
      log.warn(`${clients.size} live-reload streams are open; a browser stalls once one host holds 6 connections`, {
        hint: 'tabs share one stream in this version; reload old tabs, or several browsers are connected',
      });
    }
    req.on('close', () => {
      clients.delete(res);
      log.debug('live-reload stream closed', { rid: res.nbd?.rid, open: clients.size, s: Math.round((Date.now() - opened) / 1000) });
    });
  }

  const heartbeat = setInterval(() => {
    for (const c of clients) c.write(': ping\n\n');
  }, 25000);
  heartbeat.unref();

  /** Tell browsers a file changed so they can refresh. */
  function changed(rel) {
    cache.clear();
    log.debug('pushing change to browsers', { rel, streams: clients.size });
    const doc = library.get(rel);
    const msg = `data: ${JSON.stringify({ type: 'change', rel, route: doc?.route ?? null })}\n\n`;
    for (const c of clients) c.write(msg);
  }

  /** After a demo reset: drop everything cached and send open tabs back to a fresh page. */
  function reset() {
    cache.clear();
    jobs.items.clear();
    broadcast({ type: 'reset' });
  }

  function broadcast(event) {
    const msg = `data: ${JSON.stringify(event)}\n\n`;
    for (const c of clients) c.write(msg);
  }

  const server = http.createServer((req, res) => {
    res.nbd = { rid: ++seq, start: performance.now(), bytes: 0 };
    res.on('finish', () => access(req, res));
    res.on('close', () => {
      if (!res.writableFinished && req.url !== '/events') log.debug('client went away before the response finished', { rid: res.nbd.rid, path: req.url });
    });
    handle(req, res).catch((err) => {
      log.error(`${req.method} ${req.url} failed`, { rid: res.nbd.rid, err });
      if (!res.headersSent) send(res, 500, `Internal error: ${err.message}`);
      else res.end();
    });
  });
  server.on('clientError', (err, socket) => {
    log.debug('malformed request', { err });
    socket.destroy();
  });

  /** One line per request: info for pages, debug for assets and background calls, warn when slow. */
  function access(req, res) {
    const n = res.nbd;
    const dur = performance.now() - n.start;
    const pathOnly = (req.url ?? '').split('?')[0];
    const fields = {
      status: res.statusCode,
      ms: dur.toFixed(1),
      bytes: n.bytes || undefined,
      render: n.cache ? `${n.cache}${n.renderMs != null ? ` ${n.renderMs.toFixed(1)}ms` : ''}` : undefined,
      rid: n.rid,
    };
    const line = `${req.method} ${req.url}`;
    if (res.statusCode >= 500) log.error(line, fields);
    else if (dur >= slowMs && pathOnly !== '/events') log.warn(`slow request: ${line}`, fields);
    else if (QUIET_RE.test(pathOnly)) log.debug(line, fields);
    else log.info(line, fields);
  }

  function listen() {
    const { host, port } = config.server;
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        const addr = server.address();
        resolve(`http://${addr.address.includes(':') ? `[${addr.address}]` : addr.address}:${addr.port}`);
      });
    });
  }

  async function close() {
    await api.stopAll();
    clearInterval(heartbeat);
    unsubscribeLog();
    log.info('viewer stopping', { streams: clients.size });
    for (const c of clients) c.end();
    server.closeIdleConnections?.();
    return new Promise((r) => server.close(r));
  }

  return { server, listen, close, changed, broadcast, reset, jobs, clientCount: () => clients.size };
}

// ---------------------------------------------------------------------------------------------

function crumbsFor(clean) {
  const crumbs = [{ href: '/v/', label: 'vault' }];
  const parts = clean ? clean.split('/') : [];
  parts.forEach((part, i) => crumbs.push({ href: `/v/${parts.slice(0, i + 1).join('/')}${i < parts.length - 1 ? '/' : ''}`, label: part }));
  return crumbs;
}

function hostAllowed(req, config) {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  const allowed = new Set(['localhost', '127.0.0.1', '::1', config.server.host, ...(config.server.allowedHosts ?? [])]);
  return allowed.has(host);
}

function serveFile(res, root, rel, cacheControl) {
  const abs = safeJoin(root, rel);
  if (!abs) return send(res, 403, 'Forbidden');
  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    if (res.nbd) res.nbd.bytes = st.size;
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': st.size,
      ...serverTiming(res),
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(abs).pipe(res);
  });
}

function send(res, status, body, type = 'text/plain; charset=utf-8', headers = {}) {
  if (res.nbd) res.nbd.bytes = Buffer.byteLength(body ?? '');
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...serverTiming(res), ...headers });
  res.end(body);
}

/** Server-Timing shows up in the browser's network panel next to each request. */
function serverTiming(res) {
  const n = res.nbd;
  if (!n) return {};
  const parts = [`app;dur=${(performance.now() - n.start).toFixed(1)}`];
  if (n.cache) parts.push(`render;dur=${(n.renderMs ?? 0).toFixed(1)};desc="cache ${n.cache}"`);
  return { 'Server-Timing': parts.join(', '), 'X-Request-Id': String(n.rid) };
}

function json(res, status, value) {
  send(res, status, JSON.stringify(value), 'application/json');
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Requests that are noise at info level: assets, live-reload, hover previews, search-as-you-type.
const QUIET_RE = /^\/(assets|vendor|file)\/|^\/events$|^\/api\/(preview|search|status|client-log)$/;
// Browsers open at most 6 HTTP/1.1 connections per host; every live-reload stream holds one.
const SSE_WARN_AT = 4;

// The layout has one inline script (theme bootstrap, to avoid a flash); CSP allows it by hash.
function inlineScriptHash() {
  const src = String(V.layout({ title: '', main: '' })).match(/<script>([\s\S]*?)<\/script>/)[1];
  return crypto.createHash('sha256').update(src).digest('base64');
}
