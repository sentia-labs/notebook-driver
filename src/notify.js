import { spawn } from 'node:child_process';

/**
 * Send a desktop notification. Uses notify-send by default (works with mako, dunst, GNOME, KDE);
 * `config.notify.command` can replace it with any argv template using {title} {body} {url}.
 * With notify-send, clicking the notification opens `url` in the browser.
 */
export function notify(config, { title, body = '', url = null, urgency = 'normal' }) {
  if (!config.notify?.enabled) return;
  const fill = (s) => s.replaceAll('{title}', title).replaceAll('{body}', body).replaceAll('{url}', url ?? '');
  let cmd;
  let args;
  if (config.notify.command) {
    [cmd, ...args] = config.notify.command.map(fill);
  } else {
    cmd = 'notify-send';
    args = [`--app-name=${config.name || 'Notebook'}`, `--urgency=${urgency}`, '--icon=accessories-text-editor'];
    if (url) args.push('--action=default=Open', '--wait');
    args.push(title, body);
  }
  try {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'], detached: false });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => {}); // no notifier installed: stay quiet
    child.on('close', () => {
      if (url && !config.notify.command && out.trim() === 'default') openUrl(url);
    });
    child.unref();
  } catch {
    // Notifications are best-effort.
  }
}

export function openUrl(url) {
  try {
    const child = spawn('xdg-open', [url], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {}
}
