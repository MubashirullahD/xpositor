import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Run against the actual package staging tree, outside the checkout's ESM scope.
const extension=resolve(process.argv[2]);
assert.notEqual(JSON.parse(readFileSync(join(extension,'package.json'))).type,'module');
const home=mkdtempSync(join(tmpdir(),'xpositor-bundle-voice-'));
let worker;
try {
 const runtime=join(home,'node_modules','kokoro-js');mkdirSync(runtime,{recursive:true});
 writeFileSync(join(home,'package.json'),'{}');
 writeFileSync(join(runtime,'package.json'),JSON.stringify({type:'module',main:'index.js'}));
 writeFileSync(join(runtime,'index.js'),`export const env={};export const KokoroTTS={async from_pretrained(){return {async generate(){return {audio:new Float32Array(2400),sampling_rate:24000};}};}};`);
 worker=fork(join(extension,'bundle','speech-worker.mjs'),[],{execArgv:[],env:{...process.env,XPOSITOR_VOICE_HOME:home},stdio:['ignore','ignore','pipe','ipc']});
 let diagnostic='';worker.stderr.on('data',chunk=>diagnostic+=chunk);
 const message=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Packaged speech worker timed out. '+diagnostic)),10000);
  const done=(error,value)=>{clearTimeout(timer);error?reject(error):resolve(value);};
  worker.once('error',error=>done(error));
  worker.once('exit',code=>done(new Error('Packaged worker exited '+code+': '+diagnostic)));
  worker.once('message',message=>done(null,message));
  worker.send({id:1,text:'Imagine a question that is sent twice. The identifier keeps the answer safe.',voice:'af_heart'});
 });
 assert.equal(message.error,undefined);assert.equal(message.id,1);
 const audio=Buffer.from(message.audio,'base64');assert.equal(audio.toString('ascii',0,4),'RIFF');
 assert.ok(message.timings.length);assert.equal(message.timings.at(-1).time+message.timings.at(-1).duration,audio.readUInt32LE(40)/audio.readUInt32LE(28));
 console.log('Packaged CommonJS extension: ESM voice worker imports, synthesis and phrase timings passed.');
} finally {worker?.kill();rmSync(home,{recursive:true,force:true});}
