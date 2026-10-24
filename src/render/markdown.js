import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import mark from 'markdown-it-mark';
import katexPlugin from '@vscode/markdown-it-katex';
import { createHighlighter, bundledLanguages } from 'shiki';
import { parseBullet } from '../bujo.js';
import { escapeHtml, slugify } from '../util.js';

const THEMES = { light: 'github-light', dark: 'github-dark' };
const FENCE_LANG_RE = /^\s*(?:```|~~~)\s*([\w+#.-]+)/gm;

/**
 * Markdown → HTML for notebook pages and vault notes.
 *
 * render(src, env) is synchronous after `await prepare(src)` has loaded the code languages the
 * document uses. env carries per-document options and receives outputs:
 *   env.mode        'notebook' renders every bullet with Bullet Journal glyphs; 'vault' only tasks/events
 *   env.lineOffset  lines hidden before `src` (frontmatter), so data-line matches the file
 *   env.resolveWikilink(target) → { href, label, exists, kind } | null
 *   env.resolveHref(href) → href            (relative links and images)
 *   env.toc         ← [{ level, text, id }]
 */
export class MarkdownRenderer {
  constructor() {
    this.highlighter = null;
    this.md = new MarkdownIt({ html: false, linkify: true, typographer: false });
    this.md.use(footnote).use(mark).use(katexPlugin.default ?? katexPlugin, { throwOnError: false });
    this.md.core.ruler.after('block', 'nbd_blocks', blockRule);
    this.md.inline.ruler.before('link', 'wikilink', wikilinkRule);
    installRenderRules(this.md, this);
  }

  async init() {
    this.highlighter = await createHighlighter({ themes: Object.values(THEMES), langs: [] });
    return this;
  }

  /** Load the grammars a document needs (Shiki loads languages lazily). */
  async prepare(src) {
    if (!this.highlighter) await this.init();
    const loaded = new Set(this.highlighter.getLoadedLanguages());
    const wanted = new Set();
    for (const m of src.matchAll(FENCE_LANG_RE)) {
      const lang = m[1].toLowerCase();
      if (lang in bundledLanguages && !loaded.has(lang) && lang !== 'mermaid') wanted.add(lang);
    }
    for (const lang of wanted) {
      try {
        await this.highlighter.loadLanguage(lang);
      } catch {
        // Unknown or broken grammar: the block falls back to plain text.
      }
    }
  }

  render(src, env = {}) {
    env.toc = [];
    env.headingIds = new Map();
    // "- * idea" / "- + more" are signifiers in the key, but markdown reads "* " and "+ " as nested lists.
    if (env.mode === 'notebook') src = src.replace(/^(\s*[-*+]\s+)([*+])(?=\s)/gm, '$1\\$2');
    return this.md.render(src, env);
  }

  async renderAsync(src, env = {}) {
    await this.prepare(src);
    return this.render(src, env);
  }

  highlight(code, lang) {
    const l = (lang || '').toLowerCase();
    if (this.highlighter && l && this.highlighter.getLoadedLanguages().includes(l)) {
      return this.highlighter.codeToHtml(code, { lang: l, themes: THEMES, defaultColor: false });
    }
    return `<pre class="shiki plain"><code>${escapeHtml(code)}</code></pre>`;
  }
}

// ---------------------------------------------------------------------------------------------
// Block-level core rule: line numbers, Bullet Journal list items, Obsidian-style callouts.

function blockRule(state) {
  const env = state.env ?? {};
  const offset = env.lineOffset ?? 0;
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.map && (t.nesting === 1 || t.type === 'fence' || t.type === 'code_block' || t.type === 'hr')) {
      t.attrSet('data-line', String(t.map[0] + 1 + offset));
    }
    if (t.type === 'list_item_open') bujoItem(tokens, i, env.mode);
    if (t.type === 'blockquote_open') callout(tokens, i, state);
  }
}

const BUJO_CLASS = {
  open: 'open',
  started: 'started',
  done: 'done',
  migrated: 'migrated',
  scheduled: 'scheduled',
  irrelevant: 'irrelevant',
};

function bujoItem(tokens, i, mode) {
  const item = tokens[i];
  if (item.info) return; // ordered list item (info holds the number)
  const inline = tokens[i + 2]?.type === 'inline' ? tokens[i + 2] : null;
  if (!inline) return;
  const firstLine = inline.content.split('\n')[0];
  const b = parseBullet(firstLine);
  if (b.kind === 'note' && mode !== 'notebook' && !b.signifiers.length) return;
  if (b.kind === 'note' && b.signifiers.length === 0 && mode === 'notebook') {
    item.attrJoin('class', 'bujo bujo-note');
    return;
  }
  // Strip the marker (and signifiers) we consumed, keep the rest of the paragraph intact.
  const rest = inline.content.slice(firstLine.length);
  const shown = b.struck ? `~~${b.text}~~` : b.text;
  inline.content = shown + rest;
  const cls = b.kind === 'note' && mode !== 'notebook' ? ['bujo-sig'] : ['bujo', `bujo-${b.kind}`];
  if (b.kind === 'task') cls.push(`bujo-${BUJO_CLASS[b.state] ?? 'open'}`);
  if (b.struck) cls.push('bujo-struck');
  item.attrJoin('class', cls.join(' '));
  if (b.signifiers.length) item.attrSet('data-sig', b.signifiers.join(' '));
  item.meta = { ...(item.meta ?? {}), bujo: b };
}

const CALLOUT_RE = /^\[!([\w-]+)\]([+-]?)[ \t]*(.*)$/;

function callout(tokens, i, state) {
  const open = tokens[i];
  if (tokens[i + 1]?.type !== 'paragraph_open' || tokens[i + 2]?.type !== 'inline') return;
  const inline = tokens[i + 2];
  const [first, ...rest] = inline.content.split('\n');
  const m = CALLOUT_RE.exec(first);
  if (!m) return;
  const type = m[1].toLowerCase();
  const title = m[3] || type.charAt(0).toUpperCase() + type.slice(1);
  open.attrJoin('class', `callout callout-${slugify(type)}`);
  open.attrSet('data-callout', type);
  open.meta = { ...(open.meta ?? {}), callout: { type, fold: m[2], title } };
  inline.content = rest.join('\n');
  // Find the matching close so the renderer can switch tag for foldable callouts.
  let depth = 0;
  for (let j = i; j < tokens.length; j++) {
    if (tokens[j].type === 'blockquote_open') depth++;
    if (tokens[j].type === 'blockquote_close' && --depth === 0) {
      tokens[j].meta = { ...(tokens[j].meta ?? {}), callout: open.meta.callout };
      break;
    }
  }
  if (!inline.content.trim()) {
    // Title-only callout: drop the now-empty paragraph.
    tokens[i + 1].hidden = true;
    tokens[i + 3].hidden = true;
  }
  void state;
}

// ---------------------------------------------------------------------------------------------
// [[wikilinks]] and ![[embeds]]

function wikilinkRule(state, silent) {
  const src = state.src;
  let pos = state.pos;
  const embed = src.charCodeAt(pos) === 0x21; /* ! */
  if (embed) pos++;
  if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false;
  const end = src.indexOf(']]', pos + 2);
  if (end < 0) return false;
  const inner = src.slice(pos + 2, end);
  if (!inner || inner.includes('\n') || inner.includes('[')) return false;
  if (!silent) {
    const [targetPart, ...labelParts] = inner.split('|');
    const hashAt = targetPart.indexOf('#');
    const target = (hashAt >= 0 ? targetPart.slice(0, hashAt) : targetPart).trim();
    const anchor = hashAt >= 0 ? targetPart.slice(hashAt + 1).trim() : '';
    const token = state.push('wikilink', '', 0);
    token.meta = { target, anchor, label: labelParts.join('|').trim(), embed };
    token.content = token.meta.label || target || anchor;
  }
  state.pos = end + 2;
  return true;
}

function anchorFragment(anchor) {
  if (!anchor) return '';
  if (/^L\d+$/.test(anchor)) return `#${anchor}`;
  if (anchor.startsWith('^')) return '';
  return `#${slugify(anchor)}`;
}

// ---------------------------------------------------------------------------------------------
// Render rules

function installRenderRules(md, renderer) {
  const rules = md.renderer.rules;
  const defaultRender = (tokens, idx, options, env, self) => self.renderToken(tokens, idx, options);

  rules.fence = (tokens, idx, _options, env) => {
    const t = tokens[idx];
    const lang = (t.info || '').trim().split(/\s+/)[0];
    const line = t.attrGet('data-line') ?? '';
    if (lang.toLowerCase() === 'mermaid') {
      return `<div class="mermaid-wrap" data-line="${line}"><pre class="mermaid">${escapeHtml(t.content)}</pre></div>\n`;
    }
    const html = renderer.highlight(t.content.replace(/\n$/, ''), lang);
    const label = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : '';
    return `<div class="code-block" data-line="${line}">${label}<button class="copy" type="button" aria-label="Copy code">Copy</button>${html}</div>\n`;
  };

  rules.code_block = (tokens, idx) => {
    const t = tokens[idx];
    return `<div class="code-block" data-line="${t.attrGet('data-line') ?? ''}"><button class="copy" type="button" aria-label="Copy code">Copy</button>${renderer.highlight(t.content.replace(/\n$/, ''), '')}</div>\n`;
  };

  rules.heading_open = (tokens, idx, options, env, self) => {
    const t = tokens[idx];
    const text = tokens[idx + 1]?.children?.map((c) => c.content).join('') ?? '';
    const base = slugify(text) || 'section';
    const ids = env.headingIds ?? (env.headingIds = new Map());
    const n = ids.get(base) ?? 0;
    ids.set(base, n + 1);
    const id = n ? `${base}-${n}` : base;
    t.attrSet('id', id);
    (env.toc ?? (env.toc = [])).push({ level: Number(t.tag.slice(1)), text, id });
    return self.renderToken(tokens, idx, options);
  };

  rules.heading_close = (tokens, idx, options, env, self) => {
    const id = tokens[idx - 2]?.attrGet('id');
    const anchor = id ? `<a class="anchor" href="#${id}" aria-hidden="true">#</a>` : '';
    return anchor + self.renderToken(tokens, idx, options);
  };

  rules.blockquote_open = (tokens, idx, options, env, self) => {
    const c = tokens[idx].meta?.callout;
    if (!c) return self.renderToken(tokens, idx, options);
    const attrs = self.renderAttrs(tokens[idx]);
    const title = `<span class="callout-title">${escapeHtml(c.title)}</span>`;
    if (c.fold) return `<details${attrs}${c.fold === '+' ? ' open' : ''}><summary>${title}</summary>\n`;
    return `<div${attrs}><div class="callout-head">${title}</div>\n`;
  };

  rules.blockquote_close = (tokens, idx, options, env, self) => {
    const c = tokens[idx].meta?.callout;
    if (!c) return self.renderToken(tokens, idx, options);
    return c.fold ? '</details>\n' : '</div>\n';
  };

  rules.table_open = (tokens, idx, options, env, self) =>
    `<div class="table-wrap">${self.renderToken(tokens, idx, options)}`;
  rules.table_close = (tokens, idx, options, env, self) => `${self.renderToken(tokens, idx, options)}</div>`;

  const linkOpen = rules.link_open ?? defaultRender;
  rules.link_open = (tokens, idx, options, env, self) => {
    const t = tokens[idx];
    const href = t.attrGet('href') ?? '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('mailto:')) {
      t.attrSet('target', '_blank');
      t.attrSet('rel', 'noopener noreferrer');
      t.attrJoin('class', 'external');
    } else if (env.resolveHref) {
      t.attrSet('href', env.resolveHref(href));
      t.attrJoin('class', 'internal');
    }
    return linkOpen(tokens, idx, options, env, self);
  };

  const image = rules.image;
  rules.image = (tokens, idx, options, env, self) => {
    const t = tokens[idx];
    const src = t.attrGet('src') ?? '';
    if (env.resolveHref && !/^[a-z][a-z0-9+.-]*:/i.test(src)) t.attrSet('src', env.resolveHref(src, { asset: true }));
    t.attrSet('loading', 'lazy');
    return image(tokens, idx, options, env, self);
  };

  rules.wikilink = (tokens, idx, options, env) => {
    const { target, anchor, label, embed } = tokens[idx].meta;
    const r = target ? env.resolveWikilink?.(target) : { href: '', label: '', exists: true, kind: 'self' };
    const text = label || (target ? (r?.label ?? target) : anchor);
    const frag = anchorFragment(anchor);
    if (embed && r?.exists && r.kind === 'asset' && /\.(png|jpe?g|gif|svg|webp|avif)$/i.test(target)) {
      return `<img src="${escapeHtml(r.href)}" alt="${escapeHtml(label || target)}" loading="lazy">`;
    }
    if (!r || !r.exists) {
      return `<span class="wikilink missing" title="No note named ${escapeHtml(target)} yet">${escapeHtml(text)}</span>`;
    }
    const cls = `wikilink internal${r.kind ? ` to-${r.kind}` : ''}${embed ? ' embed' : ''}`;
    return `<a class="${cls}" href="${escapeHtml(r.href + frag)}" data-preview="${escapeHtml(r.href)}">${escapeHtml(text)}</a>`;
  };
}
