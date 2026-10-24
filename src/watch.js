import fs from 'node:fs';
import path from 'node:path';

/**
 * Watch a directory tree; onChange(rel) gets each changed path, relative to root, '/'-separated.
 *
 * Node's recursive fs.watch on Linux watches files, not directories, so it loses a file for good
 * once an editor saves it by writing a new file and renaming it over the old one (nvim does, as do
 * most agents' write tools). Watching every directory without `recursive` sees those renames.
 * macOS and Windows watch recursively natively and don't have the problem.
 */
export function watchTree(root, onChange, { onError = () => {}, recursive = process.platform === 'darwin' || process.platform === 'win32' } = {}) {
  if (recursive) {
    const w = fs.watch(root, { recursive: true }, (_event, filename) => {
      if (filename) onChange(String(filename).split(path.sep).join('/'));
    });
    w.on('error', onError);
    return { close: () => w.close(), sync: () => {} };
  }

  const watchers = new Map(); // rel dir ('' for root) -> FSWatcher
  let closed = false;

  const unwatch = (rel) => {
    for (const [dir, w] of watchers) {
      if (dir === rel || (rel === '' ? true : dir.startsWith(`${rel}/`))) {
        w.close();
        watchers.delete(dir);
      }
    }
  };

  /** Watch rel and everything under it; report files found in directories that are new to us. */
  const add = (rel, report) => {
    if (closed || watchers.has(rel) || hidden(rel)) return;
    const abs = path.join(root, rel);
    let w;
    try {
      w = fs.watch(abs, (_event, filename) => {
        if (!filename) return;
        const child = rel ? `${rel}/${filename}` : String(filename);
        if (hidden(child)) return;
        if (isDir(path.join(root, child))) add(child, true);
        else if (watchers.has(child)) unwatch(child);
        onChange(child);
      });
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') onError(err);
      return;
    }
    w.on('error', (err) => {
      unwatch(rel);
      // A directory that was removed is not a failure; it's gone.
      if (err.code !== 'ENOENT' && err.code !== 'EPERM') onError(err);
    });
    watchers.set(rel, w);
    let entries = [];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) add(child, report);
      else if (report && !hidden(child)) onChange(child);
    }
  };

  add('', false);
  if (!watchers.has('')) throw Object.assign(new Error(`cannot watch ${root}`), { code: 'ENOENT' });

  return {
    close() {
      closed = true;
      unwatch('');
    },
    /** Pick up directories whose events were missed and drop the ones that are gone. */
    sync() {
      for (const rel of [...watchers.keys()]) if (!isDir(path.join(root, rel))) unwatch(rel);
      add('', false);
      for (const sub of dirs(root)) add(sub, true);
    },
    /** For tests: how many directories are being watched. */
    get size() {
      return watchers.size;
    },
  };
}

function hidden(rel) {
  return rel.split('/').some((part) => part.startsWith('.'));
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function* dirs(root, rel = '') {
  let entries = [];
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    yield r;
    yield* dirs(root, r);
  }
}
