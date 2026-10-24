import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const UNIT = 'notebook-driver.service';
const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/nbd.js');

/** The systemd --user unit that keeps the daemon running. */
export function unitText(ctx) {
  const home = os.homedir();
  const shims = path.join(home, '.local/share/mise/shims');
  const node = fs.existsSync(path.join(shims, 'node')) ? path.join(shims, 'node') : process.execPath;
  // systemd doesn't read shell profiles: give the agent CLIs (claude, codex) and notify-send a PATH.
  const pathDirs = [
    ...(fs.existsSync(shims) ? [shims] : []),
    path.join(home, '.local/bin'),
    ...String(process.env.PATH ?? '').split(':').filter((d) => d && !d.includes('/mise/installs/')),
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ];
  const uniq = [...new Set(pathDirs)].join(':');
  return `[Unit]
Description=Notebook driver: page watcher, AI vault agent and viewer for ${ctx.paths.home}
After=graphical-session.target network-online.target
PartOf=graphical-session.target

[Service]
Type=simple
ExecStart=${node} ${BIN} daemon --home ${ctx.paths.home}
Environment=PATH=${uniq}
Environment=NBD_HOME=${ctx.paths.home}
Restart=on-failure
RestartSec=15

[Install]
WantedBy=graphical-session.target
`;
}

export function installService(ctx, action) {
  const dir = path.join(os.homedir(), '.config/systemd/user');
  const file = path.join(dir, UNIT);
  const sc = (...args) => spawnSync('systemctl', ['--user', ...args], { stdio: 'inherit' });
  switch (action) {
    case 'print':
      process.stdout.write(unitText(ctx));
      return;
    case 'install':
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, unitText(ctx));
      console.log(`wrote ${file}`);
      sc('daemon-reload');
      sc('enable', '--now', UNIT);
      console.log(`\nLogs: nbd logs -f   (or journalctl --user -u ${UNIT} -f)`);
      return;
    case 'uninstall':
      sc('disable', '--now', UNIT);
      fs.rmSync(file, { force: true });
      sc('daemon-reload');
      console.log(`removed ${file}`);
      return;
    case 'restart':
    case 'stop':
    case 'start':
    case 'status': {
      const r = sc(action, ...(action === 'status' ? ['--no-pager'] : []), UNIT);
      if (action !== 'status' && r.status === 0) console.log(`${action === 'stop' ? 'stopped' : `${action}ed`} ${UNIT}`);
      process.exitCode = r.status ?? 1;
      return;
    }
    default:
      throw new Error('Usage: nbd service install|uninstall|restart|stop|start|status|print');
  }
}
