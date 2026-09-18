import assert from 'node:assert/strict';
import { readReply, errorMessage } from '../src/transport.js';
import { emptyState, createBackup, parseBackup, mergeState } from '../src/storage.js';
import { sanitizeWalkthrough, walkthroughKey } from '../src/walkthrough.js';

const guide={title:'Plan',summary:'Check the change.',assumptions:[],steps:Array.from({length:3},()=>({title:'Trace',explanation:'Follow this value.',reviewQuestion:'What fails?',citations:[{fileId:'a',startLine:1,endLine:2,side:'new'}]}))};
const snapshot={repoId:'r',snapshotId:'s'};
const walk=sanitizeWalkthrough({selectedId:'a',guide,scope:{includedPaths:['a.js'],excludedCount:2},step:1,understood:[0],draft:'Why?',chats:{1:[{role:'assistant',text:'partial',pending:true}]},scroll:100,token:'not-exported'});
const data=emptyState();data.sessions[JSON.stringify(['r','s','a.js','v1'])]={draft:'',chat:[],archives:[[{role:'user',text:'Earlier question'},{role:'assistant',text:'Earlier answer'}]],scroll:{}};data.walkthroughs[walkthroughKey(snapshot)]=walk;
const restored=parseBackup(JSON.stringify(createBackup(data,null))).data;
assert.equal(restored.walkthroughs[walkthroughKey(snapshot)].step,1);
assert.equal(restored.sessions[JSON.stringify(['r','s','a.js','v1'])].archives[0][0].text,'Earlier question');
assert.deepEqual(restored.walkthroughs[walkthroughKey(snapshot)].understood,[0]);
assert.deepEqual(restored.reviews,{},'understanding never implies a review decision');
assert.equal(restored.walkthroughs[walkthroughKey(snapshot)].chats[1][0].error,true);
assert.equal(restored.walkthroughs[walkthroughKey(snapshot)].draft,'Why?');
assert.ok(!JSON.stringify(restored).includes('not-exported'));
assert.equal(mergeState(emptyState(),restored).walkthroughs[walkthroughKey(snapshot)].scroll,100);
assert.equal(sanitizeWalkthrough({...walk,guide:{...guide,steps:[{}]}}),null);
assert.deepEqual(sanitizeWalkthrough({...walk,scope:{includedPaths:{}}}).scope.includedPaths,[]);

const encoder=new TextEncoder();
const wire=encoder.encode(JSON.stringify({type:'delta',text:'Hello 🌱'})+'\n'+JSON.stringify({type:'done',text:'Hello 🌱'})+'\n');
let i=0;
const stream=new ReadableStream({pull(controller){if(i===wire.length){controller.close();return;}controller.enqueue(wire.slice(i,i+1));i++;}});
const deltas=[];
assert.equal((await readReply(new Response(stream),t=>deltas.push(t))).text,'Hello 🌱');
assert.deepEqual(deltas,['Hello 🌱']);
await assert.rejects(readReply(new Response('{"type":"delta","text":"partial"}\n')),/connection ended/);
await assert.rejects(readReply(new Response('{"type":"error","error":"Provider limit"}\n')),/Provider limit/);
console.log('Frontend guide: durable progress, backup privacy, interrupted history and chunked UTF-8 streams passed.');

assert.match(errorMessage({error:JSON.stringify({error:{message:'Model requires a newer version of Codex'}})}),/Update Codex on the laptop/);
await assert.rejects(readReply(new Response(JSON.stringify({error:{message:'Update the Codex CLI'}}),{status:400,headers:{'content-type':'application/json'}})),/Update Codex on the laptop/);
assert.equal((await readReply(new Response(JSON.stringify({text:'JSON fallback'}),{headers:{'content-type':'application/json'}}))).text,'JSON fallback');
const terminalThenFailure=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"type":"done","text":"Complete"}\n'));},pull(c){c.error(new Error('Load failed'));}});
assert.equal((await readReply(new Response(terminalThenFailure))).text,'Complete','a terminal reply survives a later transport disconnect');

const upgradeMessage=errorMessage('Model requires a newer version of Codex');assert.equal(errorMessage(upgradeMessage),upgradeMessage);
