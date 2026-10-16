'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { findHunks, truncate, InlineDiffDecorator } = require('../src/patches/inlineDiffDecorator');

describe('findHunks', () => {
  it('returns empty array when content is identical', () => {
    const lines = ['function test() {', '  return 42;', '}'];
    const hunks = findHunks(lines, lines);
    assert.deepEqual(hunks, []);
  });

  it('detects a single modified block in the middle of a file', () => {
    const oldLines = [];
    const newLines = [];
    for (let i = 1; i <= 300; i++) {
      if (i >= 255 && i <= 260) {
        oldLines.push(`line ${i} old code`);
        newLines.push(`line ${i} new changes`);
      } else {
        oldLines.push(`line ${i}`);
        newLines.push(`line ${i}`);
      }
    }
    const hunks = findHunks(oldLines, newLines);
    assert.equal(hunks.length, 1);
    const h = hunks[0];
    assert.equal(h.newStart, 254); // 0-based line 255
    assert.equal(h.newCount, 6);
    assert.equal(h.oldStart, 254);
    assert.equal(h.oldCount, 6);
    assert.equal(h.newLines[0], 'line 255 new changes');
    assert.equal(h.oldLines[0], 'line 255 old code');
  });

  it('detects pure addition', () => {
    const oldLines = ['start', 'end'];
    const newLines = ['start', 'middle 1', 'middle 2', 'end'];
    const hunks = findHunks(oldLines, newLines);
    assert.equal(hunks.length, 1);
    assert.equal(hunks[0].newStart, 1);
    assert.equal(hunks[0].newCount, 2);
    assert.equal(hunks[0].oldCount, 0);
  });

  it('detects pure deletion', () => {
    const oldLines = ['start', 'del 1', 'del 2', 'end'];
    const newLines = ['start', 'end'];
    const hunks = findHunks(oldLines, newLines);
    assert.equal(hunks.length, 1);
    assert.equal(hunks[0].newStart, 1);
    assert.equal(hunks[0].newCount, 0);
    assert.equal(hunks[0].oldCount, 2);
  });

  it('detects multiple separated hunks across a file', () => {
    const oldLines = ['a1', 'a2_old', 'common1', 'common2', 'common3', 'b1_old', 'b2'];
    const newLines = ['a1', 'a2_new', 'common1', 'common2', 'common3', 'b1_new', 'b2'];
    const hunks = findHunks(oldLines, newLines);
    assert.equal(hunks.length, 2);
    assert.equal(hunks[0].newStart, 1);
    assert.equal(hunks[1].newStart, 5);
  });
});

describe('truncate', () => {
  it('truncates strings exceeding max length', () => {
    const longStr = 'a'.repeat(100);
    const res = truncate(longStr, 20);
    assert.equal(res.length, 20);
    assert.ok(res.endsWith('…'));
  });

  it('keeps short strings unchanged', () => {
    assert.equal(truncate('short text', 20), 'short text');
  });
});

describe('InlineDiffDecorator', () => {
  function createMockVscode(root) {
    const decorations = new Map();
    let codeLensProvider = null;

    class MockRange {
      constructor(startLine, startCol, endLine, endCol) {
        if (typeof startLine === 'object' && startLine !== null) {
          this.start = startLine;
          this.end = startCol;
        } else {
          this.start = { line: startLine, character: startCol };
          this.end = { line: endLine, character: endCol };
        }
      }
    }

    class MockMarkdownString {
      constructor() {
        this.value = '';
      }
      appendMarkdown(s) { this.value += s; }
      appendCodeblock(c, l) { this.value += `\n\`\`\`${l}\n${c}\n\`\`\`\n`; }
    }

    class MockCodeLens {
      constructor(range, command) {
        this.range = range;
        this.command = command;
      }
    }

    class MockEventEmitter {
      constructor() {
        this.listeners = [];
        this.event = (cb) => { this.listeners.push(cb); return { dispose: () => {} }; };
      }
      fire(data) {
        for (const cb of this.listeners) cb(data);
      }
    }

    class MockPosition {
      constructor(line, character) {
        this.line = line;
        this.character = character;
      }
    }

    return {
      Position: MockPosition,
      Range: MockRange,
      MarkdownString: MockMarkdownString,
      CodeLens: MockCodeLens,
      EventEmitter: MockEventEmitter,
      OverviewRulerLane: { Left: 1 },
      commands: {
        registerCommand: () => ({ dispose: () => {} }),
      },
      window: {
        visibleTextEditors: [],
        activeTextEditor: null,
        createTextEditorDecorationType: (opts) => {
          const key = Symbol('decType');
          decorations.set(key, opts);
          return key;
        },
        onDidChangeActiveTextEditor: () => ({ dispose: () => {} }),
      },
      workspace: {
        workspaceFolders: [{ uri: { fsPath: root }, name: 'MockRoot' }],
        onDidChangeTextDocument: () => ({ dispose: () => {} }),
        onDidOpenTextDocument: () => ({ dispose: () => {} }),
      },
      languages: {
        registerCodeLensProvider: (selector, provider) => {
          codeLensProvider = provider;
          return { dispose: () => {} };
        },
      },
      _decorations: decorations,
      _getCodeLensProvider: () => codeLensProvider,
    };
  }

  it('decorates added lines in green and replaced lines in red, provides CodeLens', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inline-diff-test-'));
    try {
      const mockVscode = createMockVscode(tmpDir);
      const filePath = path.join(tmpDir, 'sample.js');
      const oldCode = 'function calc() {\n  const x = 1;\n  const y = 2;\n  return x + y;\n}\n';
      const newCode = 'function calc() {\n  const x = 100;\n  const y = 200;\n  const z = 300;\n  return x + y + z;\n}\n';
      fs.writeFileSync(filePath, newCode, 'utf8');

      const mockSnapshot = {
        manifest: new Map([
          ['sample.js', { content: oldCode }],
        ]),
      };

      const mockPatchManager = {
        getPending: () => ({
          files: [{ path: 'sample.js', status: 'modified' }],
          snapshot: mockSnapshot,
        }),
        lastSnapshot: mockSnapshot,
      };

      const decorator = new InlineDiffDecorator({
        vscode: mockVscode,
        workspaceRoot: tmpDir,
        patchManager: mockPatchManager,
        logger: console,
      });

      let docContent = newCode;
      const appliedDecorations = new Map();
      const mockEditor = {
        document: {
          fileName: filePath,
          uri: { toString: () => `file://${filePath}` },
          languageId: 'javascript',
          get lineCount() { return docContent.split('\n').length; },
          getText: () => docContent,
          lineAt: (n) => ({ text: docContent.split('\n')[n] || '' }),
          save: async () => {},
        },
        edit: async (callback) => {
          const editBuilder = {
            insert: (pos, text) => {
              const lines = docContent.split('\n');
              const before = lines.slice(0, pos.line);
              const after = lines.slice(pos.line);
              const insertedLines = text.split('\n');
              if (insertedLines[insertedLines.length - 1] === '') {
                insertedLines.pop();
              }
              docContent = [...before, ...insertedLines, ...after].join('\n');
            },
            delete: (range) => {
              const lines = docContent.split('\n');
              const before = lines.slice(0, range.start.line);
              const after = lines.slice(range.end.line);
              docContent = [...before, ...after].join('\n');
            },
          };
          await callback(editBuilder);
        },
        setDecorations: (type, opts) => {
          appliedDecorations.set(type, opts);
        },
      };

      mockVscode.window.visibleTextEditors = [mockEditor];
      mockVscode.window.activeTextEditor = mockEditor;

      await decorator.updateEditor(mockEditor);

      const added = appliedDecorations.get(decorator.addedLineType);
      const removed = appliedDecorations.get(decorator.removedLineType);

      assert.ok(added && added.length > 0, 'must have green addedLine decorations');
      assert.ok(removed && removed.length > 0, 'must have red removedLine decorations');

      // The red area is on top, and green area is directly below it
      const redRange = removed[0].range;
      const greenRange = added[0].range;
      assert.ok(redRange.start.line < greenRange.start.line, 'red area must be above green area (up-down layout)');
      assert.equal(greenRange.start.line, redRange.end.line + 1, 'green area must be immediately below red area');

      // Check red decoration configuration has whole line red background and no strikethrough or borders
      const redDecOpts = mockVscode._decorations.get(decorator.removedLineType);
      assert.equal(redDecOpts.isWholeLine, true, 'must be whole line');
      assert.match(redDecOpts.backgroundColor, /248, 81, 73/, 'must have red background');
      assert.ok(!redDecOpts.textDecoration, 'must have no strikethrough');
      assert.ok(!redDecOpts.borderWidth, 'must have no left border or thick line');
      assert.ok(!redDecOpts.borderColor, 'must have no border color');

      const greenDecOpts = mockVscode._decorations.get(decorator.addedLineType);
      assert.equal(greenDecOpts.isWholeLine, true, 'must be whole line');
      assert.match(greenDecOpts.backgroundColor, /46, 160, 67/, 'must have green background');
      assert.ok(!greenDecOpts.borderWidth, 'must have no left border or thick line');
      assert.ok(!greenDecOpts.borderColor, 'must have no border color');

      // Check CodeLens provider provides Keep, Undo, Review Diff
      const provider = mockVscode._getCodeLensProvider();
      assert.ok(provider, 'CodeLens provider must be registered');
      const lenses = provider.provideCodeLenses(mockEditor.document);
      assert.ok(lenses && lenses.length >= 3);
      assert.ok(lenses.some((l) => l.command.title === '✓ Keep'));
      assert.ok(lenses.some((l) => l.command.title === '✗ Undo'));
      assert.ok(lenses.some((l) => l.command.title === '⎘ Review Diff'));

      // Test acceptFile removes the red lines and keeps the green lines
      await decorator.acceptFile(mockEditor.document.uri);
      assert.ok(!docContent.includes('const x = 1;'), 'accepted file must not have old code');
      assert.ok(docContent.includes('const x = 100;'), 'accepted file must keep new code');

      // Crucial test: Re-opening or focusing the editor after keeping must NOT re-show decorations or CodeLenses
      await decorator.updateEditor(mockEditor);
      const addedAfterKeep = appliedDecorations.get(decorator.addedLineType);
      const removedAfterKeep = appliedDecorations.get(decorator.removedLineType);
      assert.deepEqual(addedAfterKeep, [], 'must not show green decorations after keeping');
      assert.deepEqual(removedAfterKeep, [], 'must not show red decorations after keeping');
      const lensesAfterKeep = provider.provideCodeLenses(mockEditor.document);
      assert.deepEqual(lensesAfterKeep, [], 'must not show CodeLens keep/undo options after keeping');

      // Test clear() removes decorations
      decorator.clear();
      const clearedAdded = appliedDecorations.get(decorator.addedLineType);
      const clearedRemoved = appliedDecorations.get(decorator.removedLineType);
      assert.deepEqual(clearedAdded, []);
      assert.deepEqual(clearedRemoved, []);

      decorator.dispose();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
