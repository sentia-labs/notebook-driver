// Notebook viewer client: theme, mermaid, search, previews, live reload, inbox answers, actions
// (every button shows the CLI command that does the same), command palette, live agent activity.
// Everything is progressive enhancement over server-rendered pages.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ------------------------------------------------------------------ theme

const THEMES = ['auto', 'light', 'dark'];
function storedTheme() {
  try {
    return localStorage.getItem('nbd-theme') || 'auto';
  } catch {
    return 'auto';
  }
}
function applyTheme(t) {
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem('nbd-theme', t);
  } catch {}
  const btn = $('[data-action="theme"]');
  if (btn) btn.title = `Theme: ${t}`;
  renderMermaid(true);
}
function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => renderMermaid(true));

// ------------------------------------------------------------------ mermaid

let mermaidMod = null;
let mermaidSeq = 0;
async function renderMermaid(force = false) {
  const blocks = $$('pre.mermaid');
  if (!blocks.length) return;
  for (const b of blocks) if (!b.dataset.src) b.dataset.src = b.textContent;
  if (!mermaidMod) mermaidMod = (await import('/vendor/mermaid/mermaid.esm.min.mjs')).default;
  mermaidMod.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: isDark() ? 'dark' : 'default',
    fontFamily: getComputedStyle(document.body).fontFamily,
  });
  for (const b of blocks) {
    if (b.dataset.processed === 'true' && !force) continue;
    try {
      const { svg } = await mermaidMod.render(`mmd-${++mermaidSeq}`, b.dataset.src);
      b.innerHTML = svg;
      b.dataset.processed = 'true';
    } catch (err) {
      b.textContent = b.dataset.src;
      const msg = document.createElement('div');
      msg.className = 'mermaid-error';
      report('warn', `mermaid diagram failed: ${err.message ?? err}`);
      msg.textContent = `Mermaid: ${String(err?.message ?? err).split('\n')[0]}`;
      b.after(msg);
    }
  }
}

// ------------------------------------------------------------------ copy buttons

document.addEventListener('click', async (e) => {
  const copy = e.target.closest('.code-block .copy, .copy-cmd, .cli-copy');
  if (!copy) return;
  const text = copy.dataset.copy ?? copy.parentElement.querySelector('pre')?.innerText ?? '';
  try {
    await navigator.clipboard.writeText(text);
    const old = copy.textContent;
    copy.textContent = 'Copied';
    setTimeout(() => (copy.textContent = old), 1200);
  } catch {}
});

// ------------------------------------------------------------------ nav + theme buttons

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'toggle-nav') document.body.classList.toggle('nav-open');
  if (btn.dataset.action === 'theme') applyTheme(THEMES[(THEMES.indexOf(storedTheme()) + 1) % THEMES.length]);
  if (btn.dataset.action === 'palette') openPalette();
});

// ------------------------------------------------------------------ search

function setupSearch() {
  const input = $('[data-search]');
  const box = $('.search-results');
  if (!input || !box) return;
  let timer = null;
  let sel = -1;
  let ctrl = null;
  const close = () => {
    box.hidden = true;
    sel = -1;
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      if (!q) return close();
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const items = await res.json();
        box.replaceChildren(
          ...items.map((it) => {
            const a = document.createElement('a');
            a.href = it.route;
            a.innerHTML = `<span class="sr-kind"></span><span class="sr-title"></span><span class="sr-snip">${it.snippet}</span>`;
            a.querySelector('.sr-kind').textContent = it.kind === 'page' ? 'page' : it.type;
            a.querySelector('.sr-title').textContent = it.title;
            return a;
          }),
        );
        if (!items.length) box.innerHTML = '<div class="empty" style="padding:8px 10px">No matches</div>';
        box.hidden = false;
        sel = -1;
      } catch {}
    }, 120);
  });
  input.addEventListener('keydown', (e) => {
    const links = $$('a', box);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!links.length) return;
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
      links.forEach((l, i) => l.classList.toggle('sel', i === sel));
    } else if (e.key === 'Enter' && sel >= 0 && links[sel]) {
      e.preventDefault();
      location.href = links[sel].href;
    } else if (e.key === 'Escape') {
      close();
      input.blur();
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search')) close();
  });
}

// ------------------------------------------------------------------ keyboard

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openPalette();
    return;
  }
  if (e.target.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === ':') {
    e.preventDefault();
    openPalette();
    return;
  }
  if (e.key === '/') {
    e.preventDefault();
    $('[data-search]')?.focus();
  } else if (e.key === '[' || e.key === ']') {
    const a = $(`.pager a[data-key="${e.key}"]`);
    if (a) location.href = a.href;
  }
});

// ------------------------------------------------------------------ line anchors (#L12)

function highlightLine() {
  const m = /^#L(\d+)$/.exec(location.hash);
  $$('.md [data-line].hl').forEach((el) => el.classList.remove('hl'));
  if (!m) return;
  const line = Number(m[1]);
  if ($(`#L${line}`)) return; // lines view: :target styling does it
  let best = null;
  for (const el of $$('.md [data-line]')) {
    const n = Number(el.dataset.line);
    if (n <= line && (!best || n >= Number(best.dataset.line))) best = el;
  }
  if (best) {
    best.classList.add('hl');
    best.scrollIntoView({ block: 'center' });
  }
}
addEventListener('hashchange', highlightLine);

// ------------------------------------------------------------------ link previews

function setupPreviews() {
  const pop = $('.preview-pop');
  if (!pop || matchMedia('(hover: none)').matches) return;
  const cache = new Map();
  let timer = null;
  let current = null;
  const hide = () => {
    pop.hidden = true;
    current = null;
  };
  document.addEventListener('mouseover', (e) => {
    const a = e.target.closest('a[data-preview]');
    if (!a || a === current) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      current = a;
      const route = a.dataset.preview;
      if (route === location.pathname) return;
      let data = cache.get(route);
      if (!data) {
        try {
          const res = await fetch(`/api/preview?route=${encodeURIComponent(route)}`);
          if (!res.ok) return;
          data = await res.json();
          cache.set(route, data);
        } catch {
          return;
        }
      }
      if (current !== a) return;
      pop.innerHTML = `<div class="pp-title"></div><div class="md ${data.kind === 'page' ? 'md-notebook' : ''}">${data.html}</div>`;
      pop.querySelector('.pp-title').textContent = data.title;
      const r = a.getBoundingClientRect();
      pop.hidden = false;
      const left = Math.min(r.left + scrollX, scrollX + document.documentElement.clientWidth - pop.offsetWidth - 16);
      const below = r.bottom + 8 + pop.offsetHeight < innerHeight;
      pop.style.left = `${Math.max(scrollX + 8, left)}px`;
      pop.style.top = `${below ? r.bottom + scrollY + 6 : r.top + scrollY - pop.offsetHeight - 6}px`;
      renderMermaidIn(pop);
    }, 350);
  });
  document.addEventListener('mouseout', (e) => {
    const a = e.target.closest('a[data-preview]');
    if (a && !a.contains(e.relatedTarget) && !pop.contains(e.relatedTarget)) {
      clearTimeout(timer);
      setTimeout(() => {
        if (!pop.matches(':hover')) hide();
      }, 150);
    }
  });
  pop.addEventListener('mouseleave', hide);
}

async function renderMermaidIn(root) {
  if ($$('pre.mermaid', root).length) await renderMermaid();
}

// ------------------------------------------------------------------ inbox answers

document.addEventListener('click', (e) => {
  const opt = e.target.closest('.opt[data-fill]');
  if (opt) {
    const ta = opt.closest('form').querySelector('textarea');
    ta.value = opt.dataset.fill;
    ta.focus();
  }
});

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-NBD': '1' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { data });
  return data;
}

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { data });
  return data;
}

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('.answer-form');
  if (!form) return;
  e.preventDefault();
  const msg = form.querySelector('.form-msg');
  const answer = form.querySelector('textarea').value.trim();
  if (!answer) return;
  msg.textContent = 'Saving…';
  try {
    const res = await post(`/api/questions/${form.dataset.qid}/answer`, { answer });
    form.closest('.question').innerHTML = `<p><b>${form.dataset.qid}</b> answered. The agent will apply it on its next run.</p>`;
    toast('Answer saved', { cli: res.cli });
  } catch (err) {
    msg.textContent = `Couldn't save: ${err.message}`;
  }
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-dismiss]');
  if (!btn) return;
  try {
    const res = await post(`/api/questions/${btn.dataset.dismiss}/dismiss`, {});
    btn.closest('.question').remove();
    toast(`${btn.dataset.dismiss} dismissed`, { cli: res.cli });
  } catch (err) {
    btn.closest('form').querySelector('.form-msg').textContent = err.message;
  }
});

// ------------------------------------------------------------------ actions

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function cliHtml(command) {
  if (!command) return '';
  return `<div class="cli"><span class="cli-p" aria-hidden="true">$</span><code>${esc(command)}</code><button type="button" class="cli-copy" data-copy="${esc(command)}" title="Copy the command">Copy</button></div>`;
}

function setCli(box, command) {
  const code = $('code', box);
  const btn = $('.cli-copy', box);
  if (code) code.textContent = command;
  if (btn) btn.dataset.copy = command;
}

function toast(msg, { cli = null, href = null, kind = 'ok', ms = 6000 } = {}) {
  const box = $('.toasts');
  if (!box) return;
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.innerHTML = `<div class="toast-msg"></div>${href ? `<a class="toast-link" href="${esc(href)}">Open →</a>` : ''}${cli ? `<div class="toast-cli"><span class="muted">Same from a terminal:</span>${cliHtml(cli)}</div>` : ''}<button type="button" class="toast-x" aria-label="Dismiss">×</button>`;
  $('.toast-msg', t).textContent = msg;
  $('.toast-x', t).addEventListener('click', () => t.remove());
  box.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? ms * 2 : ms);
}

// A toast survives the navigation an action causes (New page, Ask, Start the review…).
function navigateWithToast(href, msg, cli) {
  try {
    sessionStorage.setItem('nbd-toast', JSON.stringify({ msg, cli }));
  } catch {}
  location.href = href;
}

function showStashedToast() {
  try {
    const t = JSON.parse(sessionStorage.getItem('nbd-toast') ?? 'null');
    sessionStorage.removeItem('nbd-toast');
    if (t) toast(t.msg, { cli: t.cli });
  } catch {}
}

async function runOp(url, body, { navigate = false, reload = false, label = '' } = {}) {
  try {
    const res = await post(url, body ?? {});
    if (navigate && res.href) {
      navigateWithToast(res.href, okMessage(url, res, label), res.cli);
      return res;
    }
    toast(okMessage(url, res, label), { cli: res.cli, href: res.href && res.href !== location.pathname ? res.href : null });
    if (reload || res.href === location.pathname) scheduleRefresh(location.pathname);
    return res;
  } catch (err) {
    toast(err.message, { kind: 'error', cli: err.data?.cli });
    throw err;
  }
}

function okMessage(url, res, label) {
  if (url === '/api/sync') return 'The agent is reading your pages…';
  if (url.endsWith('/edit')) return 'Opened in your editor.';
  if (url === '/api/index') return res.wrote ? 'vault/index.md rebuilt.' : 'vault/index.md was already up to date.';
  if (url === '/api/sync/skip') return res.skipped?.length ? `Marked ${res.skipped.join(', ')} as read.` : 'Nothing was pending.';
  if (url === '/api/demo/reset') return `Demo reset: ${res.pages} pages${res.fresh ? ', empty vault' : ''}.`;
  if (url === '/api/pages/new') return `New page ${res.id}.`;
  if (url === '/api/ask') return 'Asked the agent.';
  if (url === '/api/lint/fix') return 'The clean-up has started.';
  if (/\/api\/rituals\/\w+\/start$/.test(url)) return res.resumed ? 'Picking up where you left off.' : 'The review has started.';
  return `${label || 'Done'}.`;
}

// Buttons: <button data-op="/api/…" data-body='{…}' [data-navigate] [data-reload]>
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-op]');
  if (!btn || btn.disabled) return;
  e.preventDefault();
  if (btn.dataset.confirm && !confirm(btn.dataset.confirm)) return;
  btn.disabled = true;
  try {
    await runOp(btn.dataset.op, btn.dataset.body ? JSON.parse(btn.dataset.body) : {}, {
      navigate: 'navigate' in btn.dataset,
      reload: 'reload' in btn.dataset,
      label: btn.textContent.trim(),
    });
  } catch {}
  btn.disabled = false;
});

// Forms: <form class="op-form" data-op="/api/…" [data-navigate] [data-reset]>; fields become the JSON body.
document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form.op-form');
  if (!form) return;
  e.preventDefault();
  const body = Object.fromEntries(new FormData(form).entries());
  const submit = $('button[type="submit"]', form);
  const msg = $('.form-msg', form);
  if (submit) submit.disabled = true;
  if (msg) msg.textContent = 'Working…';
  try {
    const res = await post(form.dataset.op, body);
    if ('navigate' in form.dataset && res.href) {
      navigateWithToast(res.href, okMessage(form.dataset.op, res, ''), res.cli);
      return;
    }
    if ('reset' in form.dataset) form.reset();
    if (msg) msg.textContent = '';
    // Replies are the conversation itself; its page lists the terminal commands once.
    if (!/\/reply$/.test(form.dataset.op)) toast(okMessage(form.dataset.op, res, ''), { cli: res.cli });
    scheduleRefresh(location.pathname);
  } catch (err) {
    if (msg) msg.textContent = '';
    toast(err.message, { kind: 'error', cli: err.data?.cli });
  }
  if (submit) submit.disabled = false;
});

// Chat boxes (Ask, replies) send on Enter and take Shift+Enter as a new line; any action textarea
// also sends on Ctrl/Cmd+Enter. Enter while an input method is composing (e.g. CJK) is left alone.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing || !e.target.matches('form.op-form textarea')) return;
  const chat = 'enterSends' in e.target.dataset;
  if (!(e.ctrlKey || e.metaKey) && !(chat && !e.shiftKey && !e.altKey)) return;
  e.preventDefault();
  const send = $('button[type="submit"]', e.target.form);
  if (send?.disabled || !e.target.value.trim()) return; // the agent is still replying, or nothing to send
  e.target.form.requestSubmit(send);
});

// ------------------------------------------------------------------ command palette

let palItems = [];
let palSel = 0;

async function openPalette() {
  const pal = $('.palette');
  if (!pal) return;
  pal.hidden = false;
  const input = $('.pal-input', pal);
  input.value = '';
  input.focus();
  try {
    const page = document.body.dataset.currentPage;
    palItems = (await getJson(`/api/palette${page ? `?page=${page}` : ''}`)).items;
  } catch {
    palItems = [];
  }
  renderPalette();
}

function closePalette() {
  const pal = $('.palette');
  if (pal) pal.hidden = true;
}

function palMatches() {
  const q = $('.pal-input')?.value.trim().toLowerCase() ?? '';
  if (!q) return palItems;
  const words = q.split(/\s+/);
  return palItems.filter((it) => {
    const hay = `${it.label} ${it.hint} ${it.cli ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

function renderPalette() {
  const list = $('.pal-list');
  const items = palMatches();
  palSel = Math.min(palSel, Math.max(0, items.length - 1));
  list.innerHTML = items.length
    ? items
        .map(
          (it, i) => `<li role="option" class="${i === palSel ? 'sel' : ''} ${it.disabled ? 'off' : ''}" data-i="${i}">
      <div class="pal-main"><span class="pal-label">${esc(it.label)}</span>${it.hint ? `<span class="pal-hint">${esc(it.disabled ? 'Needs the daemon (nbd daemon)' : it.hint)}</span>` : it.disabled ? '<span class="pal-hint">Needs the daemon (nbd daemon)</span>' : ''}</div>
      ${it.cli ? `<code class="pal-cli">$ ${esc(it.cli)}</code>` : ''}</li>`,
        )
        .join('')
    : '<li class="empty">Nothing matches.</li>';
  $('.pal-list li.sel')?.scrollIntoView({ block: 'nearest' });
}

async function runPaletteItem(it) {
  if (!it || it.disabled) return;
  if (it.url === '/api/demo/reset' && !confirm(`${it.label}?`)) return;
  closePalette();
  if (it.kind === 'go') {
    location.href = it.href;
    return;
  }
  try {
    await runOp(it.url, it.body, { navigate: it.url === '/api/pages/new' || /\/(start|fix)$/.test(it.url), label: it.label });
  } catch {}
}

function setupPalette() {
  const pal = $('.palette');
  if (!pal) return;
  const input = $('.pal-input', pal);
  input.addEventListener('input', () => {
    palSel = 0;
    renderPalette();
  });
  input.addEventListener('keydown', (e) => {
    const items = palMatches();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      palSel = (palSel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(1, items.length);
      renderPalette();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runPaletteItem(items[palSel]);
    } else if (e.key === 'Escape') closePalette();
  });
  $('.pal-list', pal).addEventListener('click', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li) runPaletteItem(palMatches()[Number(li.dataset.i)]);
  });
  pal.addEventListener('click', (e) => {
    if (e.target === pal) closePalette();
  });
}

// ------------------------------------------------------------------ live agent activity

const jobs = new Map();

function onJob(job) {
  jobs.set(job.id, job);
  renderJobs();
  updatePill();
  const conv = $('[data-conv]');
  if (job.convId && conv?.dataset.conv === job.convId) {
    if (job.status === 'running') renderProgress(job);
    else scheduleRefresh(location.pathname);
  }
  if (job.status !== 'running') {
    if (location.pathname === '/activity' || location.pathname === '/ask') scheduleRefresh(location.pathname);
    // Say when a background run finishes, wherever you are (but not for the conversation in view).
    if (!(job.convId && conv?.dataset.conv === job.convId)) {
      const what = job.kind === 'ingest' ? 'Ingest' : job.title;
      toast(job.status === 'ok' ? `${what}: ${job.result?.text || 'done'}` : `${what} failed: ${job.result?.error ?? ''}`, {
        kind: job.status === 'ok' ? 'ok' : 'error',
        href: job.href && job.href !== location.pathname ? job.href : null,
      });
    }
  }
}

function jobHtml(j) {
  const secs = Math.round((j.status === 'running' ? Date.now() - Date.parse(j.startedAt) : j.ms) / 1000);
  const steps = j.events.slice(-8).map((e) => `<li class="step ${esc(e.kind)}">${esc(e.text)}</li>`).join('');
  const links = (j.result?.links ?? []).map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join(' · ');
  return `<article class="job ${esc(j.status)}" data-job="${esc(j.id)}">
    <header>${j.status === 'running' ? '<span class="spinner" aria-hidden="true"></span>' : `<span class="chip ${j.status === 'ok' ? 'ok' : 'warn'}">${esc(j.status)}</span>`}
      <b>${j.href && j.kind === 'conversation' ? `<a href="${esc(j.href)}">${esc(j.title)}</a>` : esc(j.title)}</b>
      <span class="muted small" ${j.status === 'running' ? `data-elapsed="${esc(j.startedAt)}"` : ''}>${secs}s${j.result?.costUsd != null ? ` · $${j.result.costUsd.toFixed(3)}` : ''}</span></header>
    ${steps ? `<ol class="steps">${steps}</ol>` : ''}
    ${j.result?.text ? `<p class="small">${esc(j.result.text)}</p>` : ''}${j.result?.error ? `<p class="small warn-text">${esc(j.result.error)}</p>` : ''}
    ${links ? `<p class="small">${links}</p>` : ''}
    ${j.cli ? cliHtml(j.cli) : ''}
  </article>`;
}

function renderJobs() {
  const box = $('[data-jobs]');
  if (!box) return;
  const recent = [...jobs.values()]
    .filter((j) => j.status === 'running' || Date.now() - Date.parse(j.finishedAt) < 10 * 60_000)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 6);
  box.innerHTML = recent.map(jobHtml).join('');
}

function renderProgress(job) {
  const li = $(`[data-progress="${CSS.escape(job.convId)}"]`);
  if (!li) return scheduleRefresh(location.pathname); // the turn started elsewhere: show it
  const steps = $('.steps', li);
  if (steps) steps.innerHTML = job.events.slice(-12).map((e) => `<li class="step ${esc(e.kind)}">${esc(e.text)}</li>`).join('');
}

async function updatePill() {
  const pill = $('[data-agent-pill]');
  if (!pill) return;
  try {
    const a = (await getJson('/api/status')).counts?.agent;
    if (!a) return;
    const state = !a.on ? 'off' : a.running ? 'busy' : a.pending ? 'pending' : 'idle';
    pill.className = `agent-pill ${state}`;
    $('.ap-text', pill).textContent = { off: 'Agent off', busy: 'Agent working…', pending: `${a.pending} pending`, idle: 'Agent idle' }[state];
  } catch {}
}

setInterval(() => {
  for (const el of $$('[data-elapsed]')) {
    if (!el.dataset.elapsed) continue;
    el.textContent = `${Math.round((Date.now() - Date.parse(el.dataset.elapsed)) / 1000)}s`;
  }
}, 1000);

// A turn can finish between the server rendering this page and the event stream connecting;
// while one shows as running, check now and then so the page never waits on a missed event.
let convPoll = null;
function watchConversation() {
  clearInterval(convPoll);
  const li = $('[data-progress]');
  if (!li) return;
  const id = li.dataset.progress;
  const check = async () => {
    try {
      const c = await getJson(`/api/conversations/${encodeURIComponent(id)}`);
      if (!c.busy) {
        clearInterval(convPoll);
        scheduleRefresh(location.pathname);
      }
    } catch {}
  };
  setTimeout(check, 600);
  convPoll = setInterval(check, 4000);
}

async function loadJobs() {
  if (!$('[data-jobs]')) return;
  try {
    for (const j of (await getJson('/api/jobs')).jobs) jobs.set(j.id, j);
  } catch {}
  renderJobs();
}

// ------------------------------------------------------------------ activity: log, prompt, checks

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
let logLevel = 'info';

function logLine(level, text) {
  return `<span class="log-${esc(level)}">${esc(text.replace(/\n$/, ''))}</span>\n`;
}

async function loadLog() {
  const pre = $('[data-log-tail]');
  if (!pre) return;
  const sel = $('[data-log-level]');
  logLevel = sel?.value ?? 'info';
  try {
    const { entries } = await getJson(`/api/logs?level=${logLevel}&n=200`);
    pre.innerHTML = entries.map((e) => logLine(e.level, e.text)).join('') || '<span class="muted">Nothing logged yet.</span>\n';
    pre.scrollTop = pre.scrollHeight;
  } catch {}
  const box = $('[data-log-cli]');
  if (box?.dataset.variants) setCli(box, JSON.parse(box.dataset.variants)[logLevel]);
}

function onLog({ level, line }) {
  const pre = $('[data-log-tail]');
  if (!pre || (LEVELS[level] ?? 3) > (LEVELS[logLevel] ?? 2)) return;
  const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
  pre.insertAdjacentHTML('beforeend', logLine(level, line));
  while (pre.childElementCount > 600) pre.firstElementChild.remove();
  if (atBottom) pre.scrollTop = pre.scrollHeight;
}

document.addEventListener('change', (e) => {
  if (e.target.matches('[data-log-level]')) loadLog();
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-load-prompt], [data-run-doctor]');
  if (!btn) return;
  btn.disabled = true;
  try {
    if ('loadPrompt' in btn.dataset) {
      const pre = $('.prompt-text');
      const r = await getJson('/api/sync/preview');
      pre.textContent = r.prompt ?? `Nothing to ingest right now (${r.status}).`;
      pre.hidden = false;
      toast('Prompt loaded.', { cli: btn.dataset.cli });
    } else {
      const ul = $('[data-checks]');
      ul.innerHTML = '<li class="muted">Checking…</li>';
      const { checks } = await getJson('/api/doctor');
      ul.innerHTML = checks
        .map((c) => `<li class="check ${esc(c.status)}"><span class="mark">${{ ok: '✓', warn: '!', fail: '✗' }[c.status]}</span><span>${esc(c.msg)}${c.hint ? `<br><span class="small muted">→ ${esc(c.hint)}</span>` : ''}</span></li>`)
        .join('');
      toast('Checks done.', { cli: btn.dataset.cli });
    }
  } catch (err) {
    toast(err.message, { kind: 'error', cli: btn.dataset.cli });
  }
  btn.disabled = false;
});

// ------------------------------------------------------------------ live reload

let refreshTimer = null;
let refreshMain = false;
const LIST_PAGES = /^\/(notebook|inbox|tasks|rituals|search)?$|^\/v\/(.*\/)?$/;

function scheduleRefresh(route, panelsOnly = false) {
  // The main column only reloads when the change concerns what's on screen; the side panels
  // (page list, backlinks, badges) always do.
  if (!panelsOnly && (route === location.pathname || LIST_PAGES.test(location.pathname) || !route)) refreshMain = true;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 250);
}

async function refresh() {
  const withMain = refreshMain;
  refreshMain = false;
  // Don't clobber an answer being typed.
  if (withMain && $$('textarea').some((t) => t.value.trim())) return;
  try {
    const res = await fetch(location.href, { headers: { Accept: 'text/html' } });
    if (!res.ok) return;
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const y = scrollY;
    for (const sel of [withMain ? 'main' : null, '.sidebar', '.aside', '.top-links'].filter(Boolean)) {
      const next = $(sel, doc);
      const cur = $(sel);
      if (next && cur) cur.innerHTML = next.innerHTML;
    }
    if (withMain) {
      scrollTo(0, y);
      enhance();
    }
    updatePill();
  } catch {}
}

function onServerEvent(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }
  if (data.type === 'change') scheduleRefresh(data.route);
  else if (data.type === 'status') {
    scheduleRefresh(null, true);
    updatePill();
  } else if (data.type === 'job') onJob(data.job);
  else if (data.type === 'log') onLog(data);
  else if (data.type === 'reset') {
    // The notebook was reset under us (demo): what's on screen may no longer exist.
    if (location.pathname.startsWith('/c/') || location.pathname.startsWith('/n/') || location.pathname.startsWith('/v/')) location.href = '/';
    else location.reload();
  }
}

// Browsers open at most 6 connections to one host, and an event stream holds one for as long as
// the page is open: a stream per tab would stall every request after the sixth tab. So tabs elect
// one leader (Web Locks) that holds the only stream and relays its events (BroadcastChannel).
function liveReload() {
  if (!window.EventSource) return;
  if (!navigator.locks || !window.BroadcastChannel) return perTabStream();
  const channel = new BroadcastChannel('nbd-events');
  channel.onmessage = (ev) => onServerEvent(ev.data);
  let waited = false;
  const t = setTimeout(() => (waited = true), 1000);
  navigator.locks.request('nbd-events', () => {
    clearTimeout(t);
    // Taking over from a closed tab: events may have been missed in between.
    if (waited) scheduleRefresh(location.pathname);
    const es = new EventSource('/events');
    es.onmessage = (ev) => {
      channel.postMessage(ev.data);
      onServerEvent(ev.data);
    };
    return new Promise(() => {}); // hold the lock (and the stream) until this page goes away
  });
}

// Without Web Locks (plain-http access from another host), hidden tabs let go of their stream.
function perTabStream() {
  let es = null;
  const open = () => {
    if (es) return;
    es = new EventSource('/events');
    es.onmessage = (ev) => onServerEvent(ev.data);
  };
  const close = () => {
    es?.close();
    es = null;
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) close();
    else {
      open();
      scheduleRefresh(location.pathname);
    }
  });
  addEventListener('pagehide', close);
  if (!document.hidden) open();
}

// ------------------------------------------------------------------ diagnostics

// Errors and slow loads go to the daemon's log (`nbd logs`), next to the server's side of the story.
let reported = 0;
function report(level, msg, extra = {}) {
  if (++reported > 20) return;
  try {
    fetch('/api/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-NBD': '1' },
      body: JSON.stringify({ level, msg: String(msg), url: location.pathname + location.search, ...extra }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

addEventListener('error', (e) => report('error', e.message || 'script error', { stack: e.error?.stack, data: { src: e.filename, line: e.lineno } }));
addEventListener('unhandledrejection', (e) => report('error', `unhandled rejection: ${e.reason?.message ?? e.reason}`, { stack: e.reason?.stack }));

const SLOW_LOAD_MS = 1500;
addEventListener('load', () =>
  setTimeout(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    if (!nav || nav.loadEventEnd < SLOW_LOAD_MS) return;
    const r = (n) => Math.round(n);
    // queued: time the browser held the request before sending it (connection limits show up here).
    report('warn', `slow page load: ${r(nav.loadEventEnd)}ms`, {
      data: {
        queued: r(nav.requestStart - nav.fetchStart),
        server: r(nav.responseStart - nav.requestStart),
        download: r(nav.responseEnd - nav.responseStart),
        dom: r(nav.domContentLoadedEventEnd - nav.responseEnd),
        load: r(nav.loadEventEnd),
        slowest: performance
          .getEntriesByType('resource')
          .sort((a, b) => b.duration - a.duration)
          .slice(0, 3)
          .map((x) => `${new URL(x.name).pathname} ${r(x.duration)}ms`),
      },
    });
  }, 0),
);

// ------------------------------------------------------------------ boot

// <details data-remember="name">: keep it open or closed the way this viewer last left it.
function rememberDetails() {
  for (const d of $$('details[data-remember]')) {
    const key = `nbd-open-${d.dataset.remember}`;
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) d.open = saved === '1';
    } catch {}
    if (d.dataset.bound) continue;
    d.dataset.bound = '1';
    d.addEventListener('toggle', () => {
      try {
        localStorage.setItem(key, d.open ? '1' : '0');
      } catch {}
    });
  }
}

function enhance() {
  rememberDetails();
  renderMermaid();
  highlightLine();
  renderJobs();
  loadLog();
  watchConversation();
}

const themeBtn = $('[data-action="theme"]');
if (themeBtn) themeBtn.title = `Theme: ${storedTheme()}`;
setupSearch();
setupPreviews();
setupPalette();
showStashedToast();
loadJobs();
updatePill();
enhance();
liveReload();
