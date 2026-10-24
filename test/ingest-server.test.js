import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempHome, PAGE1, PAGE2 } from './helpers.js';
import { State } from '../src/state.js';
import { pendingPages, runIngest, buildIngestPrompt } from '../src/ingest.js';
import { headlessInvocation } from '../src/harness.js';
import { Library } from '../src/library.js';
import { MarkdownRenderer } from '../src/render/markdown.js';
import { createViewer } from '../src/server/server.js';
import { recordAnswer } from '../src/questions.js';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/fake-agent.mjs');
const fakeHarness = { harness: { kind: 'custom', command: [process.execPath, FAKE, '{prompt}'], timeoutMinutes: 1 } };

test('ingest runs the agent on changed pages, snapshots what it saw, and re-ingests only edits', async (t) => {
  const h = tempHome({ 'notebook/p0001.md': PAGE1, 'notebook/p0002.md': PAGE2, 'notebook/p0003.md': '' }, fakeHarness);
  t.after(h.cleanup);
  const state = new State(h.paths.state);

  const pending = pendingPages(h.paths, state);
  assert.deepEqual(pending.map((p) => `${p.id}:${p.status}`), ['p0001:new', 'p0002:new'], 'a blank turned page waits');
  assert.equal(pending[1].startDate, '2026-10-21', 'p0002 starts in the day p0001 ended on');

  const r = await runIngest(h.ctx, state, { reason: 'test' });
  assert.equal(r.status, 'ok', r.error);
  assert.deepEqual(r.changes.created.sort(), ['inbox/q0001.md', 'index.md', 'log.md', 'resources/p0001-digest.md', 'resources/p0002-digest.md']);
  assert.deepEqual(r.newQuestions.map((q) => q.id), ['q0001']);
  assert.equal(r.notebookChanged, undefined);
  assert.match(h.read('vault/index.md'), /\[\[p0002-digest\|Digest of p0002\]\]/, 'index regenerated after the run');
  assert.equal(pendingPages(h.paths, state.reload()).length, 0);
  assert.equal(h.read('.nbd/snapshots/p0002.md'), PAGE2);

  // Edit a page: only that page is pending, and the prompt carries a diff against the snapshot.
  h.write('notebook/p0002.md', PAGE2.replace('wire the viewer', 'wire the viewer and nvim'));
  const again = pendingPages(h.paths, state.reload());
  assert.deepEqual(again.map((p) => `${p.id}:${p.status}`), ['p0002:modified']);
  const dry = await runIngest(h.ctx, state, { dryRun: true });
  assert.match(dry.prompt, /### p0002 · modified · 8\/28 lines/);
  assert.match(dry.prompt, /-- \[\/\] wire the viewer\n\+- \[\/\] wire the viewer and nvim/);
  assert.match(dry.prompt, /^4 \| - \[\/\] wire the viewer and nvim$/m);
  assert.match(dry.prompt, /Questions still waiting on the human \(don't ask them again\): q0001/);
  assert.match(dry.prompt, /Next free question id: q0002/);

  // Answered questions are handed to the agent, which resolves them.
  recordAnswer(h.paths, 'q0001', 'Jane from finance');
  const r2 = await runIngest(h.ctx, state, { reason: 'test 2' });
  assert.equal(r2.status, 'ok');
  assert.deepEqual(r2.answered, ['q0001']);
  assert.match(h.read('vault/inbox/q0001.md'), /status: resolved/);
});

test('lint problems in fresh notes get one repair pass', async (t) => {
  const h = tempHome({ 'notebook/p0001.md': PAGE1 }, fakeHarness);
  t.after(h.cleanup);
  process.env.FAKE_AGENT_BAD_YAML = '1';
  t.after(() => delete process.env.FAKE_AGENT_BAD_YAML);
  const r = await runIngest(h.ctx, new State(h.paths.state), { reason: 'test' });
  assert.equal(r.status, 'ok');
  assert.deepEqual({ issues: r.repair.issues, remaining: r.repair.remaining, status: r.repair.status }, { issues: 1, remaining: 0, status: 'ok' });
  assert.match(h.read('vault/resources/sloppy.md'), /description: "Runs: easy ones"/);
  assert.match(r.summaryLine, /repaired 1\/1 lint issues/);
});

test('a failed run leaves pages pending and counts failures', async (t) => {
  const h = tempHome({ 'notebook/p0001.md': PAGE1 }, fakeHarness);
  t.after(h.cleanup);
  process.env.FAKE_AGENT_FAIL = '1';
  t.after(() => delete process.env.FAKE_AGENT_FAIL);
  const state = new State(h.paths.state);
  const r = await runIngest(h.ctx, state, { reason: 'test' });
  assert.equal(r.status, 'failed');
  assert.match(r.error, /model overloaded/);
  assert.equal(pendingPages(h.paths, state.reload()).length, 1);
  assert.equal(state.data.ingest.failures, 1);
});

test('notebook edits made during a run are reported and stay pending', async (t) => {
  const h = tempHome({ 'notebook/p0001.md': PAGE1 }, fakeHarness);
  t.after(h.cleanup);
  process.env.FAKE_AGENT_TOUCH_NOTEBOOK = '1';
  t.after(() => delete process.env.FAKE_AGENT_TOUCH_NOTEBOOK);
  const state = new State(h.paths.state);
  const r = await runIngest(h.ctx, state, { reason: 'test' });
  assert.deepEqual(r.notebookChanged, ['p0001']);
  assert.deepEqual(pendingPages(h.paths, state.reload()).map((p) => p.status), ['modified']);
});

test('claude invocation: read anywhere, write only vault/, never notebook/, no shell or web', () => {
  const h = tempHome({}, { harness: { kind: 'claude', model: 'sonnet' } });
  try {
    const inv = headlessInvocation(h.ctx, { prompt: 'hi', purpose: 'ingest', name: 'x' });
    const arg = (flag) => inv.args[inv.args.indexOf(flag) + 1];
    assert.equal(inv.cmd, 'claude');
    assert.equal(inv.cwd, h.home);
    assert.equal(arg('--permission-mode'), 'dontAsk');
    assert.equal(arg('--tools'), 'Read,Glob,Grep,Edit,Write');
    assert.equal(arg('--permission-prompts'), 'none');
    assert.ok(arg('--allowedTools').split(',').includes(`Edit(/${h.paths.vault}/**)`), 'absolute //path rule');
    assert.ok(arg('--disallowedTools').split(',').includes(`Edit(/${h.paths.notebook}/**)`));
    assert.match(arg('--disallowedTools'), /Bash.*mcp__\*/);
    assert.ok(inv.args.includes('--strict-mcp-config'), 'no MCP servers or claude.ai connectors');
    assert.equal(inv.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
    assert.equal(arg('--output-format'), 'stream-json', 'steps stream to the viewer');
    assert.ok(inv.args.includes('--verbose'), 'stream-json needs --verbose in print mode');
    const turn = headlessInvocation(h.ctx, { prompt: 'and?', purpose: 'ask', resume: 'abc', system: 'chat rules' });
    assert.equal(turn.args[turn.args.indexOf('--resume') + 1], 'abc');
    assert.equal(turn.args[turn.args.indexOf('--append-system-prompt') + 1], 'chat rules');
    const ask = headlessInvocation(h.ctx, { prompt: 'q', purpose: 'ask' });
    assert.equal(ask.args[ask.args.indexOf('--tools') + 1], 'Read,Glob,Grep');
  } finally {
    h.cleanup();
  }
});

test('the prompt numbers lines and fences page text safely', () => {
  const h = tempHome();
  try {
    const page = { id: 'p0001', num: 1, status: 'new', lines: 3, text: '# x\n```js\ncode\n```\n', startDate: null };
    const p = buildIngestPrompt(h.ctx, { pages: [page], answered: [], open: [], nextId: 'q0001', vaultCount: 0 });
    assert.match(p, /````text\n1 \| # x\n2 \| ```js\n3 \| code\n4 \| ```\n````/);
  } finally {
    h.cleanup();
  }
});

test('viewer serves pages, notes and APIs; refuses foreign hosts, CSRF and traversal', async (t) => {
  const h = tempHome({
    'notebook/p0001.md': PAGE1,
    'notebook/p0002.md': PAGE2,
    'vault/projects/q4-budget.md': '---\ntype: project\nsources: ["[[p0002]]"]\n---\n# Q4 budget\n\n```mermaid\ngraph LR; A-->B\n```\n',
    'vault/inbox/q0001.md': '---\ntype: question\nid: q0001\nstatus: open\n---\n# Who?\n\n## Answer\n',
    'nbd.json': '{"secret": true}',
  });
  t.after(h.cleanup);
  h.config.server.port = 0;
  const library = new Library(h.paths, h.config).scan();
  const viewer = createViewer(h.ctx, { library, renderer: await new MarkdownRenderer().init() });
  const base = await viewer.listen();
  t.after(() => viewer.close());
  const get = (p, headers = {}) => fetch(base + p, { headers });

  for (const p of ['/', '/notebook', '/n/p0002', '/n/p0002?view=source', '/v/projects/q4-budget', '/v/', '/inbox', '/tasks', '/rituals', '/search?q=budget']) {
    const res = await get(p);
    assert.equal(res.status, 200, p);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self' 'sha256-/);
  }
  const page = await (await get('/n/p0002')).text();
  assert.match(page, /In the vault[\s\S]*Q4 budget/, 'derived notes listed on the page');
  assert.match(await (await get('/v/projects/q4-budget')).text(), /<pre class="mermaid">/);
  assert.equal((await get('/n/p0099')).status, 404);
  const search = await (await get('/api/search?q=thanksgiving')).json();
  assert.equal(search[0].route, '/n/p0002');
  const preview = await (await get('/api/preview?route=/n/p0001')).json();
  assert.match(preview.html, /bujo-task bujo-done/);

  assert.equal((await get('/file/../nbd.json')).status, 404);
  assert.equal((await get('/file/vault/../nbd.json')).status, 404);
  // fetch() won't forge Host, so use a raw request for the DNS-rebinding guard.
  const status = await new Promise((resolve, reject) => {
    const u = new URL(base);
    http.get({ host: u.hostname, port: u.port, path: '/', headers: { Host: 'evil.example' } }, (res) => resolve(res.statusCode)).on('error', reject);
  });
  assert.equal(status, 403, 'DNS-rebinding guard');

  const post = (headers, body = { answer: 'Jane' }) =>
    fetch(`${base}/api/questions/q0001/answer`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await post({})).status, 403, 'needs the X-NBD header');
  assert.equal((await post({ 'X-NBD': '1', Origin: 'https://evil.example' })).status, 403, 'cross-origin refused');
  const ok = await post({ 'X-NBD': '1' });
  assert.equal(ok.status, 200);
  assert.match(fs.readFileSync(path.join(h.paths.inbox, 'q0001.md'), 'utf8'), /status: answered[\s\S]*## Answer\n\nJane/);
});
