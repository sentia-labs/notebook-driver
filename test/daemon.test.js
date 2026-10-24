import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempHome, PAGE1 } from './helpers.js';
import { runDaemon } from '../src/daemon.js';
import { recordAnswer } from '../src/questions.js';
import { createLogger, logFile } from '../src/log.js';

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

test('daemon: watches pages, ingests once they settle, notifies, applies answers', { timeout: 60000 }, async (t) => {
  const notifyLog = path.join(fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? '/tmp'), 'nbd-notify-')), 'log');
  const h = tempHome({}, {
    ingest: { idleSeconds: 1, batchSeconds: 0, answerDelaySeconds: 0 },
    harness: { kind: 'custom', command: [process.execPath, FAKE, '{prompt}'], timeoutMinutes: 1 },
    notify: {
      command: [process.execPath, '-e', 'require("fs").appendFileSync(process.argv[1], process.argv[2] + " | " + process.argv[3] + "\\n")', notifyLog, '{title}', '{body}'],
    },
    server: { port: 0 },
  });
  t.after(h.cleanup);
  h.ctx.logger = createLogger({ level: 'info', file: logFile(h.paths), stream: null });
  const d = await runDaemon(h.ctx, { serve: true, agent: true, tickMs: 200 });
  t.after(() => d.stop());
  const notes = () => (fs.existsSync(notifyLog) ? fs.readFileSync(notifyLog, 'utf8') : '');

  // A new page is ingested once it has been left alone for idleSeconds.
  h.write('notebook/p0001.md', PAGE1);
  await until(() => h.exists('vault/resources/p0001-digest.md'));
  const status = await until(() => {
    try {
      const s = JSON.parse(h.read('.nbd/status.json'));
      return s.currentPage?.id === 'p0001' && s.questions.open === 1 && s;
    } catch {
      return false;
    }
  });
  assert.equal(status.ingest.pending.length, 0);
  assert.match(await until(() => notes().includes('question') && notes()), /1 question from your notebook \| q0001: Who is J\.\?/);

  // The viewer is up and sees the agent's note.
  const html = await (await fetch(`${d.url}/n/p0001`)).text();
  assert.match(html, /Digest of p0001/);

  // Filling a page and overflowing it each nudge once.
  const lines = (n) => Array.from({ length: n }, (_, i) => `- line ${i + 1}`).join('\n') + '\n';
  h.write('notebook/p0002.md', lines(27));
  await new Promise((r) => setTimeout(r, 400));
  h.write('notebook/p0002.md', lines(28));
  await until(() => notes().includes('Page 2 is full'));
  h.write('notebook/p0002.md', lines(30));
  await until(() => notes().includes('Page 2 overflows'));
  assert.match(notes(), /30\/28 lines\. Move 2 lines to the next page/);

  // Answering a question wakes the agent, which applies and resolves it.
  recordAnswer(h.paths, 'q0001', 'Jane from finance');
  await until(() => /status: resolved/.test(h.read('vault/inbox/q0001.md')));
  const runs = fs.readdirSync(path.join(h.paths.state, 'runs'));
  assert.ok(runs.length >= 2);

  // Everything above left a trail in the log.
  const log = fs.readFileSync(logFile(h.paths), 'utf8');
  for (const re of [
    /INFO  daemon  starting pid=\d+/,
    /INFO  watch   added rel=notebook\/p0001\.md lines=5/,
    /INFO  agent   started node \(ingest\) pid=\d+/,
    /INFO  agent   node \(ingest\) exited pid=\d+ code=0 ms=\d+/,
    /INFO  ingest  finished: Vault .* record=\S+-ingest\.json/,
    /INFO  daemon  notify: p0002 is full lines=28 max=28/,
    /INFO  viewer  GET \/n\/p0001 status=200 ms=[\d.]+ bytes=\d+ render="miss [\d.]+ms" rid=\d+/,
  ]) {
    assert.match(log, re);
  }
});
