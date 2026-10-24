import YAML from 'yaml';

const FM_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/**
 * Split YAML frontmatter from a markdown document.
 * Returns { data, body, bodyLine } where bodyLine is the 0-based line the body starts at.
 * Invalid YAML yields data = {} and `error`, and the body still excludes the block.
 */
export function splitFrontmatter(text) {
  const m = FM_RE.exec(text);
  if (!m) return { data: {}, body: text, bodyLine: 0 };
  const body = text.slice(m[0].length);
  const bodyLine = m[0].split('\n').length - (m[0].endsWith('\n') ? 1 : 0);
  try {
    const data = YAML.parse(m[1]) ?? {};
    return { data: typeof data === 'object' && !Array.isArray(data) ? data : {}, body, bodyLine };
  } catch (err) {
    // Agents sometimes write `description: a: b` unquoted. Keep the error (lint reports it) but
    // recover what a flat key/value reading gives, so the note still shows up correctly.
    return { data: lenientFlatYaml(m[1]), body, bodyLine, error: err.message.split('\n')[0] };
  }
}

/** Best-effort reading of flat frontmatter: `key: value`, `key: [a, b]`, and `- item` lists. */
export function lenientFlatYaml(src) {
  const out = {};
  let listKey = null;
  for (const line of src.split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      out[listKey].push(unquote(item[1]));
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(line);
    if (!kv) continue;
    const [, key, raw = ''] = kv;
    listKey = null;
    const v = raw.trim();
    if (v === '') {
      out[key] = [];
      listKey = key;
    } else if (v.startsWith('[') && v.endsWith(']')) {
      out[key] = v.slice(1, -1).split(',').map((x) => unquote(x.trim())).filter(Boolean);
    } else {
      out[key] = unquote(v);
    }
  }
  for (const [k, v] of Object.entries(out)) if (Array.isArray(v) && v.length === 0) delete out[k];
  return out;
}

function unquote(s) {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1).replace(/\\"/g, '"');
  return t;
}

/** Set or delete (value === undefined) frontmatter keys, keeping the rest of the block intact. */
export function updateFrontmatter(text, patch) {
  const m = FM_RE.exec(text);
  const doc = m ? YAML.parseDocument(m[1]) : new YAML.Document({});
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) doc.delete(k);
    else doc.set(k, v);
  }
  const yaml = doc.toString({ lineWidth: 0 }).trimEnd();
  const body = m ? text.slice(m[0].length) : text;
  return `---\n${yaml}\n---\n${body}`;
}

/** Normalise a frontmatter value that may be a scalar or list into an array of strings. */
export function asList(v) {
  if (v === undefined || v === null || v === '') return [];
  return (Array.isArray(v) ? v : [v]).map(String);
}
