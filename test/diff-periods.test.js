import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unifiedDiff, diffStats } from '../src/diff.js';
import {
  isoWeek,
  nextPeriod,
  periodLabel,
  periodOf,
  periodRange,
  previousPeriod,
  reviewablePeriod,
  ymd,
} from '../src/periods.js';

test('unified diff with new-file line numbers', () => {
  assert.equal(unifiedDiff('a\nb\n', 'a\nb\n'), '');
  const d = unifiedDiff('a\nb\nc\n', 'a\nB\nc\nd\n', { context: 1 });
  assert.match(d, /^--- before\n\+\+\+ after\n@@ -1,3 \+1,4 @@\n a\n-b\n\+B\n c\n\+d$/);
  assert.deepEqual(diffStats('a\nb\n', 'a\nc\nd\n'), { added: 2, removed: 1 });
  const far = unifiedDiff('1\n2\n3\n4\n5\n6\n7\n8\n9\n', '1\nX\n3\n4\n5\n6\n7\nY\n9\n', { context: 1 });
  assert.equal((far.match(/^@@/gm) ?? []).length, 2, 'distant changes get separate hunks');
});

test('ISO weeks, including year boundaries', () => {
  assert.deepEqual(isoWeek(new Date(2026, 9, 22)), { year: 2026, week: 43 });
  assert.deepEqual(isoWeek(new Date(2026, 0, 1)), { year: 2026, week: 1 }); // Thursday
  assert.deepEqual(isoWeek(new Date(2027, 0, 1)), { year: 2026, week: 53 }); // Friday
  assert.deepEqual(isoWeek(new Date(2024, 11, 30)), { year: 2025, week: 1 });
  assert.equal(periodOf('weekly', new Date(2027, 0, 1)), '2026-W53');
});

test('period ranges and neighbours', () => {
  const w = periodRange('weekly', '2026-W43');
  assert.equal(ymd(w.start), '2026-10-19');
  assert.equal(ymd(w.end), '2026-10-25');
  assert.equal(ymd(periodRange('monthly', '2026-02').end), '2026-02-28');
  assert.equal(ymd(periodRange('quarterly', '2026-Q4').start), '2026-10-01');
  assert.equal(ymd(periodRange('yearly', '2026').end), '2026-12-31');
  assert.equal(previousPeriod('weekly', '2026-W01'), '2025-W52');
  assert.equal(nextPeriod('monthly', '2026-12'), '2027-01');
  assert.equal(nextPeriod('quarterly', '2026-Q4'), '2027-Q1');
  assert.match(periodLabel('weekly', '2026-W43'), /Week 43 \(Oct 19 – Oct 25, 2026\)/);
});

test('a review becomes available leadDays before the period ends, at a time of day', () => {
  const opts = { leadDays: 0, time: '16:00' };
  // Sunday Oct 25 2026, 15:59 → last week is the one to review; 16:00 → this week.
  assert.equal(reviewablePeriod('weekly', new Date(2026, 9, 25, 15, 59), opts), '2026-W42');
  assert.equal(reviewablePeriod('weekly', new Date(2026, 9, 25, 16, 0), opts), '2026-W43');
  assert.equal(reviewablePeriod('weekly', new Date(2026, 9, 22, 9, 0), opts), '2026-W42');
  assert.equal(reviewablePeriod('monthly', new Date(2026, 9, 31, 17, 0), opts), '2026-10');
  assert.equal(reviewablePeriod('monthly', new Date(2026, 10, 2, 9, 0), opts), '2026-10');
  assert.equal(reviewablePeriod('yearly', new Date(2026, 11, 27, 11, 0), { leadDays: 5, time: '10:00' }), '2026');
  assert.equal(reviewablePeriod('yearly', new Date(2026, 11, 20, 11, 0), { leadDays: 5, time: '10:00' }), '2025');
});
