'use strict';

/**
 * Local-only per-conversation message history.
 * Stored exclusively in VS Code extension storage (globalState) on this
 * machine — nothing is ever sent anywhere. Entries are sanitized and
 * capped so storage stays small; bulky re-renderable data (inline diff
 * text) is dropped while file lists and stats are kept.
 */

const MAX_CONVERSATIONS = 20;
const MAX_MESSAGES = 50;
const MAX_TEXT = 4000;
const MAX_THOUGHT_TEXT = 2000;
const MAX_TOOL_OUTPUT = 500;
const MAX_STR = 300;

function clip(s, n) {
  const t = String(s === undefined || s === null ? '' : s);
  return t.length > n ? t.slice(0, n) + '…[truncated]' : t;
}

function sanitizeTool(t) {
  if (!t || typeof t !== 'object') {
    return null;
  }
  return {
    tool: clip(t.tool || 'tool', 60),
    phase: t.phase === 'done' ? 'done' : 'start',
    title: clip(t.title || '', MAX_STR),
    input: clip(t.input || '', MAX_STR),
    output: clip(t.output || '', MAX_TOOL_OUTPUT),
    exit: typeof t.exit === 'number' ? t.exit : null,
  };
}

function sanitizeMessage(m) {
  if (!m || typeof m !== 'object') {
    return null;
  }
  const out = { role: m.role };
  if (m.id) out.id = clip(m.id, 120);
  if (m.code) out.code = clip(m.code, 80);
  if (typeof m.text === 'string') {
    out.text = clip(m.text, m.role === 'user' ? 100000 : MAX_TEXT);
  }
  if (m.at) {
    out.at = m.at;
  }
  if (m.context && typeof m.context === 'object') {
    out.context = {
      file: clip(m.context.file || '', MAX_STR),
      name: clip(m.context.name || '', 120),
      startLine: m.context.startLine,
      endLine: m.context.endLine,
    };
  }
  if (Array.isArray(m.files)) {
    out.files = m.files.slice(0, 10).map((f) => ({ path: clip(f.path, MAX_STR), name: clip(f.name, 120), lang: clip(f.lang, 40) }));
  }
  if (m.thought && typeof m.thought === 'object') {
    out.thought = {
      text: clip(m.thought.text || '', MAX_THOUGHT_TEXT),
      tools: (m.thought.tools || []).slice(0, 30).map(sanitizeTool).filter(Boolean),
      elapsedSec: m.thought.elapsedSec,
      items: Array.isArray(m.thought.items) ? m.thought.items.slice(-80).map((item) => item.type === 'tool'
        ? { type: 'tool', ...sanitizeTool(item) }
        : { type: 'text', text: clip(item.text, MAX_THOUGHT_TEXT) }) : undefined,
    };
  }
  if (m.patch && typeof m.patch === 'object') {
    out.patch = {
      files: (m.patch.files || []).slice(0, 30),
      insertions: m.patch.insertions || 0,
      deletions: m.patch.deletions || 0,
      // Inline diff text is re-renderable bulk: drop it, keep the summary.
      diffsTruncated: true,
    };
  }
  if (m.modelName) {
    out.modelName = clip(m.modelName, 120);
  }
  if (Array.isArray(m.references)) {
    out.references = m.references.slice(0, 5).map((r) => ({
      title: clip(r.title || '', 120),
      url: clip(r.url || '', 300),
      description: clip(r.description || '', 200),
    }));
  }
  return out;
}

class ChatHistory {
  constructor(options) {
    this.options = options || {};
    this.storage = this.options.storage || null; // vscode.Memento | memory stub
    this.persistenceEnabled = this.options.persist !== false;
    this.records = new Map();
  }

  storageKey() {
    return 'freecli.history.v1';
  }

  async load() {
    if (!this.persistenceEnabled || !this.storage) {
      return;
    }
    try {
      const raw = this.storage.get(this.storageKey(), {});
      for (const [id, rec] of Object.entries(raw || {})) {
        if (rec && typeof rec === 'object') {
          this.records.set(id, rec);
        }
      }
    } catch (e) {
      // corrupted storage: start fresh
    }
  }

  async _save() {
    if (!this.persistenceEnabled || !this.storage || typeof this.storage.update !== 'function') {
      return;
    }
    try {
      const obj = {};
      for (const [id, rec] of this.records) {
        obj[id] = rec;
      }
      await this.storage.update(this.storageKey(), obj);
    } catch (e) {
      // ignore persistence failures
    }
  }

  prune() {
    const sorted = [...this.records.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    const keep = new Set(sorted.slice(0, MAX_CONVERSATIONS).map((r) => r.id));
    for (const id of [...this.records.keys()]) {
      if (!keep.has(id)) {
        this.records.delete(id);
      }
    }
  }

  async persist(convId, meta, messages) {
    if (!convId) {
      return null;
    }
    const now = new Date().toISOString();
    const prev = this.records.get(convId) || {};
    const clean = (messages || []).slice(-MAX_MESSAGES).map(sanitizeMessage).filter(Boolean);
    // Title: first user message, truncated.
    let title = prev.title || '';
    const firstUser = clean.find((m) => m.role === 'user' && m.text);
    if (firstUser) {
      title = firstUser.text.slice(0, 80);
    }
    const rec = {
      id: convId,
      title,
      model: (meta && meta.model) || prev.model || null,
      workspace: (meta && meta.workspace) || prev.workspace || null,
      cliSessionId: (meta && meta.cliSessionId) || prev.cliSessionId || null,
      createdAt: prev.createdAt || now,
      updatedAt: now,
      messages: clean,
    };
    this.records.set(convId, rec);
    this.prune();
    await this._save();
    return rec;
  }

  get(convId) {
    return this.records.get(convId) || null;
  }

  async remove(convId) {
    this.records.delete(convId);
    await this._save();
  }

  list() {
    return [...this.records.values()]
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .map((r) => ({
        id: r.id,
        title: r.title || 'Untitled conversation',
        model: r.model,
        workspace: r.workspace,
        updatedAt: r.updatedAt,
        messageCount: (r.messages || []).length,
      }));
  }
}

module.exports = {
  ChatHistory,
  sanitizeMessage,
  MAX_CONVERSATIONS,
  MAX_MESSAGES,
};
