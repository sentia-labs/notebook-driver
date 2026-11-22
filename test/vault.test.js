import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome, PAGE1, PAGE2 } from './helpers.js';
import { Library } from '../src/library.js';
import { recordAnswer, listQuestions, nextQuestionId, dismissQuestion, sectionText } from '../src/questions.js';
import { splitFrontmatter } from '../src/frontmatter.js';
import { lintVault } from '../src/lint.js';
import { buildIndex, writeIndex } from '../src/vaultindex.js';
import { checkToolCall } from '../src/hook.js';
import { conversationRun, listRitualRuns, ritualStatus, saveRitualRun, terminalRun } from '../src/rituals.js';
import { collectTasks, isOpen } from '../src/tasks.js';
import { buildRitualContext } from '../src/context.js';
import { notebookIndex, pageRanges } from '../src/nbindex.js';

const PROJECT = `---
type: project
title: Q4 budget
description: Get Q4 numbers to Jane by Friday
status: active
aliases: [budget]
sources:
  - "[[p0002]]"
---
# Q4 budget

Jane wants numbers by Friday.[^p0002]

Works with [[jane-doe]] and [[nobody-yet]].

[^p0002]: [[p0002]] · "J. wants numbers by Friday"
[^p0002-2]: [[p0002]] · "numbers by Monday"
`;

const PERSON = `---
type: person
title: Jane Doe
description: Finance lead
sources:
  - "[[p0002]]"
---
# Jane Doe
Runs the [[q4-budget|budget]].
`;

const QUESTION = `---
type: question
id: q0001
status: open
asked: 2026-10-22T14:03:00-05:00
sources:
  - "[[p0002]]"
options:
  - Jane Doe
  - Someone else
---
# Who is "J." on p.2?

On [[p0002]] you wrote "lunch w/ J.".

## Answer
`;

function fixture() {
  return tempHome({
    'notebook/p0001.md': PAGE1,
    'notebook/p0002.md': PAGE2,
    'vault/projects/q4-budget.md': PROJECT,
    'vault/resources/people/jane-doe.md': PERSON,
    'vault/inbox/q0001.md': QUESTION,
    'vault/journal/weekly/2026-W42.md': '---\ntype: weekly\nperiod: 2026-W42\nreview: done\n---\n# Week 42\n',
  });
}

test('library resolves wikilinks like Obsidian and tracks provenance', (t) => {
  const h = fixture();
  t.after(h.cleanup);
  const lib = new Library(h.paths, h.config).scan();
  assert.equal(lib.resolve('p0002').route, '/n/p0002');
  assert.equal(lib.resolve('Q4-Budget').rel, 'vault/projects/q4-budget.md', 'case-insensitive by file name');
  assert.equal(lib.resolve('budget').rel, 'vault/projects/q4-budget.md', 'aliases resolve');
  assert.equal(lib.resolve('resources/people/jane-doe').rel, 'vault/resources/people/jane-doe.md', 'vault paths resolve');
  assert.equal(lib.resolve('nobody-yet'), null);
  assert.deepEqual(lib.derivedFrom('p0002').map((n) => n.name).sort(), ['jane-doe', 'q0001', 'q4-budget']);
  assert.deepEqual(lib.backlinks('vault/resources/people/jane-doe.md').map((d) => d.name), ['q4-budget']);
  const page = lib.get('notebook/p0002.md');
  assert.equal(page.lines, 8);
  assert.equal(lib.get('vault/projects/q4-budget.md').description, 'Get Q4 numbers to Jane by Friday');
});

test('search finds pages and notes, with filters', (t) => {
  const h = fixture();
  t.after(h.cleanup);
  const lib = new Library(h.paths, h.config).scan();
  assert.ok(lib.search('thanksgiving').some((r) => r.doc.name === 'p0002'));
  assert.ok(lib.search('budget').some((r) => r.doc.name === 'q4-budget'));
  assert.ok(lib.search('budget in:notebook').every((r) => r.doc.kind === 'page'));
  assert.deepEqual(lib.search('type:person').map((r) => r.doc.name), ['jane-doe']);
  assert.ok(lib.search('numbrs').length > 0, 'fuzzy');
});

test('answers are recorded in the question file', (t) => {
  const h = fixture();
  t.after(h.cleanup);
  assert.equal(nextQuestionId(h.paths), 'q0002');
  const q = recordAnswer(h.paths, 'q0001', 'Jane Doe from finance', { via: 'test' });
  assert.equal(q.status, 'answered');
  assert.equal(q.answer, 'Jane Doe from finance');
  const { data, body } = splitFrontmatter(h.read('vault/inbox/q0001.md'));
  assert.equal(data.answered_via, 'test');
  assert.deepEqual(data.options, ['Jane Doe', 'Someone else'], 'other frontmatter survives');
  assert.equal(sectionText(body, 'Answer'), 'Jane Doe from finance');
  // Answering again replaces the answer rather than appending.
  recordAnswer(h.paths, 'q0001', 'Actually John', { via: 'test' });
  assert.equal(sectionText(splitFrontmatter(h.read('vault/inbox/q0001.md')).body, 'Answer'), 'Actually John');
  dismissQuestion(h.paths, 'q0001');
  assert.equal(listQuestions(h.paths)[0].status, 'dismissed');
  assert.throws(() => recordAnswer(h.paths, '../x', 'hi'), /Bad question id/);
});

test('lint catches broken links, misquotes and missing sources', (t) => {
  const h = fixture();
  t.after(h.cleanup);
  h.write('vault/resources/orphan.md', '---\ntype: concept\n---\n# Orphan\n');
  h.write('vault/areas/jane-doe.md', '---\ntype: area\nsources: ["[[p0009]]"]\n---\n# Dup\n');
  const issues = lintVault(new Library(h.paths, h.config).scan());
  const has = (re) => issues.some((i) => re.test(`${i.level} ${i.rel}: ${i.message}`));
  assert.ok(has(/warn vault\/projects\/q4-budget.md: broken link \[\[nobody-yet\]\]/));
  assert.ok(has(/warn vault\/projects\/q4-budget.md: footnote \[\^p0002-2\]: "numbers by Monday" is not on p0002/));
  assert.ok(!has(/footnote \[\^p0002\]:/), 'the verbatim quote passes');
  assert.ok(has(/warn vault\/resources\/orphan.md: no notebook sources/));
  assert.ok(has(/error vault\/areas\/jane-doe.md: cites p0009, which does not exist/));
  assert.ok(has(/error .*jane-doe.md: file name "jane-doe" is not unique/));
});

test('index.md is generated from frontmatter', (t) => {
  const h = fixture();
  t.after(h.cleanup);
  const lib = new Library(h.paths, h.config).scan();
  const text = buildIndex(lib);
  assert.match(text, /## Projects \(1\)\n- \[\[q4-budget\|Q4 budget\]\] — Get Q4 numbers to Jane by Friday · 1 page/);
  assert.match(text, /## People \(1\)\n- \[\[jane-doe\|Jane Doe\]\] — Finance lead/);
  assert.match(text, /- Weekly: \[\[2026-W42\]\] ✓/);
  assert.match(text, /## Questions for the human \(1 open of 1\)/);
  assert.equal(writeIndex(lib), true);
  assert.equal(writeIndex(new Library(h.paths, h.config).scan()), false, 'unchanged index is not rewritten');
});

test('hook keeps agents out of the notebook', () => {
  const home = '/home/u/notebook';
  const call = (tool_name, tool_input, cwd = home) => checkToolCall({ tool_name, tool_input, cwd }, home);
  assert.ok(call('Edit', { file_path: `${home}/notebook/p0001.md` }));
  assert.ok(call('Write', { file_path: 'notebook/p0002.md' }));
  assert.ok(call('Edit', { file_path: '../notebook/p0002.md' }, `${home}/vault`));
  assert.equal(call('Edit', { file_path: `${home}/vault/projects/x.md` }), null);
  assert.ok(call('Bash', { command: 'echo hi >> notebook/p0001.md' }));
  assert.ok(call('Bash', { command: `sed -i 's/a/b/' ${home}/notebook/p0001.md` }));
  assert.ok(call('Bash', { command: 'mv notebook/p0001.md /tmp/' }));
  assert.ok(call('Bash', { command: 'git checkout -- notebook/' }));
  assert.equal(call('Bash', { command: 'cat notebook/p0001.md | grep task' }), null);
  assert.equal(call('Bash', { command: 'rg TODO notebook/' }), null);
  assert.equal(call('Bash', { command: 'echo hi > vault/x.md' }), null);
});

test('rituals are due only for periods with activity, and done when the note says so', (t) => {
  const h = fixture();
  t.after(h.cleanup);
  const lib = new Library(h.paths, h.config).scan();
  const parsed = lib.parsedPages();
  const hasActivity = (from, to) => parsed.some(({ dates }) => dates.dates.some((d) => d >= from && d <= to));
  const at = (d) => ritualStatus(h.paths, h.config, d, { hasActivity });
  const sunday = at(new Date(2026, 9, 25, 17, 0)).find((r) => r.kind === 'weekly');
  assert.equal(sunday.period, '2026-W43');
  assert.equal(sunday.due, true);
  assert.equal(sunday.previous.done, true);
  h.write('vault/journal/weekly/2026-W43.md', '---\ntype: weekly\nreview: done\n---\n# W43\n');
  assert.equal(at(new Date(2026, 9, 25, 17, 0)).find((r) => r.kind === 'weekly').due, false);
  const quiet = at(new Date(2026, 7, 2, 17, 0)).find((r) => r.kind === 'weekly');
  assert.equal(quiet.due, false, 'no pages that week, nothing to review');
});

test('tasks and ritual context come straight from the pages', (t) => {
  const h = fixture();
  t.after(h.cleanup);
  const lib = new Library(h.paths, h.config).scan();
  const tasks = collectTasks(lib.parsedPages());
  assert.deepEqual(tasks.filter(isOpen).map((x) => x.text), ['carried over from yesterday', 'call Mom re: Thanksgiving', 'wire the viewer']);
  assert.equal(tasks.find((x) => x.text.startsWith('carried')).date, '2026-10-21');
  const text = buildRitualContext(h.ctx, lib, 'weekly', '2026-W43', new Date(2026, 9, 25, 17));
  assert.match(text, /## Pages written in this period \(2\)/);
  assert.match(text, /### Done \(1\)\n- \[x\] draft notebook-driver design — \[\[p0001\]\]:2/);
  assert.match(text, /- \[ \] \* call Mom re: Thanksgiving — \[\[p0002\]\]:3 · 2026-10-22/);
  assert.match(text, /## Events \(2\)/);
  assert.match(text, /q0001: Who is "J." on p.2\?/);
  assert.doesNotMatch(text, /Intentions|Moods|## Projects/);
  const monthly = buildRitualContext(h.ctx, lib, 'monthly', '2026-10', new Date(2026, 9, 31, 17));
  assert.match(monthly, /## Projects \(1\)\n- \[\[q4-budget\]\] Q4 budget · active · updated \?/);
});

test('ritual runs are timed: active time leaves out long pauses', (t) => {
  const h = fixture();
  t.after(h.cleanup);
  const at = (min) => new Date(Date.UTC(2026, 9, 25, 16, min)).toISOString();
  const conv = {
    id: 'cabc123',
    createdAt: at(0),
    costUsd: 0.2,
    meta: { ritual: 'weekly', period: '2026-W43' },
    turns: [
      { role: 'human', at: at(0) },
      { role: 'agent', at: at(1), ms: 60_000 },
      { role: 'human', at: at(3) }, // 2 min to reply
      { role: 'agent', at: at(4), ms: 60_000 },
      { role: 'human', at: at(50) }, // came back 46 min later: not active
      { role: 'agent', at: at(51), ms: 60_000 },
    ],
  };
  const run = conversationRun(h.paths, conv);
  assert.deepEqual(
    { minutes: run.minutes, activeMinutes: run.activeMinutes, agentMinutes: run.agentMinutes, yourMinutes: run.yourMinutes, replies: run.replies, done: run.done },
    { minutes: 51, activeMinutes: 5, agentMinutes: 3, yourMinutes: 2, replies: 2, done: false },
  );
  saveRitualRun(h.paths, run);
  h.write('vault/journal/weekly/2026-W43.md', '---\ntype: weekly\nreview: done\n---\n# W43\n');
  saveRitualRun(h.paths, terminalRun(h.paths, 'weekly', '2026-W43', new Date(Date.UTC(2026, 9, 26, 9)), new Date(Date.UTC(2026, 9, 26, 9, 4, 30))));
  saveRitualRun(h.paths, { ...run, done: true }); // a later turn updates the same run
  const runs = listRitualRuns(h.paths);
  assert.deepEqual(runs.map((r) => [r.via, r.activeMinutes, r.done]), [['terminal', 4.5, true], ['viewer', 5, true]]);
});

test('the notebook index groups collections and logs by page, Bullet Journal style', (t) => {
  const h = tempHome({
    'notebook/p0001.md': '# Index\n- Books to read → 6\n',
    'notebook/p0002.md': '# Future Log\n## 2026-12\n- [ ] 09: deadline\n',
    'notebook/p0003.md': '# 2026-10\n- 03 Sa o dinner\n',
    'notebook/p0004.md': '# 2026-10-20 Tue\n- [ ] a\n',
    'notebook/p0005.md': '# 2026-10-21 Wed\n- [ ] b\n',
    'notebook/p0006.md': '# Books to read\n- Dune\n',
    'notebook/p0007.md': '# 2026-10-22 Thu\n- [ ] c\n',
    'notebook/p0008.md': '# Books to read (cont.)\n- Emma\n',
  });
  t.after(h.cleanup);
  const idx = notebookIndex(new Library(h.paths, h.config).scan().parsedPages());
  const flat = Object.fromEntries(idx.flatMap((g) => g.entries.map((e) => [`${g.section}/${e.label}`, pageRanges(e.pages)])));
  assert.deepEqual(flat, {
    '/Index': '1',
    '/Future Log': '2',
    'Monthly logs/October 2026': '3',
    'Collections/Books to read': '6, 8',
    'Daily logs/October 2026': '4–5, 7',
  });
});
