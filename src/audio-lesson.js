import { estimatedWordCues } from './speech-timing.js';
import { prepare, finishPreparation, restInvitation, isResting } from './preparation.js';
import { escapeHtml as esc } from './render.js';
export function sanitizeLessons(value){
 const result={};
 for(const [key,lesson] of Object.entries(value||{})){
  if(!/^\d{1,4}$/.test(key)||!lesson||typeof lesson.title!=='string'||!Array.isArray(lesson.segments)||lesson.segments.length<4||lesson.segments.length>8)continue;
  const segments=lesson.segments.filter(s=>s&&typeof s.title==='string'&&typeof s.narration==='string'&&Array.isArray(s.code)).map(s=>({title:s.title.slice(0,100),narration:s.narration.slice(0,1000),focusLine:Number.isSafeInteger(s.focusLine)?s.focusLine:null,citation:s.citation&&typeof s.citation.path==='string'&&['old','new'].includes(s.citation.side)?{path:s.citation.path.slice(0,4096),side:s.citation.side,startLine:s.citation.startLine,endLine:s.citation.endLine,fileId:typeof s.citation.fileId==='string'?s.citation.fileId:null}:null,code:s.code.filter(r=>r&&Number.isSafeInteger(r.line)&&typeof r.text==='string').map(r=>({line:r.line,text:r.text.slice(0,2000)}))}));
  if(segments.length===lesson.segments.length)result[key]={title:lesson.title.slice(0,140),reviewClosing:lesson.reviewClosing===true||Array.isArray(lesson.reviewPointers),reviewPointers:(Array.isArray(lesson.reviewPointers)?lesson.reviewPointers:[]).slice(0,4).filter(p=>p&&typeof p.text==='string'&&p.citation&&typeof p.citation.path==='string').map(p=>({text:p.text.slice(0,400),citation:{path:p.citation.path,side:p.citation.side,startLine:p.citation.startLine,endLine:p.citation.endLine,fileId:p.citation.fileId||null}})),step:Number(key),segments};
 }return result;
}
export function createAudioLesson({current,apiFetch,save,render,ask,jump}){
 let audio=null,media=null,url=null,loading=false,playing=false,error='',generation=0,owner='',voice='af_heart',speed=1,controller,activeRoot=null,cues=[],highlighted=-1;
 const prepared=new Set();
 const clips=new Map(),preparing=new Map();
 async function loadClip(record,step,index,selectedVoice,signal){
  const key=JSON.stringify([record.snapshotId,record.id,step,index,selectedVoice]);
  if(clips.has(key))return clips.get(key);if(preparing.has(key))return preparing.get(key);
  const task=(async()=>{
   const response=await apiFetch('/api/guide/speech',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({conversationId:record.id,step,segment:index,voice:selectedVoice}),signal:AbortSignal.any([AbortSignal.timeout(660000),...(signal?[signal]:[])])});
   if(!response.ok){const body=await response.json();throw new Error(body.error||'Audio unavailable.');}
   const blob=await response.blob();try{blob.timings=JSON.parse(response.headers.get('x-patchwork-speech-timing')||'[]');}catch{blob.timings=[];}
   while(clips.size&&(clips.size>=3||[...clips.values()].reduce((n,b)=>n+b.size,0)+blob.size>24*1024*1024))clips.delete(clips.keys().next().value);
   if(blob.size<=24*1024*1024)clips.set(key,blob);return blob;
  })();preparing.set(key,task);try{return await task;}finally{preparing.delete(key);}
 }
 const lesson=()=>current()?.lessons?.[current()?.step];
 const spoken=(l,index)=>l.segments[index].narration+(index===l.segments.length-1&&l.reviewClosing?` Things to double-check: ${l.reviewPointers?.length?l.reviewPointers.map(p=>p.text).join(' '):'No specific concern was identified from the captured context. That does not verify the change.'}`:'');
 const position=()=>Math.max(0,Math.min((lesson()?.segments.length||1)-1,current()?.lessonPosition?.[current()?.step]||0));
 const identity=()=>`${current()?.snapshotId}:${current()?.id}:${current()?.step}`;
 function pause(){finishPreparation(owner,'cancelled');generation++;controller?.abort();controller=null;loading=false;playing=false;audio?.pause();}
 function dispose(){pause();if(audio){audio.src='';audio=null;}if(url){URL.revokeObjectURL(url);url=null;}}
 function point(reveal=false){const s=lesson()?.segments[position()];if(s?.citation)jump({...s.citation,focusLine:s.focusLine},{reveal});}
 function move(index){if(index<0||index>=lesson().segments.length)return;dispose();error='';const r=current();r.lessonPosition||={};r.lessonPosition[r.step]=index;save();render();point();prepareClip();}
 function updateWords(){
  const time=audio?.currentTime||0,index=cues.findIndex(c=>time>=c.start&&time<c.end);
  if(index===highlighted)return;highlighted=index;
  activeRoot?.querySelectorAll('.lesson-word').forEach(el=>el.classList.toggle('is-spoken',index>=0&&Number(el.dataset.offset)===cues[index].offset));
 }
 function prepareClip(){const key=identity()+':'+position()+':'+voice;if(!loading&&!audio&&lesson()&&!prepared.has(key)){prepared.add(key);point();play(false);}}

 async function play(autoplay=true){
  if(playing||loading){pause();render();return;}
  if(audio){if(!autoplay)return;if(audio.ended)audio.currentTime=0;playing=true;try{await audio.play();}catch{playing=false;error='Tap Play again to allow audio playback.';}render();return;}
  const r=current(),l=lesson();if(!l)return;
  owner=identity();prepare(owner,'Your audio');const token=++generation,index=position();loading=true;error='';render();controller=new AbortController();
  try{
   const blob=await loadClip(r,r.step,index,voice,controller.signal);if(token!==generation||owner!==identity())return;
   cues=estimatedWordCues(spoken(l,index),blob.timings);highlighted=-1;url=URL.createObjectURL(blob);audio=media||=new Audio();audio.src=url;const clip=audio;audio.playbackRate=speed;
   audio.ontimeupdate=updateWords;audio.onseeked=updateWords;
   audio.onended=()=>{if(audio!==clip||owner!==identity())return;playing=false;render();};
   audio.onerror=()=>{if(audio!==clip)return;dispose();error='Audio could not play. Try Play again, or read the transcript.';render();};
   loading=false;finishPreparation(owner,'ready',()=>play());
   if(autoplay&&!isResting()){playing=true;await audio.play();}
   if(index+1<l.segments.length&&token===generation)loadClip(r,r.step,index+1,voice).catch(()=>{});
  }catch(e){if(token!==generation)return;loading=false;playing=false;if(e.name!=='AbortError'){error=e.message;finishPreparation(owner,'error');}}
  if(token===generation)render();
 }
 function html(){
  const l=lesson();if(!l)return '';
  const i=position(),s=l.segments[i];
  return `<section class="audio-lesson" id="audio-lesson" tabindex="0" aria-label="Audio lesson" aria-keyshortcuts="ArrowLeft ArrowRight Space"><p class="eyebrow">LISTEN & FOLLOW · ${i+1} / ${l.segments.length}</p><h4>${esc(s.title)}</h4>
   <div class="lesson-controls"><button class="secondary-button" data-lesson="back" ${i===0?'disabled':''} aria-label="Previous teaching segment">Back</button><button class="primary-button" data-lesson="play">${loading?'Cancel audio':playing?'Pause':'Play'}</button><button class="secondary-button" data-lesson="next" ${i===l.segments.length-1?'disabled':''} aria-label="Next teaching segment">Next</button></div>
   ${s.citation?`<button class="agent-step-link lesson-reference" data-lesson="source">View ${esc(s.citation.path)} · ${s.citation.side==='old'?'before':'after'} · lines ${s.citation.startLine}–${s.citation.endLine} ↗</button>`:''}
   <p class="lesson-transcript">${spoken(l,i).split(/(\s+)/).map((word,index,parts)=>/^\s+$/.test(word)?esc(word):`<span class="lesson-word" data-offset="${parts.slice(0,index).join('').length}">${esc(word)}</span>`).join('')}</p>

   ${loading?restInvitation():''}${error?`<p role="alert" class="guide-error">${esc(error)}</p>`:''}
   <details class="lesson-options"><summary>Voice & speed</summary><p>Word highlighting estimates the reading position within each spoken phrase.</p><label>Voice <select id="lesson-voice"><option value="af_heart" ${voice==='af_heart'?'selected':''}>Heart</option><option value="af_bella" ${voice==='af_bella'?'selected':''}>Bella</option><option value="am_michael" ${voice==='am_michael'?'selected':''}>Michael</option></select></label><label>Speed <select id="lesson-speed">${[0.8,1,1.2,1.5].map(n=>`<option value="${n}" ${speed===n?'selected':''}>${n}×</option>`).join('')}</select></label></details>
   <div class="lesson-help"><button class="agent-step-link" data-lesson="simpler">Explain more simply</button><button class="agent-step-link" data-lesson="example">Another example</button></div>
   ${i===l.segments.length-1?`<div class="lesson-check"><strong>Things to double-check</strong>${l.reviewPointers?.length?`<ul>${l.reviewPointers.map((p,index)=>`<li>${esc(p.text)} <button class="agent-step-link" data-lesson-pointer="${index}">${esc(p.citation.path)} · ${p.citation.startLine}–${p.citation.endLine}</button></li>`).join('')}</ul>`:'<p>No specific concern identified from captured context. This does not verify the change.</p>'}</div>`:''}</section>`;
 }
 function bind(root){
  activeRoot=root;highlighted=-1;updateWords();
  root.querySelector('.agent-walkthrough')?.addEventListener('keydown',e=>{
   if(!lesson()||e.defaultPrevented||e.isComposing||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||e.target.closest('input,textarea,select,summary,[contenteditable="true"]'))return;
   if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();if(!e.repeat){move(position()+(e.key==='ArrowRight'?1:-1));root.querySelector('#audio-lesson')?.focus({preventScroll:true});}}
   else if(e.code==='Space'||e.key===' '){if(e.target.closest('button,a'))return;e.preventDefault();if(!e.repeat){play();root.querySelector('#audio-lesson')?.focus({preventScroll:true});}}
  });
  if(isResting()&&playing)pause();
  if(!root.querySelector('.audio-lesson')||owner&&owner!==identity()){dispose();owner='';}
  root.querySelector('#agent-draft')?.addEventListener('focus',()=>{if(playing||loading){pause();const b=root.querySelector('[data-lesson="play"]');if(b)b.textContent='Play';}});
  root.querySelector('#lesson-voice')?.addEventListener('change',e=>{dispose();voice=e.target.value;error='';render();});
  root.querySelector('#lesson-speed')?.addEventListener('change',e=>{speed=Number(e.target.value);if(audio)audio.playbackRate=speed;});
  root.querySelectorAll('[data-lesson]').forEach(el=>el.addEventListener('click',()=>{
   const s=lesson()?.segments[position()];
   if(['play','back','next'].includes(el.dataset.lesson))root.querySelector('#audio-lesson')?.focus({preventScroll:true});
   switch(el.dataset.lesson){
    case 'play':play();break;
    case 'back':move(position()-1);break;
    case 'next':move(position()+1);break;
    case 'source':point(true);break;
    case 'simpler':case 'example':pause();ask(`${el.dataset.lesson==='simpler'?'Explain this more simply, defining unfamiliar concepts':'Give another concrete example for this'}: ${s.narration}`);break;
   }
  }));
  root.querySelectorAll('[data-lesson-pointer]').forEach(el=>el.addEventListener('click',()=>jump(lesson().reviewPointers[Number(el.dataset.lessonPointer)].citation,{reveal:true})));
 }
 return {html,bind,pause,prepare:prepareClip};
}
