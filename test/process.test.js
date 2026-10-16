'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ProcessManager } = require('../src/process/processManager');

describe('ProcessManager stdio', () => {
  it('closes child stdin so CLIs never block waiting for input', async () => {
    const pm = new ProcessManager(console);
    // Exits 42 on stdin EOF, 99 if stdin stays open.
    const script = "process.stdin.on('end', () => process.exit(42)); process.stdin.resume(); setTimeout(() => process.exit(99), 800);";
    const res = await pm.run(process.execPath, ['-e', script], { timeoutMs: 5000 });
    assert.equal(res.code, 42, 'child stdin must be closed (EOF), not an open pipe');
  });

  it('startStreaming also closes stdin', async () => {
    const pm = new ProcessManager(console);
    const script = "process.stdin.on('end', () => process.exit(42)); process.stdin.resume(); setTimeout(() => process.exit(99), 800);";
    const { child } = pm.startStreaming(process.execPath, ['-e', script], {});
    const code = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch (e) {}
        resolve('timeout');
      }, 5000);
      child.on('close', (c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });
    pm.killAll();
    assert.equal(code, 42, 'streamed child stdin must be closed (EOF)');
  });

  it('accepts an explicit stdio override', async () => {
    const pm = new ProcessManager(console);
    const res = await pm.run(process.execPath, ['-e', 'process.exit(7);'], { timeoutMs: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(res.code, 7);
  });
});
