'use strict';

const { validatePatch } = require('./patchValidator');

/**
 * In reviewBeforeApply mode with `run --format json`, the CLI already edited
 * the working tree (OpenCode tools act directly). "Apply" therefore means:
 * validate the captured post-run diff is still current + user-approved, then
 * keep it (no-op) — or in a future isolated-worktree mode, copy files over.
 * "Reject" means restore the pre-run snapshot (git checkout / stash pop).
 * This module validates; actual git restore lives in rollbackManager.
 */
async function applyPendingPatch(pending, currentState, workspaceRoot, options) {
  const validation = validatePatch(pending, currentState, workspaceRoot, options);
  if (!validation.ok) {
    return { applied: false, issues: validation.issues };
  }
  if (options && options.requireApproval && !options.approved) {
    return { applied: false, issues: ['Approval required before applying changes.'] };
  }
  // Nothing to copy in direct-worktree mode; changes are already in place
  // and validated. Report success honestly.
  return { applied: true, issues: [], note: 'Validated current working-tree changes; no additional file writes were needed.' };
}

module.exports = {
  applyPendingPatch,
};
