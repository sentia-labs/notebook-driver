import fs from 'node:fs';
import path from 'node:path';
import { countLines, pageTopic, parseLines } from './bujo.js';

// Pages are numbered like a paper notebook: p0001.md, p0002.md, ... The highest number is the
// current page. Days flow across pages; a page is a fixed-size container, not a day.
export const PAGE_FILE_RE = /^p(\d{4,})\.md$/;

export function pageId(num) {
  return `p${String(num).padStart(4, '0')}`;
}

export function pageNum(id) {
  const m = /^p(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
}

export function isPageFile(name) {
  return PAGE_FILE_RE.test(name);
}

/** All pages in notebook order. */
export function listPages(notebookDir) {
  let names;
  try {
    names = fs.readdirSync(notebookDir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return names
    .map((name) => {
      const m = PAGE_FILE_RE.exec(name);
      if (!m) return null;
      const num = Number(m[1]);
      return { id: pageId(num), num, file: name, path: path.join(notebookDir, name) };
    })
    .filter(Boolean)
    .sort((a, b) => a.num - b.num);
}

export function currentPage(notebookDir) {
  const pages = listPages(notebookDir);
  return pages.length ? pages[pages.length - 1] : null;
}

/**
 * Create the next page. Uses an exclusive create so two callers can never both claim a number.
 * `firstLine` is an optional topic line (e.g. "# 2026-10-22 Thu").
 */
export function createNextPage(notebookDir, { firstLine = '' } = {}) {
  fs.mkdirSync(notebookDir, { recursive: true });
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = currentPage(notebookDir);
    const num = cur ? cur.num + 1 : 1;
    const file = path.join(notebookDir, `${pageId(num)}.md`);
    try {
      fs.writeFileSync(file, firstLine ? `${firstLine}\n` : '', { flag: 'wx' });
      return { id: pageId(num), num, file: path.basename(file), path: file };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  throw new Error('Could not allocate a new page number');
}

/** Summary of one page: line usage, topic, mtime. */
export function pageInfo(page, maxLines, text = fs.readFileSync(page.path, 'utf8')) {
  const lines = countLines(text);
  const stat = fs.statSync(page.path);
  return {
    ...page,
    lines,
    maxLines,
    full: lines >= maxLines,
    overflow: Math.max(0, lines - maxLines),
    topic: pageTopic(text),
    mtime: stat.mtime,
  };
}

/**
 * Parse every page in order, carrying the date context from one page into the next.
 * Returns [{ page, text, records, startContext, endContext }].
 */
export function parseNotebook(notebookDir) {
  const out = [];
  let ctx = {};
  for (const page of listPages(notebookDir)) {
    const text = fs.readFileSync(page.path, 'utf8');
    const { records, context } = parseLines(text, ctx);
    out.push({ page, text, records, startContext: ctx, endContext: context });
    ctx = context;
  }
  return out;
}

/**
 * Dates a page covers: { from, to, dates } (YYYY-MM-DD or null). Lines before the page's first
 * dated heading belong to the date carried over from the previous page.
 */
export function pageDates(records) {
  const dates = new Set();
  const months = new Set();
  for (const r of records) {
    if (r.kind === 'blank') continue;
    if (r.date) dates.add(r.date);
    if (r.month) months.add(r.month);
  }
  const sorted = [...dates].sort();
  return { from: sorted[0] ?? null, to: sorted[sorted.length - 1] ?? null, dates: sorted, months: [...months].sort() };
}

/** Number each line for prompts: "  7 | - [ ] call Mom". */
export function numberLines(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const w = String(lines.length).length;
  return lines.map((l, i) => `${String(i + 1).padStart(w, ' ')} | ${l}`).join('\n');
}
