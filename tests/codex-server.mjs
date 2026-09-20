import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexReviewClient } from '../codex-server.mjs';

const root = await mkdtemp(join(tmpdir(), 'patchwork-rpc-test-'));
const binary = join(root, 'fake-codex');
await writeFile(binary, `#!/usr/bin/env node
const readline = require('node:readline');
let thread = 0;
const output = (v) => process.stdout.write(JSON.stringify(v)+'\\n');
readline.createInterface({input:process.stdin}).on('line', line => {
 const m=JSON.parse(line); const p=m.params||{};
 const reply = result => output({id:m.id,result});
 if(m.method==='initialize') reply({});
 else if(m.method==='config/read') reply({config:{mcp_servers:{inherited:{command:'bad'}},features:{shell_tool:false}}});
 else if(m.method==='model/list') reply({data:[{model:'future-model',displayName:'Future Model',supportedReasoningEfforts:[{reasoningEffort:'xhigh'}],defaultReasoningEffort:'xhigh',isDefault:true}],nextCursor:null});
 else if(m.method==='account/read') reply({account:{type:process.env.TEST_AUTH||'chatgpt',planType:process.env.TEST_PLAN||'plus'}});
 else if(m.method==='account/rateLimits/read') reply({rateLimits:{primary:{usedPercent:20}}});
 else if(m.method==='thread/start') {
  if(p.config['mcp_servers.inherited.enabled']!==false || p.sandbox!=='read-only' || p.approvalPolicy!=='never') output({id:m.id,error:{message:'Unsafe config'}});
  else reply({thread:{id:'thread-'+(++thread)}});
 } else if(m.method==='thread/fork') {
  if(!p.threadId) process.exit(2);
  reply({thread:{id:'thread-'+(++thread)}});
 } else if(m.method==='turn/start') {
  if(p.model==='future-model'&&p.effort!=='xhigh'){output({id:m.id,error:{message:'Effort was not forwarded'}});return;}
  reply({turn:{id:'turn-1'}});
  if(p.input[0].text==='wait') return;
  output({method:'item/agentMessage/delta',params:{threadId:p.threadId,turnId:'turn-1',delta:'Hello '}});
  output({method:'item/agentMessage/delta',params:{threadId:p.threadId,turnId:'turn-1',delta:p.threadId}});
  output({method:'item/completed',params:{threadId:p.threadId,turnId:'turn-1',item:{type:'agentMessage',phase:'final_answer',text:'Hello '+p.threadId}}});
  output({method:'turn/completed',params:{threadId:p.threadId,turn:{id:'turn-1',status:'completed'}}});
 } else if(m.id!==undefined) reply({});
});
`);
await chmod(binary,0o755);
const client = new CodexReviewClient(binary, {timeoutMs:300});
try {
 await assert.rejects(client.answer('Do not enable tools here', { repositoryTools: {} }), /dedicated guide process/);
 const catalog=await client.models();assert.equal(catalog.defaultModel,'future-model');assert.deepEqual(catalog.models[0].efforts,['xhigh']);
 const deltas=[];
 assert.equal(await client.answer('explain',{sessionKey:'device:snapshot',onDelta:t=>deltas.push(t)}),'Hello thread-1');
 assert.deepEqual(deltas,['Hello ','thread-1']);
 assert.equal(await client.answer('why',{sessionKey:'device:snapshot'}),'Hello thread-1');
 assert.equal(await client.answer('new revision',{sessionKey:'device:snapshot2'}),'Hello thread-2');
 assert.equal(await client.answer('branch',{sessionKey:'child',forkSessionKey:'device:snapshot'}),'Hello thread-3');
 assert.equal(await client.answer('main continues',{sessionKey:'device:snapshot'}),'Hello thread-1');
 assert.match(await client.answer('dynamic model',{model:'future-model',effort:'xhigh'}),/Hello/);
 const controller=new AbortController();
 const pending=client.answer('wait',{sessionKey:'cancel',signal:controller.signal});
 setTimeout(()=>controller.abort(),40);
 await assert.rejects(pending,/Stopped/);
 await assert.rejects(client.answer('wait',{sessionKey:'timeout'}),/timed out/);
 const denied=new CodexReviewClient(binary,{env:{...process.env,TEST_AUTH:'apiKey'}});
 try { assert.equal((await denied.status()).available,false); await assert.rejects(denied.answer('no generation'),/will not switch to API billing/); }
 finally { await denied.close(); }
 const metered=new CodexReviewClient(binary,{env:{...process.env,TEST_PLAN:'self_serve_business_usage_based'}});
 try { await assert.rejects(metered.answer('no generation'),/usage-based or could not be verified/); } finally { await metered.close(); }
 console.log('Codex protocol: subscription gate, inherited tool isolation, streaming, continuity, version boundaries, cancel and timeout passed.');
} finally { await client.close(); await rm(root,{recursive:true,force:true}); }
