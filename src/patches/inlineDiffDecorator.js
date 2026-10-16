'use strict';

const path = require('path');
const fs = require('fs');
const { isInsideWorkspace } = require('./patchValidator');
const { snapshotOldContent, headContent, stagedContent } = require('./diffProvider');

function truncate(str, maxLen = 70) {
  const s = String(str || '').replace(/\r/g, '').trim();
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + '…';
}

/**
 * Line-based diff algorithm to locate changed hunks between old and new text.
 * Finds common prefixes, suffixes, and matching anchors within the middle.
 * Returns array of hunks: { oldStart, oldCount, oldLines, newStart, newCount, newLines }
 * Line numbers are 0-indexed.
 */
function findHunks(oldLines, newLines, oldOffset = 0, newOffset = 0) {
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const oMid = oldLines.slice(prefix, oldLines.length - suffix);
  const nMid = newLines.slice(prefix, newLines.length - suffix);

  if (oMid.length === 0 && nMid.length === 0) {
    return [];
  }

  // Look for a significant matching anchor (at least 2 consecutive identical non-empty lines)
  let bestMatch = null;
  for (let i = 0; i < oMid.length; i++) {
    for (let j = 0; j < nMid.length; j++) {
      if (oMid[i] === nMid[j] && oMid[i].trim().length > 0) {
        let len = 1;
        while (i + len < oMid.length && j + len < nMid.length && oMid[i + len] === nMid[j + len]) {
          len++;
        }
        if (len >= 2 && (!bestMatch || len > bestMatch.len)) {
          bestMatch = { i, j, len };
        }
      }
    }
  }

  if (bestMatch && bestMatch.len >= 2) {
    const leftHunks = findHunks(
      oMid.slice(0, bestMatch.i),
      nMid.slice(0, bestMatch.j),
      oldOffset + prefix,
      newOffset + prefix,
    );
    const rightHunks = findHunks(
      oMid.slice(bestMatch.i + bestMatch.len),
      nMid.slice(bestMatch.j + bestMatch.len),
      oldOffset + prefix + bestMatch.i + bestMatch.len,
      newOffset + prefix + bestMatch.j + bestMatch.len,
    );
    return [...leftHunks, ...rightHunks];
  }

  return [{
    oldStart: oldOffset + prefix,
    oldCount: oMid.length,
    oldLines: oMid,
    newStart: newOffset + prefix,
    newCount: nMid.length,
    newLines: nMid,
  }];
}

class InlineDiffDecorator {
  constructor(options) {
    this.vscode = options.vscode;
    this.workspaceRoot = options.workspaceRoot;
    this.patchManager = options.patchManager;
    this.logger = options.logger || console;
    this.onResolve = options.onResolve || null;
    this.isBusy = options.isBusy || null;
    this.disposables = [];
    this.sessionState = new Map(); // relPath -> { relPath, docUri, hunks, appliedHunks, isProcessing, active }
    this.resolvedPatches = new Set();
    this.resolvedFiles = new Set();

    this.initDecorations();
    this.registerCommands();
    this.registerCodeLens();
    this.registerListeners();
  }

  initDecorations() {
    if (this.vscode.window && typeof this.vscode.window.createTextEditorDecorationType === 'function') {
      // Red highlight for old code (top block, no strikethrough, pure background color)
      this.removedLineType = this.vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        backgroundColor: 'rgba(248, 81, 73, 0.22)',
        overviewRulerColor: 'rgba(248, 81, 73, 0.75)',
        overviewRulerLane: this.vscode.OverviewRulerLane ? this.vscode.OverviewRulerLane.Left : 1,
      });

      // Green highlight for new code (bottom block, directly below old code, pure background color)
      this.addedLineType = this.vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        backgroundColor: 'rgba(46, 160, 67, 0.18)',
        overviewRulerColor: 'rgba(46, 160, 67, 0.75)',
        overviewRulerLane: this.vscode.OverviewRulerLane ? this.vscode.OverviewRulerLane.Left : 1,
      });

      this.disposables.push(this.removedLineType);
      this.disposables.push(this.addedLineType);
    }
  }

  registerCommands() {
    if (!this.vscode.commands || typeof this.vscode.commands.registerCommand !== 'function') return;

    this.disposables.push(
      this.vscode.commands.registerCommand('freecli.keepFileChanges', async (uri, hunkIdx) => {
        await this.acceptFile(uri, hunkIdx);
      })
    );

    this.disposables.push(
      this.vscode.commands.registerCommand('freecli.undoFileChanges', async (uri, hunkIdx) => {
        await this.revertFile(uri, hunkIdx);
      })
    );
  }

  registerCodeLens() {
    if (!this.vscode.EventEmitter || !this.vscode.languages || typeof this.vscode.languages.registerCodeLensProvider !== 'function') {
      return;
    }
    const self = this;
    const onDidChangeCodeLensesEmitter = new this.vscode.EventEmitter();
    this.codeLensEmitter = onDidChangeCodeLensesEmitter;
    this.disposables.push(onDidChangeCodeLensesEmitter);

    const provider = {
      onDidChangeCodeLenses: onDidChangeCodeLensesEmitter.event,
      provideCodeLenses(document) {
        const root = typeof self.workspaceRoot === 'function' ? self.workspaceRoot() : self.workspaceRoot;
        if (!root || !document || !document.fileName) return [];
        const abs = document.fileName;
        if (!isInsideWorkspace(root, abs)) return [];
        const rel = path.relative(path.resolve(root), abs);
        const session = self.sessionState.get(rel);
        if (!session || !session.active || !session.appliedHunks || !session.appliedHunks.length) return [];

        const lenses = [];
        session.appliedHunks.forEach((h, hIdx) => {
          const topStart = h.redCount > 0 ? h.redStart : h.greenStart;
          const line = Math.min(Math.max(0, topStart), Math.max(0, document.lineCount - 1));
          const range = new self.vscode.Range(line, 0, line, 0);

          lenses.push(new self.vscode.CodeLens(range, {
            title: '✓ Keep',
            tooltip: 'Keep new code (green) and remove old code (red)',
            command: 'freecli.keepFileChanges',
            arguments: [document.uri, hIdx],
          }));

          lenses.push(new self.vscode.CodeLens(range, {
            title: '✗ Undo',
            tooltip: 'Restore old code (red) and remove new code (green)',
            command: 'freecli.undoFileChanges',
            arguments: [document.uri, hIdx],
          }));

          lenses.push(new self.vscode.CodeLens(range, {
            title: '⎘ Review Diff',
            tooltip: 'Open native side-by-side diff editor',
            command: 'freecli.reviewPatch',
          }));
        });
        return lenses;
      },
    };

    this.disposables.push(
      this.vscode.languages.registerCodeLensProvider({ scheme: 'file' }, provider)
    );
  }

  registerListeners() {
    if (!this.vscode.window || !this.vscode.workspace) return;
    if (typeof this.vscode.window.onDidChangeActiveTextEditor === 'function') {
      this.disposables.push(
        this.vscode.window.onDidChangeActiveTextEditor((ed) => {
          if (ed) this.updateEditor(ed);
        })
      );
    }

    if (typeof this.vscode.workspace.onDidChangeTextDocument === 'function') {
      this.disposables.push(
        this.vscode.workspace.onDidChangeTextDocument((evt) => {
          const root = typeof this.workspaceRoot === 'function' ? this.workspaceRoot() : this.workspaceRoot;
          if (!root || !evt.document || !evt.document.fileName) return;
          const rel = path.relative(path.resolve(root), evt.document.fileName);
          const session = this.sessionState.get(rel);
          if (session && session.isProcessing) return;
          const active = this.vscode.window.activeTextEditor;
          if (active && active.document === evt.document) {
            this.applySessionDecorations(active, session);
          }
        })
      );
    }

    if (typeof this.vscode.workspace.onDidOpenTextDocument === 'function') {
      this.disposables.push(
        this.vscode.workspace.onDidOpenTextDocument((doc) => {
          const visible = this.vscode.window.visibleTextEditors || [];
          const ed = visible.find((e) => e.document === doc);
          if (ed) this.updateEditor(ed);
        })
      );
    }
  }

  async getOriginalContent(root, relPath) {
    const pending = this.patchManager.getPending();
    const manifest = (pending && pending.snapshot && pending.snapshot.manifest) ||
      (this.patchManager.lastSnapshot && this.patchManager.lastSnapshot.manifest);

    let original = snapshotOldContent(manifest, relPath);
    if (original === null) {
      original = await headContent(root, relPath);
    }
    if (original === null) {
      original = await stagedContent(root, relPath);
    }
    return original;
  }

  hasPendingChanges() {
    const pending = this.patchManager.getPending();
    if (pending && pending.files && pending.files.length > 0 && !pending.resolved && !this.resolvedPatches.has(pending.patchId)) {
      return true;
    }
    if (typeof this.isBusy === 'function' && this.isBusy() && this.patchManager.lastSnapshot) {
      return true;
    }
    return false;
  }

  async updateEditor(editor) {
    if (!editor || !editor.document || !editor.document.fileName) return;
    const root = typeof this.workspaceRoot === 'function' ? this.workspaceRoot() : this.workspaceRoot;
    if (!root) {
      this.clearEditor(editor);
      return;
    }
    const abs = editor.document.fileName;
    if (!isInsideWorkspace(root, abs)) {
      this.clearEditor(editor);
      return;
    }
    const rel = path.relative(path.resolve(root), abs);

    if (!this.hasPendingChanges()) {
      await this.clearFileSession(editor, rel);
      return;
    }
    if (this.resolvedFiles.has(rel)) {
      await this.clearFileSession(editor, rel);
      return;
    }
    const pending = this.patchManager.getPending();
    const isFilePending = pending && pending.files && pending.files.some((f) => (f.path || f) === rel);
    const isBusyRun = typeof this.isBusy === 'function' && this.isBusy();
    if (!isFilePending && !isBusyRun) {
      await this.clearFileSession(editor, rel);
      return;
    }

    let session = this.sessionState.get(rel);
    if (session && session.active) {
      this.applySessionDecorations(editor, session);
      return;
    }

    try {
      const original = await this.getOriginalContent(root, rel);
      if (original === null && !this.patchManager.getPending()) {
        await this.clearFileSession(editor, rel);
        return;
      }

      const oldText = original === null ? '' : original;
      const currentText = editor.document.getText();

      if (oldText === currentText) {
        await this.clearFileSession(editor, rel);
        return;
      }

      const oldLines = oldText.split('\n');
      const newLines = currentText.split('\n');
      const hunks = findHunks(oldLines, newLines);

      if (!hunks.length) {
        await this.clearFileSession(editor, rel);
        return;
      }

      // Calculate cumulative shift from top to bottom
      let cumulativeShift = 0;
      const appliedHunks = [];
      const sortedAsc = [...hunks].sort((a, b) => a.newStart - b.newStart);
      for (const h of sortedAsc) {
        const redStart = h.newStart + cumulativeShift;
        const redCount = h.oldCount;
        const greenStart = redStart + redCount;
        const greenCount = h.newCount;
        appliedHunks.push({
          redStart,
          redCount,
          greenStart,
          greenCount,
          oldLines: h.oldLines,
          newLines: h.newLines,
        });
        cumulativeShift += redCount;
      }

      session = {
        relPath: rel,
        docUri: editor.document.uri.toString(),
        hunks,
        appliedHunks,
        isProcessing: true,
        active: true,
      };
      this.sessionState.set(rel, session);

      // Insert old code above new code (bottom-to-top so line numbers stay accurate)
      if (typeof editor.edit === 'function') {
        const sortedDesc = [...hunks].sort((a, b) => b.newStart - a.newStart);
        await editor.edit((editBuilder) => {
          for (const h of sortedDesc) {
            if (h.oldCount > 0) {
              const line = Math.min(Math.max(0, h.newStart), editor.document.lineCount);
              const pos = new this.vscode.Position(line, 0);
              editBuilder.insert(pos, h.oldLines.join('\n') + '\n');
            }
          }
        }, { undoStopBefore: false, undoStopAfter: false });
      }

      session.isProcessing = false;
      this.applySessionDecorations(editor, session);
      if (this.codeLensEmitter) this.codeLensEmitter.fire();
    } catch (e) {
      if (session) session.isProcessing = false;
      if (this.logger && this.logger.warn) {
        this.logger.warn('inlineDiffDecorator updateEditor error', { path: rel, error: (e && e.message) || e });
      }
    }
  }

  applySessionDecorations(editor, session) {
    if (!editor || !session || !session.appliedHunks || !this.addedLineType || !this.removedLineType) return;
    if (typeof editor.setDecorations !== 'function') return;

    const redDecorations = [];
    const greenDecorations = [];
    const doc = editor.document;
    const lang = doc.languageId || 'text';

    for (const h of session.appliedHunks) {
      const hover = new this.vscode.MarkdownString();
      hover.isTrusted = true;
      hover.appendMarkdown('### Proposed Changes (Pending Review)\n\n');
      if (h.redCount > 0) {
        hover.appendMarkdown('**Old code (red area):**\n');
        hover.appendCodeblock(h.oldLines.join('\n'), lang);
      }
      if (h.greenCount > 0) {
        hover.appendMarkdown('**New code (green area):**\n');
        hover.appendCodeblock(h.newLines.join('\n'), lang);
      }
      hover.appendMarkdown('\nClick **Keep** to accept new code or **Undo** to restore old code.');

      // 1. Red whole-line background for old code block (top) - NO STRIKETHROUGH
      if (h.redCount > 0) {
        const rStart = Math.min(Math.max(0, h.redStart), doc.lineCount - 1);
        const rEnd = Math.min(rStart + h.redCount - 1, doc.lineCount - 1);
        const rEndLen = doc.lineAt(rEnd).text.length;
        redDecorations.push({
          range: new this.vscode.Range(rStart, 0, rEnd, rEndLen),
          hoverMessage: hover,
        });
      }

      // 2. Green whole-line background for new code block (bottom, directly below old code)
      if (h.greenCount > 0) {
        const gStart = Math.min(Math.max(0, h.greenStart), doc.lineCount - 1);
        const gEnd = Math.min(gStart + h.greenCount - 1, doc.lineCount - 1);
        const gEndLen = doc.lineAt(gEnd).text.length;
        greenDecorations.push({
          range: new this.vscode.Range(gStart, 0, gEnd, gEndLen),
          hoverMessage: hover,
        });
      }
    }

    editor.setDecorations(this.removedLineType, redDecorations);
    editor.setDecorations(this.addedLineType, greenDecorations);
  }

  async acceptFile(documentUri, hunkIdx) {
    const uriStr = documentUri ? documentUri.toString() : '';
    let targetEntry = null;
    for (const [rel, s] of this.sessionState.entries()) {
      if (s.docUri === uriStr || !documentUri) {
        targetEntry = { rel, session: s };
        break;
      }
    }
    if (!targetEntry) return;

    const { rel, session } = targetEntry;
    const editor = (this.vscode.window.visibleTextEditors || []).find((e) => e.document.uri.toString() === session.docUri);
    if (!editor || typeof editor.edit !== 'function') return;

    session.isProcessing = true;
    try {
      // Remove the red (old) lines so only green (new) lines remain
      const hunksToDelete = (typeof hunkIdx === 'number' && session.appliedHunks[hunkIdx])
        ? [session.appliedHunks[hunkIdx]]
        : [...session.appliedHunks];

      // Sort descending so deletions do not alter earlier line offsets
      hunksToDelete.sort((a, b) => b.redStart - a.redStart);

      await editor.edit((editBuilder) => {
        for (const h of hunksToDelete) {
          if (h.redCount > 0) {
            const startLine = h.redStart;
            const endLine = Math.min(h.redStart + h.redCount, editor.document.lineCount);
            editBuilder.delete(new this.vscode.Range(startLine, 0, endLine, 0));
          }
        }
      }, { undoStopBefore: false, undoStopAfter: false });

      if (typeof editor.document.save === 'function') {
        await editor.document.save();
      }

      this.clearEditor(editor);
      this.sessionState.delete(rel);
      this.resolvedFiles.add(rel);
      if (typeof this.onResolve === 'function') {
        const pending = this.patchManager.getPending();
        const pid = (pending && pending.patchId) || null;
        if (pid) this.resolvedPatches.add(pid);
        this.onResolve('applied', rel, pid);
      }
      if (this.codeLensEmitter) this.codeLensEmitter.fire();
    } finally {
      session.isProcessing = false;
    }
  }

  async revertFile(documentUri, hunkIdx) {
    const uriStr = documentUri ? documentUri.toString() : '';
    let targetEntry = null;
    for (const [rel, s] of this.sessionState.entries()) {
      if (s.docUri === uriStr || !documentUri) {
        targetEntry = { rel, session: s };
        break;
      }
    }
    if (!targetEntry) return;

    const { rel, session } = targetEntry;
    const editor = (this.vscode.window.visibleTextEditors || []).find((e) => e.document.uri.toString() === session.docUri);
    if (!editor || typeof editor.edit !== 'function') return;

    session.isProcessing = true;
    try {
      // Remove the green (new) lines so only red (old) lines remain
      const hunksToDelete = (typeof hunkIdx === 'number' && session.appliedHunks[hunkIdx])
        ? [session.appliedHunks[hunkIdx]]
        : [...session.appliedHunks];

      // Sort descending so deletions do not alter earlier line offsets
      hunksToDelete.sort((a, b) => b.greenStart - a.greenStart);

      await editor.edit((editBuilder) => {
        for (const h of hunksToDelete) {
          if (h.greenCount > 0) {
            const startLine = h.greenStart;
            const endLine = Math.min(h.greenStart + h.greenCount, editor.document.lineCount);
            editBuilder.delete(new this.vscode.Range(startLine, 0, endLine, 0));
          }
        }
      }, { undoStopBefore: false, undoStopAfter: false });

      if (typeof editor.document.save === 'function') {
        await editor.document.save();
      }

      this.clearEditor(editor);
      this.sessionState.delete(rel);
      this.resolvedFiles.add(rel);
      if (typeof this.onResolve === 'function') {
        const pending = this.patchManager.getPending();
        const pid = (pending && pending.patchId) || null;
        if (pid) this.resolvedPatches.add(pid);
        this.onResolve('rejected', rel, pid);
      }
      if (this.codeLensEmitter) this.codeLensEmitter.fire();
    } finally {
      session.isProcessing = false;
    }
  }

  resetResolved() {
    this.resolvedPatches.clear();
    this.resolvedFiles.clear();
  }

  async acceptAll() {
    const sessions = Array.from(this.sessionState.values());
    for (const s of sessions) {
      await this.acceptFile(s.docUri);
    }
    this.clear();
  }

  async revertAll() {
    const sessions = Array.from(this.sessionState.values());
    for (const s of sessions) {
      await this.revertFile(s.docUri);
    }
    this.clear();
  }

  clearEditor(editor) {
    if (!editor || typeof editor.setDecorations !== 'function') return;
    try {
      if (this.addedLineType) editor.setDecorations(this.addedLineType, []);
      if (this.removedLineType) editor.setDecorations(this.removedLineType, []);
    } catch (e) {}
  }

  async clearFileSession(editor, rel) {
    this.clearEditor(editor);
    this.sessionState.delete(rel);
    if (this.codeLensEmitter) this.codeLensEmitter.fire();
  }

  clear() {
    this.sessionState.clear();
    const editors = (this.vscode.window.visibleTextEditors || []);
    for (const ed of editors) {
      this.clearEditor(ed);
    }
    if (this.codeLensEmitter) this.codeLensEmitter.fire();
  }

  updateAll() {
    const editors = (this.vscode.window.visibleTextEditors || []);
    for (const ed of editors) {
      this.updateEditor(ed);
    }
  }

  dispose() {
    this.clear();
    for (const d of this.disposables) {
      try {
        if (d && typeof d.dispose === 'function') d.dispose();
      } catch (e) {}
    }
    this.disposables = [];
  }
}

module.exports = {
  findHunks,
  truncate,
  InlineDiffDecorator,
};
