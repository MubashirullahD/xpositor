// Opt-in live subscription check. All source and questions are synthetic.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSnapshotStore } from '../snapshot.mjs';
import { createGuideStorage } from '../guide-storage.mjs';
import { createAiService } from '../ai-service.mjs';
import { createAgentGuideService } from '../agent-guide-service.mjs';
import { closeProviders } from '../providers.mjs';
const repo=mkdtempSync(join(tmpdir(),'patchwork-resume-live-')),state=mkdtempSync(join(tmpdir(),'patchwork-resume-state-'));
const git=(...args)=>execFileSync('git',args,{cwd:repo,stdio:'pipe'});
let storage,service;
const create=()=>{const snapshots=createSnapshotStore(repo,{loadSnapshot:id=>storage?.loadSnapshot(id)});storage=createGuideStorage(state,snapshots.repoId);const ai=createAiService(snapshots,{...process.env,PATCHWORK_AI_PROVIDER:'codex'});return {snapshots,ai,service:createAgentGuideService(snapshots,ai,{storage})};};
try {
 git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.invalid');
 writeFileSync(join(repo,'value.js'),'export const value=41;\n');writeFileSync(join(repo,'caller.js'),'import {value} from "./value.js";\nexport const doubled=value*2;\n');git('add','.');git('commit','-qm','Initial');writeFileSync(join(repo,'value.js'),'export const value=42;\n');
 let runtime=create();service=runtime.service;
 const snapshot=runtime.snapshots.capture('all',{reuse:true}),catalog=await runtime.ai.models(),model=catalog.models.find(m=>m.id.includes('luna'))||catalog.models[0],effort=model.efforts.includes('low')?'low':model.defaultEffort;
 const id='live-persistent-main-01';service.start({requestId:id,snapshotId:snapshot.snapshotId,model:model.id,effort});
 let result=await service.runs.wait(id);assert.equal(result.status,'completed',result.error);
 service.close();await closeProviders();
 // A new service, cache and Codex process simulate a full companion restart.
 runtime=create();service=runtime.service;assert.equal(runtime.snapshots.capture('all',{reuse:true}).snapshotId,snapshot.snapshotId);
 writeFileSync(join(repo,'caller.js'),'changed after snapshot\n');
 service.question({requestId:'live-resume-question-01',conversationId:id,question:'Find the unchanged caller in the captured repository and calculate its new result.',model:model.id,effort});
 result=await service.runs.wait('live-resume-question-01');assert.equal(result.status,'completed',result.error);assert.match(result.result.text,/caller\.js/);assert.match(result.result.text,/84/);
 service.close();await closeProviders();runtime=create();service=runtime.service;
 service.question({requestId:'live-resume-branch-01',conversationId:id,question:'Give a tiny example of using this changed value.',branch:true,model:model.id,effort});
 const branch=await service.runs.wait('live-resume-branch-01');assert.equal(branch.status,'completed',branch.error);assert.equal(service.conversation(id).messages.length,2);assert.equal(service.conversation('live-resume-branch-01').parentId,id);
 console.log(JSON.stringify({model:model.id,resumed:true,immutableCaller:result.result.text,branchAfterRestart:true,parentMessageCount:service.conversation(id).messages.length}));
}finally{service?.close();await closeProviders();rmSync(repo,{recursive:true,force:true});rmSync(state,{recursive:true,force:true});}
