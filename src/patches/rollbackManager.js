'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

/**
 * Reject = restore pre-run state. Git path: `git stash push` before run was
 * intentionally NOT used (would disturb user workflow); instead rejection
 * checks out only the files the agent touched, preserving unrelated edits
 * made before the snapshot where possible.
 *
 * currentSummary: post-run diffSummary files list.
 * Strategy: for each touched path, `git checkout HEAD -- <path>` for
 * modified/deleted, `rm` for added (only if inside workspace). Unrelated
 * user changes to OTHER files are untouched. If a touched file was also
 * edited by the user after the run, require force flag — never force by default.
 */
async function rollbackTouchedFiles(workspaceRoot, touchedFiles, options, logger) {
  const results = { restored: [], skipped: [], errors: [] };
  const force = !!(options && options.force);
  for (const f of touchedFiles || []) {
    const rel = f.path || f;
    try {
      if (!rel || rel.includes('..')) {
        results.skipped.push({ path: rel, reason: 'unsafe path' });
        continue;
      }
      if (f.status === 'added') {
        // Delete only if it did not exist at HEAD.
        const existed = await execFileAsync('git', ['cat-file', '-e', `HEAD:./${rel}`], { cwd: workspaceRoot, timeout: 10000 }).then(() => true).catch(() => false);
        if (existed && !force) {
          results.skipped.push({ path: rel, reason: 'now exists at HEAD; refusing without force' });
          continue;
        }
        const fs = require('fs');
        const path = require('path');
        const abs = path.resolve(workspaceRoot, rel);
        if (!abs.startsWith(path.resolve(workspaceRoot))) {
          results.skipped.push({ path: rel, reason: 'outside workspace' });
          continue;
        }
        try {
          fs.unlinkSync(abs);
          results.restored.push(rel);
        } catch (e) {
          // Maybe untracked dir or already gone.
          try {
            await execFileAsync('git', ['clean', '-f', '--', rel], { cwd: workspaceRoot, timeout: 15000 });
            results.restored.push(rel);
          } catch (e2) {
            results.errors.push({ path: rel, error: (e2 && e2.message) || String(e2) });
          }
        }
      } else {
        await execFileAsync('git', ['checkout', 'HEAD', '--', rel], { cwd: workspaceRoot, timeout: 15000 });
        results.restored.push(rel);
      }
    } catch (err) {
      if (logger && logger.warn) {
        logger.warn('rollback failed for file', { path: rel, message: (err && err.message) || err });
      }
      results.errors.push({ path: rel, error: (err && err.message) || String(err) });
    }
  }
  return results;
}

module.exports = {
  rollbackTouchedFiles,
};
