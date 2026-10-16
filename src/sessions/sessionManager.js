'use strict';

const crypto = require('crypto');

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Extension-side conversation registry. Each entry keeps its own CLI state;
 * switching CLIs never destroys the other CLI's sessions.
 * Only minimal metadata is persisted (never prompts beyond title, never secrets).
 */
class SessionManager {
  constructor(options) {
    this.options = options || {};
    this.memento = this.options.memento; // vscode.Memento | memory stub
    this.sessions = new Map();
    this.activeId = null;
    this.persist = this.options.persist !== false;
  }

  storageKey() {
    return 'freecli.sessions.v1';
  }

  async load() {
    if (!this.persist || !this.memento) {
      return;
    }
    try {
      const raw = this.memento.get(this.storageKey(), []);
      for (const s of raw) {
        if (s && s.id && s.cli) {
          this.sessions.set(s.id, { ...s, status: s.status || 'idle' });
        }
      }
      const active = this.memento.get('freecli.activeSession', null);
      if (active && this.sessions.has(active)) {
        this.activeId = active;
      }
    } catch (e) {
      // corrupted storage: start fresh
    }
  }

  async save() {
    if (!this.persist || !this.memento || typeof this.memento.update !== 'function') {
      return;
    }
    try {
      const arr = [...this.sessions.values()].map((s) => ({
        id: s.id,
        cli: s.cli,
        model: s.model,
        cliSessionId: s.cliSessionId || null,
        workspace: s.workspace || null,
        title: (s.title || '').slice(0, 120),
        createdAt: s.createdAt,
        lastActivity: s.lastActivity,
        status: s.status,
      }));
      await this.memento.update(this.storageKey(), arr.slice(-50));
      await this.memento.update('freecli.activeSession', this.activeId);
    } catch (e) {
      // ignore persistence failures
    }
  }

  createSession(cli, model, workspace) {
    const now = new Date().toISOString();
    const s = {
      id: newId('conv'),
      cli,
      model: model || null,
      cliSessionId: null,
      workspace: workspace || null,
      title: '',
      createdAt: now,
      lastActivity: now,
      status: 'idle',
    };
    this.sessions.set(s.id, s);
    this.activeId = s.id;
    this.save();
    return s;
  }

  get(id) {
    return this.sessions.get(id || this.activeId) || null;
  }

  getActive() {
    return this.get(this.activeId);
  }

  setActive(id) {
    if (this.sessions.has(id)) {
      this.activeId = id;
      this.save();
      return true;
    }
    return false;
  }

  update(id, patch) {
    const s = this.sessions.get(id);
    if (!s) {
      return null;
    }
    Object.assign(s, patch || {}, { lastActivity: new Date().toISOString() });
    this.save();
    return s;
  }

  remove(id) {
    const had = this.sessions.delete(id);
    if (this.activeId === id) {
      this.activeId = null;
    }
    if (had) {
      this.save();
    }
    return had;
  }

  clearAll() {
    this.sessions.clear();
    this.activeId = null;
    this.save();
  }

  list() {
    return [...this.sessions.values()].sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : -1));
  }
}

module.exports = {
  SessionManager,
  newId,
};
