import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateLesson } from '../lesson-plan.mjs';
import { createSpeechService } from '../speech-service.mjs';
import { sanitizeLessons } from '../src/audio-lesson.js';
import { createAgentGuideService } from '../agent-guide-service.mjs';
const snapshot={snapshotId:'snapshot',files:[{id:'a',path:'a.js',lines:[['removed','1','before']]}]};
const repository={snapshot,manifest:[{path:'a.js',fileId:'a',available:true,changed:true}],read(path){assert.equal(path,'a.js');return {source:'const value = 42;\nreturn value;'};}};
const lesson={title:'Follow the value',reviewPointers:[{text:'Check what happens when the value is missing.',citation:{path:'a.js',side:'new',startLine:1,endLine:1}}],segments:Array.from({length:4},(_,i)=>({title:'Part '+i,narration:'We return forty two.',citation:{path:'a.js',side:'new',startLine:1,endLine:2},focusLine:2}))};
const valid=validateLesson(lesson,repository,0);assert.equal(valid.segments[0].code[1].text,'return value;');
const longEnding=structuredClone(lesson);longEnding.segments.at(-1).narration='x'.repeat(990);assert.throws(()=>validateLesson(longEnding,repository,0),/spoken chapter ending/);
for(const patch of [{endLine:13},{endLine:3},{startLine:0}]){const longer=structuredClone(lesson);longer.segments[0].citation.endLine=20;assert.equal(validateLesson(longer,{...repository,read:()=>({source:Array(30).fill('real code').join('\n')})},0).segments[0].citation.endLine,20);
const bad=structuredClone(lesson);Object.assign(bad.segments[0].citation,patch);assert.throws(()=>validateLesson(bad,repository,0));}
const bad=structuredClone(lesson);bad.segments[0].focusLine=3;assert.throws(()=>validateLesson(bad,repository,0),/Highlighted/);
const old=structuredClone(lesson);old.segments[0].citation={path:'a.js',side:'old',startLine:1,endLine:1};old.segments[0].focusLine=1;assert.equal(validateLesson(old,repository,0).segments[0].code[0].text,'before');
assert.deepEqual(sanitizeLessons({0:valid})[0],valid);assert.deepEqual(sanitizeLessons({0:{segments:[null]}}),{});
const plan={title:'Review',summary:'Change',assumptions:[],fileOverviews:[{path:'a.js',summary:'The value changes.'}],steps:[{title:'Value',explanation:'Value changes',files:['a.js'],citations:[]}]};
let calls=0;
const inMemory=createAgentGuideService({getRepository:()=>repository},{async generate(prompt,options){calls++;options.onThread?.('thread');return {status:200,body:{text:JSON.stringify(options.parallelKey?{files:[{path:'a.js',summary:'The value changes.'}]}:options.jsonSchema.properties.segments?lesson:plan)}};}});
inMemory.start({requestId:'lesson-test-main-01',snapshotId:'snapshot'});await inMemory.runs.wait('lesson-test-main-01');
inMemory.lesson({requestId:'lesson-test-build-01',conversationId:'lesson-test-main-01',step:0});assert.equal((await inMemory.runs.wait('lesson-test-build-01')).status,'completed');
assert.equal(inMemory.conversation('lesson-test-main-01').lessons[0].segments.length,4);
const count=calls;inMemory.lesson({requestId:'lesson-test-build-01',conversationId:'lesson-test-main-01',step:0});assert.equal(calls,count);
assert.throws(()=>inMemory.lesson({requestId:'lesson-test-bad-001',conversationId:'lesson-test-main-01',step:-1}));
const home=mkdtempSync(join(tmpdir(),'xpositor-voice-test-'));
try{
 const absent=createSpeechService({home});await assert.rejects(absent.synthesize('hello'),/one-time setup/);
 mkdirSync(join(home,'node_modules','kokoro-js'),{recursive:true});writeFileSync(join(home,'node_modules','kokoro-js','package.json'),'{}');
 let sends=0,worker;
 const factory=()=>{worker=new EventEmitter();worker.stderr=new EventEmitter();worker.kill=()=>{};worker.send=({id})=>{sends++;setTimeout(()=>worker.emit('message',{id,audio:Buffer.from('RIFF audio').toString('base64')}),5);};return worker;};
 const speech=createSpeechService({home,workerFactory:factory});const first=speech.synthesize('hello');await assert.rejects(speech.synthesize('another'),/another segment/);assert.equal((await first).toString(),'RIFF audio');await speech.synthesize('hello');assert.equal(sends,1);await speech.synthesize('hello','af_bella');assert.equal(sends,2);await assert.rejects(speech.synthesize('hello','unknown'),/Invalid/);speech.close();
 const stalled=createSpeechService({home,timeoutMs:10,workerFactory:()=>{const w=factory();w.send=()=>{};return w;}});await assert.rejects(stalled.synthesize('timeout'),/stopped/);stalled.close();
}finally{rmSync(home,{recursive:true,force:true});}
console.log('Audio lesson: grounded short excerpts, old/new lines, schema sanitization, idempotent generation, voice isolation/cache/bounds/timeout passed.');

const {speechPhrases,estimatedWordCues}=await import('../src/speech-timing.js');const script='Imagine a retry. The same identifier keeps the answer safe. '+ 'A long example '.repeat(50);const phrases=speechPhrases(script);assert.ok(phrases.every(p=>p.end-p.start<=250));assert.equal(phrases.map(p=>script.slice(p.start,p.end).trim()).join(' '),script.trim());const cues=estimatedWordCues('One two.',[{start:0,end:8,time:2,duration:3}]);assert.equal(cues[0].start,2);assert.equal(cues.at(-1).end,5);
