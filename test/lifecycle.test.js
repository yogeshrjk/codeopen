'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { OpenCodeAdapter } = require('../src/adapters/openCodeAdapter');
const { ProcessManager } = require('../src/process/processManager');
const { PatchManager } = require('../src/patches/patchManager');

const tick = () => new Promise((resolve) => setImmediate(resolve));
async function until(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await tick(); }
  assert.ok(check(), 'Expected asynchronous host event');
}
function memento(seed = {}) {
  const data = new Map(Object.entries(seed));
  return { get: (key, fallback) => data.has(key) ? data.get(key) : fallback, update: async (key, value) => { data.set(key, value); } };
}
function view() {
  const v = { visible: true, posted: [], dispose: null, visibility: null };
  v.webview = {
    options: {}, html: '',
    postMessage: async (msg) => { if (!v.visible) return false; v.posted.push(JSON.parse(JSON.stringify(msg))); return true; },
    onDidReceiveMessage: (cb) => { v.receive = cb; },
  };
  v.onDidDispose = (cb) => { v.dispose = cb; };
  v.onDidChangeVisibility = (cb) => { v.visibility = cb; };
  return v;
}

test('extension keeps a run across sidebar replacement, preserves output, and forks edits', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codeopen-host-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runs = [];
  const commands = new Map();
  let provider, registration;
  const cfg = { requestTimeoutSec: 0, firstByteNoticeSec: 0 };
  const disposable = { dispose() {} };
  const vscode = {
    workspace: {
      workspaceFolders: [{ uri: { fsPath: root }, name: 'Project' }],
      getConfiguration: () => ({ get: (key, fallback) => cfg[key] ?? fallback }),
    },
    window: {
      createOutputChannel: () => ({ appendLine() {}, clear() {}, show() {} }),
      registerWebviewViewProvider: (id, value, options) => { provider = value; registration = options; return disposable; },
      onDidChangeTextEditorSelection: () => disposable,
      onDidChangeActiveTextEditor: () => disposable,
      showInformationMessage() {}, showWarningMessage() {},
    },
    commands: { registerCommand: (id, fn) => { commands.set(id, fn); return disposable; }, executeCommand: async (id) => commands.get(id)?.() },
    env: { clipboard: { writeText: async () => {} } },
  };
  const originals = [];
  function patch(object, key, value) { originals.push(() => { object[key] = originalsValue; }); const originalsValue = object[key]; object[key] = value; }
  let releaseValidation;
  patch(OpenCodeAdapter.prototype, 'detectInstallation', async function () { this.exe = 'opencode'; return { exists: true, canStart: true, compatible: true, exe: this.exe, version: '1.18.18' }; });
  patch(OpenCodeAdapter.prototype, 'listModelsRaw', async () => ({ stdout: 'opencode/test-free\n' + JSON.stringify({ id: 'test-free', providerID: 'opencode', name: 'Test Free', cost: { input: 0, output: 0 }, status: 'active' }) }));
  patch(OpenCodeAdapter.prototype, 'validateFreeModel', async () => { if (releaseValidation !== undefined) await new Promise((resolve) => { releaseValidation = resolve; }); return { ok: true }; });
  patch(PatchManager.prototype, 'snapshot', async () => ({ manifest: {} }));
  patch(PatchManager.prototype, 'diffSummary', async () => ({ files: [], insertions: 0, deletions: 0 }));
  patch(ProcessManager.prototype, 'startStreaming', function (exe, args) {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.exitCode = null; child.signalCode = null;
    child.kill = (signal) => { child.signalCode = signal; child.emit('close', null, signal); return true; };
    const run = { child, args, event: (value) => child.stdout.emit('data', Buffer.from(JSON.stringify(value) + '\n')), finish: () => { child.exitCode = 0; child.emit('close', 0, null); } };
    runs.push(run);
    return { child, dispose() {} };
  });
  const load = Module._load;
  Module._load = function (name, ...args) { return name === 'vscode' ? vscode : load.call(this, name, ...args); };
  let extension;
  try { delete require.cache[require.resolve('../src/extension')]; extension = require('../src/extension'); } finally { Module._load = load; }
  t.after(() => originals.reverse().forEach((restore) => restore()));
  const context = { subscriptions: [], globalState: memento({ 'freecli.selectedModel': 'opencode/test-free' }), workspaceState: memento() };
  await extension.activate(context);
  assert.deepEqual(registration, { webviewOptions: { retainContextWhenHidden: true } });
  const first = view(); provider.resolveWebviewView(first); first.receive({ type: 'ready' });
  await until(() => first.posted.some((m) => m.type === 'models' && m.models.length));
  releaseValidation = null;
  first.receive({ type: 'send', text: 'Original prompt', requestId: 'r1' });
  await until(() => typeof releaseValidation === 'function');
  assert.equal(first.posted.filter((m) => m.type === 'state').at(-1).busy, true);
  first.receive({ type: 'send', text: 'Duplicate', requestId: 'duplicate' });
  releaseValidation(); releaseValidation = undefined;
  await until(() => runs.length === 1);
  runs[0].event({ type: 'reasoning', sessionID: 'session-original', part: { text: 'Checking project' } });
  runs[0].event({ type: 'text', sessionID: 'session-original', part: { text: 'Part one. ' } });
  first.visible = false; first.dispose();
  runs[0].event({ type: 'text', part: { text: 'Part two.' } });
  assert.equal(runs[0].child.signalCode, null, 'Closing sidebar must not cancel CLI');
  const reopened = view(); provider.resolveWebviewView(reopened);
  first.dispose(); // Delayed disposal of the OLD view cannot detach the new one.
  reopened.receive({ type: 'ready' });
  await until(() => reopened.posted.some((m) => m.type === 'history' && m.liveRun));
  const snapshot = reopened.posted.find((m) => m.type === 'history' && m.liveRun);
  assert.equal(snapshot.liveRun.text, 'Part one. Part two.');
  assert.equal(snapshot.liveRun.thought.items[0].text, 'Checking project');
  await commands.get('freecli.newSession')();
  assert.equal(runs[0].child.signalCode, null, 'New-chat click cannot cancel a task silently');
  reopened.visible = false;
  runs[0].finish();
  await tick(); await tick();
  reopened.visible = true; reopened.visibility();
  const finalHistory = reopened.posted.filter((m) => m.type === 'history').at(-1);
  assert.equal(finalHistory.liveRun, null);
  assert.equal(finalHistory.messages.filter((m) => m.role === 'assistant').at(-1).text, 'Part one. Part two.');
  assert.equal(reopened.posted.filter((m) => m.type === 'state').at(-1).busy, false);
  assert.equal(runs.length, 1, 'Double send must start one CLI run');
  assert.equal(context.workspaceState.get('freecli.draft'), null);

  const originalUser = finalHistory.messages.find((m) => m.role === 'user');
  reopened.receive({ type: 'send', text: 'Revised prompt', editMessageId: originalUser.id, requestId: 'edit' });
  await until(() => runs.length === 2);
  assert.ok(!runs[1].args.includes('--session'), 'An edit must not resume the superseded CLI conversation');
  assert.match(runs[1].args[1], /Revised prompt/);
  assert.ok(!runs[1].args[1].includes('Original prompt'));
  runs[1].event({ type: 'text', sessionID: 'session-edited', part: { text: 'New answer' } });
  runs[1].finish();
  await until(() => reopened.posted.filter((m) => m.type === 'state').at(-1)?.busy === false);
  const records = Object.values(context.globalState.get('freecli.history.v1'));
  assert.equal(records.length, 2, 'Original and edited branch both remain in History');
  assert.ok(records.some((rec) => rec.messages[0].text === 'Original prompt'));
  assert.ok(records.some((rec) => rec.messages[0].text === 'Revised prompt'));
});
