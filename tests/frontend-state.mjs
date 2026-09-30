import assert from 'node:assert/strict';
import {
  createBackup,
  emptyState,
  migrateLegacy,
  noteIsCurrent,
  parseBackup,
  reviewKey,
  reviewSummary,
  sanitizeState,
  sessionFor,
  validateSnapshot,
} from '../src/storage.js';
import { escapeHtml, renderMarkdown } from '../src/render.js';
import { highlightLines, languageForPath } from '../src/syntax.js';

assert.equal(languageForPath('src/view.tsx'), 'tsx');
assert.equal(languageForPath('README.md'), 'markdown');
assert.equal(languageForPath('unknown.bin'), '');
const highlighted = highlightLines('const markup = `<img>\n${value}`;\n// done', 'src/view.js');
assert.equal(highlighted.length, 3, 'a multiline token keeps source line numbers aligned');
assert.match(highlighted[0], /class="token keyword">const<\/span>/);
assert.match(highlighted[0], /&lt;img&gt;/);
assert.match(highlighted[1], /class="token template-string"/);
assert.match(highlighted[2], /class="token comment"/);
assert.deepEqual(highlightLines('<img src=x onerror=alert(1)>', 'unknown.bin'), ['&lt;img src=x onerror=alert(1)&gt;']);

const file = {
  id: 'file-1', path: 'src/<img src=x onerror=alert(1)>.js', version: 'revision-a',
  label: '<svg onload=alert(1)>', folder: 'src', lines: [['added', '7', 'const html = "<script>bad()</script>";']],
};
const snapshot = validateSnapshot({
  repoId: 'repo', base: 'empty-tree', head: null, branch: 'main', snapshotId: 'capture-a',
  generatedAt: '2026-09-18T00:00:00.000Z', workspaceName: '<b>unsafe</b>', files: [file],
});

assert.equal(snapshot.head, null, 'unborn repositories have no HEAD');
assert.equal(snapshot.files[0].lines[0][2], 'const html = "<script>bad()</script>";');
assert.equal(escapeHtml(snapshot.files[0].label), '&lt;svg onload=alert(1)&gt;');

const markdown = renderMarkdown('```js\nconst x = "<img src=x onerror=alert(1)>";\nconst y = 2;\n```\n\n[good](https://example.test/path)');
assert.match(markdown, /const x = &quot;&lt;img src=x onerror=alert\(1\)&gt;&quot;;\nconst y = 2;\n/);
assert.doesNotMatch(markdown, /<img /);
assert.match(markdown, /href="https:\/\/example\.test\/path"/);

const revised = { ...snapshot, files: [{ ...snapshot.files[0], version: 'revision-b' }] };
assert.notEqual(reviewKey(snapshot, snapshot.files[0]), reviewKey(revised, revised.files[0]), 'a changed file reopens review');
assert.equal(reviewKey(snapshot, snapshot.files[0]), reviewKey({ ...snapshot, snapshotId: 'capture-b' }, snapshot.files[0]), 'an unchanged file remains reviewed after a fresh capture');

const state = emptyState();
const first = sessionFor(state, snapshot, snapshot.files[0]);
first.draft = 'Why did this change?';
first.chat.push({ role: 'user', text: 'Question' });
first.scroll = { diff: 43, diffX: 187, chat: 12 };
const second = sessionFor(state, { ...snapshot, snapshotId: 'capture-b' }, snapshot.files[0]);
assert.notStrictEqual(first, second, 'drafts, chat, and scroll state are capture scoped');
assert.equal(first.draft, 'Why did this change?');
assert.equal(parseBackup(JSON.stringify(createBackup(state, snapshot))).data.sessions[Object.keys(state.sessions)[0]].scroll.diffX, 187, 'horizontal reader position survives state sanitization');

state.notes.push({ id: 'note-1', repoId: 'repo', base: 'empty-tree', branch: 'main', path: file.path, version: 'revision-a', snapshotId: 'capture-a', text: 'Check escaping', createdAt: '2026-09-18T00:00:00.000Z', status: 'open', start: 7, end: 9, side: 'new' });
assert.ok(noteIsCurrent(state.notes[0], snapshot, snapshot.files[0]));
assert.match(reviewSummary(state, snapshot), /\[open\] Current revision · new lines 7–9: Check escaping/);

const backup = createBackup({ ...state, apiToken: 'must-not-export' }, snapshot);
const backupText = JSON.stringify(backup);
assert.doesNotMatch(backupText, /must-not-export/);
assert.equal(parseBackup(backupText).snapshot.files[0].path, file.path, 'backups retain source snapshot identity');

const migrated = migrateLegacy({ apiToken: 'must-not-export', notes: { old: 'Historical note' } }, snapshot);
assert.equal(migrated.historicalNotes[0].label, 'Legacy note — repository and revision unverified');
assert.deepEqual(sanitizeState({ schema: 2, apiToken: 'must-not-export', reviews: {} }).apiToken, undefined);

console.log('frontend state and rendering tests passed');
assert.equal(emptyState().preferences.wrap,false);
assert.equal(emptyState().preferences.compactContext,true);
assert.equal(emptyState().preferences.mindfulnessDuration,1);
assert.equal(emptyState().preferences.mindfulnessRate,6);
assert.equal(sanitizeState({schema:2,preferences:{mindfulnessDuration:5,mindfulnessRate:8}}).preferences.mindfulnessRate,8);
assert.equal(sanitizeState({schema:2,preferences:{mindfulnessDuration:99,mindfulnessRate:3}}).preferences.mindfulnessDuration,1);
assert.equal(sanitizeState({schema:2}).preferences.wrap,false);
assert.equal(sanitizeState({schema:2,preferences:{wrap:false,compactContext:false}}).preferences.wrap,false);
assert.equal(sanitizeState({schema:2,preferences:{wrap:true}}).preferences.wrap,true);

const workspacePreferences = sanitizeState({ ...emptyState(), preferences: { guideWidth: 470, scope: 'staged' } }).preferences;
assert.equal(workspacePreferences.guideWidth, 470);
assert.equal(workspacePreferences.scope, 'staged');
assert.equal(sanitizeState({ ...emptyState(), preferences: { guideWidth: 1000 } }).preferences.guideWidth, 640);
assert.equal(emptyState().preferences.guideWidth, 640, 'Code Guide opens at its widest by default');
assert.equal(sanitizeState({ schema: 2 }).preferences.guideWidth, 640);
