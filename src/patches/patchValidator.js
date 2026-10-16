'use strict';

const path = require('path');

function isInsideWorkspace(workspaceRoot, targetPath) {
  if (!workspaceRoot || !targetPath) {
    return false;
  }
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, targetPath);
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveInside(workspaceRoot, targetPath) {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, targetPath);
  return target;
}

/**
 * Validate a proposed patch before application.
 * patch: { files: [{ path, status, originalHash?, newContent? }], baseCommit?/baseSnapshot }
 * currentState: Map path -> { hash, exists }
 */
function validatePatch(patch, currentState, workspaceRoot, options) {
  const issues = [];
  if (!patch || !Array.isArray(patch.files) || patch.files.length === 0) {
    return { ok: false, issues: ['Patch contains no files.'] };
  }
  for (const f of patch.files) {
    if (!f.path) {
      issues.push('Patch file entry is missing a path.');
      continue;
    }
    if (!isInsideWorkspace(workspaceRoot, f.path)) {
      issues.push(`Path traversal blocked: ${f.path} is outside the workspace.`);
      continue;
    }
    if (f.status === 'deleted' && options && options.allowDeletes !== true && options.requireDeleteConfirm) {
      issues.push(`Deletion requires explicit confirmation: ${f.path}.`);
    }
    const current = currentState ? currentState.get(f.path) : null;
    if (f.originalHash && current && current.hash && f.originalHash !== current.hash) {
      issues.push(`Stale patch for ${f.path}: file changed since proposal. Re-review required.`);
    }
    // Only flag a missing entry when the caller actually supplied state.
    // A null/undefined currentState means "unknown" — it must not fail
    // validation (otherwise every Apply with no state reports a Conflict).
    if (currentState && !current && f.status === 'modified') {
      // New file created by user meanwhile or deleted — flag, don't force.
      issues.push(`Conflict for ${f.path}: expected original content but file state differs.`);
    }
  }
  return { ok: issues.length === 0, issues };
}

module.exports = {
  isInsideWorkspace,
  resolveInside,
  validatePatch,
};
