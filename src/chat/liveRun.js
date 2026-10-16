'use strict';

// Owned by the extension host, never by the disposable sidebar webview.
// A fresh/visible view receives this snapshot before resuming live deltas.
class LiveRun {
  constructor() {
    this.startedAt = Date.now();
    this.text = '';
    this.thought = { items: [], live: true, done: false, phase: 'Working…' };
  }

  accept(message) {
    const t = this.thought;
    const addText = (text) => {
      const last = t.items[t.items.length - 1];
      if (last && last.type === 'text') last.text += text;
      else t.items.push({ type: 'text', text });
    };
    if (message.type === 'delta') {
      this.text += message.text || '';
      t.phase = 'Responding…';
    } else if (message.type === 'thinking') {
      addText(message.text || '');
      t.phase = 'Thinking…';
    } else if (message.type === 'demoteToThinking') {
      addText(message.text || this.text);
      this.text = '';
    } else if (message.type === 'toolEvent') {
      const key = message.callID;
      let tool = key && t.items.find((item) => item.type === 'tool' && item.callID === key);
      if (!tool) {
        tool = { type: 'tool' };
        t.items.push(tool);
      }
      Object.assign(tool, message, { type: 'tool' });
      t.phase = message.label || 'Working…';
    }
  }

  snapshot() {
    return { text: this.text, thought: this.thought, startedAt: this.startedAt };
  }
}

module.exports = { LiveRun };
