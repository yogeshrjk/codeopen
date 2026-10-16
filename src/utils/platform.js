'use strict';

const os = require('os');
const path = require('path');

function platformInfo() {
  return {
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    homedir: os.homedir(),
  };
}

function isWindows() {
  return os.platform() === 'win32';
}

function isMacOS() {
  return os.platform() === 'darwin';
}

/**
 * GUI-launched VS Code on macOS often misses brew/npm PATH entries.
 * Return extra dirs to prepend when resolving CLI executables.
 */
function guiPathHints() {
  if (isWindows()) {
    return [
      process.env.APPDATA && path.join(process.env.APPDATA, 'npm'),
      path.join(os.homedir(), 'scoop', 'shims'),
      process.env.ChocolateyInstall && path.join(process.env.ChocolateyInstall, 'bin'),
      path.join(os.homedir(), '.opencode', 'bin'),
    ].filter(Boolean);
  }
  const home = os.homedir();
  const hints = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(home, '.opencode', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.nvm', 'current', 'bin'),
    '/usr/local/share/npm/bin',
  ];
  if (isMacOS()) {
    hints.push('/private/var/root/.opencode/bin');
  }
  return hints;
}

function expandHome(p) {
  if (!p) {
    return p;
  }
  if (p === '~') {
    return os.homedir();
  }
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

function defaultExecutableCandidates(cli) {
  if (cli === 'opencode') {
    const base = ['opencode'];
    if (isWindows()) {
      base.push('opencode.exe', 'opencode.cmd');
    }
    return base;
  }
  return [];
}

module.exports = {
  platformInfo,
  isWindows,
  isMacOS,
  guiPathHints,
  expandHome,
  defaultExecutableCandidates,
};
