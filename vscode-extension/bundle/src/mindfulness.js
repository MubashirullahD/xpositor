export const MINDFULNESS_DURATIONS = [1, 3, 5];
export const MINDFULNESS_RATES = [6, 8, 10];

export function newMindfulnessSession(durationMinutes = 1, breathsPerMinute = 6) {
  return {
    durationMs: (MINDFULNESS_DURATIONS.includes(durationMinutes) ? durationMinutes : 1) * 60000,
    cycleMs: 60000 / (MINDFULNESS_RATES.includes(breathsPerMinute) ? breathsPerMinute : 6),
    elapsedMs: 0,
    startedAt: null,
    status: 'ready',
  };
}

export function mindfulnessProgress(session, now = Date.now()) {
  const elapsedMs = Math.min(session.durationMs, session.elapsedMs + (session.startedAt === null ? 0 : Math.max(0, now - session.startedAt)));
  const remainingMs = Math.max(0, session.durationMs - elapsedMs);
  const phase = elapsedMs % session.cycleMs < session.cycleMs * 0.4 ? 'in' : 'out';
  return { elapsedMs, remainingMs, phase, complete: remainingMs === 0 };
}

export function startMindfulness(session, now = Date.now()) {
  if (session.status === 'complete') return;
  session.startedAt = now;
  session.status = 'running';
}

export function pauseMindfulness(session, now = Date.now()) {
  if (session.status !== 'running') return;
  const progress = mindfulnessProgress(session, now);
  session.elapsedMs = progress.elapsedMs;
  session.startedAt = null;
  session.status = progress.complete ? 'complete' : 'paused';
}
