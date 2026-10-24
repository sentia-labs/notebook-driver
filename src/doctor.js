import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { State } from './state.js';
import { pidAlive } from './util.js';
import { logFile } from './log.js';
import { editorCommand } from './editor.js';

const run = promisify(execFile);

/** `nbd doctor`: print the checks. Returns an exit code (0 = no failures). */
export async function runDoctor(ctx) {
  const checks = await doctorChecks(ctx);
  const mark = { ok: '✓', warn: '!', fail: '✗' };
  for (const c of checks) console.log(`${mark[c.status]} ${c.msg}${c.hint ? `\n    → ${c.hint}` : ''}`);
  const failures = checks.filter((c) => c.status === 'fail').length;
  console.log(failures ? `\n${failures} problem${failures > 1 ? 's' : ''} to fix.` : '\nAll set.');
  return failures ? 1 : 0;
}

/** Preflight checks for the whole loop: [{ status: ok|warn|fail, msg, hint }]. Never blocks the event loop. */
export async function doctorChecks(ctx) {
  const { paths, config } = ctx;
  const checks = [];
  const ok = (msg) => checks.push({ status: 'ok', msg });
  const warn = (msg, hint) => checks.push({ status: 'warn', msg, hint });
  const fail = (msg, hint) => checks.push({ status: 'fail', msg, hint });
  const which = async (cmd) => {
    try {
      return (await run('sh', ['-c', 'command -v "$1"', 'sh', cmd])).stdout.trim();
    } catch {
      return '';
    }
  };

  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 22) ok(`node ${process.versions.node}`);
  else fail(`node ${process.versions.node}`, 'notebook-driver needs Node 22 or newer');

  if (fs.existsSync(paths.notebook) && fs.existsSync(paths.vault)) ok(`notebook home ${paths.home}`);
  else fail(`no notebook home at ${paths.home}`, `nbd init ${paths.home}`);
  for (const f of ['AGENTS.md', 'CLAUDE.md', '.claude/settings.json']) {
    if (!fs.existsSync(path.join(paths.home, f))) warn(`${f} missing: the agent has no instructions or guard rails`, 'nbd init --refresh');
  }

  const kind = config.harness.kind;
  if (kind === 'claude' || kind === 'codex') {
    const bin = await which(kind);
    if (!bin) fail(`${kind} is not on PATH`, kind === 'claude' ? 'install Claude Code, or set harness.kind in nbd.json' : 'install Codex, or set harness.kind');
    else ok(`${kind} at ${bin}`);
    if (bin && kind === 'claude') {
      try {
        await run('claude', ['auth', 'status'], { timeout: 20000 });
        ok('claude is logged in');
      } catch {
        fail('claude is not logged in', 'run `claude` once and /login (or `claude setup-token` for a long-lived token)');
      }
      if (process.env.ANTHROPIC_API_KEY && !config.harness.stripApiKey) {
        warn('ANTHROPIC_API_KEY is set: background runs will bill the API, not your subscription', 'set "harness": {"stripApiKey": true} in nbd.json to use your login instead');
      }
    }
  } else if (kind === 'custom') {
    if (Array.isArray(config.harness.command) && (await which(config.harness.command[0]))) ok(`custom harness ${config.harness.command[0]}`);
    else fail('custom harness command not found', 'check harness.command in nbd.json');
  }
  if (config.harness.model) ok(`background model: ${config.harness.model}`);

  if (config.notify.enabled) {
    if (config.notify.command) ok(`notifications via ${config.notify.command[0]}`);
    else if (await which('notify-send')) ok('notifications via notify-send');
    else warn('notify-send not found: no desktop notifications', 'install libnotify, or set notify.command');
  }

  const editor = await editorCommand(config);
  if (editor) ok(`"Open in editor" runs: ${editor.join(' ')}`);
  else warn('the viewer can\'t open pages in your editor', 'set "editor": {"command": ["alacritty", "-e", "nvim", "+{line}", "{file}"]} in nbd.json (any terminal works)');

  const status = new State(paths.state).readStatus();
  if (status?.pid && pidAlive(status.pid)) ok(`daemon running (pid ${status.pid})${status.url ? ` · viewer ${status.url}` : ''}`);
  else warn('daemon not running', 'nbd service install (or run `nbd daemon` in a terminal)');

  const file = logFile(paths);
  if (fs.existsSync(file)) {
    const { errors, warnings } = recentProblems(file);
    if (errors || warnings) warn(`log: ${errors} error(s), ${warnings} warning(s) in the last 24h (${file})`, 'nbd logs --level warn');
    else ok(`log ${file} (no problems in the last 24h)`);
  } else ok(`log will be written to ${file}`);

  const unit = path.join(process.env.HOME ?? '', '.config/systemd/user/notebook-driver.service');
  if (fs.existsSync(unit)) ok(`systemd unit ${unit}`);
  return checks;
}

/** Count ERROR and WARN entries from the last day, reading only the end of the log. */
function recentProblems(file, sinceMs = 24 * 3600_000) {
  let text = '';
  try {
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - 512 * 1024);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    text = buf.toString('utf8');
  } catch {}
  const since = Date.now() - sinceMs;
  let errors = 0;
  let warnings = 0;
  for (const m of text.matchAll(/^(\S+) (ERROR|WARN) /gm)) {
    if (Date.parse(m[1]) < since) continue;
    if (m[2] === 'ERROR') errors++;
    else warnings++;
  }
  return { errors, warnings };
}
