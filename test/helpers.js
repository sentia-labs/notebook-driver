import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULTS, homePaths } from '../src/config.js';
import { deepMerge } from '../src/util.js';

/** A throwaway notebook home: { home, paths, config, write(rel, text), read(rel), cleanup() } */
export function tempHome(files = {}, configOverrides = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nbd-test-'));
  const paths = homePaths(home);
  for (const d of [paths.notebook, paths.vault, paths.inbox, paths.state]) fs.mkdirSync(d, { recursive: true });
  const write = (rel, text) => {
    const abs = path.join(home, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
    return abs;
  };
  for (const [rel, text] of Object.entries(files)) write(rel, text);
  const config = deepMerge(DEFAULTS, configOverrides);
  return {
    home,
    paths,
    config,
    ctx: { home, paths, config },
    write,
    read: (rel) => fs.readFileSync(path.join(home, rel), 'utf8'),
    exists: (rel) => fs.existsSync(path.join(home, rel)),
    cleanup: () => fs.rmSync(home, { recursive: true, force: true }),
  };
}

export const PAGE1 = `# 2026-10-21 Wed
- [x] draft notebook-driver design
- [>] email Ana about the offsite
- o standup moved to 10:30
- ! pages should feel like paper
`;

export const PAGE2 = `- [ ] carried over from yesterday
## 2026-10-22 Thu
- [ ] * call Mom re: Thanksgiving
- [/] wire the viewer
- o lunch w/ J. re: Q4 budget
  - J. wants numbers by Friday
- ? does mermaid render in previews
- [-] old idea
`;
