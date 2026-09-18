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
first.scroll = { diff: 43, chat: 12 };
const second = sessionFor(state, { ...snapshot, snapshotId: 'capture-b' }, snapshot.files[0]);
assert.notStrictEqual(first, second, 'drafts, chat, and scroll state are capture scoped');
assert.equal(first.draft, 'Why did this change?');

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
