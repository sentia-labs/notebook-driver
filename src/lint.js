import fs from 'node:fs';
import path from 'node:path';
import { extractLinks } from './library.js';

const FOOTNOTE_DEF_RE = /^\[\^([^\]]+)\]:\s*(.+)$/gm;
const PAGE_LINK_RE = /\[\[(p\d{4,})(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/;
// The quote runs from the first to the last double quote on the line; agents sometimes escape
// inner quotes (\"bets\"), which markdown renders as plain quotes, so unescape before comparing.
const QUOTE_RE = /["“](.{3,})["”]/;
const squash = (s) => s.replace(/[*_`~=]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

const META_NAMES = new Set(['index', 'log']);
const NO_SOURCE_NEEDED = /^vault\/(index|log)\.md$|^vault\/inbox\//;

/**
 * Deterministic health checks for the vault (the agent's "lint" pass covers judgement calls such
 * as contradictions and stale claims). Returns [{ level: error|warn|info, rel, message }].
 */
export function lintVault(library) {
  const issues = [];
  const add = (level, rel, message) => issues.push({ level, rel, message });
  const notes = library.notes();
  const pages = new Set(library.pages().map((p) => p.name));

  const byName = new Map();
  for (const n of notes) {
    const key = n.name.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), n.rel]);
  }
  for (const [name, rels] of byName) {
    if (rels.length > 1) for (const rel of rels) add('error', rel, `file name "${name}" is not unique, so [[${name}]] is ambiguous (${rels.join(', ')})`);
  }

  const index = library.get('vault/index.md');
  const indexed = new Set(index ? extractLinks(index.body, index.rel) : []);
  if (!index) add('warn', 'vault/index.md', 'missing: the agent keeps a catalog of every note here');
  if (!library.get('vault/log.md')) add('warn', 'vault/log.md', 'missing: the agent appends a line per operation here');

  for (const n of notes) {
    if (n.frontmatterError) add('error', n.rel, `frontmatter does not parse: ${n.frontmatterError}`);
    else if (!Object.keys(n.frontmatter).length && !META_NAMES.has(n.name)) add('warn', n.rel, 'no frontmatter');
    else if (!n.frontmatter.type && !META_NAMES.has(n.name)) add('warn', n.rel, 'frontmatter has no type');

    if (!NO_SOURCE_NEEDED.test(n.rel) && !n.sources.length) add('warn', n.rel, 'no notebook sources: every claim should trace back to a page');
    for (const s of n.sources) if (!pages.has(s)) add('error', n.rel, `cites ${s}, which does not exist`);

    // Grounding: a citation's quote must appear verbatim on the page it cites.
    for (const m of n.body.matchAll(FOOTNOTE_DEF_RE)) {
      const page = PAGE_LINK_RE.exec(m[2])?.[1];
      const quote = QUOTE_RE.exec(m[2])?.[1]?.replace(/\\(["“”])/g, '$1');
      if (!page || !quote) continue;
      const doc = library.get(`notebook/${page}.md`);
      if (!doc) add('error', n.rel, `footnote [^${m[1]}] cites ${page}, which does not exist`);
      else if (!squash(doc.text).includes(squash(quote))) add('warn', n.rel, `footnote [^${m[1]}]: "${quote}" is not on ${page} (edited page, or a misquote)`);
    }

    for (const target of new Set(n.links)) {
      if (!library.resolve(target)) add('warn', n.rel, `broken link [[${target}]]`);
    }
    if (index && !META_NAMES.has(n.name) && !n.rel.startsWith('vault/inbox/') && !indexed.has(n.name.toLowerCase()) && !indexed.has(n.rel.slice(6, -3).toLowerCase())) {
      add('info', n.rel, 'not listed in index.md');
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(n.name) && !/^\d{4}(-\d{2}(-\d{2})?|-W\d{2}|-Q[1-4])?$/.test(n.name) && !/^q\d+$/.test(n.name)) {
      add('info', n.rel, 'file name is not kebab-case');
    }
    if (n.rel.startsWith('vault/inbox/') && n.frontmatter.status === 'answered' && n.frontmatter.answered) {
      const days = (Date.now() - Date.parse(n.frontmatter.answered)) / 86400000;
      if (days > 2) add('info', n.rel, `answered ${Math.floor(days)} days ago but not applied yet (nbd sync)`);
    }
  }
  const order = { error: 0, warn: 1, info: 2 };
  return issues.sort((a, b) => order[a.level] - order[b.level] || a.rel.localeCompare(b.rel));
}

/** The report `nbd lint --agent` (and the viewer's "Fix with the agent") hands to the nbd-lint skill. */
export function writeLintReport(paths, issues) {
  const report = [
    `# Lint report · ${new Date().toISOString()}`,
    '',
    ...(issues.length ? issues.map((i) => `- ${i.level} \`${i.rel}\`: ${i.message}`) : ['- no mechanical issues']),
    '',
  ].join('\n');
  const file = path.join(paths.state, 'context', 'lint.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, report);
  return path.relative(paths.home, file);
}
