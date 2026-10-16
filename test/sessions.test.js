'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { SessionManager } = require('../src/sessions/sessionManager');

function memMemento() {
  const store = new Map();
  return {
    get: (k, fb) => (store.has(k) ? store.get(k) : fb),
    update: async (k, v) => {
      store.set(k, v);
    },
  };
}

describe('SessionManager', () => {
  it('keeps separate conversations; switching does not destroy', async () => {
    const sm = new SessionManager({ memento: memMemento() });
    const a = sm.createSession('opencode', 'opencode/big-pickle', '/ws');
    const b = sm.createSession('opencode', 'opencode/exo-free', '/ws');
    assert.notEqual(a.id, b.id);
    assert.equal(sm.list().length, 2);
    sm.setActive(a.id);
    assert.equal(sm.getActive().id, a.id);
    // other session intact
    assert.ok(sm.get(b.id));
  });

  it('removes sessions without touching others', async () => {
    const sm = new SessionManager({ memento: memMemento() });
    const a = sm.createSession('opencode', 'm1', '/ws');
    const b = sm.createSession('opencode', 'm2', '/ws');
    assert.equal(sm.remove(a.id), true);
    assert.equal(sm.get(a.id), null);
    assert.ok(sm.get(b.id));
    assert.equal(sm.remove('missing'), false);
  });

  it('persists minimal metadata only', async () => {
    const m = memMemento();
    const sm = new SessionManager({ memento: m });
    sm.createSession('opencode', 'opencode/big-pickle', '/ws');
    await sm.save();
    const stored = m.get('freecli.sessions.v1', []);
    assert.ok(stored.length >= 1);
    assert.ok(!JSON.stringify(stored).includes('sk-'));
    assert.ok(stored[0].cliSessionId !== undefined);
  });
});
