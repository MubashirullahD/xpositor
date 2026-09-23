import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSnapshotStore } from '../snapshot.mjs';

const root = mkdtempSync(join(tmpdir(), 'patchwork-snapshot-test-'));
const repo = join(root, 'repo');
mkdirSync(repo);
const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
const write = (name, content) => writeFileSync(join(repo, name), content);
function trySymlink(target, path) {
  try { symlinkSync(target, path); return true; }
  catch (error) {
    if (process.platform === 'win32' && ['EACCES', 'EPERM'].includes(error.code)) return false;
    throw error;
  }
}
try {
  git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  const store = createSnapshotStore(repo);
  write('unborn.js', 'initial\n');
  assert.equal(store.capture().files[0].status, '?');
  git('add', '.'); git('commit', '-qm', 'Initial');
  const awkward = [
    'space name.js', 'unicode-你好.js',
    ...(process.platform === 'win32' ? ['quote-name.js', 'tab-name.js', 'line-break.js'] : ['quote"name.js', 'tab\tname.js', 'line\nbreak.js']),
    'foo-bar.js', 'foo_bar.js',
  ];
  for (const name of awkward) write(name, 'before\n');
  mkdirSync(join(repo, 'tracked-dir')); write('tracked-dir/file.js', 'safe original\n');
  write('delete.js', 'one\ntwo\n'); write('rename.js', 'rename contents\n'); write('binary.bin', Buffer.from([0, 1, 2]));
  git('add', '.'); git('commit', '-qm', 'Fixtures');
  for (const name of awkward) write(name, `after: ${JSON.stringify(name)}\n`);
  rmSync(join(repo, 'delete.js'));
  renameSync(join(repo, 'rename.js'), join(repo, 'renamed file.js')); git('add', '--', 'rename.js', 'renamed file.js');
  write('binary.bin', Buffer.from([0, 5, 6]));
  mkdirSync(join(repo, 'nested')); write('nested/new.js', 'new\n');
  rmSync(join(repo, 'tracked-dir'), { recursive: true });
  mkdirSync(join(root, 'external-dir')); writeFileSync(join(root, 'external-dir/file.js'), 'EXTERNAL_SECRET');
  const directorySymlinkSupported = trySymlink(join(root, 'external-dir'), join(repo, 'tracked-dir'));
  write('bom.txt', '\ufeffpreserve BOM\n');
  write('long.txt', Array.from({ length: 150 }, (_, i) => `line ${i}`).join('\n'));
  writeFileSync(join(root, 'secret'), 'EXTERNAL_SECRET');
  const fileSymlinkSupported = trySymlink(join(root, 'secret'), join(repo, 'link'));
  const first = store.capture();
  assert.equal(new Set(first.files.map((f) => f.id)).size, first.files.length);
  for (const name of awkward) {
    const record = store.getFile(first.snapshotId, { path: name });
    assert.equal(record.source, `after: ${JSON.stringify(name)}\n`);
    assert.deepEqual(record.file.lines.map((line) => line[0]), ['removed', 'added']);
    assert.equal(record.file.added, 1); assert.equal(record.file.removed, 1);
  }
  assert.equal(first.files.find((f) => f.path === 'nested/new.js').added, 1);
  const deleted = first.files.find((f) => f.path === 'delete.js');
  assert.equal(deleted.added, 0); assert.equal(deleted.removed, 2); assert.equal(deleted.sourceAvailable, false);
  const renamed = first.files.find((f) => f.path === 'renamed file.js');
  assert.equal(renamed.oldPath, 'rename.js'); assert.equal(renamed.added, 0); assert.equal(renamed.removed, 0);
  assert.equal(first.files.find((f) => f.path === 'binary.bin').binary, true);
  if (fileSymlinkSupported) assert.equal(store.getFile(first.snapshotId, { path: 'link' }).source, null);
  assert.equal(store.getFile(first.snapshotId, { path: 'tracked-dir/file.js' }).source, null);
  assert.equal(store.getFile(first.snapshotId, { path: 'bom.txt' }).source, '\ufeffpreserve BOM\n');
  assert.equal(store.getFile(first.snapshotId, { path: 'long.txt' }).file.added, 150);
  assert.ok(!JSON.stringify(first).includes('EXTERNAL_SECRET'));
  assert.throws(() => store.getFile(first.snapshotId, { path: '../secret' }), /not part/);
  const oldFile = store.getFile(first.snapshotId, { path: awkward[0] });
  write(awkward[0], 'changed after snapshot\n');
  const second = store.capture();
  assert.equal(store.getFile(first.snapshotId, { path: awkward[0] }).source, oldFile.source);
  assert.notEqual(second.files.find((f) => f.path === awkward[0]).version, oldFile.file.version);
  assert.equal(second.files.find((f) => f.path === awkward[1]).version, first.files.find((f) => f.path === awkward[1]).version);
  assert.throws(() => { first.files[0].path = 'mutated'; }, TypeError);
  assert.throws(() => createSnapshotStore(repo, { maxFileBytes: 1 }).capture(), /limit/);
  const shortCache = createSnapshotStore(repo, { maxSnapshots: 1 });
  const expired = shortCache.capture(); shortCache.capture();
  assert.throws(() => shortCache.get(expired.snapshotId), (error) => error.status === 409);
  git('checkout', '--', 'unborn.js');
  assert.throws(() => createSnapshotStore(root), /Git .*failed/);
  git('config', 'core.repositoryformatversion', '999');
  assert.throws(() => store.capture(), /Git .*failed/);
  console.log(`Snapshot regression checks passed (paths, renames, deletes, binary, ${directorySymlinkSupported && fileSymlinkSupported ? 'links' : 'links skipped (creation unavailable)'}, versions, limits, eviction, Git errors).`);
} finally { rmSync(root, { recursive: true, force: true }); }
