import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempHome, PAGE1 } from './helpers.js';
import { runDaemon } from '../src/daemon.js';
import { Library } from '../src/library.js';
import { MarkdownRenderer } from '../src/render/markdown.js';
import { createViewer } from '../src/server/server.js';
import { shellQuote, nbdCommand } from '../src/command.js';
import { spawn } from 'node:child_process';
import { stopAndWait } from '../src/harness.js';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/fake-agent.mjs');

async function until(fn, ms = 15000, step = 100) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, step));
  }
  throw new Error(`timed out waiting for ${fn}`);
}

test('commands shown in the viewer are valid shell', () => {
  assert.equal(shellQuote('p0007'), 'p0007');
  assert.equal(shellQuote("Jane's from finance"), `'Jane'\\''s from finance'`);
  assert.equal(shellQuote(''), "''");
  assert.equal(shellQuote('~/notebook-demo'), '~/notebook-demo');
  const ctx = { paths: { home: '/tmp/somewhere/else' } };
  assert.equal(nbdCommand(ctx, ['answer', 'q0002', 'Marta, our CFO']), "nbd answer q0002 'Marta, our CFO' --home /tmp/somewhere/else");
});

test('viewer actions: new page, sync, ask with follow-up, reviews, palette; each names its command', { timeout: 60000 }, async (t) => {
  const h = tempHome({ 'notebook/p0001.md': PAGE1 }, {
    ingest: { mode: 'manual' },
    harness: { kind: 'custom', command: [process.execPath, FAKE, '{prompt}'], timeoutMinutes: 1 },
    notify: { enabled: false },
    server: { port: 0 },
  });
  t.after(h.cleanup);
  const d = await runDaemon(h.ctx, { serve: true, agent: true, tickMs: 200 });
  t.after(() => d.stop());
  const post = async (p, body = {}) => {
    const res = await fetch(d.url + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NBD': '1' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const get = async (p) => (await fetch(d.url + p)).json();
  const home = `--home ${h.home}`;

  for (const p of ['/ask', '/activity', '/rituals', '/rituals/weekly/2026-W43/context', '/', '/n/p0001', '/inbox', '/notebook']) {
    const res = await fetch(d.url + p);
    assert.equal(res.status, 200, p);
  }
  const activity = await (await fetch(`${d.url}/activity`)).text();
  assert.match(activity, new RegExp(`data-op="/api/sync"[^>]*title="[^"]*nbd sync ${home}"`), 'the Sync button names its command on hover');
  assert.doesNotMatch(activity, /<\/button>\s*<div class="cli">/, 'no command lines under buttons (they go in the toast)');
  assert.match(activity, /p0001<\/a><span class="chip">new<\/span>/, 'pending pages listed');

  // Sync now runs the agent as a job, visible with its command.
  const sync = await post('/api/sync');
  assert.equal(sync.status, 200);
  assert.equal(sync.body.cli, `nbd sync ${home}`);
  const job = await until(async () => (await get('/api/jobs')).jobs.find((j) => j.kind === 'ingest' && j.status !== 'running'));
  assert.equal(job.status, 'ok');
  assert.equal(job.cli, `nbd sync ${home}`);
  assert.ok(job.result.links.some((l) => l.href === '/v/resources/p0001-digest'), 'links to the notes it wrote');
  assert.ok(h.exists('vault/resources/p0001-digest.md'));

  // New page from the browser.
  const np = await post('/api/pages/new', { topic: 'Books to read' });
  assert.equal(np.body.href, '/n/p0002');
  assert.equal(np.body.cli, `nbd new --topic 'Books to read' ${home}`);
  assert.equal(h.read('notebook/p0002.md'), '# Books to read\n');

  // Ask, then follow up in the same conversation.
  const ask = await post('/api/ask', { question: "What's the design status?" });
  assert.equal(ask.body.cli, `nbd ask 'What'\\''s the design status?' ${home}`);
  const answered = await until(async () => {
    const c = await get(`/api/conversations/${ask.body.id}`);
    return !c.busy && c.turns.length === 2 && c;
  });
  assert.match(answered.turns[1].text, /From \[\[p0001\]\]/);
  const page = await (await fetch(d.url + ask.body.href)).text();
  assert.match(page, /href="\/n\/p0001"[^>]*>p\.1<\/a>: the design is drafted/, 'wikilinks in answers resolve');
  assert.equal((await post(`/api/conversations/${ask.body.id}/reply`, { text: 'And the viewer?' })).status, 200);
  const followed = await until(async () => {
    const c = await get(`/api/conversations/${ask.body.id}`);
    return !c.busy && c.turns.length === 4 && c;
  });
  assert.match(followed.turns[3].text, /Follow-up: you said "And the viewer\?"/);

  // A review runs its skill; starting it again reopens the same conversation.
  const review = await post('/api/rituals/weekly/start', { period: '2026-W43' });
  assert.equal(review.body.cli, `nbd ritual weekly --period 2026-W43 ${home}`);
  await until(async () => (await get(`/api/conversations/${review.body.id}`)).turns.length === 2);
  assert.match((await get(`/api/conversations/${review.body.id}`)).turns[1].text, /How was the week, in a word\? \(nbd-weekly-review\)/);
  assert.equal((await post('/api/rituals/weekly/start', { period: '2026-W43' })).body.id, review.body.id);
  assert.equal((await post('/api/rituals/weekly/start', { period: 'nonsense' })).status, 400);

  // Inbox answers name their command.
  const qs = fs.readdirSync(h.paths.inbox).filter((f) => f.endsWith('.md'));
  const qid = qs[0].slice(0, -3);
  const ans = await post(`/api/questions/${qid}/answer`, { answer: 'Jane, from finance' });
  assert.equal(ans.body.cli, `nbd answer ${qid} 'Jane, from finance' ${home}`);

  // The palette lists actions with commands.
  const pal = await get('/api/palette?page=p0002');
  const byLabel = Object.fromEntries(pal.items.map((i) => [i.label, i]));
  assert.equal(byLabel['New page'].cli, `nbd new ${home}`);
  assert.equal(byLabel['Ingest p.2 now'].cli, `nbd sync --page p0002 ${home}`);
  assert.equal(byLabel['Setup checks'].cli, `nbd doctor ${home}`);
  assert.ok(pal.items.every((i) => !i.disabled));

  const logs = await get('/api/logs?level=info&n=50');
  assert.ok(logs.entries.length > 0 || logs.cli.includes('nbd logs'));
});

test('under nbd serve, agent actions are refused with the command that enables them', async (t) => {
  const h = tempHome({ 'notebook/p0001.md': PAGE1 });
  t.after(h.cleanup);
  h.config.server.port = 0;
  const library = new Library(h.paths, h.config).scan();
  const viewer = createViewer(h.ctx, { library, renderer: await new MarkdownRenderer().init() });
  const base = await viewer.listen();
  t.after(() => viewer.close());
  const post = (p, body = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NBD': '1' }, body: JSON.stringify(body) });
  for (const p of ['/api/sync', '/api/ask', '/api/rituals/weekly/start', '/api/lint/fix']) {
    const res = await post(p, { question: 'x' });
    assert.equal(res.status, 409, p);
    assert.match((await res.json()).cli, /^nbd daemon/);
  }
  assert.equal((await post('/api/pages/new')).status, 200, 'non-agent actions still work');
  assert.equal((await post('/api/index')).status, 200);
  assert.equal((await fetch(base + '/api/sync', { method: 'POST', body: '{}' })).status, 403, 'still CSRF-protected');
  const pal = await (await fetch(`${base}/api/palette`)).json();
  assert.ok(pal.items.find((i) => i.label === 'Sync now').disabled);
});

test('shutdown waits for an agent that ignores SIGINT, escalating to SIGTERM', async () => {
  const child = spawn(process.execPath, ['-e', 'process.on("SIGINT", () => {}); setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  await new Promise((r) => child.once('spawn', r));
  await new Promise((r) => setTimeout(r, 150)); // let it install the handler
  const t0 = Date.now();
  await stopAndWait(child, { graceMs: 300 });
  assert.equal(child.signalCode, 'SIGTERM');
  assert.ok(Date.now() - t0 < 2000);
});
