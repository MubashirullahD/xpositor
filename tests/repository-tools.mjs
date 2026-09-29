import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSnapshotStore } from '../snapshot.mjs';
import { buildRepositoryGuidePrompt, validateRepositoryGuide, REPOSITORY_GUIDE_SCHEMA } from '../agent-plan.mjs';
import { createRepositoryTools } from '../repository-tools.mjs';
const repo = mkdtempSync(join(tmpdir(), 'xpositor-repository-'));
const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
const write = (path, content) => writeFileSync(join(repo, path), content);
function trySymlink(target, path) {
  try { symlinkSync(target, path); return true; }
  catch (error) {
    if (process.platform === 'win32' && ['EACCES', 'EPERM'].includes(error.code)) return false;
    throw error;
  }
}
try {
  git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  write('caller.js', 'import { changed } from "./file0.js";\nchanged();\n');
  write('.gitignore', '*.secret\n'); write('token.secret', 'PRIVATE');
  write('large.js', 'long line: ' + 'a'.repeat(30000) + '\nend');
  for (let i = 0; i < 100; i++) write(`file${i}.js`, 'before\n');
  git('add', '.'); git('commit', '-qm', 'Initial');
  for (let i = 0; i < 100; i++) write(`file${i}.js`, 'after\n');
  const symlinkSupported = trySymlink('/etc/passwd', join(repo, 'outside'));
  const changedFiles = 100 + Number(symlinkSupported);
  const store = createSnapshotStore(repo);
  const snapshot = store.capture('all', { reuse: true });
  assert.equal(store.capture('all', { reuse: true }).snapshotId, snapshot.snapshotId);
  const tools = createRepositoryTools(store, snapshot.snapshotId);
  let inventory = [], offset = 0;
  do { const result = tools.call('review_inventory', { offset }); inventory.push(...result.items); offset = result.nextOffset; } while (offset !== null);
  assert.equal(inventory.filter(file => file.changed).length, changedFiles);
  assert(!inventory.some(file => file.path === 'token.secret'));
  assert.equal(tools.call('review_search', { query: 'changed()' }).items[0].path, 'caller.js');
  write('caller.js', 'mutated after snapshot');
  assert.notEqual(store.capture('all', { reuse: true }).snapshotId, snapshot.snapshotId, 'Unchanged context edits must start a new agent snapshot');
  assert.match(tools.call('review_read', { path: 'caller.js' }).text, /changed\(\)/);
  if (symlinkSupported) assert.match(tools.call('review_read', { path: 'outside' }).unavailable, /Symbolic link/);
  for (const path of ['../etc/passwd', '/etc/passwd', '.git/config', 'token.secret']) assert.throws(() => tools.call('review_read', { path }));
  assert.throws(() => tools.call('exec', { command: 'touch evil' }));
  assert.throws(() => tools.call('review_read', { path: 'caller.js', write: 'evil' }));
  assert.equal(tools.coverage().filter(file => file.sourceRead).length, 0);
  for (let i = 0; i < 100; i++) tools.call('review_read', { path: `file${i}.js` });
  assert.equal(tools.coverage().filter(file => file.sourceRead).length, 100);
  let restored = '', next = 0;
  do { const result = tools.call('review_read', { path: 'large.js', offset: next }); restored += result.text; next = result.nextOffset; } while (next !== null);
  assert.equal(restored, 'long line: ' + 'a'.repeat(30000) + '\nend');
  assert.throws(() => tools.call('review_inventory', { offset: -1 }));
  const prompt = buildRepositoryGuidePrompt(tools.repository, 'file0.js');
  assert.match(prompt, new RegExp(`Changed files: ${changedFiles}`));
  assert(Buffer.byteLength(prompt) < 50000, 'Large guide prompts must stay bounded');
  assert.match(prompt, /file0\.js/);
  assert.match(prompt, /after/, 'Small captured diff excerpts are supplied with the inventory');
  assert(!prompt.includes('import { changed }'), 'Unchanged source must still be retrieved on demand');
  const plan = {
    title: 'Understand the change', summary: 'Review the related code together.', assumptions: [symlinkSupported ? 'The symbolic link target is unavailable.' : 'Symlinks could not be created in this environment.'],fileOverviews:[{path:'file0.js',summary:'Change in file0.js.'}],
    steps: [
      { title: 'Code', explanation: 'Follow the unchanged caller into the modified files.', files: Array.from({ length: 100 }, (_, i) => `file${i}.js`), citations: [{ path: 'caller.js', side: 'new', startLine: 1, endLine: 2 }, { path: 'file0.js', side: 'old', startLine: 1, endLine: 1 }] },
      { title: 'Link', explanation: 'Only the link metadata is captured.', files: [symlinkSupported ? 'outside' : 'file99.js'], citations: [] },
    ],
  };
  const validated = validateRepositoryGuide(plan, tools);
  assert.equal(validated.fileOrder.length, changedFiles);
  assert.equal(validated.totalChangedFiles, changedFiles);
  assert.equal(Object.keys(validated.fileOverviews).length,changedFiles);
  assert(!('fileOverviews' in REPOSITORY_GUIDE_SCHEMA.properties), 'The walkthrough must reuse prepared file overviews');
  assert.equal(validated.examinedCount, 100);
  assert.equal(validated.steps[0].citations[0].fileId, null);
  const changedPlan = mutate => { const copy = structuredClone(plan); mutate(copy); return copy; };
  assert.throws(() => validateRepositoryGuide(changedPlan(p => p.steps[0].files.shift()), tools), /omitted 1/);
  const partialOverviews=changedPlan(p => p.fileOverviews=[p.fileOverviews[0]]);
  assert.equal(validateRepositoryGuide(partialOverviews,tools).fileOverviews['file0.js'],'Change in file0.js.');
  assert.match(validateRepositoryGuide(partialOverviews,tools).fileOverviews['file1.js'],/Follow the unchanged caller/);
  const noOverviews=changedPlan(p => delete p.fileOverviews);
  assert.equal(Object.keys(validateRepositoryGuide(noOverviews,tools).fileOverviews).length,changedFiles);
  assert.equal(validateRepositoryGuide(changedPlan(p => p.steps[1].files.push('file0.js')), tools).fileOrder.length, changedFiles);
  assert.throws(() => validateRepositoryGuide(changedPlan(p => { p.steps[0].files[1] = 'file0.js'; }), tools), /more than once within a step/);
  assert.throws(() => validateRepositoryGuide(changedPlan(p => { p.steps[0].files.pop(); p.steps[0].files.push('caller.js'); }), tools), /outside the review scope/);
  assert.throws(() => validateRepositoryGuide(changedPlan(p => p.steps[0].citations[0].endLine = 999), tools), /valid captured line range/);
  assert.throws(() => validateRepositoryGuide(changedPlan(p => p.steps[0].citations[0].path = '../private'), tools), /valid captured line range/);
  if (symlinkSupported) assert.throws(() => validateRepositoryGuide(changedPlan(p => p.steps[0].citations[0].path = 'outside'), tools), /unavailable source/);
  console.log(`Agent plan validation passed: ${changedFiles}-file complete order, unchanged and deleted-line citations, actual read coverage, and omission/duplicate/hallucination rejection.`);
  console.log(`Repository tools passed: 100-file inventory/coverage, unchanged callers, immutable reads, pagination, ignored files, ${symlinkSupported ? 'symlinks' : 'symlinks skipped (creation unavailable)'} and denied writes/out-of-root access.`);
} finally { rmSync(repo, { recursive: true, force: true }); }
