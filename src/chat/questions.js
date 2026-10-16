'use strict';

/**
 * Plan-mode question helpers.
 *
 * OpenCode's `question` tool lets the model pause and ask structured
 * questions: each entry carries { header, question, options: [{label,
 * description}], multiple?, custom? }. The TUI renders them with numbered
 * options, a "Type your own answer" row, and tab navigation across multiple
 * questions before submit. This module normalizes the various wire shapes
 * the CLI can emit (`run --format json` tool_use parts) into that same
 * shape so the sidebar can render a Todo-like UI (checkbox answers +
 * custom answer + Next).
 */

function isQuestionTool(tool) {
  const t = String(tool || '').toLowerCase().trim();
  return t === 'question' || t === 'questions' || t === 'askquestion' ||
    t === 'ask_question' || t === 'askuserquestion' || t === 'ask_user_question';
}

function asArray(v) {
  return Array.isArray(v) ? v : null;
}

function tryParseJsonMaybeString(v) {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (!s) return v;
  if ((s[0] === '[' || s[0] === '{') && (s[s.length - 1] === ']' || s[s.length - 1] === '}')) {
    try {
      return JSON.parse(s);
    } catch (e) {
      return v;
    }
  }
  return v;
}

function normalizeOption(opt, idx) {
  if (opt === null || opt === undefined) return null;
  if (typeof opt === 'string') {
    const label = opt.trim();
    if (!label) return null;
    return { label: label.slice(0, 120), description: '' };
  }
  if (typeof opt === 'object') {
    const label = String(opt.label || opt.text || opt.title || opt.name || opt.value || '').trim();
    if (!label) return null;
    const description = String(opt.description || opt.desc || opt.detail || '').trim().slice(0, 300);
    return { label: label.slice(0, 120), description };
  }
  return null;
}

function normalizeOneQuestion(q, idx) {
  if (!q || typeof q !== 'object') {
    if (typeof q === 'string' && q.trim()) {
      return {
        header: `Question ${idx + 1}`,
        question: q.trim().slice(0, 1000),
        options: [],
        multiple: false,
        custom: true,
      };
    }
    return null;
  }
  const headerRaw = String(q.header || q.title || '').trim().slice(0, 60);
  const questionRaw = String(q.question || q.prompt || q.text || '').trim().slice(0, 1000);
  // Tolerate models omitting one of header/question (fail-soft like TUI fallback).
  const header = headerRaw || (questionRaw ? questionRaw.slice(0, 30) : `Question ${idx + 1}`);
  const question = questionRaw || headerRaw || `Question ${idx + 1}`;
  let optionsRaw = q.options || q.choices || q.answers || [];
  optionsRaw = tryParseJsonMaybeString(optionsRaw);
  const optionsList = asArray(optionsRaw) || [];
  const options = [];
  for (let i = 0; i < optionsList.length && options.length < 10; i++) {
    const o = normalizeOption(optionsList[i], i);
    if (o) options.push(o);
  }
  const multiple = q.multiple === true || q.multiSelect === true || q.multiselect === true;
  // TUI default: custom answer allowed unless explicitly false.
  const custom = q.custom !== false && q.allowCustom !== false && q.customAnswer !== false;
  return { header, question, options, multiple, custom };
}

/**
 * Normalize any plausible `question` tool input into an array of questions.
 * Accepts: {questions:[...]}, {questions:"[...]"}, array directly,
 * JSON string of either shape, or a single question object.
 * Returns null when nothing usable is found.
 */
function normalizeQuestions(input) {
  try {
    let v = tryParseJsonMaybeString(input);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (v.questions !== undefined) {
        v = tryParseJsonMaybeString(v.questions);
      } else if (v.question !== undefined && v.options !== undefined) {
        v = [v];
      } else if (v.header !== undefined && v.question !== undefined) {
        v = [v];
      } else {
        // Maybe { "0": {...}, ... } or unknown wrapper — look for first array value.
        const arrVal = Object.values(v).find((x) => Array.isArray(x));
        if (arrVal) {
          v = arrVal;
        } else {
          return null;
        }
      }
    }
    const list = asArray(v);
    if (!list) return null;
    const out = [];
    for (let i = 0; i < list.length && out.length < 10; i++) {
      let item = tryParseJsonMaybeString(list[i]);
      const n = normalizeOneQuestion(item, i);
      if (n) out.push(n);
    }
    return out.length ? out : null;
  } catch (e) {
    return null;
  }
}

/**
 * Pull questions out of a tool detail record produced by summarizeTool().
 * Checks detail.questions, detail.rawInput, and JSON-encoded detail.input.
 */
function extractQuestionsFromToolDetail(detail) {
  if (!detail || typeof detail !== 'object') return null;
  const candidates = [];
  if (detail.questions !== undefined) candidates.push(detail.questions);
  if (detail.rawInput !== undefined) candidates.push(detail.rawInput);
  if (detail.todos !== undefined && isQuestionTool(detail.tool)) candidates.push(detail.todos);
  // detail.input is a truncated summary string (command/pattern/filePath...);
  // still try parsing it — question JSON sometimes lands there.
  if (typeof detail.input === 'string' && detail.input.length > 2) candidates.push(detail.input);
  for (const c of candidates) {
    const n = normalizeQuestions(c);
    if (n) return n;
  }
  // Last resort: raw blob may nest under input object already stringified.
  try {
    if (detail.rawInput && typeof detail.rawInput === 'object') {
      for (const v of Object.values(detail.rawInput)) {
        const n = normalizeQuestions(v);
        if (n) return n;
      }
    }
  } catch (e) {}
  return null;
}

/**
 * Format answered questions back into a user message for the next CLI turn.
 * answers: Array<Array<string>> — one entry per question.
 */
function formatQuestionAnswers(questions, answers) {
  const qs = Array.isArray(questions) ? questions : [];
  const as = Array.isArray(answers) ? answers : [];
  const lines = ['Answers to your questions:'];
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i] || {};
    const label = `${i + 1}. [${q.header || `Question ${i + 1}`}] ${q.question || ''}`.trim();
    const picked = Array.isArray(as[i]) ? as[i].filter((s) => String(s || '').trim()) : [];
    lines.push(label);
    lines.push(`   Answer: ${picked.length ? picked.join(', ') : 'Skipped'}`);
  }
  return lines.join('\n');
}

module.exports = {
  isQuestionTool,
  normalizeQuestions,
  extractQuestionsFromToolDetail,
  formatQuestionAnswers,
};
