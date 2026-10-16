'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyProviderError } = require('../src/adapters/providerError');
const { normalizeEvent } = require('../src/adapters/openCodeAdapter');
test('reads daily free quota errors nested in provider JSON', () => {
  const raw = { type: 'error', error: { name: 'APIError', data: { statusCode: 429, responseBody: JSON.stringify({ error: { message: 'Daily free usage limit reached' } }) } } };
  const error = normalizeEvent(raw);
  assert.equal(error.code, 'E_DAILY_FREE_LIMIT');
  assert.match(error.message, /Daily free limit is reached/);
  assert.equal(classifyProviderError('Free usage exceeded').code, 'E_DAILY_FREE_LIMIT');
  assert.equal(classifyProviderError({ error: { data: { message: 'Requests per day quota exceeded' } } }).code, 'E_DAILY_FREE_LIMIT');
});
test('does not label a temporary 429 or authentication failure as a daily limit', () => {
  assert.equal(classifyProviderError('429 Too many requests').code, 'E_RATE_LIMIT');
  assert.equal(classifyProviderError('Token rate limit exceeded, retry in 10s').code, 'E_RATE_LIMIT');
  assert.equal(classifyProviderError('Invalid API key').code, 'E_PROVIDER');
  assert.equal(classifyProviderError('Connection refused').code, 'E_PROVIDER');
});
