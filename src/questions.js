import fs from 'node:fs';
import path from 'node:path';
import { splitFrontmatter, updateFrontmatter, asList } from './frontmatter.js';
import { localIso, readText, writeFileAtomic } from './util.js';

// Clarification questions live in vault/inbox/qNNNN.md. The agent writes them (status: open);
// the human answers through the viewer, nvim, the CLI or a guided session (status: answered);
// the agent applies the answer on its next run (status: resolved). See AGENTS.md "Questions".

const Q_FILE_RE = /^q(\d{4,})\.md$/;

export function listQuestions(paths) {
  let names = [];
  try {
    names = fs.readdirSync(paths.inbox);
  } catch {}
  return names
    .filter((n) => Q_FILE_RE.test(n))
    .sort()
    .map((n) => readQuestion(paths, n.slice(0, -3)))
    .filter(Boolean);
}

export function readQuestion(paths, id) {
  const file = path.join(paths.inbox, `${id}.md`);
  const text = readText(file);
  if (text == null) return null;
  const { data, body } = splitFrontmatter(text);
  const h1 = /^#\s+(.+)$/m.exec(body);
  return {
    id,
    file,
    rel: `vault/inbox/${id}.md`,
    status: String(data.status ?? 'open'),
    title: h1 ? h1[1].trim() : id,
    asked: data.asked ? String(data.asked) : null,
    answered: data.answered ? String(data.answered) : null,
    sources: asList(data.sources),
    options: asList(data.options),
    answer: sectionText(body, 'Answer'),
    body,
  };
}

export function nextQuestionId(paths) {
  let max = 0;
  try {
    for (const n of fs.readdirSync(paths.inbox)) {
      const m = Q_FILE_RE.exec(n);
      if (m) max = Math.max(max, Number(m[1]));
    }
  } catch {}
  return `q${String(max + 1).padStart(4, '0')}`;
}

/** Store the human's answer in the question file and mark it answered. */
export function recordAnswer(paths, id, answer, { via = 'cli' } = {}) {
  if (!/^q\d{4,}$/.test(id)) throw new Error(`Bad question id: ${id}`);
  const file = path.join(paths.inbox, `${id}.md`);
  const text = readText(file);
  if (text == null) throw new Error(`No such question: ${id}`);
  const clean = String(answer).replace(/\r\n?/g, '\n').trim();
  if (!clean) throw new Error('Empty answer');
  let next = updateFrontmatter(text, { status: 'answered', answered: localIso(), answered_via: via });
  next = replaceSection(next, 'Answer', clean);
  writeFileAtomic(file, next);
  return readQuestion(paths, id);
}

export function dismissQuestion(paths, id) {
  const file = path.join(paths.inbox, `${id}.md`);
  const text = readText(file);
  if (text == null) throw new Error(`No such question: ${id}`);
  writeFileAtomic(file, updateFrontmatter(text, { status: 'dismissed', dismissed: localIso() }));
}

/** Text under a "## <name>" heading, up to the next heading of level ≤ 2. */
export function sectionText(body, name) {
  const re = new RegExp(`^##[ \\t]+${name}[ \\t]*$`, 'mi');
  const m = re.exec(body);
  if (!m) return '';
  const rest = body.slice(m.index + m[0].length);
  const next = /^#{1,2}\s/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).replace(/<!--[\s\S]*?-->/g, '').trim();
}

function replaceSection(text, name, content) {
  const re = new RegExp(`^##[ \\t]+${name}[ \\t]*$`, 'mi');
  const m = re.exec(text);
  if (!m) return `${text.replace(/\s*$/, '')}\n\n## ${name}\n\n${content}\n`;
  const start = m.index + m[0].length;
  const rest = text.slice(start);
  const next = /^#{1,2}\s/m.exec(rest);
  const tail = next ? `\n\n${rest.slice(next.index)}` : '\n';
  return `${text.slice(0, start)}\n\n${content}${tail}`;
}
