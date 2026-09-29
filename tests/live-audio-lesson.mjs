// Opt-in: uses the signed-in Codex subscription and local Kokoro, no paid API.
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdtempSync,rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSnapshotStore } from '../snapshot.mjs';
import { createAiService } from '../ai-service.mjs';
import { createAgentGuideService } from '../agent-guide-service.mjs';
import { closeProviders } from '../providers.mjs';
const root=mkdtempSync(join(tmpdir(),'xpositor-teaching-'));
const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
let service;
try{
 git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.invalid');
 const source=readFileSync(new URL('../guide-runs.mjs',import.meta.url),'utf8');
 const before=source.replace(/    const previous = runs.get\(id\);[\s\S]*?    if \(typeof execute/, '    if (typeof execute');
 assert.notEqual(before,source);
 writeFileSync(join(root,'guide-runs.mjs'),before);git('add','.');git('commit','-qm','Before request deduplication');writeFileSync(join(root,'guide-runs.mjs'),source);
 const snapshots=createSnapshotStore(root),snapshot=snapshots.capture('all'),ai=createAiService(snapshots,{...process.env,XPOSITOR_AI_PROVIDER:'codex'});
 service=createAgentGuideService(snapshots,ai);const catalog=await ai.models();const model=catalog.models.find(m=>m.id.includes('luna'))||catalog.models[0];const effort=model.efforts.includes('low')?'low':model.defaultEffort;
 service.start({requestId:'audio-live-main-0001',snapshotId:snapshot.snapshotId,model:model.id,effort});let run=await service.runs.wait('audio-live-main-0001');assert.equal(run.status,'completed',run.error);
 service.lesson({requestId:'audio-live-lesson-01',conversationId:'audio-live-main-0001',step:0,model:model.id,effort});run=await service.runs.wait('audio-live-lesson-01');assert.equal(run.status,'completed',run.error);
 const lesson=service.conversation('audio-live-main-0001').lessons[0];writeFileSync('/tmp/xpositor-pilot-lesson.json',JSON.stringify(lesson,null,2));
 console.log(JSON.stringify({model:model.id,title:lesson.title,segments:lesson.segments.length,script:'/tmp/xpositor-pilot-lesson.json'}));
}finally{service?.close();await closeProviders();rmSync(root,{recursive:true,force:true});}
