import os from 'node:os';
import path from 'node:path';
import { resolveHome } from './config.js';
import { demoHome } from './demo.js';

// Every action in the viewer names the CLI command that does the same thing, so the terminal is
// always an option and the UI teaches it. These build those command lines.

const SAFE_RE = /^[A-Za-z0-9_\-+=.,/:@%^]+$/;

/** Quote one argument for a POSIX shell (bash, zsh). */
export function shellQuote(arg) {
  const s = String(arg);
  if (s === '') return "''";
  if (SAFE_RE.test(s)) return s;
  if (s.startsWith('~/') && SAFE_RE.test(s.slice(2))) return s; // keep tilde expansion
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

/** `nbd <args>`, adding --home when `nbd` alone would find a different notebook. */
export function nbdCommand(ctx, args) {
  const parts = ['nbd', ...args.filter((a) => a !== null && a !== undefined && a !== false)];
  if (isDemoHome(ctx)) parts.push('--demo');
  else {
    const home = homeFlag(ctx);
    if (home) parts.push('--home', home);
  }
  return parts.map(shellQuote).join(' ');
}

/** A command that must run inside the notebook home (e.g. resuming a Claude session). */
export function inHome(ctx, args) {
  return `cd ${shellQuote(tildify(ctx.paths.home))} && ${args.map(shellQuote).join(' ')}`;
}

function isDemoHome(ctx) {
  return path.resolve(demoHome()) === path.resolve(ctx.paths.home);
}

function homeFlag(ctx) {
  let def;
  try {
    def = resolveHome({ cwd: '/', env: process.env });
  } catch {
    def = null;
  }
  return def && path.resolve(def) === path.resolve(ctx.paths.home) ? null : tildify(ctx.paths.home);
}

export function tildify(p) {
  const home = os.homedir();
  return p === home ? '~' : p.startsWith(`${home}/`) ? `~/${p.slice(home.length + 1)}` : p;
}

/** Placeholder the browser swaps for what you type (e.g. an answer), shell-quoted. */
export const TEXT_SLOT = '@@TEXT@@';

/** The command line behind each action in the viewer. */
export function commandsFor(ctx) {
  const nbd = (...args) => nbdCommand(ctx, args);
  return {
    sync: (pages = []) => nbd('sync', ...pages.flatMap((p) => ['--page', p])),
    syncPreview: () => nbd('sync', '--dry-run'),
    skip: (pages = []) => nbd('sync', '--skip', ...pages.flatMap((p) => ['--page', p])),
    demoReset: (fresh = false) =>
      ['nbd', 'demo', '--reset', ...(fresh ? ['--fresh'] : []), ...(isDemoHome(ctx) ? [] : ['--home', tildify(ctx.paths.home)])].map(shellQuote).join(' '),
    demo: () => 'nbd demo',
    newPage: (topic = null) => nbd('new', ...(topic ? ['--topic', topic] : [])),
    edit: (id) => nbd('edit', id),
    answer: (id, text = TEXT_SLOT) => nbd('answer', id, text),
    dismiss: (id) => nbd('dismiss', id),
    questions: () => nbd('questions'),
    ask: (q = TEXT_SLOT) => nbd('ask', q),
    askResume: (session, text = TEXT_SLOT) => nbd('ask', '--resume', session, text),
    resume: (session) => inHome(ctx, ['claude', '--resume', session]),
    rituals: () => nbd('rituals'),
    ritual: (kind, period) => nbd('ritual', kind, '--period', period),
    ritualContext: (kind, period) => nbd('ritual', kind, '--period', period, '--context-only'),
    lint: () => nbd('lint'),
    lintFix: () => nbd('lint', '--agent'),
    index: () => nbd('index'),
    tasks: () => nbd('tasks'),
    status: () => nbd('status'),
    doctor: () => nbd('doctor'),
    logs: (level = null) => nbd('logs', '-f', ...(level ? ['--level', level] : [])),
    daemon: () => nbd('daemon'),
  };
}
