'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseVersion } = require('../src/discovery/cliDetector');
const { detectOne } = require('../src/discovery/cliDetector');

describe('cliDetector.parseVersion', () => {
  it('extracts semver', () => {
    assert.equal(parseVersion('1.18.18'), '1.18.18');
    assert.equal(parseVersion('opencode version 1.18.18\n'), '1.18.18');
    assert.equal(parseVersion('0.0.149'), '0.0.149');
  });
  it('returns null when absent', () => {
    assert.equal(parseVersion(''), null);
    assert.equal(parseVersion('no version here'), null);
  });
});

describe('cliDetector.detectOne (mocked)', () => {
  function fakePM(responses) {
    return {
      run: async (exe, args) => {
        if (exe === 'missing-cli' || String(exe).includes('nonexistent')) {
          const err = new Error(`spawn ${exe} ENOENT`);
          err.code = 'ENOENT';
          throw err;
        }
        if (exe === 'bad-cli') {
          return { code: 1, stdout: '', stderr: 'boom' };
        }
        if (exe === 'old-cli') {
          return { code: 0, stdout: '0.1.0', stderr: '' };
        }
        // Capability probe: for opencode, `models --help` or `models` should
        // return help text mentioning "models" so the probe succeeds.
        if (args && args[0] === 'models') {
          return { code: 0, stdout: 'Usage: opencode models [options]\nList available models.', stderr: '' };
        }
        void args;
        return { code: 0, stdout: responses.version || '1.18.18', stderr: '' };
      },
    };
  }

  it('detects installed CLI with version', async () => {
    const d = await detectOne('opencode', { processManager: fakePM({ version: '1.18.18' }), logger: console, configuredPath: '' });
    assert.equal(d.exists, true);
    assert.equal(d.canStart, true);
    assert.equal(d.compatible, true);
  });

  it('reports missing CLI with install guidance', async () => {
    const d = await detectOne('opencode', { processManager: fakePM({}), logger: console, configuredPath: '/nonexistent/opencode-xyz' });
    // Configured path missing + probe fails => not startable, guidance present
    assert.equal(d.canStart, false);
    assert.ok(d.diagnostics.length > 0);
    assert.ok(d.installDocs);
  });

  it('handles startup failure (bad exit)', async () => {
    const d = await detectOne('opencode', { processManager: fakePM({}), logger: console, configuredPath: '' });
    // PATH search falls back to bare 'opencode' which our fake treats as installed;
    // force the bad path instead:
    const d2 = await detectOne('opencode', { processManager: fakePM({}), logger: console, configuredPath: '' });
    void d;
    void d2;
    const bad = await detectOne('opencode', {
      processManager: { run: async () => ({ code: 1, stdout: '', stderr: 'boom' }) },
      logger: console,
      configuredPath: '/bin/false',
    });
    assert.equal(bad.canStart, false);
  });

  it('detectInstallations returns snapshot for OpenCode', async () => {
    const { detectInstallations } = require('../src/discovery/cliDetector');
    const all = await detectInstallations({ processManager: fakePM({}), logger: console });
    assert.ok(all.opencode, 'OpenCode entry present');
    assert.equal(all.opencode.cli, 'opencode');
  });
});
