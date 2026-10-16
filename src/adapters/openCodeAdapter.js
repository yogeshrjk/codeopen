'use strict';

const { CliAdapter, CliAdapterError, ERRORS } = require('./cliAdapter');
const { detectOne } = require('../discovery/cliDetector');
const { CancellationManager } = require('../process/cancellationManager');
const { isQuestionTool } = require('../chat/questions');

/**
 * OpenCode adapter — primary transport is `opencode run --format json`.
 * Verified against opencode 1.18.18:
 *   run [message..] --model provider/model --session <id> --continue
 *     --format json --dir <workspace> [--file ...]
 * NDJSON stdout events observed:
 *   {"type":"step_start", sessionID, ...}
 *   {"type":"text", sessionID, part:{type:"text", text:"..."}}
 *   {"type":"tool_use", ...} / {"type":"tool_result", ...} (when tools run)
 *   {"type":"step_finish", sessionID, part:{...tokens, cost}}
 * Never assumes one data chunk == one JSON record: buffers lines and
 * tolerates partial/malformed records.
 */

const NORMALIZED = {
  MSG_START: 'assistant_message_start',
  MSG_DELTA: 'assistant_message_delta',
  MSG_DONE: 'assistant_message_complete',
  // Model thinking blocks (`reasoning` NDJSON events, enabled via --thinking).
  THINKING: 'thinking_delta',
  TOOL_STARTED: 'tool_started',
  TOOL_DONE: 'tool_completed',
  WARN: 'warning',
  ERROR: 'error',
  SESSION_DONE: 'session_completed',
};
const { classifyProviderError } = require('./providerError');

/**
 * Summarize a tool part into a small display record.
 * Verified shape: part:{type:'tool', tool:'bash', callID,
 *   state:{status, input:{...}, output, metadata:{...}, title, time}}.
 */
function summarizeTool(raw) {
  const part = (raw && raw.part) || {};
  const state = part.state || {};
  const input = state.input && typeof state.input === 'object' ? state.input : {};
  const inputText = input.command || input.pattern || input.filePath || input.path || input.url || JSON.stringify(input).slice(0, 200);
  let output = '';
  if (typeof state.output === 'string') {
    output = state.output;
  } else if (state.metadata && typeof state.metadata.output === 'string') {
    output = state.metadata.output;
  } else if (typeof part.output === 'string') {
    output = part.output;
  } else if (typeof raw.output === 'string') {
    output = raw.output;
  } else if (state.output && typeof state.output === 'object') {
    try { output = JSON.stringify(state.output, null, 2); } catch (e) {}
  }
  const toolName = String(part.tool || part.name || raw.tool || 'tool');
  const todos = Array.isArray(input.todos)
    ? input.todos
    : (Array.isArray(state.todos) ? state.todos : (Array.isArray(raw.todos) ? raw.todos : null));
  // Plan-mode `question` tool: keep the structured questions so the sidebar
  // can render checkbox answers + custom answer + Next (like the todos bar).
  let questions = null;
  try {
    if (isQuestionTool(toolName)) {
      const cand = input.questions !== undefined ? input.questions
        : state.questions !== undefined ? state.questions
        : raw.questions !== undefined ? raw.questions
        : (input && typeof input === 'object' ? input : null);
      if (cand !== undefined && cand !== null) {
        questions = cand;
      } else if (input && typeof input === 'object' && Object.keys(input).length) {
        questions = input;
      }
    }
  } catch (e) {
    questions = null;
  }
  const filePath = (typeof input.filePath === 'string' && input.filePath) ||
    (typeof input.path === 'string' && input.path) ||
    (typeof input.file === 'string' && input.file) ||
    null;
  return {
    tool: toolName,
    callID: part.callID || null,
    status: state.status || null,
    title: state.title || inputText || null,
    input: String(inputText || '').slice(0, 300),
    filePath,
    rawInput: input,
    todos,
    questions,
    output: String(output || '').slice(0, 8000),
    exit: state.metadata && state.metadata.exit !== undefined ? state.metadata.exit : null,
  };
}

function tryParseJsonLine(line) {
  try {
    return { ok: true, value: JSON.parse(line) };
  } catch (e) {
    return { ok: false, error: e };
  }
}

function normalizeEvent(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const type = raw.type;
  if (type === 'step_start') {
    return { kind: NORMALIZED.MSG_START, sessionID: raw.sessionID || null, raw };
  }
  if (type === 'text') {
    const text = raw.part && typeof raw.part.text === 'string' ? raw.part.text : (typeof raw.text === 'string' ? raw.text : '');
    return { kind: NORMALIZED.MSG_DELTA, text, sessionID: raw.sessionID || null, raw };
  }
  if (type === 'reasoning') {
    const text = raw.part && typeof raw.part.text === 'string' ? raw.part.text : (typeof raw.text === 'string' ? raw.text : '');
    if (!text) {
      return null;
    }
    return { kind: NORMALIZED.THINKING, text, sessionID: raw.sessionID || null, raw };
  }
  if (type === 'tool_use' || type === 'tool-start' || type === 'tool_start') {
    const summary = summarizeTool(raw);
    // `run --format json` emits one tool_use per call, usually already completed.
    if (summary.status && summary.status !== 'completed' && summary.status !== 'failed' && summary.status !== 'error') {
      return { kind: NORMALIZED.TOOL_STARTED, tool: summary.tool, detail: summary, sessionID: raw.sessionID || null, raw };
    }
    return { kind: NORMALIZED.TOOL_DONE, tool: summary.tool, detail: summary, sessionID: raw.sessionID || null, raw };
  }
  if (type === 'tool_result' || type === 'tool-finish' || type === 'tool_finish') {
    const summary = summarizeTool(raw);
    return { kind: NORMALIZED.TOOL_DONE, tool: summary.tool, detail: summary, sessionID: raw.sessionID || null, raw };
  }
  if (type === 'step_finish' || type === 'finish' || type === 'done') {
    return { kind: NORMALIZED.MSG_DONE, sessionID: raw.sessionID || null, raw };
  }
  if (type === 'error') {
    return { kind: NORMALIZED.ERROR, ...classifyProviderError(raw), raw };
  }
  // Unknown types are surfaced as warnings, never fabricated into tool activity.
  return { kind: NORMALIZED.WARN, message: `Unrecognized OpenCode event type: ${type}`, raw };
}

class OpenCodeAdapter extends CliAdapter {
  constructor(options) {
    super(options);
    this.cancellation = new CancellationManager(this.processManager, this.logger);
    this.exe = null;
    this.lastSessionID = null;
  }

  get cliName() {
    return 'opencode';
  }

  getCapabilities() {
    return {
      cli: 'opencode',
      interactiveSessions: false,
      modelSelection: true,
      sessionResumption: true,
      structuredOutput: true,
      streamingEvents: true,
      directFileEditing: true,
      cancellation: true,
      approvalControls: false,
      programmaticModelSelect: true,
    };
  }

  async detectInstallation(configuredPath) {
    const detection = await detectOne('opencode', {
      processManager: this.processManager,
      logger: this.logger,
      configuredPath: configuredPath || this.options.exePath || '',
    });
    this.detection = detection;
    this.version = detection.version;
    this.exe = detection.exists && detection.canStart ? detection.exe : null;
    return detection;
  }

  ensureExe() {
    if (!this.exe) {
      throw new CliAdapterError(ERRORS.NOT_INSTALLED, 'OpenCode CLI is not installed or not detected. See installation docs: https://opencode.ai/docs', {
        docs: 'https://opencode.ai/docs',
      });
    }
    return this.exe;
  }

  async listModelsRaw(opts) {
    const exe = this.ensureExe();
    const args = ['models', '--verbose'];
    if (opts && opts.refresh) {
      args.push('--refresh');
    }
    const result = await this.processManager.run(exe, args, {
      timeoutMs: 60000,
      cwd: this.options.cwd,
    });
    if (result.code !== 0) {
      throw new CliAdapterError(ERRORS.PROCESS_FAILED, `opencode models failed (exit ${result.code}): ${(result.stderr || '').slice(0, 500)}`, { result });
    }
    return result;
  }

  /**
   * Verify the CLI accepts provider/model by running models and matching exactly.
   */
  async validateFreeModel(modelId, catalogEntry) {
    if (!modelId || !modelId.includes('/')) {
      throw new CliAdapterError(ERRORS.NOT_ELIGIBLE, `Invalid model reference "${modelId}". Expected provider/model.`, {});
    }
    if (catalogEntry && catalogEntry.id !== modelId) {
      throw new CliAdapterError(ERRORS.NOT_ELIGIBLE, 'Catalog mismatch: selection does not match validated entry.', {});
    }
    // Re-list (cached upstream) and confirm presence; adapter caller enforces eligibility.
    const raw = await this.listModelsRaw({});
    const present = String(raw.stdout || '').split('\n').map((l) => l.trim()).includes(modelId);
    if (!present) {
      // Fallback: check verbose JSON ids.
      const { parseOpenCodeVerbose } = require('../discovery/modelCatalog');
      const parsed = parseOpenCodeVerbose(raw.stdout || '');
      const ids = parsed.map((p) => `${p.providerID}/${p.id}`);
      if (!ids.includes(modelId)) {
        throw new CliAdapterError(ERRORS.NOT_ELIGIBLE, `Model ${modelId} is not in the CLI catalog. It may be unavailable or require auth.`, {});
      }
    }
    return { ok: true, modelId };
  }

  buildRunArgs(params) {
    const args = ['run'];
    if (params.message) {
      args.push(params.message);
    }
    if (params.model) {
      args.push('--model', params.model);
    }
    if (params.variant) {
      args.push('--variant', params.variant);
    }
    if (params.sessionID) {
      args.push('--session', params.sessionID);
    } else if (params.continueLast) {
      args.push('--continue');
    }
    if (params.title) {
      args.push('--title', params.title);
    }
    args.push('--format', 'json');
    // Surface model thinking blocks as `reasoning` NDJSON events.
    args.push('--thinking');
    if (params.dir) {
      args.push('--dir', params.dir);
    }
    if (params.files && params.files.length > 0) {
      for (const f of params.files.slice(0, 10)) {
        args.push('--file', f);
      }
    }
    return args;
  }

  /**
   * Send a message via `opencode run --format json`.
   * Streams normalized events via onEvent; resolves { sessionID, text, cost, tokens }.
   * Supports cancellationToken (VS Code) and abortSignal (tests).
   */
  async sendMessage(params, onEvent, cancellationToken) {
    const exe = this.ensureExe();
    if (!params || !params.message) {
      throw new CliAdapterError(ERRORS.PROCESS_FAILED, 'Empty message.', {});
    }
    if (!params.dir) {
      throw new CliAdapterError(ERRORS.NO_WORKSPACE, `${this.cliName} must run inside the selected workspace (--dir). Open a folder first.`, {});
    }
    const args = this.buildRunArgs(params);
    this.logger.info && this.logger.info('opencode run starting', { model: params.model || '(default)', variant: params.variant || null, hasSession: !!params.sessionID });

    const { child, dispose } = this.processManager.startStreaming(exe, args, { cwd: params.dir });
    let buffer = '';
    let fullText = '';
    let sessionID = params.sessionID || null;
    let cost = null;
    let tokens = null;
    let settled = false;
    let stderrTail = '';
    let providerError = null;

    const unbind = (cancellationToken && typeof cancellationToken.onCancellationRequested === 'function')
      ? this.cancellation.bind(cancellationToken, child)
      : () => {};

    const emit = (evt) => {
      try {
        if (typeof onEvent === 'function') {
          onEvent(evt);
        }
      } catch (e) {
        // never let renderer break the stream
      }
    };

    // Immediate abort support for tests.
    let abortListener = null;
    if (params.abortSignal) {
      if (params.abortSignal.aborted) {
        try {
          child.kill('SIGTERM');
        } catch (e) {}
      } else if (typeof params.abortSignal.addEventListener === 'function') {
        abortListener = () => {
          try {
            child.kill('SIGTERM');
          } catch (e) {}
        };
        params.abortSignal.addEventListener('abort', abortListener, { once: true });
      }
    }

    emit({ kind: NORMALIZED.MSG_START, sessionID, raw: null });

    const result = await new Promise((resolve) => {
      child.stdout.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) {
            continue;
          }
          const parsed = tryParseJsonLine(line);
          if (!parsed.ok) {
            emit({ kind: NORMALIZED.WARN, message: `Skipped malformed JSON record (${String(line).slice(0, 120)})`, raw: null });
            continue;
          }
          const raw = parsed.value;
          if (raw && raw.sessionID && !sessionID) {
            sessionID = raw.sessionID;
          }
          const norm = normalizeEvent(raw);
          if (!norm) {
            continue;
          }
          if (norm.kind === NORMALIZED.ERROR) {
            providerError = norm;
            // A structured error is terminal, even when the CLI forgets to
            // exit or exits with code 0. Keep its message through SIGTERM.
            try { child.kill('SIGTERM'); } catch (_) {}
          }
          if (norm.kind === NORMALIZED.MSG_DELTA && norm.text) {
            fullText += norm.text;
          }
          if (norm.kind === NORMALIZED.MSG_DONE) {
            try {
              const part = raw.part || {};
              if (typeof part.cost !== 'undefined') {
                cost = part.cost;
              }
              if (raw.cost !== undefined) {
                cost = raw.cost;
              }
              if (part.tokens) {
                tokens = part.tokens;
              }
            } catch (e) {}
          }
          emit(norm);
        }
      });
      child.stderr.on('data', (d) => {
        stderrTail = (stderrTail + d.toString('utf8')).slice(-2000);
      });
      child.on('error', (err) => {
        if (!settled) {
          settled = true;
          resolve({ error: err });
        }
      });
      child.on('close', (code, signal) => {
        // Flush trailing partial line.
        if (buffer.trim()) {
          const parsed = tryParseJsonLine(buffer.trim());
          if (parsed.ok) {
            const norm = normalizeEvent(parsed.value);
            if (norm) {
              if (norm.kind === NORMALIZED.ERROR) providerError = norm;
              if (norm.sessionID) sessionID = norm.sessionID;
              if (norm.kind === NORMALIZED.MSG_DELTA && norm.text) {
                fullText += norm.text;
              }
              emit(norm);
            }
          }
          buffer = '';
        }
        if (!settled) {
          settled = true;
          resolve({ code, signal });
        }
      });
    });

    try {
      unbind();
    } catch (e) {}
    try {
      dispose();
    } catch (e) {}
    if (abortListener && params.abortSignal && typeof params.abortSignal.removeEventListener === 'function') {
      try {
        params.abortSignal.removeEventListener('abort', abortListener);
      } catch (e) {}
    }

    if (result && result.error) {
      throw new CliAdapterError(ERRORS.PROCESS_FAILED, `OpenCode process failed to start: ${result.error.message}`, { stderr: stderrTail });
    }
    if (providerError) {
      throw new CliAdapterError(providerError.code, providerError.message, { stderr: stderrTail });
    }
    const code = result ? result.code : 0;
    if (code !== 0) {
      // Cancellation surfaces as SIGTERM (null code) — report distinctly.
      if (result.signal === 'SIGTERM' || result.signal === 'SIGKILL' || (cancellationToken && cancellationToken.isCancellationRequested)) {
        throw new CliAdapterError(ERRORS.CANCELLED, 'Request cancelled.', { signal: result.signal });
      }
      const friendly = classifyProviderError(stderrTail);
      if (friendly.code !== 'E_PROVIDER') {
        throw new CliAdapterError(friendly.code, friendly.message, { code, stderr: stderrTail });
      }
      throw new CliAdapterError(ERRORS.PROCESS_FAILED, `${this.cliName} exited with code ${code}: ${stderrTail.slice(0, 500) || 'see diagnostics'}`, { code, stderr: stderrTail });
    }

    if (sessionID) {
      this.lastSessionID = sessionID;
    }
    emit({ kind: NORMALIZED.SESSION_DONE, sessionID, raw: null });
    return { sessionID, text: fullText, cost, tokens };
  }

  cancelRequest(child) {
    if (!child) {
      return false;
    }
    try {
      child.kill('SIGTERM');
      return true;
    } catch (e) {
      return false;
    }
  }

  async dispose() {
    try {
      this.cancellation.disposeAll();
    } catch (e) {}
  }
}

module.exports = {
  OpenCodeAdapter,
  normalizeEvent,
  NORMALIZED,
  tryParseJsonLine,
};
