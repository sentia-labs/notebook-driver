import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { openHome } from './config.js';
import { createNextPage, currentPage, listPages, pageInfo } from './pages.js';
import { Library } from './library.js';
import { State } from './state.js';
import { pendingPages, runIngest, skipPages } from './ingest.js';
import { listQuestions, recordAnswer, dismissQuestion, readQuestion } from './questions.js';
import { listRitualRuns, ritualStatus, RITUALS, saveRitualRun, terminalRun } from './rituals.js';
import { collectTasks, isOpen, taskAgeDays } from './tasks.js';
import { writeRitualContext } from './context.js';
import { headlessInvocation, interactiveInvocation, launchInteractive, runHeadless } from './harness.js';
import { initHome } from './init.js';
import { lintVault, writeLintReport } from './lint.js';
import { askPrompt } from './conversations.js';
import { commandsFor } from './command.js';
import { writeIndex } from './vaultindex.js';
import { periodRange, reviewablePeriod, weekdayShort, ymd, KINDS } from './periods.js';
import { runHook } from './hook.js';
import { installService } from './service.js';
import { createLogger, loggerOptions, logFile } from './log.js';

const HELP = `nbd — notebook driver: paper-like markdown pages + an AI-maintained second brain

Usage: nbd <command> [options]          (all commands accept --home <dir>, default $NBD_HOME or ~/notebook; --demo for the demo)

Notebook (yours)
  new [--topic T] [--blank]  Turn the page: create the next page (titled with today's date) and print its path
  current                    Print the current page's path
  edit [page]                Open the current (or given) page in $EDITOR
  pages [--json]             List pages with line usage
  tasks [--all] [--json]     Tasks read straight from the pages (open ones by default)

Second brain (the agent's)
  sync [--dry-run] [--page p0042]   Ingest changed pages now (or ask the running daemon to)
  sync --skip [--page p0042]   Mark changed pages as read without running the agent
  questions [--all] [--json] [--agent]   List clarification questions (--agent: answer them in a guided session)
  answer <qid> [text|-]      Answer a question (text, or - for stdin)
  dismiss <qid>              Dismiss a question
  ask "question" [--resume S]   Ask your second brain (read-only); --resume continues an earlier answer
  chat                       Open an interactive agent session in the notebook home
  lint [--json] [--agent]    Check the vault (links, frontmatter, citation quotes); --agent: fix it with the agent
  index                      Regenerate vault/index.md from frontmatter

Rituals
  rituals [--json]           What's due: weekly / monthly / quarterly / yearly
  rituals --runs [--json]    How long each review took (active minutes, agent vs you, done or not)
  ritual <kind> [--period P] [--context-only]   Start a guided review (P like 2026-W43, 2026-10, 2026-Q4, 2026)

Running it
  daemon [--no-agent] [--no-serve]   Watch, ingest, notify and serve the viewer (what the service runs)
  serve                      Viewer only
  status [--json]            One-screen status
  logs [-f] [-n 50] [--level warn]   Show the log (.nbd/logs/nbd.log); -f follows it
  doctor                     Check the setup: agent CLI and login, notifications, home, daemon
  init [dir] [--refresh]     Create a notebook home (or refresh its agent instructions)
  demo [--reset [--fresh]] [--path]   Run the demo notebook (made from examples/demo); reset it to the seed
  service install|restart|status|…   Manage the systemd --user service (also stop, start, uninstall, print)
  hook pre-tool-use          (internal) Claude Code hook that keeps agents out of notebook/
  hook mcp-guard <tool…>     (internal) Claude Code hook that limits MCP servers to mcp.allow

Logging: every command appends to .nbd/logs/nbd.log; the daemon also logs to stderr (journald).
  -v, --verbose              Debug-level logging, echoed to stderr for any command
  --log-level <level>        error | warn | info | debug (or NBD_LOG_LEVEL; NBD_LOG_FORMAT=json)
`;

export async function main(argv) {
  const [cmd = 'help', ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    strict: false,
    options: {
      home: { type: 'string' },
      json: { type: 'boolean' },
      all: { type: 'boolean' },
      blank: { type: 'boolean' },
      topic: { type: 'string' },
      'dry-run': { type: 'boolean' },
      skip: { type: 'boolean' },
      fresh: { type: 'boolean' },
      reset: { type: 'boolean' },
      path: { type: 'boolean' },
      demo: { type: 'boolean' },
      page: { type: 'string', multiple: true },
      period: { type: 'string' },
      'context-only': { type: 'boolean' },
      runs: { type: 'boolean' },
      agent: { type: 'boolean' },
      'no-agent': { type: 'boolean' },
      'no-serve': { type: 'boolean' },
      refresh: { type: 'boolean' },
      force: { type: 'boolean' },
      port: { type: 'string' },
      verbose: { type: 'boolean', short: 'v' },
      'log-level': { type: 'string' },
      follow: { type: 'boolean', short: 'f' },
      lines: { type: 'string', short: 'n' },
      level: { type: 'string' },
      resume: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || cmd === 'help' || cmd === '--help' || cmd === '-h') return void process.stdout.write(HELP);

  if (cmd === 'init') {
    const home = path.resolve(positionals[0] ?? values.home ?? process.env.NBD_HOME ?? path.join(process.env.HOME, 'notebook'));
    const res = initHome(home, { refresh: values.refresh, force: values.force });
    for (const f of res.written) console.log(`  wrote   ${f}`);
    for (const f of res.kept) console.log(`  kept    ${f} (yours; --force to overwrite)`);
    for (const f of res.backedUp) console.log(`  backup  ${f}`);
    console.log(`\nNotebook home ready at ${home}`);
    if (!process.env.NBD_HOME && home !== path.join(process.env.HOME, 'notebook')) {
      console.log(`Tip: export NBD_HOME=${home}  (so nbd and nvim find it)`);
    }
    return;
  }
  if (cmd === 'hook') return runHook(positionals[0], positionals.slice(1));
  if (values.demo && !values.home) values.home = (await import('./demo.js')).demoHome();
  if (cmd === 'demo') {
    // The demo is an ordinary notebook home (made from examples/demo); everything below treats it as one.
    const { demoHome, ensureDemo } = await import('./demo.js');
    values.home = values.home ?? demoHome();
    if (values.path) return void console.log(values.home);
    if (!values.reset) {
      const r = ensureDemo({ home: values.home });
      if (r.created) console.error(`Created the demo notebook at ${values.home} from examples/demo.`);
    }
  }

  const ctx = openHome({ home: values.home });
  if (values.port) ctx.config.server.port = Number(values.port);
  const { paths, config } = ctx;
  const longRunning = ['daemon', 'watch', 'serve'].includes(cmd) || (cmd === 'demo' && !values.reset);
  const level = values['log-level'] ?? (values.verbose ? 'debug' : undefined);
  // One-shot commands print their own output, so their log lines only go to the file unless asked.
  ctx.logger = fs.existsSync(paths.notebook)
    ? createLogger(loggerOptions(ctx, { ...(level ? { level } : {}), stream: longRunning || values.verbose ? process.stderr : null }))
    : undefined;
  const out = (v) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));

  switch (cmd) {
    case 'new': {
      requireHome(ctx);
      const today = new Date();
      const first = values.topic ? `# ${values.topic}` : values.blank ? '' : `# ${ymd(today)} ${weekdayShort(ymd(today))}`;
      const p = createNextPage(paths.notebook, { firstLine: first });
      return out(p.path);
    }
    case 'current': {
      const p = currentPage(paths.notebook);
      if (!p) {
        console.error('No pages yet: nbd new');
        process.exitCode = 1;
        return;
      }
      return out(p.path);
    }
    case 'edit': {
      const p = positionals[0]
        ? listPages(paths.notebook).find((x) => x.id === positionals[0] || String(x.num) === positionals[0])
        : currentPage(paths.notebook) ?? createNextPage(paths.notebook);
      if (!p) throw new Error(`No page ${positionals[0]}`);
      return launchInteractive({ cmd: process.env.EDITOR || 'nvim', args: [p.path], cwd: paths.home });
    }
    case 'pages': {
      const infos = listPages(paths.notebook).map((p) => pageInfo(p, config.page.maxLines));
      if (values.json) return out(infos.map(({ path: _p, mtime, ...rest }) => ({ ...rest, mtime: mtime.toISOString() })));
      for (const i of infos) {
        console.log(`${i.id}  ${bar(i.lines, i.maxLines)} ${String(i.lines).padStart(2)}/${i.maxLines}  ${i.topic}`);
      }
      return;
    }
    case 'tasks': {
      const lib = new Library(paths, config).scan();
      const now = new Date();
      let tasks = collectTasks(lib.parsedPages()).map((t) => ({ ...t, age: taskAgeDays(t, now) }));
      if (!values.all) tasks = tasks.filter(isOpen);
      if (values.json) return out(tasks);
      const g = { open: '•', started: '/', done: '×', migrated: '>', scheduled: '<', irrelevant: '~' };
      for (const t of tasks) {
        const s = t.signifiers.includes('priority') ? '*' : ' ';
        console.log(`${s}${g[t.state]} ${t.text}  (${t.page}:${t.line}${t.age != null ? `, ${t.age}d` : ''})`);
      }
      if (!tasks.length) console.log('No open tasks.');
      return;
    }
    case 'status': {
      const s = statusSnapshot(ctx);
      if (values.json) return out(s);
      const c = s.currentPage;
      console.log(`home      ${paths.home}`);
      console.log(`page      ${c ? `${c.id}  ${bar(c.lines, c.maxLines)} ${c.lines}/${c.maxLines}${c.full ? '  FULL' : ''}` : 'none yet (nbd new)'}`);
      console.log(`pending   ${s.pending.length ? s.pending.join(', ') : 'nothing'} (agent: ${config.harness.kind}${config.harness.model ? `/${config.harness.model}` : ''}, ${config.ingest.mode})`);
      console.log(`questions ${s.questions.open} open${s.questions.answered ? `, ${s.questions.answered} answered awaiting the agent` : ''}`);
      for (const r of s.rituals) console.log(`ritual    ${r.kind.padEnd(9)} ${r.period.padEnd(9)} ${r.due ? 'DUE' : r.done ? 'done' : '-'}`);
      console.log(`daemon    ${s.daemon ? `running (pid ${s.daemon.pid})${s.daemon.url ? ` ${s.daemon.url}` : ''}` : 'not running (nbd daemon)'}`);
      if (s.lastRun) console.log(`last run  ${s.lastRun.startedAt} ${s.lastRun.status}${s.lastRun.summaryLine ? ` — ${s.lastRun.summaryLine}` : ''}`);
      return;
    }
    case 'sync': {
      requireHome(ctx);
      const state = new State(paths.state);
      const only = values.page?.length ? values.page.flatMap((p) => p.split(',')) : null;
      if (values['dry-run']) {
        const r = await runIngest(ctx, state, { pages: only, dryRun: true, reason: 'dry run' });
        return out(r.prompt ?? `Nothing to ingest (${r.status}).`);
      }
      if (values.skip) {
        const ids = skipPages(ctx, state, only);
        return out(ids.length ? `Marked as read without the agent: ${ids.join(', ')}` : 'Nothing pending.');
      }
      const daemon = state.readStatus();
      if (daemon?.pid && isAlive(daemon.pid) && daemon.ingest?.mode !== 'off' && !only) {
        fs.writeFileSync(path.join(paths.state, 'sync-request'), new Date().toISOString());
        return out(`Asked the running daemon (pid ${daemon.pid}) to ingest now.`);
      }
      const pending = pendingPages(paths, state);
      console.log(`Ingesting ${pending.length ? pending.map((p) => p.id).join(', ') : 'answered questions'} with ${config.harness.kind}…`);
      const r = await runIngest(ctx, state, { pages: only, reason: 'nbd sync' });
      if (r.status === 'nothing') return out('Nothing to ingest: the vault is up to date.');
      if (r.status === 'busy') {
        process.exitCode = 1;
        return out(r.error);
      }
      out(`${r.status}: ${r.summaryLine ?? r.error}`);
      if (r.summary) console.log(`\n${r.summary}`);
      if (r.status !== 'ok') process.exitCode = 1;
      return;
    }
    case 'questions': {
      if (values.agent) {
        return void (process.exitCode = launchInteractive(interactiveInvocation(ctx, { skill: 'nbd-questions' })));
      }
      const qs = listQuestions(paths).filter((q) => values.all || q.status === 'open');
      if (values.json) return out(qs.map(({ body, file, ...q }) => q));
      for (const q of qs) {
        console.log(`${q.id}  [${q.status}]  ${q.title}`);
        if (q.options.length) console.log(`        options: ${q.options.join(' | ')}`);
      }
      if (!qs.length) console.log('No open questions.');
      return;
    }
    case 'answer': {
      const [id, ...words] = positionals;
      if (!id) throw new Error('Usage: nbd answer <qid> [text|-]');
      let text = words.join(' ');
      if (text === '-' || (!text && !process.stdin.isTTY)) text = fs.readFileSync(0, 'utf8');
      if (!text) {
        const q = readQuestion(paths, id);
        if (!q) throw new Error(`No such question: ${id}`);
        console.log(`${q.title}\n`);
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        text = await rl.question('> ');
        rl.close();
      }
      const q = recordAnswer(paths, id, text, { via: 'cli' });
      return out(`${q.id} answered. The agent applies it on its next run (or now: nbd sync).`);
    }
    case 'dismiss': {
      dismissQuestion(paths, positionals[0]);
      return out(`${positionals[0]} dismissed.`);
    }
    case 'rituals': {
      if (values.runs) {
        const runs = listRitualRuns(paths);
        if (values.json) return out(runs);
        if (!runs.length) return out('No timed reviews yet.');
        for (const r of runs) {
          const split = r.agentMinutes != null ? `  agent ${r.agentMinutes} · you ${r.yourMinutes}` : '';
          console.log(`${r.startedAt.slice(0, 10)}  ${r.kind.padEnd(9)} ${r.period.padEnd(9)} ${r.via.padEnd(8)} ${String(r.activeMinutes).padStart(5)} min${split}${r.done ? '' : '  (not done)'}`);
        }
        return;
      }
      const lib = new Library(paths, config).scan();
      const rs = ritualsWithActivity(ctx, lib);
      if (values.json) return out(rs);
      for (const r of rs) {
        console.log(`${r.kind.padEnd(10)} ${r.period.padEnd(9)} ${(r.due ? 'DUE' : r.done ? 'done' : r.active ? 'later' : 'quiet').padEnd(6)} ${r.label}`);
      }
      return;
    }
    case 'ritual': {
      requireHome(ctx);
      const kind = positionals[0];
      if (!RITUALS[kind]) throw new Error(`Usage: nbd ritual <${KINDS.join('|')}> [--period P]`);
      const lib = new Library(paths, config).scan();
      const period = values.period ?? reviewablePeriod(kind, new Date(), config.rituals[kind]);
      periodRange(kind, period); // validates
      const c = writeRitualContext(ctx, lib, kind, period);
      if (values['context-only']) return out(c.text);
      console.log(`${RITUALS[kind].title} · ${period} — context: ${c.rel}\n`);
      const inv = interactiveInvocation(ctx, { skill: RITUALS[kind].skill, args: `${period} ${c.rel}` });
      const started = new Date();
      process.exitCode = launchInteractive(inv);
      const run = saveRitualRun(paths, terminalRun(paths, kind, period, started, new Date()));
      console.log(`\n${RITUALS[kind].title} · ${period}: ${run.minutes} min${run.done ? '' : ' (not done)'}`);
      return;
    }
    case 'ask': {
      const q = positionals.join(' ').trim();
      if (!q) throw new Error('Usage: nbd ask "what did I decide about…?"   (follow up: nbd ask --resume <session> "…")');
      const resume = values.resume ?? null;
      const prompt = resume ? q : askPrompt(q);
      const r = await runHeadless(ctx, headlessInvocation(ctx, { prompt, purpose: 'ask', name: 'nbd ask', resume }));
      if (!r.ok) {
        process.exitCode = 1;
        return out(`Agent failed: ${r.error}`);
      }
      out(r.text);
      if (r.sessionId && process.stdout.isTTY) console.log(`\nFollow up: ${commandsFor(ctx).askResume(r.sessionId, '…')}`);
      return;
    }
    case 'chat': {
      process.exitCode = launchInteractive(interactiveInvocation(ctx, { prompt: positionals.join(' ') }));
      return;
    }
    case 'lint': {
      const lib = new Library(paths, config).scan();
      const issues = lintVault(lib);
      if (values.agent) {
        const rel = writeLintReport(paths, issues);
        console.log(`${issues.length} mechanical issue${issues.length === 1 ? '' : 's'}; starting the agent's pass…\n`);
        process.exitCode = launchInteractive(interactiveInvocation(ctx, { skill: 'nbd-lint', args: rel }));
        return;
      }
      if (values.json) return out(issues);
      for (const i of issues) console.log(`${i.level.padEnd(5)} ${i.rel}: ${i.message}`);
      console.log(issues.length ? `\n${issues.length} issue${issues.length > 1 ? 's' : ''}.` : 'Vault looks healthy.');
      if (issues.some((i) => i.level === 'error')) process.exitCode = 1;
      return;
    }
    case 'index': {
      const wrote = writeIndex(new Library(paths, config).scan());
      return out(wrote ? `Wrote ${path.join(paths.vault, 'index.md')}` : 'index.md is up to date.');
    }
    case 'doctor': {
      const { runDoctor } = await import('./doctor.js');
      process.exitCode = await runDoctor(ctx);
      return;
    }
    case 'demo': {
      if (values.reset) return resetDemoCommand(ctx, { fresh: values.fresh });
      console.error(`Demo notebook: ${paths.home}\nReset it any time: the button in Activity, or nbd demo --reset [--fresh]\n`);
    }
    // falls through: the demo runs the normal daemon
    case 'daemon':
    case 'watch':
    case 'serve': {
      requireHome(ctx);
      const { runDaemon } = await import('./daemon.js');
      const log = ctx.logger.child('process');
      // A crash should leave its reason in the log, not just a dead process.
      process.on('uncaughtException', (err) => {
        log.error('uncaught exception; exiting', { err });
        process.exit(1);
      });
      process.on('unhandledRejection', (err) => log.error('unhandled promise rejection', { err: err instanceof Error ? err : new Error(String(err)) }));
      process.on('warning', (w) => log.warn(`node warning: ${w.name}`, { err: w }));
      let d;
      try {
        d = await runDaemon(ctx, {
          serve: cmd !== 'watch' && !values['no-serve'],
          agent: cmd !== 'serve' && !values['no-agent'],
          notifications: cmd !== 'serve',
        });
      } catch (err) {
        log.error('daemon failed to start', { err });
        throw err;
      }
      const shutdown = async (signal) => {
        log.info(`received ${signal}; stopping`);
        const force = setTimeout(() => {
          log.warn('shutdown took over 10s; exiting anyway');
          process.exit(1);
        }, 10_000);
        force.unref();
        await d.stop();
        log.info('stopped');
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      return new Promise(() => {});
    }
    case 'logs': {
      const { showLogs } = await import('./logview.js');
      return showLogs(logFile(paths), { lines: Number(values.lines ?? 50), follow: values.follow, level: values.level });
    }
    case 'service': {
      return installService(ctx, positionals[0] ?? 'print');
    }
    default:
      process.stderr.write(`Unknown command: ${cmd}\n\n${HELP}`);
      process.exitCode = 2;
  }
}

/** `nbd demo --reset`: through the running daemon when there is one (same path as the button). */
async function resetDemoCommand(ctx, { fresh = false }) {
  const { resetDemo } = await import('./demo.js');
  const { paths } = ctx;
  const daemon = new State(paths.state).readStatus();
  if (daemon?.pid && isAlive(daemon.pid)) {
    const result = path.join(paths.state, 'reset-result');
    fs.rmSync(result, { force: true });
    fs.writeFileSync(path.join(paths.state, 'reset-request'), JSON.stringify({ fresh: Boolean(fresh) }));
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (!fs.existsSync(result)) continue;
      const r = JSON.parse(fs.readFileSync(result, 'utf8'));
      fs.rmSync(result, { force: true });
      if (r.status !== 'ok') {
        process.exitCode = 1;
        return void console.log(`Not reset: ${r.error}`);
      }
      return void console.log(`Demo reset by the running daemon (pid ${daemon.pid}): ${r.pages} pages${r.fresh ? ', empty vault' : ', vault as built from them'}.`);
    }
    process.exitCode = 1;
    return void console.log(`The daemon (pid ${daemon.pid}) didn't answer; is it an older version? Stop it and run this again.`);
  }
  const r = resetDemo({ home: paths.home, fresh });
  ctx.logger?.child('daemon').info('demo reset (no daemon running)', { fresh });
  console.log(`Demo reset at ${r.home}: ${r.pages} pages${r.fresh ? ', empty vault' : ', vault as built from them'}. Run it: nbd demo`);
}

function requireHome(ctx) {
  if (!fs.existsSync(ctx.paths.home) || !fs.existsSync(ctx.paths.notebook)) {
    throw new Error(`No notebook home at ${ctx.paths.home}. Create one with: nbd init ${ctx.paths.home}`);
  }
}

function ritualsWithActivity(ctx, lib) {
  const parsed = lib.parsedPages();
  return ritualStatus(ctx.paths, ctx.config, new Date(), {
    hasActivity: (from, to) => parsed.some(({ dates }) => dates.dates.some((d) => d >= from && d <= to)),
  });
}

export function statusSnapshot(ctx) {
  const { paths, config } = ctx;
  const state = new State(paths.state);
  const pages = listPages(paths.notebook);
  const cur = pages.length ? pageInfo(pages[pages.length - 1], config.page.maxLines) : null;
  const qs = listQuestions(paths);
  const lib = new Library(paths, config).scan();
  const daemon = state.readStatus();
  return {
    home: paths.home,
    currentPage: cur ? { id: cur.id, num: cur.num, lines: cur.lines, maxLines: cur.maxLines, full: cur.full, path: cur.path } : null,
    pending: pendingPages(paths, state).map((p) => p.id),
    questions: { open: qs.filter((q) => q.status === 'open').length, answered: qs.filter((q) => q.status === 'answered').length },
    rituals: ritualsWithActivity(ctx, lib).map((r) => ({ kind: r.kind, period: r.period, due: r.due, done: r.done })),
    daemon: daemon?.pid && isAlive(daemon.pid) ? { pid: daemon.pid, url: daemon.url } : null,
    lastRun: state.data.ingest.lastRun ?? null,
  };
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function bar(lines, max, width = 14) {
  const filled = Math.min(width, Math.round((lines / max) * width));
  return `[${'#'.repeat(filled)}${'.'.repeat(width - filled)}]`;
}
