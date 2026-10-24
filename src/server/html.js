import { escapeHtml } from '../util.js';

// Tagged template that escapes every interpolation unless it is wrapped in raw().
// Arrays are joined; null/undefined/false render as nothing.

class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

export const raw = (s) => new Raw(String(s ?? ''));

function emit(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(emit).join('');
  return escapeHtml(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += emit(values[i]) + strings[i + 1];
  return new Raw(out);
}
