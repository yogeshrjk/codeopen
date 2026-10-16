'use strict';

const { spawn } = require('child_process');

const DEFAULT_TIMEOUT_MS = 120000;
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

class ProcessManager {
  constructor(logger) {
    this.logger = logger || console;
    this.active = new Map();
    this.nextId = 1;
  }

  /**
   * Spawn with an argument array. Never uses shell:true.
   * Returns { id, child, done } where done resolves { code, signal, stdout, stderr }.
   */
  run(exe, args, options) {
    const opts = options || {};
    const id = this.nextId++;
    const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
    const cwd = opts.cwd;
    const env = opts.env || process.env;

    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn(exe, args, {
          cwd,
          env,
          shell: false,
          windowsHide: true,
          // Non-interactive use only: never inherit or hold open stdin.
          // An open stdin pipe makes `opencode run` block forever waiting
          // for input with zero stdout (observed stall). 'ignore' gives EOF.
          stdio: opts.stdio || ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        reject(err);
        return;
      }
      this.active.set(id, child);

      let stdout = '';
      let stderr = '';
      let truncated = false;
      let timer = null;

      const finish = (code, signal) => {
        if (timer) {
          clearTimeout(timer);
        }
        this.active.delete(id);
        resolve({ code, signal, stdout, stderr, truncated });
      };

      const append = (store, chunk) => {
        let s = store + chunk.toString('utf8');
        if (s.length > MAX_BUFFER_BYTES) {
          truncated = true;
          s = s.slice(-MAX_BUFFER_BYTES);
        }
        return s;
      };

      child.stdout.on('data', (d) => {
        stdout = append(stdout, d);
      });
      child.stderr.on('data', (d) => {
        stderr = append(stderr, d);
      });
      child.on('error', (err) => {
        if (timer) {
          clearTimeout(timer);
        }
        this.active.delete(id);
        reject(err);
      });
      child.on('close', (code, signal) => finish(code, signal));

      if (timeoutMs && timeoutMs > 0) {
        timer = setTimeout(() => {
          this.logger.warn && this.logger.warn(`Process ${id} timed out after ${timeoutMs}ms, terminating`, { exe });
          this.kill(child, 'SIGTERM');
          setTimeout(() => {
            try {
              if (child.exitCode === null && child.signalCode === null) {
                this.kill(child, 'SIGKILL');
              }
            } catch (e) {
              // ignore
            }
          }, 5000).unref?.();
        }, timeoutMs);
        if (timer.unref) {
          timer.unref();
        }
      }
    });
  }

  /**
   * Start a long-lived child and return a handle for streaming.
   * Caller owns stdout parsing and must call dispose().
   */
  startStreaming(exe, args, options) {
    const opts = options || {};
    const child = spawn(exe, args, {
      cwd: opts.cwd,
      env: opts.env || process.env,
      shell: false,
      windowsHide: true,
      // See run(): an open stdin pipe stalls `opencode run` with no output.
      stdio: opts.stdio || ['ignore', 'pipe', 'pipe'],
    });
    const id = this.nextId++;
    this.active.set(id, child);
    const dispose = () => {
      this.active.delete(id);
      try {
        child.removeAllListeners();
      } catch (e) {
        // ignore
      }
    };
    child.on('close', () => {
      this.active.delete(id);
    });
    child.on('error', () => {
      this.active.delete(id);
    });
    return { id, child, dispose };
  }

  kill(childOrId, signal) {
    try {
      const child = typeof childOrId === 'number' ? this.active.get(childOrId) : childOrId;
      if (!child) {
        return false;
      }
      if (child.exitCode !== null) {
        return false;
      }
      child.kill(signal || 'SIGTERM');
      return true;
    } catch (e) {
      return false;
    }
  }

  killAll(signal) {
    for (const [, child] of this.active) {
      try {
        if (child.exitCode === null) {
          child.kill(signal || 'SIGTERM');
        }
      } catch (e) {
        // ignore
      }
    }
    this.active.clear();
  }

  activeCount() {
    return this.active.size;
  }
}

module.exports = {
  ProcessManager,
  DEFAULT_TIMEOUT_MS,
  MAX_BUFFER_BYTES,
};
