'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  getCurrentDateTime,
  extractSearchQuery,
  hasSearchTopic,
  shouldSearch,
  searchWikipedia,
  formatReferencesForPrompt,
} = require('../src/chat/webSearch');

describe('webSearch.getCurrentDateTime', () => {
  it('returns current date and time with ISO and formatted strings', () => {
    const dt = getCurrentDateTime();
    assert.ok(dt.iso);
    assert.ok(dt.formatted);
    assert.ok(typeof dt.year === 'number');
    assert.ok(dt.year >= 2024);
  });
});

describe('webSearch.extractSearchQuery', () => {
  it('strips leading question words and conversational prefixes', () => {
    assert.equal(extractSearchQuery('Who is the CEO of Microsoft?'), 'CEO of Microsoft');
    assert.equal(extractSearchQuery('What is React Server Components?'), 'React Server Components');
    assert.equal(extractSearchQuery('tell me about Quantum Computing'), 'Quantum Computing');
    assert.equal(extractSearchQuery('please search for TypeScript 5.0'), 'TypeScript 5.0');
    assert.equal(extractSearchQuery('can you find information on Albert Einstein?'), 'Albert Einstein');
    assert.equal(extractSearchQuery('when was the Python programming language released?'), 'the Python programming language released');
  });

  it('strips slash commands like /search and /web', () => {
    assert.equal(extractSearchQuery('/search OpenAI o3'), 'OpenAI o3');
    assert.equal(extractSearchQuery('/web Node.js LTS'), 'Node.js LTS');
    assert.equal(extractSearchQuery('/wiki Linux kernel'), 'Linux kernel');
  });

  it('strips "how can we / how do I" wrappers', () => {
    assert.equal(extractSearchQuery('how can we improve this project?'), 'improve this project');
    assert.equal(extractSearchQuery('how do I deploy this?'), 'deploy this');
  });

  it('handles empty or non-string inputs gracefully', () => {
    assert.equal(extractSearchQuery(''), '');
    assert.equal(extractSearchQuery(null), '');
    assert.equal(extractSearchQuery(undefined), '');
  });
});

describe('webSearch.hasSearchTopic', () => {
  it('rejects topic-less local questions', () => {
    assert.equal(hasSearchTopic('how can we improve this project?'), false);
    assert.equal(hasSearchTopic('how can we improve this'), false);
    assert.equal(hasSearchTopic('fix this'), false);
  });

  it('accepts real external topics', () => {
    assert.equal(hasSearchTopic('What is the latest LTS of Node.js?'), true);
    assert.equal(hasSearchTopic('Who is Satya Nadella?'), true);
    assert.equal(hasSearchTopic('how can we improve performance?'), true);
  });
});

describe('webSearch.shouldSearch', () => {
  it('triggers search on slash commands', () => {
    assert.equal(shouldSearch('/search test', true, 'build'), true);
    assert.equal(shouldSearch('/web test', false, 'plan'), true);
    assert.equal(shouldSearch('/wiki test', false, 'build'), true);
  });

  it('triggers search in ask mode or without selection for informational questions', () => {
    assert.equal(shouldSearch('Who is Satya Nadella?', false, 'build'), true);
    assert.equal(shouldSearch('What is the latest LTS of Node.js?', false, 'build'), true);
    assert.equal(shouldSearch('Explain how transformers work in AI', false, 'ask'), true);
  });

  it('triggers search when explicitly asking for wikipedia or current dates/releases', () => {
    assert.equal(shouldSearch('Check wikipedia for latest version', true, 'build'), true);
    assert.equal(shouldSearch('What is the latest version of this library', true, 'build'), true);
  });

  it('does not trigger for pure local code editing without questions', () => {
    assert.equal(shouldSearch('fix typo in function name', true, 'build'), false);
    assert.equal(shouldSearch('add return type annotation', true, 'build'), false);
  });

  it('does not trigger for topic-less local questions', () => {
    assert.equal(shouldSearch('how can we improve this project?', false, 'build'), false);
    assert.equal(shouldSearch('how can we improve this project?', false, 'ask'), false);
    assert.equal(shouldSearch('how can we improve this project?', true, 'build'), false);
  });
});

describe('webSearch.formatReferencesForPrompt', () => {
  it('formats references with numbers, URLs, summaries, and current date/time', () => {
    const results = [
      {
        title: 'OpenAI',
        url: 'https://en.wikipedia.org/wiki/OpenAI',
        description: 'American AI research lab',
        extract: 'OpenAI is an artificial intelligence research organization.',
      },
    ];
    const dt = { iso: '2026-10-14T12:00:00Z', formatted: 'Wednesday, October 14, 2026' };
    const formatted = formatReferencesForPrompt(results, dt);
    assert.match(formatted, /Current Date and Time:/);
    assert.match(formatted, /Wednesday, October 14, 2026/);
    assert.match(formatted, /Web Search References \(Wikipedia\):/);
    assert.match(formatted, /\[1\] "OpenAI"/);
    assert.match(formatted, /https:\/\/en\.wikipedia\.org\/wiki\/OpenAI/);
    assert.match(formatted, /American AI research lab/);
    assert.match(formatted, /Instructions for Web Search References/);
  });

  it('handles empty results gracefully by returning date/time', () => {
    const formatted = formatReferencesForPrompt([], { iso: '2026-10-14T00:00:00Z', formatted: 'Wednesday' });
    assert.match(formatted, /Current Date and Time:/);
    assert.ok(!formatted.includes('Web Search References (Wikipedia):'));
  });
});

describe('webSearch.searchWikipedia', () => {
  it('returns empty array when query is empty', async () => {
    const res = await searchWikipedia('');
    assert.deepEqual(res, []);
  });

  it('returns empty array without network for topic-less queries', async () => {
    const res = await searchWikipedia('how can we improve this project?');
    assert.deepEqual(res, []);
  });

  it('drops Wikipedia hits unrelated to the query', async () => {
    const origFetch = global.fetch;
    global.fetch = async (url) => {
      if (String(url).includes('action=query')) {
        return {
          ok: true,
          json: async () => ({
            query: {
              search: [
                { title: 'How We Think', snippet: 'book by John Dewey', wordcount: 1200 },
                { title: 'Node.js', snippet: 'open-source JavaScript runtime', wordcount: 3000 },
              ],
            },
          }),
        };
      }
      return { ok: false };
    };
    try {
      const res = await searchWikipedia('latest LTS of Node.js', 3, 8000);
      assert.equal(res.length, 1);
      assert.equal(res[0].title, 'Node.js');
    } finally {
      global.fetch = origFetch;
    }
  });

  it('handles network failure or abort gracefully without throwing', async () => {
    // Calling with a query and extremely short timeout or invalid setup
    const res = await searchWikipedia('test', 1, 1);
    assert.ok(Array.isArray(res));
  });
});
