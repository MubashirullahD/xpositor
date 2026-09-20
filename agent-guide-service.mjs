import { createRepositoryTools } from './repository-tools.mjs';
import { buildRepositoryGuidePrompt, validateRepositoryGuide, REPOSITORY_GUIDE_SCHEMA } from './agent-plan.mjs';
import { createGuideRuns } from './guide-runs.mjs';
import { GuideError } from './review-guide.mjs';

export function createAgentGuideService(snapshots, ai, { storage } = {}) {
  const runs = createGuideRuns();
  const conversations = new Map();
  let storageError;
  try {
  const saved=storage?.load();
  if(saved?.version===1){
    for(const record of (Array.isArray(saved.conversations)?saved.conversations:[]).slice(-128))if(record&&typeof record.id==='string'&&typeof record.snapshotId==='string')conversations.set(record.id,record);
    runs.restore(saved.runs);
    for(const id of [...new Set([...conversations.values()].map(record=>record.snapshotId))].slice(-8)){const snapshot=storage.loadSnapshot(id);if(snapshot)snapshots.restoreRecord(snapshot);}
  }
  } catch(error) {storageError=error;conversations.clear();}
  function requireStorage(){if(storageError)throw new GuideError(`Saved guide history could not be loaded: ${storageError.message} Restore or move the repository's guide cache on the laptop, then restart the companion. Ordinary code review is still available.`,503,'GUIDE_STORAGE');}
  function persist(){requireStorage();storage?.save({version:1,conversations:[...conversations.values()],runs:runs.dump()});}
  function track(record,run){
    try{persist();}catch(error){runs.cancel(run.id);throw error;}
    runs.wait(run.id).then(()=>{try{persist();}catch(error){record.persistenceError=`The laptop could not save this conversation: ${error.message}`;}});
    return run;
  }
  const sessionKey = record => `repository:${record.snapshotId}:${record.id}`;
  function find(id) {
    requireStorage();
    const record = conversations.get(id);
    if (!record) throw new GuideError('This guide conversation is unavailable. Start a new walkthrough.', 404, 'GUIDE_CONVERSATION_MISSING');
    return record;
  }
  function view(record) {
    return structuredClone({ id: record.id, snapshotId: record.snapshotId, parentId: record.parentId,
      title: record.title, persistenceError:record.persistenceError||null, step: record.step, guide: record.guide, messages: record.messages, runId: record.runId });
  }
  async function generate(record, prompt, options, schema, parent) {
    const tools = createRepositoryTools(snapshots, record.snapshotId);
    const generationOptions = {
      ...options, repositoryTools: tools, sessionKey: sessionKey(record),
      ...(parent ? { forkSessionKey: sessionKey(parent), forkThreadId: parent.threadId } : {}),
      resumeThreadId: record.threadId, onThread: threadId => { record.threadId = threadId; persist(); },
      ...(schema ? { jsonSchema: schema } : {}),
    };
    for (let attempt = 0; attempt < (schema ? 3 : 1); attempt++) {
      const result = await ai.generate(prompt, generationOptions);
      if (result.status !== 200) throw new GuideError(result.body?.error || 'The guide could not finish.', result.status, 'GUIDE_GENERATION_FAILED');
      if (!schema) {
        record.messages.push({ role: 'assistant', text: result.body.text });persist();
        return { text: result.body.text, conversationId: record.id };
      }
      try {
        record.guide = validateRepositoryGuide(JSON.parse(result.body.text), tools);
        record.title = record.guide.title;persist();
        return { guide: record.guide, conversationId: record.id };
      } catch (error) {
        if (attempt === 2) throw new GuideError(`The guide could not produce a complete, valid plan: ${error.message}`, 502, 'AGENT_PLAN_INVALID');
        options.onActivity?.({ tool: 'Checking review plan', path: null });
        prompt = `Correct your previous plan and return the complete JSON replacement. Validation failed: ${error.message}\nEvery changed file must appear in at least one step's files array. A file may be revisited in later steps, but must not be repeated within the same step. Enumerate the complete changed inventory if needed. Preserve full scope; do not omit files or invent citations.`;
      }
    }
  }

  function start(input) {
    requireStorage();
    requireInput(input, ['requestId', 'snapshotId', 'selectedPath', 'model', 'effort']);
    const repository = snapshots.getRepository(input.snapshotId);
    const prompt = buildRepositoryGuidePrompt(repository, input.selectedPath);
    storage?.saveSnapshot(input.snapshotId,snapshots.exportRecord(input.snapshotId));
    const id = input.requestId;
    let record = conversations.get(id);
    const fresh = !record;
    if (!record) record = { id, snapshotId: input.snapshotId, parentId: null, title: 'Walkthrough', step: 0, guide: null, messages: [], threadId: null, runId: id };
    if (fresh && conversations.size >= 128) throw new GuideError('The companion conversation limit has been reached. Back up and clear the repository guide cache on the laptop before starting more conversations.', 413, 'GUIDE_CONVERSATION_LIMIT');
    conversations.set(id, record);
    try {
      const run=runs.start(id, { ...input, conversationId: id }, (_, options) => generate(record, prompt, { ...options, model: input.model, effort: input.effort }, REPOSITORY_GUIDE_SCHEMA));
      return track(record,run);
    } catch (error) { if (fresh) conversations.delete(id); throw error; }
  }
  function question(input) {
    requireStorage();
    requireInput(input, ['requestId', 'conversationId', 'question', 'step', 'branch', 'model', 'effort']);
    const original = find(input.conversationId);
    if (!original.guide) throw new GuideError('Wait for the walkthrough plan before asking a follow-up.', 409, 'GUIDE_PLAN_PENDING');
    if (typeof input.question !== 'string' || !input.question.trim() || input.question.length > 8000) throw new GuideError('Ask a question of 1–8,000 characters.', 400, 'GUIDE_QUESTION');
    const step = input.step ?? original.step;
    if (!Number.isSafeInteger(step) || step < 0 || step >= original.guide.steps.length) throw new GuideError('Choose an existing walkthrough step.', 400, 'GUIDE_STEP');
    if (input.branch !== undefined && typeof input.branch !== 'boolean') throw new GuideError('branch must be boolean.', 400, 'GUIDE_BRANCH');
    const id = input.branch ? input.requestId : original.id;
    let record = conversations.get(id);
    const fresh = !record;
    if (!record) record = { ...original, id, parentId: original.id, title: input.question.trim().slice(0, 80), step, threadId: null, messages: structuredClone(original.messages) };
    if (fresh && conversations.size >= 128) throw new GuideError('The companion conversation limit has been reached.', 413, 'GUIDE_CONVERSATION_LIMIT');
    const request = { ...input, snapshotId: original.snapshotId, conversationId: id };
    try {
      const run = runs.start(input.requestId, request, async (_, options) => {
        record.messages.push({ role: 'user', text: input.question.trim() });
        const prompt = `Continue this immutable repository walkthrough. Use the captured read/search tools as needed.\nCurrent step: ${JSON.stringify(record.guide.steps[step])}\nReviewer question: ${input.question.trim()}\nDo not change the review plan or claim approval on the reviewer's behalf.`;
        return generate(record, prompt, { ...options, model: input.model, effort: input.effort }, null, input.branch && fresh ? original : null);
      });
      record.runId = run.id; conversations.set(id, record); return track(record,run);
    } catch (error) { if (fresh) conversations.delete(id); throw error; }
  }
  function selectStep(id, step) {
    const record = find(id);
    if (!Number.isSafeInteger(step) || step < 0 || step >= (record.guide?.steps.length || 0)) throw new GuideError('Choose an existing walkthrough step.', 400, 'GUIDE_STEP');
    record.step = step; persist();return view(record);
  }
  return { start, question, selectStep, runs,
    conversation: id => view(find(id)),
    list: snapshotId => [...conversations.values()].filter(record => record.snapshotId === snapshotId).map(record => ({ id: record.id, snapshotId: record.snapshotId, parentId: record.parentId, title: record.title, persistenceError:record.persistenceError||null, step: record.step, runId: record.runId })),
    close: () => runs.close(),
  };
}
function requireInput(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new GuideError('Invalid guide request fields.', 400, 'GUIDE_INPUT');
  if (typeof value.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(value.requestId)) throw new GuideError('A stable request ID is required.', 400, 'GUIDE_RUN_ID');
}
