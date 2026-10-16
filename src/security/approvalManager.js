'use strict';

const { isInsideWorkspace } = require('../patches/patchValidator');

class ApprovalManager {
  constructor(options) {
    this.options = options || {};
    this.requireApproval = this.options.requireApproval !== false;
    this.patchMode = this.options.patchMode || 'reviewBeforeApply';
  }

  isReviewMode() {
    return this.patchMode !== 'directEdit';
  }

  validateFileOp(workspaceRoot, relPath) {
    if (!isInsideWorkspace(workspaceRoot, relPath)) {
      return { ok: false, reason: `Blocked: ${relPath} is outside the workspace.` };
    }
    if (relPath.includes('..')) {
      return { ok: false, reason: `Blocked: suspicious path ${relPath}.` };
    }
    return { ok: true };
  }

  async confirmApply(vscode, summary) {
    if (!this.requireApproval) {
      return true;
    }
    const count = summary && summary.files ? summary.files.length : 0;
    const answer = await vscode.window.showWarningMessage(
      `Apply ${count} file change(s) to your workspace?`,
      { modal: true },
      'Apply changes',
      'Review first',
      'Cancel'
    );
    return answer === 'Apply changes';
  }
}

module.exports = {
  ApprovalManager,
};
