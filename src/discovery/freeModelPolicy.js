'use strict';

/**
 * Fail-closed free-model eligibility.
 * Never infers freeness from names containing free/flash/lite/mini/nano.
 * Requires verified zero input+output price from reliable metadata.
 * Only the `opencode` provider is eligible; openrouter/groq/gemini and any
 * other provider are excluded even when their quoted price is zero.
 */

const OPENCODE_PROVIDER = 'opencode';

const ELIGIBILITY_REASONS = {
  OK: 'verified-free',
  NONZERO_PRICE: 'nonzero-price',
  MISSING_PRICING: 'missing-pricing',
  STALE: 'stale-catalog',
  CONFLICT: 'conflicting-pricing',
  AUTH_PAID: 'paid-auth-required',
  SUBSCRIPTION: 'paid-subscription',
  QUOTA_ONLY: 'free-quota-only',
  UNAVAILABLE: 'provider-unavailable',
  LOCKED: 'locked-or-paid-tier',
  EXCLUDED_PROVIDER: 'excluded-provider',
};

function isFiniteNonNegative(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

/**
 * @param {object} model normalized: { id, provider, displayName, inputPrice, outputPrice,
 *   cacheReadPrice?, cacheWritePrice?, requiresAuth?, authImpliesPaid?, paidSubscription?,
 *   paidCredits?, locked?, availability?, quotaPolicy?, pricingSource?, retrievedAt?, stale? }
 * @returns {{ eligible: boolean, reason: string, detail: string }}
 */
function evaluateOpenCodeModel(model) {
  if (!model || typeof model !== 'object') {
    return { eligible: false, reason: ELIGIBILITY_REASONS.MISSING_PRICING, detail: 'Empty model metadata.' };
  }
  if (model.stale === true) {
    return { eligible: false, reason: ELIGIBILITY_REASONS.STALE, detail: `Catalog entry for ${model.id || '?'} is stale; refresh required.` };
  }
  const { inputPrice, outputPrice } = model;
  if (!isFiniteNonNegative(inputPrice) || !isFiniteNonNegative(outputPrice)) {
    return { eligible: false, reason: ELIGIBILITY_REASONS.MISSING_PRICING, detail: `Missing pricing for ${model.id || '?'}.` };
  }
  if (inputPrice !== 0 || outputPrice !== 0) {
    return {
      eligible: false,
      reason: ELIGIBILITY_REASONS.NONZERO_PRICE,
      detail: `${model.id} costs input=${inputPrice} output=${outputPrice} per 1M tokens; not free.`,
    };
  }
  if (model.conflicting === true) {
    return { eligible: false, reason: ELIGIBILITY_REASONS.CONFLICT, detail: `Conflicting pricing for ${model.id}.` };
  }
  // Cache prices: if present and nonzero, normal usage may bill. Exclude unless explicitly zero/missing.
  if (isFiniteNonNegative(model.cacheReadPrice) && model.cacheReadPrice !== 0) {
    return { eligible: false, reason: ELIGIBILITY_REASONS.NONZERO_PRICE, detail: `${model.id} has nonzero cache-read price.` };
  }
  if (isFiniteNonNegative(model.cacheWritePrice) && model.cacheWritePrice !== 0) {
    return { eligible: false, reason: ELIGIBILITY_REASONS.NONZERO_PRICE, detail: `${model.id} has nonzero cache-write price.` };
  }
  if (model.paidSubscription === true) {
    return { eligible: false, reason: ELIGIBILITY_REASONS.SUBSCRIPTION, detail: `${model.id} requires a paid subscription.` };
  }
  if (model.paidCredits === true) {
    return { eligible: false, reason: ELIGIBILITY_REASONS.SUBSCRIPTION, detail: `${model.id} requires paid credits.` };
  }
  if (model.authImpliesPaid === true) {
    return { eligible: false, reason: ELIGIBILITY_REASONS.AUTH_PAID, detail: `${model.id} requires paid authentication.` };
  }
  if (model.locked === true) {
    return { eligible: false, reason: ELIGIBILITY_REASONS.LOCKED, detail: `${model.id} is locked for the current tier.` };
  }
  if (model.availability === 'unavailable' || model.available === false) {
    return { eligible: false, reason: ELIGIBILITY_REASONS.UNAVAILABLE, detail: `${model.id} is currently unavailable.` };
  }
  if (model.quotaPolicy === 'allowance-then-charge') {
    return { eligible: false, reason: ELIGIBILITY_REASONS.QUOTA_ONLY, detail: `${model.id} is free only within a quota, then charges. Excluded by default.` };
  }
  if (model.providerAvailable === false) {
    return { eligible: false, reason: ELIGIBILITY_REASONS.UNAVAILABLE, detail: `Provider ${model.provider || '?'} is not accessible.` };
  }
  // Opencode provider only: hide openrouter/groq/gemini and any other
  // provider even when their quoted price is zero. Derive from `id`
  // (provider/model) when the normalized `provider` field is missing so
  // legacy entries without it are still gated. Checked last so existing
  // price/auth failure reasons keep their precedence in `excluded[]`.
  let provider = String(model.provider || '').toLowerCase().trim();
  if (!provider && typeof model.id === 'string' && model.id.includes('/')) {
    provider = model.id.split('/')[0].toLowerCase().trim();
  }
  if (provider !== OPENCODE_PROVIDER) {
    return { eligible: false, reason: ELIGIBILITY_REASONS.EXCLUDED_PROVIDER, detail: `Provider ${model.provider || model.id || '?'} excluded; opencode provider only (openrouter/groq/gemini hidden).` };
  }
  return { eligible: true, reason: ELIGIBILITY_REASONS.OK, detail: `Verified zero input/output price from ${model.pricingSource || 'catalog'}.` };
}

function filterEligible(models, evaluator, ...evalArgs) {
  const eligible = [];
  const excluded = [];
  for (const m of models || []) {
    const verdict = evaluator(m, ...evalArgs);
    if (verdict.eligible) {
      eligible.push({ ...m, eligibilityReason: verdict.reason, eligibilityDetail: verdict.detail });
    } else {
      excluded.push({ id: m && m.id, reason: verdict.reason, detail: verdict.detail });
    }
  }
  return { eligible, excluded };
}

module.exports = {
  evaluateOpenCodeModel,
  filterEligible,
  ELIGIBILITY_REASONS,
};
