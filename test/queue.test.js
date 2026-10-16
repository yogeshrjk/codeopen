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

test('queues next request during ongoing task and runs it after completion', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codeopen-queue-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runs = [];
  const commands = new Map();
  let provider;
  const cfg = { requestTimeoutSec: 0, firstByteNoticeSec: 0 };
  const disposable = { dispose() {} };
  let clipboardText = '';
  const diffCalls = [];
  const vscode = {
    workspace: {
      workspaceFolders: [{ uri: { fsPath: root }, name: 'Project' }],
      getConfiguration: () => ({ get: (key, fallback) => cfg[key] ?? fallback }),
    },
    window: {
      createOutputChannel: () => ({ appendLine() {}, clear() {}, show() {} }),
      registerWebviewViewProvider: (id, value) => { provider = value; return disposable; },
      onDidChangeTextEditorSelection: () => disposable,
      onDidChangeActiveTextEditor: () => disposable,
      showInformationMessage() {}, showWarningMessage() {},
    },
    commands: {
      registerCommand: (id, fn) => { commands.set(id, fn); return disposable; },
      executeCommand: async (id, ...args) => {
        if (id === 'vscode.diff') {
          diffCalls.push(args);
          return;
        }
        return commands.get(id)?.(...args);
      },
    },
    Uri: { file: (p) => ({ fsPath: p }) },
    env: { clipboard: { writeText: async (txt) => { clipboardText = txt; } } },
  };

  const originals = [];
  function patch(object, key, value) {
    const orig = object[key];
    originals.push(() => { object[key] = orig; });
    object[key] = value;
  }

  patch(OpenCodeAdapter.prototype, 'detectInstallation', async function () {
    this.exe = 'opencode';
    return { exists: true, canStart: true, compatible: true, exe: this.exe, version: '1.18.18' };
  });
  patch(OpenCodeAdapter.prototype, 'listModelsRaw', async () => ({
    stdout: 'opencode/test-free\n' + JSON.stringify({
      id: 'test-free',
      providerID: 'opencode',
      name: 'Test Free',
      cost: { input: 0, output: 0 },
      status: 'active',
    }),
  }));
  patch(OpenCodeAdapter.prototype, 'validateFreeModel', async () => ({ ok: true }));
  patch(PatchManager.prototype, 'snapshot', async () => ({
    manifest: new Map([['foo.js', { content: 'const x = 1;\n' }]]),
  }));
  patch(PatchManager.prototype, 'diffSummary', async () => ({
    files: [{ path: 'foo.js', status: 'modified' }],
    insertions: 5,
    deletions: 2,
  }));
  patch(PatchManager.prototype, 'fileHunks', async (root, files) => files);
  patch(ProcessManager.prototype, 'startStreaming', function (exe, args) {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.exitCode = null;
    child.signalCode = null;
    child.kill = (signal) => {
      child.signalCode = signal;
      child.emit('close', null, signal);
      return true;
    };
    const run = {
      child,
      args,
      event: (value) => child.stdout.emit('data', Buffer.from(JSON.stringify(value) + '\n')),
      finish: () => { child.exitCode = 0; child.emit('close', 0, null); },
    };
    runs.push(run);
    return { child, dispose() {} };
  });

  const load = Module._load;
  Module._load = function (name, ...args) {
    return name === 'vscode' ? vscode : load.call(this, name, ...args);
  };
  let extension;
  try {
    delete require.cache[require.resolve('../src/extension')];
    extension = require('../src/extension');
  } finally {
    Module._load = load;
  }
  t.after(() => originals.reverse().forEach((restore) => restore()));

  const context = {
    subscriptions: [],
    globalState: memento({ 'freecli.selectedModel': 'opencode/test-free' }),
    workspaceState: memento(),
  };
  await extension.activate(context);

  const panel = view();
  provider.resolveWebviewView(panel);
  panel.receive({ type: 'ready' });
  await until(() => panel.posted.some((m) => m.type === 'models' && m.models.length));

  // 1. Send first message
  panel.receive({ type: 'send', text: 'Task 1', requestId: 'req-1' });
  await until(() => runs.length === 1);
  assert.equal(panel.posted.filter((m) => m.type === 'state').at(-1).busy, true);

  // 2. Queue second message while Task 1 is ongoing
  panel.receive({ type: 'queue', text: 'Task 2 (queued)', requestId: 'req-2', queued: true });
  await tick();

  // Verify Task 2 is marked queued in state.messages
  const latestHistory = panel.posted.filter((m) => m.type === 'history').at(-1);
  const queuedMsg = latestHistory.messages.find((m) => m.text === 'Task 2 (queued)');
  assert.ok(queuedMsg, 'Queued message must appear in history');
  assert.equal(queuedMsg.queued, true, 'Message must have queued flag');

  // Verify copyText works while busy
  panel.receive({ type: 'copyText', text: 'Hello clipboard' });
  await tick();
  assert.equal(clipboardText, 'Hello clipboard');

  // 3. Complete Task 1
  runs[0].event({ type: 'text', sessionID: 'session-1', part: { text: 'Task 1 done' } });
  runs[0].finish();

  // 4. Task 2 must automatically start running
  await until(() => runs.length === 2);
  assert.match(runs[1].args[1], /Task 2 \(queued\)/);

  const histWithPatch = panel.posted.filter((m) => m.type === 'history').find((h) => h.messages.some((m) => m.role === 'patch'));
  assert.ok(histWithPatch, 'History should include patch from Task 1');
  const patchMsg = histWithPatch.messages.find((m) => m.role === 'patch');

  // Click review file on previous patch
  panel.receive({ type: 'openFileReview', path: 'foo.js', patchId: patchMsg.patchId });
  await until(() => diffCalls.length > 0);
  assert.ok(diffCalls.length > 0, 'Must open diff for previous patch while Task 2 is running');

  // Complete Task 2
  runs[1].event({ type: 'text', sessionID: 'session-2', part: { text: 'Task 2 done' } });
  runs[1].finish();
  await until(() => {
    const states = panel.posted.filter((m) => m.type === 'state');
    return states.length > 0 && states.at(-1).busy === false;
  });
});
