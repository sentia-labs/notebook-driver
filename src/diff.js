import { splitLines } from './bujo.js';

// Pages are at most a few dozen lines, so a plain LCS table is plenty.
function lcsOps(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ op: ' ', text: a[i], oldLine: i + 1, newLine: j + 1 });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ op: '-', text: a[i], oldLine: i + 1 });
      i++;
    } else {
      ops.push({ op: '+', text: b[j], newLine: j + 1 });
      j++;
    }
  }
  while (i < n) ops.push({ op: '-', text: a[i], oldLine: ++i });
  while (j < m) ops.push({ op: '+', text: b[j], newLine: ++j });
  return ops;
}

/**
 * Unified diff between two texts. Returns '' when they are equal.
 * Hunk headers use new-file line numbers so the agent can cite lines of the current page.
 */
export function unifiedDiff(oldText, newText, { context = 2, oldName = 'before', newName = 'after' } = {}) {
  const a = splitLines(oldText ?? '');
  const b = splitLines(newText ?? '');
  const ops = lcsOps(a, b);
  if (ops.every((o) => o.op === ' ')) return '';

  const changed = ops.map((o, idx) => (o.op !== ' ' ? idx : -1)).filter((i) => i >= 0);
  const hunks = [];
  let start = Math.max(0, changed[0] - context);
  let end = Math.min(ops.length - 1, changed[0] + context);
  for (const idx of changed.slice(1)) {
    if (idx - context <= end + 1) end = Math.min(ops.length - 1, idx + context);
    else {
      hunks.push([start, end]);
      start = Math.max(0, idx - context);
      end = Math.min(ops.length - 1, idx + context);
    }
  }
  hunks.push([start, end]);

  const out = [`--- ${oldName}`, `+++ ${newName}`];
  for (const [s, e] of hunks) {
    const slice = ops.slice(s, e + 1);
    const oldStart = firstLine(ops, s, 'oldLine');
    const newStart = firstLine(ops, s, 'newLine');
    const oldCount = slice.filter((o) => o.op !== '+').length;
    const newCount = slice.filter((o) => o.op !== '-').length;
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const o of slice) out.push(`${o.op}${o.text}`);
  }
  return out.join('\n');
}

// The line number a hunk starts at: the first op in it that carries one, or the line after the
// last earlier op that does (for hunks that only insert or only delete).
function firstLine(ops, from, key) {
  for (let i = from; i < ops.length; i++) if (ops[i][key]) return ops[i][key];
  for (let i = from - 1; i >= 0; i--) if (ops[i][key]) return ops[i][key] + 1;
  return 1;
}

/** Summary counts of a diff: lines added/removed. */
export function diffStats(oldText, newText) {
  const ops = lcsOps(splitLines(oldText ?? ''), splitLines(newText ?? ''));
  return {
    added: ops.filter((o) => o.op === '+').length,
    removed: ops.filter((o) => o.op === '-').length,
  };
}
