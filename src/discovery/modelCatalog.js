'use strict';

const { evaluateOpenCodeModel } = require('./freeModelPolicy');

class ModelCatalog {
  constructor(options) {
    this.options = options || {};
    this.cacheDurationMs = (this.options.cacheDurationSec || 3600) * 1000;
    this.cache = {
      opencode: null, // { retrievedAt, expiresAt, source, models, refreshStatus }
    };
  }

  isFresh(entry) {
    return !!entry && Date.now() < entry.expiresAt;
  }

  getCached(cli) {
    const entry = this.cache[cli];
    if (!entry) {
      return null;
    }
    return entry;
  }

  clear(cli) {
    if (cli) {
      this.cache[cli] = null;
    } else {
      this.cache.opencode = null;
    }
  }

  /**
   * Load models for any supported CLI via `<cli> models --verbose` and
   * apply the same fail-closed free-model eligibility per CLI.
   */
  async loadModels(cli, adapter, opts) {
    const force = !!(opts && opts.force);
    if (!force && this.isFresh(this.cache[cli])) {
      return this.cache[cli];
    }
    const sourceLabel = `${cli} models --verbose`;
    const retrievedAt = new Date().toISOString();
    try {
      const raw = await adapter.listModelsRaw({ refresh: !!(opts && opts.refresh) });
      const parsed = parseOpenCodeVerbose(raw.stdout || '');
      const models = [];
      for (const p of parsed) {
        models.push({
          id: `${p.providerID}/${p.id}`,
          provider: p.providerID,
          modelId: p.id,
          displayName: p.name || p.id,
          variants: variantNames(p),
          reasoning: !!(p.capabilities && p.capabilities.reasoning),
          inputPrice: p.cost && p.cost.input,
          outputPrice: p.cost && p.cost.output,
          cacheReadPrice: p.cost && p.cost.cache && p.cost.cache.read,
          cacheWritePrice: p.cost && p.cost.cache && p.cost.cache.write,
          status: p.status,
          available: p.status !== 'disabled',
          providerAvailable: true,
          pricingSource: sourceLabel,
          retrievedAt,
        });
      }
      const eligible = [];
      const excluded = [];
      for (const m of models) {
        const v = evaluateOpenCodeModel({ ...m, stale: false });
        if (v.eligible) {
          eligible.push({ ...m, access: 'Verified free', eligibilityDetail: v.detail });
        } else {
          excluded.push({ id: m.id, reason: v.reason, detail: v.detail });
        }
      }
      const entry = {
        cli,
        retrievedAt,
        expiresAt: Date.now() + this.cacheDurationMs,
        source: sourceLabel,
        models: eligible,
        excludedCount: excluded.length,
        excluded,
        refreshStatus: 'fresh',
        modelIdentifier: 'provider/model-id',
        accessEligibility: 'verified-zero-price-only',
      };
      this.cache[cli] = entry;
      return entry;
    } catch (err) {
      const prev = this.cache[cli];
      const entry = {
        cli,
        retrievedAt,
        expiresAt: Date.now() + Math.min(this.cacheDurationMs, 5 * 60 * 1000),
        source: `${sourceLabel} (failed)`,
        models: [],
        excluded: [],
        refreshStatus: `failed: ${(err && err.message) || err}`,
        error: (err && err.message) || String(err),
        previousCacheExpired: !!prev,
      };
      // Do NOT serve stale as fresh: mark stale explicitly.
      if (prev) {
        prev.refreshStatus = 'stale-after-failure';
      }
      this.cache[cli] = entry;
      return entry;
    }
  }

  /**
   * OpenCode alias kept for compatibility (legacy tests/call sites).
   */
  async loadOpenCodeModels(adapter, opts) {
    return this.loadModels('opencode', adapter, opts);
  }

  /**
   * Fail-closed validation before a session starts.
   */
  validateSelection(cli, modelId) {
    const entry = this.cache[cli];
    if (!entry || !this.isFresh(entry)) {
      return { ok: false, reason: 'stale-catalog', message: 'Model catalog is missing or expired. Refresh before starting a session.' };
    }
    const found = (entry.models || []).find((m) => m.id === modelId);
    if (!found) {
      const excl = (entry.excluded || []).find((e) => e.id === modelId);
      const why = excl ? `${excl.reason}: ${excl.detail}` : 'not in the verified free catalog';
      return { ok: false, reason: 'not-eligible', message: `Model ${modelId} is not eligible (${why}). Choose another verified free model. No fallback to a paid model was made.` };
    }
    return { ok: true, model: found };
  }
}

function variantNames(p) {
  const v = p && p.variants;
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    return [];
  }
  return Object.keys(v);
}

function parseOpenCodeVerbose(stdout) {
  const lines = String(stdout || '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    i++;
    if (!line || line.startsWith('{')) {
      continue;
    }
    // Expect "provider/model" header.
    if (!line.includes('/')) {
      continue;
    }
    // Collect following JSON block (balanced braces).
    let jsonText = '';
    // Skip blank lines then accumulate until braces balance.
    while (i <= lines.length) {
      // Peek: if next non-empty line looks like next header (contains / and next line starts with {), break handled below.
      break;
    }
    // Find start of JSON.
    let j = i;
    while (j < lines.length && lines[j].trim() === '') {
      j++;
    }
    if (j < lines.length && lines[j].trim().startsWith('{')) {
      let depth = 0;
      let k = j;
      let acc = '';
      for (; k < lines.length; k++) {
        const l = lines[k];
        for (const ch of l) {
          if (ch === '{') {
            depth++;
          } else if (ch === '}') {
            depth--;
          }
        }
        acc += l + '\n';
        if (depth === 0 && acc.trim().length > 0) {
          k++;
          break;
        }
      }
      jsonText = acc;
      i = k;
    }
    if (jsonText) {
      try {
        const meta = JSON.parse(jsonText);
        // Header "opencode/big-pickle" should match providerID/id; trust metadata.
        out.push(meta);
      } catch (e) {
        // Malformed block: skip (handled as unavailable, never guessed).
      }
    }
  }
  return out;
}

module.exports = {
  ModelCatalog,
  parseOpenCodeVerbose,
  variantNames,
};
