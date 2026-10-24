import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { watchTree } from '../src/watch.js';

const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));

// Editors (nvim) and agents save by writing a temp file and renaming it over the page. Node's
// recursive watcher on Linux misses every such save after the first one.
test('sees repeated saves by rename, in place writes and new subdirectories', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nbd-watch-'));
  fs.writeFileSync(path.join(root, 'p0001.md'), 'a\n');
  const seen = [];
  const w = watchTree(root, (rel) => seen.push(rel));
  try {
    const save = (n) => {
      fs.writeFileSync(path.join(root, '.p0001.md.tmp'), `${n}\n`);
      fs.renameSync(path.join(root, '.p0001.md.tmp'), path.join(root, 'p0001.md'));
    };
    for (let n = 1; n <= 3; n++) {
      seen.length = 0;
      save(n);
      await settle();
      assert.ok(seen.includes('p0001.md'), `save ${n} by rename was seen`);
    }
    seen.length = 0;
    fs.appendFileSync(path.join(root, 'p0001.md'), 'more\n');
    await settle();
    assert.ok(seen.includes('p0001.md'), 'in place write was seen');

    seen.length = 0;
    fs.mkdirSync(path.join(root, 'journal/daily'), { recursive: true });
    await settle();
    fs.writeFileSync(path.join(root, 'journal/daily/2026-10-24.md'), 'x\n');
    await settle();
    assert.ok(seen.includes('journal/daily/2026-10-24.md'), 'file in a new nested directory was seen');

    fs.rmSync(path.join(root, 'journal'), { recursive: true });
    await settle();
    w.sync();
    assert.equal(w.size, 1, 'removed directories are no longer watched');
  } finally {
    w.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
