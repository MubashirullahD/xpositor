import assert from 'node:assert/strict';
import { buildGuideContext, buildGuidePrompt, buildStepPrompt, GUIDE_SCHEMA, validateGuide } from '../review-guide.mjs';

function changedFile(id, path, lines, extra = {}) {
  return { id, path, version: `version-${id}`, status: 'M', sourceAvailable: true, lines, ...extra };
}

function createStore(files, sources) {
  const snapshot = { snapshotId: 'snapshot-1', repoId: 'repo-1', base: 'base', head: 'head', branch: 'feature/guide', generatedAt: '2026-09-18T00:00:00.000Z', files };
  return {
    get(id) { assert.equal(id, snapshot.snapshotId); return snapshot; },
    getFile(id, { id: fileId }) {
      assert.equal(id, snapshot.snapshotId);
      const file = files.find((item) => item.id === fileId);
      if (!file) throw new Error('unexpected file lookup');
      return { file, source: sources.get(fileId) };
    },
  };
}

const files = [
  changedFile('main', 'app/main.js', [['normal', '1', "import { work } from './util.js';"], ['added', '2', 'export const run = () => work();']]),
  changedFile('util', 'app/util.js', [['added', '1', 'export const work = () => true;']]),
  changedFile('test', 'tests/main.test.js', [['added', '1', "import { run } from '../app/main.js';"], ['added', '2', 'assert.equal(run(), true);']]),
  changedFile('nearby', 'app/readme.md', [['added', '1', 'Changed behavior notes.']]),
  changedFile('deleted', 'app/old.js', [['removed', '7', 'export const legacy = true;']], { status: 'D', sourceAvailable: false, sourceReason: 'File was deleted in this snapshot.' }),
  changedFile('link', 'app/link.js', [['added', '1', '../outside']], { sourceAvailable: false, sourceReason: 'Symbolic link: target contents are never read.' }),
];
const sources = new Map([
  ['main', "import { work } from './util.js';\nexport const run = () => work();\n"],
  ['util', 'export const work = () => true;\n'],
  ['test', "import { run } from '../app/main.js';\nassert.equal(run(), true);\n"],
  ['nearby', 'Changed behavior notes.\n'],
  ['deleted', null],
  ['link', null],
]);
const store = createStore(files, sources);

const context = buildGuideContext(store, 'snapshot-1', 'main');
assert.deepEqual(context.files.slice(0, 3).map((file) => file.id), ['main', 'util', 'test']);
assert.equal(context.scope.includedCount, 6);
assert.equal(context.scope.excludedCount, 0);
assert.match(context.files.find((file) => file.id === 'main').source, /^1 \| import/m);
assert.deepEqual(context.files.find((file) => file.id === 'main').diffLines[0], { kind: 'normal', side: 'new', line: 1, text: "import { work } from './util.js';" });

const validGuide = {
  title: 'Trace the review change',
  summary: 'The entry point delegates work to a changed helper and test.',
  assumptions: ['The changed files are intended to work together.'],
  steps: [
    { title: 'Intent', explanation: 'The entry point imports the helper.', reviewQuestion: 'Does this dependency belong here?', citations: [{ fileId: 'main', startLine: 1, endLine: 1, side: 'new' }] },
    { title: 'Trace', explanation: 'The entry point calls the helper.', reviewQuestion: 'Does the return value match the caller?', citations: [{ fileId: 'main', startLine: 2, endLine: 2, side: 'new' }, { fileId: 'util', startLine: 1, endLine: 1, side: 'new' }] },
    { title: 'Verify', explanation: 'The changed test imports the entry point.', reviewQuestion: 'Does this cover the intended path?', citations: [{ fileId: 'test', startLine: 1, endLine: 2, side: 'new' }] },
  ],
};
assert.deepEqual(validateGuide(validGuide, context), validGuide);
assert.ok(Object.isFrozen(validateGuide(validGuide, context)));
assert.equal(GUIDE_SCHEMA.properties.steps.minItems, 3);
assert.match(buildGuidePrompt(context, { depth: 'deep', timeMinutes: 20 }), /immutable snapshot context/);
const callerPrompt = buildStepPrompt(context, validGuide, 1, 'Show callers more slowly with an example.');
assert.match(callerPrompt, /tests\/main\.test\.js/);
assert.match(callerPrompt, /illustrative example/);

assert.throws(() => validateGuide({ ...validGuide, steps: [{ ...validGuide.steps[0], citations: [{ fileId: 'made-up', startLine: 1, endLine: 1, side: 'new' }] }, ...validGuide.steps.slice(1)] }, context), (error) => error.status === 422 && /outside/.test(error.message));
assert.throws(() => validateGuide({ ...validGuide, steps: [{ ...validGuide.steps[0], citations: [{ fileId: 'main', startLine: 99, endLine: 99, side: 'new' }] }, ...validGuide.steps.slice(1)] }, context), (error) => error.status === 422 && /unavailable/.test(error.message));

const deletedContext = buildGuideContext(store, 'snapshot-1', 'deleted', ['deleted']);
const oldGuide = { ...validGuide, steps: validGuide.steps.map((step) => ({ ...step, citations: [{ fileId: 'deleted', startLine: 7, endLine: 7, side: 'old' }] })) };
assert.equal(validateGuide(oldGuide, deletedContext).steps[0].citations[0].side, 'old');
const linkContext = buildGuideContext(store, 'snapshot-1', 'link', ['link']);
const linkGuide = { ...validGuide, steps: validGuide.steps.map((step) => ({ ...step, citations: [{ fileId: 'link', startLine: 1, endLine: 1, side: 'new' }] })) };
assert.equal(validateGuide(linkGuide, linkContext).steps[0].citations[0].fileId, 'link');
assert.match(buildStepPrompt(linkContext, linkGuide, 0, 'Show callers.'), /No caller is included in this immutable context/);

assert.throws(() => buildGuideContext(store, 'snapshot-1', 'main', Array.from({ length: 13 }, () => 'main')), (error) => error.status === 413 && /at most 12/.test(error.message));
assert.throws(() => buildGuideContext(store, 'snapshot-1', 'main', ['not-a-snapshot-file']), (error) => error.status === 400 && /not part/.test(error.message));
const oversized = createStore([changedFile('large', 'large.js', [['added', '1', 'x']])], new Map([['large', 'x'.repeat(260 * 1024)]]));
assert.throws(() => buildGuideContext(oversized, 'snapshot-1', 'large', ['large']), (error) => error.status === 413 && /did not trim/.test(error.message));
const manyFiles = Array.from({ length: 10 }, (_, index) => changedFile(`many-${index}`, `app/many-${index}.js`, [['added', '1', `export const value${index} = ${index};`]]));
const manySources = new Map(manyFiles.map((file, index) => [file.id, `export const value${index} = ${index};\n`]));
const limitedContext = buildGuideContext(createStore(manyFiles, manySources), 'snapshot-1', 'many-0');
assert.equal(limitedContext.scope.includedCount, 8);
assert.equal(limitedContext.scope.excludedCount, 2);

console.log('Review guide checks passed (scope, import/test grouping, immutable source, deletion/link citations, limits, and prompts).');
