'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateOpenCodeModel } = require('../src/discovery/freeModelPolicy');
const { ModelCatalog } = require('../src/discovery/modelCatalog');

describe('OpenCode free-model policy', () => {
  it('accepts verified zero-cost model', () => {
    const r = evaluateOpenCodeModel({ id: 'opencode/big-pickle', inputPrice: 0, outputPrice: 0, pricingSource: 'verbose' });
    assert.equal(r.eligible, true);
  });
  it('rejects paid model', () => {
    const r = evaluateOpenCodeModel({ id: 'x/y', inputPrice: 3, outputPrice: 15 });
    assert.equal(r.eligible, false);
    assert.equal(r.reason, 'nonzero-price');
  });
  it('rejects free-input but paid-output', () => {
    const r = evaluateOpenCodeModel({ id: 'x/y', inputPrice: 0, outputPrice: 2.5 });
    assert.equal(r.eligible, false);
  });
  it('rejects unknown pricing', () => {
    assert.equal(evaluateOpenCodeModel({ id: 'x/y' }).eligible, false);
    assert.equal(evaluateOpenCodeModel({ id: 'x/y', inputPrice: 0 }).eligible, false);
  });
  it('rejects stale catalog', () => {
    assert.equal(evaluateOpenCodeModel({ id: 'x/y', inputPrice: 0, outputPrice: 0, stale: true }).eligible, false);
  });
  it('rejects paid subscription / locked / quota-charge', () => {
    assert.equal(evaluateOpenCodeModel({ id: 'a', inputPrice: 0, outputPrice: 0, paidSubscription: true }).eligible, false);
    assert.equal(evaluateOpenCodeModel({ id: 'a', inputPrice: 0, outputPrice: 0, locked: true }).eligible, false);
    assert.equal(evaluateOpenCodeModel({ id: 'a', inputPrice: 0, outputPrice: 0, quotaPolicy: 'allowance-then-charge' }).eligible, false);
  });
  it('never trusts names: zero-price metadata required', () => {
    // A model named "*free*" with nonzero price must be excluded.
    const r = evaluateOpenCodeModel({ id: 'opencode/totally-free-flash-mini', inputPrice: 0.5, outputPrice: 0 });
    assert.equal(r.eligible, false);
  });
  it('excludes non-opencode providers (openrouter/groq/gemini)', () => {
    const r1 = evaluateOpenCodeModel({ id: 'openrouter/free-model', inputPrice: 0, outputPrice: 0, provider: 'openrouter', pricingSource: 'test' });
    assert.equal(r1.eligible, false);
    assert.equal(r1.reason, 'excluded-provider');
    const r2 = evaluateOpenCodeModel({ id: 'groq/free-model', inputPrice: 0, outputPrice: 0, provider: 'groq', pricingSource: 'test' });
    assert.equal(r2.eligible, false);
    assert.equal(r2.reason, 'excluded-provider');
    const r3 = evaluateOpenCodeModel({ id: 'gemini/free-model', inputPrice: 0, outputPrice: 0, provider: 'gemini', pricingSource: 'test' });
    assert.equal(r3.eligible, false);
    assert.equal(r3.reason, 'excluded-provider');
    const r4 = evaluateOpenCodeModel({ id: 'opencode/valid-model', inputPrice: 0, outputPrice: 0, provider: 'opencode', pricingSource: 'test' });
    assert.equal(r4.eligible, true);
  });
  it('derives provider from id when provider field is missing', () => {
    const r1 = evaluateOpenCodeModel({ id: 'openrouter/model', inputPrice: 0, outputPrice: 0, pricingSource: 'test' });
    assert.equal(r1.eligible, false);
    assert.equal(r1.reason, 'excluded-provider');
    const r2 = evaluateOpenCodeModel({ id: 'opencode/model', inputPrice: 0, outputPrice: 0, pricingSource: 'test' });
    assert.equal(r2.eligible, true);
  });
});

describe('ModelCatalog.validateSelection (fail closed)', () => {
  it('blocks unknown-cost model and stale catalog', () => {
    const cat = new ModelCatalog({ cacheDurationSec: 3600 });
    // Empty cache => blocked
    assert.equal(cat.validateSelection('opencode', 'opencode/big-pickle').ok, false);
    // Fresh cache with one eligible model
    cat.cache.opencode = {
      retrievedAt: new Date().toISOString(),
      expiresAt: Date.now() + 60000,
      source: 'test',
      models: [{ id: 'opencode/big-pickle' }],
      excluded: [{ id: 'opencode/gpt-paid', reason: 'nonzero-price', detail: 'costs' }],
    };
    assert.equal(cat.validateSelection('opencode', 'opencode/big-pickle').ok, true);
    const bad = cat.validateSelection('opencode', 'opencode/gpt-paid');
    assert.equal(bad.ok, false);
    assert.match(bad.message, /not eligible/);
    // Expired => blocked even for previously eligible
    cat.cache.opencode.expiresAt = Date.now() - 1;
    assert.equal(cat.validateSelection('opencode', 'opencode/big-pickle').ok, false);
  });

  it('never selects paid fallback (no default model)', async () => {
    const cat = new ModelCatalog({ cacheDurationSec: 3600 });
    const fakeAdapter = {
      listModelsRaw: async () => ({ stdout: 'opencode/big-pickle\n{"id":"big-pickle","providerID":"opencode","name":"Big Pickle","status":"active","cost":{"input":0,"output":0,"cache":{"read":0,"write":0}}}\n' }),
    };
    const entry = await cat.loadOpenCodeModels(fakeAdapter, { force: true });
    assert.ok(entry.models.some((m) => m.id === 'opencode/big-pickle'));
    assert.ok(!entry.models.some((m) => /paid/i.test(m.id)));
  });
});
