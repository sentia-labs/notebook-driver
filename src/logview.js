import fs from 'node:fs';
import { LEVELS } from './log.js';

const ENTRY_RE = /^\S+ (ERROR|WARN|INFO|DEBUG)\s/;
const JSON_LEVEL_RE = /^\{"ts":"[^"]*","level":"(\w+)"/;

/** `nbd logs`: print the last entries of the log file, optionally filtered and followed. */
export async function showLogs(file, { lines = 50, follow = false, level = null, out = process.stdout } = {}) {
  if (level && !(level in LEVELS)) throw new Error(`Unknown level ${level} (error, warn, info, debug)`);
  const keep = (lvl) => !level || (LEVELS[lvl.toLowerCase()] ?? 0) <= LEVELS[level];
  if (!fs.existsSync(file)) {
    if (!follow) return void out.write(`No log yet at ${file} (the daemon and commands write it as they run).\n`);
  } else {
    const entries = groupEntries(readTail(file, lines * 400)).filter((e) => keep(e.level));
    for (const e of entries.slice(-lines)) out.write(e.text);
  }
  if (!follow) return;

  // Follow: poll (works across editors, rotation and network filesystems), reopen on rotation.
  let pos = safeSize(file);
  let ino = safeIno(file);
  let partial = '';
  let lastLevel = 'info';
  const pump = () => {
    const nowIno = safeIno(file);
    const size = safeSize(file);
    if (nowIno !== ino || size < pos) {
      ino = nowIno;
      pos = 0;
      partial = '';
    }
    if (size <= pos) return;
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(size - pos);
    fs.readSync(fd, buf, 0, buf.length, pos);
    fs.closeSync(fd);
    pos = size;
    const text = partial + buf.toString('utf8');
    const parts = text.split('\n');
    partial = parts.pop();
    for (const line of parts) {
      const lvl = entryLevel(line);
      if (lvl) lastLevel = lvl;
      if (keep(lastLevel)) out.write(`${line}\n`);
    }
  };
  const timer = setInterval(pump, 500);
  await new Promise((resolve) => {
    process.once('SIGINT', () => {
      clearInterval(timer);
      resolve();
    });
  });
}

/** The last `lines` entries (optionally only `level` and worse) as [{ level, text }]. */
export function tailEntries(file, { lines = 100, level = null } = {}) {
  if (!fs.existsSync(file)) return [];
  const keep = (lvl) => !level || (LEVELS[lvl] ?? 0) <= (LEVELS[level] ?? 3);
  return groupEntries(readTail(file, lines * 400))
    .filter((e) => keep(e.level))
    .slice(-lines);
}

function readTail(file, bytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    let text = buf.toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    return text;
  } finally {
    fs.closeSync(fd);
  }
}

/** Lines → entries; stack-trace lines stay with the entry they belong to. */
function groupEntries(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const lvl = entryLevel(line);
    if (lvl || !entries.length) entries.push({ level: lvl ?? 'info', text: `${line}\n` });
    else entries[entries.length - 1].text += `${line}\n`;
  }
  return entries;
}

function entryLevel(line) {
  const m = ENTRY_RE.exec(line) ?? JSON_LEVEL_RE.exec(line);
  return m ? m[1].toLowerCase() : null;
}

function safeSize(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function safeIno(file) {
  try {
    return fs.statSync(file).ino;
  } catch {
    return null;
  }
}
