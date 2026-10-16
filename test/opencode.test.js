'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const { OpenCodeAdapter, normalizeEvent, tryParseJsonLine } = require('../src/adapters/openCodeAdapter');
const { parseOpenCodeVerbose } = require('../src/discovery/modelCatalog');

function ndjson(lines) {
  return lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n';
}

function fakeStreaming(chunks, exitCode) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = (sig) => {
    child.killedWith = sig;
    child.exitCode = null;
    child.signalCode = sig === 'SIGTERM' ? 'SIGTERM' : sig;
    process.nextTick(() => child.emit('close', null, child.signalCode));
    return true;
  };
  process.nextTick(() => {
    for (const c of chunks) {
      child.stdout.emit('data', Buffer.from(c));
    }
    child.exitCode = exitCode === undefined ? 0 : exitCode;
    child.emit('close', child.exitCode, null);
  });
  return child;
}

function adapterWith(child) {
  const pm = {
    startStreaming: () => ({ child, dispose: () => {} }),
    run: async () => ({ code: 0, stdout: '', stderr: '' }),
  };
  const a = new OpenCodeAdapter({ logger: console, processManager: pm });
  a.exe = 'opencode';
  return a;
}

describe('NDJSON parsing', () => {
  it('parses valid lines, rejects malformed', () => {
    assert.equal(tryParseJsonLine('{"a":1}').ok, true);
    assert.equal(tryParseJsonLine('not json').ok, false);
  });
  it('normalizes text deltas without fabricating tools', () => {
    const e = normalizeEvent({ type: 'text', sessionID: 's1', part: { type: 'text', text: 'hi' } });
    assert.equal(e.kind, 'assistant_message_delta');
    assert.equal(e.text, 'hi');
    assert.equal(normalizeEvent({ type: 'weird-x' }).kind, 'warning');
  });
  it('normalizes real reasoning events as thinking deltas', () => {
    const e = normalizeEvent({ type: 'reasoning', sessionID: 's', part: { type: 'reasoning', text: 'Let me check.' } });
    assert.equal(e.kind, 'thinking_delta');
    assert.equal(e.text, 'Let me check.');
    assert.equal(normalizeEvent({ type: 'reasoning', part: {} }), null);
  });
  it('maps completed tool_use to tool_completed with input/output detail', () => {
    const raw = {
      type: 'tool_use',
      sessionID: 's',
      part: { type: 'tool', tool: 'bash', callID: 'call_1', state: { status: 'completed', input: { command: 'ls' }, output: 'a\nb\n', metadata: { exit: 0 }, title: 'ls' } },
    };
    const e = normalizeEvent(raw);
    assert.equal(e.kind, 'tool_completed');
    assert.equal(e.tool, 'bash');
    assert.equal(e.detail.input, 'ls');
    assert.equal(e.detail.exit, 0);
    assert.match(e.detail.output, /a/);
  });
  it('maps running tool_use to tool_started', () => {
    const e = normalizeEvent({ type: 'tool_use', part: { tool: 'read', state: { status: 'running', input: { path: 'a.py' } } } });
    assert.equal(e.kind, 'tool_started');
    assert.equal(e.tool, 'read');
  });
  it('parses real verbose blocks', () => {
    const out = 'opencode/big-pickle\n{"id":"big-pickle","providerID":"opencode","name":"Big Pickle","status":"active","cost":{"input":0,"output":0,"cache":{"read":0,"write":0}}}\n';
    const p = parseOpenCodeVerbose(out);
    assert.equal(p.length, 1);
    assert.equal(p[0].id, 'big-pickle');
  });
});

describe('OpenCodeAdapter.sendMessage (mocked)', () => {
  it('streams deltas + resolves session/text', async () => {
    const chunks = [ndjson([
      { type: 'step_start', sessionID: 'ses_1' },
      { type: 'text', sessionID: 'ses_1', part: { type: 'text', text: 'Hello' } },
    ]), ndjson([{ type: 'step_finish', sessionID: 'ses_1', part: { cost: 0 } }])];
    const a = adapterWith(fakeStreaming(chunks, 0));
    const seen = [];
    const res = await a.sendMessage({ message: 'hi', dir: '/tmp/ws', model: 'opencode/big-pickle' }, (e) => seen.push(e), { isCancellationRequested: false });
    assert.equal(res.sessionID, 'ses_1');
    assert.equal(res.text, 'Hello');
    assert.ok(seen.some((e) => e.kind === 'assistant_message_delta'));
  });

  it('handles chunk-split JSON (one record across data events)', async () => {
    const full = JSON.stringify({ type: 'text', sessionID: 's', part: { type: 'text', text: 'AB' } }) + '\n';
    const child = fakeStreaming([full.slice(0, 20), full.slice(20)], 0);
    const a = adapterWith(child);
    const res = await a.sendMessage({ message: 'hi', dir: '/tmp/ws' }, () => {}, { isCancellationRequested: false });
    assert.equal(res.text, 'AB');
  });

  it('tolerates malformed records and continues', async () => {
    const child = fakeStreaming(['NOT JSON\n' + ndjson([{ type: 'text', sessionID: 's', part: { type: 'text', text: 'ok' } }]), ndjson([{ type: 'step_finish', sessionID: 's' }])], 0);
    const a = adapterWith(child);
    const seen = [];
    const res = await a.sendMessage({ message: 'hi', dir: '/tmp/ws' }, (e) => seen.push(e), {});
    assert.equal(res.text, 'ok');
    assert.ok(seen.some((e) => e.kind === 'warning'));
  });

  it('surfaces non-zero exit without fabricating text', async () => {
    const child = fakeStreaming([ndjson([{ type: 'step_start', sessionID: 's' }])], 1);
    // attach stderr content
    process.nextTick(() => child.stderr.emit('data', Buffer.from('auth required')));
    const a = adapterWith(child);
    await assert.rejects(() => a.sendMessage({ message: 'hi', dir: '/tmp/ws' }, () => {}, {}), /exited with code 1/);
  });

  it('requires workspace dir', async () => {
    const a = adapterWith(fakeStreaming([], 0));
    await assert.rejects(() => a.sendMessage({ message: 'hi' }, () => {}, {}), /workspace/);
  });

  it('rejects a nested free-limit error even when the CLI exits with code zero', async () => {
    const error = { type: 'error', error: { name: 'APIError', data: { message: 'Free usage exceeded' } } };
    const child = fakeStreaming([ndjson([error])], 0);
    const a = adapterWith(child);
    const events = [];
    await assert.rejects(() => a.sendMessage({ message: 'hi', dir: '/tmp/ws' }, (e) => events.push(e), {}),
      (err) => err.code === 'E_DAILY_FREE_LIMIT' && /Daily free limit is reached/.test(err.message));
    assert.equal(events.filter((e) => e.kind === 'error').length, 1);
    assert.ok(!events.some((e) => e.kind === 'session_completed'));
  });

  it('handles an error in the final JSON record without a newline', async () => {
    const child = fakeStreaming([JSON.stringify({ type: 'error', error: { data: { statusCode: 429, message: 'Too many requests' } } })], 0);
    await assert.rejects(() => adapterWith(child).sendMessage({ message: 'hi', dir: '/tmp/ws' }, () => {}, {}),
      (err) => err.code === 'E_RATE_LIMIT');
  });

  it('classifies stderr-only daily limits on failed exits', async () => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    process.nextTick(() => { child.stderr.emit('data', Buffer.from('Daily free quota exhausted')); child.emit('close', 1, null); });
    await assert.rejects(() => adapterWith(child).sendMessage({ message: 'hi', dir: '/tmp/ws' }, () => {}, {}),
      (err) => err.code === 'E_DAILY_FREE_LIMIT');
  });

  it('builds run args with array (no shell concat)', async () => {
    const a = new OpenCodeAdapter({ logger: console, processManager: { run: async () => ({}) } });
    const args = a.buildRunArgs({ message: 'hi; rm -rf /', model: 'opencode/big-pickle', dir: '/tmp/ws', sessionID: 'ses_1' });
    assert.ok(Array.isArray(args));
    assert.ok(args.includes('--model') && args.includes('opencode/big-pickle'));
    assert.ok(args.includes('--session') && args.includes('ses_1'));
    // message stays a single argv element (no shell interpretation)
    assert.ok(args.includes('hi; rm -rf /'));
    // thinking blocks requested so reasoning events stream
    assert.ok(args.includes('--thinking'));
  });
});
