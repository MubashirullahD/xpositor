import assert from 'node:assert/strict';
import { createDeepAudio } from '../src/deep-audio.js';

const clips=[];
globalThis.Audio=class {
  constructor(url){this.src=url;this.paused=true;this.ended=false;this.currentTime=0;clips.push(this);}
  set src(value){this.url=value;this.ended=false;this.currentTime=0;}
  async play(){this.paused=false;}
  pause(){this.paused=true;}
};
const first={snapshotId:'snapshot',id:'review',index:0,group:0,text:'One two three four.'};
const second={...first,group:1,text:'Next explanation.'};
let requests=[],inflight=0,maxInflight=0,next=0;
const player=createDeepAudio({active:()=>true,render:()=>{},next:()=>{next++;},apiFetch:async(_,options)=>{
 const input=JSON.parse(options.body);requests.push(input);inflight++;maxInflight=Math.max(inflight,maxInflight);
 await new Promise(resolve=>setTimeout(resolve,5));inflight--;
 const text=input.chunk===0?'One two':'three four.';
 return new Response('audio',{headers:{'x-patchwork-audio-chunks':'2','x-patchwork-speech-text':encodeURIComponent(text),'x-patchwork-speech-offset':input.chunk===0?'0':'8','x-patchwork-speech-timing':JSON.stringify([{start:0,end:text.length,time:0,duration:2}])}});
}});
await player.prepare(first,second);
assert.equal(clips.length,1,'Preparation must mount audio without playing');
assert.equal(clips[0].paused,true);
await player.play();assert.equal(clips[0].paused,false);
const words=[0,4,8,14].map(offset=>({dataset:{offset:String(offset)},classList:{toggle(_,value){this.spoken=value;}}}));
const root={querySelector:()=>null,querySelectorAll:()=>words};
player.bind(root,first,second,true);
clips[0].currentTime=.1;clips[0].ontimeupdate();assert.equal(words[0].classList.spoken,true);
clips[0].ended=true;clips[0].paused=true;await clips[0].onended();
assert.equal(clips.length,1,'Reuse the unlocked audio element across speech parts');
assert.equal(clips[0].paused,false);
clips[0].currentTime=.1;clips[0].ontimeupdate();assert.equal(words[2].classList.spoken,true,'Second-part offsets must align with the full transcript');
clips[0].ended=true;clips[0].paused=true;await clips[0].onended();assert.equal(next,0,'Section ends pause by default');
await player.play();clips[0].currentTime=.1;clips[0].ontimeupdate();assert.equal(words[0].classList.spoken,true,'Replay starts at the first part');
player.stop();await new Promise(resolve=>setTimeout(resolve,30));
assert.equal(maxInflight,1,'Local voice requests must be serialized');
const count=requests.length;
await player.prepare(second);assert.equal(requests.length,count,'Next section uses its prepared cache');
player.stop();player.requestAutoplay();player.bind(root,null,null,true);await player.prepare(first);
assert.equal(clips[0].paused,false,'Auto-advance intent survives waiting for the next generation batch');
player.stop();
let resolve;
const late=createDeepAudio({active:()=>true,render:()=>{},next:()=>{},apiFetch:()=>new Promise(r=>{resolve=r;})});
const preparing=late.prepare(first);await Promise.resolve();await Promise.resolve();late.stop();
const before=clips.length;resolve(new Response('audio'));await preparing;
assert.equal(clips.length,before,'Leaving a section must ignore late audio completion');
console.log('Deep audio passed: automatic preparation, serial prefetch, multipart word offsets, pause, replay, cache, and stale completion.');
