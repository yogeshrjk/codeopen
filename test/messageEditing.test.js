'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { editBranch, conversationContext } = require('../src/chat/messageEditing');
const { sanitizeMessage } = require('../src/sessions/chatHistory');
test('branch replay includes only turns before the edit, within its budget', () => {
  const messages = [{id:'u1',role:'user',text:'Explain it'}, {id:'a1',role:'assistant',text:'First answer'}, {id:'u2',role:'user',text:'Old question'}, {id:'a2',role:'assistant',text:'Superseded answer'}];
  const branch = editBranch(messages,'u2');
  assert.equal(branch.length,2);
  const prompt = conversationContext(branch);
  assert.match(prompt,/Explain it/); assert.match(prompt,/First answer/);
  assert.ok(!prompt.includes('Old question')); assert.ok(!prompt.includes('Superseded answer'));
  assert.equal(messages.length,4);
  assert.throws(()=>editBranch(messages,'missing'),/no longer available/);
  assert.throws(()=>editBranch(messages,'a1'),/no longer available/);
});
test('history retains edit identity, attachments, and reasoning order', () => {
  const user = {id:'u1',role:'user',text:'Full prompt '.repeat(900),files:[{path:'src/a.js',name:'a.js',lang:'js'}]};
  const saved = sanitizeMessage(user);
  assert.equal(saved.text,user.text); assert.equal(saved.id,user.id); assert.deepEqual(saved.files,user.files);
  const thought = sanitizeMessage({role:'assistant',thought:{text:'Check',elapsedSec:8,items:[{type:'text',text:'Before'},{type:'tool',tool:'read',phase:'done'},{type:'text',text:'After'}]}}).thought;
  assert.deepEqual(thought.items.map(i=>i.type),['text','tool','text']); assert.equal(thought.elapsedSec,8);
});
