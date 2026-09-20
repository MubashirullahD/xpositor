// Opt-in integration check: uses the existing Codex subscription, never an API key.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSnapshotStore } from '../snapshot.mjs';
import { createAiService } from '../ai-service.mjs';
import { createAgentGuideService } from '../agent-guide-service.mjs';
import { closeProviders } from '../providers.mjs';
const repo=mkdtempSync(join(tmpdir(),'patchwork-live-guide-'));
const git=(...args)=>execFileSync('git',args,{cwd:repo,stdio:'pipe'});
let service;
try {
 git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.invalid');
 for(let i=0;i<100;i++)writeFileSync(join(repo,`value${i}.js`),`export function value${i}() { return ${i}; }\n`);
 writeFileSync(join(repo,'entry.js'),'import { value42 } from "./value42.js";\nexport function calculate() { return value42() * 2; }\n');
 git('add','.');git('commit','-qm','Initial');
 for(let i=0;i<100;i++)writeFileSync(join(repo,`value${i}.js`),`export function value${i}() { return ${i} + 1; }\n`);
 const snapshots=createSnapshotStore(repo),snapshot=snapshots.capture();
 const ai=createAiService(snapshots,{...process.env,PATCHWORK_AI_PROVIDER:'codex'});
 service=createAgentGuideService(snapshots,ai);
 const catalog=await ai.models();const model=catalog.models.find(item=>item.id.includes('luna'))||catalog.models.find(item=>item.isDefault)||catalog.models[0];
 assert(model,'A subscription model must be available');
 const effort=model.efforts.includes('low')?'low':model.defaultEffort;
 const root='live-guide-main-0001';
 service.start({requestId:root,snapshotId:snapshot.snapshotId,selectedPath:'value42.js',model:model.id,effort});
 let lastStatus=0;service.runs.subscribe(root,run=>{if(Date.now()-lastStatus>15000){lastStatus=Date.now();console.log(JSON.stringify({run:run.id,status:run.status,activity:run.activity,replyChars:run.text.length}));}});
 const result=await service.runs.wait(root);
 assert.equal(result.status,'completed',result.error);
 assert.equal(result.result.guide.fileOrder.length,100);
 assert.equal(new Set(result.result.guide.fileOrder).size,100);
 const mainStep=Math.min(1,result.result.guide.steps.length-1);service.selectStep(root,mainStep);
 // Modify the original repository after capture; retrieval must retain entry.js.
 writeFileSync(join(repo,'entry.js'),'This is different after capture.\n');
 const child='live-guide-child-001';
 service.question({requestId:child,conversationId:root,question:'Find an unchanged caller of value42 using the repository tools. Name the caller file and explain its result after these changes.',step:0,branch:true,model:model.id,effort});
 const followup=await service.runs.wait(child);
 assert.equal(followup.status,'completed',followup.error);
 assert.match(followup.result.text,/entry\.js/);
 assert.equal(service.conversation(root).step,mainStep);
 assert.equal(service.conversation(root).messages.length,0);
 console.log(JSON.stringify({model:model.id,files:result.result.guide.fileOrder.length,steps:result.result.guide.steps.length,examined:result.result.guide.examinedCount,followup:followup.result.text,parentStep:service.conversation(root).step}));
}finally{service?.close();await closeProviders();rmSync(repo,{recursive:true,force:true});}
