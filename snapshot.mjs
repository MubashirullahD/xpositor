import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdtempSync, openSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, relative, resolve, sep } from 'node:path';

export class SnapshotError extends Error {
  constructor(message, status = 500, code = 'SNAPSHOT_ERROR') { super(message); this.status = status; this.code = code; }
}
const hash = (value) => createHash('sha256').update(value).digest('hex');
const decode = (bytes) => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
const defaults = { maxFiles: 2000, maxFileBytes: 2 * 1024 * 1024, maxSnapshotBytes: 16 * 1024 * 1024, maxSnapshots: 8, maxCacheBytes: 64 * 1024 * 1024, maxGitBytes: 32 * 1024 * 1024, maxContextFiles: 10000, maxContextBytes: 32 * 1024 * 1024 };
const inside = (root, path) => { const rel = relative(root, path); return rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep); };
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function textContent(bytes) { if (bytes.includes(0)) return null; try { return decode(bytes); } catch { return null; } }

export function createSnapshotStore(repository, options = {}) {
  const limits = { ...defaults, ...options };
  for (const key of Object.keys(defaults)) if (!Number.isSafeInteger(limits[key]) || limits[key] < 1) throw new SnapshotError(`Invalid snapshot limit: ${key}`, 500);
  const repoRoot = realpathSync(resolve(repository));
  const cache = new Map();
  let cacheBytes = 0;
  function git(args, accepted = [0]) {
    try { return execFileSync('git', ['--no-optional-locks', ...args], { cwd: repoRoot, maxBuffer: limits.maxGitBytes, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1' } }); }
    catch (error) {
      if (accepted.includes(error.status)) return error.stdout || Buffer.alloc(0);
      throw new SnapshotError(`Git ${args[0]} failed: ${String(error.stderr || error.message).trim()}`, 500, 'GIT_FAILED');
    }
  }
  const actualRoot = realpathSync(decode(git(['rev-parse', '--show-toplevel'])).trimEnd());
  const sameRoot = relative(repoRoot, actualRoot) === '' || (() => {
    const requested = statSync(repoRoot);
    const actual = statSync(actualRoot);
    return requested.dev === actual.dev && requested.ino !== 0 && requested.ino === actual.ino;
  })();
  if (!sameRoot) throw new SnapshotError('Choose the Git repository root, not a subdirectory.', 400);
  const repoId = hash(repoRoot);
  function metadata(scope) {
    const head = decode(git(['rev-parse', '--verify', '--quiet', 'HEAD'], [0, 1])).trim() || null;
    const branch = decode(git(['symbolic-ref', '--quiet', '--short', 'HEAD'], [0, 1])).trim() || 'detached HEAD';
    const status = decode(git(['status', '--porcelain=v1', '-z', '--untracked-files=all']));
    const index = decode(git(['ls-files','--stage','-z']));
    const entries = [];
    if (head || scope!=='all') {
      const comparison=scope==='unstaged'?[]:scope==='staged'?['--cached',...(head?[head]:[])]:[head];
      const values = decode(git(['diff', ...comparison, '--name-status', '-z', '--find-renames', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none'])).split('\0');
      for (let i = 0; values[i];) {
        const statusCode = values[i++];
        const first = values[i++];
        const renamed = /^[RC]/.test(statusCode);
        entries.push({ status: statusCode[0], path: renamed ? values[i++] : first, ...(renamed ? { oldPath: first } : {}) });
      }
    }
    const statusValues = status.split('\0');
    for (let i = 0; statusValues[i];) {
      const entry = statusValues[i++];
      const code = entry.slice(0, 2);
      const path = entry.slice(3);
      if (/U/.test(code) || code === 'AA' || code === 'DD') throw new SnapshotError('Resolve Git conflicts before capturing a review snapshot.', 409, 'UNMERGED_FILES');
      if (/[RC]/.test(code)) i++;
      if (scope!=='staged' && (code === '??' || !head&&scope==='all')) {
        if (!entries.some((item) => item.path === path)) entries.push({ path, status: code === '??' ? '?' : 'A' });
      }
    }
    entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    if (entries.length > limits.maxFiles) throw new SnapshotError(`Snapshot exceeds the ${limits.maxFiles} file limit.`, 413, 'SNAPSHOT_LIMIT');
    return { head, branch, status, index, entries };
  }
  function readWorking(path) {
    if (!path || !inside(repoRoot, resolve(repoRoot, path)) || path.split('/').includes('.git')) throw new SnapshotError('Unsafe repository path.', 400, 'UNSAFE_PATH');
    const absolute = resolve(repoRoot, path);
    let cursor = repoRoot;
    const parts = relative(repoRoot, absolute).split(sep);
    for (const part of parts.slice(0, -1)) {
      cursor = join(cursor, part);
      try { if (lstatSync(cursor).isSymbolicLink()) return { bytes: Buffer.alloc(0), mode: 'unsafe', sourceReason: 'Source is unavailable through a symbolic-link directory.' }; }
      catch (error) { if (error.code === 'ENOENT') return { bytes: Buffer.alloc(0), mode: 'missing' }; throw error; }
    }
    try {
      const info = lstatSync(absolute);
      if (info.isSymbolicLink()) return { bytes: Buffer.from(readlinkSync(absolute)), mode: '120000', sourceReason: 'Symbolic link: target contents are never read.' };
      if (!info.isFile()) return { bytes: Buffer.alloc(0), mode: '160000', sourceReason: 'Directory or submodule contents are unavailable.' };
      if (info.size > limits.maxFileBytes) throw new SnapshotError(`${path} exceeds the ${limits.maxFileBytes} byte file limit.`, 413, 'SNAPSHOT_LIMIT');
      if (!inside(repoRoot, realpathSync(absolute))) throw new SnapshotError('Source resolved outside the repository.', 400, 'UNSAFE_PATH');
      const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const opened = fstatSync(fd);
        if (opened.ino !== info.ino || opened.dev !== info.dev) throw new SnapshotError('File changed while capturing the snapshot. Retry refresh.', 409, 'SNAPSHOT_CHANGED');
        const bytes = readFileSync(fd);
        if (bytes.length > limits.maxFileBytes) throw new SnapshotError(`${path} exceeds the file limit.`, 413, 'SNAPSHOT_LIMIT');
        return { bytes, mode: opened.mode & 0o111 ? '100755' : '100644' };
      } finally { closeSync(fd); }
    } catch (error) { if (error.code === 'ENOENT') return { bytes: Buffer.alloc(0), mode: 'missing' }; throw error; }
  }
  function indexFiles(raw) {
    const result=new Map();
    for(const item of raw.split('\0').filter(Boolean)) {
      const tab=item.indexOf('\t');const [mode,oid,stage]=item.slice(0,tab).split(' ');
      if(stage==='0')result.set(item.slice(tab+1),{mode,oid,type:mode==='160000'?'commit':'blob'});
    }
    return result;
  }
  function readBlob(entry,path) {
    if(!entry)return {bytes:Buffer.alloc(0),mode:'missing'};
    if(entry.type!=='blob')return {bytes:Buffer.alloc(0),mode:entry.mode,sourceReason:'Submodule contents are unavailable.'};
    if(Number(decode(git(['cat-file','-s',entry.oid])).trim())>limits.maxFileBytes)throw new SnapshotError(`${path} exceeds the file byte limit.`,413,'SNAPSHOT_LIMIT');
    return {bytes:git(['cat-file','blob',entry.oid]),mode:entry.mode,...(entry.mode==='120000'?{sourceReason:'Symbolic link: target contents are never read.'}:{})};
  }
  function captureState(scope) {
    const meta = metadata(scope);
    const index=indexFiles(meta.index);
    // Capture the entire review context in the same consistency pass as the diff.
    // Only listed paths are exposed to tools; no tool reads the live worktree.
    const ignored = new Set(decode(git(['ls-files', '-ci', '--exclude-standard', '-z'])).split('\0').filter(Boolean));
    const paths = [...new Set([...index.keys(), ...meta.entries.map(entry => entry.path)])].sort();
    if (paths.length > limits.maxContextFiles) throw new SnapshotError(`Repository context exceeds the ${limits.maxContextFiles} file limit.`, 413, 'CONTEXT_LIMIT');
    const context = new Map();
    let contextBytes = 0;
    for (const path of paths) {
      if (ignored.has(path)) { context.set(path, { source: null, reason: 'Ignored file excluded from agent context.' }); continue; }
      let content;
      try { content = scope === 'staged' ? readBlob(index.get(path), path) : readWorking(path); }
      catch (error) {
        if (error.code !== 'SNAPSHOT_LIMIT') throw error;
        context.set(path, { source: null, reason: 'File exceeds the capture byte limit.' }); continue;
      }
      const source = ['100644', '100755'].includes(content.mode) ? textContent(content.bytes) : null;
      const reason = content.sourceReason || (content.mode === 'missing' ? 'File was deleted.' : 'Binary or non-UTF-8 file.');
      contextBytes += source === null ? 0 : Buffer.byteLength(source);
      if (contextBytes > limits.maxContextBytes) throw new SnapshotError('Repository context exceeds the total capture byte limit.', 413, 'CONTEXT_LIMIT');
      context.set(path, { source, ...(source === null ? { reason } : {}), version: hash(content.bytes) });
    }
    let size = 0;
    const working = meta.entries.map((entry) => {
      const content = scope==='staged'?readBlob(index.get(entry.path),entry.path):readWorking(entry.path);
      size += content.bytes.length;
      if (size > limits.maxSnapshotBytes) throw new SnapshotError('Snapshot exceeds the total source byte limit.', 413, 'SNAPSHOT_LIMIT');
      return content;
    });
    const fingerprint = hash(JSON.stringify([meta, [...context], working.map((item) => [item.mode, hash(item.bytes), item.sourceReason])]));
    return { meta, working, context, fingerprint };
  }
  function capture(scope='all', { reuse = false } = {}) {
    if(!['all','staged','unstaged'].includes(scope))throw new SnapshotError('Unknown review scope.',400,'INVALID_SCOPE');
    let state;
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = captureState(scope);
      const after = captureState(scope);
      if (before.fingerprint === after.fingerprint) { state = after; break; }
    }
    if (!state) throw new SnapshotError('Repository changed while capturing the snapshot. Retry refresh.', 409, 'SNAPSHOT_CHANGED');
    if (reuse) {
      for (const record of cache.values()) if (record.snapshot.scope === scope && record.fingerprint === state.fingerprint) return record.snapshot;
    }
    const { meta, working, context } = state;
    const baseFiles = scope==='unstaged'?indexFiles(meta.index):new Map();
    if (meta.head&&scope!=='unstaged') for (const item of decode(git(['ls-tree', '-r', '-z', meta.head])).split('\0').filter(Boolean)) {
      const tab = item.indexOf('\t');
      const [mode, type, oid] = item.slice(0, tab).split(' ');
      baseFiles.set(item.slice(tab + 1), { mode, type, oid });
    }
    let sourceBytes = 0;
    const sources = new Map();
    const temp = mkdtempSync(join(tmpdir(), 'patchwork-diff-'));
    let files;
    try {
      files = meta.entries.map((entry, index) => {
        const current = working[index];
        const base = baseFiles.get(entry.oldPath || entry.path);
        if (base?.type === 'blob' && Number(decode(git(['cat-file', '-s', base.oid])).trim()) > limits.maxFileBytes) throw new SnapshotError(`${entry.path} base exceeds the file byte limit.`, 413, 'SNAPSHOT_LIMIT');
        const previous = base?.type === 'blob' ? git(['cat-file', 'blob', base.oid]) : Buffer.alloc(0);
        if (previous.length > limits.maxFileBytes) throw new SnapshotError(`${entry.path} base exceeds the file byte limit.`, 413, 'SNAPSHOT_LIMIT');
        const source = ['100644', '100755'].includes(current.mode) ? textContent(current.bytes) : null;
        const binary = textContent(previous) === null || (source === null && ['100644', '100755'].includes(current.mode));
        const lines = [];
        let added = 0, removed = 0;
        if (!binary) {
          const oldFile = join(temp, 'before');
          const newFile = join(temp, 'after');
          writeFileSync(oldFile, previous);
          writeFileSync(newFile, current.bytes);
          const diff = decode(git(['diff', '--no-index', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3', '--', oldFile, newFile], [0, 1]));
          let inHunk = false, oldLine = 0, newLine = 0;
          for (const line of diff.split('\n')) {
            const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
            if (match) { oldLine = Number(match[1]); newLine = Number(match[2]); inHunk = true; continue; }
            if (!inHunk) continue;
            if (line.startsWith('+')) { lines.push(['added', String(newLine++), line.slice(1)]); added++; }
            else if (line.startsWith('-')) { lines.push(['removed', String(oldLine++), line.slice(1)]); removed++; }
            else if (line.startsWith(' ')) { lines.push(['normal', String(newLine++), line.slice(1)]); oldLine++; }
          }
        }
        const sourceReason = source !== null ? null : current.sourceReason || (current.mode === 'missing' ? 'File was deleted in this snapshot.' : 'Binary or non-UTF-8 source is unavailable.');
        const type = extname(entry.path).slice(1, 6).toUpperCase() || 'FILE';
        const id = hash(`${repoId}\0${entry.path}`);
        const version = hash(JSON.stringify([entry, base?.mode, hash(previous), current.mode, hash(current.bytes), lines]));
        sources.set(id, source);
        sourceBytes += previous.length + current.bytes.length;
        if (sourceBytes > limits.maxSnapshotBytes) throw new SnapshotError('Snapshot exceeds the total source and base byte limit.', 413, 'SNAPSHOT_LIMIT');
        return { ...entry, id, version, folder: entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : 'root', label: basename(entry.path), type, added, removed, binary, mode: current.mode, sourceAvailable: source !== null, sourceReason, size: `${current.bytes.length} B`, changed: scope==='staged'?'index':'working tree', tone: type === 'MD' ? 'pink' : type === 'CSS' ? 'purple' : 'blue', summary: current.mode === 'missing' ? 'Deleted file' : entry.status === '?' ? 'New untracked file' : entry.status === 'R' ? `Renamed from ${entry.oldPath}` : binary ? 'Binary file changed' : 'Uncommitted working tree changes', lines };
      });
    } finally { rmSync(temp, { recursive: true, force: true }); }
    const snapshot = freeze({ repoId, scope, base: (scope==='all'?'':`${scope}:`)+(meta.head || 'empty-tree'), head: meta.head, branch: meta.branch, snapshotId: randomUUID(), workspaceName: basename(repoRoot), generatedAt: new Date().toISOString(), files });
    const bytes = Buffer.byteLength(JSON.stringify([...context])) + Buffer.byteLength(JSON.stringify(snapshot)) + [...sources.values()].reduce((sum, value) => sum + (value === null ? 0 : Buffer.byteLength(value)), 0);
    if (bytes > limits.maxCacheBytes) throw new SnapshotError('Snapshot exceeds the cache byte limit.', 413, 'SNAPSHOT_LIMIT');
    while (cache.size && (cache.size >= limits.maxSnapshots || cacheBytes + bytes > limits.maxCacheBytes)) { const key = cache.keys().next().value; cacheBytes -= cache.get(key).bytes; cache.delete(key); }
    cache.set(snapshot.snapshotId, { snapshot, sources, context, bytes, fingerprint: state.fingerprint }); cacheBytes += bytes;
    return snapshot;
  }
  function get(snapshotId) {
    if (typeof snapshotId !== 'string' || !snapshotId) throw new SnapshotError('snapshotId is required.', 400, 'SNAPSHOT_REQUIRED');
    if (!cache.has(snapshotId) && options.loadSnapshot) {
      const saved = options.loadSnapshot(snapshotId);
      if (saved) restoreRecord(saved);
    }
    const record = cache.get(snapshotId);
    if (!record) throw new SnapshotError('Snapshot expired or unavailable. Refresh the review.', 409, 'SNAPSHOT_EXPIRED');
    return record.snapshot;
  }
  function getFile(snapshotId, identity = {}) {
    const snapshot = get(snapshotId);
    if ((!identity.id || typeof identity.id !== 'string') && (!identity.path || typeof identity.path !== 'string')) throw new SnapshotError('A file id or exact path is required.', 400, 'FILE_REQUIRED');
    const file = snapshot.files.find((item) => (!identity.id || item.id === identity.id) && (!identity.path || item.path === identity.path));
    if (!file) throw new SnapshotError('File is not part of this snapshot.', 404, 'FILE_NOT_FOUND');
    return { file, source: cache.get(snapshotId).sources.get(file.id) };
  }
  function exportRecord(snapshotId) {
    get(snapshotId);const record=cache.get(snapshotId);
    return {snapshot:record.snapshot,sources:[...record.sources],context:[...record.context],fingerprint:record.fingerprint};
  }
  function restoreRecord(value) {
    if (!value || value.snapshot?.repoId !== repoId || typeof value.snapshot.snapshotId !== 'string' || !Array.isArray(value.snapshot.files) || value.snapshot.files.length > limits.maxFiles || !Array.isArray(value.context) || value.context.length > limits.maxContextFiles || !Array.isArray(value.sources)) throw new SnapshotError('Saved review snapshot is invalid.',500,'SNAPSHOT_STORAGE');
    const bytes=Buffer.byteLength(JSON.stringify(value));
    if(bytes>limits.maxCacheBytes)throw new SnapshotError('Saved review snapshot exceeds the cache limit.',413,'SNAPSHOT_STORAGE');
    for(const entry of value.context) if(!Array.isArray(entry)||typeof entry[0]!=='string'||!entry[1]||(entry[1].source!==null&&typeof entry[1].source!=='string'))throw new SnapshotError('Saved repository context is invalid.',500,'SNAPSHOT_STORAGE');
    const id=value.snapshot.snapshotId;
    if(cache.has(id)){cacheBytes-=cache.get(id).bytes;cache.delete(id);}
    while(cache.size&&(cache.size>=limits.maxSnapshots||cacheBytes+bytes>limits.maxCacheBytes)){const oldest=cache.keys().next().value;cacheBytes-=cache.get(oldest).bytes;cache.delete(oldest);}
    cache.set(id,{snapshot:freeze(value.snapshot),sources:new Map(value.sources),context:new Map(value.context),fingerprint:value.fingerprint,bytes});cacheBytes+=bytes;
    return value.snapshot;
  }
  function getRepository(snapshotId) {
    const snapshot = get(snapshotId);
    const context = cache.get(snapshotId).context;
    const changed = new Map(snapshot.files.map(file => [file.path, file]));
    const manifest = [...context].map(([path, value]) => ({
      path, version: value.version || null, available: value.source !== null,
      lines: value.source === null ? 0 : value.source.split('\n').length,
      bytes: value.source === null ? 0 : Buffer.byteLength(value.source),
      reason: value.reason || null, changed: changed.has(path), fileId: changed.get(path)?.id || null,
    }));
    // Copy values instead of exposing the mutable cache map to consumers.
    return { snapshot, manifest: freeze(manifest), read(path) {
      if (typeof path !== 'string' || !context.has(path)) throw new SnapshotError('Path is not in the captured repository.', 404, 'CONTEXT_PATH');
      return { ...context.get(path) };
    } };
  }
  return { capture, get, getFile, getRepository, exportRecord, restoreRecord, repoId, limits: freeze({ ...limits }) };
}
