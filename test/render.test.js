import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { MarkdownRenderer } from '../src/render/markdown.js';

let r;
before(async () => {
  r = await new MarkdownRenderer().init();
});

const env = (extra = {}) => ({
  mode: 'vault',
  resolveWikilink: (t) =>
    t === 'p0042'
      ? { href: '/n/p0042', label: 'p.42', exists: true, kind: 'page' }
      : t === 'jane-doe'
        ? { href: '/v/people/jane-doe', label: null, exists: true, kind: 'note' }
        : null,
  resolveHref: (h) => `/resolved/${h}`,
  ...extra,
});

test('notebook pages render Bullet Journal glyph classes and signifiers', async () => {
  const html = await r.renderAsync('- [ ] * call Mom\n- [x] done\n- [>] moved\n- [<] later\n- [-] nope\n- o dentist\n- ! idea\n- plain\n- * priority note\n', env({ mode: 'notebook' }));
  for (const cls of ['bujo-task bujo-open', 'bujo-task bujo-done', 'bujo-task bujo-migrated', 'bujo-task bujo-scheduled', 'bujo-task bujo-irrelevant', 'bujo-event', 'bujo-note']) {
    assert.ok(html.includes(`class="bujo ${cls}"`), cls);
  }
  assert.match(html, /data-sig="priority">call Mom</);
  assert.match(html, /data-sig="inspiration">idea</);
  assert.match(html, /data-sig="priority">priority note</, 'priority notes are not nested lists');
  assert.ok(!html.includes('[ ]'), 'markers are consumed');
});

test('vault notes keep plain bullets plain', async () => {
  const html = await r.renderAsync('- plain\n- [ ] task\n', env());
  assert.match(html, /<li data-line="1">plain<\/li>/);
  assert.match(html, /class="bujo bujo-task bujo-open"/);
});

test('wikilinks resolve, show page labels, and mark missing targets', async () => {
  const html = await r.renderAsync('See [[p0042#L3]], [[jane-doe|Jane]] and [[ghost]].', env());
  assert.match(html, /<a class="wikilink internal to-page" href="\/n\/p0042#L3" data-preview="\/n\/p0042">p.42<\/a>/);
  assert.match(html, /href="\/v\/people\/jane-doe"[^>]*>Jane<\/a>/);
  assert.match(html, /<span class="wikilink missing"[^>]*>ghost<\/span>/);
});

test('mermaid, code, math, callouts, footnotes, highlights, tables', async () => {
  const src = [
    '```mermaid',
    'graph LR; A-->B',
    '```',
    '',
    '```python',
    'def f(): return 1',
    '```',
    '',
    'Inline $x^2$ math and ==key idea==.[^1]',
    '',
    '> [!outdated] As of 2026-10-24',
    '> Deadline moved.',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    '[^1]: [[p0042]] · "quote"',
  ].join('\n');
  const html = await r.renderAsync(src, env());
  assert.match(html, /<pre class="mermaid">graph LR; A--&gt;B\n<\/pre>/);
  assert.match(html, /<pre class="shiki shiki-themes github-light github-dark"/);
  assert.match(html, /class="katex"/);
  assert.match(html, /<mark>key idea<\/mark>/);
  assert.match(html, /class="callout callout-outdated" data-callout="outdated"><div class="callout-head"><span class="callout-title">As of 2026-10-24<\/span>/);
  assert.match(html, /<div class="table-wrap"><table data-line="14">/);
  assert.match(html, /class="footnotes"/);
  assert.match(html, /footnote-item.*href="\/n\/p0042"/s);
});

test('data-line matches file lines even below frontmatter', async () => {
  const html = await r.renderAsync('# Title\n\npara\n', env({ lineOffset: 5 }));
  assert.match(html, /<h1 data-line="6" id="title">/);
  assert.match(html, /<p data-line="8">para<\/p>/);
});

test('raw HTML is escaped and dangerous links are dropped', async () => {
  const html = await r.renderAsync('<script>alert(1)</script>\n\n[x](javascript:alert(1))', env());
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('href="javascript:'));
});

test('unknown code languages fall back to escaped plain text', async () => {
  const html = await r.renderAsync('```nonsense-lang\n<b>hi</b>\n```\n', env());
  assert.match(html, /<pre class="shiki plain"><code>&lt;b&gt;hi&lt;\/b&gt;<\/code><\/pre>/);
});
