'use strict';

/**
 * Wikipedia-based Web Search reference provider for CodeOpen.
 * Replicates the VS Code Copilot web search reference feature, providing
 * live date/time context and Wikipedia reference search results so models
 * have accurate, up-to-date knowledge beyond their training cutoffs.
 */

function getCurrentDateTime() {
  const now = new Date();
  const options = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  };
  let formatted = '';
  try {
    formatted = now.toLocaleDateString('en-US', options);
  } catch (e) {
    formatted = now.toUTCString();
  }
  return {
    iso: now.toISOString(),
    formatted,
    year: now.getFullYear(),
  };
}

/**
 * Extract a concise Wikipedia search query from user prompt text.
 */
function extractSearchQuery(text) {
  if (!text || typeof text !== 'string') return '';
  let q = text.trim();
  // Strip slash commands e.g. /search, /web, /wiki
  q = q.replace(/^\/(?:search|web|wiki)\s+/i, '');
  // Strip "how can we / how do I / how should you …" wrappers first (the
  // generic does/do/is/are pattern below would otherwise leave the
  // pronoun behind, e.g. "how do I deploy" -> "I deploy").
  q = q.replace(/^how\s+(?:can|should|would|could|do|does)\s+(?:we|i|you|one)\s+/i, '');
  // Strip common conversational prefixes
  const prefixes = [
    /^(?:please\s+)?(?:can\s+you\s+)?(?:search\s+(?:for\s+)?|look\s+up\s+|find\s+(?:information\s+(?:about|on)\s+)?|tell\s+me\s+about\s+)/i,
    /^(?:what\s+(?:is|are|was|were)\s+(?:the\s+)?(?:current\s+|latest\s+)?)/i,
    /^(?:who\s+(?:is|are|was|were)\s+(?:the\s+)?)/i,
    /^(?:when\s+(?:did|was|is)\s+)/i,
    /^(?:where\s+(?:is|are)\s+)/i,
    /^(?:how\s+(?:does|do|is|are)\s+)/i,
    /^(?:explain\s+(?:to\s+me\s+)?(?:what\s+is\s+)?)/i,
  ];
  for (const re of prefixes) {
    q = q.replace(re, '');
  }
  // Remove trailing punctuation
  q = q.replace(/[?!.:;]+$/, '').trim();
  return q;
}

/**
 * Totally generic words that carry no Wikipedia topic on their own.
 * Pronouns / local references (this project, my code) plus filler verbs.
 */
const GENERIC_WORDS = new Set(
  ('a,an,the,of,for,to,in,on,with,and,or,s,t,' +
    'what,who,when,where,why,how,is,are,was,were,be,been,' +
    'this,that,it,these,those,here,there,my,our,your,its,' +
    'we,i,you,one,me,us,them,they,he,she,' +
    'project,projects,code,repo,repository,repos,file,files,app,' +
    'improve,improvement,fix,better,best,way,ways,help,please,' +
    'can,do,does,did,should,would,could,will,' +
    'tell,explain,describe,give,show,find,search,look,up,about'
  ).split(','),
);

/**
 * Does the prompt contain a real external topic worth searching
 * Wikipedia for? Rejects topic-less prompts like "how can we improve
 * this project" (local question, pronouns only) while keeping real
 * questions like "latest LTS of Node.js".
 */
function hasSearchTopic(text) {
  const q = extractSearchQuery(text);
  if (!q) return false;
  const tokens = q
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !GENERIC_WORDS.has(w));
  // Require at least one meaningful topic word (length >= 2 so
  // versions like "5" alone do not count, but "go", "ai" do).
  return tokens.some((w) => w.length >= 2);
}

/**
 * Should we run web search for this request?
 */
function shouldSearch(text, hasSelection, mode) {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  if (t.startsWith('/search') || t.startsWith('/web') || t.startsWith('/wiki')) return true;
  // Fail closed on topic-less prompts ("how can we improve this project"
  // is a local question — Wikipedia has nothing useful for it).
  // If explicitly in ask mode or no active code selection, user is asking a question
  if (mode === 'ask' || !hasSelection) {
    if (/[?]|^(what|who|when|where|why|how|tell|search|explain|lookup|is|are|latest|current|news|release|version)\b/i.test(t)) {
      return hasSearchTopic(text);
    }
  }
  // Informational keywords even with code selection
  if (/\b(wikipedia|who is|what is|when was|latest version|current|documentation|release date)\b/i.test(t)) {
    return hasSearchTopic(text);
  }
  return false;
}

/**
 * Score a Wikipedia hit against the query (0 = unrelated). Counts how
 * many meaningful query words appear in the hit title/snippet.
 */
function scoreHit(queryTokens, title, snippet) {
  if (!queryTokens.length) return 0;
  const hay = `${title || ''} ${String(snippet || '').replace(/<\/?[^>]+(>|$)/g, '')}`.toLowerCase();
  let score = 0;
  for (const tok of queryTokens) {
    if (tok.length >= 3 && hay.includes(tok)) score++;
  }
  return score;
}

/**
 * Search Wikipedia and return top references with extracts and URLs.
 * Hits unrelated to the query are dropped, so vague prompts never
 * inject junk references into the model prompt.
 */
async function searchWikipedia(query, limit = 3, timeoutMs = 8000) {
  const cleanQ = extractSearchQuery(query) || query;
  if (!cleanQ || !cleanQ.trim()) return [];
  if (!hasSearchTopic(query)) return [];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const headers = {
    'User-Agent': 'CodeOpen/1.1 (VS Code Extension; https://github.com/anomalyco/opencode)',
    'Accept': 'application/json',
  };

  try {
    // Fetch more candidates than needed, then keep only the ones that
    // actually relate to the query (Wikipedia full-text ranks loosely).
    const fetchLimit = Math.max(limit * 3, 10);
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanQ.trim())}&utf8=&format=json&srlimit=${fetchLimit}`;
    const searchRes = await fetch(searchUrl, { headers, signal: controller.signal });
    if (!searchRes.ok) return [];
    const searchData = await searchRes.json();
    const hits = (searchData.query && searchData.query.search) || [];
    if (!hits.length) return [];
    const queryTokens = cleanQ
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !GENERIC_WORDS.has(w));
    const relevant = hits
      .filter((h) => {
        // Skip stubs/disambiguation noise.
        if (typeof h.wordcount === 'number' && h.wordcount < 50) return false;
        return scoreHit(queryTokens, h.title, h.snippet) > 0;
      })
      .slice(0, limit);
    if (!relevant.length) return [];

    const results = [];
    for (const hit of relevant) {
      try {
        const title = hit.title;
        const pageUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
        const sumUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
        const sumRes = await fetch(sumUrl, { headers, signal: controller.signal });
        let extract = '';
        let description = '';
        if (sumRes.ok) {
          const sumData = await sumRes.json();
          extract = sumData.extract || '';
          description = sumData.description || '';
        }
        if (!extract && hit.snippet) {
          extract = hit.snippet.replace(/<\/?[^>]+(>|$)/g, '');
        }
        results.push({
          title,
          description,
          extract: extract.slice(0, 800),
          url: pageUrl,
        });
      } catch (e) {
        // Continue with other hits
      }
    }
    return results;
  } catch (err) {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Format Wikipedia references into a structured prompt section.
 */
function formatReferencesForPrompt(results, dateTimeInfo) {
  const dt = dateTimeInfo || getCurrentDateTime();
  const lines = [];
  lines.push(`\nCurrent Date and Time:\n${dt.formatted} (${dt.iso})`);
  if (results && results.length) {
    lines.push('\nWeb Search References (Wikipedia):');
    results.forEach((r, idx) => {
      lines.push(`[${idx + 1}] "${r.title}"`);
      lines.push(`URL: ${r.url}`);
      if (r.description) lines.push(`Description: ${r.description}`);
      if (r.extract) lines.push(`Summary: ${r.extract}`);
      lines.push('');
    });
    lines.push('Instructions for Web Search References:');
    lines.push('- Use the current date/time and the Wikipedia references above to provide accurate, up-to-date information.');
    lines.push('- Cite sources when using information from these references, using markdown links (e.g. [Article Title](URL)) or numbers ([1]).');
  }
  return lines.join('\n');
}

module.exports = {
  getCurrentDateTime,
  extractSearchQuery,
  hasSearchTopic,
  shouldSearch,
  searchWikipedia,
  formatReferencesForPrompt,
};
