import { escapeHtml as esc } from './render.js';
export function sanitizeLessons(value){
 const result={};
 for(const [key,lesson] of Object.entries(value||{})){
  if(!/^\d{1,4}$/.test(key)||!lesson||typeof lesson.title!=='string'||!Array.isArray(lesson.segments)||lesson.segments.length<4||lesson.segments.length>8)continue;
  const segments=lesson.segments.filter(s=>s&&typeof s.title==='string'&&typeof s.narration==='string'&&Array.isArray(s.code)&&s.code.length<=12).map(s=>({title:s.title.slice(0,100),narration:s.narration.slice(0,1000),focusLine:Number.isSafeInteger(s.focusLine)?s.focusLine:null,citation:s.citation&&typeof s.citation.path==='string'&&['old','new'].includes(s.citation.side)?{path:s.citation.path.slice(0,4096),side:s.citation.side,startLine:s.citation.startLine,endLine:s.citation.endLine,fileId:typeof s.citation.fileId==='string'?s.citation.fileId:null}:null,code:s.code.filter(r=>r&&Number.isSafeInteger(r.line)&&typeof r.text==='string').map(r=>({line:r.line,text:r.text.slice(0,2000)}))}));
  if(segments.length===lesson.segments.length)result[key]={title:lesson.title.slice(0,140),checkQuestion:typeof lesson.checkQuestion==='string'?lesson.checkQuestion.slice(0,400):'',step:Number(key),segments};
 }return result;
}
export function createAudioLesson({current,apiFetch,save,render,ask,jump}){
 let audio=null,media=null,url=null,loading=false,playing=false,error='',generation=0,owner='',voice='af_heart',speed=1,controller;
 const clips=new Map(),preparing=new Map();
 async function loadClip(record,step,index,selectedVoice,signal){
  const key=JSON.stringify([record.snapshotId,record.id,step,index,selectedVoice]);
  if(clips.has(key))return clips.get(key);if(preparing.has(key))return preparing.get(key);
  const task=(async()=>{
   const response=await apiFetch('/api/guide/speech',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({conversationId:record.id,step,segment:index,voice:selectedVoice}),signal});
   if(!response.ok){const body=await response.json();throw new Error(body.error||'Audio unavailable.');}
   const blob=await response.blob();
   while(clips.size&&(clips.size>=3||[...clips.values()].reduce((n,b)=>n+b.size,0)+blob.size>24*1024*1024))clips.delete(clips.keys().next().value);
   if(blob.size<=24*1024*1024)clips.set(key,blob);return blob;
  })();preparing.set(key,task);try{return await task;}finally{preparing.delete(key);}
 }
 const lesson=()=>current()?.lessons?.[current()?.step];
 const position=()=>Math.max(0,Math.min((lesson()?.segments.length||1)-1,current()?.lessonPosition?.[current()?.step]||0));
 const identity=()=>`${current()?.snapshotId}:${current()?.id}:${current()?.step}`;
 function pause(){generation++;controller?.abort();controller=null;loading=false;playing=false;audio?.pause();}
 function dispose(){pause();if(audio){audio.src='';audio=null;}if(url){URL.revokeObjectURL(url);url=null;}}
 function move(index){dispose();error='';const r=current();r.lessonPosition||={};r.lessonPosition[r.step]=index;save();render();}
 async function play(){
  if(playing||loading){pause();render();return;}
  if(audio){playing=true;try{await audio.play();}catch{playing=false;error='Tap Play again to allow audio playback.';}render();return;}
  const r=current(),l=lesson();if(!l)return;
  owner=identity();const token=++generation,index=position();loading=true;error='';render();controller=new AbortController();
  try{
   const blob=await loadClip(r,r.step,index,voice,controller.signal);if(token!==generation||owner!==identity())return;
   url=URL.createObjectURL(blob);audio=media||=new Audio();audio.src=url;const clip=audio;audio.playbackRate=speed;
   audio.onended=()=>{if(audio!==clip||!playing||owner!==identity())return;playing=false;const next=position()+1;dispose();if(next<l.segments.length){move(next);play();}else render();};
   audio.onerror=()=>{if(audio!==clip)return;dispose();error='Audio could not play. Try Play again, or read the transcript.';render();};
   loading=false;playing=true;await audio.play();
   if(index+1<l.segments.length&&token===generation)loadClip(r,r.step,index+1,voice).catch(()=>{});
  }catch(e){if(token!==generation)return;loading=false;playing=false;if(e.name!=='AbortError')error=e.message;}
  if(token===generation)render();
 }
 function html(){
  const l=lesson();if(!l)return '';
  const i=position(),s=l.segments[i];
  return `<section class="audio-lesson" aria-label="Audio lesson"><p class="eyebrow">LISTEN & FOLLOW · ${i+1} / ${l.segments.length}</p><h4>${esc(s.title)}</h4>
   <div class="lesson-controls"><button class="secondary-button" data-lesson="back" ${i===0?'disabled':''} aria-label="Previous teaching segment">Back</button><button class="primary-button" data-lesson="play">${loading?'Cancel audio':playing?'Pause':'Play'}</button><button class="secondary-button" data-lesson="next" ${i===l.segments.length-1?'disabled':''} aria-label="Next teaching segment">Next</button></div>
   ${s.citation?`<div class="lesson-code"><div class="lesson-code-heading"><span>${esc(s.citation.path)} · ${s.citation.side==='old'?'before':'after'}</span>${s.citation.fileId?'<button class="agent-step-link" data-lesson="source">Full code</button>':''}</div><pre tabindex="0" aria-label="Code explained in this segment">${s.code.map(row=>`<span class="lesson-line ${row.line===s.focusLine?'lesson-focus':''}"><span class="lesson-line-number">${row.line}</span><code>${esc(row.text)}</code></span>`).join('')}</pre></div>`:''}
   <p class="lesson-transcript">${esc(s.narration)}</p>

   ${loading?'<p role="status">Preparing local voice… First playback can take longer.</p>':''}${error?`<p role="alert" class="guide-error">${esc(error)}</p>`:''}
   <details class="lesson-options"><summary>Voice & speed</summary><label>Voice <select id="lesson-voice"><option value="af_heart" ${voice==='af_heart'?'selected':''}>Heart</option><option value="af_bella" ${voice==='af_bella'?'selected':''}>Bella</option><option value="am_michael" ${voice==='am_michael'?'selected':''}>Michael</option></select></label><label>Speed <select id="lesson-speed">${[0.8,1,1.2,1.5].map(n=>`<option value="${n}" ${speed===n?'selected':''}>${n}×</option>`).join('')}</select></label></details>
   <div class="lesson-help"><button class="agent-step-link" data-lesson="simpler">Explain more simply</button><button class="agent-step-link" data-lesson="example">Another example</button></div>
   ${i===l.segments.length-1?`<p class="lesson-check"><strong>Before moving on:</strong> ${esc(l.checkQuestion)}</p>`:''}</section>`;
 }
 function bind(root){
  if(!root.querySelector('.audio-lesson')||owner&&owner!==identity()){dispose();owner='';}
  root.querySelector('#agent-draft')?.addEventListener('focus',()=>{if(playing||loading){pause();const b=root.querySelector('[data-lesson="play"]');if(b)b.textContent='Play';}});
  root.querySelector('#lesson-voice')?.addEventListener('change',e=>{dispose();voice=e.target.value;error='';render();});
  root.querySelector('#lesson-speed')?.addEventListener('change',e=>{speed=Number(e.target.value);if(audio)audio.playbackRate=speed;});
  root.querySelectorAll('[data-lesson]').forEach(el=>el.addEventListener('click',()=>{
   const s=lesson()?.segments[position()];
   switch(el.dataset.lesson){
    case 'play':play();break;
    case 'back':move(position()-1);break;
    case 'next':move(position()+1);break;
    case 'source':pause();jump(s.citation);break;
    case 'simpler':case 'example':pause();ask(`${el.dataset.lesson==='simpler'?'Explain this more simply, defining unfamiliar concepts':'Give another concrete example for this'}: ${s.narration}`);break;
   }
  }));
 }
 return {html,bind,pause};
}
