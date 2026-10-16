'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { PatchManager, blockDiff } = require('../src/patches/patchManager');

describe('blockDiff', () => {
  it('trims common prefix/suffix for modified content', () => {
    const d = blockDiff('a\nb\nc\n', 'a\nB\nc\n');
    assert.deepEqual({ insertions: d.insertions, deletions: d.deletions }, { insertions: 1, deletions: 1 });
    assert.match(d.text, /^-b$/m);
    assert.match(d.text, /^\+B$/m);
    assert.match(d.text, /^ a$/m);
  });
  it('handles empty sides without phantom lines', () => {
    assert.deepEqual([blockDiff('', 'x\ny').insertions, blockDiff('', 'x\ny').deletions], [2, 0]);
    assert.deepEqual([blockDiff('gone', '').insertions, blockDiff('gone', '').deletions], [0, 1]);
    assert.deepEqual([blockDiff('same', 'same').insertions, blockDiff('same', 'same').deletions], [0, 0]);
  });
});

function git(dir, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' });
}

describe('PatchManager snapshot flows (editor-only review)', () => {
  it('lists modified/added/deleted files in git repos', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freecli-diff-'));
    try {
      git(dir, ['init', '-q']);
      fs.writeFileSync(path.join(dir, 'a.py'), 'line1\nline2\n');
      fs.writeFileSync(path.join(dir, 'gone.py'), 'bye\n');
      git(dir, ['add', '.']);
      git(dir, ['commit', '-qm', 'init']);
      fs.writeFileSync(path.join(dir, 'a.py'), 'line1\nline2-changed\n');
      fs.writeFileSync(path.join(dir, 'new.py'), 'fresh\ncontent\n');
      fs.unlinkSync(path.join(dir, 'gone.py'));
      const pm = new PatchManager({ logger: console });
      const summary = await pm.diffSummary(dir, null);
      const paths = Object.fromEntries(summary.files.map((f) => [f.path, f.status]));
      assert.equal(paths['a.py'], 'modified');
      assert.equal(paths['new.py'], 'added');
      assert.equal(paths['gone.py'], 'deleted');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('shows proposed changes only if a file was edited on that request', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freecli-reqdiff-'));
    try {
      git(dir, ['init', '-q']);
      fs.writeFileSync(path.join(dir, 'already-dirty.py'), 'initial\n');
      fs.writeFileSync(path.join(dir, 'target.py'), 'target original\n');
      git(dir, ['add', '.']);
      git(dir, ['commit', '-qm', 'init']);
      // already-dirty.py is modified before request 1 starts
      fs.writeFileSync(path.join(dir, 'already-dirty.py'), 'pre-existing dirty edit\n');

      const pm = new PatchManager({ logger: console });
      // Request 1: No files edited during request 1
      const snap1 = await pm.snapshot(dir);
      const summary1 = await pm.diffSummary(dir, snap1);
      assert.equal(summary1.files.length, 0, 'must not report pre-existing dirty files if not edited on this request');

      // Request 2: target.py is edited during request 2
      const snap2 = await pm.snapshot(dir);
      fs.writeFileSync(path.join(dir, 'target.py'), 'target edited by agent\n');
      const summary2 = await pm.diffSummary(dir, snap2);
      assert.equal(summary2.files.length, 1, 'must report only the file edited on this request');
      assert.equal(summary2.files[0].path, 'target.py');
      assert.equal(summary2.files[0].status, 'modified');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lists files in repos without any commit (unborn HEAD)', async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'freecli-nohead-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: bare });
      fs.writeFileSync(path.join(bare, 'fresh.py'), 'a = 1\n');
      const pm = new PatchManager({ logger: console });
      const summary = await pm.diffSummary(bare, null);
      assert.ok(summary.files.some((f) => f.path === 'fresh.py'));
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });

  it('diffs and rolls back non-git workspaces via snapshot', async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'freecli-plain-'));
    try {
      fs.writeFileSync(path.join(plain, 'keep.py'), 'one\ntwo\n');
      fs.writeFileSync(path.join(plain, 'old.py'), 'bye\n');
      const pm = new PatchManager({ logger: console });
      const snap = await pm.snapshot(plain);
      assert.equal(snap.git, false);
      assert.ok(snap.manifest.size >= 2);
      // Simulate agent edits: modify, add, delete.
      fs.writeFileSync(path.join(plain, 'keep.py'), 'one\nTWO\n');
      fs.writeFileSync(path.join(plain, 'brand.py'), 'new\n');
      fs.unlinkSync(path.join(plain, 'old.py'));
      const summary = await pm.diffSummary(plain, snap);
      assert.equal(summary.git, false);
      const paths = Object.fromEntries(summary.files.map((f) => [f.path, f.status]));
      assert.equal(paths['keep.py'], 'modified');
      assert.equal(paths['brand.py'], 'added');
      assert.equal(paths['old.py'], 'deleted');
      const rolled = await pm.rollbackSnapshot(plain);
      assert.equal(rolled.errors.length, 0);
      assert.equal(fs.readFileSync(path.join(plain, 'keep.py'), 'utf8'), 'one\ntwo\n');
      assert.ok(fs.existsSync(path.join(plain, 'old.py')), 'deleted file restored');
      assert.ok(!fs.existsSync(path.join(plain, 'brand.py')), 'added file removed');
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
});
