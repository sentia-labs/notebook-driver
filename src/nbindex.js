import { headingDate } from './bujo.js';
import { periodLabel } from './periods.js';

// The Bullet Journal Index, kept automatically: collections and logs → page numbers.
// Daily logs aren't indexed in a paper BuJo; here they're summarized as page ranges per month.

/** "2–4, 7, 9" from [2, 3, 4, 7, 9] */
export function pageRanges(nums) {
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]));
    i = j;
  }
  return out.join(', ');
}

/** [{ section, entries: [{ label, pages: [num], first }] }] from Library#parsedPages(). */
export function notebookIndex(parsed) {
  const groups = { special: new Map(), monthly: new Map(), weekly: new Map(), collections: new Map(), daily: new Map() };
  const add = (map, key, label, num) => {
    const e = map.get(key) ?? { label, pages: [], first: num };
    e.pages.push(num);
    map.set(key, e);
  };
  for (const { doc, dates } of parsed) {
    const topic = doc.title.trim();
    const d = headingDate(topic);
    if (/^future\s+log\b/i.test(topic)) add(groups.special, 'future', 'Future Log', doc.num);
    else if (/^intentions\b/i.test(topic)) add(groups.special, 'intentions', 'Intentions', doc.num);
    else if (/^(index|key)$/i.test(topic)) add(groups.special, topic.toLowerCase(), topic, doc.num);
    else if (d?.date || (!topic && dates.from)) {
      const month = (d?.date ?? dates.from).slice(0, 7);
      add(groups.daily, month, periodLabel('monthly', month), doc.num);
    } else if (d?.month) add(groups.monthly, d.month, periodLabel('monthly', d.month), doc.num);
    else if (d?.week) add(groups.weekly, d.week, `${d.week} · ${topic.replace(d.week, '').trim() || 'week'}`, doc.num);
    else if (topic) add(groups.collections, topic.toLowerCase().replace(/[\s:–-]+(cont(inued)?\.?|\(cont\.?\))$/i, ''), topic, doc.num);
  }
  const sections = [
    ['', [...groups.special.values()]],
    ['Monthly logs', [...groups.monthly.entries()].sort(([a], [b]) => (a < b ? 1 : -1)).map(([, e]) => e)],
    ['Weekly reviews', [...groups.weekly.entries()].sort(([a], [b]) => (a < b ? 1 : -1)).map(([, e]) => e)],
    ['Collections', [...groups.collections.values()].sort((a, b) => a.label.localeCompare(b.label))],
    ['Daily logs', [...groups.daily.entries()].sort(([a], [b]) => (a < b ? 1 : -1)).map(([, e]) => e)],
  ];
  return sections.filter(([, entries]) => entries.length).map(([section, entries]) => ({ section, entries }));
}
