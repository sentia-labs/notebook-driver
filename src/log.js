import fs from 'node:fs';
import path from 'node:path';

export const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

/**
 * A small leveled logger for operational debugging. Every line goes to stderr (journald when the
 * daemon runs as a service) and to a size-rotated file, written synchronously so the last lines
 * before a crash are on disk.
 *
 *   const log = createLogger({ level: 'info', file: '.nbd/logs/nbd.log' }).child('viewer');
 *   log.info('GET /v/x', { status: 200, ms: 3.1 });
 *   log.error('render failed', { err });
 *
 * Text lines: `2026-10-23T15:22:08.123-05:00 INFO  viewer  GET /v/x status=200 ms=3.1`
 * (an `err` field adds its stack on indented lines). format 'json' writes one object per line.
 */
export function createLogger({
  level = 'info',
  format = 'text',
  file = null,
  maxBytes = 5 * 1024 * 1024,
  keep = 3,
  stream = process.stderr,
  streamLevel = level,
} = {}) {
  const max = LEVELS[level] ?? LEVELS.info;
  const streamMax = Math.min(max, LEVELS[streamLevel] ?? max);
  const sink = file ? new FileSink(file, { maxBytes, keep }) : null;
  const subscribers = new Set();

  function write(lvl, component, msg, fields) {
    const n = LEVELS[lvl];
    if (n > max) return;
    const line = format === 'json' ? jsonLine(lvl, component, msg, fields) : textLine(lvl, component, msg, fields);
    if (stream && n <= streamMax) {
      try {
        stream.write(line);
      } catch {}
    }
    sink?.write(line);
    for (const fn of subscribers) {
      try {
        fn({ level: lvl, component, line });
      } catch {}
    }
  }

  const make = (component) => ({
    component,
    level,
    file: sink?.file ?? null,
    error: (msg, fields) => write('error', component, msg, fields),
    warn: (msg, fields) => write('warn', component, msg, fields),
    info: (msg, fields) => write('info', component, msg, fields),
    debug: (msg, fields) => write('debug', component, msg, fields),
    enabled: (lvl) => (LEVELS[lvl] ?? 0) <= max,
    child: (name) => make(name),
    // Live feed of written lines (the viewer's log panel). Returns an unsubscribe function.
    subscribe: (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    close: () => sink?.close(),
  });
  return make('nbd');
}

/** A logger that drops everything (tests, library use). */
export const NULL_LOGGER = (() => {
  const noop = () => {};
  const l = { component: 'null', level: 'off', file: null, error: noop, warn: noop, info: noop, debug: noop, enabled: () => false, subscribe: () => noop, close: noop };
  l.child = () => l;
  return l;
})();

/** The logger for a component, or a silent one when the context has none. */
export function loggerFor(ctx, component) {
  return ctx?.logger ? ctx.logger.child(component) : NULL_LOGGER;
}

/** Logger settings from config, overridable by NBD_LOG_LEVEL / NBD_LOG_FORMAT. */
export function loggerOptions(ctx, { env = process.env, ...over } = {}) {
  const c = ctx.config.log ?? {};
  return {
    level: env.NBD_LOG_LEVEL || c.level || 'info',
    format: env.NBD_LOG_FORMAT || c.format || 'text',
    file: c.file === false ? null : logFile(ctx.paths),
    maxBytes: (c.maxSizeMB ?? 5) * 1024 * 1024,
    keep: c.keep ?? 3,
    ...over,
  };
}

export function logFile(paths) {
  return path.join(paths.state, 'logs', 'nbd.log');
}

// ---------------------------------------------------------------------------------------------

class FileSink {
  constructor(file, { maxBytes, keep }) {
    this.file = file;
    this.maxBytes = maxBytes;
    this.keep = keep;
    this.fd = null;
    this.size = 0;
    this.broken = false;
  }

  open() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.fd = fs.openSync(this.file, 'a');
    this.size = fs.fstatSync(this.fd).size;
  }

  write(line) {
    if (this.broken) return;
    try {
      if (this.fd === null) this.open();
      // Another process (a CLI command next to the daemon) may have rotated the file under us.
      if (this.size + line.length > this.maxBytes) {
        this.size = fs.fstatSync(this.fd).size;
        if (!fs.existsSync(this.file) || fs.statSync(this.file).ino !== fs.fstatSync(this.fd).ino) this.reopen();
        else if (this.size + line.length > this.maxBytes) this.rotate();
      }
      const buf = Buffer.from(line);
      fs.writeSync(this.fd, buf);
      this.size += buf.length;
    } catch (err) {
      // Never let logging take the process down; say so once on stderr.
      this.broken = true;
      try {
        process.stderr.write(`nbd: cannot write log file ${this.file}: ${err.message}\n`);
      } catch {}
    }
  }

  rotate() {
    this.close();
    for (let i = this.keep - 1; i >= 1; i--) {
      try {
        fs.renameSync(`${this.file}.${i}`, `${this.file}.${i + 1}`);
      } catch {}
    }
    try {
      if (this.keep > 0) fs.renameSync(this.file, `${this.file}.1`);
      else fs.rmSync(this.file, { force: true });
    } catch {}
    try {
      fs.rmSync(`${this.file}.${this.keep + 1}`, { force: true });
    } catch {}
    this.open();
  }

  reopen() {
    this.close();
    this.open();
  }

  close() {
    if (this.fd === null) return;
    try {
      fs.closeSync(this.fd);
    } catch {}
    this.fd = null;
  }
}

function textLine(lvl, component, msg, fields) {
  // Multi-line messages (agent stderr) continue on indented lines, which can't pass for entries.
  let line = `${timestamp()} ${lvl.toUpperCase().padEnd(5)} ${component.padEnd(7)} ${String(msg).replace(/\r?\n/g, '\n    ')}`;
  let stack = '';
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined || v === null || v === '') continue;
      if (v instanceof Error) {
        if (v.message !== 'stack') line += ` ${k}=${quote(v.message)}`;
        if (v.stack) stack += `\n${v.stack.split('\n').slice(1).map((s) => `    ${s.trim()}`).join('\n')}`;
        continue;
      }
      line += ` ${k}=${quote(typeof v === 'object' ? JSON.stringify(v) : String(v))}`;
    }
  }
  return `${line}${stack}\n`;
}

function jsonLine(lvl, component, msg, fields) {
  const out = { ts: timestamp(), level: lvl, component, msg: String(msg) };
  for (const [k, v] of Object.entries(fields ?? {})) {
    if (v === undefined) continue;
    out[k] = v instanceof Error ? { message: v.message, stack: v.stack, code: v.code } : v;
  }
  return `${JSON.stringify(out)}\n`;
}

function quote(s) {
  const t = oneLine(s);
  return t === '' || /[\s"=]/.test(t) ? JSON.stringify(t) : t;
}

function oneLine(s) {
  return String(s).replace(/\r?\n/g, '\\n');
}

/** Local time with milliseconds and UTC offset, so lines sort and still read naturally. */
export function timestamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}` +
    `${sign}${p(Math.floor(a / 60))}:${p(a % 60)}`
  );
}
