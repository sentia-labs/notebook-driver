import fs from 'node:fs';
import path from 'node:path';
import { pidAlive, readJson, readText, writeFileAtomic, writeJson } from './util.js';

// Tool state lives in <home>/.nbd/ (not versioned):
//   state.json            processed hashes, notification bookkeeping, ingest status
//   snapshots/p0042.md    the page text the agent last saw (diff base for the next ingest)
//   runs/<stamp>.json     one record per agent run
//   status.json           live status for nvim / the viewer (written by the daemon)
//   ingest.lock           pid of the process currently running the agent

const EMPTY = { version: 1, pages: {}, notified: {}, ingest: {} };

export class State {
  constructor(stateDir) {
    this.dir = stateDir;
    this.file = path.join(stateDir, 'state.json');
    this.data = readJson(this.file, EMPTY);
    for (const k of Object.keys(EMPTY)) this.data[k] ??= structuredClone(EMPTY[k]);
  }

  reload() {
    this.data = readJson(this.file, EMPTY);
    for (const k of Object.keys(EMPTY)) this.data[k] ??= structuredClone(EMPTY[k]);
    return this;
  }

  save() {
    writeJson(this.file, this.data);
  }

  /** Re-read, apply `fn`, write back: other processes (nbd sync, the daemon) share this file. */
  mutate(fn) {
    this.reload();
    const out = fn(this.data);
    this.save();
    return out;
  }

  page(id) {
    return (this.data.pages[id] ??= {});
  }

  snapshotPath(id) {
    return path.join(this.dir, 'snapshots', `${id}.md`);
  }

  readSnapshot(id) {
    return readText(this.snapshotPath(id));
  }

  writeSnapshot(id, text) {
    writeFileAtomic(this.snapshotPath(id), text);
  }

  deleteSnapshot(id) {
    fs.rmSync(this.snapshotPath(id), { force: true });
  }

  /** Record that a notification keyed `key` went out (persisted); false if it already had. */
  markNotified(key, { everyHours = null } = {}) {
    return this.mutate((d) => {
      const prev = d.notified[key];
      if (prev && (everyHours == null || Date.now() - Date.parse(prev) < everyHours * 3600_000)) return false;
      d.notified[key] = new Date().toISOString();
      return true;
    });
  }

  recordRun(run) {
    const stamp = run.startedAt.replace(/[:.]/g, '-');
    const file = path.join(this.dir, 'runs', `${stamp}-${run.kind}.json`);
    writeJson(file, run);
    return file;
  }

  listRuns(limit = 20) {
    const dir = path.join(this.dir, 'runs');
    let names = [];
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
    } catch {}
    return names
      .sort()
      .reverse()
      .slice(0, limit)
      .map((n) => readJson(path.join(dir, n), null))
      .filter(Boolean);
  }

  writeStatus(status) {
    writeJson(path.join(this.dir, 'status.json'), status);
  }

  readStatus() {
    return readJson(path.join(this.dir, 'status.json'), null);
  }
}

/** A pid lock file. acquire() returns false when another live process holds it. */
export class Lock {
  constructor(file) {
    this.file = file;
  }

  holder() {
    const pid = Number(readText(this.file));
    return pid && pidAlive(pid) ? pid : null;
  }

  acquire() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    for (let i = 0; i < 2; i++) {
      try {
        fs.writeFileSync(this.file, String(process.pid), { flag: 'wx' });
        return true;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        if (this.holder()) return false;
        fs.rmSync(this.file, { force: true }); // stale lock from a dead process
      }
    }
    return false;
  }

  release() {
    if (Number(readText(this.file)) === process.pid) fs.rmSync(this.file, { force: true });
  }
}
