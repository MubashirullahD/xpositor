import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aiLogEnabled, loggedTools, startAiLog } from '../ai-log.mjs';

const dir = await mkdtemp(join(tmpdir(), 'xpositor-ai-log-'));
try {
  assert.equal(aiLogEnabled({}), false, 'AI logging must be off by default.');
  assert.equal(aiLogEnabled({ XPOSITOR_AI_LOG: 'false' }), false);
  assert.equal(startAiLog({ purpose: 'x' }, { XPOSITOR_AI_LOG_DIR: dir }), null);
  assert.deepEqual(await readdir(dir), [], 'Nothing is written while logging is off.');

  const env = { XPOSITOR_AI_LOG: '1', XPOSITOR_AI_LOG_DIR: dir };
  const log = startAiLog({ purpose: 'Lesson chapter 1', provider: 'claude', prompt: 'Teach this.' }, env);
  assert.match(log.file, /lesson-chapter-1-[0-9a-f]{6}\.jsonl$/);
  const tools = loggedTools({ definitions: [], coverage: () => 'shared', call(name, args) { if (name === 'bad') throw new Error('denied'); return { path: args.path, text: 'abc', nextOffset: null }; } }, log);
  assert.deepEqual(tools.call('review_read', { path: 'a.js' }), { path: 'a.js', text: 'abc', nextOffset: null });
  assert.throws(() => tools.call('bad', {}), /denied/);
  assert.equal(tools.coverage(), 'shared', 'Wrapped tools keep the original coverage.');
  log.end({ status: 200, text: 'Lesson' });

  const events = (await readFile(log.file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(events.map(event => event.type), ['start', 'tool', 'tool', 'end']);
  assert.equal(events[0].prompt, 'Teach this.');
  assert.deepEqual([events[1].name, events[1].args.path, events[1].ok, events[1].bytes], ['review_read', 'a.js', true, Buffer.byteLength(JSON.stringify({ path: 'a.js', text: 'abc', nextOffset: null }))]);
  assert.deepEqual([events[2].ok, events[2].error], [false, 'denied']);
  assert.equal(events[3].text, 'Lesson');
  // Windows has no POSIX permission bits; its files report 0o666 regardless.
  if (process.platform !== 'win32') assert.equal((await stat(log.file)).mode & 0o777, 0o600, 'Logs contain code and must be private.');
  console.log('AI log passed: off by default, private JSONL per request, prompt, tool calls, errors and answer.');
} finally { await rm(dir, { recursive: true, force: true }); }
