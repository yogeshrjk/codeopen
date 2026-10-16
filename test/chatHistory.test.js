'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ChatHistory, sanitizeMessage, MAX_CONVERSATIONS, MAX_MESSAGES } = require('../src/sessions/chatHistory');

function memStorage() {
  const store = new Map();
  return {
    get: (k, fb) => (store.has(k) ? store.get(k) : fb),
    update: async (k, v) => {
      store.set(k, v);
    },
    _raw: store,
  };
}

describe('sanitizeMessage', () => {
  it('truncates long text and drops inline diff bulk', () => {
    const m = sanitizeMessage({
      role: 'assistant',
      text: 'x'.repeat(9000),
      thought: { text: 'y'.repeat(5000), tools: [{ tool: 'bash', phase: 'done', title: 't', input: 'i', output: 'o'.repeat(2000), exit: 0 }] },
      patch: { files: [{ path: 'a.py' }], insertions: 1, deletions: 0, diffs: [{ path: 'a.py', text: 'z'.repeat(50000) }] },
    });
    assert.ok(m.text.length <= 4000 + 20);
    assert.ok(m.thought.text.length <= 2000 + 20);
    assert.ok(m.thought.tools[0].output.length <= 500 + 20);
    assert.ok(!m.patch.diffs, 'inline diff text must not be persisted');
    assert.deepEqual(m.patch.files, [{ path: 'a.py' }]);
  });

  it('rejects non-objects', () => {
    assert.equal(sanitizeMessage(null), null);
    assert.equal(sanitizeMessage('hi'), null);
  });
});

describe('ChatHistory (local-only storage)', () => {
  it('persists, lists and reloads conversations with titles', async () => {
    const storage = memStorage();
    const h = new ChatHistory({ storage });
    await h.persist('c1', { model: 'm', workspace: '/ws' }, [
      { role: 'user', text: 'Hello world, please explain this in detail' },
      { role: 'assistant', text: 'Sure' },
    ]);
    const list = h.list();
    assert.equal(list.length, 1);
    assert.match(list[0].title, /Hello world/);
    assert.equal(list[0].messageCount, 2);

    const h2 = new ChatHistory({ storage });
    await h2.load();
    assert.equal(h2.get('c1').messages.length, 2);
    // Local only: single namespaced key, no remote calls involved.
    assert.deepEqual([...storage._raw.keys()], ['freecli.history.v1']);
  });

  it('deletes conversations', async () => {
    const h = new ChatHistory({ storage: memStorage() });
    await h.persist('c1', {}, [{ role: 'user', text: 'hi' }]);
    await h.remove('c1');
    assert.equal(h.list().length, 0);
    assert.equal(h.get('c1'), null);
  });

  it('caps conversation and message counts', async () => {
    const h = new ChatHistory({ storage: memStorage() });
    for (let i = 0; i < MAX_CONVERSATIONS + 5; i++) {
      await h.persist(`c${i}`, {}, [{ role: 'user', text: `msg ${i}` }]);
    }
    assert.equal(h.list().length, MAX_CONVERSATIONS);
    const many = [];
    for (let i = 0; i < MAX_MESSAGES + 10; i++) {
      many.push({ role: 'user', text: `m${i}` });
    }
    await h.persist('big', {}, many);
    assert.equal(h.get('big').messages.length, MAX_MESSAGES);
  });
});
