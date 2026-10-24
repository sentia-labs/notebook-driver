import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED, resetDemo, isSeed } from '../src/demo.js';
import { openHome } from '../src/config.js';
import { State } from '../src/state.js';
import { pendingPages, skipPages } from '../src/ingest.js';
import { Library } from '../src/library.js';
import { lintVault } from '../src/lint.js';
import { runDaemon } from '../src/daemon.js';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/fake-agent.mjs');
// The demo home of these tests, so the viewer's commands say --demo instead of --home.
let currentDemo = null;
const tmp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbd-demo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  currentDemo = path.join(dir, 'demo');
  process.env.NBD_DEMO_HOME = currentDemo;
  return currentDemo;
};
const pending = (home) => pendingPages(openHome({ home }).paths, new State(path.join(home, '.nbd'))).map((p) => p.id);
const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timed out');
};

test('the demo is a normal notebook home made from the seed', (t) => {
  const home = tmp(t);
  const r = resetDemo({ home });
  assert.equal(r.pages, fs.readdirSync(path.join(SEED, 'notebook')).length);
  for (const f of ['AGENTS.md', 'CLAUDE.md', 'KEY.md', '.claude/settings.json', '.claude/skills/nbd-weekly-review/SKILL.md']) {
    assert.ok(fs.existsSync(path.join(home, f)), `${f} from nbd init`);
  }
  const ctx = openHome({ home });
  assert.equal(ctx.config.demo.seed, SEED);
  assert.equal(ctx.config.demo.isSeed, undefined, 'the copy is not a seed');
  assert.equal(ctx.config.server.port, 4243);
  assert.deepEqual(pending(home), [], 'the seeded vault was built from these pages');
  const lib = new Library(ctx.paths, ctx.config).scan();
  assert.ok(lib.notes().length >= 10);
  assert.deepEqual(lintVault(lib).filter((i) => i.level === 'error'), [], 'the seed vault is lint-clean');
  assert.ok(isSeed(SEED) && !isSeed(home));
  assert.deepEqual(fs.readdirSync(path.join(SEED, 'notebook')).sort(), fs.readdirSync(ctx.paths.notebook).sort(), 'seed untouched');
});

test('fresh reset: pages only, all pending; reset never touches non-demo folders or the seed', (t) => {
  const home = tmp(t);
  resetDemo({ home });
  fs.appendFileSync(path.join(home, 'notebook/p0006.md'), '- [ ] something new\n');
  fs.writeFileSync(path.join(home, 'vault/resources/scratch.md'), '# mine\n');
  resetDemo({ home, fresh: true });
  assert.equal(pending(home).length, fs.readdirSync(path.join(SEED, 'notebook')).length);
  assert.ok(!fs.existsSync(path.join(home, 'vault/resources/scratch.md')));
  assert.ok(!fs.readFileSync(path.join(home, 'notebook/p0006.md'), 'utf8').includes('something new'));
  assert.ok(fs.existsSync(path.join(home, 'vault/log.md')), 'nbd init starts the log');

  const real = path.join(path.dirname(home), 'real');
  fs.mkdirSync(path.join(real, 'notebook'), { recursive: true });
  fs.writeFileSync(path.join(real, 'nbd.json'), '{}');
  fs.writeFileSync(path.join(real, 'notebook/p0001.md'), '# precious\n');
  assert.throws(() => resetDemo({ home: real }), /not a demo notebook/);
  assert.equal(fs.readFileSync(path.join(real, 'notebook/p0001.md'), 'utf8'), '# precious\n');
  assert.throws(() => resetDemo({ home: SEED }), /cannot be the seed/);
});

test('skip marks pages as read without the agent; editing again makes them pending', (t) => {
  const home = tmp(t);
  resetDemo({ home, fresh: true });
  const ctx = openHome({ home });
  assert.deepEqual(skipPages(ctx, new State(ctx.paths.state), ['p0002']), ['p0002']);
  assert.ok(!pending(home).includes('p0002'));
  fs.appendFileSync(path.join(home, 'notebook/p0002.md'), '- typo fixed\n');
  assert.ok(pending(home).includes('p0002'));
});

test('a running demo resets in place, from the viewer or the CLI request file', { timeout: 30000 }, async (t) => {
  const home = tmp(t);
  resetDemo({ home });
  await assert.rejects(runDaemon(openHome({ home: SEED }), { serve: false, agent: false }), /is the demo seed/);
  const ctx = openHome({ home });
  ctx.config.server.port = 0;
  ctx.config.notify.enabled = false;
  ctx.config.harness = { ...ctx.config.harness, kind: 'custom', command: [process.execPath, FAKE, '{prompt}'] };
  const d = await runDaemon(ctx, { serve: true, agent: true, tickMs: 200 });
  t.after(() => d.stop());
  const post = async (p, body = {}) => {
    const res = await fetch(d.url + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NBD': '1' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };

  const activity = await (await fetch(`${d.url}/activity`)).text();
  assert.match(activity, /data-op="\/api\/demo\/reset"[^>]*title="[^"]*nbd demo --reset"/, 'the reset button names its command');
  assert.match(activity, /title="[^"]*nbd sync --demo"/, 'other commands target the demo with --demo');
  assert.match(await (await fetch(d.url)).text(), /<span>Demo notebook<\/span>[\s\S]*demo-chip/);

  // Change things, then reset from the viewer.
  fs.writeFileSync(path.join(home, 'notebook/p0007.md'), '# 2026-10-24 Sat\n- [ ] new page\n');
  await until(() => d.library.get('notebook/p0007.md'));
  const r = await post('/api/demo/reset', { fresh: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.cli, 'nbd demo --reset --fresh');
  assert.equal(d.library.get('notebook/p0007.md'), null, 'the daemon re-read the reset notebook');
  assert.equal(d.library.notes().length, 2, 'fresh: only log.md and index.md');

  // The CLI asks the running daemon through a request file.
  fs.writeFileSync(path.join(home, '.nbd/reset-request'), '{"fresh": false}');
  const res = JSON.parse(await until(() => fs.existsSync(path.join(home, '.nbd/reset-result')) && fs.readFileSync(path.join(home, '.nbd/reset-result'), 'utf8')));
  assert.equal(res.status, 'ok');
  assert.ok(d.library.notes().length >= 10);
  assert.deepEqual((await post('/api/sync/skip')).body.skipped, [], 'nothing pending after a seeded reset');

  // Still fully functional afterwards: the agent ingests a new page.
  fs.writeFileSync(path.join(home, 'notebook/p0007.md'), '# 2026-10-24 Sat\n- [ ] after the reset\n');
  await until(() => d.library.get('notebook/p0007.md'));
  assert.equal((await post('/api/sync')).status, 200);
  await until(() => fs.existsSync(path.join(home, 'vault/resources/p0007-digest.md')));
});
