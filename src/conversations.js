import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { headlessInvocation, runHeadless } from './harness.js';
import { Lock } from './state.js';
import { loggerFor } from './log.js';

// Agent conversations started from the viewer (asks, rituals, vault clean-ups), one turn per
// headless run. Claude keeps the thread with --resume; other harnesses get the transcript resent.
// Stored in .nbd/conversations/<id>.json so they survive restarts and can be reopened.

const ID_RE = /^c[0-9a-z]{6,24}$/;

/** The first prompt of `nbd ask` and the viewer's Ask. */
export function askPrompt(question) {
  return (
    `Answer from the second brain (see AGENTS.md "Query"). Read vault/index.md first, then the notes ` +
    `and notebook pages you need. Cite notes as [[note]] and pages as [[p0042]]. Don't modify anything.\n\nQuestion: ${question}`
  );
}

/** How a skill is started headlessly: a slash command for Claude, a pointer for other harnesses. */
export function skillPrompt(ctx, skill, args = '') {
  if (ctx.config.harness.kind === 'claude') return `/${skill}${args ? ` ${args}` : ''}`;
  return `Follow the skill in ${ctx.paths.home}/.claude/skills/${skill}/SKILL.md${args ? ` with arguments: ${args}` : ''}.`;
}

/** Appended to the system prompt on every browser turn. */
export const WEB_TURNS = [
  'You are talking with the human in a chat panel of their notebook viewer, one turn at a time.',
  'AskUserQuestion and other interactive tools are not available: ask in plain text, one question per turn,',
  'offer choices as a short list when it helps, then end your turn and wait for the reply.',
  'Write Markdown; link notes as [[note]] and pages as [[p0042]].',
].join(' ');

export class Conversations {
  constructor(ctx) {
    this.ctx = ctx;
    this.dir = path.join(ctx.paths.state, 'conversations');
    this.log = loggerFor(ctx, 'convo');
  }

  /**
   * kind: ask | ritual | lint; purpose: 'ask' (read-only) or 'ingest' (may write vault/).
   * firstPrompt is what the agent receives on turn one; opening is what the human sees for it.
   */
  create({ kind, title, purpose, firstPrompt, opening, cli = {}, meta = {} }) {
    const conv = {
      id: `c${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`,
      kind,
      title,
      purpose,
      harness: this.ctx.config.harness.kind,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sessionId: null,
      firstPrompt,
      cli,
      meta,
      costUsd: 0,
      turns: [{ role: 'human', text: opening ?? firstPrompt, at: new Date().toISOString() }],
    };
    this.save(conv);
    this.log.info(`new ${kind} conversation`, { id: conv.id, title });
    return conv;
  }

  get(id) {
    if (!ID_RE.test(String(id))) return null;
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir, `${id}.json`), 'utf8'));
    } catch {
      return null;
    }
  }

  list({ kind = null, limit = 30 } = {}) {
    let names = [];
    try {
      names = fs.readdirSync(this.dir).filter((n) => n.endsWith('.json'));
    } catch {}
    return names
      .map((n) => this.get(n.slice(0, -5)))
      .filter((c) => c && (!kind || c.kind === kind))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  save(conv) {
    conv.updatedAt = new Date().toISOString();
    fs.mkdirSync(this.dir, { recursive: true });
    const file = path.join(this.dir, `${conv.id}.json`);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(conv, null, 2));
    fs.renameSync(`${file}.tmp`, file);
  }

  /** The human's next message (null for the opening turn, already recorded by create). */
  addHuman(conv, text) {
    conv.turns.push({ role: 'human', text, at: new Date().toISOString() });
    this.save(conv);
  }

  /**
   * Run the agent's next turn. onEvent gets live progress ({kind:'tool'|'text'|'wait', text}).
   * Writing turns wait for any running ingest (they share its lock) so two agents never edit at once.
   */
  async agentTurn(conv, { onEvent, onSpawn } = {}) {
    const { ctx } = this;
    const claude = ctx.config.harness.kind === 'claude';
    const first = conv.turns.filter((t) => t.role === 'agent').length === 0;
    const last = conv.turns[conv.turns.length - 1];
    let prompt;
    if (first) prompt = conv.firstPrompt;
    else if (claude && conv.sessionId) prompt = last.text;
    else prompt = transcriptPrompt(conv);

    const lock = conv.purpose === 'ask' ? null : new Lock(path.join(ctx.paths.state, 'ingest.lock'));
    if (lock && !(await acquire(lock, onEvent))) {
      return this.#record(conv, { ok: false, error: 'the background agent is still busy; try again in a minute' });
    }
    try {
      const inv = headlessInvocation(ctx, {
        prompt,
        purpose: conv.purpose,
        name: `nbd ${conv.kind}: ${conv.title}`.slice(0, 80),
        resume: claude && !first ? conv.sessionId : null,
        system: WEB_TURNS,
      });
      const r = await runHeadless(ctx, inv, { onEvent, onSpawn });
      return this.#record(conv, r);
    } finally {
      lock?.release();
    }
  }

  #record(conv, r) {
    const turn = {
      role: 'agent',
      at: new Date().toISOString(),
      ok: r.ok,
      text: r.ok ? r.text || '(no reply)' : `The agent failed: ${r.error}`,
      ms: r.durationMs,
      costUsd: r.costUsd ?? null,
    };
    conv.turns.push(turn);
    if (r.sessionId) conv.sessionId = r.sessionId;
    conv.costUsd = (conv.costUsd ?? 0) + (r.costUsd ?? 0);
    this.save(conv);
    return turn;
  }
}

/** For harnesses that can't resume: the whole exchange, then the latest message. */
function transcriptPrompt(conv) {
  const lines = [conv.firstPrompt, '', '## Conversation so far', ''];
  for (const t of conv.turns.slice(1, -1)) lines.push(`**${t.role === 'human' ? 'Human' : 'You'}:** ${t.text}`, '');
  lines.push('## The human now says', '', conv.turns[conv.turns.length - 1].text);
  return lines.join('\n');
}

async function acquire(lock, onEvent, timeoutMs = 15 * 60_000) {
  const end = Date.now() + timeoutMs;
  let told = false;
  while (!lock.acquire()) {
    if (Date.now() > end) return false;
    if (!told) {
      onEvent?.({ kind: 'wait', text: 'Waiting for the background ingest to finish…' });
      told = true;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return true;
}
