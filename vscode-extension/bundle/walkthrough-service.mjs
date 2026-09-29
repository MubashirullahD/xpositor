import { GUIDE_SCHEMA, GuideError, buildGuideContext, buildGuidePrompt, buildStepPrompt, validateGuide } from './review-guide.mjs';

export const WALKTHROUGH_LIMITS = Object.freeze({
  maxPromptBytes: 256 * 1024,
  maxHistoryItems: 12,
  maxHistoryItemChars: 4000,
  maxHistoryBytes: 24 * 1024,
});
const WALKTHROUGH_TIMEOUT_MS = 10 * 60_000;

export function createWalkthroughService(snapshots, ai) {
  if (!snapshots || typeof snapshots.get !== 'function' || typeof snapshots.getFile !== 'function') throw new TypeError('Walkthrough service needs a snapshot store.');
  if (!ai || typeof ai.generate !== 'function') throw new TypeError('Walkthrough service needs an AI generator.');

  async function create(input, options = {}) {
    try {
      validateCreateInput(input);
      const context = buildGuideContext(snapshots, input.snapshotId, input.selectedId, input.fileIds);
      const prompt = buildGuidePrompt(context, { depth: input.depth ?? 'standard', timeMinutes: input.timeMinutes ?? 15 });
      assertPromptSize(prompt);
      const result = await generate(ai, prompt, { ...safeOptions(options), model:input.model, effort:input.effort, jsonSchema: GUIDE_SCHEMA, turnTimeoutMs: WALKTHROUGH_TIMEOUT_MS });
      if (result.status !== 200) return result;
      const value = parseGuideResponse(result.body);
      let guide;
      try { guide = validateGuide(value, context); }
      catch (error) { return invalidModelResponse(error); }
      return { status: 200, body: { guide, scope: context.scope, snapshotId: context.snapshotId, selectedId: context.selectedId } };
    } catch (error) {
      return errorResponse(error);
    }
  }

  async function followup(input, options = {}) {
    try {
      validateFollowupInput(input);
      const context = buildGuideContext(snapshots, input.snapshotId, input.selectedId, input.fileIds);
      const guide = validateGuide(input.guide, context);
      const history = validateHistory(input.history);
      const prompt = buildStepPrompt(context, guide, input.stepIndex, input.question);
      assertPromptSize(prompt);
      const result = await generate(ai, prompt, { ...safeOptions(options), model:input.model, effort:input.effort, history, turnTimeoutMs: WALKTHROUGH_TIMEOUT_MS });
      if (result.status !== 200) return result;
      if (!result.body || typeof result.body.text !== 'string' || !result.body.text.trim()) return invalidModelResponse(new GuideError('The provider returned an empty follow-up response.', 502, 'GUIDE_EMPTY_RESPONSE'));
      return { status: 200, body: { ...result.body, scope: context.scope, snapshotId: context.snapshotId, selectedId: context.selectedId, stepIndex: input.stepIndex } };
    } catch (error) {
      return errorResponse(error);
    }
  }

  return { create, followup };
}

async function generate(ai, prompt, options) {
  let result;
  try { result = await ai.generate(prompt, { purpose: 'legacy walkthrough', ...options }); }
  catch (error) { return { status: 502, body: { error: error instanceof Error ? error.message : 'The AI provider failed.', code: 'GUIDE_PROVIDER_FAILED' } }; }
  if (!result || !Number.isInteger(result.status) || !result.body || typeof result.body !== 'object') {
    return { status: 502, body: { error: 'The AI provider returned an invalid response envelope.', code: 'GUIDE_PROVIDER_RESPONSE' } };
  }
  return result;
}

function parseGuideResponse(body) {
  if (typeof body.text !== 'string' || !body.text.trim()) throw new GuideError('The provider returned an empty walkthrough plan.', 502, 'GUIDE_EMPTY_RESPONSE');
  try { return JSON.parse(body.text); }
  catch { throw new GuideError('The provider returned malformed walkthrough JSON.', 502, 'GUIDE_MALFORMED_RESPONSE'); }
}

function invalidModelResponse(error) {
  const detail = error instanceof Error ? error.message : 'The walkthrough plan failed validation.';
  return { status: 502, body: { error: `The provider returned an invalid walkthrough plan: ${detail}`, code: 'GUIDE_INVALID_RESPONSE' } };
}

function validateCreateInput(input) {
  requireObject(input, 'Walkthrough request');
  rejectUnknown(input, ['snapshotId', 'selectedId', 'fileIds', 'depth', 'timeMinutes', 'model', 'effort'], 'Walkthrough request');
  requiredText(input.snapshotId, 'snapshotId', 180);
  requiredText(input.selectedId, 'selectedId', 180);
  if (input.fileIds !== undefined && !Array.isArray(input.fileIds)) throw requestError('fileIds must be an array of changed file IDs.');
  if (input.depth !== undefined && !['brief', 'standard', 'deep'].includes(input.depth)) throw requestError('depth must be brief, standard, or deep.');
  if (input.timeMinutes !== undefined && (!Number.isSafeInteger(input.timeMinutes) || input.timeMinutes < 1 || input.timeMinutes > 120)) throw requestError('timeMinutes must be an integer from 1 to 120.');
}

function validateFollowupInput(input) {
  requireObject(input, 'Walkthrough follow-up request');
  rejectUnknown(input, ['snapshotId', 'selectedId', 'fileIds', 'guide', 'stepIndex', 'question', 'history', 'model', 'effort'], 'Walkthrough follow-up request');
  requiredText(input.snapshotId, 'snapshotId', 180);
  requiredText(input.selectedId, 'selectedId', 180);
  if (input.fileIds !== undefined && !Array.isArray(input.fileIds)) throw requestError('fileIds must be an array of changed file IDs.');
  requireObject(input.guide, 'Persisted guide');
  if (!Number.isSafeInteger(input.stepIndex) || input.stepIndex < 0) throw requestError('stepIndex must be a non-negative integer.');
  requiredText(input.question, 'question', 1600);
  if (input.history !== undefined && !Array.isArray(input.history)) throw requestError('history must be an array of user and assistant messages.');
}

function validateHistory(value) {
  const history = value === undefined ? [] : value;
  if (history.length > WALKTHROUGH_LIMITS.maxHistoryItems) throw new GuideError(`History may contain at most ${WALKTHROUGH_LIMITS.maxHistoryItems} messages.`, 413, 'GUIDE_HISTORY_LIMIT');
  const safe = history.map((item, index) => {
    requireObject(item, `History message ${index + 1}`);
    rejectUnknown(item, ['role', 'text'], `History message ${index + 1}`);
    if (!['user', 'assistant'].includes(item.role)) throw requestError(`History message ${index + 1} has an invalid role.`);
    const text = requiredText(item.text, `History message ${index + 1} text`, WALKTHROUGH_LIMITS.maxHistoryItemChars);
    return { role: item.role, text };
  });
  if (Buffer.byteLength(JSON.stringify(safe)) > WALKTHROUGH_LIMITS.maxHistoryBytes) throw new GuideError('History is too large to restore in one walkthrough request.', 413, 'GUIDE_HISTORY_LIMIT');
  return safe;
}

function assertPromptSize(prompt) {
  const bytes = Buffer.byteLength(prompt);
  if (bytes > WALKTHROUGH_LIMITS.maxPromptBytes) throw new GuideError(`Walkthrough prompt is ${bytes} bytes, above the ${WALKTHROUGH_LIMITS.maxPromptBytes}-byte limit. Choose fewer or smaller files; no source was trimmed.`, 413, 'GUIDE_PROMPT_LIMIT');
}

function safeOptions(options) {
  if (!options || typeof options !== 'object') return {};
  const safe = {};
  if (options.signal) safe.signal = options.signal;
  if (typeof options.onDelta === 'function') safe.onDelta = options.onDelta;
  return safe;
}

function errorResponse(error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  return { status, body: { error: error instanceof Error ? error.message : 'Walkthrough request failed.', code: error?.code || 'GUIDE_REQUEST_FAILED' } };
}

function requireObject(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw requestError(`${label} must be an object.`); }
function rejectUnknown(value, allowed, label) { for (const key of Object.keys(value)) if (!allowed.includes(key)) throw requestError(`${label} contains unsupported field ${key}.`); }
function requiredText(value, label, max) { if (typeof value !== 'string' || !value.trim() || value.length > max) throw requestError(`${label} must be non-empty text no longer than ${max} characters.`); return value.trim(); }
function requestError(message) { return new GuideError(message, 400, 'GUIDE_REQUEST'); }
