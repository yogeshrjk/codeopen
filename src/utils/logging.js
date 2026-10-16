'use strict';

const SECRET_PATTERNS = [
  /api[_-]?key/i,
  /secret/i,
  /token/i,
  /password/i,
  /OPENCODE_SERVER_PASSWORD/,
  /ANTHROPIC_API_KEY/,
  /OPENAI_API_KEY/,
];

function redactSecrets(value) {
  if (typeof value !== 'string') {
    return value;
  }
  let out = value;
  // Redact KEY=VALUE style pairs for known secret names.
  out = out.replace(/([A-Za-z0-9_$-]*(?:API_KEY|SECRET|TOKEN|PASSWORD)[A-Za-z0-9_$-]*\s*[:=]\s*)([^\s"']+)/gi, '$1[REDACTED]');
  // Redact Bearer tokens.
  out = out.replace(/(Bearer\s+)[A-Za-z0-9\-._~+/=]{8,}/gi, '$1[REDACTED]');
  return out;
}

function createLogger(outputChannel, debugEnabled) {
  function write(level, message, data) {
    const ts = new Date().toISOString();
    let line = `[${ts}] [${level}] ${message}`;
    if (data !== undefined) {
      try {
        line += ' ' + JSON.stringify(data);
      } catch (e) {
        line += ' [unserializable data]';
      }
    }
    const safe = redactSecrets(line);
    if (outputChannel && typeof outputChannel.appendLine === 'function') {
      outputChannel.appendLine(safe);
    } else {
      // Fallback for tests / headless usage.
      if (level === 'ERROR') {
        console.error(safe);
      } else if (debugEnabled || level !== 'DEBUG') {
        console.log(safe);
      }
    }
  }

  return {
    info: (msg, data) => write('INFO', msg, data),
    warn: (msg, data) => write('WARN', msg, data),
    error: (msg, data) => write('ERROR', msg, data),
    debug: (msg, data) => {
      if (debugEnabled || (typeof debugEnabled === 'function' && debugEnabled())) {
        write('DEBUG', msg, data);
      }
    },
  };
}

module.exports = {
  createLogger,
  redactSecrets,
  SECRET_PATTERNS,
};
