// Rapid-logging parser for notebook pages.
//
// The key (see templates/home/KEY.md) maps Bullet Journal bullets onto plain markdown so pages
// render anywhere, stay greppable, and need no special characters to type:
//
//   - [ ] task        •  open            - o event      ○  event
//   - [/] task        /  started/delegated - note       –  note
//   - [x] task        ×  done            - = mood       =  mood (Bullet Journal 3.0)
//   - [>] task        >  migrated        Signifiers go right after the bullet:
//   - [<] task        <  scheduled         * priority   ! inspiration   ? explore   + expand later
//   - [-] task        ~~ irrelevant
//
// The parser is deliberately lenient (○ ◦ • × also work); the agent reads pages too.

const TASK_STATES = {
  ' ': 'open',
  '/': 'started',
  x: 'done',
  X: 'done',
  '>': 'migrated',
  '<': 'scheduled',
  '-': 'irrelevant',
  '~': 'irrelevant',
};

const SIGNIFIERS = { '*': 'priority', '!': 'inspiration', '?': 'explore', '+': 'expand' };
// Obsidian-style checkboxes some people already type: [!] / [*] important, [?] question.
const CHECKBOX_SIGNIFIERS = { '!': 'priority', '*': 'priority', '?': 'explore' };

const LIST_RE = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const CHECKBOX_RE = /^\[(.)\](?:\s+|$)(.*)$/;
const EVENT_RE = /^(?:o|○|◦|\(o\))\s+(.*)$/;
const MOOD_RE = /^=\s+(.*)$/;
const UNICODE_TASK_RE = /^(•|×|✕|✗)\s+(.*)$/;
const SIGNIFIER_RE = /^\\?([*!?+])\s+(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;
const STRUCK_RE = /^~~(.+)~~$/;

const DAY_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const WEEK_RE = /\b(\d{4})-W(\d{2})\b/;
const MONTH_RE = /\b(\d{4})-(\d{2})\b(?!-\d)/;

/** Dates mentioned in a heading: { date: 'YYYY-MM-DD' } | { week: 'YYYY-Www' } | { month: 'YYYY-MM' } | null */
export function headingDate(text) {
  let m = DAY_RE.exec(text);
  if (m && validDay(+m[1], +m[2], +m[3])) return { date: `${m[1]}-${m[2]}-${m[3]}` };
  m = WEEK_RE.exec(text);
  if (m && +m[2] >= 1 && +m[2] <= 53) return { week: `${m[1]}-W${m[2]}` };
  m = MONTH_RE.exec(text);
  if (m && +m[2] >= 1 && +m[2] <= 12) return { month: `${m[1]}-${m[2]}` };
  return null;
}

function validDay(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(y, mo, 0).getDate();
}

function takeSignifiers(text) {
  const signifiers = [];
  let rest = text;
  for (let m = SIGNIFIER_RE.exec(rest); m; m = SIGNIFIER_RE.exec(rest)) {
    signifiers.push(SIGNIFIERS[m[1]]);
    rest = m[2];
  }
  return { signifiers, rest };
}

/** Classify the content after a list marker. */
export function parseBullet(content) {
  let m = CHECKBOX_RE.exec(content);
  if (m) {
    if (m[1] === 'o' || m[1] === 'O') return finish('event', null, m[2]);
    if (m[1] in TASK_STATES) return finish('task', TASK_STATES[m[1]], m[2]);
    if (m[1] in CHECKBOX_SIGNIFIERS) {
      const t = finish('task', 'open', m[2]);
      t.signifiers.unshift(CHECKBOX_SIGNIFIERS[m[1]]);
      return t;
    }
  }
  m = EVENT_RE.exec(content);
  if (m) return finish('event', null, m[1]);
  m = MOOD_RE.exec(content);
  if (m) return finish('mood', null, m[1]);
  m = UNICODE_TASK_RE.exec(content);
  if (m) return finish('task', m[1] === '•' ? 'open' : 'done', m[2]);
  return finish('note', null, content);
}

function finish(kind, state, text) {
  const { signifiers, rest } = takeSignifiers(text);
  let body = rest.trim();
  let struck = false;
  const s = STRUCK_RE.exec(body);
  if (s) {
    struck = true;
    body = s[1].trim();
    if (kind === 'task' && state === 'open') state = 'irrelevant';
  }
  return { kind, state, signifiers, text: body, struck };
}

/**
 * Parse page text into line records. Each record has `line` (1-based) and `kind`:
 * heading | task | event | mood | note | text | blank | code.
 * `context` carries the date context in from the previous page (daily logs flow across pages).
 */
export function parseLines(text, context = {}) {
  const lines = splitLines(text);
  let ctx = { date: context.date ?? null, month: context.month ?? null, week: context.week ?? null };
  let fence = null;
  const out = [];
  lines.forEach((raw, i) => {
    const line = i + 1;
    const f = FENCE_RE.exec(raw);
    if (fence) {
      if (f && f[1] === fence) fence = null;
      out.push({ line, kind: 'code', raw, ...ctx });
      return;
    }
    if (f) {
      fence = f[1];
      out.push({ line, kind: 'code', raw, ...ctx });
      return;
    }
    if (!raw.trim()) {
      out.push({ line, kind: 'blank', raw, ...ctx });
      return;
    }
    const h = HEADING_RE.exec(raw);
    if (h) {
      const d = headingDate(h[2]);
      if (d?.date) ctx = { date: d.date, month: d.date.slice(0, 7), week: null };
      else if (d?.week) ctx = { date: null, month: null, week: d.week };
      else if (d?.month) ctx = { date: null, month: d.month, week: null };
      out.push({ line, kind: 'heading', level: h[1].length, text: h[2], raw, dated: Boolean(d), ...ctx });
      return;
    }
    const l = LIST_RE.exec(raw);
    if (l) {
      const ordered = /\d/.test(l[2]);
      const b = ordered ? finish('note', null, l[3]) : parseBullet(l[3]);
      out.push({ line, indent: l[1].replace(/\t/g, '  ').length, ordered, raw, ...b, ...ctx });
      return;
    }
    out.push({ line, kind: 'text', text: raw.trim(), raw, ...ctx });
  });
  return { records: out, context: ctx };
}

/** Split into lines the way nvim counts them: a trailing newline does not start a new line. */
export function splitLines(text) {
  if (!text) return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function countLines(text) {
  return splitLines(text).length;
}

/** The page's topic: its first heading, else its first non-blank line. */
export function pageTopic(text) {
  const lines = splitLines(text);
  for (const l of lines) {
    const h = HEADING_RE.exec(l);
    if (h) return h[2].trim();
    if (l.trim()) return l.trim().replace(/^[-*+]\s+(\[.\]\s+)?/, '').slice(0, 80);
  }
  return '';
}

export const STATE_GLYPHS = {
  open: '•',
  started: '/',
  done: '×',
  migrated: '>',
  scheduled: '<',
  irrelevant: '~',
};
