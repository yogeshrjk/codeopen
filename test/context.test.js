'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { captureSelection, buildPrompt } = require('../src/chat/contextBuilder');

function fakeVscode({ text, start, end, fileName, language, version, empty } = {}) {
  return {
    window: {
      activeTextEditor: text === null
        ? null
        : {
          document: {
            fileName: fileName || '/ws/accounts/views.py',
            languageId: language || 'python',
            version: version || 12,
            getText: () => text,
          },
          selection: {
            isEmpty: !!empty,
            start: start || { line: 9, character: 0 },
            end: end || { line: 14, character: 5 },
          },
        },
    },
  };
}

describe('captureSelection', () => {
  it('captures single + multiline selection with 1-based lines', () => {
    const ctx = captureSelection(fakeVscode({ text: 'x=1' }), '/ws');
    assert.equal(ctx.hasSelection, true);
    assert.equal(ctx.filePath, 'accounts/views.py');
    assert.equal(ctx.startLine, 10);
    assert.equal(ctx.endLine, 15);
    assert.equal(ctx.language, 'python');
    assert.equal(ctx.documentVersion, 12);
    assert.ok(ctx.contentHash);
    assert.equal(ctx.name, 'views.py');
  });
  it('handles no selection and no editor', () => {
    assert.equal(captureSelection(fakeVscode({ text: 'x', empty: true }), '/ws').hasSelection, false);
    assert.equal(captureSelection(fakeVscode({ text: null }), '/ws').hasSelection, false);
    assert.equal(captureSelection(null, '/ws').hasSelection, false);
  });
  it('handles unsaved/untitled content without crashing', () => {
    const ctx = captureSelection(fakeVscode({ text: 'a', fileName: 'Untitled-1', language: 'plaintext' }), null);
    assert.equal(ctx.hasSelection, true);
  });
  it('supports multiple languages', () => {
    const ctx = captureSelection(fakeVscode({ text: 'const x=1', language: 'javascript', fileName: '/ws/a.js' }), '/ws');
    assert.equal(ctx.language, 'javascript');
  });
});

describe('buildPrompt', () => {
  it('contains target file + 1-based range + selection', () => {
    const p = buildPrompt('Fix error handling', {
      hasSelection: true,
      filePath: 'accounts/views.py',
      language: 'python',
      startLine: 10,
      endLine: 15,
      selectedCode: 'def f(): pass',
    }, { workspace: '/ws', maxContextCharacters: 8000 });
    assert.match(p, /accounts\/views\.py/);
    assert.match(p, /10-15/);
    assert.match(p, /def f/);
    assert.match(p, /primary target/);
  });
  it('works without selection', () => {
    const p = buildPrompt('Hello', { hasSelection: false }, { workspace: '/ws' });
    assert.match(p, /Hello/);
  });
  it('embeds attached files and the mode directive', () => {
    const plan = buildPrompt('Hello', { hasSelection: false }, {
      workspace: '/ws',
      mode: 'plan',
      attachedFiles: [{ path: 'lib/a.js', content: 'var x = 1;' }],
    });
    assert.match(plan, /Attached file \(lib\/a\.js\)/);
    assert.match(plan, /var x = 1;/);
    assert.match(plan, /PLAN MODE/);
    assert.ok(!/BUILD MODE/.test(plan));
    const build = buildPrompt('Hello', { hasSelection: false }, { workspace: '/ws', mode: 'build' });
    assert.match(build, /BUILD MODE/);
    // Ask mode answers only, never edits
    const ask = buildPrompt('Hello', { hasSelection: false }, { workspace: '/ws', mode: 'ask' });
    assert.match(ask, /ASK MODE/);
    assert.ok(!/BUILD MODE/.test(ask));
    assert.ok(!/PLAN MODE/.test(ask));
    // Default is build mode
    assert.match(buildPrompt('Hi', { hasSelection: false }, {}), /BUILD MODE/);
  });
});
