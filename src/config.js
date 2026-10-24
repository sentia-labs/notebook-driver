import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { deepMerge, readJson } from './util.js';

export const CONFIG_FILE = 'nbd.json';

export const DEFAULTS = {
  // Shown in the viewer's title bar and on notifications (tells two notebooks apart).
  name: 'Notebook',
  page: {
    // A page is full at maxLines. The limit is a feature: it forces brevity, like paper.
    maxLines: 28,
    // nvim shows a "nearly full" hint from this line on.
    warnAt: 25,
  },
  ingest: {
    // auto: the daemon runs the agent when pages settle; manual: only `nbd sync`.
    mode: 'auto',
    // Run once a changed page has been left alone this long (seconds).
    idleSeconds: 300,
    // Don't wait for idleSeconds when the page just became full or a newer page was started.
    eagerWhenTurned: true,
    // Pages that changed at least this long ago join a run another page triggered (batching).
    batchSeconds: 30,
    maxPagesPerRun: 12,
    // Apply answers to clarification questions this long after they are recorded.
    answerDelaySeconds: 60,
    // After a run, hand lint problems in the notes it wrote (bad YAML, misquoted citations,
    // broken links) back to the agent for one repair pass.
    repair: true,
  },
  harness: {
    // claude | codex | custom
    kind: 'claude',
    // Model alias for background ingest runs (null = harness default).
    model: 'sonnet',
    // Model for interactive rituals and chat (null = harness default).
    interactiveModel: null,
    // Extra CLI args appended to every headless/interactive invocation.
    extraArgs: [],
    // custom only: argv templates. Placeholders: {prompt} {home} {vault} {notebook}
    command: null,
    interactiveCommand: null,
    timeoutMinutes: 20,
    // claude only: --max-budget-usd for headless runs (API-key billing).
    maxBudgetUsd: null,
    // claude -p always bills ANTHROPIC_API_KEY when it is set; true removes it from background
    // runs so they use your Claude subscription login instead.
    stripApiKey: false,
  },
  rituals: {
    // A review becomes available `leadDays` before the period ends, at `time` (local).
    weekly: { enabled: true, leadDays: 0, time: '16:00' },
    monthly: { enabled: true, leadDays: 0, time: '16:00' },
    quarterly: { enabled: true, leadDays: 2, time: '10:00' },
    yearly: { enabled: true, leadDays: 5, time: '10:00' },
    // Re-notify about a still-due ritual after this many hours.
    remindEveryHours: 24,
  },
  notify: {
    enabled: true,
    // argv template; placeholders {title} {body} {url}. null = notify-send.
    command: null,
    onIngest: false,
    onQuestions: true,
    onPageFull: true,
    onRituals: true,
    onErrors: true,
  },
  server: {
    host: '127.0.0.1',
    port: 4242,
    // Viewer requests slower than this are logged as warnings.
    slowRequestMs: 500,
  },
  editor: {
    // argv the viewer's "Open in editor" runs; placeholders {file} {line}.
    // null: nvim in your default terminal via xdg-terminal-exec, when installed.
    command: null,
  },
  log: {
    // error | warn | info | debug (NBD_LOG_LEVEL overrides; `--verbose` means debug).
    level: 'info',
    // text | json (NBD_LOG_FORMAT overrides).
    format: 'text',
    // Also write .nbd/logs/nbd.log (false: stderr/journald only).
    file: true,
    maxSizeMB: 5,
    // Rotated files kept next to it (nbd.log.1 … nbd.log.N).
    keep: 3,
  },
};

/** Where the notebook home lives: --home, $NBD_HOME, an ancestor of cwd holding nbd.json, or ~/notebook. */
export function resolveHome({ home, cwd = process.cwd(), env = process.env } = {}) {
  if (home) return path.resolve(expandTilde(home));
  if (env.NBD_HOME) return path.resolve(expandTilde(env.NBD_HOME));
  let dir = path.resolve(cwd);
  while (true) {
    if (fs.existsSync(path.join(dir, CONFIG_FILE))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(os.homedir(), 'notebook');
}

export function expandTilde(p) {
  return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
}

export function homePaths(home) {
  return {
    home,
    notebook: path.join(home, 'notebook'),
    vault: path.join(home, 'vault'),
    inbox: path.join(home, 'vault', 'inbox'),
    state: path.join(home, '.nbd'),
    config: path.join(home, CONFIG_FILE),
  };
}

export function loadConfig(home) {
  const user = readJson(path.join(home, CONFIG_FILE), {});
  return deepMerge(DEFAULTS, user);
}

/** Everything a command needs: resolved home, its paths and merged config. */
export function openHome(opts = {}) {
  const home = resolveHome(opts);
  return { home, paths: homePaths(home), config: loadConfig(home) };
}
