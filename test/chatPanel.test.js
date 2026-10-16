'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ChatPanelProvider, getChatHtml, escapeHtml, makeNonce, phaseLabelFor, orderModels, lineRangeChips, fileBadge, isFilePath, isQuestionTool, ICONS } = require('../src/views/chatPanel');

describe('chatPanel.fileBadge', () => {
  it('returns recognizable per-language logos with brand colors', () => {
    assert.match(fileBadge('html'), /E34F26/); // HTML5 shield orange
    assert.match(fileBadge('html'), /<path/);
    assert.match(fileBadge('py'), /3776AB/); // python blue
    assert.match(fileBadge('py'), /FFD43B/); // python yellow
    assert.match(fileBadge('js'), /F7DF1E/); // JS yellow tile
    assert.match(fileBadge('ts'), /3178C6/); // TS blue tile
    assert.match(fileBadge('HTML'), /E34F26/); // case-insensitive
    assert.match(fileBadge('.js'), /F7DF1E/); // leading dot tolerated
    assert.match(fileBadge('python'), /3776AB/); // languageId alias
    assert.match(fileBadge('javascript'), /F7DF1E/); // languageId alias
    assert.match(fileBadge('typescript'), /3178C6/); // languageId alias
    assert.match(fileBadge('markdown'), /24292E/); // languageId alias
    assert.match(fileBadge('unknownext'), /808080/);
    assert.ok(!fileBadge('x<y').includes('<y'), 'label is escaped');
  });

  it('renders distinct logo marks per language with a neutral fallback', () => {
    // Each known language gets its own mark (no two share output)
    assert.notEqual(fileBadge('py'), fileBadge('js'));
    assert.notEqual(fileBadge('html'), fileBadge('css'));
    assert.notEqual(fileBadge('ts'), fileBadge('go'));
    assert.match(fileBadge('css'), /fill="#2965F1"/);
    assert.match(fileBadge('go'), /00ADD8/);
    assert.match(fileBadge('rb'), /CC342D/); // ruby gem
    assert.match(fileBadge('php'), /777BB4/); // php oval
    // Unknown extensions: neutral file outline in gray
    assert.match(fileBadge('weirdext'), /stroke="#808080"/);
    assert.ok(!fileBadge('weirdext').includes('3776AB'), 'no logo colors for unknown type');
    // Inline SVGs stay self-contained (only the xmlns URL may say http)
    const withoutNs = fileBadge('py').split('http://www.w3.org/2000/svg').join('');
    assert.ok(!withoutNs.includes('http'), 'logo is self-contained');
  });
});

describe('chatPanel.orderModels', () => {
  it('puts the selected model first, keeps catalog order otherwise', () => {
    const models = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    assert.deepEqual(orderModels(models, 'b').map((m) => m.id), ['b', 'a', 'c']);
    assert.deepEqual(orderModels(models, null).map((m) => m.id), ['a', 'b', 'c']);
    assert.deepEqual(orderModels(models, 'zzz').map((m) => m.id), ['a', 'b', 'c']);
  });
});

describe('chatPanel.ICONS', () => {
  it('ships well-formed inline Lucide-style SVGs for every UI glyph', () => {
    for (const name of ['plus', 'refresh', 'sliders', 'send', 'stop', 'x', 'check', 'circle', 'copy', 'chev', 'terminal', 'chat', 'file', 'pin', 'undo', 'reuse']) {
      assert.ok(ICONS[name], `icon ${name} exists`);
      assert.match(ICONS[name], /^<svg[^>]*>.*<\/svg>$/);
      const withoutNs = ICONS[name].split('http://www.w3.org/2000/svg').join('');
      assert.ok(!withoutNs.includes('http'), `icon ${name} is self-contained`);
    }
  });

  it('uses icon.png from the assets folder for the logo', () => {
    assert.ok(ICONS.logo, 'logo icon exists');
    assert.match(ICONS.logo, /^<img[^>]+src="data:image\/png;base64,/);
    assert.match(ICONS.logo, /alt="CodeOpen"/);
  });
});

describe('chatPanel.lineRangeChips', () => {
  it('renders Copilot-style L{start}–{end} chips from hunk ranges', () => {
    assert.equal(
      lineRangeChips([{ oldStart: 1, oldCount: 2, newStart: 4, newCount: 3 }]),
      '<span class="pline">L4–6</span>'
    );
    // Single-line hunk: no range
    assert.equal(
      lineRangeChips([{ oldStart: 0, oldCount: 0, newStart: 7, newCount: 1 }]),
      '<span class="pline">L7</span>'
    );
    // Deleted lines fall back to the old side
    assert.equal(
      lineRangeChips([{ oldStart: 10, oldCount: 4, newStart: 0, newCount: 0 }]),
      '<span class="pline">L10–13</span>'
    );
    assert.ok(lineRangeChips(Array(6).fill({ newStart: 1, newCount: 2 })).includes('…'), 'overflow marker beyond 4 chips');
    assert.equal(lineRangeChips([]), '');
    assert.equal(lineRangeChips(null), '');
  });
});

describe('chatPanel.phaseLabelFor', () => {
  it('maps tools to Copilot-style phase labels', () => {
    assert.equal(phaseLabelFor('read'), 'Searching…');
    assert.equal(phaseLabelFor('glob'), 'Searching…');
    assert.equal(phaseLabelFor('grep'), 'Searching…');
    assert.equal(phaseLabelFor('bash'), 'Running command…');
    assert.equal(phaseLabelFor('edit'), 'Editing files…');
    assert.equal(phaseLabelFor('webfetch'), 'Searching the web…');
    assert.equal(phaseLabelFor('websearch'), 'Searching the web…');
    assert.equal(phaseLabelFor('question'), 'Asking questions…');
    assert.equal(phaseLabelFor('questions'), 'Asking questions…');
    assert.equal(phaseLabelFor('ask_question'), 'Asking questions…');
    assert.equal(phaseLabelFor('weirdtool'), 'Running weirdtool…');
    assert.equal(phaseLabelFor(''), 'Working…');
    assert.equal(phaseLabelFor(null), 'Working…');
  });

  it('detects test tools and returns Testing…', () => {
    assert.equal(phaseLabelFor('test'), 'Testing…');
    assert.equal(phaseLabelFor('tests'), 'Testing…');
    assert.equal(phaseLabelFor('vitest'), 'Testing…');
    assert.equal(phaseLabelFor('jest'), 'Testing…');
    assert.equal(phaseLabelFor('pytest'), 'Testing…');
    assert.equal(phaseLabelFor('mocha'), 'Testing…');
    assert.equal(phaseLabelFor('playwright'), 'Testing…');
    assert.equal(phaseLabelFor('cypress'), 'Testing…');
    assert.equal(phaseLabelFor('phpunit'), 'Testing…');
    assert.equal(phaseLabelFor('rspec'), 'Testing…');
    assert.equal(phaseLabelFor('unittest'), 'Testing…');
  });

  it('detects test commands in input', () => {
    assert.equal(phaseLabelFor('bash', 'npm test'), 'Testing…');
    assert.equal(phaseLabelFor('bash', 'yarn test'), 'Testing…');
    assert.equal(phaseLabelFor('bash', 'pnpm test'), 'Testing…');
    assert.equal(phaseLabelFor('bash', 'bun test'), 'Testing…');
    assert.equal(phaseLabelFor('bash', 'npx vitest run'), 'Testing…');
    assert.equal(phaseLabelFor('bash', 'npm run test'), 'Testing…');
    assert.equal(phaseLabelFor('bash', 'go test ./...'), 'Testing…');
    assert.equal(phaseLabelFor('bash', 'cargo test'), 'Testing…');
    assert.equal(phaseLabelFor('bash', 'dotnet test'), 'Testing…');
    assert.equal(phaseLabelFor('bash', 'pytest -x'), 'Testing…');
  });
});

describe('chatPanel.escapeHtml', () => {
  it('escapes markup so AI output cannot break the panel', () => {
    assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.equal(escapeHtml('a & b "c"'), 'a &amp; b &quot;c&quot;');
    assert.equal(escapeHtml(null), '');
  });
});

describe('chatPanel.isQuestionTool', () => {
  it('identifies question tool variants', () => {
    assert.equal(isQuestionTool('question'), true);
    assert.equal(isQuestionTool('questions'), true);
    assert.equal(isQuestionTool('askquestion'), true);
    assert.equal(isQuestionTool('ask_question'), true);
    assert.equal(isQuestionTool('askuserquestion'), true);
    assert.equal(isQuestionTool('ask_user_question'), true);
    assert.equal(isQuestionTool('Question'), true);
    assert.equal(isQuestionTool('bash'), false);
    assert.equal(isQuestionTool(null), false);
  });
});

describe('chatPanel.getChatHtml', () => {
  it('renders a Copilot-style chat layout with no external resources', () => {
    const html = getChatHtml('testnonce123');
    // Options live in the settings panel, not a top header
    assert.ok(!html.includes('chat-header'), 'no top header bar');
    assert.match(html, /id="settingsPanel"/);
    assert.match(html, /id="settingsBtn"/);
    assert.match(html, /id="refreshBtn"/);
    assert.match(html, /id="diagBtn"/);
    assert.match(html, /id="openSettingsBtn"/);
    assert.match(html, /id="settingsList"/);
    assert.ok(!html.includes('＋ New Chat'), 'no text header buttons');
    // No loader spinners: white shining text animation instead
    assert.ok(!html.includes('class="spinner"'), 'no spinner elements');
    assert.ok(!html.includes('@keyframes spin'), 'no spin animation');
    assert.match(html, /animated \? ' shimmer'/);
    // No blue accent colors
    assert.ok(!html.includes('textLink-foreground'), 'no blue link color');
    // Lucide-style inline SVG icons (offline, CSP-safe)
    assert.ok(html.includes('<svg'), 'inline SVG icons present');
    assert.match(html, /id="sendBtn"/);
    // Marketing hint line removed
    assert.ok(!html.includes('only verified $0/$0'), 'hint line removed');
    // Model picker lives in the input footer, menu opens upward from it
    const inputWrapPos = html.indexOf('input-wrap');
    const inputPos = html.indexOf('id="input"');
    const modelBtnPos = html.indexOf('id="modelBtn"');
    const menuPos = html.indexOf('id="modelMenu"');
    const headerEnd = html.indexOf('id="cliGate"');
    assert.ok(modelBtnPos > inputPos, 'model picker must be in the input area');
    assert.ok(menuPos > inputWrapPos && menuPos < inputPos, 'model menu must be anchored to the input area');
    assert.ok(headerEnd >= 0 && modelBtnPos > headerEnd, 'model picker must not be in the header');
    assert.ok(html.includes('.model-picker') && html.includes('justify-content: flex-end'), 'model picker must be right-aligned');
    // No top version/status strip: only a CLI-missing gate notice, no version text
    assert.ok(!html.includes('id="statusStrip"'), 'top status strip removed');
    assert.ok(!html.includes('id="statusText"'), 'status text removed');
    assert.match(html, /id="cliGate"/);
    assert.match(html, /cliReady/);
    assert.ok(!html.includes('OpenCode \''), 'no top version label');
    assert.ok(!html.includes('id="cliBtn"'), 'CLI picker button removed');
    assert.ok(!html.includes('id="cliMenu"'), 'CLI picker menu removed');
    assert.ok(!html.includes('selectCli'), 'selectCli message removed');
    // One-line input tools: plus (attach files) + Ask/Plan/Build mode on the left, model picker on the right (no carets, no Mode heading)
    assert.match(html, /id="attachBtn"/);
    assert.match(html, /attachFiles/);
    assert.match(html, /filesPicked/);
    assert.match(html, /id="modeBtn"/);
    assert.match(html, /class="mode-icon"/);
    assert.match(html, /id="modeMenu"/);
    assert.match(html, /setMode/);
    assert.match(html, /Ask questions/);
    assert.ok(!html.includes('<div class="menu-head">Mode</div>'), 'Mode heading removed');
    assert.match(html, /filesPicked/);
    const attachPos = html.indexOf('id="attachBtn"');
    const modeBtnPos = html.indexOf('id="modeBtn"');
    const modeMenuPos = html.indexOf('id="modeMenu"');
    assert.ok(attachPos > inputPos && attachPos < modeBtnPos, 'plus button must be in the input-area line beside the mode picker');
    assert.ok(modeBtnPos < modelBtnPos, 'mode selector must sit on the left, model picker on the right');
    assert.ok(!html.includes('class="caret"'), 'down-arrow carets removed from pickers');
    assert.ok(modeMenuPos > inputWrapPos && modeMenuPos < inputPos, 'mode menu must be anchored to the input area');
    // Context chips above the input carry the same language icons as bubbles
    assert.match(html, /fileChipHTML/);
    assert.match(html, /files: attachedFiles\.map/);
    // Chat gated until CLI detection succeeds
    assert.match(html, /inputEl\.disabled = !ready/);
    assert.match(html, /sendBtn\.disabled = !ready/);
    assert.match(html, /Waiting for OpenCode CLI/);
    assert.ok(!html.includes('id="elapsed"'), 'elapsed timer removed with status strip');
    // CLI gate notice, message list, input
    assert.match(html, /id="cliGate"/);
    assert.match(html, /id="messages"/);
    assert.match(html, /id="input"/);
    assert.match(html, /id="sendBtn"/);
    // Welcome + suggestions
    assert.match(html, /Ask anything/);
    // Patch card actions wired via postMessage
    assert.match(html, /reviewPatch/);
    assert.match(html, /applyPatch/);
    assert.match(html, /rejectPatch/);
    // Collapsible thought & actions block (HTML-escaped in source)
    assert.match(html, /Thought/);
    assert.match(html, /toolEvent/);
    assert.match(html, /thinking/);
    // History page (icon-only hover actions, delete-all on top) and no settings New Chat
    assert.match(html, /id="historyPage"/);
    assert.match(html, /id="historyList"/);
    assert.match(html, /id="historyBack"/);
    assert.match(html, /id="historyClearAll"/);
    assert.match(html, /reuseSession/);
    assert.match(html, /deleteSession/);
    assert.match(html, /deleteAllSessions/);
    assert.ok(!html.includes('>Reuse<'), 'text Reuse button replaced by icon-only action');
    assert.match(html, /\.hist-card:hover \.hactions/);
    assert.ok(!html.includes('id="newBtn"'), 'no New Chat button in settings');
    // Debug log lives inside the settings panel
    assert.match(html, /id="settingsPanel"/);
    assert.match(html, /id="settingsList"/);
    assert.match(html, /id="debugLines"/);
    assert.match(html, /openSettings/);
    assert.match(html, /openOutput/);
    // Only the lower thought summary carries the animation.
    assert.ok(!html.includes('phase-banner'));
    assert.match(html, /ensureThoughtEl\(\)/);
    assert.match(html, /Searching…/);
    assert.match(html, /Thinking…/);
    // Collapsed thought header shows the live phase (Searching/Editing/…),
    // not a stuck "Thinking…" label
    assert.match(html, /thought\.phase/);
    assert.match(html, /thoughtData\.phase = phaseLabelFor/);
    // Readable model picker: tooltip + current checkmark + no width squeeze
    assert.match(html, /modelBtn\.title/);
    assert.ok(!html.includes('max-width: 60%'), 'picker must use full footer width');
    // Copilot parity: round send button, icon-only copy, attribution,
    // hover-only msg-time line with timestamp + copy (single line)
    assert.match(html, /send-round/);
    assert.match(html, /Copy response/);
    assert.match(html, /msg-time/);
    assert.match(html, /msg-meta/);
    // Undo action removed — the patch card's Reject covers reverting changes
    assert.ok(!html.includes('undoChanges'), 'undo button removed');
    assert.ok(!html.includes('msg-actions'), 'leftover undo actions block removed');
    // Marketing hint line removed from the patch card
    assert.ok(!html.includes('Open Review changes to inspect'), 'hint line removed');
    // Changed files rendered Copilot-style: file logo only (no A/M/D boxes),
    // dimmed dir, name, hover-diff rows with line-range chips and red/green counts
    assert.match(html, /patch-file/);
    assert.ok(!html.includes('pbadge'), 'A/M/D badge boxes removed, logo only');
    assert.match(html, /pfile/);
    assert.match(html, /fileBadge\(ext\)/);
    assert.match(html, /pcount add/);
    assert.match(html, /pcount del/);
    assert.match(html, /lineRangeChips/);
    assert.ok(!html.includes('<ul>'), 'no plain bullet list of files');
    // File rows open the native per-file diff; buttons resolve after apply/reject
    // Apply/Reject only on the latest patch card (older cards keep Review only)
    assert.match(html, /openFileReview/);
    assert.match(html, /patchResolved/);
    assert.match(html, /patch-outcome/);
    assert.match(html, /latestPatchKey/);
    assert.match(html, /isLatestPatch/);
    assert.ok(!html.includes('followup'), 'no follow-up pills after responses');
    // Diffs live in the editor only: no inline hunks
    assert.ok(!html.includes('renderSideDiff'), 'no inline diff renderer');
    assert.ok(!html.includes('table class="sbs"'), 'no side-by-side table');
    assert.ok(!html.includes('fdiff'), 'no inline file-diff blocks');
    // Basename context chips + input-area context bar (pin removed) + todos bar + questions bar
    assert.match(html, /id="ctxBar"/);
    assert.match(html, /id="todosBar"/);
    assert.match(html, /renderTodosBar/);
    assert.match(html, /id="questionsBar"/);
    assert.match(html, /renderQuestionsBar/);
    assert.match(html, /question-check/);
    assert.match(html, /question-custom-input/);
    assert.match(html, /id="questionNextBtn"/);
    assert.match(html, /answerQuestions/);
    assert.match(html, /terminal-box/);
    assert.ok(!html.includes('id="ctxPin"'), 'pin icon removed');
    assert.match(html, /addActiveFileBtn/);
    // User messages docked to the right side only
    assert.match(html, /justify-content: flex-end/);
    // Gray user bubble, transparent thought block
    assert.match(html, /rgba\(127, 127, 127, 0\.16\)/);
    assert.match(html, /details\.thought \{[^}]*background: transparent/);
    // No list header text in the model picker
    assert.ok(!html.includes('Verified free models (OpenCode)'), 'picker header text removed');
    // No per-model suffix; empty-chat welcome stays centered with its line
    assert.ok(!html.includes('· Verified free</small>'), 'per-model suffix removed');
    assert.match(html, /Powered by OpenCode CLI/);
    assert.match(html, /\.welcome \{[^}]*text-align: center/);
    assert.match(html, /\.welcome \{[^}]*margin: auto/, 'welcome centered vertically');
    // CSP with nonce, no remote scripts/styles
    assert.match(html, /nonce="testnonce123"/);
    assert.ok(!html.includes('src="http') && !html.includes('href="http'), 'must not load external resources');
    assert.ok(!html.includes('@import') && !html.includes('url(http'), 'no remote CSS');
    assert.ok(!html.includes('Freebuff'), 'Freebuff CLI not referenced');
    assert.ok(!html.includes('@freecli'), 'must not depend on the Copilot @ participant');
  });
});

describe('chatPanel thinking padding', () => {
  it('keeps left padding identical while streaming and when done', () => {
    const html = getChatHtml('padnonce');
    // Thinking UI is kept in the same line as the response (padding-left: 0).
    assert.match(html, /details\.thought \{[^}]*padding-left: 0/);
    assert.match(html, /details\.thought \.tbody \{[^}]*margin: 4px 0 10px 10px/);
    assert.ok(!html.includes('phase-banner'));
    assert.match(html, /class="tlabel/);
    // Mid-run fallback (history re-rendered mid-run) uses the same padded
    // `.row.assistant` wrapper the completed state uses.
    assert.ok(html.includes("fallback.className = 'row assistant'"), 'fallback keeps row padding');
  });

  it('renders web search references Sources strip when present', () => {
    const html = getChatHtml('refnonce');
    assert.match(html, /msg-references/);
    assert.match(html, /ref-heading/);
    assert.match(html, /ref-link/);
  });

  it('renders close button on pushMessage rows and deletes them', () => {
    const html = getChatHtml('closenonce');
    assert.match(html, /createCloseBtn/);
    assert.match(html, /close-msg/);
    assert.match(html, /type: 'deleteMessage'/);
    assert.match(html, /\.row\.error \.close-msg/);
    assert.match(html, /\.row\.activity \.close-msg/);
  });

  it('renders user bubble actions on hover with copy and icon-only edit button', () => {
    const html = getChatHtml('usernonce');
    assert.match(html, /copy-message/);
    assert.match(html, /edit-message/);
    assert.match(html, /\.user-actions\s*\{[^}]*visibility:\s*hidden/);
    assert.match(html, /\.row\.user:hover \.user-actions/);
    // Edit button must only show the icon (no '<span>Edit</span>' text)
    assert.ok(!html.includes('<span>Edit</span>'), 'edit button must be icon-only');
  });

  it('contains model picker width to grow based on text length', () => {
    const html = getChatHtml('modelnonce');
    assert.match(html, /\.input-tools \.model-picker\s*\{[^}]*flex:\s*0 1 auto/);
    assert.match(html, /\.input-tools \.model-picker\s*\{[^}]*width:\s*auto/);
    assert.ok(!html.includes('.input-tools .model-picker { flex: 1; }'));
  });
});

describe('chatPanel webview script', () => {
  it('emits syntactically valid JavaScript (catches template-escape bugs)', () => {
    const vm = require('node:vm');
    const html = getChatHtml('n');
    const m = html.match(/<script nonce="n">([\s\S]*)<\/script>/);
    assert.ok(m, 'script block present');
    new vm.Script(m[1]); // throws on syntax error
  });

  it('never auto-opens the model picker when models arrive (sidebar open stays shut)', () => {
    const html = getChatHtml('n');
    const m = html.match(/<script nonce="n">([\s\S]*)<\/script>/);
    assert.ok(m, 'script block present');
    const js = m[1];
    const idx = js.indexOf("msg.type === 'models'");
    assert.ok(idx >= 0, 'models handler present');
    // Handler block runs until the next `} else if (` branch.
    const next = js.indexOf('} else if (', idx);
    const block = js.slice(idx, next >= 0 ? next : idx + 600);
    assert.ok(!block.includes("remove('hidden')"), 'models arrival must not force-open the picker');
    assert.ok(block.includes('renderModels()'), 'models arrival still re-renders options');
  });
});

describe('chatPanel.makeNonce', () => {
  it('produces unique nonces', () => {
    assert.notEqual(makeNonce(), makeNonce());
  });
});

describe('ChatPanelProvider', () => {
  function stubView() {
    const posted = [];
    return {
      posted,
      webview: {
        html: '',
        options: {},
        postMessage: async (m) => {
          posted.push(m);
        },
        onDidReceiveMessage: function (cb) {
          this._cb = cb;
        },
      },
      onDidDispose: () => {},
    };
  }

  it('resolves the view with chat html and routes messages', () => {
    const received = [];
    const provider = new ChatPanelProvider({}, {
      onMessage: (msg) => {
        received.push(msg);
      },
    });
    const view = stubView();
    provider.resolveWebviewView(view);
    assert.match(view.webview.html, /id="messages"/);
    assert.equal(view.webview.options.enableScripts, true);
    view.webview._cb({ type: 'send', text: 'hi' });
    assert.deepEqual(received, [{ type: 'send', text: 'hi' }]);
  });

  it('post() is safe without a resolved view', () => {
    const provider = new ChatPanelProvider({}, {});
    provider.post({ type: 'history', messages: [] }); // must not throw
  });

  it('includes dedicated stop button and passes patchId and copyText from the panel', () => {
    const html = getChatHtml('queue-test-nonce');
    assert.match(html, /id="stopBtn"/, 'stop button must exist');
    assert.match(html, /id="sendBtn"/, 'send button must exist');
    assert.match(html, /inputEl\.disabled = !ready/, 'textarea remains enabled during task');
    assert.match(html, /patchId:\s*m\.patchId/, 'patch cards pass patchId to review previous work');
    assert.match(html, /type:\s*'copyText'/, 'copy buttons post copyText message');
    assert.match(html, /queue-badge/, 'queue badge rendered for queued user messages');
    assert.match(html, /Queue message/, 'send button title updates to Queue message when busy');
  });

  it('supports clickable file names and diff buttons during ongoing tasks', () => {
    const html = getChatHtml('file-click-test-nonce');
    assert.match(html, /data-open-file/, 'renders file click attributes');
    assert.match(html, /type:\s*'openFile'/, 'posts openFile message when file name clicked');
    assert.match(html, /data-open-diff/, 'renders diff button attributes on tool steps');
    assert.match(html, /live-diff-btn/, 'renders live diff button when file modifications occur');
    assert.match(html, /btn-diff-chip/, 'styles for diff chip button');
    assert.match(html, /file-code-link/, 'styles for inline code file links');
  });
});

describe('chatPanel.isFilePath', () => {
  it('identifies standard file paths and filenames with extensions', () => {
    assert.equal(isFilePath('package.json'), true);
    assert.equal(isFilePath('src/views/chatPanel.js'), true);
    assert.equal(isFilePath('src/views/chatPanel.js:145'), true);
    assert.equal(isFilePath('src/views/chatPanel.js:145:10'), true);
    assert.equal(isFilePath('test/diffs.test.js#L50'), true);
    assert.equal(isFilePath('./README.md'), true);
    assert.equal(isFilePath('../foo/bar.ts'), true);
    assert.equal(isFilePath('.gitignore'), true);
    assert.equal(isFilePath('Dockerfile'), true);
    assert.equal(isFilePath('Makefile'), true);
    assert.equal(isFilePath('.env'), true);
  });

  it('rejects commands, code snippets, and non-file words', () => {
    assert.equal(isFilePath('npm test'), false);
    assert.equal(isFilePath('node index.js'), false);
    assert.equal(isFilePath('foo()'), false);
    assert.equal(isFilePath('const x = 1;'), false);
    assert.equal(isFilePath('state.busy'), false);
    assert.equal(isFilePath('true'), false);
    assert.equal(isFilePath(''), false);
    assert.equal(isFilePath(null), false);
  });
});
