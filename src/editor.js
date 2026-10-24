import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * argv for "Open in editor" from the viewer: `editor.command` from nbd.json, else nvim in the
 * desktop's default terminal through xdg-terminal-exec when it is installed. null = not available
 * (the viewer then only shows the commands to run yourself).
 */
export async function editorCommand(config) {
  if (Array.isArray(config.editor?.command) && config.editor.command.length) return config.editor.command;
  try {
    await run('sh', ['-c', 'command -v xdg-terminal-exec']);
    return ['xdg-terminal-exec', 'nvim', '+{line}', '{file}'];
  } catch {
    return null;
  }
}

/** Launch the editor detached; resolves once it started (or rejects with why it couldn't). */
export async function openInEditor(config, file, line = 1) {
  const tpl = await editorCommand(config);
  if (!tpl) throw new Error('no editor command: set "editor": {"command": [...]} in nbd.json');
  const [cmd, ...args] = tpl.map((a) => a.replaceAll('{file}', file).replaceAll('{line}', String(line)));
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.once('error', (err) => reject(err.code === 'ENOENT' ? new Error(`${cmd} not found`) : err));
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
  return [cmd, ...args];
}
