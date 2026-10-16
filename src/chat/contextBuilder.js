'use strict';

const crypto = require('crypto');
const path = require('path');
let webSearchModule = null;
try {
  webSearchModule = require('./webSearch');
} catch (e) {}

function sha1(text) {
  return crypto.createHash('sha1').update(text || '', 'utf8').digest('hex');
}

/**
 * Capture selected-code context from a VS Code editor.
 * Accepts a vscode-like API object for testability; falls back gracefully.
 */
function captureSelection(vscode, workspaceRoot) {
  try {
    const editor = vscode && vscode.window && vscode.window.activeTextEditor;
    if (!editor || !editor.document || !editor.selection) {
      return { hasSelection: false };
    }
    const doc = editor.document;
    const sel = editor.selection;
    if (sel.isEmpty) {
      return { hasSelection: false, filePath: doc.fileName, language: doc.languageId };
    }
    const selectedCode = doc.getText(sel);
    const startLine = sel.start.line + 1; // 1-based for display
    const endLine = sel.end.line + 1;
    const rel = workspaceRoot && doc.fileName ? relativeSafe(workspaceRoot, doc.fileName) : path.basename(doc.fileName || 'untitled');
    return {
      hasSelection: true,
      filePath: rel,
      name: path.basename(rel),
      absolutePath: doc.fileName,
      language: doc.languageId,
      startLine,
      endLine,
      startCol: sel.start.character,
      endCol: sel.end.character,
      selectedCode,
      documentVersion: doc.version,
      contentHash: sha1(selectedCode),
    };
  } catch (e) {
    return { hasSelection: false, error: (e && e.message) || String(e) };
  }
}

function relativeSafe(root, abs) {
  try {
    const rel = path.relative(root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return path.basename(abs);
    }
    return rel;
  } catch (e) {
    return path.basename(abs || 'file');
  }
}

function truncate(text, max) {
  if (!text) {
    return '';
  }
  if (text.length <= max) {
    return text;
  }
  return text.slice(0, max) + '\n…[truncated]';
}

/**
 * Build the structured prompt sent to the CLI.
 */
function buildPrompt(userRequest, selectionCtx, options) {
  const opts = options || {};
  const maxChars = opts.maxContextCharacters || 8000;
  const includeSurrounding = opts.includeSurroundingCode !== false;
  const workspace = opts.workspace || '';
  const mode = opts.mode === 'plan' ? 'plan' : opts.mode === 'ask' ? 'ask' : 'build';
  const modeLine = mode === 'plan'
    ? 'PLAN MODE: produce a concrete step-by-step plan only; do not modify any files.'
    : mode === 'ask'
      ? 'ASK MODE: answer questions directly; do not modify any files.'
      : 'BUILD MODE: implement the needed changes; keep the diff minimal and reviewable.';

  const parts = [];
  const dateTime = opts.dateTime || (webSearchModule ? webSearchModule.getCurrentDateTime().formatted : null);
  if (dateTime) {
    parts.push(`Current date and time:\n${dateTime}`);
  }
  parts.push(`User request:\n${userRequest}`);
  if (opts.webReferences) {
    parts.push(opts.webReferences);
  }
  if (workspace) {
    parts.push(`\nWorkspace:\n${workspace}`);
  }
  if (selectionCtx && selectionCtx.hasSelection) {
    parts.push(`\nTarget file:\n${selectionCtx.filePath}`);
    parts.push(`\nSelected range:\n${selectionCtx.startLine}-${selectionCtx.endLine}`);
    parts.push(`\nSelected code (${selectionCtx.language || 'text'}):\n${truncate(selectionCtx.selectedCode, maxChars)}`);
    if (includeSurrounding && selectionCtx.surrounding) {
      parts.push(`\nRelevant surrounding context:\n${truncate(selectionCtx.surrounding, Math.floor(maxChars / 2))}`);
    }
    parts.push(`\nInstructions:
- Treat the selection as the primary target.
- Preserve existing functionality.
- Inspect dependencies when needed.
- Avoid unrelated changes.
- Explain necessary changes outside the selected range.
- Return changes in a form the extension can review.
- Do not overwrite unrelated modifications.
- Follow project conventions.
- ${modeLine}`);
  } else {
    parts.push(`\nInstructions:
- Answer the request directly for the workspace above.
- Keep changes minimal and reviewable.
- Follow project conventions.
- ${modeLine}`);
  }
  // Attached files (picked via the panel's + button), each budget-capped.
  const attachList = Array.isArray(opts.attachedFiles) ? opts.attachedFiles : [];
  if (attachList.length > 0) {
    const perFile = Math.max(800, Math.floor(maxChars / attachList.length));
    for (const f of attachList) {
      if (!f || !f.path) {
        continue;
      }
      parts.push(`\nAttached file (${f.path}):\n${'\u0060\u0060\u0060'}\n${truncate(String(f.content === undefined || f.content === null ? '' : f.content), perFile)}\n${'\u0060\u0060\u0060'}`);
    }
    parts.push(`\nInstructions:
- The attached files above are extra context provided by the user.
- Reference them as needed; treat the target selection (if any) as primary.`);
  }
  return parts.join('\n');
}

module.exports = {
  captureSelection,
  buildPrompt,
  sha1,
  truncate,
};
