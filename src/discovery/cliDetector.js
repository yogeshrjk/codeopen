'use strict';

const fs = require('fs');
const path = require('path');
const { ProcessManager } = require('../process/processManager');
const { guiPathHints, expandHome, defaultExecutableCandidates } = require('../utils/platform');

const OPENCODE_DOCS_URL = 'https://opencode.ai/docs';

function parseVersion(output) {
  if (!output) {
    return null;
  }
  const m = String(output).match(/(\d+\.\d+\.\d+[^ \r\n]*)/);
  return m ? m[1].trim() : null;
}

const CLI_META = {
  opencode: {
    docs: 'https://opencode.ai/docs',
    installHint: 'Install OpenCode: see https://opencode.ai/docs (e.g. npm i -g opencode-ai / brew / curl installer per docs).',
  },
};

function cliDocsUrl(cli) {
  const meta = CLI_META[cli];
  return meta ? meta.docs : OPENCODE_DOCS_URL;
}

function buildSearchPath(extraHints) {
  const current = process.env.PATH || '';
  const sep = process.platform === 'win32' ? ';' : ':';
  const parts = current.split(sep).filter(Boolean);
  const hints = (extraHints || guiPathHints()).filter(Boolean);
  const seen = new Set();
  const merged = [];
  for (const p of [...hints, ...parts]) {
    if (!seen.has(p)) {
      seen.add(p);
      merged.push(p);
    }
  }
  return { merged, sep };
}

async function fileExists(p) {
  try {
    await fs.promises.access(p, fs.constants.X_OK);
    return true;
  } catch (e) {
    try {
      await fs.promises.access(p, fs.constants.F_OK);
      return true;
    } catch (e2) {
      return false;
    }
  }
}

async function resolveExecutable(cli, configuredPath, processManager, logger) {
  // 1. Explicit configured path wins.
  if (configuredPath && configuredPath.trim()) {
    const expanded = expandHome(configuredPath.trim());
    if (await fileExists(expanded)) {
      return { exe: expanded, source: 'config' };
    }
    // Allow bare name in config (e.g. "opencode") to fall through to PATH search.
    if (!expanded.includes(path.sep) && !expanded.includes('/')) {
      // treat as command name
    } else {
      return { exe: expanded, source: 'config', missing: true };
    }
  }
  // 2. Direct lookup via `which`/`where` equivalent: check PATH entries.
  const { merged } = buildSearchPath();
  const candidates = defaultExecutableCandidates(cli);
  const isWin = process.platform === 'win32';
  const extensions = isWin ? ['', '.exe', '.cmd', '.bat'] : [''];
  for (const dir of merged) {
    for (const base of candidates) {
      for (const ext of extensions) {
        const full = path.join(dir, base + ext);
        if (await fileExists(full)) {
          return { exe: full, source: 'path' };
        }
      }
    }
  }
  // 3. Fall back to bare command (let spawn fail with ENOENT diagnostic).
  return { exe: candidates[0], source: 'path-fallback', missing: true };
}

async function probeVersion(exe, versionArgs, processManager) {
  for (const args of versionArgs) {
    try {
      const result = await processManager.run(exe, args, { timeoutMs: 15000 });
      const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
      if (result.code === 0) {
        const version = parseVersion(combined);
        return { ok: true, version, output: combined.slice(0, 2000), args };
      }
      // Some CLIs print version to stderr with non-zero? Treat as diagnostic.
      if (parseVersion(combined)) {
        return { ok: false, version: parseVersion(combined), output: combined.slice(0, 2000), args, code: result.code };
      }
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        return { ok: false, error: 'ENOENT', missing: true };
      }
      // try next arg set
    }
  }
  return { ok: false, error: 'probe-failed' };
}

/**
 * Probe whether a CLI binary supports the subcommands the extension needs:
 *   - `models` (with `--verbose` for opencode)
 *   - `run` (with `--format json`)
 *
 * We run `models --help` (or `models` if --help isn't supported) and check
 * that the output mentions the `models` subcommand. This is a lightweight
 * check that avoids the full `models --verbose` call (which may require auth
 * or take a long time).
 */
async function probeCapability(exe, cli, processManager) {
  // Check `models` subcommand.
  // Try `models --help` first; some CLIs accept it, some don't.
  const helpArgs = ['models', '--help'];
  try {
    const result = await processManager.run(exe, helpArgs, { timeoutMs: 10000 });
    const combined = `${result.stdout || ''}\n${result.stderr || ''}`.toLowerCase();
    // If the CLI recognizes `models` as a subcommand, --help will show usage
    // mentioning "models". If it errors with "unknown option" or "invalid
    // argument", the subcommand isn't supported.
    if (combined.includes('models') && !combined.includes('unknown option') && !combined.includes('invalid')) {
      return { ok: true, detail: 'models subcommand supported' };
    }
    // Some CLIs print "unknown command" or "invalid argument" for unsupported subcommands.
    if (combined.includes('unknown') || combined.includes('invalid') || combined.includes('error:')) {
      return { ok: false, detail: `models subcommand not recognized (output: ${combined.slice(0, 200)})` };
    }
  } catch (err) {
    // Fall through to trying bare `models`
  }

  // Fallback: try bare `models` command (some CLIs don't have --help for subcommands).
  try {
    const result = await processManager.run(exe, ['models'], { timeoutMs: 10000 });
    const combined = `${result.stdout || ''}\n${result.stderr || ''}`.toLowerCase();
    // If `models` is a valid subcommand, it will either produce output or a
    // usage message mentioning "models". If it errors with "unknown command"
    // or "invalid argument", the subcommand isn't supported.
    if (combined.includes('models') && !combined.includes('unknown') && !combined.includes('invalid')) {
      return { ok: true, detail: 'models subcommand supported' };
    }
    if (combined.includes('unknown') || combined.includes('invalid') || combined.includes('error:')) {
      return { ok: false, detail: `models subcommand not recognized (output: ${combined.slice(0, 200)})` };
    }
    // If we got here, the command ran but we couldn't determine support.
    // Be conservative and assume it's not supported.
    return { ok: false, detail: 'could not verify models subcommand support' };
  } catch (err) {
    return { ok: false, detail: `probe failed: ${(err && err.message) || err}` };
  }
}

async function detectOne(cli, options) {
  const opts = options || {};
  const processManager = opts.processManager || new ProcessManager(opts.logger);
  const logger = opts.logger || console;
  const configuredPath = opts.configuredPath || '';

  const resolved = await resolveExecutable(cli, configuredPath, processManager, logger);
  const versionArgs = cli === 'opencode' ? [['--version'], ['--help']] : [['--version'], ['--help']];

  const probe = await probeVersion(resolved.exe, versionArgs, processManager);
  const exists = !probe.missing && !(resolved.missing && probe.error === 'ENOENT');
  const version = probe.version || null;
  // canStart requires both a valid version AND capability to support the
  // subcommands the extension needs (models, run --format json).
  const canStart = (probe.ok || !!probe.version);

  const result = {
    cli,
    exe: resolved.exe,
    exeSource: resolved.source,
    exists,
    canStart,
    exitOk: !!probe.ok,
    version,
    probeArgs: probe.args || null,
    probeOutput: probe.output || null,
    compatible: false,
    authRequired: null,
    diagnostics: [],
  };

  if (resolved.missing && probe.error === 'ENOENT') {
    result.exists = false;
    result.canStart = false;
    result.diagnostics.push(`${cli} executable not found at "${resolved.exe}". Check PATH or set the per-CLI path setting (freecli.opencodePath).`);
    result.installDocs = cliDocsUrl(cli);
    result.installHint = CLI_META[cli] ? CLI_META[cli].installHint : '';
    return result;
  }

  if (!probe.ok && !probe.version) {
    result.diagnostics.push(`${cli} at "${resolved.exe}" did not return a valid version (args tried: ${JSON.stringify(versionArgs)}). Output: ${(probe.output || probe.error || 'none').slice(0, 500)}`);
    result.installDocs = cliDocsUrl(cli);
    return result;
  }

  // Compatibility: any parseable version counts for v1 (no minimum pinned;
  // server/ACP features are intentionally unused — only `run --format json` + `models`).
  // But we must verify the CLI actually supports the required subcommands,
  // otherwise the extension will switch to a CLI that can't list models or run sessions.
  const capabilityProbe = await probeCapability(resolved.exe, cli, processManager);
  if (capabilityProbe.ok) {
    result.compatible = true;
  } else {
    result.compatible = false;
    result.canStart = false;
    const requiredSubcommands = '`models` and `run --format json`';
    result.diagnostics.push(
      `${cli} at "${resolved.exe}" does not support the required subcommands (${capabilityProbe.detail}). ` +
      `The extension needs ${requiredSubcommands} support. ` +
      `See ${cliDocsUrl(cli)} for installation instructions.`
    );
  }
  if (cli === 'opencode' && version) {
    // opencode 1.x verified (1.18.18 tested). Warn on ancient 0.x.
    if (/^0\./.test(version)) {
      result.diagnostics.push(`OpenCode ${version} is very old; please upgrade for stable --format json support.`);
    }
  }
  return result;
}

async function detectInstallations(options) {
  const opts = options || {};
  const opencode = await detectOne('opencode', { ...opts, configuredPath: opts.opencodePath });
  return { opencode };
}

module.exports = {
  detectOne,
  detectInstallations,
  cliDocsUrl,
  CLI_META,
  resolveExecutable,
  parseVersion,
  OPENCODE_DOCS_URL,
};
