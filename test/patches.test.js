'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validatePatch, isInsideWorkspace } = require('../src/patches/patchValidator');
const { parseNumstat } = require('../src/patches/patchManager');
const { applyPendingPatch } = require('../src/patches/applyPatch');

describe('patchValidator', () => {
  const root = '/tmp/ws';
  it('accepts valid patch', () => {
    const r = validatePatch({ files: [{ path: 'a/b.py', status: 'modified' }] }, new Map([['a/b.py', { hash: 'h1' }]]), root, {});
    assert.equal(r.ok, true);
  });
  it('blocks path traversal', () => {
    const r = validatePatch({ files: [{ path: '../../etc/passwd', status: 'modified' }] }, null, root, {});
    assert.equal(r.ok, false);
    assert.match(r.issues.join(' '), /outside the workspace/);
  });
  it('blocks absolute escape', () => {
    assert.equal(isInsideWorkspace(root, '/etc/passwd'), false);
  });
  it('rejects stale patch (hash mismatch)', () => {
    const r = validatePatch(
      { files: [{ path: 'a.py', status: 'modified', originalHash: 'old' }] },
      new Map([['a.py', { hash: 'new' }]]),
      root,
      {}
    );
    assert.equal(r.ok, false);
    assert.match(r.issues.join(' '), /Stale patch/);
  });
  it('rejects empty patch', () => {
    assert.equal(validatePatch({ files: [] }, null, root, {}).ok, false);
  });
  it('flags conflicting (deleted-by-user) file', () => {
    const r = validatePatch({ files: [{ path: 'gone.py', status: 'modified' }] }, new Map(), root, {});
    assert.equal(r.ok, false);
  });
});

describe('applyPendingPatch', () => {
  it('requires approval', async () => {
    const r = await applyPendingPatch({ files: [{ path: 'a.py', status: 'modified' }] }, new Map([['a.py', {}]]), '/tmp/ws', { requireApproval: true, approved: false });
    assert.equal(r.applied, false);
  });
  it('applies validated patch', async () => {
    const r = await applyPendingPatch({ files: [{ path: 'a.py', status: 'modified' }] }, new Map([['a.py', {}]]), '/tmp/ws', { requireApproval: true, approved: true });
    assert.equal(r.applied, true);
  });
});

describe('parseNumstat', () => {
  it('sums insertions/deletions across files', () => {
    const r = parseNumstat('10\t2\ta.py\n3\t1\tb.py\n');
    assert.deepEqual(r, { insertions: 13, deletions: 3 });
  });
});
