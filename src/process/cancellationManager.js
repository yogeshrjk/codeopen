'use strict';

/**
 * Binds a VS Code CancellationToken to a running child process.
 * Prefers graceful SIGTERM, escalates to SIGKILL after a grace period.
 */
class CancellationManager {
  constructor(processManager, logger) {
    this.processManager = processManager;
    this.logger = logger || console;
    this.bindings = new Map();
  }

  bind(token, child, opts) {
    if (!token || !child) {
      return () => {};
    }
    const graceMs = (opts && opts.graceMs) || 3000;
    if (token.isCancellationRequested) {
      this._terminate(child, graceMs);
      return () => {};
    }
    const listener = () => {
      this.logger.info && this.logger.info('Cancellation requested, terminating CLI process');
      this._terminate(child, graceMs);
    };
    const disposable = token.onCancellationRequested ? token.onCancellationRequested(listener) : null;
    const key = `${Date.now()}:${Math.random()}`;
    this.bindings.set(key, disposable);
    return () => {
      try {
        if (disposable && typeof disposable.dispose === 'function') {
          disposable.dispose();
        }
      } catch (e) {
        // ignore
      }
      this.bindings.delete(key);
    };
  }

  _terminate(child, graceMs) {
    try {
      if (child.exitCode !== null) {
        return;
      }
      child.kill('SIGTERM');
    } catch (e) {
      return;
    }
    setTimeout(() => {
      try {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
      } catch (e) {
        // ignore
      }
    }, graceMs).unref?.();
  }

  disposeAll() {
    for (const d of this.bindings.values()) {
      try {
        if (d && typeof d.dispose === 'function') {
          d.dispose();
        }
      } catch (e) {
        // ignore
      }
    }
    this.bindings.clear();
  }
}

module.exports = {
  CancellationManager,
};
