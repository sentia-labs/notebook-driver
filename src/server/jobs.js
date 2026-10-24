import crypto from 'node:crypto';

/**
 * Long-running operations the viewer shows live: ingests (automatic or requested), agent turns in
 * conversations. Kept in memory (the durable record is .nbd/runs/ and .nbd/conversations/);
 * every change is pushed to browsers through `publish`.
 *
 *   const job = jobs.begin({ kind: 'ingest', title: 'Sync now', cli: 'nbd sync' });
 *   job.event({ kind: 'tool', text: 'Reading notebook/p0007.md' });
 *   job.finish({ ok: true, text: 'Vault from p0007 · 2 new' });
 */
export class Jobs {
  constructor(publish = () => {}, { keep = 40 } = {}) {
    this.publish = publish;
    this.keep = keep;
    this.items = new Map();
  }

  begin({ kind, title, cli = null, href = null, convId = null }) {
    const job = {
      id: `j${crypto.randomBytes(4).toString('hex')}`,
      kind,
      title,
      cli,
      href,
      convId,
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      events: [],
      result: null,
    };
    this.items.set(job.id, job);
    while (this.items.size > this.keep) this.items.delete(this.items.keys().next().value);
    const push = () => this.publish({ type: 'job', job: publicJob(job) });
    let last = 0;
    let timer = null;
    const handle = {
      id: job.id,
      job,
      event: (ev) => {
        job.events.push({ at: new Date().toISOString(), kind: ev.kind, text: String(ev.text).slice(0, 600) });
        if (job.events.length > 60) job.events.splice(0, job.events.length - 60);
        // Agents can emit bursts of steps; browsers get at most a few updates a second.
        clearTimeout(timer);
        const wait = Math.max(0, 250 - (Date.now() - last));
        timer = setTimeout(() => {
          last = Date.now();
          push();
        }, wait);
      },
      finish: ({ ok, text = '', error = null, costUsd = null, links = [], href } = {}) => {
        clearTimeout(timer);
        job.status = ok ? 'ok' : 'failed';
        job.finishedAt = new Date().toISOString();
        job.result = { text, error, costUsd, links };
        if (href) job.href = href;
        push();
      },
    };
    push();
    return handle;
  }

  get(id) {
    const j = this.items.get(id);
    return j ? publicJob(j) : null;
  }

  list() {
    return [...this.items.values()].reverse().map(publicJob);
  }

  running(kind = null) {
    return this.list().filter((j) => j.status === 'running' && (!kind || j.kind === kind));
  }
}

function publicJob(j) {
  return { ...j, events: j.events.slice(-25), ms: (j.finishedAt ? Date.parse(j.finishedAt) : Date.now()) - Date.parse(j.startedAt) };
}
