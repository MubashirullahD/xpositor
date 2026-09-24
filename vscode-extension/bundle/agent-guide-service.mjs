import { LESSON_SCHEMA, lessonPrompt, validateLesson } from './lesson-plan.mjs';
import { createRepositoryTools } from './repository-tools.mjs';
import { buildRepositoryGuidePrompt, validateRepositoryGuide, REPOSITORY_GUIDE_SCHEMA, SINGLE_FILE_REPOSITORY_GUIDE_SCHEMA } from './agent-plan.mjs';
import { createGuideRuns } from './guide-runs.mjs';
import { GuideError } from './review-guide.mjs';
import { generateFileOverviews } from './file-overviews.mjs';
import { buildDeepManifest, deepSectionPrompt, validateDeepSection, DEEP_SECTION_SCHEMA } from './deep-review.mjs';

const MIN_WALKTHROUGH_TIMEOUT_MS = 5 * 60_000;
const PER_CHANGED_FILE_TIMEOUT_MS = 30_000;
const MAX_WALKTHROUGH_TIMEOUT_MS = 60 * 60_000;

export function repositoryGuideTimeoutMs(changedFileCount) {
  if (!Number.isSafeInteger(changedFileCount) || changedFileCount < 1) throw new TypeError('Changed file count must be a positive integer.');
  return Math.min(MAX_WALKTHROUGH_TIMEOUT_MS, Math.max(MIN_WALKTHROUGH_TIMEOUT_MS, changedFileCount * PER_CHANGED_FILE_TIMEOUT_MS));
}

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
    if (record.mode === 'deep') return structuredClone({ id:record.id, mode:'deep', snapshotId:record.snapshotId, title:record.title, persistenceError:record.persistenceError||null, sections:record.sections, position:record.position, completed:record.completed, explanations:record.explanations, runId:record.runId });
    return structuredClone({ id: record.id, snapshotId: record.snapshotId, parentId: record.parentId,
      title: record.title, persistenceError:record.persistenceError||null, step: record.step, guide: record.guide, fileOverviews:record.fileOverviews||{}, overviewStatus:record.overviewStatus||{}, lessons:record.lessons||{}, messages: record.messages, runId: record.runId });
  }
  function startDeep(input) {
    requireStorage();requireInput(input,['requestId','snapshotId']);
    if(typeof input.snapshotId!=='string')throw new GuideError('A captured snapshot is required.',400,'DEEP_SNAPSHOT');
    const existing=conversations.get(input.requestId);
    if(existing){if(existing.mode!=='deep'||existing.snapshotId!==input.snapshotId)throw new GuideError('This request ID belongs to another review.',409,'DEEP_CONFLICT');return view(existing);}
    if(conversations.size>=128)throw new GuideError('The companion conversation limit has been reached.',413,'GUIDE_CONVERSATION_LIMIT');
    const repository=snapshots.getRepository(input.snapshotId);
    const sections=buildDeepManifest(repository);
    storage?.saveSnapshot(input.snapshotId,snapshots.exportRecord(input.snapshotId));
    const record={id:input.requestId,mode:'deep',snapshotId:input.snapshotId,title:'Deep file review',sections,position:0,completed:[],explanations:{},runId:null};
    conversations.set(record.id,record);
    try{persist();}catch(error){conversations.delete(record.id);throw error;}
    return view(record);
  }
  function deepSection(input) {
    requireStorage();requireInput(input,['requestId','conversationId','index','model','effort','prefetch']);
    const record=find(input.conversationId);
    if(record.mode!=='deep')throw new GuideError('Choose a deep review session.',400,'DEEP_SESSION');
    if(!Number.isSafeInteger(input.index)||input.index<0||input.index>=record.sections.length)throw new GuideError('Choose a section in this review.',400,'DEEP_INDEX');
    const section=record.sections[input.index];
    if(section.kind!=='code')throw new GuideError('This file has a coverage notice instead of a generated explanation.',400,'DEEP_NOTICE');
    if(record.explanations[input.index])return {cached:true,conversation:view(record)};
    const repository=snapshots.getRepository(record.snapshotId);
    const run=runs.start(input.requestId,{...input,snapshotId:record.snapshotId},async(_,options)=>{
      let prompt=deepSectionPrompt(repository,section);
      for(let attempt=0;attempt<2;attempt++){
        const result=await ai.generate(prompt,{...options,jsonSchema:DEEP_SECTION_SCHEMA,model:input.model,effort:input.effort,turnTimeoutMs:5*60_000});
        if(result.status!==200)throw new GuideError(result.body?.error||'Section explanation failed.',result.status,'DEEP_GENERATION_FAILED');
        if(options.signal.aborted)throw new Error('Stopped.');
        try{
          const explanation=validateDeepSection(JSON.parse(result.body.text),repository,section);
          record.explanations[input.index]=explanation;persist();return {index:input.index,explanation,conversationId:record.id};
        }catch(error){if(attempt)throw error;prompt=`${deepSectionPrompt(repository,section)}\nYour previous response failed validation: ${error.message}. Return the full corrected JSON.`;}
      }
    });
    record.runId=run.id;track(record,run);return {run};
  }
  function advanceDeep(input) {
    requireStorage();
    if(!input||Object.keys(input).some(key=>!['conversationId','position','completed'].includes(key)))throw new GuideError('Invalid deep review navigation.',400,'DEEP_NAVIGATION');
    const record=find(input.conversationId);
    if(record.mode!=='deep'||!Number.isSafeInteger(input.position)||input.position<0||input.position>=record.sections.length)throw new GuideError('Choose a section in this review.',400,'DEEP_POSITION');
    if(input.completed!==undefined){if(!Array.isArray(input.completed)||input.completed.length>record.sections.length||input.completed.some(index=>!Number.isSafeInteger(index)||index<0||index>=record.sections.length))throw new GuideError('Invalid completed section list.',400,'DEEP_COMPLETED');record.completed=[...new Set([...record.completed,...input.completed])].sort((a,b)=>a-b);}
    if(input.position>record.position&&!record.completed.includes(record.position))record.completed.push(record.position);
    record.position=input.position;persist();return view(record);
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
        prompt = `Correct your previous plan and return the complete JSON replacement. Validation failed: ${error.message}\nEvery changed file must appear in at least one step's files array. fileOverviews can be empty and must not delay the plan. A file may be revisited in later steps, but must not be repeated within the same step. Preserve full scope; do not omit files or invent citations.`;
      }
    }
  }

  function start(input) {
    requireStorage();
    requireInput(input, ['requestId', 'snapshotId', 'selectedPath', 'model', 'effort']);
    const repository = snapshots.getRepository(input.snapshotId);
    storage?.saveSnapshot(input.snapshotId,snapshots.exportRecord(input.snapshotId));
    const id = input.requestId;
    let record = conversations.get(id);
    const fresh = !record;
    if (!record) record = { id, snapshotId: input.snapshotId, parentId: null, title: 'Walkthrough', step: 0, guide: null, fileOverviews:{}, overviewStatus:{}, messages: [], threadId: null, runId: id };
    if (fresh && conversations.size >= 128) throw new GuideError('The companion conversation limit has been reached. Back up and clear the repository guide cache on the laptop before starting more conversations.', 413, 'GUIDE_CONVERSATION_LIMIT');
    conversations.set(id, record);
    try {
      const run=runs.start(id, { ...input, conversationId: id }, async (_, options) => {
        if(ai.status){const availability=await ai.status();if(!availability.capabilities?.repositoryGuide)throw new GuideError('Repository exploration currently requires Codex with a ChatGPT subscription. Select Codex on the laptop.',400,'GUIDE_PROVIDER');}
        const singleFile=repository.snapshot.files.length===1;
        const progress=singleFile?{fileOverviews:{}}:await generateFileOverviews(repository,ai,{signal:options.signal,model:input.model,effort:input.effort,onProgress:value=>{
          record.fileOverviews=value.fileOverviews;record.overviewStatus=value.overviewStatus;
          options.onProgress({phase:value.phase,completed:value.completed,total:value.total,ready:Object.keys(value.fileOverviews).length});persist();
        }});
        options.onProgress({phase:'walkthrough',completed:repository.snapshot.files.length,total:repository.snapshot.files.length,ready:Object.keys(progress.fileOverviews).length});
        const prompt=buildRepositoryGuidePrompt(repository,input.selectedPath,progress.fileOverviews);
        const result=await generate(record,prompt,{...options,model:input.model,effort:input.effort,turnTimeoutMs:repositoryGuideTimeoutMs(repository.snapshot.files.length)},singleFile?SINGLE_FILE_REPOSITORY_GUIDE_SCHEMA:REPOSITORY_GUIDE_SCHEMA);
        Object.assign(record.guide.fileOverviews,progress.fileOverviews);persist();
        return {...result,guide:record.guide};
      });
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
    if (!record) record = { ...original, id, parentId: original.id, title: input.question.trim().slice(0, 80), step, threadId: null, messages: structuredClone(original.messages), lessons:structuredClone(original.lessons||{}) };
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
  function lesson(input) {
    requireStorage();requireInput(input,['requestId','conversationId','step','model','effort']);
    const record=find(input.conversationId),step=input.step;
    if(!Number.isSafeInteger(step)||!record.guide?.steps[step])throw new GuideError('Choose an existing chapter.',400,'LESSON_STEP');
    const run=runs.start(input.requestId,{...input,snapshotId:record.snapshotId},async(_,options)=>{
      const tools=createRepositoryTools(snapshots,record.snapshotId);
      let prompt=lessonPrompt(record,step);
      for(let attempt=0;attempt<2;attempt++){
        const result=await ai.generate(prompt,{...options,repositoryTools:tools,jsonSchema:LESSON_SCHEMA,model:input.model,effort:input.effort,turnTimeoutMs:repositoryGuideTimeoutMs(tools.repository.snapshot.files.length)});
        if(result.status!==200)throw new GuideError(result.body?.error||'Lesson generation failed.',result.status,'LESSON_FAILED');
        if(options.signal.aborted)throw new Error('Stopped.');
        let value;
        try{value=validateLesson(JSON.parse(result.body.text),tools.repository,step);}
        catch(error){if(attempt)throw error;prompt=lessonPrompt(record,step)+'\nYour previous attempt was invalid: '+error.message+' Return a complete corrected lesson.';continue;}
        record.lessons||={};record.lessons[step]=value;persist();return {lesson:value,conversationId:record.id};
      }
    });record.runId=run.id;return track(record,run);
  }
  function selectStep(id, step) {
    const record = find(id);
    if (!Number.isSafeInteger(step) || step < 0 || step >= (record.guide?.steps.length || 0)) throw new GuideError('Choose an existing walkthrough step.', 400, 'GUIDE_STEP');
    record.step = step; persist();return view(record);
  }
  return { start, question, lesson, selectStep, startDeep, deepSection, advanceDeep, runs,
    conversation: id => view(find(id)),
    list: snapshotId => [...conversations.values()].filter(record => record.snapshotId === snapshotId).map(record => ({ id: record.id, mode:record.mode||'overview', snapshotId: record.snapshotId, parentId: record.parentId, title: record.title, persistenceError:record.persistenceError||null, step: record.step, position:record.position, runId: record.runId })),
    close: () => runs.close(),
  };
}
function requireInput(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new GuideError('Invalid guide request fields.', 400, 'GUIDE_INPUT');
  if (typeof value.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(value.requestId)) throw new GuideError('A stable request ID is required.', 400, 'GUIDE_RUN_ID');
}
