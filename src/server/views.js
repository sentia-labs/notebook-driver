import { html, raw } from './html.js';
import { splitLines } from '../bujo.js';
import { periodLabel } from '../periods.js';
import { pageRanges } from '../nbindex.js';
import { TEXT_SLOT } from '../command.js';

const FOLDER_ORDER = ['inbox', 'journal', 'projects', 'areas', 'resources', 'people', 'archive'];

export function layout({ title, active = '', counts = {}, sidebar = '', main, aside = '', bodyClass = '', currentPage = null, name = 'Notebook', demo = false }) {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · ${name}</title>
<link rel="icon" href="data:image/svg+xml,${raw(encodeURIComponent(ICON))}">
<link rel="stylesheet" href="/vendor/katex/katex.min.css">
<link rel="stylesheet" href="/assets/app.css">
<script>try{var t=localStorage.getItem('nbd-theme');if(t&&t!=='auto')document.documentElement.dataset.theme=t}catch(e){}</script>
<script type="module" src="/assets/app.js"></script>
</head>
<body class="${bodyClass}" data-current-page="${currentPage ?? ''}">
<header class="topbar">
  <button class="icon-btn menu-btn" type="button" aria-label="Toggle navigation" data-action="toggle-nav">${raw(ICONS.menu)}</button>
  <a class="brand" href="/">${raw(ICONS.book)}<span>${name}</span></a>
  ${demo ? html`<a class="chip demo-chip" href="/activity#demo" title="A demo notebook: reset it any time from Activity">demo</a>` : ''}
  <form class="search" action="/search" role="search">
    <input type="search" name="q" placeholder="Search notebook &amp; vault" autocomplete="off" aria-label="Search" data-search>
    <kbd>/</kbd>
    <div class="search-results" hidden></div>
  </form>
  <nav class="top-links" aria-label="Sections">
    <a href="/notebook" class="${active === 'notebook' ? 'active' : ''}">Pages</a>
    <a href="/tasks" class="${active === 'tasks' ? 'active' : ''}">Tasks</a>
    <a href="/inbox" class="${active === 'inbox' ? 'active' : ''}">Inbox${counts.questions ? html`<span class="badge" data-count="questions">${counts.questions}</span>` : ''}</a>
    <a href="/rituals" class="${active === 'rituals' ? 'active' : ''}">Rituals${counts.rituals ? html`<span class="badge" data-count="rituals">${counts.rituals}</span>` : ''}</a>
    <a href="/ask" class="${active === 'ask' ? 'active' : ''}">Ask</a>
    <a href="/activity" class="${active === 'activity' ? 'active' : ''}">Activity</a>
  </nav>
  ${agentPill(counts.agent)}
  <button class="icon-btn" type="button" aria-label="Commands (Ctrl+K)" data-action="palette" title="Commands · Ctrl+K">${raw(ICONS.command)}</button>
  <button class="icon-btn" type="button" aria-label="Toggle theme" data-action="theme" title="Theme: auto / light / dark">${raw(ICONS.theme)}</button>
</header>
<div class="shell">
  <nav class="sidebar" aria-label="Notebook and vault">${sidebar}</nav>
  <main id="main" tabindex="-1">${main}</main>
  ${aside ? html`<aside class="aside">${aside}</aside>` : ''}
</div>
<div class="preview-pop" hidden></div>
<div class="palette" hidden role="dialog" aria-modal="true" aria-label="Commands">
  <div class="pal-box">
    <input type="text" class="pal-input" placeholder="Do something… (new page, sync, ask, review, logs)" autocomplete="off" aria-label="Command">
    <ul class="pal-list" role="listbox"></ul>
    <p class="pal-foot">Each action shows the <code>nbd</code> command that does the same in a terminal. <kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>Enter</kbd> run · <kbd>Esc</kbd> close</p>
  </div>
</div>
<div class="toasts" aria-live="polite"></div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------------------------
// Sidebar

export function sidebar(library, currentRel = '', cmd = null) {
  const pages = library.pages().reverse();
  const recent = pages.slice(0, 14);
  const notes = library.notes();
  return html`
<nav class="side-links" aria-label="Sections"><a href="/">Today</a><a href="/notebook">Pages</a><a href="/tasks">Tasks</a><a href="/inbox">Inbox</a><a href="/rituals">Rituals</a><a href="/ask">Ask</a><a href="/activity">Activity</a></nav>
<section class="side-section">
  <h2><a href="/notebook">Notebook</a><span class="count">${pages.length}</span></h2>
  <ul class="page-list">
    ${recent.map(
      (p) => html`<li><a href="${p.route}" class="${p.rel === currentRel ? 'current' : ''}">
        <span class="pnum">${p.num}</span><span class="ptopic">${p.title}</span>${gauge(p.lines, p.maxLines, { mini: true })}</a></li>`,
    )}
  </ul>
  ${pages.length > recent.length ? html`<a class="more" href="/notebook">All ${pages.length} pages →</a>` : ''}
  <a class="more" href="/key">Key: bullets &amp; signifiers</a>
  ${pages.length === 0 ? html`<p class="empty">No pages yet.</p>${cmd ? op({ label: 'Start the first page', url: '/api/pages/new', cli: cmd.newPage(), primary: true, navigate: true }) : ''}` : ''}
</section>
<section class="side-section">
  <h2><a href="/v/">Vault</a><span class="count">${notes.length}</span></h2>
  ${vaultTree(notes, currentRel)}
  ${notes.length === 0 ? html`<p class="empty">The agent hasn't written anything yet.</p>` : ''}
</section>`;
}

function vaultTree(notes, currentRel) {
  const openInbox = notes.some((n) => n.rel.startsWith('vault/inbox/') && String(n.frontmatter.status ?? 'open') === 'open');
  const root = { dirs: new Map(), files: [], openInbox };
  for (const n of notes) {
    const parts = n.rel.split('/').slice(1); // drop "vault"
    let node = root;
    for (const dir of parts.slice(0, -1)) {
      if (!node.dirs.has(dir)) node.dirs.set(dir, { dirs: new Map(), files: [], path: `${node.path ?? ''}${dir}/` });
      node = node.dirs.get(dir);
    }
    node.files.push(n);
  }
  return renderTree(root, currentRel, 0);
}

function renderTree(node, currentRel, depth, openInbox = node.openInbox) {
  const dirs = [...node.dirs.entries()].sort(([a], [b]) => folderRank(a) - folderRank(b) || a.localeCompare(b));
  const chronological = /journal|daily|weekly|monthly|quarterly|yearly|inbox/.test(node.path ?? '');
  const files = [...node.files].sort((a, b) =>
    chronological ? b.name.localeCompare(a.name) : a.title.localeCompare(b.title),
  );
  const shown = files.slice(0, 40);
  return html`<ul class="tree">
    ${dirs.map(([name, child]) => {
      const open = currentRel.startsWith(`vault/${child.path}`) || (depth === 0 && name === 'inbox' && openInbox);
      return html`<li class="dir"><details ${open ? raw('open') : ''}><summary><span>${name}</span><span class="count">${countFiles(child)}</span></summary>${renderTree(child, currentRel, depth + 1, openInbox)}</details></li>`;
    })}
    ${shown.map(
      (f) => html`<li class="file"><a href="${f.route}" class="${f.rel === currentRel ? 'current' : ''} ${statusClass(f)}" title="${f.rel}">${f.title}</a></li>`,
    )}
    ${files.length > shown.length ? html`<li class="file"><a class="more" href="/v/${node.path ?? ''}">${files.length - shown.length} more…</a></li>` : ''}
  </ul>`;
}

function statusClass(doc) {
  const s = String(doc.frontmatter?.status ?? '');
  return s ? `st-${s.toLowerCase().replace(/[^a-z-]/g, '')}` : '';
}

function folderRank(name) {
  const i = FOLDER_ORDER.indexOf(name);
  return i < 0 ? FOLDER_ORDER.length : i;
}

function countFiles(node) {
  let n = node.files.length;
  for (const c of node.dirs.values()) n += countFiles(c);
  return n;
}

export function gauge(lines, max, { mini = false } = {}) {
  const fill = Math.min(1, lines / max);
  const state = lines > max ? 'over' : lines >= max ? 'full' : lines >= max - 3 ? 'near' : '';
  return html`<span class="gauge ${mini ? 'mini' : ''} ${state}" style="--fill:${fill.toFixed(3)}" title="${lines}/${max} lines" role="img" aria-label="${lines} of ${max} lines used"><span></span></span>`;
}

// ---------------------------------------------------------------------------------------------
// Notebook page

export function pageMain({ doc, rendered, prev, next, dates, view, cmd, agentOn = false, pending = false, isLast = false }) {
  const lines = splitLines(doc.text);
  const max = doc.maxLines;
  return html`
<article class="page-view">
  <div class="page-head">
    <div>
      <div class="eyebrow">${dates?.from ? dateRange(dates.from, dates.to) : 'Undated'}</div>
      <h1 class="page-title">Page ${doc.num}</h1>
    </div>
    <div class="page-meta">
      ${gauge(doc.lines, max)}<span class="lines ${doc.overflow ? 'over' : doc.full ? 'full' : ''}">${doc.lines}/${max}</span>
      <div class="seg" role="tablist" aria-label="View">
        <a href="?view=rendered" class="${view === 'rendered' ? 'on' : ''}" role="tab">Page</a>
        <a href="?view=source" class="${view === 'source' ? 'on' : ''}" role="tab">Lines</a>
      </div>
    </div>
  </div>
  ${doc.overflow ? html`<p class="flash warn">This page runs ${doc.overflow} line${doc.overflow > 1 ? 's' : ''} past the ${max}-line limit. Move the extra lines to the next page.</p>` : ''}
  ${doc.full && !doc.overflow && isLast ? html`<p class="flash">Page full: time to turn the page.</p>` : ''}
  <div class="actions">
    ${op({ label: 'Open in editor', url: `/api/pages/${doc.name}/edit`, cli: cmd.edit(doc.name), primary: !doc.full })}
    ${isLast ? op({ label: 'New page', url: '/api/pages/new', cli: cmd.newPage(), navigate: true, primary: doc.full }) : ''}
    ${pending ? op({ label: 'Ingest this page now', url: '/api/sync', body: { pages: [doc.name] }, cli: cmd.sync([doc.name]), agent: true, agentOn, hint: 'Changed since the agent last read it' }) : ''}
  </div>
  <div class="paper ${view === 'source' ? 'paper-source' : ''}">
    ${view === 'source'
      ? html`<ol class="source">${lines.map(
          (l, i) => html`<li id="L${i + 1}" class="${i + 1 > max ? 'over' : ''}${i + 1 === max ? ' last' : ''}"><a href="#L${i + 1}" class="ln" aria-hidden="true">${i + 1}</a><span>${l || ' '}</span></li>`,
        )}${lines.length < max ? Array.from({ length: max - lines.length }, (_, i) => html`<li class="blank" aria-hidden="true"><span class="ln">${lines.length + i + 1}</span><span> </span></li>`) : ''}</ol>`
      : html`<div class="md md-notebook">${raw(rendered)}</div>`}
    <div class="page-foot"><span>${doc.name}</span><span>${doc.num}</span></div>
  </div>
  <nav class="pager" aria-label="Pages">
    ${prev ? html`<a href="${prev.route}" rel="prev" data-key="[">← ${prev.num} · ${prev.title}</a>` : html`<span></span>`}
    ${next ? html`<a href="${next.route}" rel="next" data-key="]">${next.num} · ${next.title} →</a>` : html`<span></span>`}
  </nav>
</article>`;
}

export function pageAside({ doc, derived, backlinks, stats }) {
  const others = backlinks.filter((b) => !derived.some((d) => d.rel === b.rel));
  return html`
<section class="panel">
  <h3>In the vault</h3>
  ${derived.length
    ? html`<ul class="link-list">${derived.map((d) => html`<li><a href="${d.route}" data-preview="${d.route}">${d.title}</a><span class="type">${d.type}</span></li>`)}</ul>`
    : html`<p class="muted">Nothing derived from this page yet.</p>`}
</section>
${others.length ? html`<section class="panel"><h3>Mentioned in</h3><ul class="link-list">${others.map((d) => html`<li><a href="${d.route}" data-preview="${d.route}">${d.title}</a></li>`)}</ul></section>` : ''}
<section class="panel">
  <h3>On this page</h3>
  <dl class="stats">
    ${stats.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}
  </dl>
  <p class="muted small"><code>${doc.rel}</code></p>
</section>
${keyPanel()}`;
}

// The Bullet Journal key at a glance, next to the page: glyph as the viewer shows it, what to type.
const KEY_ROWS = [
  ['Bullets', [
    ['•', 'g-task', '- [ ]', 'task'],
    ['○', 'g-event', '- o', 'event'],
    ['=', 'g-mood', '- =', 'mood'],
    ['–', 'g-note', '-', 'note'],
  ]],
  ['Task states', [
    ['×', 'g-done', '[x]', 'done'],
    ['⁄', 'g-task', '[/]', 'started or handed off'],
    ['>', 'g-migrated', '[>]', 'migrated'],
    ['<', 'g-scheduled', '[<]', 'scheduled (future log)'],
    ['•', 'g-irrelevant', '[-]', 'no longer relevant'],
  ]],
  ['Signifiers', [
    ['*', 'sig-priority', '- [ ] * …', 'priority'],
    ['!', 'sig-inspiration', '- ! …', 'inspiration, an idea'],
    ['?', 'sig-explore', '- ? …', 'explore, look into'],
    ['+', 'sig-explore', '- + …', 'expand later'],
  ]],
];

function keyPanel() {
  return html`
<details class="panel key-panel" open data-remember="key-panel">
  <summary><h3>Key</h3></summary>
  ${KEY_ROWS.map(([title, rows]) => html`<h4>${title}</h4>
  <dl class="key-legend">${rows.map(([glyph, cls, typed, meaning]) => html`<div><dt class="${cls}" aria-hidden="true">${glyph}</dt><dd>${meaning}<code>${typed}</code></dd></div>`)}</dl>`)}
  <p class="muted small">Signifiers go after the bullet, with a space: <code>- o * party</code>. <a href="/key">Full key →</a></p>
</details>`;
}

export function notebookMain(pages, parsedByName, index = [], cmd) {
  const groups = new Map();
  for (const p of [...pages].reverse()) {
    const d = parsedByName.get(p.name)?.dates;
    const key = d?.to ? d.to.slice(0, 7) : d?.months?.length ? d.months[d.months.length - 1] : 'Undated';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ p, d });
  }
  return html`
<div class="list-head"><h1>Pages</h1><p class="muted">${pages.length} pages · newest first</p></div>
<form class="op-form inline-form" data-op="/api/pages/new" data-navigate>
  <input type="text" name="topic" placeholder="Topic for a collection page (optional; default: today's date)" maxlength="120">
  <button type="submit" class="primary">New page</button>
</form>
${pages.length === 0 ? html`<p class="empty">No pages yet.</p>` : ''}
${index.length ? html`<section class="nb-index" aria-label="Index"><h2>Index</h2>
  ${index.map((g) => html`<div class="nbi-group">${g.section ? html`<h3>${g.section}</h3>` : ''}<ul>${g.entries.map((e) => html`<li><a href="/n/p${String(e.first).padStart(4, '0')}">${e.label}</a><span class="nbi-pages">${pageRanges(e.pages)}</span></li>`)}</ul></div>`)}
</section>` : ''}
${[...groups.entries()].map(
  ([key, items]) => html`<section class="month-group">
  <h2>${key === 'Undated' ? key : periodLabel('monthly', key)}</h2>
  <div class="page-grid">
    ${items.map(
      ({ p, d }) => html`<a class="page-card" href="${p.route}">
      <div class="pc-top"><span class="pnum">${p.num}</span>${gauge(p.lines, p.maxLines)}</div>
      <div class="pc-title">${p.title}</div>
      ${d?.from ? html`<div class="pc-dates">${dateRange(d.from, d.to)}</div>` : ''}
      <div class="pc-lines">${splitLines(p.text).slice(1, 6).join('\n')}</div>
    </a>`,
    )}
  </div>
</section>`,
)}`;
}

// ---------------------------------------------------------------------------------------------
// Vault note

export function noteMain({ doc, rendered, crumbs }) {
  const fm = doc.frontmatter ?? {};
  const hasH1 = /^#\s/m.test(doc.body);
  return html`
<article class="note-view">
  <nav class="crumbs" aria-label="Breadcrumb">${crumbs.map((c, i) => html`${i ? html`<span>/</span>` : ''}<a href="${c.href}">${c.label}</a>`)}</nav>
  <div class="chips">
    ${doc.type ? html`<span class="chip type-${doc.type}">${doc.type}</span>` : ''}
    ${fm.status ? html`<span class="chip status">${fm.status}</span>` : ''}
    ${fm.review ? html`<span class="chip status">review: ${fm.review}</span>` : ''}
    ${doc.tags.map((t) => html`<a class="chip tag" href="/search?q=%23${encodeURIComponent(t)}">#${t}</a>`)}
    ${fm.updated ? html`<span class="muted small">updated ${String(fm.updated)}</span>` : ''}
  </div>
  ${doc.frontmatterError ? html`<p class="flash warn">Frontmatter didn't parse: ${doc.frontmatterError}</p>` : ''}
  ${hasH1 ? '' : html`<h1>${doc.title}</h1>`}
  <div class="md">${raw(rendered)}</div>
</article>`;
}

export function noteAside({ doc, sources, backlinks, toc, propsHtml }) {
  return html`
${sources.length ? html`<section class="panel"><h3>From the notebook</h3><div class="source-chips">${sources.map((s) => html`<a class="page-chip" href="${s.route}" data-preview="${s.route}" title="${s.title}"><b>p.${s.num}</b> ${s.title}</a>`)}</div></section>` : ''}
${toc.length > 2 ? html`<section class="panel"><h3>Contents</h3><ul class="toc">${toc.filter((t) => t.level <= 3).map((t) => html`<li class="l${t.level}"><a href="#${t.id}">${t.text}</a></li>`)}</ul></section>` : ''}
<section class="panel"><h3>Backlinks</h3>
${backlinks.length ? html`<ul class="link-list">${backlinks.map((b) => html`<li><a href="${b.route}" data-preview="${b.route}">${b.kind === 'page' ? `p.${b.num} · ${b.title}` : b.title}</a></li>`)}</ul>` : html`<p class="muted">No backlinks.</p>`}
</section>
${propsHtml ? html`<section class="panel"><details><summary>Properties</summary>${raw(propsHtml)}</details></section>` : ''}
<p class="muted small"><code>${doc.rel}</code></p>`;
}

export function folderMain({ folder, notes, crumbs }) {
  const chronological = /journal|inbox/.test(folder);
  const sorted = [...notes].sort((a, b) => (chronological ? b.name.localeCompare(a.name) : a.title.localeCompare(b.title)));
  return html`
<nav class="crumbs" aria-label="Breadcrumb">${crumbs.map((c, i) => html`${i ? html`<span>/</span>` : ''}<a href="${c.href}">${c.label}</a>`)}</nav>
<div class="list-head"><h1>${folder || 'Vault'}</h1><p class="muted">${notes.length} notes</p></div>
<ul class="card-list">
  ${sorted.map(
    (n) => html`<li><a href="${n.route}" data-preview="${n.route}"><span class="cl-title">${n.title}</span><span class="chip type-${n.type}">${n.type}</span>${n.frontmatter?.status ? html`<span class="chip status">${n.frontmatter.status}</span>` : ''}</a>
    ${n.description ? html`<p>${n.description}</p>` : ''}<span class="muted small">${n.rel.slice(6)} · ${new Date(n.mtime).toLocaleString()}</span></li>`,
  )}
</ul>`;
}

// ---------------------------------------------------------------------------------------------
// Search, inbox, tasks, rituals, home

export function searchMain({ q, results }) {
  return html`
<div class="list-head"><h1>Search</h1><p class="muted">${results.length} result${results.length === 1 ? '' : 's'} for “${q}” · filters: <code>in:notebook</code> <code>in:vault</code> <code>type:project</code> <code>#tag</code></p></div>
<ul class="card-list">
  ${results.map(
    (r) => html`<li><a href="${r.doc.route}" data-preview="${r.doc.route}"><span class="cl-title">${r.doc.kind === 'page' ? `p.${r.doc.num} · ` : ''}${r.doc.title}</span><span class="chip type-${r.doc.type}">${r.doc.type}</span></a>
    <p>${highlightSnippet(r.snippet)}</p><span class="muted small">${r.doc.rel}</span></li>`,
  )}
</ul>`;
}

export function highlightSnippet({ text, marks }) {
  if (!marks?.length) return text;
  const re = new RegExp(`(${marks.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  const parts = text.split(re);
  return parts.map((p, i) => (i % 2 ? html`<mark>${p}</mark>` : p));
}

export function inboxMain({ open, answered, closed, renderQuestion, cmd, agentOn = false }) {
  return html`
<div class="list-head"><h1>Inbox</h1><p class="muted">Questions your notebook agent couldn't settle alone. Answers go to the agent on its next run, about a minute later. You can also answer in nvim (<code>:NotebookQuestions</code>) or by writing <code>q7: …</code> on a page.</p></div>
${open.length === 0 ? html`<p class="empty">No open questions. 🎉</p>` : ''}
${open.map(
  (q) => html`<article class="question" id="${q.id}">
  <header><span class="qid">${q.id}</span><h2>${q.title}</h2>${q.asked ? html`<span class="muted small">asked ${q.asked.slice(0, 16).replace('T', ' ')}</span>` : ''}</header>
  <div class="md">${raw(renderQuestion(q))}</div>
  <form class="answer-form" data-qid="${q.id}">
    ${q.options.length ? html`<div class="options">${q.options.map((o) => html`<button type="button" class="opt" data-fill="${o}">${o}</button>`)}</div>` : ''}
    <textarea name="answer" rows="3" placeholder="Your answer…" required></textarea>
    <div class="row"><button type="submit" class="primary">Answer</button><button type="button" class="ghost" data-dismiss="${q.id}" data-cli="${cmd.dismiss(q.id)}" title="${cmd.dismiss(q.id)}">Dismiss</button><span class="form-msg" role="status"></span></div>
  </form>
</article>`,
)}
${answered.length ? html`<section class="panel-section"><h2>Waiting for the agent</h2>${op({ label: 'Apply answers now', url: '/api/sync', cli: cmd.sync(), agent: true, agentOn, hint: 'Instead of waiting for the next run' })}<ul class="card-list">${answered.map((q) => html`<li><a href="/v/inbox/${q.id}">${q.id} · ${q.title}</a><p>${q.answer}</p></li>`)}</ul></section>` : ''}
${closed.length ? html`<section class="panel-section"><details><summary>Resolved (${closed.length})</summary><ul class="card-list">${closed.map((q) => html`<li><a href="/v/inbox/${q.id}">${q.id} · ${q.title}</a><span class="chip status">${q.status}</span></li>`)}</ul></details></section>` : ''}`;
}

const GLYPH = { open: '•', started: '/', done: '×', migrated: '>', scheduled: '<', irrelevant: '–' };

export function tasksMain({ groups, counts, now }) {
  return html`
<div class="list-head"><h1>Open tasks</h1><p class="muted">Read straight from your pages. Migration is yours to do by hand: rewrite what still matters (<code>[&gt;]</code>), schedule it (<code>[&lt;]</code>) or strike it (<code>[-]</code>).</p></div>
<dl class="stats inline">${counts.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
${groups.length === 0 ? html`<p class="empty">No open tasks.</p>` : ''}
${groups.map(
  (g) => html`<section class="task-group"><h2>${g.title}<span class="count">${g.tasks.length}</span></h2>
  <ul class="task-list">${g.tasks.map(
    (t) => html`<li class="t-row t-${t.state}" data-sig="${t.signifiers.join(' ')}">
      <span class="glyph">${GLYPH[t.state]}</span><span class="t-text">${t.text}</span>
      <a class="t-ref" href="/n/${t.page}#L${t.line}" data-preview="/n/${t.page}">p.${Number(t.page.slice(1))}:${t.line}</a>
      ${t.age != null && t.age >= 0 ? html`<span class="age ${t.age > 30 ? 'old' : t.age > 7 ? 'aging' : ''}" title="logged ${t.age} days ago">${t.age}d</span>` : html`<span class="age"></span>`}
    </li>`,
  )}</ul></section>`,
)}
<p class="muted small">As of ${now.toLocaleString()}.</p>`;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : Math.round(((s[s.length / 2 - 1] + s[s.length / 2]) / 2) * 10) / 10) : null;
};

export function ritualsMain({ rituals, history, runs = [], cmd, agentOn = false, open = [] }) {
  const convFor = (r) => open.find((c) => c.meta?.ritual === r.kind && c.meta?.period === r.period);
  const timing = (kind) => {
    const done = runs.filter((x) => x.kind === kind && x.done);
    return done.length ? html`<p class="small muted">Median ${median(done.map((x) => x.activeMinutes))} min over ${done.length} finished review${done.length === 1 ? '' : 's'} · target 5</p>` : '';
  };
  return html`
<div class="list-head"><h1>Rituals</h1><p class="muted">Five-minute reviews: the agent proposes a migration, you correct it and write it by hand. Run one here or in a terminal; it counts as done when the periodic note says <code>review: done</code>.</p></div>
<div class="ritual-grid">
${rituals.map((r) => {
  const conv = convFor(r);
  return html`<article class="ritual ${r.due ? 'due' : r.done ? 'done' : ''}">
  <header><h2>${r.title}</h2><span class="chip ${r.due ? 'warn' : 'ok'}">${r.due ? 'due' : r.done ? 'done' : r.active ? 'upcoming' : 'nothing to review'}</span></header>
  <p class="r-period">${r.label}</p>
  ${timing(r.kind)}
  ${!r.due && !r.done && r.upcoming ? html`<p class="small muted">Next: ${r.upcoming.label} — opens ${new Date(r.upcoming.availableAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>` : ''}
  ${conv
    ? html`<div class="op"><a class="button primary" href="/c/${conv.id}">Continue the review</a></div>`
    : op({ label: r.done ? 'Review again' : 'Start the review', url: `/api/rituals/${r.kind}/start`, body: { period: r.period }, cli: cmd.ritual(r.kind, r.period), primary: r.due, agent: true, agentOn, navigate: true })}
  <p class="small"><a href="/rituals/${r.kind}/${r.period}/context">What the agent will bring</a> · <a href="/v/${r.note.slice(6, -3)}">${r.period} note</a> · previous: <a href="/v/${r.previous.note.slice(6, -3)}">${r.previous.period}</a> ${r.previous.done ? '✓' : ''}</p>
</article>`;
})}
</div>
${runs.length ? html`<section class="panel-section"><h2>Timings</h2><p class="small muted">Measured by nbd. Active time leaves out pauses over 15 minutes; a terminal run only has the wall clock.</p>
<div class="op"><span class="op-label">From a terminal</span>${cli(cmd.ritualRuns())}</div>
<div class="md"><div class="table-wrap"><table><thead><tr><th>Started</th><th>Review</th><th>Via</th><th>Active min</th><th>Agent</th><th>You</th><th>Replies</th><th>Cost</th><th>Done</th></tr></thead><tbody>
${runs.slice(0, 50).map((x) => html`<tr><td>${new Date(x.startedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td><td>${x.kind} ${x.period}</td><td>${x.via}</td><td>${x.activeMinutes}</td><td>${x.agentMinutes ?? '–'}</td><td>${x.yourMinutes ?? '–'}</td><td>${x.replies ?? '–'}</td><td>${x.costUsd != null ? `$${x.costUsd.toFixed(2)}` : '–'}</td><td>${x.done ? '✓' : ''}</td></tr>`)}
</tbody></table></div></div></section>` : ''}
${history.length ? html`<section class="panel-section"><h2>Past reviews</h2><ul class="card-list">${history.map((h) => html`<li><a href="${h.route}">${h.title}</a><span class="chip">${h.type}</span>${h.description ? html`<p>${h.description}</p>` : ''}</li>`)}</ul></section>` : ''}`;
}

export function ritualContextMain({ kind, period, title, rendered, cmd, agentOn }) {
  return html`
<nav class="crumbs"><a href="/rituals">rituals</a><span>/</span><span>${kind} ${period}</span></nav>
<div class="list-head"><h1>${title} · ${period}</h1><p class="muted">The facts the agent starts the review from, read straight from your pages. Nothing here is sent anywhere until you start.</p></div>
<div class="actions">
  ${op({ label: 'Start the review', url: `/api/rituals/${kind}/start`, body: { period }, cli: cmd.ritual(kind, period), primary: true, agent: true, agentOn, navigate: true })}
  <div class="op"><span class="op-label">This page from a terminal</span>${cli(cmd.ritualContext(kind, period))}</div>
</div>
<article class="note-view"><div class="md">${raw(rendered)}</div></article>`;
}

export function homeMain({ current, rendered, questions, rituals, openTasks, recent, lastRun, cmd, agentOn = false, pending = [] }) {
  return html`
<div class="home-grid">
  <section class="home-current">
    ${current
      ? html`<div class="eyebrow">Current page</div>
    <a class="home-page-link" href="${current.route}"><h1>${current.num} · ${current.title}</h1></a>
    <div class="page-meta">${gauge(current.lines, current.maxLines)}<span class="lines">${current.lines}/${current.maxLines} lines${current.full ? ' · full' : ''}</span></div>
    <div class="actions">
      ${op({ label: 'Open in editor', url: `/api/pages/${current.name}/edit`, cli: cmd.edit(current.name), primary: !current.full })}
      ${op({ label: 'New page', url: '/api/pages/new', cli: cmd.newPage(), navigate: true, primary: current.full })}
    </div>
    <div class="paper compact"><div class="md md-notebook">${raw(rendered)}</div></div>`
      : html`<h1>Welcome</h1><p>No pages yet.</p>${op({ label: 'Start the first page', url: '/api/pages/new', cli: cmd.newPage(), primary: true, navigate: true })}`}
  </section>
  <section class="home-side">
    <div class="tile ${pending.length ? 'attn' : ''}">
      <h3>Agent</h3>
      <p class="small">${!agentOn ? 'Off: this viewer was started with nbd serve.' : pending.length ? `${pending.length} page${pending.length > 1 ? 's' : ''} waiting: ${pending.join(', ')}` : 'Up to date.'}</p>
      ${op({ label: 'Sync now', url: '/api/sync', cli: cmd.sync(), agent: true, agentOn })}
      <p class="small"><a href="/ask">Ask your second brain →</a> · <a href="/activity">Activity →</a></p>
    </div>
    <div class="tile ${questions ? 'attn' : ''}"><a href="/inbox"><span class="big">${questions}</span> open question${questions === 1 ? '' : 's'}</a></div>
    <div class="tile"><a href="/tasks"><span class="big">${openTasks}</span> open task${openTasks === 1 ? '' : 's'}</a></div>
    ${rituals.filter((r) => r.due).map((r) => html`<div class="tile attn"><b>${r.title}</b> is due<p class="small">${r.label}</p>${op({ label: 'Start the review', url: `/api/rituals/${r.kind}/start`, body: { period: r.period }, cli: cmd.ritual(r.kind, r.period), primary: true, agent: true, agentOn, navigate: true })}</div>`)}
    ${lastRun ? html`<div class="tile"><div class="small muted">Last agent run · ${new Date(lastRun.startedAt).toLocaleString()}</div><p class="small">${lastRun.status === 'ok' ? lastRun.summaryLine ?? 'ok' : html`<span class="warn-text">${lastRun.status}: ${lastRun.error ?? ''}</span>`}</p></div>` : ''}
    <div class="tile"><h3>Recently updated in the vault</h3><ul class="link-list">${recent.map((n) => html`<li><a href="${n.route}" data-preview="${n.route}">${n.title}</a><span class="type">${n.type}</span></li>`)}</ul>${recent.length ? '' : html`<p class="muted small">Nothing yet.</p>`}</div>
  </section>
</div>`;
}

export function keyMain(rendered) {
  return html`<article class="note-view"><div class="md md-notebook">${raw(rendered)}</div></article>`;
}

export function notFoundMain(what) {
  return html`<div class="list-head"><h1>Not found</h1><p class="muted">${what}</p></div>`;
}

export function propsTable(data, renderValue) {
  const entries = Object.entries(data);
  if (!entries.length) return '';
  return html`<table class="props">${entries.map(([k, v]) => html`<tr><th>${k}</th><td>${raw(renderValue(v))}</td></tr>`)}</table>`;
}

function dateRange(from, to) {
  const f = new Date(`${from}T12:00:00`);
  const t = new Date(`${to}T12:00:00`);
  const opts = { month: 'short', day: 'numeric' };
  if (from === to) return f.toLocaleDateString('en-US', { weekday: 'short', ...opts, year: 'numeric' });
  return `${f.toLocaleDateString('en-US', opts)} – ${t.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;
}

// ---------------------------------------------------------------------------------------------
// Actions: every button carries the command that does the same from a terminal.

/** A copyable command line (for places with no button of their own). */
export function cli(command) {
  if (!command) return '';
  return html`<div class="cli"><span class="cli-p" aria-hidden="true">$</span><code>${command}</code><button type="button" class="cli-copy" data-copy="${command}" title="Copy the command">Copy</button></div>`;
}

/** A button that POSTs to the viewer's API; its answer names the CLI command, shown in a toast. */
export function op({ label, url, body = null, cli: command, primary = false, agent = false, agentOn = true, navigate = false, hint = '', confirm = '' }) {
  const off = agent && !agentOn;
  return html`<div class="op">
  <button type="button" class="${primary ? 'primary' : 'ghost'}" data-op="${url}" data-body="${body ? JSON.stringify(body) : ''}" data-confirm="${confirm}" ${navigate ? raw('data-navigate') : ''} ${off ? raw('disabled') : ''} title="${off ? `Agent actions are off: the viewer was started with nbd serve. In a terminal: ${command}` : hint ? `${hint} · ${command}` : command}">${label}</button>
</div>`;
}

function agentPill(a) {
  if (!a) return '';
  const state = !a.on ? 'off' : a.running ? 'busy' : a.pending ? 'pending' : 'idle';
  const text = { off: 'Agent off', busy: 'Agent working…', pending: `${a.pending} pending`, idle: 'Agent idle' }[state];
  return html`<a class="agent-pill ${state}" href="/activity" data-agent-pill title="Background agent · ingest ${a.mode}"><span class="dot"></span><span class="ap-text">${text}</span></a>`;
}

const KIND_LABEL = { ask: 'question', ritual: 'review', lint: 'clean-up' };

function convList(convs) {
  return html`<ul class="card-list conv-list">${convs.map(
    (c) => html`<li><a href="/c/${c.id}"><span class="cl-title">${c.title}</span><span class="chip">${KIND_LABEL[c.kind] ?? c.kind}</span>${c.meta?.closed ? html`<span class="chip status">closed</span>` : ''}</a>
    <span class="muted small">${new Date(c.updatedAt).toLocaleString()} · ${c.turns.length} message${c.turns.length === 1 ? '' : 's'}${c.costUsd ? ` · $${c.costUsd.toFixed(2)}` : ''}</span></li>`,
  )}</ul>`;
}

export function askMain({ recent, cmd, agentOn }) {
  return html`
<div class="list-head"><h1>Ask your second brain</h1><p class="muted">The agent answers from the vault and your pages, citing them, and can't change anything. Follow-up questions continue the same conversation.</p></div>
<form class="op-form ask-form" data-op="/api/ask" data-navigate>
  <textarea name="question" rows="3" placeholder="What did I decide about the auth migration? What's still open with Priya?" required data-enter-sends ${agentOn ? '' : raw('disabled')}></textarea>
  <div class="row"><button type="submit" class="primary" ${agentOn ? '' : raw('disabled')}>Ask</button><span class="muted small key-hint"><kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line</span><span class="form-msg" role="status">${agentOn ? '' : 'Agent actions are off: the viewer was started with nbd serve.'}</span></div>
</form>
${recent.length ? html`<section class="panel-section"><h2>Conversations</h2>${convList(recent)}</section>` : ''}`;
}

export function conversationMain({ conv, turns, busy, job, cli: c, agentOn, note, cmd }) {
  const closed = Boolean(conv.meta?.closed);
  return html`
<div class="convo" data-conv="${conv.id}">
  <nav class="crumbs"><a href="${conv.kind === 'ritual' ? '/rituals' : conv.kind === 'ask' ? '/ask' : '/activity'}">${conv.kind === 'ritual' ? 'rituals' : conv.kind === 'ask' ? 'ask' : 'activity'}</a><span>/</span><span>${KIND_LABEL[conv.kind] ?? conv.kind}</span></nav>
  <div class="list-head"><h1>${conv.title}</h1>
    <p class="muted small">${conv.purpose === 'ask' ? 'Read-only' : 'May write in vault/ (never your pages)'} · ${conv.harness}${conv.costUsd ? ` · $${conv.costUsd.toFixed(2)} so far` : ''}</p></div>
  ${note ? html`<p class="flash">Writing <a href="${note.route}">${note.title}</a>${note.frontmatter?.review ? html` · review: <b>${String(note.frontmatter.review)}</b>` : ''}</p>` : ''}
  <ol class="turns">
    ${turns.map((t) => html`<li class="turn ${t.role} ${t.ok === false ? 'failed' : ''}"><div class="who">${t.role === 'human' ? 'You' : 'Agent'}<span class="muted small">${new Date(t.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${t.costUsd ? ` · $${t.costUsd.toFixed(3)}` : ''}</span></div><div class="md">${raw(t.html)}</div></li>`)}
    ${busy ? html`<li class="turn agent working" data-progress="${conv.id}"><div class="who">Agent<span class="spinner" aria-hidden="true"></span><span class="muted small" data-elapsed="${job?.startedAt ?? ''}"></span></div><ol class="steps">${(job?.events ?? []).map((e) => html`<li class="step ${e.kind}">${e.text}</li>`)}</ol></li>` : ''}
  </ol>
  ${closed
    ? html`<p class="muted">This conversation is closed.</p>`
    : html`<form class="op-form reply-form" data-op="/api/conversations/${conv.id}/reply" data-reset>
    <textarea name="text" rows="3" placeholder="${busy ? 'The agent is replying…' : 'Reply…'}" required data-enter-sends ${agentOn ? '' : raw('disabled')}></textarea>
    <div class="row"><button type="submit" class="primary" ${busy || !agentOn ? raw('disabled') : ''}>Send</button>
      <button type="button" class="ghost" data-op="/api/conversations/${conv.id}/close" data-reload>Close conversation</button>
      <span class="muted small key-hint"><kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line</span>
      <span class="form-msg" role="status"></span></div>
  </form>`}
  <section class="panel-section cli-panel">
    <h2>From a terminal</h2>
    ${c.start ? html`<p class="small muted">Start the same thing:</p>${cli(c.start)}` : ''}
    ${c.resume ? html`<p class="small muted">Pick up this exact conversation:</p>${cli(c.resume)}` : ''}
    ${c.reply ? html`<p class="small muted">Reply from a terminal:</p>${cli(c.reply.replace(TEXT_SLOT, "'…'"))}` : ''}
  </section>
</div>`;
}

export function activityMain({ agent, jobs, pending, runs, issues, logLevel, logFile, conversations, cmd, demo = null }) {
  const ago = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return html`
<div class="list-head"><h1>Activity</h1><p class="muted">What the agent is doing and has done, the vault's health, and the log.</p></div>
${demo ? html`<section class="act-section demo-section" id="demo">
  <h2>Demo notebook</h2>
  <p class="small">A working copy of <code>${demo.seed}</code>, run exactly like your own notebook: same daemon, agent, viewer and files. Try anything; reset puts it back. The log is kept across resets.</p>
  <div class="actions">
    ${op({ label: 'Reset the demo', url: '/api/demo/reset', cli: cmd.demoReset(), confirm: 'Reset the demo? Its pages, vault, questions and conversations go back to the seed.', hint: "The seed's pages, and the vault built from them" })}
    ${op({ label: 'Reset to pages only', url: '/api/demo/reset', body: { fresh: true }, cli: cmd.demoReset(true), confirm: 'Reset the demo to pages only? The vault is emptied and the agent rebuilds it on its next run.', hint: 'Empty vault: watch the first ingest build it' })}
  </div>
</section>` : ''}

<section class="act-section" id="agent">
  <h2>Agent</h2>
  <p class="small">${agent.on
    ? html`Ingest is <b>${agent.mode}</b>${agent.mode === 'auto' ? html`: a changed page is read ${Math.round(agent.idleSeconds / 60)} min after you stop editing it (sooner once it's full or you turn the page)` : ': it only runs when you ask'} · ${agent.harness}${agent.model ? ` / ${agent.model}` : ''}`
    : html`<b>Off.</b> This viewer was started with <code>nbd serve</code>, which never runs the agent.`}</p>
  ${agent.on ? '' : cli(cmd.daemon())}
  <div class="jobs" data-jobs></div>
  <div class="actions">${op({ label: 'Sync now', url: '/api/sync', cli: cmd.sync(), primary: pending.length > 0, agent: true, agentOn: agent.on, hint: 'Ingest every changed page and apply answered questions' })}</div>
  <h3>Waiting to be read</h3>
  ${pending.length
    ? html`<ul class="pending-list">${pending.map((p) => html`<li><a href="/n/${p.id}">${p.id}</a><span class="chip">${p.status}</span><span class="muted small">${p.lines} lines</span>${op({ label: 'Ingest now', url: '/api/sync', body: { pages: [p.id] }, cli: cmd.sync([p.id]), agent: true, agentOn: agent.on })}${op({ label: 'Skip', url: '/api/sync/skip', body: { pages: [p.id] }, cli: cmd.skip([p.id]), hint: 'Mark as read without running the agent (e.g. a typo fix)' })}</li>`)}</ul>`
    : html`<p class="muted small">Nothing: the vault is up to date with your pages.</p>`}
  <details id="prompt" class="prompt-preview"><summary>Preview what the agent would be told</summary>
    <div class="actions"><button type="button" class="ghost" data-load-prompt data-cli="${cmd.syncPreview()}">Load the prompt</button></div>
    <pre class="prompt-text" hidden></pre>
  </details>
</section>

<section class="act-section" id="runs">
  <h2>Recent runs</h2>
  ${runs.length
    ? html`<ul class="run-list">${runs.map(
        (r) => html`<li class="run ${r.status}"><details><summary><span class="chip ${r.status === 'ok' ? 'ok' : 'warn'}">${r.status}</span><span class="run-what">${r.summaryLine ?? r.error ?? r.reason}</span><span class="muted small">${ago(r.startedAt)}${r.durationMs ? ` · ${Math.round(r.durationMs / 1000)}s` : ''}${r.costUsd != null ? ` · $${r.costUsd.toFixed(3)}` : ''}</span></summary>
      <dl class="stats inline small"><div><dt>Why</dt><dd>${r.reason}</dd></div><div><dt>Pages</dt><dd>${(r.pages ?? []).join(', ') || '—'}</dd></div><div><dt>Answers</dt><dd>${(r.answered ?? []).join(', ') || '—'}</dd></div><div><dt>Model</dt><dd>${r.model ?? r.harness}</dd></div></dl>
      ${r.changes ? html`<p class="small">${[...r.changes.created.map((x) => ['new', x]), ...r.changes.updated.map((x) => ['updated', x]), ...r.changes.deleted.map((x) => ['deleted', x])].map(([k, x]) => html`<span class="change ${k}">${k === 'deleted' ? x : html`<a href="/v/${x.slice(0, -3)}">${x.slice(0, -3)}</a>`}</span> `)}</p>` : ''}
      ${r.summary ? html`<pre class="run-summary">${r.summary}</pre>` : ''}
      ${r.error ? html`<p class="warn-text small">${r.error}</p>` : ''}
    </details></li>`,
      )}</ul>`
    : html`<p class="muted small">No runs yet.</p>`}
  ${conversations.length ? html`<h3>Conversations</h3>${convList(conversations)}` : ''}
</section>

<section class="act-section" id="health">
  <h2>Vault health</h2>
  ${issues.length
    ? html`<ul class="issue-list">${issues.slice(0, 60).map((i) => html`<li class="${i.level}"><span class="chip ${i.level === 'error' ? 'warn' : ''}">${i.level}</span><a href="/v/${i.rel.slice(6, -3)}">${i.rel.slice(6)}</a> <span class="small">${i.message.split('\n')[0]}</span></li>`)}</ul>`
    : html`<p class="small">No broken links, misquoted citations or missing sources.</p>`}
  ${cli(cmd.lint())}
  <div class="actions">
    ${op({ label: 'Clean up with the agent', url: '/api/lint/fix', cli: cmd.lintFix(), agent: true, agentOn: agent.on, navigate: true, hint: 'Fixes these, then looks for contradictions and stale notes with you' })}
    ${op({ label: 'Rebuild the index', url: '/api/index', cli: cmd.index(), hint: 'vault/index.md from frontmatter' })}
  </div>
</section>

<section class="act-section" id="logs">
  <h2>Log</h2>
  <div class="log-bar">
    <label class="small">Show <select data-log-level><option value="debug">everything</option><option value="info" ${logLevel === 'info' ? raw('selected') : ''}>info and up</option><option value="warn">warnings and errors</option><option value="error">errors</option></select></label>
    <span class="muted small">${logFile ?? ''}${logLevel === 'debug' ? '' : ` · recording ${logLevel} and up`}</span>
  </div>
  <pre class="log-tail" data-log-tail tabindex="0"></pre>
  <div class="cli-swap" data-log-cli data-variants="${JSON.stringify(Object.fromEntries(['debug', 'info', 'warn', 'error'].map((l) => [l, cmd.logs(l === 'debug' ? null : l)])))}">${cli(cmd.logs(logLevel === 'debug' ? null : logLevel))}</div>
</section>

<section class="act-section" id="setup">
  <h2>Setup checks</h2>
  <div class="actions"><button type="button" class="ghost" data-run-doctor data-cli="${cmd.doctor()}">Run the checks</button></div>
  <ul class="checks" data-checks></ul>
  <p class="small muted">The one-screen summary: ${cli(cmd.status())}</p>
</section>`;
}

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="6" y="3" width="21" height="26" rx="3" fill="#2f5d50"/><rect x="9" y="3" width="2" height="26" fill="#c9a227"/><path d="M14 10h9M14 15h9M14 20h6" stroke="#f4efe2" stroke-width="2" stroke-linecap="round"/></svg>`;

const ICONS = {
  book: `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/><path stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M9 7.5h6M9 11h6"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M4 7h16M4 12h16M4 17h16"/></svg>`,
  command: `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M5 7l5 5-5 5M12 17h7"/></svg>`,
  theme: `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>`,
};
