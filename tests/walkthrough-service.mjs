import assert from 'node:assert/strict';
import { GUIDE_SCHEMA } from '../review-guide.mjs';
import { createWalkthroughService } from '../walkthrough-service.mjs';

const files = [
  { id: 'entry', path: 'src/entry.js', version: 'v-entry', status: 'M', sourceAvailable: true, lines: [['added', '1', "import { helper } from './helper.js';"], ['added', '2', 'export const run = () => helper();']] },
  { id: 'helper', path: 'src/helper.js', version: 'v-helper', status: 'M', sourceAvailable: true, lines: [['added', '1', 'export const helper = () => true;']] },
  { id: 'test', path: 'tests/entry.test.js', version: 'v-test', status: 'M', sourceAvailable: true, lines: [['added', '1', "import { run } from '../src/entry.js';"]] },
];
const sources = new Map([
  ['entry', "import { helper } from './helper.js';\nexport const run = () => helper();\n"],
  ['helper', 'export const helper = () => true;\n'],
  ['test', "import { run } from '../src/entry.js';\n"],
]);
const snapshot = { snapshotId: 'snap-1', repoId: 'repo-1', base: 'base', head: 'head', branch: 'guide', generatedAt: '2026-09-18T00:00:00Z', files };
const snapshots = {
  get(id) { assert.equal(id, 'snap-1'); return snapshot; },
  getFile(id, { id: fileId }) { assert.equal(id, 'snap-1'); const file = files.find((item) => item.id === fileId); return { file, source: sources.get(fileId) }; },
};
const guide = {
  title: 'Follow the changed behavior',
  summary: 'The entry point delegates to the helper and a test imports it.',
  assumptions: [],
  steps: [
    { title: 'Intent', explanation: 'The entry imports the helper.', reviewQuestion: 'Is the dependency intended?', citations: [{ fileId: 'entry', startLine: 1, endLine: 1, side: 'new' }] },
    { title: 'Trace', explanation: 'The entry calls the helper.', reviewQuestion: 'Does the return value fit?', citations: [{ fileId: 'entry', startLine: 2, endLine: 2, side: 'new' }, { fileId: 'helper', startLine: 1, endLine: 1, side: 'new' }] },
    { title: 'Verify', explanation: 'The helper returns the traced value.', reviewQuestion: 'Does the helper output fit the caller?', citations: [{ fileId: 'helper', startLine: 1, endLine: 1, side: 'new' }] },
  ],
};

const calls = [];
const ai = {
  async generate(prompt, options) {
    calls.push({ prompt, options });
    return options.jsonSchema
      ? { status: 200, body: { text: JSON.stringify(guide) } }
      : { status: 200, body: { text: 'The helper is called by the entry point.', model: 'fake' } };
  },
};
const service = createWalkthroughService(snapshots, ai);

const created = await service.create({ snapshotId: 'snap-1', selectedId: 'entry', fileIds: ['helper'], depth: 'deep', timeMinutes: 20 });
assert.equal(created.status, 200);
assert.deepEqual(created.body.guide, guide);
assert.deepEqual(created.body.scope.includedPaths, ['src/entry.js', 'src/helper.js']);
assert.equal(created.body.snapshotId, 'snap-1');
assert.equal(calls[0].options.jsonSchema, GUIDE_SCHEMA);
assert.equal(calls[0].options.turnTimeoutMs, 10 * 60_000);
assert.match(calls[0].prompt, /"selectedId":"entry"/);
assert.match(calls[0].prompt, /"id":"helper"/);

const resumed = await service.followup({
  snapshotId: 'snap-1', selectedId: 'entry', fileIds: ['helper'], guide, stepIndex: 0,
  question: 'Show callers more slowly with an example.',
  history: [{ role: 'user', text: 'What does the helper do?' }, { role: 'assistant', text: 'It returns a value.' }],
});
assert.equal(resumed.status, 200);
assert.equal(resumed.body.text, 'The helper is called by the entry point.');
assert.equal(resumed.body.stepIndex, 0);
assert.deepEqual(calls[1].options.history, [{ role: 'user', text: 'What does the helper do?' }, { role: 'assistant', text: 'It returns a value.' }]);
assert.equal(calls[1].options.turnTimeoutMs, 10 * 60_000);
assert.match(calls[1].prompt, /No caller is included in this immutable context/);
assert.match(calls[1].prompt, /illustrative example/);

const hallucinatingAi = { async generate() { return { status: 200, body: { text: JSON.stringify({ ...guide, steps: guide.steps.map((step) => ({ ...step, citations: [{ fileId: 'not-in-context', startLine: 1, endLine: 1, side: 'new' }] })) }) } }; } };
const hallucination = await createWalkthroughService(snapshots, hallucinatingAi).create({ snapshotId: 'snap-1', selectedId: 'entry', fileIds: ['helper'] });
assert.equal(hallucination.status, 502);
assert.equal(hallucination.body.code, 'GUIDE_INVALID_RESPONSE');

const malformedAi = { async generate() { return { status: 200, body: { text: '{not JSON' } }; } };
const malformed = await createWalkthroughService(snapshots, malformedAi).create({ snapshotId: 'snap-1', selectedId: 'entry' });
assert.equal(malformed.status, 502);
assert.equal(malformed.body.code, 'GUIDE_MALFORMED_RESPONSE');

const limitedAi = { async generate() { return { status: 429, body: { error: 'Provider limit reached.' } }; } };
const limited = await createWalkthroughService(snapshots, limitedAi).create({ snapshotId: 'snap-1', selectedId: 'entry' });
assert.deepEqual(limited, { status: 429, body: { error: 'Provider limit reached.' } });
const notes = await service.create({ snapshotId: 'snap-1', selectedId: 'entry', notes: 'private review note' });
assert.equal(notes.status, 400);
assert.equal(calls.length, 2);
const excessiveHistory = await service.followup({ snapshotId: 'snap-1', selectedId: 'entry', guide, stepIndex: 0, question: 'Explain.', history: Array.from({ length: 13 }, () => ({ role: 'user', text: 'x' })) });
assert.equal(excessiveHistory.status, 413);

console.log('Walkthrough service checks passed (context/schema, validated generation, stateless resume, hallucinations, malformed JSON, provider failures, and request limits).');
