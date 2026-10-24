import fs from 'node:fs';
import path from 'node:path';
import MiniSearch from 'minisearch';
import { splitFrontmatter, asList } from './frontmatter.js';
import { countLines, pageTopic, parseLines } from './bujo.js';
import { PAGE_FILE_RE, pageDates } from './pages.js';
import { walkFiles } from './util.js';

const WIKILINK_RE = /!?\[\[([^[\]\n|#]*)(?:#[^[\]\n|]*)?(?:\|[^[\]\n]*)?\]\]/g;
const MDLINK_RE = /\]\(([^)\s]+?\.md)(?:#[^)\s]*)?\)/g;
const FENCED_RE = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm;
const ASSET_RE = /\.(png|jpe?g|gif|svg|webp|avif|pdf|mp3|mp4|webm)$/i;

/**
 * In-memory index of the notebook and the vault: documents, wikilink resolution, backlinks and
 * full-text search. Kept fresh by calling update(rel) when a file changes.
 */
export class Library {
  constructor(paths, config) {
    this.paths = paths;
    this.config = config;
    this.docs = new Map(); // rel → doc
    this.assets = new Map(); // lowercased basename → rel
    this._derived = null;
  }

  scan() {
    this.docs.clear();
    this.assets.clear();
    for (const root of ['notebook', 'vault']) {
      for (const rel of walkFiles(this.paths[root])) this._load(`${root}/${rel}`);
    }
    this._derived = null;
    return this;
  }

  /** Re-read one file (path relative to home). Returns the doc, or null if it is gone. */
  update(rel) {
    this._derived = null;
    const abs = path.join(this.paths.home, rel);
    if (!fs.existsSync(abs)) {
      this.docs.delete(rel);
      for (const [k, v] of this.assets) if (v === rel) this.assets.delete(k);
      return null;
    }
    return this._load(rel);
  }

  _load(rel) {
    const abs = path.join(this.paths.home, rel);
    const base = path.posix.basename(rel);
    if (!rel.endsWith('.md')) {
      if (ASSET_RE.test(base)) this.assets.set(base.toLowerCase(), rel);
      return null;
    }
    let text;
    let stat;
    try {
      text = fs.readFileSync(abs, 'utf8');
      stat = fs.statSync(abs);
    } catch {
      return null;
    }
    const isPage = rel.startsWith('notebook/') && PAGE_FILE_RE.test(base) && !rel.slice(9).includes('/');
    const doc = isPage ? this._pageDoc(rel, base, text) : this._noteDoc(rel, base, text);
    doc.mtime = stat.mtimeMs;
    doc.size = stat.size;
    this.docs.set(rel, doc);
    return doc;
  }

  _pageDoc(rel, base, text) {
    const name = base.slice(0, -3);
    const lines = countLines(text);
    const maxLines = this.config.page.maxLines;
    return {
      kind: 'page',
      rel,
      name,
      num: Number(name.slice(1)),
      route: `/n/${name}`,
      title: pageTopic(text) || `Page ${Number(name.slice(1))}`,
      type: 'page',
      frontmatter: {},
      text,
      body: text,
      bodyLine: 0,
      lines,
      maxLines,
      full: lines >= maxLines,
      overflow: Math.max(0, lines - maxLines),
      links: extractLinks(text, rel),
      sources: [],
      tags: [],
      aliases: [],
    };
  }

  _noteDoc(rel, base, text) {
    const { data, body, bodyLine, error } = splitFrontmatter(text);
    const name = base.slice(0, -3);
    const h1 = /^#\s+(.+)$/m.exec(body);
    const inVault = rel.startsWith('vault/');
    const relNoExt = rel.slice(0, -3);
    const sourceLinks = asList(data.sources).flatMap((s) => extractLinks(s, rel));
    return {
      kind: inVault ? 'note' : 'file',
      rel,
      name,
      route: inVault ? `/v/${relNoExt.slice(6)}` : `/f/${relNoExt}`,
      title: String(data.title ?? h1?.[1] ?? name).trim(),
      type: String(data.type ?? folderType(rel)),
      frontmatter: data,
      frontmatterError: error,
      text,
      body,
      bodyLine,
      description: String(data.description ?? data.summary ?? '').trim() || firstParagraph(body),
      links: [...extractLinks(body, rel), ...sourceLinks, ...frontmatterLinks(data, rel)],
      sources: sourceLinks.filter((l) => /^p\d+$/.test(l)),
      tags: asList(data.tags).map((t) => t.replace(/^#/, '')),
      aliases: asList(data.aliases),
    };
  }

  get(rel) {
    return this.docs.get(rel) ?? null;
  }

  byRoute(route) {
    for (const d of this.docs.values()) if (d.route === route) return d;
    return null;
  }

  pages() {
    return [...this.docs.values()].filter((d) => d.kind === 'page').sort((a, b) => a.num - b.num);
  }

  notes() {
    return [...this.docs.values()].filter((d) => d.kind === 'note').sort((a, b) => a.rel.localeCompare(b.rel));
  }

  /** Resolve a wikilink target the way Obsidian does: path, then file name, then alias. */
  resolve(target) {
    const t = normTarget(target);
    if (!t) return null;
    const d = this._derivedIndex();
    if (t.includes('/')) {
      for (const cand of [`${t}.md`, `vault/${t}.md`, `notebook/${t}.md`]) {
        const doc = d.byPathLower.get(cand);
        if (doc) return doc;
      }
    }
    const byName = d.byName.get(path.posix.basename(t));
    if (byName?.length) return byName[0];
    const byAlias = d.byAlias.get(t);
    if (byAlias?.length) return byAlias[0];
    return null;
  }

  resolveAsset(target) {
    return this.assets.get(path.posix.basename(String(target).trim()).toLowerCase()) ?? null;
  }

  /** Documents that link to `rel` (including through frontmatter `sources`). */
  backlinks(rel) {
    return [...(this._derivedIndex().backlinks.get(rel) ?? [])]
      .map((r) => this.docs.get(r))
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);
  }

  /** Vault notes that cite a page as a source. */
  derivedFrom(pageName) {
    return this.notes()
      .filter((n) => n.sources.includes(pageName))
      .sort((a, b) => b.mtime - a.mtime);
  }

  /** Parse records for every page with date context chained across pages (cached). */
  parsedPages() {
    const d = this._derivedIndex();
    if (!d.parsed) {
      let ctx = {};
      d.parsed = this.pages().map((doc) => {
        const { records, context } = parseLines(doc.text, ctx);
        const dates = pageDates(records);
        const out = { doc, records, startContext: ctx, endContext: context, dates };
        ctx = context;
        return out;
      });
    }
    return d.parsed;
  }

  search(query, { limit = 30 } = {}) {
    const { text, filters } = parseQuery(query);
    const d = this._derivedIndex();
    const match = (doc) =>
      (!filters.in || (filters.in === 'notebook' ? doc.kind === 'page' : doc.kind === 'note')) &&
      (!filters.type || doc.type.toLowerCase() === filters.type) &&
      (!filters.tag || doc.tags.some((t) => t.toLowerCase() === filters.tag));
    let results;
    if (text) {
      results = d.search
        .search(text, { prefix: true, fuzzy: 0.15, boost: { title: 3, name: 2, tags: 2, aliases: 2 }, combineWith: 'AND' })
        .map((r) => ({ doc: this.docs.get(r.id), score: r.score, terms: r.terms }))
        .filter((r) => r.doc && match(r.doc));
      if (!results.length) {
        results = d.search
          .search(text, { prefix: true, fuzzy: 0.2, boost: { title: 3, name: 2, tags: 2 }, combineWith: 'OR' })
          .map((r) => ({ doc: this.docs.get(r.id), score: r.score, terms: r.terms }))
          .filter((r) => r.doc && match(r.doc));
      }
    } else {
      results = [...this.docs.values()]
        .filter((doc) => (doc.kind === 'page' || doc.kind === 'note') && match(doc))
        .sort((a, b) => b.mtime - a.mtime)
        .map((doc) => ({ doc, score: 0, terms: [] }));
    }
    return results.slice(0, limit).map((r) => ({ ...r, snippet: snippet(r.doc.body, r.terms) }));
  }

  _derivedIndex() {
    if (this._derived) return this._derived;
    const byName = new Map();
    const byAlias = new Map();
    const byPathLower = new Map();
    const add = (map, key, doc) => {
      const list = map.get(key) ?? [];
      list.push(doc);
      map.set(key, list);
    };
    for (const doc of this.docs.values()) {
      byPathLower.set(doc.rel.toLowerCase(), doc);
      add(byName, doc.name.toLowerCase(), doc);
      for (const a of doc.aliases) add(byAlias, a.toLowerCase(), doc);
    }
    // Prefer vault notes over other files, then the shortest path.
    for (const list of byName.values()) list.sort((a, b) => rank(a) - rank(b) || a.rel.length - b.rel.length);

    this._derived = { byName, byAlias, byPathLower, backlinks: new Map(), parsed: null, search: null };
    for (const doc of this.docs.values()) {
      for (const target of new Set(doc.links)) {
        const to = this.resolve(target);
        if (!to || to.rel === doc.rel) continue;
        const set = this._derived.backlinks.get(to.rel) ?? new Set();
        set.add(doc.rel);
        this._derived.backlinks.set(to.rel, set);
      }
    }
    const search = new MiniSearch({
      fields: ['title', 'name', 'tags', 'aliases', 'text'],
      storeFields: [],
      extractField: (doc, field) =>
        field === 'tags' || field === 'aliases' ? doc[field].join(' ') : field === 'text' ? plain(doc.body) : doc[field],
      idField: 'rel',
    });
    search.addAll([...this.docs.values()].filter((d) => d.kind === 'page' || d.kind === 'note'));
    this._derived.search = search;
    return this._derived;
  }
}

function rank(doc) {
  return doc.kind === 'note' ? 0 : doc.kind === 'page' ? 1 : 2;
}

function normTarget(target) {
  return String(target ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\.md$/i, '')
    .toLowerCase();
}

/** Wikilink and relative .md link targets in a document, normalised for resolve(). */
export function extractLinks(text, fromRel) {
  const out = [];
  const src = String(text).replace(FENCED_RE, '');
  for (const m of src.matchAll(WIKILINK_RE)) if (m[1].trim()) out.push(normTarget(m[1]));
  for (const m of src.matchAll(MDLINK_RE)) {
    if (/^[a-z]+:/i.test(m[1])) continue;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), decodeURI(m[1])));
    out.push(normTarget(resolved));
  }
  return out;
}

function frontmatterLinks(data, rel) {
  const out = [];
  for (const [k, v] of Object.entries(data)) {
    if (k === 'sources') continue;
    for (const s of asList(v)) if (s.includes('[[')) out.push(...extractLinks(s, rel));
  }
  return out;
}

function folderType(rel) {
  const parts = rel.split('/');
  const folder = parts.length > 2 ? parts[1] : '';
  const map = {
    projects: 'project',
    areas: 'area',
    resources: 'resource',
    archive: 'archive',
    people: 'person',
    inbox: 'question',
    journal: 'journal',
  };
  return map[folder] ?? (parts.length === 2 ? 'meta' : 'note');
}

function firstParagraph(body) {
  for (const block of body.split(/\n\s*\n/)) {
    const t = block.trim();
    if (t && !t.startsWith('#') && !t.startsWith('>') && !t.startsWith('|') && !t.startsWith('```')) {
      return plain(t).replace(/\[\^[^\]]+\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
    }
  }
  return '';
}

/** Rough markdown → text for indexing and snippets. */
export function plain(md) {
  return String(md)
    .replace(/^(```|~~~)[^\n]*\n([\s\S]*?)^\1[ \t]*$/gm, '$2')
    .replace(/!?\[\[([^\]|#]*)(?:#[^\]|]*)?\|([^\]]*)\]\]/g, '$2')
    .replace(/!?\[\[([^\]|#]*)(?:#([^\]|]*))?\]\]/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+(\[.\]\s+)?/gm, '')
    .replace(/[*_~=`]{1,3}/g, '')
    .replace(/[ \t]+/g, ' ');
}

export function parseQuery(q) {
  const filters = {};
  const words = [];
  for (const w of String(q ?? '').trim().split(/\s+/)) {
    const m = /^(in|type|tag):(.+)$/i.exec(w);
    if (m) filters[m[1].toLowerCase()] = m[2].toLowerCase().replace(/^#/, '');
    else if (w.startsWith('#') && w.length > 1) filters.tag = w.slice(1).toLowerCase();
    else if (w) words.push(w);
  }
  return { text: words.join(' '), filters };
}

function snippet(body, terms = [], width = 160) {
  const text = plain(body).replace(/\s+/g, ' ').trim();
  if (!terms.length) return { text: text.slice(0, width), marks: [] };
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t.toLowerCase());
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const start = Math.max(0, at - Math.floor(width / 3));
  const s = (start > 0 ? '…' : '') + text.slice(start, start + width) + (start + width < text.length ? '…' : '');
  return { text: s, marks: terms };
}
