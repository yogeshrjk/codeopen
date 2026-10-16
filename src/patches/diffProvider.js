'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const path = require('path');
const fs = require('fs');

const execFileAsync = promisify(execFile);

function writeTempFile(text, relPath, tag) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `freecli-${tag}-`));
  // Keep the original extension so the diff editor highlights syntax.
  const safe = path.basename(relPath || 'file').replace(/[^A-Za-z0-9._-]/g, '_') || 'file';
  const tmpFile = path.join(tmpDir, safe);
  fs.writeFileSync(tmpFile, text === undefined || text === null ? '' : String(text), 'utf8');
  return tmpFile;
}

async function headContent(workspaceRoot, relPath) {
  try {
    const r = await execFileAsync('git', ['show', `HEAD:./${relPath}`], { cwd: workspaceRoot, timeout: 15000 });
    return r.stdout !== undefined ? String(r.stdout) : null;
  } catch (e) {
    return null;
  }
}

// Staged (index) version: covers files staged but never committed
// (unborn HEAD) where HEAD lookup always misses. Without this the left
// side renders empty and the whole file shows green.
async function stagedContent(workspaceRoot, relPath) {
  try {
    const r = await execFileAsync('git', ['show', `:./${relPath}`], { cwd: workspaceRoot, timeout: 15000 });
    return r.stdout !== undefined ? String(r.stdout) : null;
  } catch (e) {
    return null;
  }
}

function readWorkingFile(workspaceRoot, relPath) {
  try {
    return fs.readFileSync(path.join(workspaceRoot, relPath), 'utf8');
  } catch (e) {
    return null;
  }
}

function snapshotOldContent(snapshotManifest, relPath) {
  if (!snapshotManifest || !relPath) {
    return null;
  }
  // Direct Map (pre-run manifest passed as `snap.manifest`).
  try {
    if (typeof snapshotManifest.get === 'function') {
      if (snapshotManifest.has(relPath)) {
        const old = snapshotManifest.get(relPath);
        if (old && typeof old.content === 'string') {
          return old.content;
        }
      }
    }
  } catch (e) {
    // ignore map shape errors
  }
  try {
    const m = snapshotManifest.manifest;
    if (m && typeof m.get === 'function' && m.has(relPath)) {
      const old = m.get(relPath);
      if (old && typeof old.content === 'string') {
        return old.content;
      }
    } else if (m && typeof m === 'object' && Object.prototype.hasOwnProperty.call(m, relPath)) {
      const old = m[relPath];
      if (old && typeof old.content === 'string') {
        return old.content;
      }
    }
  } catch (e) {
    // ignore
  }
  try {
    const g = snapshotManifest.gitStatusMap;
    if (g && typeof g.get === 'function' && g.has(relPath)) {
      const pre = g.get(relPath);
      if (pre && typeof pre.content === 'string') {
        return pre.content;
      }
    }
  } catch (e) {
    // ignore
  }
  return null;
}

/**
 * Open the native VS Code diff editor for one changed file.
 * Old code is always on the left, new code on the right:
 *   - original (left): pre-run snapshot content, else git HEAD, else the
 *     staged index version, else empty (truly new files only)
 *   - modified (right): the working-tree file, else empty (deleted files)
 * The native editor then highlights only the modified lines on the right
 * (green additions) instead of the whole file.
 * NOTE: the snapshot/staged lookup runs for every status including
 * 'added'. On repos with an unborn HEAD every path reports as Added by
 * git, so skipping the lookup for added files renders the left side
 * empty and the whole right side green. Only files with no pre-run
 * content anywhere fall back to empty (genuinely new files).
 *
 * @param {object} file { path, status }
 * @param {Map|object} snapshotManifest pre-run manifest from PatchManager.snapshot()
 */
async function showDiffForFile(vscode, workspaceRoot, file, snapshotManifest, title) {
  const relPath = typeof file === 'string' ? file : file.path;
  const status = (typeof file === 'object' && file.status) || 'modified';
  let original = snapshotOldContent(snapshotManifest, relPath);
  if (original === null) {
    original = await headContent(workspaceRoot, relPath);
  }
  if (original === null) {
    original = await stagedContent(workspaceRoot, relPath);
  }
  if (original === null) {
    original = '';
  }
  let modified = null;
  if (status !== 'deleted') {
    modified = readWorkingFile(workspaceRoot, relPath);
  }
  const originalUri = vscode.Uri.file(writeTempFile(original, relPath, 'old'));
  const modifiedUri = modified !== null
    ? vscode.Uri.file(path.join(workspaceRoot, relPath))
    : vscode.Uri.file(writeTempFile('', relPath, 'empty'));
  const baseName = path.basename(relPath);
  const diffTitle = title || `${baseName}: Old Code ↔ New Code (Proposed Patch)`;
  await vscode.commands.executeCommand('vscode.diff', originalUri, modifiedUri, diffTitle);
}

async function showAllDiffs(vscode, workspaceRoot, summary, snapshotManifest) {
  if (!summary || !summary.files || summary.files.length === 0) {
    vscode.window.showInformationMessage('CodeOpen: no changes to review.');
    return;
  }
  if (summary.files.length === 1) {
    const f = summary.files[0];
    await showDiffForFile(vscode, workspaceRoot, f, snapshotManifest);
    return;
  }
  const pick = await vscode.window.showQuickPick(
    summary.files.map((f) => ({
      label: `${f.status === 'added' ? 'A' : f.status === 'deleted' ? 'D' : 'M'} ${f.path}`,
      path: f.path,
      status: f.status,
    })),
    { placeHolder: 'Select a file to review (native diff editor)' }
  );
  if (pick) {
    await showDiffForFile(vscode, workspaceRoot, pick, snapshotManifest);
  }
}

/**
 * Text patch for edited files only. Callers pass the already-filtered
 * edited-files list (e.g. from PatchManager.diffSummary); this function
 * never widens it — unedited files are never included.
 * Git when available (`git diff HEAD -- <paths>`), else a per-file
 * block diff from the pre-run snapshot manifest. Capped; never throws.
 */
async function getPatchText(workspaceRoot, files, snapshotManifest, opts) {
  const o = opts || {};
  const maxFiles = o.maxFiles || 20;
  const maxChars = o.maxChars || 20000;
  const list = (files || []).slice(0, maxFiles);
  if (list.length === 0) {
    return '';
  }
  const rels = list.map((f) => (typeof f === 'string' ? f : f.path)).filter(Boolean);
  if (rels.length === 0) {
    return '';
  }
  try {
    await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: workspaceRoot, timeout: 10000 });
    try {
      await execFileAsync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: workspaceRoot, timeout: 10000 });
    } catch (e) {
      // Unborn HEAD: fall through to snapshot rendering below.
      throw { code: 'NO_HEAD' };
    }
    const r = await execFileAsync(
      'git',
      ['diff', '--no-color', '--no-ext-diff', 'HEAD', '--', ...rels],
      { cwd: workspaceRoot, timeout: 15000, maxBuffer: 10 * 1024 * 1024 },
    );
    return String(r.stdout || '').slice(0, maxChars);
  } catch (e) {
    if (e && e.code !== 'NO_HEAD' && e.stdout !== undefined) {
      return String(e.stdout || '').slice(0, maxChars);
    }
    // Non-git (or unborn HEAD): render one block per edited file only.
    try {
      const out = [];
      for (const rel of rels) {
        const old = snapshotManifest ? snapshotManifest.get(rel) : undefined;
        const oldText = old && old.content !== null && old.content !== undefined ? String(old.content) : '';
        let curText = null;
        try {
          curText = fs.readFileSync(path.join(workspaceRoot, rel), 'utf8');
        } catch (err) {
          curText = null; // deleted file
        }
        out.push(`--- a/${rel}\n+++ b/${rel}`);
        if (curText === null) {
          const n = oldText === '' ? 0 : oldText.split('\n').length;
          out.push(`@@ -1${n ? `,${n}` : ''} +0,0 @@`);
          for (const l of oldText.split('\n')) {
            out.push(`-${l}`);
          }
        } else if (!old || oldText === '') {
          for (const l of String(curText).split('\n')) {
            out.push(`+${l}`);
          }
        } else if (oldText !== curText) {
          const a = oldText.split('\n');
          const b = String(curText).split('\n');
          let prefix = 0;
          while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
            prefix++;
          }
          let suffix = 0;
          while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) {
            suffix++;
          }
          for (const l of a.slice(prefix, a.length - suffix)) {
            out.push(`-${l}`);
          }
          for (const l of b.slice(prefix, b.length - suffix)) {
            out.push(`+${l}`);
          }
        }
        if (out.join('\n').length >= maxChars) {
          break;
        }
      }
      return out.join('\n').slice(0, maxChars);
    } catch (err) {
      return '';
    }
  }
}

module.exports = {
  showDiffForFile,
  showAllDiffs,
  getPatchText,
  snapshotOldContent,
  headContent,
  stagedContent,
};
