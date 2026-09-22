import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { GuideError } from './review-guide.mjs';
export const VOICES=[{id:'af_heart',name:'Heart'},{id:'af_bella',name:'Bella'},{id:'am_michael',name:'Michael'}];
export function createSpeechService({home=process.env.PATCHWORK_VOICE_HOME||join(homedir(),'.patchwork','voice'),timeoutMs=600000,workerFactory=fork}={}){
 let worker,pending,sequence=0,bytes=0;const cache=new Map();
 const available=()=>existsSync(join(home,'node_modules','kokoro-js','package.json'));
 function close(reason='Local voice stopped. Try Play again.'){const p=pending;pending=null;if(p){clearTimeout(p.timer);p.reject(new GuideError(reason,503,'VOICE_STOPPED'));}const w=worker;worker=null;w?.kill();}
 function start(){
  if(worker)return;
  const w=worker=workerFactory(new URL('./speech-worker.mjs',import.meta.url),[],{execArgv:[],env:{...process.env,PATCHWORK_VOICE_HOME:home,OMP_NUM_THREADS:'2'},stdio:['ignore','ignore','pipe','ipc']});
  let diagnostic='';w.stderr.on('data',chunk=>{diagnostic=(diagnostic+String(chunk)).slice(-1800);});
  w.on('message',message=>{if(!pending||message.id!==pending.id)return;const p=pending;pending=null;clearTimeout(p.timer);if(message.error)p.reject(new GuideError(`Local voice could not generate audio: ${message.error}`,503,'VOICE_FAILED'));else p.resolve(Buffer.from(message.audio,'base64'));});
  const failed=()=>{if(worker===w)close(diagnostic.trim()?`Local voice process failed: ${diagnostic.trim()}`:'Local voice process stopped unexpectedly. Try Play again.');};w.on('error',failed);w.on('exit',failed);
 }
 async function synthesize(text,voice='af_heart'){
  if(typeof text!=='string'||!text.trim()||text.length>1000||!VOICES.some(v=>v.id===voice))throw new GuideError('Invalid speech segment or voice.',400,'VOICE_INPUT');
  const key=createHash('sha256').update(voice+'\0'+text).digest('hex');if(cache.has(key))return cache.get(key);
  if(!available())throw new GuideError('Local voice needs one-time setup on the laptop: run node setup-voice.mjs from the Patchwork folder. You can read the lesson now.',503,'VOICE_SETUP');
  if(pending)throw new GuideError('Local voice is preparing another segment. Try Play again shortly.',429,'VOICE_BUSY');
  start();const id=++sequence;
  const result=await new Promise((resolve,reject)=>{pending={id,resolve,reject,timer:setTimeout(close,timeoutMs)};worker.send({id,text,voice},error=>{if(error&&pending?.id===id)close();});});
  if(result.length>16*1024*1024)throw new GuideError('Audio segment is too large.',413,'VOICE_LIMIT');
  while(cache.size&&(cache.size>=24||bytes+result.length>32*1024*1024)){const first=cache.keys().next().value;bytes-=cache.get(first).length;cache.delete(first);}
  cache.set(key,result);bytes+=result.length;return result;
 }
 return {status:()=>({available:available(),voices:VOICES}),synthesize,close};
}
