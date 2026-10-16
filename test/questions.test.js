'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isQuestionTool,
  normalizeQuestions,
  extractQuestionsFromToolDetail,
  formatQuestionAnswers,
} = require('../src/chat/questions');

describe('questions module', () => {
  describe('isQuestionTool', () => {
    it('recognizes question tool variants', () => {
      assert.equal(isQuestionTool('question'), true);
      assert.equal(isQuestionTool('questions'), true);
      assert.equal(isQuestionTool('askquestion'), true);
      assert.equal(isQuestionTool('ask_question'), true);
      assert.equal(isQuestionTool('askuserquestion'), true);
      assert.equal(isQuestionTool('ask_user_question'), true);
      assert.equal(isQuestionTool('Question'), true);
    });
    it('rejects non-question tools', () => {
      assert.equal(isQuestionTool('bash'), false);
      assert.equal(isQuestionTool('read'), false);
      assert.equal(isQuestionTool('todowrite'), false);
      assert.equal(isQuestionTool(''), false);
      assert.equal(isQuestionTool(null), false);
    });
  });

  describe('normalizeQuestions', () => {
    it('normalizes array of question objects', () => {
      const input = [
        { header: 'Q1', question: 'Choose:', options: [{ label: 'A' }, { label: 'B' }], multiple: false, custom: true },
      ];
      const out = normalizeQuestions(input);
      assert.ok(Array.isArray(out));
      assert.equal(out.length, 1);
      assert.equal(out[0].header, 'Q1');
      assert.equal(out[0].question, 'Choose:');
      assert.equal(out[0].options.length, 2);
      assert.equal(out[0].multiple, false);
      assert.equal(out[0].custom, true);
    });
    it('normalizes object with questions property', () => {
      const input = { questions: [{ header: 'H', question: 'Q?', options: [] }] };
      const out = normalizeQuestions(input);
      assert.equal(out.length, 1);
      assert.equal(out[0].header, 'H');
    });
    it('normalizes single question object', () => {
      const input = { header: 'H', question: 'Q?', options: [] };
      const out = normalizeQuestions(input);
      assert.equal(out.length, 1);
    });
    it('parses JSON string input', () => {
      const input = JSON.stringify([{ header: 'H', question: 'Q?', options: ['A', 'B'] }]);
      const out = normalizeQuestions(input);
      assert.equal(out.length, 1);
      assert.equal(out[0].options[0].label, 'A');
    });
    it('parses JSON string with questions wrapper', () => {
      const input = JSON.stringify({ questions: [{ header: 'H', question: 'Q?', options: [] }] });
      const out = normalizeQuestions(input);
      assert.equal(out.length, 1);
    });
    it('handles string options', () => {
      const input = [{ header: 'H', question: 'Q?', options: ['A', 'B', 'C'] }];
      const out = normalizeQuestions(input);
      assert.equal(out[0].options.length, 3);
      assert.equal(out[0].options[0].label, 'A');
    });
    it('handles object options with label/description', () => {
      const input = [{ header: 'H', question: 'Q?', options: [{ label: 'A', description: 'Desc A' }, { label: 'B' }] }];
      const out = normalizeQuestions(input);
      assert.equal(out[0].options[0].label, 'A');
      assert.equal(out[0].options[0].description, 'Desc A');
      assert.equal(out[0].options[1].label, 'B');
      assert.equal(out[0].options[1].description, '');
    });
    it('limits to 10 questions', () => {
      const input = Array(15).fill({ header: 'H', question: 'Q?', options: [] });
      const out = normalizeQuestions(input);
      assert.equal(out.length, 10);
    });
    it('limits to 10 options per question', () => {
      const input = [{ header: 'H', question: 'Q?', options: Array(15).fill({ label: 'O' }) }];
      const out = normalizeQuestions(input);
      assert.equal(out[0].options.length, 10);
    });
    it('returns null for invalid input', () => {
      assert.equal(normalizeQuestions(null), null);
      assert.equal(normalizeQuestions(undefined), null);
      assert.equal(normalizeQuestions('not json'), null);
      assert.equal(normalizeQuestions({}), null);
    });
    it('falls back to header/question when one is missing', () => {
      const out1 = normalizeQuestions([{ header: 'Only header' }]);
      assert.equal(out1[0].header, 'Only header');
      assert.equal(out1[0].question, 'Only header');
      const out2 = normalizeQuestions([{ question: 'Only question?' }]);
      assert.equal(out2[0].header, 'Only question?');
      assert.equal(out2[0].question, 'Only question?');
    });
    it('handles multiple and custom flags', () => {
      const out = normalizeQuestions([{ header: 'H', question: 'Q?', options: [], multiple: true, custom: false }]);
      assert.equal(out[0].multiple, true);
      assert.equal(out[0].custom, false);
    });
  });

  describe('extractQuestionsFromToolDetail', () => {
    it('extracts from detail.questions', () => {
      const detail = { tool: 'question', questions: [{ header: 'H', question: 'Q?', options: [] }] };
      const out = extractQuestionsFromToolDetail(detail);
      assert.equal(out.length, 1);
    });
    it('extracts from detail.rawInput', () => {
      const detail = { tool: 'question', rawInput: { questions: [{ header: 'H', question: 'Q?', options: [] }] } };
      const out = extractQuestionsFromToolDetail(detail);
      assert.equal(out.length, 1);
    });
    it('extracts from detail.todos when tool is question', () => {
      const detail = { tool: 'question', todos: [{ header: 'H', question: 'Q?', options: [] }] };
      const out = extractQuestionsFromToolDetail(detail);
      assert.equal(out.length, 1);
    });
    it('extracts from detail.input string', () => {
      const detail = { tool: 'question', input: JSON.stringify([{ header: 'H', question: 'Q?', options: [] }]) };
      const out = extractQuestionsFromToolDetail(detail);
      assert.equal(out.length, 1);
    });
    it('extracts from nested rawInput object', () => {
      const detail = { tool: 'question', rawInput: { data: { questions: [{ header: 'H', question: 'Q?', options: [] }] } } };
      const out = extractQuestionsFromToolDetail(detail);
      assert.equal(out.length, 1);
    });
    it('returns null when no questions found', () => {
      assert.equal(extractQuestionsFromToolDetail({ tool: 'bash', input: 'ls' }), null);
      assert.equal(extractQuestionsFromToolDetail(null), null);
    });
  });

  describe('formatQuestionAnswers', () => {
    it('formats answered questions', () => {
      const questions = [
        { header: 'Color', question: 'Pick a color', options: [{ label: 'Red' }, { label: 'Blue' }] },
        { header: 'Size', question: 'Pick a size', options: [{ label: 'S' }, { label: 'M' }] },
      ];
      const answers = [['Red'], ['M', 'L']];
      const out = formatQuestionAnswers(questions, answers);
      assert.match(out, /Answers to your questions:/);
      assert.match(out, /1\. \[Color\] Pick a color/);
      assert.match(out, /Answer: Red/);
      assert.match(out, /2\. \[Size\] Pick a size/);
      assert.match(out, /Answer: M, L/);
    });
    it('handles skipped answers', () => {
      const questions = [{ header: 'H', question: 'Q?' }];
      const answers = [[]];
      const out = formatQuestionAnswers(questions, answers);
      assert.match(out, /Answer: Skipped/);
    });
    it('handles missing questions/answers gracefully', () => {
      const out = formatQuestionAnswers(null, null);
      assert.match(out, /Answers to your questions:/);
    });
  });
});