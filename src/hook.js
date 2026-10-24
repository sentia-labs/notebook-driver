import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_FILE, homePaths, resolveHome } from './config.js';
import { createLogger, logFile } from './log.js';

// Claude Code PreToolUse hook: the notebook is the human's, so no agent tool call may write there.
// Permission rules in .claude/settings.json already deny Edit/Write under notebook/; this hook is
// the backstop for shell commands (redirections, sed -i, mv, git checkout, ...) in interactive
// sessions where the human might approve a Bash call without reading it closely.

const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
// Things that can modify a file when they name it.
const MUTATING = [
  />>?\s*['"]?[^\s'"|;&]*notebook\//,
  /\b(sed|perl|ruby)\b[^|;&]*\s-[a-zA-Z]*i/,
  /\b(tee|mv|cp|rm|rmdir|truncate|dd|install|ln|touch|chmod|chown|unlink|shred|rsync|patch)\b/,
  /\bgit\s+(checkout|restore|reset|mv|rm|stash|clean|apply|am|merge|rebase|pull|switch)\b/,
  /\b(python3?|node|deno|bun)\b[^|;&]*\s-(c|e)\b/,
];

export function checkToolCall(input, home) {
  const notebook = path.join(home, 'notebook');
  const cwd = input.cwd || home;
  const inNotebook = (p) => {
    if (!p) return false;
    const abs = path.resolve(cwd, String(p));
    return abs === notebook || abs.startsWith(notebook + path.sep);
  };
  const tool = input.tool_name;
  const ti = input.tool_input ?? {};
  if (FILE_TOOLS.has(tool) && inNotebook(ti.file_path ?? ti.notebook_path ?? ti.path)) {
    return `The notebook is the human's handwriting and is read-only for agents. Write to vault/ instead; if a page needs changing, tell the human what to write.`;
  }
  if (tool === 'Bash' && typeof ti.command === 'string') {
    const cmd = ti.command;
    const mentions = cmd.includes(notebook) || /(^|[\s'"=(/])notebook\//.test(cmd) || (path.resolve(cwd) === notebook || path.resolve(cwd).startsWith(notebook + path.sep));
    if (mentions && MUTATING.some((re) => re.test(cmd))) {
      return `This command could modify notebook pages, which are read-only for agents. Read them with cat/grep, and write only under vault/.`;
    }
  }
  return null;
}

// Claude Code treats exit code 2 as "block" (stderr goes back to the model); any other failure
// would let the tool run, so every error path exits 2: when in doubt, the notebook stays untouched.
export async function runHook(name) {
  if (name !== 'pre-tool-use') throw new Error('Usage: nbd hook pre-tool-use  (reads the Claude Code hook payload on stdin)');
  const block = (why) => {
    process.stderr.write(`${why}\n`);
    process.exit(2);
  };
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    block('notebook guard: could not read the hook payload, so the call is blocked to be safe.');
  }
  try {
    // The session's project is the notebook home; $NBD_HOME may point at a different one.
    const project = process.env.CLAUDE_PROJECT_DIR;
    const home =
      project && fs.existsSync(path.join(project, CONFIG_FILE))
        ? project
        : resolveHome({ cwd: input.cwd || process.cwd(), env: {} });
    const reason = checkToolCall(input, home);
    if (reason) {
      // Worth knowing about: an agent tried to touch the notebook. (File only: stderr is the agent's.)
      try {
        const log = createLogger({ file: logFile(homePaths(home)), stream: null }).child('guard');
        log.warn(`blocked ${input.tool_name}`, { reason, input: JSON.stringify(input.tool_input ?? {}).slice(0, 300), session: input.session_id });
        log.close();
      } catch {}
      block(reason);
    }
  } catch (err) {
    block(`notebook guard failed (${err.message}); blocking to be safe.`);
  }
}
