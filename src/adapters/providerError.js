'use strict';

// Providers put useful errors in error.data.message or a JSON responseBody,
// and the CLI may exit successfully after emitting an error event.
function errorText(value, depth = 0) {
  if (depth > 6 || value == null) return '';
  if (typeof value === 'string') {
    try { return errorText(JSON.parse(value), depth + 1) || value; } catch (_) { return value; }
  }
  if (typeof value !== 'object') return String(value);
  const fields = ['message', 'error', 'data', 'responseBody', 'body', 'details', 'stderr', 'code', 'name', 'statusCode', 'status'];
  return fields.map((key) => errorText(value[key], depth + 1)).filter(Boolean).join(' · ');
}

function classifyProviderError(value) {
  const raw = errorText(value).replace(/\x1b\[[0-9;]*m/g, '').trim();
  const exhausted = /exceed|exhaust|reached|depleted|used up|too many|insufficient|rate.?limit|quota/i.test(raw);
  const daily = /daily|per.day|requests.per.day|\brpd\b|day.?limit/i.test(raw);
  const freeQuota = /free (?:usage|tier|quota|limit|requests)|free[_-](?:usage|quota|limit)/i.test(raw);
  if (exhausted && (daily || freeQuota)) {
    return {
      code: 'E_DAILY_FREE_LIMIT',
      message: 'Daily free limit is reached. Try again after your provider resets the limit, or select another available free model.',
    };
  }
  if (/\b429\b|rate.?limit|too many requests/i.test(raw)) {
    return { code: 'E_RATE_LIMIT', message: 'The model is temporarily rate limited. Wait a little and try again, or select another free model.' };
  }
  return { code: 'E_PROVIDER', message: raw.slice(0, 1600) || 'OpenCode reported an unknown error.' };
}

module.exports = { errorText, classifyProviderError };
