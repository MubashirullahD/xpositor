import assert from 'node:assert/strict';
import { newMindfulnessSession, mindfulnessProgress, startMindfulness, pauseMindfulness } from '../src/mindfulness.js';

const session = newMindfulnessSession(1, 6);
assert.equal(session.durationMs, 60000);
assert.equal(session.cycleMs, 10000);
assert.equal(mindfulnessProgress(session, 0).phase, 'in');
startMindfulness(session, 1000);
assert.equal(mindfulnessProgress(session, 5000).phase, 'out');
pauseMindfulness(session, 6000);
assert.equal(mindfulnessProgress(session, 9000).elapsedMs, 5000, 'a paused session does not progress');
startMindfulness(session, 9000);
assert.equal(mindfulnessProgress(session, 14000).elapsedMs, 10000, 'resuming preserves the breath cycle');
pauseMindfulness(session, 64000);
assert.equal(session.status, 'complete');
assert.equal(mindfulnessProgress(session, 65000).remainingMs, 0);
assert.equal(newMindfulnessSession(20, 100).cycleMs, 10000, 'invalid settings use a comfortable default');

console.log('Mindfulness timing passed: phases, pause, resume, completion and setting bounds.');
