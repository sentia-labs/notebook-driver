import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_FILE, homePaths, loadConfig } from './config.js';
import { initHome } from './init.js';
import { State } from './state.js';
import { skipPages } from './ingest.js';
import { readJson } from './util.js';

// The demo is a real notebook home, made by `nbd init` from a seed and run by the normal daemon:
// it exercises the same code as your own notebook, so it doubles as the QA surface. The seed
// (examples/demo: pages, the vault an agent built from them, settings) stays read-only in the repo;
// the working copy lives outside it and can be reset at any time.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SEED = path.join(ROOT, 'examples/demo');

/** Where the working demo lives: $NBD_DEMO_HOME, else ~/.local/share/notebook-driver/demo. */
export function demoHome(env = process.env) {
  if (env.NBD_DEMO_HOME) return path.resolve(env.NBD_DEMO_HOME);
  const data = env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share');
  return path.join(data, 'notebook-driver', 'demo');
}

/** A seed directory says so in its nbd.json; nothing may run on it directly. */
export function isSeed(home) {
  return readJson(path.join(home, CONFIG_FILE), {})?.demo?.isSeed === true;
}

/** The demo's settings: the seed's, marked as a demo that knows its seed. */
function demoConfig(seed) {
  const cfg = readJson(path.join(seed, CONFIG_FILE), {});
  return { ...cfg, demo: { seed } };
}

/**
 * Create the demo home if it doesn't exist yet. Returns { home, created }.
 */
export function ensureDemo({ home = demoHome(), seed = SEED } = {}) {
  if (fs.existsSync(path.join(home, CONFIG_FILE))) return { home, created: false };
  resetDemo({ home, seed });
  return { home, created: true };
}

/**
 * Put the demo back to the seed. fresh: pages only, so the first ingest builds the vault in front
 * of you; otherwise the seed's vault, with its pages marked as already read.
 *
 * Directories are emptied, not removed, so a running daemon's file watchers keep working. Logs
 * survive (they are the QA trail); everything else in .nbd/ goes.
 */
export function resetDemo({ home = demoHome(), seed = null, fresh = false } = {}) {
  seed ??= readJson(path.join(home, CONFIG_FILE), {})?.demo?.seed ?? SEED;
  if (!fs.existsSync(path.join(seed, 'notebook'))) throw new Error(`No demo seed at ${seed}`);
  if (path.resolve(home) === path.resolve(seed)) throw new Error('The demo home cannot be the seed itself');
  // Reset empties notebook/ and vault/: only ever do that to a demo (or to a new, empty folder).
  const existing = fs.existsSync(home) ? fs.readdirSync(home) : [];
  if (existing.length) {
    const cfg = readJson(path.join(home, CONFIG_FILE), null);
    if (!cfg?.demo?.seed) throw new Error(`${home} is not a demo notebook (no "demo" in its nbd.json); refusing to reset it`);
  }
  const paths = homePaths(home);
  fs.mkdirSync(home, { recursive: true });

  for (const dir of [paths.notebook, paths.vault]) emptyDir(dir);
  if (fs.existsSync(paths.state)) {
    for (const name of fs.readdirSync(paths.state)) {
      // Keep the log and the daemon's pid lock (a running daemon keeps running).
      if (name === 'logs' || name === 'daemon.pid' || name === 'status.json') continue;
      fs.rmSync(path.join(paths.state, name), { recursive: true, force: true });
    }
  }
  for (const f of ['AGENTS.md', 'CLAUDE.md', 'README.md', '.claude']) fs.rmSync(path.join(home, f), { recursive: true, force: true });

  const copy = (rel) => {
    const from = path.join(seed, rel);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(home, rel), { recursive: true, preserveTimestamps: true });
  };
  copy('notebook');
  if (!fresh) copy('vault');
  copy('KEY.md');
  fs.writeFileSync(paths.config, `${JSON.stringify(demoConfig(seed), null, 2)}\n`);

  // From here on it is exactly what `nbd init` gives any notebook.
  initHome(home);

  // A seeded vault was built from these pages, so they count as read; fresh leaves them pending.
  const ctx = { home, paths, config: loadConfig(home) };
  const skipped = fresh ? [] : skipPages(ctx, new State(paths.state));
  return { home, seed, fresh, pages: fs.readdirSync(paths.notebook).filter((f) => f.endsWith('.md')).length, skipped };
}

function emptyDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(dir)) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
}
