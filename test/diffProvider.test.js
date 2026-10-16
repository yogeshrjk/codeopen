'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { showDiffForFile, showAllDiffs, getPatchText } = require('../src/patches/diffProvider');

function stubVscode() {
  const calls = [];
  return {
    calls,
    Uri: {
      file: (p) => ({ scheme: 'file', fsPath: p }),
      joinPath: (base, rel) => ({ scheme: 'file', fsPath: `${base.fsPath}/${rel}` }),
    },
    window: {
      showInformationMessage: async () => {},
      showQuickPick: async (items) => items[0],
    },
    commands: {
      executeCommand: async (cmd, left, right, title) => {
        calls.push({ cmd, left, right, title });
      },
    },
  };
}

function readUri(uri) {
  return fs.readFileSync(uri.fsPath, 'utf8');
}

describe('diffProvider (editor-only review)', () => {
  it('opens modified files as HEAD-vs-working diffs', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freecli-dp-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
      fs.writeFileSync(path.join(dir, 'a.py'), 'old\n');
      execFileSync('git', ['add', '.'], { cwd: dir });
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'add'], { cwd: dir });
      fs.writeFileSync(path.join(dir, 'a.py'), 'new\n');
      const vscode = stubVscode();
      await showDiffForFile(vscode, dir, { path: 'a.py', status: 'modified' }, null);
      assert.equal(vscode.calls.length, 1);
      assert.equal(vscode.calls[0].cmd, 'vscode.diff');
      assert.equal(readUri(vscode.calls[0].left), 'old\n');
      assert.equal(vscode.calls[0].right.fsPath, path.join(dir, 'a.py'));
      assert.match(vscode.calls[0].title, /a\.py/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('opens added files against empty and deleted files with original content', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freecli-dp2-'));
    try {
      fs.writeFileSync(path.join(dir, 'new.py'), 'fresh\n');
      const vscode = stubVscode();
      await showDiffForFile(vscode, dir, { path: 'new.py', status: 'added' }, null);
      assert.equal(readUri(vscode.calls[0].left), '');
      assert.equal(readUri(vscode.calls[0].right), 'fresh\n');
      fs.unlinkSync(path.join(dir, 'new.py'));
      const vscode2 = stubVscode();
      await showDiffForFile(vscode2, dir, { path: 'old.py', status: 'deleted' }, new Map([['old.py', { content: 'was here\n' }]]));
      assert.equal(readUri(vscode2.calls[0].left), 'was here\n');
      assert.equal(readUri(vscode2.calls[0].right), '');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('shows pre-request old code on the left side and new code on the right side', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freecli-dp3-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      fs.writeFileSync(path.join(dir, 'code.js'), 'commit 1\n');
      execFileSync('git', ['add', '.'], { cwd: dir });
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: dir });
      // File modified before request (the old code before the AI proposed changes)
      const preRequestOldCode = 'function hello() { return 1; }\n';
      fs.writeFileSync(path.join(dir, 'code.js'), preRequestOldCode);
      const snapshot = {
        manifest: new Map([['code.js', { content: preRequestOldCode }]]),
      };
      // AI generates patch (new code)
      const newCodeWithPatch = 'function hello() { return 2; }\n';
      fs.writeFileSync(path.join(dir, 'code.js'), newCodeWithPatch);

      const vscode = stubVscode();
      await showDiffForFile(vscode, dir, { path: 'code.js', status: 'modified' }, snapshot);
      assert.equal(vscode.calls.length, 1);
      // Left side must have the old code from before the patch, NOT HEAD ('commit 1\n')
      assert.equal(readUri(vscode.calls[0].left), preRequestOldCode);
      // Right side must be the working tree file with the patch
      assert.equal(fs.readFileSync(vscode.calls[0].right.fsPath, 'utf8'), newCodeWithPatch);
      assert.match(vscode.calls[0].title, /Old Code ↔ New Code/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to the staged version when HEAD is unborn (left never empty)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freecli-dp4-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      fs.writeFileSync(path.join(dir, 'staged.py'), 'staged\n');
      execFileSync('git', ['add', '.'], { cwd: dir });
      // Agent edits the working tree; no pre-run snapshot available.
      fs.writeFileSync(path.join(dir, 'staged.py'), 'staged-edited\n');
      const vscode = stubVscode();
      await showDiffForFile(vscode, dir, { path: 'staged.py', status: 'modified' }, null);
      assert.equal(vscode.calls.length, 1);
      // Left must be the staged (old) code, not empty: only the edited
      // line shows red/green instead of the whole file green.
      assert.equal(readUri(vscode.calls[0].left), 'staged\n');
      assert.equal(fs.readFileSync(vscode.calls[0].right.fsPath, 'utf8'), 'staged-edited\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses pre-run snapshot even when git reports Added on unborn HEAD (no whole-file green)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freecli-dp5-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      fs.writeFileSync(path.join(dir, 'a.py'), 'line1\nline2\nline3\n');
      execFileSync('git', ['add', '.'], { cwd: dir });
      // Unborn HEAD: git status says Added for this pre-existing staged file.
      const snapshot = new Map([['a.py', { content: 'line1\nline2\nline3\n' }]]);
      fs.writeFileSync(path.join(dir, 'a.py'), 'line1\nline2-EDITED\nline3\n');
      const vscode = stubVscode();
      await showDiffForFile(vscode, dir, { path: 'a.py', status: 'added' }, snapshot);
      assert.equal(vscode.calls.length, 1);
      // Left must be old code, right new code: only the edited line highlights.
      assert.equal(readUri(vscode.calls[0].left), 'line1\nline2\nline3\n');
      assert.equal(fs.readFileSync(vscode.calls[0].right.fsPath, 'utf8'), 'line1\nline2-EDITED\nline3\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('showAllDiffs picks single files directly and quick-picks multiples', async () => {
    const vscode = stubVscode();
    await showAllDiffs(vscode, '/tmp', { files: [] });
    assert.equal(vscode.calls.length, 0);
    const vscode2 = stubVscode();
    let picked = null;
    vscode2.window.showQuickPick = async (items) => {
      picked = items;
      return items[1];
    };
    await showAllDiffs(vscode2, '/tmp', { files: [{ path: 'a', status: 'modified' }, { path: 'b', status: 'added' }] }, null);
    assert.equal(picked.length, 2);
    assert.match(picked[0].label, /^M a/);
  });

  it('getPatchText returns empty when no files are edited', async () => {
    assert.equal(await getPatchText('/tmp', [], null), '');
    assert.equal(await getPatchText('/tmp', null, null), '');
  });

  it('getPatchText covers only the edited files passed in', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freecli-dp3-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      fs.writeFileSync(path.join(dir, 'edited.py'), 'old\n');
      fs.writeFileSync(path.join(dir, 'untouched.py'), 'same\n');
      execFileSync('git', ['add', '.'], { cwd: dir });
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: dir });
      fs.writeFileSync(path.join(dir, 'edited.py'), 'new\n');
      // Pass only the edited file: patch must mention it, not the untouched one.
      const patch = await getPatchText(dir, [{ path: 'edited.py', status: 'modified' }], null);
      assert.match(patch, /edited\.py/);
      assert.match(patch, /^-old$/m);
      assert.match(patch, /^\+new$/m);
      assert.doesNotMatch(patch, /untouched\.py/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
