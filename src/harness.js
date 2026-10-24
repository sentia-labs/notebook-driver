import { spawn, spawnSync } from 'node:child_process';
import { loggerFor } from './log.js';

// Adapters for the agent harness. Claude Code is the reference harness; Codex and any other CLI
// agent can be plugged in. Whatever the harness, the contract is the same:
//   * cwd is the notebook home, so AGENTS.md / CLAUDE.md / .claude/ apply;
//   * the agent may read everything but write only under vault/;
//   * background runs are one-shot and non-interactive; rituals are interactive sessions.

const READ_TOOLS = ['Read', 'Glob', 'Grep'];

// Permission rules take `//abs/path` for absolute paths. Edit(...) rules govern Write too.
const abs = (p) => `/${p}/**`;

export function ritualCommand(kind) {
  return `nbd ritual ${kind}`;
}

/**
 * argv for a one-shot background run.
 * purpose: 'ingest' (may write vault/) | 'ask' (read-only).
 */
export function headlessInvocation(ctx, { prompt, purpose = 'ingest', name, resume = null, system = null }) {
  const { config, paths } = ctx;
  const h = config.harness;
  const writes = purpose !== 'ask';
  // Harnesses without a system-prompt flag get the extra instructions at the top of the prompt.
  if (system && h.kind !== 'claude') prompt = `${system}\n\n${prompt}`;
  switch (h.kind) {
    case 'claude': {
      const args = [
        '-p',
        prompt,
        // One JSON event per line: the viewer shows the agent's steps live; the last line is the
        // same result object `--output-format json` prints.
        '--output-format',
        'stream-json',
        '--verbose',
        // Nobody is there to answer a prompt: anything not pre-approved below is denied.
        '--permission-mode',
        'dontAsk',
        '--permission-prompts',
        'none',
        // Built-in tools available at all (Glob/Grep must be named: on Linux they're off by default).
        '--tools',
        [...READ_TOOLS, ...(writes ? ['Edit', 'Write'] : [])].join(','),
        '--allowedTools',
        [...READ_TOOLS, ...(writes ? [`Edit(${abs(paths.vault)})`] : [])].join(','),
        '--disallowedTools',
        ['Bash', 'WebFetch', 'WebSearch', 'Agent', `Edit(${abs(paths.notebook)})`, 'mcp__*'].join(','),
        // No MCP servers or claude.ai connectors (mail, calendar, drive) in background runs.
        '--strict-mcp-config',
      ];
      if (h.model) args.push('--model', h.model);
      if (name) args.push('--name', name);
      if (resume) args.push('--resume', resume);
      if (system) args.push('--append-system-prompt', system);
      if (h.maxBudgetUsd) args.push('--max-budget-usd', String(h.maxBudgetUsd));
      args.push(...h.extraArgs);
      return { purpose, cmd: 'claude', args, cwd: paths.home, parse: parseClaudeJson, env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' } };
    }
    case 'codex': {
      // Codex's sandbox confines writes to its working directory, so run it inside vault/ and
      // point it at the home's AGENTS.md explicitly.
      const args = [
        'exec',
        '--cd',
        writes ? paths.vault : paths.home,
        '--sandbox',
        writes ? 'workspace-write' : 'read-only',
        '--skip-git-repo-check',
      ];
      if (h.model) args.push('--model', h.model);
      args.push(...h.extraArgs, `${preamble(ctx)}\n\n${prompt}`);
      return { purpose, cmd: 'codex', args, cwd: writes ? paths.vault : paths.home, parse: parseText };
    }
    case 'custom': {
      if (!Array.isArray(h.command) || !h.command.length) throw new Error('harness.kind "custom" needs harness.command (argv array)');
      const [cmd, ...args] = h.command.map((a) => fill(a, ctx, `${preamble(ctx)}\n\n${prompt}`));
      return { purpose, cmd, args, cwd: paths.home, parse: parseText };
    }
    default:
      throw new Error(`Unknown harness kind: ${h.kind}`);
  }
}

/** argv for an interactive session (rituals, questions, chat). */
export function interactiveInvocation(ctx, { prompt, skill, args: skillArgs = '' }) {
  const { config, paths } = ctx;
  const h = config.harness;
  switch (h.kind) {
    case 'claude': {
      const args = [];
      if (h.interactiveModel) args.push('--model', h.interactiveModel);
      args.push(...h.extraArgs);
      const text = skill ? `/${skill}${skillArgs ? ` ${skillArgs}` : ''}` : prompt;
      if (text) args.push(text);
      return { cmd: 'claude', args, cwd: paths.home };
    }
    case 'codex': {
      const args = ['--cd', paths.vault, '--sandbox', 'workspace-write'];
      if (h.interactiveModel) args.push('--model', h.interactiveModel);
      args.push(...h.extraArgs);
      const text = skill
        ? `${preamble(ctx)}\n\nFollow the skill in ${paths.home}/.claude/skills/${skill}/SKILL.md${skillArgs ? ` with arguments: ${skillArgs}` : ''}.`
        : prompt
          ? `${preamble(ctx)}\n\n${prompt}`
          : preamble(ctx);
      args.push(text);
      return { cmd: 'codex', args, cwd: paths.vault };
    }
    case 'custom': {
      const tpl = h.interactiveCommand ?? h.command;
      if (!Array.isArray(tpl)) throw new Error('harness.kind "custom" needs harness.interactiveCommand (argv array)');
      const text = skill ? `Follow ${paths.home}/.claude/skills/${skill}/SKILL.md ${skillArgs}` : prompt ?? '';
      const [cmd, ...args] = tpl.map((a) => fill(a, ctx, `${preamble(ctx)}\n\n${text}`));
      return { cmd, args, cwd: paths.home };
    }
    default:
      throw new Error(`Unknown harness kind: ${h.kind}`);
  }
}

function preamble(ctx) {
  return (
    `You are the notebook agent for the notebook home at ${ctx.paths.home}. ` +
    `First read ${ctx.paths.home}/AGENTS.md and follow it. Never modify anything under ${ctx.paths.notebook}/.`
  );
}

function fill(arg, ctx, prompt) {
  return arg
    .replaceAll('{prompt}', prompt)
    .replaceAll('{home}', ctx.paths.home)
    .replaceAll('{vault}', ctx.paths.vault)
    .replaceAll('{notebook}', ctx.paths.notebook);
}

// Markers a Claude Code session puts in its shells. A daemon started from one would pass them on,
// and the background agent would believe it is a nested child (and inherit e.g. the effort level).
const SESSION_MARKERS = [
  'CLAUDECODE',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
];

/** Environment for background agents: independent sessions, optionally without an API key. */
function childEnv(ctx, extra = {}) {
  const env = { ...process.env, ...extra };
  for (const k of SESSION_MARKERS) delete env[k];
  // With ANTHROPIC_API_KEY set, `claude -p` always bills the API instead of your subscription.
  if (ctx.config.harness.stripApiKey) delete env.ANTHROPIC_API_KEY;
  return env;
}

/** Run a one-shot agent invocation; resolves with exit info and parsed output. Never rejects. */
export function runHeadless(ctx, inv, { timeoutMs = ctx.config.harness.timeoutMinutes * 60_000, onSpawn, onEvent } = {}) {
  const log = loggerFor(ctx, 'agent');
  const what = `${String(inv.cmd).split('/').pop()} (${inv.purpose ?? 'run'})`;
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let child;
    try {
      child = spawn(inv.cmd, inv.args, { cwd: inv.cwd, env: childEnv(ctx, inv.env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    } catch (err) {
      log.error(`could not start ${what}`, { err });
      resolve({ ok: false, error: err.message, durationMs: 0 });
      return;
    }
    log.info(`started ${what}`, { pid: child.pid, model: ctx.config.harness.kind === 'custom' ? undefined : ctx.config.harness.model, cwd: inv.cwd, timeoutMin: Math.round(timeoutMs / 60_000) });
    // The prompt is an argument; show its size, not its text.
    log.debug('argv', { args: inv.args.map((a) => (a.length > 120 ? `<${a.length} chars>` : a)).join(' ') });
    onSpawn?.(child);
    // stream-json carries whole file contents in tool results: keep only the tail in memory.
    let pending = '';
    child.stdout.on('data', (d) => {
      const chunk = String(d);
      stdout = (stdout + chunk).slice(-400_000);
      if (!onEvent) return;
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) {
        for (const ev of streamEvents(line, inv.cwd)) {
          try {
            onEvent(ev);
          } catch {}
        }
      }
    });
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => {
      timedOut = true;
      log.error(`${what} timed out; stopping it`, { pid: child.pid, timeoutMin: Math.round(timeoutMs / 60_000) });
      stopGroup(child.pid);
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      const error = err.code === 'ENOENT' ? `${inv.cmd} not found on PATH` : err.message;
      log.error(`${what} failed to run: ${error}`, { path: process.env.PATH });
      resolve({ ok: false, error, durationMs: Date.now() - started });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const parsed = inv.parse ? inv.parse(stdout) : { text: stdout.trim() };
      const ok = code === 0 && !timedOut && !parsed.isError;
      const fields = { pid: child.pid, code, signal, ms: Date.now() - started, costUsd: parsed.costUsd?.toFixed(3), turns: parsed.turns, session: parsed.sessionId };
      if (ok) log.info(`${what} exited`, fields);
      else {
        log.warn(`${what} failed`, { ...fields, error: parsed.errorText, stdoutBytes: stdout.length });
        const tail = stderr.trim().split('\n').slice(-15).join('\n');
        if (tail) log.warn(`${what} stderr (last lines):\n${tail}`);
      }
      resolve({
        ok,
        code,
        signal,
        timedOut,
        durationMs: Date.now() - started,
        stdout: stdout.slice(-20000),
        stderr: stderr.slice(-8000),
        ...parsed,
        error: ok ? undefined : timedOut ? 'timed out' : parsed.errorText || stderr.trim().split('\n').slice(-3).join(' ') || `exit ${code}`,
      });
    });
  });
}

/** Ask a process group to stop: SIGINT lets the agent end its turn cleanly, then escalate. */
export function stopGroup(pid) {
  const send = (sig) => {
    try {
      process.kill(-pid, sig);
    } catch {}
  };
  send('SIGINT');
  setTimeout(() => send('SIGTERM'), 10_000).unref();
  setTimeout(() => send('SIGKILL'), 20_000).unref();
}

/**
 * Stop a child's process group and wait for it: SIGINT, then SIGTERM after `graceMs`, then SIGKILL.
 * For shutdown, where the parent must not exit and leave the agent running.
 */
export function stopAndWait(child, { graceMs = 4000 } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const send = (sig) => {
      try {
        process.kill(-child.pid, sig);
      } catch {}
    };
    const timers = [];
    child.once('close', () => {
      timers.forEach(clearTimeout);
      resolve();
    });
    send('SIGINT');
    timers.push(setTimeout(() => send('SIGTERM'), graceMs));
    timers.push(setTimeout(() => send('SIGKILL'), graceMs * 2));
    timers.push(setTimeout(resolve, graceMs * 2 + 500));
  });
}

/** Start an interactive session attached to this terminal; returns its exit code. */
export function launchInteractive(inv) {
  const r = spawnSync(inv.cmd, inv.args, { cwd: inv.cwd, stdio: 'inherit' });
  if (r.error) throw new Error(r.error.code === 'ENOENT' ? `${inv.cmd} not found on PATH` : r.error.message);
  return r.status ?? 1;
}

/** Progress events from one stream-json line: tool steps and the agent's interim text. */
export function streamEvents(line, cwd) {
  if (!line.startsWith('{')) return [];
  let j;
  try {
    j = JSON.parse(line);
  } catch {
    return [];
  }
  if (j.type !== 'assistant' || !Array.isArray(j.message?.content)) return [];
  const out = [];
  for (const c of j.message.content) {
    if (c.type === 'tool_use') out.push({ kind: 'tool', tool: c.name, text: describeTool(c.name, c.input ?? {}, cwd) });
    else if (c.type === 'text' && c.text?.trim()) {
      // Interim narration ("Let me check the pages"); the full reply arrives as the result.
      const first = c.text.trim().split('\n')[0];
      out.push({ kind: 'text', text: first.length > 160 ? `${first.slice(0, 157)}…` : first });
    }
  }
  return out;
}

function describeTool(name, input, cwd) {
  const rel = (p) => {
    const s = String(p ?? '');
    return cwd && s.startsWith(`${cwd}/`) ? s.slice(cwd.length + 1) : s;
  };
  switch (name) {
    case 'Read':
      return `Reading ${rel(input.file_path)}`;
    case 'Edit':
    case 'MultiEdit':
      return `Editing ${rel(input.file_path)}`;
    case 'Write':
      return `Writing ${rel(input.file_path)}`;
    case 'Glob':
      return `Listing ${input.pattern ?? ''}${input.path ? ` in ${rel(input.path)}` : ''}`;
    case 'Grep':
      return `Searching for "${input.pattern ?? ''}"${input.path ? ` in ${rel(input.path)}` : ''}`;
    case 'Skill':
      return `Using skill ${input.skill ?? input.name ?? ''}`;
    case 'TodoWrite':
      return 'Updating its plan';
    default:
      return name;
  }
}

function parseClaudeJson(stdout) {
  const text = stdout.trim();
  const start = text.lastIndexOf('\n{') >= 0 ? text.lastIndexOf('\n{') + 1 : text.indexOf('{');
  try {
    const j = JSON.parse(text.slice(Math.max(0, start)));
    const failed = Boolean(j.is_error) || (j.subtype && j.subtype !== 'success');
    const detail = Array.isArray(j.errors) ? j.errors.join('; ') : String(j.result ?? '');
    return {
      text: typeof j.result === 'string' ? j.result : '',
      isError: failed,
      errorText: failed ? `${j.subtype ?? 'error'}: ${detail.slice(0, 300)}` : undefined,
      costUsd: j.total_cost_usd ?? null,
      turns: j.num_turns ?? null,
      sessionId: j.session_id ?? null,
      permissionDenials: j.permission_denials ?? [],
    };
  } catch {
    return { text, isError: false };
  }
}

function parseText(stdout) {
  return { text: stdout.trim(), isError: false };
}
