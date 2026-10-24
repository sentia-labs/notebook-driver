// Stands in for Claude Code in tests: reads the ingest prompt, writes vault notes, prints a summary.
import fs from 'node:fs';
import path from 'node:path';

const prompt = process.argv[process.argv.length - 1];
const home = process.cwd();
const write = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
  fs.writeFileSync(path.join(home, rel), text);
};
// Conversations from the viewer: answer without touching anything.
if (prompt.includes('## The human now says')) {
  console.log(`Follow-up: you said "${prompt.split('## The human now says').pop().trim()}".`);
  process.exit(0);
}
if (prompt.includes('Answer from the second brain')) {
  console.log('From [[p0001]]: the design is drafted.');
  process.exit(0);
}
if (prompt.includes('Follow the skill in')) {
  console.log(`How was the week, in a word? (${/skills\/([\w-]+)\//.exec(prompt)?.[1]})`);
  process.exit(0);
}
if (prompt.includes('# Repair: `nbd lint` found problems')) {
  // The repair turn: fix the YAML it got wrong.
  const file = path.join(home, 'vault/resources/sloppy.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('description: Runs: easy ones', 'description: "Runs: easy ones"'));
  console.log('Quoted the description.');
  process.exit(0);
}
if (process.env.FAKE_AGENT_BAD_YAML) {
  write('vault/resources/sloppy.md', '---\ntype: concept\ndescription: Runs: easy ones\nsources:\n  - "[[p0001]]"\n---\n# Sloppy\n');
}
if (process.env.FAKE_AGENT_FAIL) {
  console.error('model overloaded');
  process.exit(1);
}
const pages = [...prompt.matchAll(/^### (p\d+) · (new|modified|deleted)/gm)].map((m) => m[1]);
const nextId = /Next free question id: (q\d+)/.exec(prompt)?.[1];
for (const p of pages) {
  const first = fs.readFileSync(path.join(home, 'notebook', `${p}.md`), 'utf8').split('\n')[0].replace(/^#\s*/, '');
  write(`vault/resources/${p}-digest.md`, `---\ntype: concept\ntitle: Digest of ${p}\ndescription: What ${p} says\nsources:\n  - "[[${p}]]"\n---\n# Digest of ${p}\n\nSeen.[^${p}]\n\n[^${p}]: [[${p}]] · "${first}"\n`);
}
if (nextId && pages.length) {
  write(`vault/inbox/${nextId}.md`, `---\ntype: question\nid: ${nextId}\nstatus: open\nsources:\n  - "[[${pages[0]}]]"\n---\n# Who is J.?\n\nOn [[${pages[0]}]]…\n\n## Answer\n`);
}
for (const m of prompt.matchAll(/^- (q\d+) — .* → (vault\/inbox\/q\d+\.md)$/gm)) {
  const file = path.join(home, m[2]);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('status: answered', 'status: resolved'));
}
if (process.env.FAKE_AGENT_TOUCH_NOTEBOOK) fs.appendFileSync(path.join(home, 'notebook', `${pages[0]}.md`), '- sneaky\n');
fs.appendFileSync(path.join(home, 'vault/log.md'), `## [2026-10-22] ingest | ${pages.join(', ')}\n`);
console.log(`Filed ${pages.length} page(s).`);
