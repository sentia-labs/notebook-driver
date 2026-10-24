import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogger } from '../src/log.js';
import { showLogs } from '../src/logview.js';

const sink = () => {
  const lines = [];
  return { lines, write: (l) => lines.push(l), text: () => lines.join('') };
};
const tmp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbd-log-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('log lines carry time, level, component, message and fields', () => {
  const out = sink();
  const log = createLogger({ level: 'info', stream: out }).child('viewer');
  log.info('GET /v/x', { status: 200, ms: '3.1', note: 'two words', skip: undefined, empty: '' });
  log.debug('hidden');
  assert.equal(out.lines.length, 1);
  assert.match(out.lines[0], /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}[+-]\d\d:\d\d INFO  viewer  GET \/v\/x status=200 ms=3\.1 note="two words"\n$/);
});

test('errors keep their stack; multi-line messages stay inside their entry', () => {
  const out = sink();
  const log = createLogger({ stream: out }).child('agent');
  log.error('boom', { err: new Error('bad thing') });
  log.warn('stderr:\nline one\n2026-01-01T00:00:00.000+00:00 ERROR fake entry');
  assert.match(out.lines[0], /ERROR agent   boom err="bad thing"\n    at /);
  assert.equal(out.lines[1].split('\n').filter((l) => /^\S+ (ERROR|WARN|INFO|DEBUG) /.test(l)).length, 1, 'continuation lines are indented');
});

test('json format and stream/file levels', (t) => {
  const dir = tmp(t);
  const out = sink();
  const file = path.join(dir, 'logs/nbd.log');
  const log = createLogger({ level: 'debug', format: 'json', file, stream: out, streamLevel: 'warn' }).child('daemon');
  log.debug('quiet', { a: 1 });
  log.warn('loud', { err: new Error('x') });
  log.close();
  assert.equal(out.lines.length, 1, 'stderr gets warn and up only');
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((r) => [r.level, r.component, r.msg]), [['debug', 'daemon', 'quiet'], ['warn', 'daemon', 'loud']]);
  assert.equal(rows[1].err.message, 'x');
});

test('the log file rotates by size and keeps N old files', (t) => {
  const dir = tmp(t);
  const file = path.join(dir, 'nbd.log');
  const log = createLogger({ file, stream: null, maxBytes: 1000, keep: 2 });
  for (let i = 0; i < 100; i++) log.info(`message ${i}`, { pad: 'x'.repeat(40) });
  log.close();
  const names = fs.readdirSync(dir).sort();
  assert.deepEqual(names, ['nbd.log', 'nbd.log.1', 'nbd.log.2']);
  for (const n of names) assert.ok(fs.statSync(path.join(dir, n)).size <= 1000);
  assert.match(fs.readFileSync(file, 'utf8'), /message 99 /);
});

test('nbd logs shows the tail, filters by level and keeps stacks with their entry', async (t) => {
  const dir = tmp(t);
  const file = path.join(dir, 'nbd.log');
  const log = createLogger({ file, stream: null });
  log.info('one');
  log.error('two', { err: new Error('kaput') });
  log.info('three');
  log.warn('four');
  log.close();
  const out = sink();
  await showLogs(file, { lines: 2, out });
  assert.match(out.text(), /INFO  nbd     three\n.*WARN  nbd     four\n$/);
  const errs = sink();
  await showLogs(file, { level: 'warn', out: errs });
  assert.match(errs.text(), /ERROR nbd     two err=kaput\n    at [^\n]+\n[\s\S]*WARN  nbd     four\n$/);
  assert.doesNotMatch(errs.text(), /one|three/);
});
