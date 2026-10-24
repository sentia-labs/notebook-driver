import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countLines, headingDate, pageTopic, parseBullet, parseLines, splitLines } from '../src/bujo.js';
import { PAGE2 } from './helpers.js';

test('bullets map onto tasks, events and notes', () => {
  const cases = [
    ['[ ] call Mom', 'task', 'open', [], 'call Mom'],
    ['[x] call Mom', 'task', 'done', [], 'call Mom'],
    ['[X] call Mom', 'task', 'done', [], 'call Mom'],
    ['[/] call Mom', 'task', 'started', [], 'call Mom'],
    ['[>] call Mom', 'task', 'migrated', [], 'call Mom'],
    ['[<] call Mom', 'task', 'scheduled', [], 'call Mom'],
    ['[-] call Mom', 'task', 'irrelevant', [], 'call Mom'],
    ['[ ] * call Mom', 'task', 'open', ['priority'], 'call Mom'],
    ['[!] call Mom', 'task', 'open', ['priority'], 'call Mom'],
    ['[ ] ~~call Mom~~', 'task', 'irrelevant', [], 'call Mom'],
    ['o dentist 3pm', 'event', null, [], 'dentist 3pm'],
    ['○ dentist 3pm', 'event', null, [], 'dentist 3pm'],
    ['[o] dentist 3pm', 'event', null, [], 'dentist 3pm'],
    ['o * dentist', 'event', null, ['priority'], 'dentist'],
    ['! idea', 'note', null, ['inspiration'], 'idea'],
    ['? look into it', 'note', null, ['explore'], 'look into it'],
    ['* ! both', 'note', null, ['priority', 'inspiration'], 'both'],
    ['\\* escaped priority', 'note', null, ['priority'], 'escaped priority'],
    ['just a note', 'note', null, [], 'just a note'],
    ['ostrich facts', 'note', null, [], 'ostrich facts'],
  ];
  for (const [input, kind, state, sigs, text] of cases) {
    const b = parseBullet(input);
    assert.equal(b.kind, kind, input);
    assert.equal(b.state, state, input);
    assert.deepEqual(b.signifiers, sigs, input);
    assert.equal(b.text, text, input);
  }
});

test('dated headings set the date context, carried across pages', () => {
  const { records, context } = parseLines(PAGE2, { date: '2026-10-21', month: '2026-10' });
  const carried = records.find((r) => r.line === 1);
  assert.equal(carried.kind, 'task');
  assert.equal(carried.date, '2026-10-21', 'lines before the first heading belong to the previous date');
  assert.equal(records.find((r) => r.line === 3).date, '2026-10-22');
  assert.equal(context.date, '2026-10-22');
  const nested = records.find((r) => r.line === 6);
  assert.equal(nested.indent, 2);
  assert.equal(nested.kind, 'note');
});

test('month and week headings', () => {
  assert.deepEqual(headingDate('2026-11 Monthly Log'), { month: '2026-11' });
  assert.deepEqual(headingDate('Week 2026-W43'), { week: '2026-W43' });
  assert.deepEqual(headingDate('Thu 2026-10-22'), { date: '2026-10-22' });
  assert.equal(headingDate('2026-02-30'), null, 'invalid day is not a date… and not a month either');
  assert.equal(headingDate('Books to read'), null);
});

test('code fences are not parsed as entries', () => {
  const { records } = parseLines('```\n- [ ] not a task\n```\n- [ ] real task\n');
  assert.deepEqual(
    records.filter((r) => r.kind === 'task').map((r) => r.line),
    [4],
  );
});

test('line counting matches nvim', () => {
  assert.equal(countLines(''), 0);
  assert.equal(countLines('a'), 1);
  assert.equal(countLines('a\n'), 1);
  assert.equal(countLines('a\nb\n'), 2);
  assert.equal(countLines('a\n\n'), 2);
  assert.equal(countLines('a\r\nb\r\n'), 2);
  assert.deepEqual(splitLines('x\ny'), ['x', 'y']);
});

test('page topic is the first heading, else the first line', () => {
  assert.equal(pageTopic('# Books to read\n- Dune\n'), 'Books to read');
  assert.equal(pageTopic('\n- [ ] call Mom\n## 2026-10-22\n'), 'call Mom');
  assert.equal(pageTopic('# C#\n'), 'C#');
});
