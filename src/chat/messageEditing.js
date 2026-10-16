'use strict';

// Editing forks conversation context without replaying later answers or
// sending the original CLI session ID. The old conversation remains in history.
function editBranch(messages, messageId) {
  const index = messages.findIndex((m) => m.id === messageId && m.role === 'user');
  if (index < 0) throw new Error('This message is no longer available to edit. Reopen the conversation and try again.');
  return messages.slice(0, index).filter((m) => m.role === 'user' || m.role === 'assistant');
}

function conversationContext(messages, budget = 24000) {
  const parts = [];
  let used = 0;
  for (const m of [...messages].reverse()) {
    if (!['user', 'assistant'].includes(m.role) || !m.text) continue;
    const text = String(m.text).slice(0, Math.max(0, budget - used));
    if (!text) break;
    parts.unshift(`${m.role.toUpperCase()}: ${text}`);
    used += text.length;
    if (used >= budget) break;
  }
  return parts.length ? `Earlier conversation (context only):\n${parts.join('\n\n')}\n\nCurrent request:\n` : '';
}

module.exports = { editBranch, conversationContext };
