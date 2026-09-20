import { createHash } from 'node:crypto';
import { GuideError } from './review-guide.mjs';

// A run belongs to the companion, not to an individual HTTP connection. Closing
// a phone tab must only stop observing it; cancellation is an explicit action.
export function createGuideRuns({ maxRuns = 24, maxReplyBytes = 256 * 1024 } = {}) {
  if (!Number.isSafeInteger(maxRuns) || maxRuns < 1 || !Number.isSafeInteger(maxReplyBytes) || maxReplyBytes < 1) throw new TypeError('Run limits must be positive integers.');
  const runs = new Map();
  function find(id) {
    const run = runs.get(id);
    if (!run) throw new GuideError('This guide run is no longer available.', 404, 'GUIDE_RUN_MISSING');
    return run;
  }
  function view(run) {
    return structuredClone({ id: run.id, snapshotId: run.input.snapshotId, conversationId: run.input.conversationId,
      revision: run.revision, status: run.status, text: run.text, activity: run.activity,
      result: run.result, error: run.error, createdAt: run.createdAt, finishedAt: run.finishedAt });
  }
  function notify(run) {
    run.revision++;
    for (const listener of [...run.listeners]) {
      try { listener(view(run)); } catch { run.listeners.delete(listener); }
    }
  }
  function start(id, input, execute) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(id)) throw new GuideError('A stable request ID is required.', 400, 'GUIDE_RUN_ID');
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.snapshotId !== 'string' || !input.snapshotId || typeof input.conversationId !== 'string' || !input.conversationId) throw new GuideError('Snapshot and conversation identity are required.', 400, 'GUIDE_RUN_INPUT');
    const serialized = JSON.stringify(input);
    if (Buffer.byteLength(serialized) > 64 * 1024) throw new GuideError('Guide request is too large.', 413, 'GUIDE_RUN_LIMIT');
    const fingerprint = createHash('sha256').update(serialized).digest('hex');
    const previous = runs.get(id);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new GuideError('This request ID belongs to a different question or snapshot.', 409, 'GUIDE_RUN_CONFLICT');
      return view(previous);
    }
    if (typeof execute !== 'function') throw new TypeError('A guide executor is required.');
    if ([...runs.values()].some(run => run.status === 'running' || run.status === 'stopping')) throw new GuideError('Another guide response is running. Wait or stop it first.', 429, 'GUIDE_RUN_BUSY');
    while (runs.size >= maxRuns) runs.delete(runs.keys().next().value);
    const run = { id, fingerprint, input: JSON.parse(serialized), status: 'running', revision: 1,
      text: '', activity: null, result: null, error: null, createdAt: new Date().toISOString(), finishedAt: null,
      controller: new AbortController(), listeners: new Set(), failure: null };
    runs.set(id, run);
    run.completion = Promise.resolve().then(async () => {
      try {
        if (run.controller.signal.aborted) throw new Error('Stopped.');
        const result = await execute(run.input, {
          signal: run.controller.signal,
          onDelta(text) {
            if (run.controller.signal.aborted) return;
            if (typeof text !== 'string') throw new TypeError('Guide delta must be text.');
            if (Buffer.byteLength(run.text) + Buffer.byteLength(text) > maxReplyBytes) {
              run.failure = 'The guide response exceeded its size limit.';
              run.controller.abort(); throw new Error(run.failure);
            }
            run.text += text; notify(run);
          },
          onActivity(activity) {
            if (run.controller.signal.aborted) return;
            run.activity = { tool: String(activity?.tool || '').slice(0, 100), path: typeof activity?.path === 'string' ? activity.path.slice(0, 4096) : null };
            notify(run);
          },
        });
        if (run.failure) throw new Error(run.failure);
        if (run.controller.signal.aborted) run.status = 'cancelled';
        else {
          if (Buffer.byteLength(JSON.stringify(result ?? null)) > maxReplyBytes) throw new Error('The guide result exceeded its size limit.');
          run.result = structuredClone(result ?? null); run.status = 'completed';
        }
      } catch (error) {
        run.status = run.controller.signal.aborted && !run.failure ? 'cancelled' : 'failed';
        run.error = run.status === 'cancelled' ? 'Stopped.' : String(run.failure || error.message || 'Guide failed.').slice(0, 2000);
      } finally {
        run.finishedAt = new Date().toISOString(); run.activity = null; notify(run); run.listeners.clear();
      }
      return view(run);
    });
    return view(run);
  }
  function subscribe(id, listener) {
    if (typeof listener !== 'function') throw new TypeError('A listener is required.');
    const run = find(id);
    listener(view(run));
    if (['running', 'stopping'].includes(run.status)) run.listeners.add(listener);
    return () => run.listeners.delete(listener);
  }
  function cancel(id) {
    const run = find(id);
    if (run.status === 'running') { run.status = 'stopping'; run.controller.abort(); notify(run); }
    return view(run);
  }
  return { start, subscribe, cancel,
    get(id, afterRevision) { const run = find(id); return run.revision === afterRevision ? null : view(run); },
    wait(id) { return find(id).completion; },
    close() { for (const run of runs.values()) if (run.status === 'running') cancel(run.id); },
  };
}
