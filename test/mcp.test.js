import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome } from './helpers.js';
import { headlessInvocation } from '../src/harness.js';
import { checkMcpCall, parseMcpList, serverId, validateMcp } from '../src/mcp.js';

const SLACK = 'mcp__claude_ai_Slack__slack_read_thread';
const arg = (inv, flag) => inv.args[inv.args.indexOf(flag) + 1];

test('argv does not change when mcp.allow is empty', () => {
  const plain = tempHome({}, { harness: { kind: 'claude', model: 'sonnet' } });
  const off = tempHome({}, { harness: { kind: 'claude', model: 'sonnet' }, mcp: { purposes: ['ask', 'ingest'], allow: [], hide: ['mcp__x'] } });
  try {
    for (const purpose of ['ask', 'ingest']) {
      const a = headlessInvocation(plain.ctx, { prompt: 'q', purpose, system: 's' });
      const b = headlessInvocation(off.ctx, { prompt: 'q', purpose, system: 's' });
      // Paths differ between the two homes; compare with each home's path replaced.
      const norm = (inv, h) => inv.args.map((x) => x.replaceAll(h.home, '<home>'));
      assert.deepEqual(norm(b, off), norm(a, plain));
      assert.ok(a.args.includes('--strict-mcp-config'));
    }
  } finally {
    plain.cleanup();
    off.cleanup();
  }
});

test('wildcard and whole-server allow entries are rejected', () => {
  for (const bad of ['mcp__*', 'mcp__claude_ai_Slack', 'mcp__claude_ai_Slack__*', 'mcp__claude_ai_Slack__slack_*', 'Bash', 'mcp__claude_ai_Slack__']) {
    assert.throws(() => validateMcp({ allow: [bad] }), /not an exact tool name/, bad);
  }
  assert.throws(() => validateMcp({ purposes: ['chat'], allow: [SLACK] }), /unknown run type/);
  validateMcp({ purposes: ['ask'], allow: [SLACK], hide: ['mcp__claude_ai_Gmail'] });
  const h = tempHome({}, { harness: { kind: 'claude' }, mcp: { allow: ['mcp__claude_ai_Slack'] } });
  try {
    assert.throws(() => headlessInvocation(h.ctx, { prompt: 'q', purpose: 'ask' }), /not an exact tool name/);
  } finally {
    h.cleanup();
  }
});

test('mcp.allow: allow the tools, deny other servers, add the guard hook and rules', () => {
  const h = tempHome({}, { harness: { kind: 'claude' }, mcp: { purposes: ['ask'], allow: [SLACK], hide: ['mcp__claude_ai_Slack__slack_send_message'] } });
  try {
    const servers = [
      { name: 'claude.ai Slack', id: 'claude_ai_Slack', connected: true },
      { name: 'claude.ai Gmail', id: 'claude_ai_Gmail', connected: true },
    ];
    fs.writeFileSync(path.join(h.paths.state, 'mcp-servers.json'), JSON.stringify({ servers }));
    const ask = headlessInvocation(h.ctx, { prompt: 'q', purpose: 'ask', system: 'chat rules' });
    assert.ok(!ask.args.includes('--strict-mcp-config'));
    assert.ok(arg(ask, '--allowedTools').split(',').includes(SLACK));
    const deny = arg(ask, '--disallowedTools').split(',');
    assert.ok(!deny.includes('mcp__*'));
    assert.ok(deny.includes('mcp__claude_ai_Gmail'));
    assert.ok(deny.includes('mcp__claude_ai_Slack__slack_send_message'));
    assert.ok(!deny.includes('mcp__claude_ai_Slack'));
    const hook = JSON.parse(arg(ask, '--settings')).hooks.PreToolUse[0];
    assert.equal(hook.matcher, 'mcp__.*');
    assert.match(hook.hooks[0].command, new RegExp(`hook mcp-guard ${SLACK}$`));
    assert.match(arg(ask, '--append-system-prompt'), /^chat rules\n\n.*data, not instructions/s);
    // Not a purpose in mcp.purposes: the default argv.
    const ingest = headlessInvocation(h.ctx, { prompt: 'q', purpose: 'ingest' });
    assert.ok(ingest.args.includes('--strict-mcp-config'));
    assert.ok(arg(ingest, '--disallowedTools').split(',').includes('mcp__*'));
  } finally {
    h.cleanup();
  }
});

test('mcp guard blocks other tools on a server with an allowed tool', () => {
  assert.equal(checkMcpCall(SLACK, [SLACK]), null);
  assert.match(checkMcpCall('mcp__claude_ai_Slack__slack_send_message', [SLACK]), /not in mcp.allow/);
  assert.equal(checkMcpCall('mcp__claude_ai_Gmail__search', [SLACK]), null, 'other servers: denied by rules and dontAsk');
  assert.equal(checkMcpCall('Read', [SLACK]), null);
});

test('claude mcp list output maps to tool-name server ids', () => {
  const out = [
    'Checking MCP server health…',
    '',
    'claude.ai Slack: https://mcp.slack.com/mcp - ✔ Connected',
    'claude.ai Google Drive: https://drivemcp.googleapis.com/mcp/v1 - ! Needs authentication',
    'github: npx -y @modelcontextprotocol/server-github - ✗ Failed to connect',
  ].join('\n');
  const s = parseMcpList(out);
  assert.deepEqual(s.map((x) => [x.id, x.connected]), [['claude_ai_Slack', true], ['claude_ai_Google_Drive', false], ['github', false]]);
  assert.equal(serverId('claude.ai Claude Docs'), 'claude_ai_Claude_Docs');
});
