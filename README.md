# CodeOpen Chat — VS Code Extension

A VS Code extension that adds an **OpenCode CLI** chat panel to the sidebar — no Copilot Chat `@` participant required. Built with JavaScript (CommonJS), styled like the built-in Chat view, with a verified-free-models-only picker.

---

## What's New in v1.1.0

- **Clearer daily limit errors** — separate retry message for temporary rate limits
- **Cross-platform installation screen** — Windows, macOS, Linux; input hidden until CLI detected
- **Persistent tasks** — work continues when sidebar is hidden/moved, with live output restored on return
- **Smart input sizing** — grows up to 220px (or 35% of view height), then scrolls
- **Instant thinking indicator** — animated "Working/Thinking" shows immediately on Send
- **Message editing** — edit below a user message to restore it + attachments; Cancel restores draft; Send creates a new conversation branch while preserving the original in History
- **Draft recovery, double-send prevention, partial-output retention** — plus improved light/dark layouts
- **Adaptive timeout** — resets whenever CLI output arrives

> **Test status:** All 159 automated tests (46 suites) + browser interaction checks passed. Provider quota responses were mocked; this environment did not run an authenticated provider or native VS Code on Windows/macOS.
>
> **Important:** VS Code must remain open for background work. A full window reload/restart does **not** resume a running task.

**Official docs:** [opencode.ai/docs](https://opencode.ai/docs/) | [VS Code WebviewView API](https://code.visualstudio.com/api/references/vscode-api#window.registerWebviewViewProvider)

---

## Quick Start

**Prerequisites:** [Node.js >=18](https://nodejs.org/) and [OpenCode CLI](https://opencode.ai/docs) installed.

1. **Launch the extension** — open this folder in VS Code and press `F5` (Extension Development Host)
2. **Open the chat panel** — click the **CodeOpen Chat** icon in the activity bar
3. **Pick a model** — choose any verified free model from the picker in the input footer
4. **Start chatting** — select code in your editor for context (optional), type a message, press `Enter`

> The extension auto-detects the CLI on activation. If it's not found, set `freecli.opencodePath` or run **CodeOpen: Retry CLI Detection** from the Command Palette.

---

## Features

### Chat Panel (`freecli.main`)

Activity-bar view with header toolbar, status strip, welcome suggestions, message list, and bottom input with Send/Stop — mirrors the Copilot Chat layout.

### CLI Detection

Probes `opencode --version` / `--help` on activation, fixes `PATH` for macOS GUI apps, honors `freecli.opencodePath` setting.

### Verified Free Models Only

Loads `opencode models --verbose` and offers **only** `$0/$0` models (see [Free-Model Policy](#free-model-policy)).

### Streaming Chat

Runs `opencode run --format json --thinking` with live NDJSON streaming:

- **Session resume** via `--session`
- **Model selection** via `--model provider/model`
- **Workspace context** via `--dir <workspace>`
- **Stop** sends `SIGTERM` → `SIGKILL`
- **Reasoning & tool use** render in collapsible "Thought & actions" blocks per response
- **Debug log** (mirrored to CodeOpen output channel) shows detection, catalog, send, and completion diagnostics
- **Live elapsed timer** while busy
- **"Still waiting" notice** after `firstByteNoticeSec` (default 30s)
- **Stalled run timeout** after `requestTimeoutSec` (default 300s, `0` disables) — clear message instead of spinning

> During [OpenCode status incidents](https://status.opencode.ai), free models can queue for minutes — the extension always reports what's happening.

### Editor Context

- **Selection chip** shows `basename:start-end` with file icon (full path in tooltip)
- **Live selection** re-resolves from open editor or disk at send time
- **`+` button** attaches whole files (up to 10, 200 KB each)
- **Plan/Build picker**: propose without editing (`plan`) or implement with review (`build`)
- **Agent task lists** render in a Todos bar above the input

### Rich Answers

Headings, lists, tables, quotes, links (open externally), fenced code blocks with language chip + Copy. Sanitized inline SVG fences render as diagrams; all other HTML escaped.

### Patch Review

Post-run changes appear as a **Changes proposed** card with **Review / Apply / Reject**:

- **Review** opens each file in VS Code's native diff editor (old=left/red, new=right/green, only changed lines highlighted)
- Old side prefers pre-run snapshot → git `HEAD` → staged version (so staged-but-uncommitted files diff correctly), including added/deleted files
- Works in git and non-git workspaces
- **Reject** restores pre-run state
- Each answer shows timestamp + copy action

---

## Requirements

- **VS Code** `^1.90.0`
- **Node.js** `>=18`
- **OpenCode CLI** (verified with `1.18.18`) — install per [opencode.ai/docs](https://opencode.ai/docs)

---

## Installation

### Run from Source (Development)

```bash
git clone <this-repo-url>
cd extension
npm test   # no npm install needed: zero runtime dependencies
# Open folder in VS Code, press F5 (Run Extension Development Host)
```

In the dev host: click **CodeOpen Chat** icon, pick a free model, start chatting. Select code first to target it.

### Package to VSIX

```bash
npm test
npx --yes @vscode/vsce package --no-dependencies
# produces codeopen-1.1.0.vsix (name + version from package.json)
code --install-extension codeopen-1.1.0.vsix   # requires `code` CLI on PATH
```

---

## Usage

1. **Open the sidebar** — click the CodeOpen Chat activity-bar icon
2. **Pick a model** — use the model picker in the input footer (or Command Palette). Gear button → Settings (options, diagnostics, debug log)
3. **Chat** — type a message, press `Enter` (`Shift+Enter` for newline). Select code first to attach as context (`file:start-end` chip). Conversations auto-save to local VS Code storage — use the history icon in the view title bar to reuse/delete sessions
4. **Watch live output** — streamed text appears with tool-activity lines; press **Stop** to cancel. Tool steps include direct **Diff** and file links.
5. **Review changes in the original file** — when files change, opening any changed file displays the changes in an **up-down block diff** directly in the original file:
   - **Old code (top)**: Highlighted with a full-width red background (`rgba(248, 81, 73, 0.22)`), no left border, and no strikethrough.
   - **New code (bottom)**: Displayed directly below the old code with a full-width green background (`rgba(46, 160, 67, 0.18)`) and no left border.
   - **CodeLens actions**: Directly above each changed block, `✓ Keep`, `✗ Undo`, and `⎘ Review Diff` actions allow approving or discarding changes right in the editor.
   - **Patch Card**: The sidebar also offers Review / Keep / Undo controls and per-file diff comparisons.
6. **Diagnostics** — run `CodeOpen: Show Diagnostics` to print versions, catalog cache (`retrievedAt`, `source`, `expiry`, `refreshStatus`), and install hints to the CodeOpen output channel (secrets redacted)

---

## Commands

| Command                   | Title                             |
| ------------------------- | --------------------------------- |
| `freecli.selectModel`     | CodeOpen: Select Free Model       |
| `freecli.newSession`      | CodeOpen: New Conversation        |
| `freecli.showHistory`     | CodeOpen: Conversation History    |
| `freecli.retryDetection`  | CodeOpen: Retry CLI Detection     |
| `freecli.showDiagnostics` | CodeOpen: Show Diagnostics        |
| `freecli.reviewPatch`     | CodeOpen: Review Proposed Changes |
| `freecli.applyPatch`      | CodeOpen: Apply Approved Changes  |
| `freecli.rejectPatch`     | CodeOpen: Reject Proposed Changes |

**Title-bar buttons** (when view == `freecli.main`): New Chat, Retry CLI Detection, Conversation History

---

## Settings (`freecli.*`)

| Setting                     | Default             | Description                                                           |
| --------------------------- | ------------------- | --------------------------------------------------------------------- |
| `opencodePath`              | `""`                | Custom OpenCode executable path; empty = auto-detect via `PATH`       |
| `patchMode`                 | `reviewBeforeApply` | Or `directEdit` (warns; review after)                                 |
| `requirePatchApproval`      | `true`              | Confirm before apply                                                  |
| `autoDetectInstallation`    | `true`              | Detect CLI on activation                                              |
| `modelCatalogCacheDuration` | `3600`              | Model catalog cache lifetime (seconds)                                |
| `requestTimeoutSec`         | `300`               | Stop stalled run after N sec; `0` disables                            |
| `firstByteNoticeSec`        | `30`                | "Still waiting" notice after N sec; `0` disables                      |
| `maxContextCharacters`      | `8000`              | Selection truncation limit                                            |
| `includeSurroundingCode`    | `true`              | Include enclosing function/imports when available                     |
| `showToolActivity`          | `true`              | Show tool progress in chat                                            |
| `preserveSessions`          | `true`              | Save minimal metadata (model, session id, workspace) in `globalState` |
| `debugLogging`              | `false`             | Verbose output channel; never logs secrets                            |

> The free-only policy is **not** user-configurable (cannot relabel paid models as free).

---

## Free-Model Policy

A model is included **only when all** conditions hold:

- `input == 0 && output == 0` (plus zero cache prices)
- Provider is accessible
- No paid auth/subscription required
- Fresh cache

**Excluded (fail closed):** paid, input-free-output-paid, unknown, stale, conflicting, quota-then-charge, and locked entries.

**Verified `1.18.18`:** 49 eligible / 397 excluded on test machine. Re-validated before every session.

**Supported OpenCode capabilities:** detection (`--version`/`--help`), catalog (`models --verbose` + costs), programmatic `--model`, sessions/resume (`--session`/`--continue`), NDJSON streaming, cancellation, patch capture with native diff. `serve` REST and ACP are intentionally unused in v1 (`run --format json` one-shot per message).

---

## Troubleshooting

| Issue                           | Solution                                                                                                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CLI not found**               | Run `CodeOpen: Retry CLI Detection`, then `CodeOpen: Show Diagnostics` for versions, `PATH`, and install hints. Or set `freecli.opencodePath` to the full executable path.                            |
| **No free models listed**       | Check Debug log / output channel for catalog `refreshStatus` and expiry. Stale or conflicting costs are excluded by design — retry after `opencode models --verbose` works.                           |
| **"Still waiting" for minutes** | Free-model queues during OpenCode inference incidents are normal — see [status.opencode.ai](https://status.opencode.ai). Adjust `freecli.firstByteNoticeSec` / `freecli.requestTimeoutSec` as needed. |
| **No patch / can't undo**       | Review lists only files the agent touched on the current run. Reject restores pre-run state in git workspaces (agent-touched files only) and non-git workspaces (snapshot restore).                   |

---

## Known Limitations

- **WebviewView replica** — not the built-in Chat view; cannot reuse Copilot's `@` participants, variables, or `editor:paste` actions. Selection context attaches automatically at send time.
- **One-shot per message** — cold start each turn (`run --format json`); no persistent `serve` connection or ACP session loop.
- **Model switching** starts a new conversation (history is preserved, not silently dropped).
- **"Free" = verified `$0/$0` at catalog time** — quotas/capacity can change; re-validated before every session, fail closed. Zen `-free` models are "free for a limited time" per OpenCode docs, not permanent.
- **Rollback scope** — restores only files the agent touched (`git checkout HEAD -- path`, `git clean` for new files); unrelated files untouched; unsafe paths refused. Non-git workspaces restore file contents from pre-run snapshot.

---

## Tests

```bash
npm test         # node:test — 159 tests, 46 suites, no network/paid API required
npm run lint     # node --check src/extension.js
```

**Coverage:**

- Detection (installed/missing/bad-exit)
- Eligibility (zero-cost in; paid/input-free-output-paid/unknown/stale/subscription/locked/quota out)
- Selection (single/multiline/none/unsaved/languages)
- Patches (valid/traversal/stale/empty/conflict/approval/numstat, staged fallback on unborn HEAD, request-scoped review)
- OpenCode streaming (deltas, split chunks, malformed tolerance, non-zero exit, arg-array safety, workspace gate)
- Sessions (isolation, minimal persistence)
- Chat panel (XSS escaping, layout regions, CSP/offline, provider routing, stable thinking gutter, brand icons)

---

## Security

- **No shell execution** — `spawn(exe, argsArray)` only; user text stays a single argv element
- **Zero external resources** — inline CSS/JS, nonce CSP; all AI text HTML-escaped and rendered by minimal local markdown formatter
- **Workspace-contained patches** — `path.relative` containment, `..` rejection, absolute-escape block; symlinks resolved via `path.resolve`
- **No secrets stored** — `globalState` keeps only model/session-id/workspace; logs redact `*_KEY/SECRET/TOKEN/PASSWORD` and `Bearer` values
- **AI output treated as untrusted** — never executed; tool activity shown only from real CLI events

---

## File Map

```
src/
├── extension.js                    # Entry point
├── views/chatPanel.js              # WebviewView panel
├── chat/
│   ├── contextBuilder.js          # Editor context → prompt
│   ├── liveRun.js                 # Background task runner & streaming state
│   ├── messageEditing.js          # Edit message & conversation branching
│   ├── questions.js               # Tool question detection & parsing
│   └── webSearch.js               # Wikipedia query extraction & citations
├── adapters/
│   ├── cliAdapter.js              # Generic CLI wrapper
│   ├── openCodeAdapter.js         # OpenCode-specific logic & NDJSON streaming
│   └── providerError.js           # Daily limit & quota error classifier
├── discovery/
│   ├── cliDetector.js             # CLI detection & PATH resolution
│   ├── modelCatalog.js            # Model catalog loading/caching
│   └── freeModelPolicy.js         # Free-model eligibility (fail closed)
├── process/
│   ├── processManager.js          # Process lifecycle & stdio handling
│   └── cancellationManager.js     # SIGTERM/SIGKILL handling
├── sessions/
│   ├── sessionManager.js          # Session state & persistence
│   └── chatHistory.js             # Conversation persistence & branching
├── patches/
│   ├── patchManager.js            # Patch orchestration & review
│   ├── diffProvider.js            # Native diff integration
│   ├── inlineDiffDecorator.js     # In-file block diffs & CodeLens
│   ├── patchValidator.js          # Path safety validation & containment
│   ├── applyPatch.js              # Apply changes
│   └── rollbackManager.js         # Reject/restore
├── security/approvalManager.js    # User confirmations
└── utils/
    ├── logging.js                 # Output channel logging & redaction
    └── platform.js                # OS-specific helpers
test/*.test.js                     # 159 tests, 46 suites
```
