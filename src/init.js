import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { homePaths } from './config.js';
import { Library } from './library.js';
import { DEFAULTS } from './config.js';
import { writeIndex } from './vaultindex.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = path.join(ROOT, 'templates/home');
const BIN = path.join(ROOT, 'bin/nbd.js');

// "user" files are the human's once created (only --force replaces them); "tool" files track this
// repo (--refresh updates them). Anything replaced is backed up first.
function manifest() {
  const files = [
    ['AGENTS.md', 'AGENTS.md', 'user'],
    ['CLAUDE.md', 'CLAUDE.md', 'user'],
    ['KEY.md', 'KEY.md', 'user'],
    ['README.md', 'README.md', 'user'],
    ['gitignore', '.gitignore', 'user'],
    ['claude/settings.json', '.claude/settings.json', 'tool'],
  ];
  const skillsDir = path.join(TEMPLATES, 'claude/skills');
  for (const name of fs.readdirSync(skillsDir).sort()) {
    files.push([`claude/skills/${name}/SKILL.md`, `.claude/skills/${name}/SKILL.md`, 'tool']);
  }
  return files;
}

function starterConfig() {
  const d = DEFAULTS;
  return {
    page: { maxLines: d.page.maxLines },
    ingest: { mode: d.ingest.mode, idleSeconds: d.ingest.idleSeconds },
    harness: { kind: d.harness.kind, model: d.harness.model },
    rituals: {
      weekly: d.rituals.weekly,
      monthly: d.rituals.monthly,
      quarterly: d.rituals.quarterly,
      yearly: d.rituals.yearly,
    },
    server: { port: d.server.port },
  };
}

export function initHome(home, { refresh = false, force = false } = {}) {
  const paths = homePaths(home);
  const res = { written: [], kept: [], backedUp: [] };
  for (const dir of [paths.notebook, paths.vault, paths.inbox, paths.state]) fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  const put = (dest, content, owner) => {
    const abs = path.join(home, dest);
    const exists = fs.existsSync(abs);
    if (exists) {
      const current = fs.readFileSync(abs, 'utf8');
      if (current === content) return;
      const replace = force || (refresh && owner === 'tool');
      if (!replace) {
        res.kept.push(dest);
        return;
      }
      fs.writeFileSync(`${abs}.bak-${stamp}`, current);
      res.backedUp.push(`${dest}.bak-${stamp}`);
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    res.written.push(dest);
  };

  for (const [src, dest, owner] of manifest()) {
    const text = fs.readFileSync(path.join(TEMPLATES, src), 'utf8').replaceAll('{{NBD_BIN}}', BIN);
    put(dest, text, owner);
  }
  if (!fs.existsSync(paths.config)) put('nbd.json', `${JSON.stringify(starterConfig(), null, 2)}\n`, 'user');
  if (!fs.existsSync(path.join(paths.vault, 'log.md'))) {
    put('vault/log.md', '# Log\n\nAppend-only record of agent operations, oldest first. Recent entries: `grep "^## \\[" vault/log.md | tail`.\n', 'tool');
  }
  try {
    if (writeIndex(new Library(paths, DEFAULTS).scan())) res.written.push('vault/index.md');
  } catch {}
  return res;
}
