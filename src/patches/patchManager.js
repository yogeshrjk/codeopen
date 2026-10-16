'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');

const execFileAsync = promisify(execFile);

function sha1(s) {
  return crypto.createHash('sha1').update(s || '', 'utf8').digest('hex');
}

function parseNameStatus(output) {
  const files = [];
  for (const line of String(output || '').split('\n')) {
    const t = line.trim();
    if (!t) {
      continue;
    }
    const m = t.match(/^([AMDTRCU])\s+(.*)$/);
    if (m) {
      const code = m[1];
      files.push({
        path: m[2].trim(),
        status: code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified',
      });
    }
  }
  return files;
}

function parseNumstat(output) {
  let insertions = 0;
  let deletions = 0;
  for (const line of String(output || '').split('\n')) {
    const m = line.match(/^(\d+|-)\s+(\d+|-)\s+/);
    if (m) {
      if (m[1] !== '-') {
        insertions += parseInt(m[1], 10) || 0;
      }
      if (m[2] !== '-') {
        deletions += parseInt(m[2], 10) || 0;
      }
    }
  }
  return { insertions, deletions };
}

const SNAPSHOT_MAX_FILES = 2000;
const SNAPSHOT_MAX_FILE_BYTES = 100 * 1024;
const SNAPSHOT_MAX_TOTAL_BYTES = 500 * 1024;
const SNAPSHOT_SKIP_DIRS = new Set(['.git', 'node_modules']);

function walkFiles(root, out, relDir, budget) {
  const fs = require('fs');
  const path = require('path');
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, relDir), { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const ent of entries) {
    const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      if (!SNAPSHOT_SKIP_DIRS.has(ent.name)) {
        walkFiles(root, out, rel, budget);
      }
    } else if (ent.isFile()) {
      if (out.length >= SNAPSHOT_MAX_FILES || budget.used >= SNAPSHOT_MAX_TOTAL_BYTES) {
        return;
      }
      out.push(rel);
    }
  }
}

/**
 * Minimal line-block diff (common prefix/suffix trim). Good enough for
 * inline display and insertion/deletion counts outside git.
 * Returns { insertions, deletions, text } with ' '/'-'/'+' prefixed lines.
 */
function blockDiff(oldText, newText) {
  const toLines = (t) => {
    const s = String(t === undefined || t === null ? '' : t);
    return s === '' ? [] : s.split('\n');
  };
  const a = toLines(oldText);
  const b = toLines(newText);
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }
  const delLines = a.slice(prefix, a.length - suffix);
  const addLines = b.slice(prefix, b.length - suffix);
  const ranges = (delLines.length > 0 || addLines.length > 0)
    ? [{ oldStart: prefix + 1, oldCount: delLines.length, newStart: prefix + 1, newCount: addLines.length }]
    : [];
  const text = [
    ...a.slice(0, prefix).map((l) => ` ${l}`),
    ...delLines.map((l) => `-${l}`),
    ...addLines.map((l) => `+${l}`),
    ...a.slice(a.length - suffix).map((l) => ` ${l}`),
  ].join('\n');
  return { insertions: addLines.length, deletions: delLines.length, text, ranges };
}

class PatchManager {
  constructor(options) {
    this.options = options || {};
    this.logger = this.options.logger || console;
    this.pending = null;
  }

  async isGitRepo(workspaceRoot) {
    try {
      await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: workspaceRoot, timeout: 10000 });
      return true;
    } catch (e) {
      return false;
    }
  }

  async snapshot(workspaceRoot) {
    const snap = {
      workspaceRoot,
      at: new Date().toISOString(),
      git: false,
      head: null,
      gitStatusOutput: null,
      gitStatusMap: new Map(),
      hashes: new Map(),
      manifest: new Map(),
    };
    try {
      if (await this.isGitRepo(workspaceRoot)) {
        snap.git = true;
        try {
          const head = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: workspaceRoot, timeout: 10000 });
          snap.head = String(head.stdout || '').trim() || null;
        } catch (e) {
          snap.head = null;
        }
        try {
          const statusRes = await execFileAsync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: workspaceRoot, timeout: 15000 });
          const rawStatus = String(statusRes.stdout || '');
          snap.gitStatusOutput = rawStatus;
          const fs = require('fs');
          const path = require('path');
          for (const line of rawStatus.split('\n')) {
            if (!line.trim()) continue;
            let p = line.slice(3).trim();
            if (p.includes(' -> ')) p = p.split(' -> ').pop().trim();
            if (p.startsWith('"') && p.endsWith('"')) {
              try { p = JSON.parse(p); } catch (e) { p = p.slice(1, -1); }
            }
            const abs = path.resolve(workspaceRoot, p);
            let mtimeMs = 0;
            let size = 0;
            let hash = '';
            let content = null;
            try {
              const st = fs.statSync(abs);
              mtimeMs = st.mtimeMs;
              size = st.size;
              if (st.isFile()) {
                content = fs.readFileSync(abs, 'utf8');
                hash = sha1(content);
              }
            } catch (e) {}
            snap.gitStatusMap.set(p, { code: line.slice(0, 2), mtimeMs, size, hash, content });
          }
        } catch (e) {
          snap.gitStatusOutput = null;
        }
      }
    } catch (e) {
      // non-git: manifest only
    }
    // Content manifest (used when git is unavailable or has no commits yet).
    try {
      const fs = require('fs');
      const path = require('path');
      const rels = [];
      walkFiles(workspaceRoot, rels, '', { used: 0 });
      let used = 0;
      for (const rel of rels) {
        let st;
        try {
          st = fs.statSync(path.join(workspaceRoot, rel));
        } catch (e) {
          continue;
        }
        let content = null;
        if (st.size <= SNAPSHOT_MAX_FILE_BYTES && used < SNAPSHOT_MAX_TOTAL_BYTES) {
          try {
            const buf = fs.readFileSync(path.join(workspaceRoot, rel));
            if (!buf.includes(0)) {
              content = buf.toString('utf8');
              used += buf.length;
            }
          } catch (e) {
            content = null;
          }
        }
        snap.manifest.set(rel, { mtimeMs: st.mtimeMs, size: st.size, hash: sha1(content === null ? `${st.mtimeMs}:${st.size}` : content), content });
      }
    } catch (e) {
      // best effort only
    }
    this.lastSnapshot = snap;
    return snap;
  }

  manifestDiff(workspaceRoot, manifest) {
    // Compare a pre-run manifest against the current tree (non-git path).
    const files = [];
    let insertions = 0;
    let deletions = 0;
    try {
      const fs = require('fs');
      const path = require('path');
      const rels = [];
      walkFiles(workspaceRoot, rels, '', { used: 0 });
      const current = new Set(rels);
      const byPath = new Map();
      for (const rel of rels) {
        let st;
        try {
          st = fs.statSync(path.join(workspaceRoot, rel));
        } catch (e) {
          continue;
        }
        let content = null;
        if (st.size <= SNAPSHOT_MAX_FILE_BYTES) {
          try {
            const buf = fs.readFileSync(path.join(workspaceRoot, rel));
            if (!buf.includes(0)) {
              content = buf.toString('utf8');
            }
          } catch (e) {
            content = null;
          }
        }
        byPath.set(rel, { mtimeMs: st.mtimeMs, size: st.size, hash: sha1(content === null ? `${st.mtimeMs}:${st.size}` : content), content });
      }
      for (const [rel, cur] of byPath) {
        const old = manifest ? manifest.get(rel) : undefined;
        if (!old) {
          files.push({ path: rel, status: 'added' });
          if (cur.content !== null) {
            insertions += cur.content.split('\n').length;
          }
        } else if (old.hash !== cur.hash) {
          files.push({ path: rel, status: 'modified' });
          if (old.content !== null && cur.content !== null) {
            const d = blockDiff(old.content, cur.content);
            insertions += d.insertions;
            deletions += d.deletions;
          }
        }
      }
      if (manifest) {
        for (const rel of manifest.keys()) {
          if (!current.has(rel)) {
            const old = manifest.get(rel);
            files.push({ path: rel, status: 'deleted' });
            if (old && old.content !== null) {
              deletions += old.content.split('\n').length;
            }
          }
        }
      }
      void current;
    } catch (err) {
      this.logger.warn && this.logger.warn('manifestDiff failed', { message: (err && err.message) || err });
    }
    return { files, insertions, deletions };
  }

  /**
   * Restore the pre-run snapshot state (non-git undo): rewrite modified and
   * deleted files from stored content, remove added files. Only touches
   * files known to the snapshot; refuses unsafe paths.
   */
  async rollbackSnapshot(workspaceRoot) {
    const snap = this.lastSnapshot;
    const results = { restored: [], skipped: [], errors: [] };
    if (!snap || !snap.manifest) {
      return { ...results, errors: [{ path: '', error: 'No snapshot available.' }] };
    }
    try {
      const fs = require('fs');
      const path = require('path');
      const root = path.resolve(workspaceRoot);
      const rels = [];
      walkFiles(workspaceRoot, rels, '', { used: 0 });
      const current = new Set(rels);
      for (const rel of current) {
        if (!snap.manifest.has(rel)) {
          const abs = path.resolve(root, rel);
          if (!abs.startsWith(root)) {
            results.skipped.push({ path: rel, reason: 'outside workspace' });
            continue;
          }
          try {
            fs.unlinkSync(abs);
            results.restored.push(rel);
          } catch (e) {
            results.errors.push({ path: rel, error: (e && e.message) || String(e) });
          }
        }
      }
      for (const [rel, old] of snap.manifest) {
        const abs = path.resolve(root, rel);
        if (!abs.startsWith(root)) {
          results.skipped.push({ path: rel, reason: 'outside workspace' });
          continue;
        }
        let exists = false;
        try {
          exists = fs.statSync(abs).isFile();
        } catch (e) {
          exists = false;
        }
        if (old.content === null) {
          continue;
        }
        let same = false;
        if (exists) {
          try {
            same = sha1(fs.readFileSync(abs, 'utf8')) === sha1(old.content);
          } catch (e) {
            same = false;
          }
        }
        if (!same) {
          try {
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, old.content, 'utf8');
            results.restored.push(rel);
          } catch (e) {
            results.errors.push({ path: rel, error: (e && e.message) || String(e) });
          }
        }
      }
    } catch (err) {
      results.errors.push({ path: '', error: (err && err.message) || String(err) });
    }
    return results;
  }

  async diffSummary(workspaceRoot, snapshot) {
    try {
      const git = await this.isGitRepo(workspaceRoot);
      if (!git) {
        const snap = snapshot || this.lastSnapshot;
        if (!snap || !snap.manifest) {
          return { files: [], insertions: 0, deletions: 0, git: false, note: 'Not a git repository and no snapshot available.' };
        }
        const m = this.manifestDiff(workspaceRoot, snap.manifest);
        return { ...m, git: false, note: 'Non-git workspace: compared against pre-run snapshot.' };
      }
      const nameStatus = await execFileAsync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: workspaceRoot, timeout: 15000 });
      // Use `git diff` for tracked + `git status` for untracked.
      const diffStat = await execFileAsync('git', ['diff', '--numstat', 'HEAD', '--', '.'], { cwd: workspaceRoot, timeout: 15000 }).catch(() => ({ stdout: '' }));
      let { insertions, deletions } = parseNumstat(diffStat.stdout);
      const files = [];
      for (const line of String(nameStatus.stdout || '').split('\n')) {
        if (!line.trim()) {
          continue;
        }
        const code = line.slice(0, 2);
        let p = line.slice(3).trim();
        // Handle renames "R  old -> new".
        if (p.includes(' -> ')) {
          p = p.split(' -> ').pop().trim();
        }
        // Strip quotes git adds around special paths.
        if (p.startsWith('"') && p.endsWith('"')) {
          try {
            p = JSON.parse(p);
          } catch (e) {
            p = p.slice(1, -1);
          }
        }
        if (code.includes('D')) {
          files.push({ path: p, status: 'deleted' });
        } else if (code.includes('A') || code === '??') {
          files.push({ path: p, status: 'added' });
        } else {
          files.push({ path: p, status: 'modified' });
        }
      }
      if (snapshot && snapshot.gitStatusMap) {
        const fs = require('fs');
        const path = require('path');
        const reqFiles = [];
        let reqInsertions = 0;
        let reqDeletions = 0;
        for (const f of files) {
          const rel = f.path;
          const pre = snapshot.gitStatusMap.get(rel);
          const abs = path.resolve(workspaceRoot, rel);
          let exists = false;
          let curContent = null;
          try {
            const st = fs.statSync(abs);
            exists = st.isFile();
            if (exists) {
              curContent = fs.readFileSync(abs, 'utf8');
            }
          } catch (e) {
            exists = false;
          }

          if (f.status === 'deleted') {
            if (!pre || !pre.code.includes('D')) {
              reqFiles.push(f);
              if (pre && pre.content !== null && pre.content !== undefined) {
                reqDeletions += pre.content.split('\n').length;
              }
            }
          } else if (!pre) {
            reqFiles.push(f);
            if (curContent !== null) {
              reqInsertions += curContent.split('\n').length;
            }
          } else {
            const curHash = curContent !== null ? sha1(curContent) : '';
            if (curHash && curHash !== pre.hash) {
              // The file existed before this run (pre-run snapshot has it),
              // so even when git reports Added (unborn HEAD reports every
              // staged path as A/AM) this is a modification with minimal
              // line hunks — not a whole-file addition. Without this the
              // diff renders left-empty and the entire right side green.
              reqFiles.push({ path: rel, status: 'modified' });
              if (pre.content !== null && curContent !== null) {
                const d = blockDiff(pre.content, curContent);
                reqInsertions += d.insertions;
                reqDeletions += d.deletions;
              }
            }
          }
        }
        files.length = 0;
        files.push(...reqFiles);
        insertions = reqInsertions;
        deletions = reqDeletions;
      } else if (snapshot && snapshot.manifest && snapshot.manifest.size > 0) {
        const fs = require('fs');
        const path = require('path');
        const reqFiles = [];
        let reqInsertions = 0;
        let reqDeletions = 0;
        for (const f of files) {
          const rel = f.path;
          const old = snapshot.manifest.get(rel);
          const abs = path.resolve(workspaceRoot, rel);
          let exists = false;
          let st = null;
          try {
            st = fs.statSync(abs);
            exists = st.isFile();
          } catch (e) {
            exists = false;
          }

          if (f.status === 'deleted') {
            if (old) {
              reqFiles.push(f);
              const delLines = (old.content !== null && old.content !== undefined) ? old.content.split('\n').length : 0;
              reqDeletions += delLines;
            }
          } else if (f.status === 'added') {
            if (!old) {
              reqFiles.push(f);
              if (exists) {
                try {
                  const content = fs.readFileSync(abs, 'utf8');
                  reqInsertions += content ? content.split('\n').length : 0;
                } catch (e) {}
              }
            } else if (exists) {
              let curContent = null;
              try {
                curContent = fs.readFileSync(abs, 'utf8');
              } catch (e) {}
              const curHash = curContent !== null ? sha1(curContent) : `${st.mtimeMs}:${st.size}`;
              if (curHash !== old.hash) {
                reqFiles.push({ path: rel, status: 'modified' });
                if (old.content !== null && curContent !== null) {
                  const d = blockDiff(old.content, curContent);
                  reqInsertions += d.insertions;
                  reqDeletions += d.deletions;
                }
              }
            }
          } else {
            if (!old) {
              reqFiles.push(f);
            } else if (exists) {
              let curContent = null;
              try {
                curContent = fs.readFileSync(abs, 'utf8');
              } catch (e) {}
              const curHash = curContent !== null ? sha1(curContent) : `${st.mtimeMs}:${st.size}`;
              if (curHash !== old.hash) {
                reqFiles.push(f);
                if (old.content !== null && curContent !== null) {
                  const d = blockDiff(old.content, curContent);
                  reqInsertions += d.insertions;
                  reqDeletions += d.deletions;
                }
              }
            }
          }
        }
        files.length = 0;
        files.push(...reqFiles);
        insertions = reqInsertions;
        deletions = reqDeletions;
      }
      return { files, insertions, deletions, git: true };
    } catch (err) {
      this.logger.warn && this.logger.warn('diffSummary failed', { message: (err && err.message) || err });
      return { files: [], insertions: 0, deletions: 0, git: false, error: (err && err.message) || String(err) };
    }
  }

  /**
   * Per-file hunk ranges + insertion/deletion counts for Copilot-style
   * file rows (`path  L10–15  +24 −8`). Git when available, pre-run
   * snapshot content otherwise. Capped; never throws.
   */
  async fileHunks(workspaceRoot, files, opts) {
    const o = opts || {};
    const maxFiles = o.maxFiles || 20;
    const out = [];
    try {
      const path = require('path');
      const fs = require('fs');
      const { isInsideWorkspace } = require('./patchValidator');
      const isGit = await this.isGitRepo(workspaceRoot);
      let hasHead = false;
      if (isGit) {
        try {
          await execFileAsync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: workspaceRoot, timeout: 10000 });
          hasHead = true;
        } catch (e) {
          hasHead = false;
        }
      }
      const snapManifest = this.lastSnapshot && this.lastSnapshot.manifest;
      const snapStatusMap = this.lastSnapshot && this.lastSnapshot.gitStatusMap;
      const readCurrent = (rel) => {
        try {
          return fs.readFileSync(path.resolve(workspaceRoot, rel), 'utf8');
        } catch (e) {
          return null;
        }
      };
      const readStaged = async (rel) => {
        if (!isGit) {
          return null;
        }
        try {
          const r = await execFileAsync('git', ['show', `:./${rel}`], { cwd: workspaceRoot, timeout: 15000 });
          return r.stdout !== undefined ? String(r.stdout) : null;
        } catch (e) {
          return null;
        }
      };
      const snapshotOldText = (rel) => {
        try {
          if (snapManifest && typeof snapManifest.get === 'function' && snapManifest.has(rel)) {
            const old = snapManifest.get(rel);
            if (old && old.content !== null && old.content !== undefined) {
              return String(old.content);
            }
            // Entry exists but content was skipped (large/binary): treat as
            // unknown rather than empty so callers can try staged next.
            if (old) {
              return null;
            }
          }
        } catch (e) {
          // ignore
        }
        try {
          if (snapStatusMap && typeof snapStatusMap.get === 'function' && snapStatusMap.has(rel)) {
            const pre = snapStatusMap.get(rel);
            if (pre && typeof pre.content === 'string') {
              return pre.content;
            }
          }
        } catch (e) {
          // ignore
        }
        return null;
      };
      for (const f of (files || []).slice(0, maxFiles)) {
        const rel = f.path || f;
        if (!rel || !isInsideWorkspace(workspaceRoot, rel)) {
          continue;
        }
        let status = f.status || 'modified';
        let insertions = 0;
        let deletions = 0;
        let ranges = [];
        try {
          if (isGit && hasHead && status !== 'added') {
            const r = await execFileAsync('git', ['diff', '-U0', '--no-color', '--no-ext-diff', 'HEAD', '--', rel], { cwd: workspaceRoot, timeout: 15000 });
            for (const line of String(r.stdout || '').split('\n')) {
              const h = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
              if (h) {
                ranges.push({
                  oldStart: parseInt(h[1], 10),
                  oldCount: h[2] === undefined ? 1 : parseInt(h[2], 10),
                  newStart: parseInt(h[3], 10),
                  newCount: h[4] === undefined ? 1 : parseInt(h[4], 10),
                });
              } else if (/^\+/.test(line) && !/^\+\+\+/.test(line)) {
                insertions++;
              } else if (/^-/.test(line) && !/^---/.test(line)) {
                deletions++;
              }
            }
          } else {
            // No HEAD (unborn repo) or a file git calls Added: resolve the
            // pre-run text from the snapshot first, then the staged index.
            // Only files with no pre-run text anywhere are truly Added
            // (whole-file green). Pre-existing files get a minimal
            // prefix/suffix-trimmed hunk so only changed lines highlight.
            let oldText = snapshotOldText(rel);
            if (oldText === null) {
              oldText = await readStaged(rel);
            }
            const cur = readCurrent(rel);
            if (oldText === null || oldText === undefined) {
              // Truly new on this run: whole file is the addition.
              status = cur === null ? 'deleted' : 'added';
              if (cur !== null) {
                const n = cur.split('\n').length;
                insertions = n;
                ranges = [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: n }];
              }
            } else if (cur === null) {
              status = 'deleted';
              const n = oldText === '' ? 0 : oldText.split('\n').length;
              deletions = n;
              ranges = [{ oldStart: 1, oldCount: n, newStart: 0, newCount: 0 }];
            } else if (oldText !== cur) {
              // Existed before the run: report Modified even if git's
              // status letter says Added (unborn HEAD marks every staged
              // path Added). This keeps the diff left side populated.
              status = 'modified';
              const d = blockDiff(oldText, cur);
              insertions = d.insertions;
              deletions = d.deletions;
              ranges = d.ranges;
            } else {
              status = 'modified';
            }
          }
        } catch (e) {
          // keep zeros; file row still lists the path
        }
        out.push({ path: rel, status, insertions, deletions, ranges });
      }
    } catch (err) {
      this.logger.warn && this.logger.warn('fileHunks failed', { message: (err && err.message) || err });
    }
    return out;
  }

  setPending(patch) {
    this.pending = patch;
    if (patch && patch.patchId) {
      this.savePatch(patch.patchId, patch);
    }
  }

  savePatch(patchId, patch) {
    if (!this.savedPatches) {
      this.savedPatches = new Map();
    }
    this.savedPatches.set(patchId, patch);
  }

  getPatch(patchId) {
    if (this.pending && this.pending.patchId === patchId) {
      return this.pending;
    }
    if (this.savedPatches && this.savedPatches.has(patchId)) {
      return this.savedPatches.get(patchId);
    }
    return null;
  }

  getPending() {
    return this.pending;
  }

  clearPending() {
    if (this.pending) {
      this.pending.resolved = true;
    }
    this.pending = null;
    this.lastSnapshot = null;
  }
}

module.exports = {
  PatchManager,
  parseNameStatus,
  parseNumstat,
  blockDiff,
  sha1,
};
