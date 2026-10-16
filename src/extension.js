"use strict";

const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const { ProcessManager } = require("./process/processManager");
const { OpenCodeAdapter } = require("./adapters/openCodeAdapter");
const { CliAdapterError, ERRORS } = require("./adapters/cliAdapter");
const { ModelCatalog } = require("./discovery/modelCatalog");
const { SessionManager } = require("./sessions/sessionManager");
const { newId } = require("./sessions/sessionManager");
const { LiveRun } = require("./chat/liveRun");
const { editBranch, conversationContext } = require("./chat/messageEditing");
const { ChatHistory } = require("./sessions/chatHistory");
const { PatchManager } = require("./patches/patchManager");
const { ApprovalManager } = require("./security/approvalManager");
const { InlineDiffDecorator } = require("./patches/inlineDiffDecorator");
const { createLogger } = require("./utils/logging");
const { captureSelection, buildPrompt } = require("./chat/contextBuilder");
const { showAllDiffs, showDiffForFile, getPatchText } = require("./patches/diffProvider");
const { applyPendingPatch } = require("./patches/applyPatch");
const { rollbackTouchedFiles } = require("./patches/rollbackManager");
const { isInsideWorkspace } = require("./patches/patchValidator");
const { ChatPanelProvider, phaseLabelFor } = require("./views/chatPanel");
const {
  getCurrentDateTime,
  extractSearchQuery,
  shouldSearch,
  searchWikipedia,
  formatReferencesForPrompt,
} = require("./chat/webSearch");
const {
  isQuestionTool,
  normalizeQuestions,
  extractQuestionsFromToolDetail,
  formatQuestionAnswers,
} = require("./chat/questions");

function getCfg(key, fallback) {
  try {
    return vscode.workspace.getConfiguration("freecli").get(key, fallback);
  } catch (e) {
    return fallback;
  }
}

function workspaceRoot() {
  try {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].uri.fsPath : null;
  } catch (e) {
    return null;
  }
}

function workspaceLabel() {
  try {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].name : null;
  } catch (e) {
    return null;
  }
}

/** Minimal cancellation-token shim understood by the OpenCode adapter. */
function createStopToken() {
  const listeners = new Set();
  const token = {
    isCancellationRequested: false,
    onCancellationRequested(cb) {
      listeners.add(cb);
      return {
        dispose() {
          listeners.delete(cb);
        },
      };
    },
  };
  return {
    token,
    cancel() {
      token.isCancellationRequested = true;
      for (const cb of [...listeners]) {
        try {
          cb();
        } catch (e) {
          // ignore
        }
      }
    },
  };
}

function modelDisplayName(id) {
  if (!id) {
    return "";
  }
  let s = String(id);
  const slash = s.indexOf("/");
  if (slash >= 0) {
    s = s.slice(slash + 1);
  }
  return s.replace(/[-:](?:contributor-)?free$/i, "");
}

function friendlyError(err) {
  if (err instanceof CliAdapterError) {
    if (err.code === ERRORS.CANCELLED) {
      return "Cancelled.";
    }
    return err.message;
  }
  return (err && err.message) || String(err);
}

async function activate(context) {
  const outputChannel = vscode.window.createOutputChannel("CodeOpen Chat");
  const debugEnabled = () => {
    try {
      return !!vscode.workspace
        .getConfiguration("freecli")
        .get("debugLogging", false);
    } catch (e) {
      return false;
    }
  };
  const logger = createLogger(outputChannel, debugEnabled);
  logger.info("CodeOpen Chat activating");

  const processManager = new ProcessManager(logger);
  const adapters = {
    opencode: new OpenCodeAdapter({ logger, processManager }),
  };
  const activeAdapter = () => adapters.opencode;
  const catalog = new ModelCatalog({
    cacheDurationSec: getCfg("modelCatalogCacheDuration", 3600),
  });
  const sessions = new SessionManager({
    memento: context.globalState,
    persist: getCfg("preserveSessions", true),
  });
  await sessions.load();
  const patchManager = new PatchManager({ logger });
  const inlineDiffDecorator = new InlineDiffDecorator({
    vscode,
    workspaceRoot,
    patchManager,
    logger,
  });
  context.subscriptions.push(inlineDiffDecorator);
  const approval = new ApprovalManager({
    requireApproval: getCfg("requirePatchApproval", true),
    patchMode: getCfg("patchMode", "reviewBeforeApply"),
  });

  const history = new ChatHistory({
    storage: context.globalState,
    persist: getCfg("preserveSessions", true),
  });
  await history.load();

  const state = {
    cli: "opencode",
    detections: null, // { opencode } latest detection snapshot
    model: null,
    detection: null,
    messages: [],
    todos: [],
    questions: [],
    busy: false,
    liveRun: null,
    stop: null,
    convId: null,
    view: "chat", // 'chat' | 'history'
  };
  const requestQueue = [];
  try {
    state.model =
      context.globalState.get("freecli.selectedModel", null) || null;
  } catch (e) {
    state.model = null;
  }
  // Reasoning level (opencode model variant, e.g. low/medium/high/max).
  // Variants differ per model and always come from `opencode models
  // --verbose` — never hardcoded. Remembered per model id.
  state.variant = null;
  state.variantByModel = {};
  try {
    const saved =
      context.globalState.get("freecli.variantByModel", null) || null;
    if (saved && typeof saved === "object") {
      state.variantByModel = saved;
    }
    if (state.model && state.variantByModel[state.model]) {
      state.variant = state.variantByModel[state.model];
    }
  } catch (e) {
    // ignore restore failures
  }
  // Chat mode: 'build' implements changes; 'plan' proposes a plan only;
  // 'ask' answers questions with no file changes.
  function normalizeMode(m) {
    return m === "plan" ? "plan" : m === "ask" ? "ask" : "build";
  }
  try {
    state.mode = normalizeMode(context.globalState.get("freecli.mode", "build"));
  } catch (e) {
    state.mode = "build";
  }
  // Restore the active local conversation, if any.
  try {
    const active = sessions.getActive();
    if (active) {
      state.convId = active.id;
      const rec = history.get(active.id);
      if (rec && rec.messages) {
        state.messages = rec.messages;
      }
      if (!state.model && rec && rec.model) {
        state.model = rec.model;
      }
    }
  } catch (e) {
    // ignore restore failures
  }

  let panel = null;
  const post = (message) => {
    if (state.liveRun) state.liveRun.accept(message);
    try {
      if (panel) {
        panel.post(message);
      }
    } catch (e) {
      // ignore
    }
  };
  const postHistory = () => {
    for (const message of state.messages) {
      if (!message.id) message.id = newId('msg');
    }
    post({ type: "history", messages: state.messages, liveRun: state.liveRun?.snapshot() || null });
    // Persist local-only conversation history (fire-and-forget).
    if (state.convId) {
      const meta = sessions.get(state.convId) || {};
      history
        .persist(
          state.convId,
          {
            model: state.model,
            workspace: meta.workspace,
            cliSessionId: meta.cliSessionId,
          },
          state.messages,
        )
        .catch(() => {});
    }
  };

  const resolveCurrentPatch = (outcome, targetFile, targetPatchId) => {
    const pending = patchManager.getPending();
    const pid = targetPatchId || (pending && pending.patchId) || null;
    if (pid) {
      inlineDiffDecorator.resolvedPatches.add(pid);
      for (const m of state.messages) {
        if (m && m.role === "patch" && (!pid || m.patchId === pid)) {
          m.outcome = outcome;
        }
      }
      postHistory();
      post({
        type: "patchResolved",
        outcome,
        patchId: pid,
      });
    } else {
      for (const m of state.messages) {
        if (m && m.role === "patch" && (!m.outcome || m.outcome === "unresolved")) {
          m.outcome = outcome;
        }
      }
      postHistory();
      post({
        type: "patchResolved",
        outcome,
      });
    }
    if (targetFile) {
      inlineDiffDecorator.resolvedFiles.add(targetFile);
    }
    patchManager.clearPending();
    inlineDiffDecorator.clear();
  };

  inlineDiffDecorator.onResolve = resolveCurrentPatch;
  inlineDiffDecorator.isBusy = () => state.busy;

  const snapDetection = (d) =>
    d
      ? { exists: d.exists, canStart: d.canStart, version: d.version }
      : null;
  const postState = () => {
    const cached = catalog.getCached(state.cli);
    post({
      type: "state",
      cli: "opencode",
      model: state.model,
      variant: state.variant,
      mode: state.mode,
      busy: state.busy,
      request: state.request || null,
      liveRun: state.liveRun?.snapshot() || null,
      detection: snapDetection(state.detections && state.detections.opencode),
      workspace: workspaceLabel(),
      models: cached
        ? cached.models.map((m) => ({ id: m.id, displayName: m.displayName, variants: m.variants || [], reasoning: !!m.reasoning }))
        : undefined,
      todos: state.todos || [],
      questions: state.questions || [],
      settings: {
        patchMode: getCfg("patchMode", "reviewBeforeApply"),
        requestTimeoutSec: getCfg("requestTimeoutSec", 300),
        firstByteNoticeSec: getCfg("firstByteNoticeSec", 30),
        showToolActivity: getCfg("showToolActivity", true) !== false,
        maxContextCharacters: getCfg("maxContextCharacters", 8000),
      },
    });
  };
  const pushMessage = (msg) => {
    if (!msg.id) msg.id = newId('msg');
    if (msg.role !== 'user') {
      msg.dismissible = true;
    }
    state.messages.push(msg);
    postHistory();
  };
  const modelDisplayName = (id) => {
    try {
      const cached = catalog.getCached(state.cli);
      const found = cached && (cached.models || []).find((m) => m.id === id);
      const name = (found && found.displayName) || id || "";
      let s = String(name);
      const slash = s.indexOf("/");
      if (slash >= 0) s = s.slice(slash + 1);
      return s.replace(/[-:](?:contributor-)?free$/i, "");
    } catch (e) {
      return String(id || "");
    }
  };
  // Debug log: always written to the CodeOpen output channel, and mirrored
  // into the panel's collapsible Debug log so users can see what is happening.
  const dlog = (line, data) => {
    const text = `[${new Date().toISOString().slice(11, 19)}] ${line}`;
    try {
      logger.info(text, data);
    } catch (e) {
      // ignore
    }
    post({ type: "log", line: text });
  };

  let detectionTask = null;
  function runDetection(showMessages) {
    if (!detectionTask) detectionTask = detectNow(showMessages).finally(() => { detectionTask = null; });
    return detectionTask;
  }
  async function detectNow(showMessages) {
    const ocPath = getCfg("opencodePath", "") || "";
    const opencode = await adapters.opencode
      .detectInstallation(ocPath)
      .catch((e) => ({
        cli: "opencode",
        exists: false,
        canStart: false,
        error: String((e && e.message) || e),
      }));
    const detections = { opencode };
    state.detections = detections;
    state.detection = opencode;
    const active = opencode;
    logger.info("CLI detection complete", {
      opencode: { exists: opencode.exists, version: opencode.version, compatible: opencode.compatible },
    });
    dlog(
      `detect: opencode exists=${!!opencode.exists} canStart=${!!opencode.canStart} compatible=${!!opencode.compatible} version=${opencode.version || "n/a"} exe=${opencode.exe || "n/a"}`,
    );
    if (
      showMessages &&
      active &&
      (!active.exists || !active.canStart)
    ) {
      vscode.window.showWarningMessage(
        'CodeOpen: OpenCode CLI was not detected. Run "CodeOpen: Show Diagnostics" for install steps.',
      );
    }
    postState();
    return active;
  }

  async function ensureModels(opts) {
    if (!activeAdapter().exe) return null;
    const force = !!(opts && opts.force);
    try {
      // Only the active CLI's catalog is loaded and posted (verified free
      // models only, per CLI).
      const entry = await catalog.loadModels(state.cli, activeAdapter(), {
        force,
      });
      // Re-validate a restored selection against the fresh catalog (fail closed).
      if (
        state.model &&
        !(entry.models || []).some((m) => m.id === state.model)
      ) {
        logger.warn("Restored model no longer eligible, clearing selection", {
          model: state.model,
        });
        state.model = null;
        try {
          await context.globalState.update("freecli.selectedModel", null);
        } catch (e) {
          // ignore
        }
        pushMessage({
          role: "error",
          text: "The previously selected model is no longer in the verified free catalog. Please pick another free model.",
        });
      }
      post({
        type: "models",
        models: (entry.models || []).map((m) => ({
          id: m.id,
          displayName: m.displayName,
          variants: m.variants || [],
          reasoning: !!m.reasoning,
        })),
      });
      // Re-validate the selected reasoning level against the fresh catalog
      // (fail closed: drop it when the model no longer offers that variant).
      if (state.model && state.variant) {
        const current = (entry.models || []).find((m) => m.id === state.model);
        if (!current || !(current.variants || []).includes(state.variant)) {
          state.variant = null;
          if (state.model && state.variantByModel) {
            delete state.variantByModel[state.model];
            try {
              await context.globalState.update(
                "freecli.variantByModel",
                state.variantByModel,
              );
            } catch (e) {
              // ignore
            }
          }
        }
      }
      postState();
      dlog(
        `models: ${(entry.models || []).length} verified-free eligible, ${entry.excludedCount || 0} excluded (source=${entry.source})`,
      );
      return entry;
    } catch (err) {
      logger.error("model catalog load failed", {
        message: (err && err.message) || err,
      });
      pushMessage({
        role: "error",
        text: `Could not load the model catalog: ${(err && err.message) || err}`,
      });
      return null;
    }
  }

  async function selectModelFlow(preselectedId) {
    if (state.busy) return null;
    const entry =
      catalog.getCached(state.cli) &&
      catalog.isFresh(catalog.getCached(state.cli))
        ? catalog.getCached(state.cli)
        : await ensureModels({});
    const models = (entry && entry.models) || [];
    if (models.length === 0) {
      vscode.window.showWarningMessage(
        'No verified free OpenCode models available. Paid/unknown-cost models are excluded. Check auth (opencode providers login) and retry.',
      );
      return null;
    }
    let id = preselectedId || null;
    if (!id) {
      const pick = await vscode.window.showQuickPick(
        models.map((m) => ({
          label: m.displayName,
          description: m.id,
          detail: `Access: Verified free · Source: ${m.pricingSource}`,
          id: m.id,
        })),
        {
          placeHolder: `Select verified free model (${models.length} eligible, ${entry.excludedCount || 0} excluded)`,
        },
      );
      if (!pick) {
        return null;
      }
      id = pick.id;
    }
    try {
      await activeAdapter().validateFreeModel(
        id,
        models.find((m) => m.id === id),
      );
    } catch (e) {
      const msg = `Model ${id} was not accepted by the CLI: ${(e && e.message) || e}`;
      pushMessage({ role: "error", text: msg });
      return null;
    }
    const changed = state.model !== id;
    state.model = id;
    try {
      await context.globalState.update("freecli.selectedModel", id);
    } catch (e) {
      // ignore
    }
    // Restore this model's remembered reasoning level when it is still
    // offered by the catalog; otherwise fall back to the model default.
    const picked = models.find((m) => m.id === id);
    const savedVariant =
      (state.variantByModel && state.variantByModel[id]) || null;
    if (
      savedVariant &&
      picked &&
      (picked.variants || []).includes(savedVariant)
    ) {
      state.variant = savedVariant;
    } else {
      state.variant = null;
      if (state.variantByModel && state.variantByModel[id]) {
        delete state.variantByModel[id];
        try {
          await context.globalState.update(
            "freecli.variantByModel",
            state.variantByModel,
          );
        } catch (e) {
          // ignore
        }
      }
    }
    // New model => new conversation boundary (never silently drop history).
    const active = sessions.getActive();
    if (changed && (!active || active.model !== id)) {
      sessions.createSession(state.cli, id, workspaceRoot());
    }
    postState();
    return id;
  }

  async function selectVariantFlow(variant) {
    if (state.busy) return null;
    // Clearing back to the model default is always allowed.
    if (variant === null || variant === undefined || variant === "") {
      state.variant = null;
      if (state.model && state.variantByModel) {
        delete state.variantByModel[state.model];
        try {
          await context.globalState.update(
            "freecli.variantByModel",
            state.variantByModel,
          );
        } catch (e) {
          // ignore
        }
      }
      postState();
      return null;
    }
    if (!state.model) {
      pushMessage({
        role: "error",
        text: "Pick a model first, then choose its reasoning level.",
      });
      return null;
    }
    const entry = catalog.getCached(state.cli);
    const found = entry && (entry.models || []).find((m) => m.id === state.model);
    if (!found) {
      pushMessage({
        role: "error",
        text: "Model catalog is missing or expired. Refresh before choosing a reasoning level.",
      });
      return null;
    }
    // Fail closed: only exact variant names from the CLI catalog are accepted.
    if (!(found.variants || []).includes(variant)) {
      pushMessage({
        role: "error",
        text: `Reasoning level "${variant}" is not offered by ${state.model}. Choose one of: ${(found.variants || []).join(", ") || "none"}.`,
      });
      return null;
    }
    state.variant = variant;
    if (!state.variantByModel || typeof state.variantByModel !== "object") {
      state.variantByModel = {};
    }
    state.variantByModel[state.model] = variant;
    try {
      await context.globalState.update(
        "freecli.variantByModel",
        state.variantByModel,
      );
    } catch (e) {
      // ignore
    }
    postState();
    return variant;
  }

  // Re-resolve pinned file:line coordinates to real code.
  function resolvePinnedCode(pinned, root) {
    try {
      if (!isInsideWorkspace(root, pinned.file)) return null;
      const editors = (vscode.window.visibleTextEditors || []).concat(
        vscode.window.activeTextEditor ? [vscode.window.activeTextEditor] : [],
      );
      for (const ed of editors) {
        if (!ed || !ed.document) {
          continue;
        }
        let rel = null;
        try {
          const path = require("path");
          rel = path.relative(root, ed.document.fileName);
        } catch (e) {
          continue;
        }
        if (rel === pinned.file) {
          const start = Math.max(0, (pinned.startLine || 1) - 1);
          const end = Math.max(start + 1, pinned.endLine || start + 1);
          const Range = vscode.Range;
          const lastLine = Math.min(ed.document.lineCount - 1, end - 1);
          const range = new Range(start, 0, lastLine, ed.document.lineAt(lastLine).text.length);
          const code = ed.document.getText(range);
          const cap = captureSelection(vscode, root);
          return {
            hasSelection: true,
            filePath: pinned.file,
            name: pinned.name,
            absolutePath: ed.document.fileName,
            language: ed.document.languageId,
            startLine: pinned.startLine,
            endLine: pinned.endLine,
            startCol: 0,
            endCol: 0,
            selectedCode: code,
            documentVersion: ed.document.version,
            contentHash: cap && cap.contentHash,
          };
        }
      }
      // Fall back to disk (may be stale if the editor has unsaved changes).
      const fs = require("fs");
      const path = require("path");
      const abs = path.resolve(root, pinned.file);
      if (!isInsideWorkspace(root, abs)) {
        return null;
      }
      const text = fs.readFileSync(abs, "utf8").split("\n");
      const start = Math.max(0, (pinned.startLine || 1) - 1);
      const end = Math.max(
        start + 1,
        Math.min(text.length, pinned.endLine || start + 1),
      );
      return {
        hasSelection: true,
        filePath: pinned.file,
        name: pinned.name,
        absolutePath: abs,
        language: path.extname(abs).slice(1) || "text",
        startLine: pinned.startLine,
        endLine: pinned.endLine,
        startCol: 0,
        endCol: 0,
        selectedCode: text.slice(start, end).join("\n"),
        documentVersion: null,
        contentHash: null,
      };
    } catch (e) {
      logger.warn("pinned resolve failed, using live capture", {
        message: (e && e.message) || e,
      });
      return null;
    }
  }

  // Serialize a captured selection for the panel (basename for display,
  // full relative path kept for the prompt and tooltips).
  function selectionContext(sel) {
    if (!sel || !sel.hasSelection) {
      return null;
    }
    const lang =
      sel.language || (sel.filePath && sel.filePath.split(".").pop()) || "";
    return {
      file: sel.filePath,
      name: sel.name,
      lang,
      startLine: sel.startLine,
      endLine: sel.endLine,
    };
  }

  async function handleSend(text, pinnedCtx, attachedRelPaths, editMessageId, requestId, queuedUserMessageId, allowQueue) {
    const content = String(text || '').trim();
    if (!content) {
      post({ type: 'sendSettled', requestId, accepted: false });
      return;
    }

    if (state.busy) {
      if (!allowQueue) {
        post({ type: 'sendSettled', requestId, accepted: false });
        return;
      }
      const root = workspaceRoot();
      let sel = editMessageId ? { hasSelection: false } : captureSelection(vscode, root);
      const pinned = pinnedCtx && pinnedCtx.file && pinnedCtx.startLine ? pinnedCtx : null;
      if (pinned && root) {
        const resolved = resolvePinnedCode(pinned, root);
        if (resolved) sel = resolved;
      }
      const userContext = selectionContext(sel);
      const userFiles = (Array.isArray(attachedRelPaths) ? attachedRelPaths : [])
        .filter((rel) => typeof rel === 'string' && root && isInsideWorkspace(root, rel))
        .map((rel) => ({
          path: rel,
          name: path.basename(rel),
          lang: (path.extname(rel).slice(1) || '').toLowerCase(),
        }));
      const userMessageId = newId('msg');
      state.messages.push({
        id: userMessageId,
        role: 'user',
        text: content,
        at: Date.now(),
        context: userContext,
        files: userFiles,
        queued: true,
        dismissible: true,
      });
      requestQueue.push({
        text: content,
        pinnedCtx,
        attachedRelPaths,
        editMessageId,
        requestId,
        userMessageId,
      });
      postHistory();
      postState();
      post({ type: 'sendAccepted', requestId });
      dlog(`send queued: "${content.slice(0, 50)}…" (queue length: ${requestQueue.length})`);
      return;
    }

    // Reserve the run before the first await: double Enter cannot start two
    // processes, and moving/disposing the webview never owns cancellation.
    state.busy = true;
    inlineDiffDecorator.resetResolved();
    state.stop = createStopToken();
    state.liveRun = new LiveRun();
    const request = { requestId, accepted: false };
    state.request = request;
    postState();
    try {
      await executeSend(text, pinnedCtx, attachedRelPaths, editMessageId, request, queuedUserMessageId);
    } catch (err) {
      state.liveRun = null;
      pushMessage({ role: 'error', code: err.code, text: friendlyError(err) });
    } finally {
      state.busy = false;
      state.stop = null;
      state.liveRun = null;
      post({ type: 'sendSettled', requestId, accepted: request.accepted });
      postState();
      processNextInQueue();
    }
  }

  async function processNextInQueue() {
    if (state.busy || requestQueue.length === 0) {
      return;
    }
    const next = requestQueue.shift();
    if (!next) return;
    dlog(`processing queued request: "${next.text.slice(0, 50)}…" (${requestQueue.length} remaining)`);
    const foundMsg = state.messages.find((m) => m.id === next.userMessageId);
    if (foundMsg) {
      delete foundMsg.queued;
      postHistory();
    }
    await handleSend(next.text, next.pinnedCtx, next.attachedRelPaths, next.editMessageId, next.requestId, next.userMessageId, true);
  }

  async function executeSend(text, pinnedCtx, attachedRelPaths, editMessageId, request, queuedUserMessageId) {
    const content = String(text || "").trim();
    if (!content) {
      return;
    }
    const root = workspaceRoot();
    if (!root) {
      pushMessage({
        role: "error",
        text: "Open a workspace folder first — OpenCode must run inside your project (--dir).",
      });
      return;
    }
    const cliAdapter = activeAdapter();
    if (!cliAdapter.exe) {
      pushMessage({
        role: "error",
        text: "OpenCode CLI is not detected. Install it (https://opencode.ai/docs), then use Retry Detection from the title bar.",
      });
      return;
    }
    if (!state.model) {
      pushMessage({
        role: "error",
        text: "No model selected. Pick a model from the model picker above first.",
      });
      post({ type: "models", models: [] });
      await ensureModels({});
      return;
    }
    const check = catalog.validateSelection(state.cli, state.model);
    if (!check.ok) {
      pushMessage({
        role: "error",
        text: `${check.message} Pick another verified free model.`,
      });
      return;
    }
    try {
      await cliAdapter.validateFreeModel(state.model, check.model);
    } catch (e) {
      pushMessage({ role: "error", text: friendlyError(e) });
      return;
    }
    if (state.stop.token.isCancellationRequested) return;

    const priorMessages = editMessageId ? editBranch(state.messages, editMessageId) : null;
    if (priorMessages) {
      // Archive the original; a fresh CLI session cannot see superseded turns.
      postHistory();
      sessions.createSession(state.cli, state.model, root);
      state.messages = priorMessages.map((m) => ({ ...m }));
      state.todos = [];
      patchManager.clearPending();
    }

    let conv = sessions.getActive();
    if (!conv || conv.cli !== state.cli || conv.model !== state.model) {
      conv = sessions.createSession(state.cli, state.model, root);
    }
    const convId = conv.id;
    state.convId = convId;
    sessions.update(convId, { status: "running" });

    // Pinned context from the panel wins; otherwise capture live selection.
    // A pinned entry carries coordinates only, so re-resolve the actual code:
    // prefer the open editor for that file (fresh, incl. unsaved edits),
    // then the file on disk, then fall back to the live capture.
    let sel = editMessageId ? { hasSelection: false } : captureSelection(vscode, root);
    const pinned =
      pinnedCtx && pinnedCtx.file && pinnedCtx.startLine ? pinnedCtx : null;
    if (pinned) {
      const resolved = resolvePinnedCode(pinned, root);
      if (resolved) {
        sel = resolved;
      }
    }
    // Attached files (picked via the + button): read from disk with a
    // per-file and total budget, workspace-relative paths only.
    const attachedFiles = [];
    const maxContext = getCfg("maxContextCharacters", 8000);
    const attachBudget = Math.max(4000, maxContext * 2);
    let attachUsed = 0;
    const attachList = Array.isArray(attachedRelPaths) ? attachedRelPaths : [];
    for (const rel of attachList.slice(0, 10)) {
      if (typeof rel !== "string" || !isInsideWorkspace(root, rel)) {
        continue;
      }
      try {
        const abs = path.resolve(root, rel);
        const st = fs.statSync(abs);
        if (
          !st.isFile() ||
          st.size > 200 * 1024 ||
          attachUsed >= attachBudget
        ) {
          continue;
        }
        const content = fs.readFileSync(abs, "utf8");
        attachUsed += content.length;
        attachedFiles.push({ path: rel, content });
      } catch (e) {
        dlog(`attach read failed: ${rel}: ${(e && e.message) || e}`);
      }
    }
    const userContext = selectionContext(sel);
    const userFiles = attachedFiles.map((f) => ({
      path: f.path,
      name: path.basename(f.path),
      lang: (path.extname(f.path).slice(1) || "").toLowerCase(),
    }));

    let webReferences = '';
    let searchResults = [];
    const webSearchEnabled = getCfg("webSearchEnabled", true) !== false;
    if (webSearchEnabled && shouldSearch(content, sel && sel.hasSelection, state.mode)) {
      const searchQuery = extractSearchQuery(content) || content;
      dlog(`webSearch: searching Wikipedia for "${searchQuery}"`);
      post({
        type: "toolEvent",
        tool: "websearch",
        phase: "start",
        title: `Searching Wikipedia: "${searchQuery}"`,
        input: searchQuery,
      });
      try {
        searchResults = await searchWikipedia(searchQuery, 3, 7000);
        if (searchResults.length > 0) {
          webReferences = formatReferencesForPrompt(searchResults);
        }
        post({
          type: "toolEvent",
          tool: "websearch",
          phase: "completed",
          title: `Searching Wikipedia: "${searchQuery}"`,
          input: searchQuery,
          output: searchResults.length > 0
            ? `Found ${searchResults.length} Wikipedia references:\n` + searchResults.map((r, i) => `[${i + 1}] ${r.title}: ${r.url}`).join('\n')
            : `No Wikipedia references found for "${searchQuery}".`,
        });
      } catch (e) {
        dlog(`webSearch error: ${(e && e.message) || e}`);
      }
    }

    const prompt = (priorMessages ? conversationContext(priorMessages) : '') + buildPrompt(content, sel, {
      workspace: root,
      maxContextCharacters: maxContext,
      includeSurroundingCode: getCfg("includeSurroundingCode", true),
      attachedFiles,
      mode: state.mode,
      webReferences,
    });
    if (!queuedUserMessageId) {
      pushMessage({
        role: "user",
        text: content,
        at: Date.now(),
        context: userContext,
        files: userFiles,
      });
    } else {
      const existing = state.messages.find((m) => m.id === queuedUserMessageId);
      if (existing) {
        delete existing.queued;
        existing.at = Date.now();
      }
      postHistory();
    }
    request.accepted = true;
    await context.workspaceState?.update('freecli.draft', null);
    post({ type: 'sendAccepted', requestId: request.requestId });
    if (queuedUserMessageId) {
      post({ type: 'assistantStart', liveRun: state.liveRun?.snapshot() || null });
    }

    let snapshot = null;
    try {
      snapshot = await patchManager.snapshot(root);
    } catch (e) {
      logger.warn("snapshot failed", { message: (e && e.message) || e });
    }
    if (
      (getCfg("patchMode", "reviewBeforeApply") || "reviewBeforeApply") ===
      "directEdit"
    ) {
      pushMessage({
        role: "activity",
        text: "directEdit mode: the CLI may edit files before review. Diffs are shown after, with undo where possible.",
      });
    }

    const stopper = state.stop;
    if (stopper.token.isCancellationRequested) {
      sessions.update(convId, { status: 'idle' });
      state.liveRun = null;
      pushMessage({ role: 'activity', text: 'Stopped before starting OpenCode.' });
      return;
    }
    postState();
    dlog(
      `send: model=${state.model} variant=${state.variant || "default"} mode=${state.mode} cliSession=${conv.cliSessionId || "new"} promptChars=${prompt.length} attached=${attachedFiles.length} context=${sel && sel.hasSelection ? `${sel.filePath}:${sel.startLine}-${sel.endLine}` : "none"}`,
    );

    const showToolActivity = getCfg("showToolActivity", true) !== false;
    // First-byte watchdog: the CLI can sit silent for minutes when the model
    // backend is degraded (see https://status.opencode.ai). Say so instead of
    // leaving only a spinner. Tracks real CLI stdout (evt.raw), not the
    // synthetic start event the adapter emits before spawning.
    const firstByteNoticeSec = getCfg("firstByteNoticeSec", 30);
    let firstOutputSeen = false;
    let firstByteTimer = null;
    if (firstByteNoticeSec > 0) {
      firstByteTimer = setTimeout(() => {
        if (!firstOutputSeen) {
          dlog(
            `no CLI output after ${firstByteNoticeSec}s — backend may be queued/degraded`,
          );
          post({
            type: "activity",
            text: `Still waiting for the first response after ${firstByteNoticeSec}s — the free model backend may be queued. You can Stop and retry, or wait.`,
          });
        }
      }, firstByteNoticeSec * 1000);
      if (firstByteTimer.unref) {
        firstByteTimer.unref();
      }
    }
    let thoughtText = "";
    let runStartedAt = Date.now();
    let answerFirstAt = null;
    const thoughtTools = [];
    // Ordered markers: reasoning text chunks interleaved with tool calls, so
    // restored history shows thought → tool → thought like the live stream.
    const thoughtOrder = [];
    if (searchResults.length > 0) {
      const q = extractSearchQuery(content) || content;
      const wsRec = {
        key: 'websearch@0',
        tool: 'websearch',
        phase: 'completed',
        title: `Searching Wikipedia: "${q}"`,
        input: q,
        output: searchResults.map((r, i) => `[${i + 1}] ${r.title} (${r.url}):\n${r.extract || ''}`).join('\n\n'),
        exit: 0,
      };
      thoughtTools.push(wsRec);
      thoughtOrder.push({ type: 'tool', callID: 'websearch@0', tool: 'websearch', phase: 'completed', title: wsRec.title, input: q, output: wsRec.output, exit: 0 });
    }
    let currentStreamAnswerText = "";
    const upsertTool = (detail, phase) => {
      const key =
        (detail && detail.callID) || `${detail.tool}@${thoughtTools.length}`;
      let rec = thoughtTools.find((t) => t.key === key);
      if (!rec) {
        rec = {
          key,
          tool: detail.tool,
          phase,
          title: detail.title,
          input: detail.input,
          output: "",
          exit: null,
        };
        thoughtTools.push(rec);
      }
      rec.phase = phase;
      if (detail.title) {
        rec.title = detail.title;
      }
      if (detail.input) {
        rec.input = detail.input;
      }
      if (detail.output) {
        rec.output = detail.output;
      }
      if (detail.exit !== null && detail.exit !== undefined) {
        rec.exit = detail.exit;
      }
      if (detail.todos) {
        rec.todos = detail.todos;
      }
      if (detail.questions) {
        rec.questions = detail.questions;
      }
      if (detail.filePath) {
        rec.filePath = detail.filePath;
      }
      if (detail.rawInput) {
        rec.rawInput = detail.rawInput;
      }
      return rec;
    };
    const onEvent = (evt) => {
      if (!evt) {
        return;
      }
      if (evt.raw && timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = setTimeout(onTimeout, timeoutSec * 1000);
        timeoutTimer.unref?.();
      }
      if (evt.sessionID && evt.sessionID !== conv.cliSessionId) {
        sessions.update(convId, { cliSessionId: evt.sessionID });
      }
      if (!firstOutputSeen && evt.raw) {
        firstOutputSeen = true;
        if (firstByteTimer) {
          clearTimeout(firstByteTimer);
          firstByteTimer = null;
        }
      }
      if (evt.kind === "assistant_message_delta" && evt.text) {
        if (answerFirstAt === null) {
          answerFirstAt = Date.now();
        }
        currentStreamAnswerText += evt.text;
        post({ type: "delta", text: evt.text });
      } else if (evt.kind === "thinking_delta" && evt.text) {
        thoughtText += evt.text;
        const lastMarker = thoughtOrder[thoughtOrder.length - 1];
        if (lastMarker && lastMarker.type === "text") {
          lastMarker.text += evt.text;
        } else {
          thoughtOrder.push({ type: "text", text: evt.text });
        }
        post({ type: "thinking", text: evt.text });
      } else if (
        (evt.kind === "tool_started" || evt.kind === "tool_completed") &&
        showToolActivity
      ) {
        if (currentStreamAnswerText) {
          thoughtText += currentStreamAnswerText;
          const lastMarker = thoughtOrder[thoughtOrder.length - 1];
          if (lastMarker && lastMarker.type === "text") {
            lastMarker.text += currentStreamAnswerText;
          } else {
            thoughtOrder.push({ type: "text", text: currentStreamAnswerText });
          }
          post({ type: "demoteToThinking", text: currentStreamAnswerText });
          currentStreamAnswerText = "";
        }
        const rec = upsertTool(
          evt.detail || { tool: evt.tool },
          evt.kind === "tool_completed" ? "done" : "start",
        );
        if (!thoughtOrder.some((m) => m.type === "tool" && m.key === rec.key)) {
          thoughtOrder.push({ type: "tool", key: rec.key });
        }
        if (rec.tool === "todowrite") {
          let list = (evt.detail && evt.detail.todos) || (evt.detail && evt.detail.rawInput && evt.detail.rawInput.todos) || rec.todos;
          if (!list && typeof rec.input === "string") {
            try {
              const p = JSON.parse(rec.input);
              list = p.todos || p;
            } catch (e) {}
          }
          if (Array.isArray(list)) {
            const normalized = list.map((item, idx) => {
              if (typeof item === "string") {
                return { id: `todo_${idx}`, text: item, status: "pending", done: false, inProgress: false };
              }
              const text = item.content || item.task || item.text || item.title || `Task ${idx + 1}`;
              const status = item.status || (item.completed ? "completed" : "pending");
              const done = status === "completed" || status === "done" || !!item.completed;
              const inProgress = status === "in_progress" || status === "running" || status === "active";
              return { id: item.id || `todo_${idx}`, text, status, done, inProgress };
            });
            state.todos = normalized;
            post({ type: "todos", todos: normalized });
          }
        }
        if (isQuestionTool(rec.tool) || isQuestionTool(evt.tool)) {
          const detail = evt.detail || rec;
          let qlist = extractQuestionsFromToolDetail(detail);
          if (!qlist && detail && detail.questions) {
            qlist = normalizeQuestions(detail.questions);
          }
          if (qlist && qlist.length) {
            state.questions = qlist.map((q, idx) => ({
              id: `q_${Date.now().toString(36)}_${idx}`,
              header: q.header,
              question: q.question,
              options: q.options,
              multiple: !!q.multiple,
              custom: q.custom !== false,
            }));
            post({ type: "questions", questions: state.questions });
            dlog(`questions: received ${state.questions.length} plan question(s)`);
          }
        }
        post({
          type: "toolEvent",
          callID: rec.key,
          label: phaseLabelFor(rec.tool, rec.input),
          tool: rec.tool,
          phase: rec.phase,
          title: rec.title,
          input: rec.input,
          filePath: rec.filePath,
          output: rec.output,
          exit: rec.exit,
          todos: rec.todos,
          questions: rec.questions,
        });
        if (evt.kind === "tool_completed") {
          const tl = String(rec.tool || "").toLowerCase();
          if (tl === "edit" || tl === "write" || tl === "patch" || tl === "applypatch") {
            inlineDiffDecorator.updateAll();
          }
        }
      } else if (evt.kind === "error") {
        dlog(`cli error event: ${evt.message || "unknown"}`);
        // The adapter rejects once with this error, even on exit code 0.
      }
    };

    // Safety net for silent stalls (e.g. a queued model backend emitting no
    // NDJSON for minutes): stop the run and say so instead of spinning forever.
    const timeoutSec = getCfg("requestTimeoutSec", 300);
    let timedOut = false;
    let timeoutTimer = null;
    const onTimeout = () => {
      timedOut = true;
      stopper.cancel();
    };
    if (timeoutSec > 0) {
      timeoutTimer = setTimeout(onTimeout, timeoutSec * 1000);
      if (timeoutTimer.unref) {
        timeoutTimer.unref();
      }
    }

    try {
      const res = await cliAdapter.sendMessage(
        {
          message: prompt,
          model: state.model,
          variant: state.variant,
          sessionID: conv.cliSessionId || null,
          dir: root,
        },
        onEvent,
        stopper.token,
      );
      if (res.sessionID && res.sessionID !== conv.cliSessionId) {
        sessions.update(convId, {
          cliSessionId: res.sessionID,
          title: content.slice(0, 80),
        });
      }
      sessions.update(convId, { status: "idle" });
      dlog(
        `done: session=${res.sessionID || "n/a"} answerChars=${(res.text || "").length} thinkingChars=${thoughtText.length} tools=${thoughtTools.length} cost=${res.cost !== null && res.cost !== undefined ? res.cost : "n/a"}`,
      );
      // Interleaved reasoning text and tool steps, in stream order.
      const buildTimeline = () =>
        thoughtOrder.map((m) => {
          if (m.type === "text") {
            return { type: "text", text: m.text };
          }
          const r = thoughtTools.find((t) => t.key === m.key) || {};
          return {
            type: "tool",
            tool: r.tool,
            phase: r.phase,
            title: r.title,
            input: r.input,
            filePath: r.filePath,
            output: r.output,
            exit: r.exit,
          };
        });
      const thought =
        thoughtText || thoughtTools.length > 0
          ? {
              text: thoughtText,
              // How long the model thought before the answer began, for the
              // "Thought for Ns" label when this message is restored later.
              elapsedSec: Math.round(((answerFirstAt ?? Date.now()) - runStartedAt) / 1000),
              tools: thoughtTools.map((t) => ({
                tool: t.tool,
                phase: t.phase,
                title: t.title,
                input: t.input,
                filePath: t.filePath,
                output: t.output,
                exit: t.exit,
              })),
              items: buildTimeline(),
            }
          : null;
      const finalAssistantText = (currentStreamAnswerText || "").trim()
        ? currentStreamAnswerText
        : (res.text || "(no text returned)");
      state.messages.push({
        role: "assistant",
        text: finalAssistantText,
        thought,
        modelName: modelDisplayName(state.model),
        at: Date.now(),
        references: searchResults.length > 0 ? searchResults.map((r) => ({ title: r.title, url: r.url, description: r.description })) : undefined,
      });
      state.liveRun = null;

      let summary = null;
      try {
        summary = await patchManager.diffSummary(root, snapshot);
      } catch (e) {
        logger.warn("diffSummary failed", { message: (e && e.message) || e });
      }
      if (summary && summary.files && summary.files.length > 0) {
        let enriched = summary.files;
        try {
          enriched = await patchManager.fileHunks(root, summary.files, {});
        } catch (e) {
          logger.warn("fileHunks failed", { message: (e && e.message) || e });
        }
        const totalInsertions = enriched.reduce((s, f) => s + (f.insertions || 0), 0) || summary.insertions || 0;
        const totalDeletions = enriched.reduce((s, f) => s + (f.deletions || 0), 0) || summary.deletions || 0;
        const patchId = `patch_${Date.now().toString(36)}${Math.floor(Math.random() * 0xffff).toString(16)}`;
        patchManager.setPending({
          patchId,
          files: summary.files,
          insertions: totalInsertions,
          deletions: totalDeletions,
          conversationId: convId,
          cliSessionId: res.sessionID,
          at: new Date().toISOString(),
          snapshot,
        });
        inlineDiffDecorator.updateAll();
        dlog(
          `patch: ${summary.files.length} files, +${totalInsertions}/-${totalDeletions}${summary.git === false ? " [non-git snapshot]" : ""} — review in the editor diff`,
        );
        state.messages.push({
          role: "patch",
          patchId,
          patch: {
            files: enriched,
            insertions: totalInsertions,
            deletions: totalDeletions,
          },
        });
      }
      postHistory();
    } catch (err) {
      // Keep partial output on Stop/error; it belongs to the host transcript.
      if (currentStreamAnswerText || thoughtText || thoughtTools.length) {
        state.messages.push({
          role: 'assistant',
          text: currentStreamAnswerText,
          thought: {
            text: thoughtText,
            tools: thoughtTools,
            items: state.liveRun?.thought.items || [],
            elapsedSec: Math.round((Date.now() - runStartedAt) / 1000),
          },
          modelName: modelDisplayName(state.model),
          at: Date.now(),
          references: searchResults.length > 0 ? searchResults.map((r) => ({ title: r.title, url: r.url, description: r.description })) : undefined,
        });
      }
      state.liveRun = null;
      sessions.update(convId, { status: "error" });
      if (timedOut) {
        dlog(`run timed out after ${timeoutSec}s with no completion`);
        pushMessage({
          role: "error",
          text: `No activity from OpenCode for ${timeoutSec}s — the run was stopped automatically. Try again, or select another free model. Adjust freecli.requestTimeoutSec to change this; 0 disables the timeout.`,
        });
      } else if (
        err instanceof CliAdapterError &&
        err.code === ERRORS.CANCELLED
      ) {
        dlog("run cancelled by user");
        state.messages.push({ role: "assistant", text: "Cancelled." });
        postHistory();
      } else {
        logger.error("chat request failed", {
          message: (err && err.message) || err,
        });
        dlog(`run failed: ${friendlyError(err)}`);
        pushMessage({
          role: "error",
          code: err.code,
          text: friendlyError(err),
        });
      }
    } finally {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      if (firstByteTimer) {
        clearTimeout(firstByteTimer);
      }
    }
  }

  function handleStop() {
    try {
      if (requestQueue.length > 0) {
        for (const q of requestQueue) {
          const m = state.messages.find((msg) => msg.id === q.userMessageId);
          if (m) delete m.queued;
        }
        requestQueue.length = 0;
        postHistory();
      }
      if (state.stop) {
        dlog("stop requested");
        state.stop.cancel();
      }
    } catch (e) {
      // ignore
    }
  }

  function handleNewSession() {
    if (state.busy) {
      vscode.window.showInformationMessage('Your task is still running. Use Stop before starting another conversation.');
      return false;
    }
    const root = workspaceRoot();
    const s = sessions.createSession(state.cli, state.model, root);
    requestQueue.length = 0;
    state.convId = s.id;
    state.messages = [];
    state.todos = [];
    state.questions = [];
    patchManager.clearPending();
    inlineDiffDecorator.clear();
    post({ type: "todos", todos: [] });
    post({ type: "questions", questions: [] });
    postHistory();
    postState();
    return true;
  }

  function postHistoryList() {
    post({ type: "showHistory", sessions: history.list() });
  }

  async function handleReuseSession(id) {
    if (state.busy) {
      vscode.window.showInformationMessage('Your task is still running. You can browse History; use Stop before switching conversations.');
      return;
    }
    const rec = history.get(id);
    if (!rec) {
      return;
    }
    state.convId = id;
    if (rec.model) {
      state.model = rec.model;
      try {
        await context.globalState.update("freecli.selectedModel", rec.model);
      } catch (e) {
        // ignore
      }
    }
    // Re-attach to the lightweight session registry if present.
    try {
      if (!sessions.get(id)) {
        const s = sessions.createSession(
          state.cli,
          state.model,
          rec.workspace || workspaceRoot(),
        );
        state.convId = s.id;
        await history.persist(
          s.id,
          { model: state.model, workspace: rec.workspace },
          rec.messages,
        );
        await history.remove(id);
      } else {
        sessions.setActive(id);
      }
    } catch (e) {
      // ignore registry errors; messages still load
    }
    state.messages = (history.get(state.convId) || rec).messages || [];
    requestQueue.length = 0;
    state.view = "chat";
    state.todos = [];
    state.questions = [];
    patchManager.clearPending();
    inlineDiffDecorator.clear();
    post({ type: "todos", todos: [] });
    post({ type: "questions", questions: [] });
    post({ type: "chatView" });
    postHistory();
    postState();
    dlog(`reused conversation ${state.convId}`);
  }

  async function handleDeleteSession(id) {
    if (state.busy && state.convId === id) {
      vscode.window.showInformationMessage('Stop the running task before deleting its conversation.');
      return;
    }
    await history.remove(id);
    try {
      sessions.remove(id);
    } catch (e) {
      // ignore
    }
    if (state.convId === id) {
      const s = sessions.createSession(
        state.cli,
        state.model,
        workspaceRoot(),
      );
      state.convId = s.id;
      state.messages = [];
      state.todos = [];
      state.questions = [];
      patchManager.clearPending();
      inlineDiffDecorator.clear();
      post({ type: "todos", todos: [] });
      post({ type: "questions", questions: [] });
      postHistory();
      postState();
    }
    postHistoryList();
    dlog(`deleted conversation ${id}`);
  }

  async function handleDeleteAllSessions() {
    if (state.busy) {
      vscode.window.showInformationMessage('Stop the running task before deleting all conversations.');
      return;
    }
    const all = history.list();
    for (const rec of all) {
      try {
        await history.remove(rec.id);
      } catch (e) {
        // ignore per-record failures
      }
      try {
        sessions.remove(rec.id);
      } catch (e) {
        // ignore registry errors
      }
    }
    // The active conversation is gone: start fresh so chat stays usable.
    if (!sessions.getActive()) {
      const s = sessions.createSession(
        state.cli,
        state.model,
        workspaceRoot(),
      );
      state.convId = s.id;
      state.messages = [];
      state.todos = [];
      state.questions = [];
      patchManager.clearPending();
      inlineDiffDecorator.clear();
      post({ type: "todos", todos: [] });
      post({ type: "questions", questions: [] });
      postHistory();
      postState();
    }
    postHistoryList();
    dlog(`deleted all conversations (${all.length})`);
  }

  async function handleOpenFile(filePathWithCoords) {
    if (!filePathWithCoords) return;
    const root = workspaceRoot();
    let raw = String(filePathWithCoords).trim();
    if (raw.startsWith("file://")) {
      try {
        raw = vscode.Uri.parse(raw).fsPath;
      } catch (e) {
        raw = raw.replace(/^file:\/\//, "");
      }
    }
    let line = -1;
    let col = 0;
    const hashMatch = raw.match(/#L(\d+)(?:C(\d+))?$/i);
    if (hashMatch) {
      line = parseInt(hashMatch[1], 10) - 1;
      if (hashMatch[2]) col = parseInt(hashMatch[2], 10) - 1;
      raw = raw.slice(0, hashMatch.index);
    } else {
      const colonMatch = raw.match(/:(\d+)(?::(\d+))?$/);
      if (colonMatch) {
        line = parseInt(colonMatch[1], 10) - 1;
        if (colonMatch[2]) col = parseInt(colonMatch[2], 10) - 1;
        raw = raw.slice(0, colonMatch.index);
      }
    }
    raw = raw.replace(/^[<"']|[>"']$/g, "").trim();
    if (!raw) return;

    let targetPath = null;
    if (path.isAbsolute(raw)) {
      targetPath = raw;
    } else if (root) {
      const direct = path.resolve(root, raw);
      if (fs.existsSync(direct)) {
        targetPath = direct;
      } else {
        try {
          const base = path.basename(raw);
          const matches = await vscode.workspace.findFiles(`**/${base}`, "**/node_modules/**", 10);
          if (matches && matches.length > 0) {
            const normalized = raw.replace(/\\/g, "/");
            const found = matches.find((m) => m.fsPath.replace(/\\/g, "/").endsWith(normalized)) || matches[0];
            targetPath = found.fsPath;
          } else {
            targetPath = direct;
          }
        } catch (e) {
          targetPath = direct;
        }
      }
    }

    if (targetPath) {
      try {
        const uri = vscode.Uri.file(targetPath);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        if (line >= 0 && line < doc.lineCount) {
          const pos = new vscode.Position(Math.max(0, line), Math.max(0, col));
          editor.selection = new vscode.Selection(pos, pos);
          editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        }
      } catch (e) {
        logger.warn("handleOpenFile failed", { path: targetPath, message: (e && e.message) || e });
        vscode.window.showWarningMessage(`Could not open file: ${path.basename(targetPath)}`);
      }
    }
  }

  async function handleReviewPatch(targetPatchId) {
    const root = workspaceRoot();
    if (!root) {
      vscode.window.showWarningMessage("Open a workspace folder first.");
      return;
    }
    if (targetPatchId) {
      const saved = patchManager.getPatch(targetPatchId);
      const msgRec = state.messages.find((m) => m && m.role === "patch" && m.patchId === targetPatchId);
      const files = (saved && saved.files) || (msgRec && msgRec.patch && msgRec.patch.files) || [];
      if (files.length > 0) {
        const manifest = (saved && saved.snapshot && saved.snapshot.manifest) || (patchManager.lastSnapshot && patchManager.lastSnapshot.manifest);
        await showAllDiffs(vscode, root, { files }, manifest);
        return;
      }
    }
    const snap = patchManager.lastSnapshot || null;
    const manifest = snap && snap.manifest;
    const summary = await patchManager.diffSummary(root, snap);
    if (summary && summary.files && summary.files.length > 0) {
      await showAllDiffs(vscode, root, summary, manifest);
      return;
    }
    const pending = patchManager.getPending();
    if (pending && pending.files && pending.files.length > 0) {
      await showAllDiffs(vscode, root, pending, manifest);
      return;
    }
    const liveFiles = [];
    const checkThought = (thought) => {
      if (!thought || !thought.items) return;
      for (const it of thought.items) {
        if (it.type === "tool") {
          const fp = it.filePath || it.input;
          if (fp && typeof fp === "string" && !liveFiles.some((f) => f.path === fp)) {
            const tl = String(it.tool || "").toLowerCase();
            if (tl === "edit" || tl === "write" || tl === "patch" || tl === "applypatch" || isInsideWorkspace(root, fp)) {
              liveFiles.push({ path: fp, status: "modified" });
            }
          }
        }
      }
    };
    if (state.liveRun) checkThought(state.liveRun.thought);
    for (let i = state.messages.length - 1; i >= 0 && liveFiles.length === 0; i--) {
      const m = state.messages[i];
      if (m && m.thought) checkThought(m.thought);
    }
    if (liveFiles.length > 0) {
      await showAllDiffs(vscode, root, { files: liveFiles }, manifest);
      return;
    }
    vscode.window.showInformationMessage("CodeOpen: no changes to review.");
  }

  async function onPanelMessage(msg) {
    const type = msg && msg.type;
    try {
      if (type === "ready") {
        dlog("panel connected");
        postHistory();
        postState();
        postActiveFile();
        if (state.view === 'history') postHistoryList();
        if (!state.busy) {
          if (!state.detections) await runDetection(false);
          await ensureModels({});
        }
      } else if (type === "send" || type === "queue") {
        await handleSend(msg.text, msg.context, msg.files, msg.editMessageId, msg.requestId, false, type === "queue" || !!msg.queued);
      } else if (type === 'saveDraft') {
        // Workspace-scoped so moving/recreating the view does not lose input.
        await context.workspaceState?.update('freecli.draft', msg.draft || null);
      } else if (type === 'getDraft') {
        post({ type: 'draft', draft: context.workspaceState?.get('freecli.draft', null) || null });
      } else if (type === 'copyText') {
        await vscode.env.clipboard.writeText(String(msg.text || ''));
      } else if (type === "openExternal") {
        const u = String(msg.url || "");
        if (/^https?:\/\//i.test(u)) {
          try {
            void vscode.env.openExternal(vscode.Uri.parse(u));
          } catch (e) {
            logger.warn("openExternal failed", { message: (e && e.message) || e });
          }
        }
      } else if (type === "getSelection") {
      const root = workspaceRoot();
      const ctx = root
        ? selectionContext(captureSelection(vscode, root))
        : null;
      lastSelJson = JSON.stringify(ctx || null);
      post({ type: "selection", context: ctx });
      postActiveFile();
    } else if (type === "stop") {
        handleStop();
      } else if (type === "newSession") {
        handleNewSession();
      } else if (type === "chatView") {
        state.view = "chat";
        postHistory();
        postState();
      } else if (type === "reuseSession") {
        await handleReuseSession(msg.id);
      } else if (type === "toggleTodo") {
        if (state.todos && state.todos[msg.index]) {
          state.todos[msg.index].done = !!msg.done;
          state.todos[msg.index].status = msg.done ? "completed" : "pending";
          state.todos[msg.index].inProgress = false;
          post({ type: "todos", todos: state.todos });
        }
      } else if (type === "answerQuestions") {
        const text = msg.text || formatQuestionAnswers(state.questions, msg.answers);
        state.questions = [];
        post({ type: "questions", questions: [] });
        if (state.busy) {
          handleStop();
          await new Promise((r) => setTimeout(r, 100));
        }
        await handleSend(text);
      } else if (type === "dismissQuestions") {
        state.questions = [];
        post({ type: "questions", questions: [] });
      } else if (type === "deleteMessage") {
        const id = msg && msg.id;
        let idx = -1;
        if (id) {
          idx = state.messages.findIndex((m) => m.id === id);
          const qIdx = requestQueue.findIndex((q) => q.userMessageId === id);
          if (qIdx !== -1) {
            requestQueue.splice(qIdx, 1);
            dlog(`removed queued message from queue: ${id}`);
          }
        }
        if (idx === -1 && typeof msg.index === "number" && msg.index >= 0 && msg.index < state.messages.length) {
          idx = msg.index;
        }
        if (idx !== -1) {
          state.messages.splice(idx, 1);
          postHistory();
        }
      } else if (type === "deleteSession") {
        await handleDeleteSession(msg.id);
      } else if (type === "deleteAllSessions") {
        await handleDeleteAllSessions();
      } else if (type === "requestModels") {
        await ensureModels({});
      } else if (type === "refreshAll") {
        if (state.busy) return;
        dlog("manual refresh requested");
        await runDetection(false);
        await ensureModels({ force: true });
      } else if (type === "showDiagnostics") {
        await showDiagnostics();
      } else if (type === "selectModel") {
        await selectModelFlow(msg.modelId);
      } else if (type === "selectVariant") {
        await selectVariantFlow(msg.variant);
      } else if (type === "openOutput") {
        outputChannel.show(true);
      } else if (type === "attachFiles") {
        // QuickPick workspace files; picked ones become context chips in the
        // panel (contents are read at send time, never stored).
        const root = workspaceRoot();
        if (!root) {
          vscode.window.showInformationMessage(
            "Open a workspace folder first.",
          );
          return;
        }
        try {
          const uris = await vscode.workspace.findFiles(
            "**/*",
            "{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/out/**,**/.venv/**,**/venv/**,**/__pycache__/**}",
            3000,
          );
          const base = path.resolve(root);
          const items = uris
            .map((u) => ({ u, rel: path.relative(base, u.fsPath) }))
            .filter(
              (it) =>
                it.rel &&
                it.rel.startsWith("..") === false &&
                !path.isAbsolute(it.rel),
            )
            .sort((a, b) => a.rel.localeCompare(b.rel))
            .map((it) => ({
              label: path.basename(it.rel),
              description: it.rel,
              rel: it.rel,
            }));
          const picked = await vscode.window.showQuickPick(items, {
            canPickMany: true,
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: "Add files as context (type to filter, pick several)",
          });
          const files = (picked || []).map((p) => ({
            path: p.rel,
            name: path.basename(p.rel),
            lang: (path.extname(p.rel).slice(1) || "").toLowerCase(),
          }));
          post({ type: "filesPicked", files });
        } catch (e) {
          dlog(`attachFiles failed: ${(e && e.message) || e}`);
        }
      } else if (type === "setMode") {
        if (state.busy) return;
        state.mode = normalizeMode(msg.mode);
        try {
          await context.globalState.update("freecli.mode", state.mode);
        } catch (e) {
          // ignore
        }
        dlog(`mode set to ${state.mode}`);
        postState();
      } else if (type === "openSettings") {
        try {
          await vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "freecli",
          );
        } catch (e) {
          vscode.window.showInformationMessage(
            'Open Settings and search for "freecli" to configure the extension.',
          );
        }
      } else if (type === "reviewPatch") {
        await handleReviewPatch(msg.patchId);
      } else if (type === "applyPatch") {
        const pid = (patchManager.getPending() || {}).patchId || null;
        await vscode.commands.executeCommand("freecli.applyPatch");
        // Success confirms application; a cancel/failure leaves pending
        // intact, so the card stays interactive in that case.
        // Stamp the outcome onto the message so a window reload does not
        // bring the Apply/Reject buttons back (postHistory persists it).
        const applyOutcome = patchManager.getPending() ? "unresolved" : "applied";
        if (applyOutcome !== "unresolved" && pid) {
          const found = state.messages.find((m) => m && m.patchId === pid);
          if (found) found.outcome = applyOutcome;
          postHistory();
          inlineDiffDecorator.clear();
        }
        post({
          type: "patchResolved",
          outcome: applyOutcome,
          patchId: pid,
        });
      } else if (type === "rejectPatch") {
        const pid = (patchManager.getPending() || {}).patchId || null;
        await vscode.commands.executeCommand("freecli.rejectPatch");
        const rejectOutcome = patchManager.getPending() ? "unresolved" : "rejected";
        if (rejectOutcome !== "unresolved" && pid) {
          const found = state.messages.find((m) => m && m.patchId === pid);
          if (found) found.outcome = rejectOutcome;
          postHistory();
          inlineDiffDecorator.clear();
        }
        post({
          type: "patchResolved",
          outcome: rejectOutcome,
          patchId: pid,
        });
      } else if (type === "openFile") {
        await handleOpenFile(msg.file);
      } else if (type === "openFileReview") {
        // Clicking a file row in the patch card opens its native diff.
        const root = workspaceRoot();
        if (root && msg.path) {
          let fileRec = null;
          let manifest = null;
          if (msg.patchId) {
            const saved = patchManager.getPatch(msg.patchId);
            const msgRec = state.messages.find((m) => m && m.role === "patch" && m.patchId === msg.patchId);
            const files = (saved && saved.files) || (msgRec && msgRec.patch && msgRec.patch.files) || [];
            fileRec = files.find((f) => (f.path || f) === msg.path);
            manifest = (saved && saved.snapshot && saved.snapshot.manifest) || (patchManager.lastSnapshot && patchManager.lastSnapshot.manifest);
          }
          if (!fileRec) {
            fileRec = ((patchManager.getPending() || {}).files || []).find(
              (f) => (f.path || f) === msg.path,
            );
          }
          if (!fileRec) {
            const summary = await patchManager.diffSummary(root, patchManager.lastSnapshot || null);
            fileRec = ((summary && summary.files) || []).find(
              (f) => f.path === msg.path,
            );
          }
          if (!manifest) {
            manifest = patchManager.lastSnapshot && patchManager.lastSnapshot.manifest;
          }
          if (!fileRec) {
            fileRec = { path: msg.path, status: "modified" };
          }
          const rec =
            typeof fileRec === "string"
              ? { path: fileRec, status: "modified" }
              : fileRec;
          await showDiffForFile(
            vscode,
            root,
            rec,
            manifest,
            `Review ${rec.status === "added" ? "A" : rec.status === "deleted" ? "D" : "M"}: ${msg.path}`,
          );
        }
      }
    } catch (e) {
      logger.error("panel message failed", { message: (e && e.message) || e });
    }
  }

  async function showDiagnostics() {
    if (!state.detections) {
      await runDetection(false);
    }
    outputChannel.clear();
    outputChannel.appendLine("=== CodeOpen Chat diagnostics ===");
    outputChannel.appendLine(`Time: ${new Date().toISOString()}`);
    try {
      outputChannel.appendLine(`VS Code: ${vscode.version}`);
    } catch (e) {
      // ignore
    }
    outputChannel.appendLine(`Active CLI: ${state.cli}`);
    outputChannel.appendLine(`Model: ${state.model || "(none)"}`);
    outputChannel.appendLine("");
    outputChannel.appendLine("--- OpenCode ---");
    outputChannel.appendLine(
      JSON.stringify(state.detections ? state.detections.opencode : null, null, 2),
    );
    outputChannel.appendLine("");
    outputChannel.appendLine("--- Catalog cache ---");
    const c = catalog.getCached("opencode");
    outputChannel.appendLine(
      `opencode: ${c ? `${(c.models || []).length} eligible, source=${c.source}, retrieved=${c.retrievedAt}, status=${c.refreshStatus}` : "(empty)"}`,
    );
    outputChannel.appendLine("");
    outputChannel.appendLine("--- Changes (edited files only) ---");
    try {
      const root = workspaceRoot();
      if (!root) {
        outputChannel.appendLine("No workspace open.");
      } else {
        const summary = await patchManager.diffSummary(root, null);
        const files = (summary && summary.files) || [];
        if (files.length === 0) {
          outputChannel.appendLine("No edited files.");
        } else {
          outputChannel.appendLine(
            `${files.length} file(s), +${summary.insertions || 0}/-${summary.deletions || 0}${summary.git === false ? " [non-git snapshot]" : ""}`,
          );
          for (const f of files.slice(0, 20)) {
            const flag =
              f.status === "added" ? "A" : f.status === "deleted" ? "D" : "M";
            outputChannel.appendLine(
              `${flag} ${f.path}${f.insertions || f.deletions ? ` (+${f.insertions || 0}/-${f.deletions || 0})` : ""}`,
            );
          }
          const manifest =
            patchManager.lastSnapshot && patchManager.lastSnapshot.manifest;
          const patch = await getPatchText(root, files, manifest, {});
          if (patch) {
            outputChannel.appendLine("");
            outputChannel.appendLine(patch);
          }
        }
      }
    } catch (e) {
      outputChannel.appendLine(`Changes unavailable: ${(e && e.message) || e}`);
    }
    outputChannel.appendLine("");
    outputChannel.appendLine("Known limitations:");
    outputChannel.appendLine(
      "- Transport is `run --format json` one-shot per message (no persistent serve/ACP in v1).",
    );
    outputChannel.appendLine(
      "- Only verified $0/$0 models appear; paid/unknown/stale entries are excluded (fail closed).",
    );
    outputChannel.show(true);
  }

  // Live selection updates: show the selected file + lines in the input
  // panel while the user selects code, before anything is sent.
  let lastSelJson = null;
  const postSelection = () => {
    const root = workspaceRoot();
    if (!root) {
      return;
    }
    const ctx = selectionContext(captureSelection(vscode, root));
    const json = JSON.stringify(ctx || null);
    if (json === lastSelJson) {
      return;
    }
    lastSelJson = json;
    post({ type: "selection", context: ctx });
  };

  function activeEditorContext() {
    const root = workspaceRoot();
    if (!root) {
      return null;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.document || !editor.document.fileName) {
      return null;
    }
    const abs = editor.document.fileName;
    if (!isInsideWorkspace(root, abs)) {
      return null;
    }
    const rel = path.relative(path.resolve(root), abs);
    return {
      path: rel,
      name: path.basename(rel),
      lang: (editor.document.languageId || path.extname(rel).slice(1) || "").toLowerCase(),
    };
  }
  let lastActiveFileJson = null;
  const postActiveFile = () => {
    const file = activeEditorContext();
    const json = JSON.stringify(file || null);
    if (json === lastActiveFileJson) {
      return;
    }
    lastActiveFileJson = json;
    post({ type: "activeFile", file });
  };

  let selDebounce = null;
  const queueSelectionPost = () => {
    if (selDebounce) {
      clearTimeout(selDebounce);
    }
    selDebounce = setTimeout(() => {
      selDebounce = null;
      postSelection();
      postActiveFile();
    }, 150);
    if (selDebounce.unref) {
      selDebounce.unref();
    }
  };

  const provider = new ChatPanelProvider(vscode, {
    onMessage: onPanelMessage,
    onVisible: () => {
      postHistory();
      if (state.view === "history") {
        postHistoryList();
      }
      postState();
      postActiveFile();
    },
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("freecli.main", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );
  panel = provider;

  // Keep the input panel's context chip in sync with the live editor
  // selection (cursor moves, range selects, editor switches).
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(queueSelectionPost),
  );
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(queueSelectionPost),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("freecli.showHistory", async () => {
      state.view = "history";
      try {
        await vscode.commands.executeCommand(
          "workbench.view.extension.freecli",
        );
      } catch (e) {
        // container may already be visible
      }
      postHistoryList();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("freecli.selectModel", () =>
      selectModelFlow(null),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("freecli.newSession", () => {
      if (handleNewSession()) vscode.window.showInformationMessage(
        `CodeOpen: new conversation started${state.model ? ` (${state.model})` : ""}.`,
      );
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("freecli.retryDetection", async () => {
      if (state.busy) return;
      await runDetection(true);
      await ensureModels({ force: true });
      const det = state.detections || {};
      const fmt = (d) => (d && d.exists ? d.version || "found" : "missing");
      vscode.window.showInformationMessage(
        `CodeOpen detection: OpenCode ${fmt(det.opencode)}`,
      );
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("freecli.showDiagnostics", showDiagnostics),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("freecli.reviewPatch", async (targetPatchId) => {
      await handleReviewPatch(targetPatchId);
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("freecli.applyPatch", async () => {
      const root = workspaceRoot();
      if (!root) {
        return;
      }
      const pending = patchManager.getPending() || {
        files: (await patchManager.diffSummary(root, patchManager.lastSnapshot || null)).files,
      };
      if (!pending.files || pending.files.length === 0) {
        vscode.window.showInformationMessage("CodeOpen: nothing to apply.");
        return;
      }
      approval.patchMode = getCfg("patchMode", "reviewBeforeApply");
      approval.requireApproval = getCfg("requirePatchApproval", true);
      const summary = {
        files: pending.files,
        insertions: pending.insertions || 0,
        deletions: pending.deletions || 0,
      };
      const ok = await approval.confirmApply(vscode, summary);
      if (!ok) {
        vscode.window.showInformationMessage(
          "CodeOpen: apply cancelled. Use Review first.",
        );
        return;
      }
      await inlineDiffDecorator.acceptAll();
      const res = await (async () => {
        const crypto = require("crypto");
        const currentState = new Map();
        for (const f of pending.files) {
          try {
            const rel = f.path;
            if (!rel) {
              continue;
            }
            const abs = path.resolve(root, rel);
            if (!abs.startsWith(path.resolve(root))) {
              continue;
            }
            const content = fs.readFileSync(abs, "utf8");
            currentState.set(rel, {
              hash: crypto.createHash("sha1").update(content, "utf8").digest("hex"),
              exists: true,
            });
          } catch (e) {
            // Missing/unreadable: leave absent so the validator can flag
            // a truly-missing modified file instead of silently passing.
          }
        }
        return applyPendingPatch(pending, currentState, root, {
          requireApproval: true,
          approved: true,
        });
      })();
      if (res.applied) {
        resolveCurrentPatch("applied");
        vscode.window.showInformationMessage(
          "CodeOpen: changes validated and kept. Review the final diff in Source Control.",
        );
      } else {
        vscode.window.showErrorMessage(
          `CodeOpen: cannot apply: ${(res.issues || []).join("; ")}`,
        );
      }
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("freecli.rejectPatch", async () => {
      const root = workspaceRoot();
      if (!root) {
        return;
      }
      const pending = patchManager.getPending();
      const snap = patchManager.lastSnapshot || null;
      const summary = await patchManager.diffSummary(root, snap);
      const files = (pending && pending.files) || summary.files || [];
      if (files.length === 0) {
        vscode.window.showInformationMessage("CodeOpen: nothing to reject.");
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Discard ${files.length} changed file(s) and restore pre-run state?`,
        { modal: true },
        "Discard changes",
        "Cancel",
      );
      if (confirm !== "Discard changes") {
        return;
      }
      await inlineDiffDecorator.revertAll();
      // Unborn HEAD (fresh `git init`, no commits): `git checkout HEAD`
      // always fails, so restore from the pre-run content snapshot instead.
      const isGit = await patchManager.isGitRepo(root);
      const hasHead = !!(snap && snap.head);
      const res = isGit && (hasHead || !snap)
        ? await rollbackTouchedFiles(root, files, {}, logger)
        : await patchManager.rollbackSnapshot(root);
      if (res.errors.length === 0) {
        resolveCurrentPatch("rejected");
        vscode.window.showInformationMessage(
          `CodeOpen: restored ${res.restored.length} file(s).`,
        );
      } else {
        vscode.window.showErrorMessage(
          "CodeOpen: rollback had errors; see CodeOpen output. Files may need manual review.",
        );
        logger.error("rollback errors", res.errors);
        outputChannel.show(true);
      }
    }),
  );

  if (getCfg("autoDetectInstallation", true)) {
    runDetection(false)
      .then(() => ensureModels({}))
      .catch((e) =>
        logger.warn("autoDetect failed", { message: (e && e.message) || e }),
      );
  }

  logger.info("CodeOpen Chat activated");
}

function deactivate() {
  // Short-lived per-run processes only; nothing persistent to kill.
}

module.exports = {
  activate,
  deactivate,
};
