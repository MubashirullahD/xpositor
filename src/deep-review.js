import { createDeepAudio } from './deep-audio.js';
import { escapeHtml as esc, icon, messageBubble } from './render.js';
import { randomId } from './platform.js';
import { errorMessage } from './transport.js';

const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(id);
const keyFor = snapshot => JSON.stringify([snapshot.repoId, snapshot.snapshotId]);
export function sanitizeDeepWorkspace(value) {
  const records = {};
  for (const record of Object.values(value?.records || {}).slice(0,128)) {
    if (!validId(record?.id) || typeof record.snapshotId !== 'string' || !Array.isArray(record.sections)) continue;
    const sections = record.sections.filter(s=>s&&typeof s.path==='string'&&typeof s.fileId==='string'&&['code','summary'].includes(s.kind)).map((s,i)=>({id:String(i),path:s.path.slice(0,4096),fileId:s.fileId,kind:s.kind,side:'new',startLine:s.kind==='code'&&Number.isSafeInteger(s.startLine)?s.startLine:null,endLine:s.kind==='code'&&Number.isSafeInteger(s.endLine)?s.endLine:null,summary:typeof s.summary==='string'?s.summary.slice(0,1000):null}));
    if (!sections.length) continue;
    const explanations = {};
    for (const [index,item] of Object.entries(record.explanations||{})) {
      if (!/^\d+$/.test(index) || Number(index)>=sections.length || !item || !Array.isArray(item.explanations)) continue;
      explanations[index]={explanations:item.explanations.slice(0,12).filter(e=>e&&Number.isSafeInteger(e.startLine)&&Number.isSafeInteger(e.endLine)&&typeof e.text==='string').map(e=>({startLine:e.startLine,endLine:e.endLine,text:e.text.slice(0,1400),...(typeof e.title==='string'?{title:e.title.slice(0,100)}:{})})),pointers:(Array.isArray(item.pointers)?item.pointers:[]).slice(0,4).filter(p=>p&&typeof p.text==='string'&&p.citation&&typeof p.citation.path==='string').map(p=>({text:p.text.slice(0,500),citation:{path:p.citation.path,fileId:p.citation.fileId||null,side:p.citation.side,startLine:p.citation.startLine,endLine:p.citation.endLine}})),narration:typeof item.narration==='string'?item.narration.slice(0,15000):''};
    }
    records[record.id]={id:record.id,mode:'deep',snapshotId:record.snapshotId,title:'Deep file review',sections,position:Number.isSafeInteger(record.position)?Math.max(0,Math.min(sections.length-1,record.position)):0,completed:(Array.isArray(record.completed)?record.completed:[]).filter(n=>Number.isSafeInteger(n)&&n>=0&&n<sections.length),explanations,messages:(Array.isArray(record.messages)?record.messages:[]).filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.text==='string'&&Number.isSafeInteger(m.index)&&m.index>=0&&m.index<sections.length).slice(-400).map(m=>({role:m.role,text:m.text.slice(0,64*1024),index:m.index,group:Number.isSafeInteger(m.group)&&m.group>=0?m.group:0})),draft:typeof record.draft==='string'?record.draft.slice(0,8000):'',runId:validId(record.runId)?record.runId:null,group:Number.isSafeInteger(record.group)?Math.max(0,Math.min((explanations[record.position]?.explanations.length||1)-1,record.group)):0,scroll:Number.isFinite(record.scroll)&&record.scroll>=0?record.scroll:0};
  }
  const pending=value?.pending,question=value?.question;
  return {mode:value?.mode==='deep'?'deep':'overview',activeId:validId(value?.activeId)?value.activeId:'',records,question:question&&validId(question.requestId)&&validId(question.recordId)&&Number.isSafeInteger(question.index)&&Number.isSafeInteger(question.group)&&typeof question.question==='string'?{requestId:question.requestId,recordId:question.recordId,index:question.index,group:question.group,question:question.question.slice(0,8000),acknowledged:Boolean(question.acknowledged)}:null,pending:pending&&validId(pending.requestId)&&validId(pending.recordId)&&Number.isSafeInteger(pending.index)?{requestId:pending.requestId,recordId:pending.recordId,index:pending.index,prefetch:Boolean(pending.prefetch),acknowledged:Boolean(pending.acknowledged)}:null};
}

export function createDeepReviewUI({getState,getData,save,render,apiFetch,showSection,choices}) {
  let error='',polling=false,retryTimer,prefetchTimer,focusedSection='',sectionsOpen=false,navigation=0,asking=false,questionTimer,questionError='',partial='';
  const prefetchFailures=new Map(),failedPrefetch=(pending)=>prefetchFailures.set(`${pending.recordId}:${pending.index}`,Date.now());
  const active=()=>workspace()?.mode==='deep'&&getState().guideMode==='walkthrough';
  const player=createDeepAudio({apiFetch,render,next:()=>navigate(1,true),active});
  const workspace=()=>{const s=getState();if(!s.snapshot)return null;getData().deepReviews||={};return getData().deepReviews[keyFor(s.snapshot)]||={mode:'overview',activeId:'',records:{},pending:null,question:null};};
  const current=()=>{const w=workspace();return w?.records[w.activeId];};
  const enabled=()=>getState().online&&getState().aiEnabled&&!getState().demo;
  async function request(path,input) {
    const response=await apiFetch(`/api/guide/deep/${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
    const body=await response.json();if(!response.ok){const failure=new Error(errorMessage(body));failure.status=response.status;throw failure;}return body;
  }
  const stopAudio=()=>player.stop();
  const group=()=>current()?.group||0;
  const item=()=>current()?.explanations[current().position]?.explanations[group()];
  function audioItem(index=current()?.position,g=group()) {
    const r=current(),text=r?.explanations[index]?.explanations[g]?.text;
    return text?{snapshotId:r.snapshotId,id:r.id,index,group:g,text}:null;
  }
  function followingAudio(){const r=current();return audioItem(r.position,group()+1)||audioItem(r.position+1,0);}
  function focusCurrent(force=false,reveal=force){
    const record=current(),position=record?.position,section=record?.sections[position],range=item();
    if(!section)return;
    const key=`${record.id}:${position}:${group()}:${Boolean(range)}`;
    if(!force&&focusedSection===key)return;focusedSection=key;
    const target=range?{...section,startLine:range.startLine,endLine:range.endLine}:section.kind==='summary'?section:{...section,kind:'pending'};
    queueMicrotask(()=>{if(current()?.id===record.id&&current()?.position===position&&focusedSection===key)showSection(target,{reveal});});
  }
  function filePicker(){
    if(!active()||!current())return '';
    const r=current(),section=r.sections[r.position];
    const files=[...new Set(r.sections.map(s=>s.fileId))];
    return `<select id="deep-file" class="context-chip deep-file-select" aria-label="Changed file">${files.map(id=>{const first=r.sections.findIndex(s=>s.fileId===id);return `<option value="${first}" ${id===section.fileId?'selected':''}>${esc(r.sections[first].path)}</option>`;}).join('')}</select>`;
  }
  function html() {
    const record=current(),w=workspace();if(!record)return '<p class="guide-intro">Choose Deep file review to start.</p>';
    const section=record.sections[record.position],explanation=record.explanations[record.position],range=item();
    const fileSections=record.sections.map((s,index)=>({...s,index})).filter(s=>s.fileId===section.fileId);
    const files=[...new Set(record.sections.map(s=>s.fileId))],fileNumber=files.indexOf(section.fileId)+1;
    const cards=fileSections.flatMap(s=>s.kind==='summary'?[{index:s.index,group:0,summary:true}]: (record.explanations[s.index]?.explanations||[]).map((range,g)=>({index:s.index,group:g,...range})));
    const ordinal=cards.findIndex(c=>c.index===record.position&&c.group===group())+1;
    const complete=fileSections.every(s=>s.kind==='summary'||record.explanations[s.index]);
    const atEnd=record.position===record.sections.length-1&&group()>=(explanation?.explanations.length||1)-1;
    const nextRange=explanation?.explanations[group()+1]||record.explanations[record.position+1]?.explanations[0];
    return `<section class="walkthrough deep-review"><p class="eyebrow">DEEP FILE REVIEW · FILE ${fileNumber} OF ${files.length}${ordinal?` · SECTION ${ordinal} OF ${cards.length}${complete?'':' SO FAR'}`:''}</p>
      ${section.kind==='summary'?`<div class="deep-notice"><strong>Coverage notice</strong><p>${esc(section.summary)}</p></div><div class="walk-controls"><button class="secondary-button" data-deep="previous" ${record.position===0?'disabled':''}>Back</button><button class="primary-button" data-deep="next" ${atEnd?'disabled':''}>Next file</button></div>`:range?`<section class="audio-lesson deep-card" id="deep-card" tabindex="0" aria-label="Deep review section" aria-keyshortcuts="ArrowLeft ArrowRight Space">${range.title?`<button class="agent-step-link deep-range" data-deep="show-code">Lines ${range.startLine}–${range.endLine}</button><h4>${esc(range.title)}</h4>`:`<h4><button class="agent-step-link" data-deep="show-code">Lines ${range.startLine}–${range.endLine}</button></h4>`}${player.html(range.text,getState().online)}<div class="lesson-help"><button class="agent-step-link" data-deep-ask="simpler" ${!canAsk()?'disabled':''}>Explain more simply</button><button class="agent-step-link" data-deep-ask="example" ${!canAsk()?'disabled':''}>Another example</button></div><p class="deep-up-next">${nextRange?`Up next · Lines ${nextRange.startLine}–${nextRange.endLine}`:record.sections[record.position+1]?.fileId===section.fileId?'Preparing the next sections…':'End of file · Review when you’re ready'}</p></section>`:`<p role="status">${w.pending?.index===record.position?'Preparing the next sections…':enabled()?'Preparing this file…':getState().online?'Connect Codex or Claude Code to continue.':'This section has not been saved on this device.'}</p><div class="walk-controls"><button class="secondary-button" data-deep="previous" ${record.position===0?'disabled':''}>Back</button><button class="secondary-button" data-deep="next" ${atEnd?'disabled':''}>Next</button></div>`}
      ${explanation?.pointers.length&&group()===explanation.explanations.length-1?`<details class="deep-pointers"><summary>Things to double-check · ${explanation.pointers.length}</summary><ul>${explanation.pointers.map((pointer,index)=>`<li>${esc(pointer.text)} <button class="agent-step-link" data-deep-pointer="${index}">Lines ${pointer.citation.startLine}–${pointer.citation.endLine}</button></li>`).join('')}</ul></details>`:''}
      ${conversation(record)}
      ${cards.length>1?`<details class="deep-section-list" ${sectionsOpen?'open':''}><summary>Sections in this file</summary>${cards.map(c=>`<button class="agent-step-link" data-deep-section="${c.index}" data-deep-group="${c.group}" aria-current="${c.index===record.position&&c.group===group()}">${c.summary?'Coverage notice':`Lines ${c.startLine}–${c.endLine}`}</button>`).join('')}${!complete?'<p>More sections appear as they are prepared.</p>':''}</details>`:''}
      ${error?`<p class="guide-error" role="alert">${esc(error)}</p>${!w.pending&&!explanation?'<button class="secondary-button" data-deep="explain">Retry explanation</button>':''}`:''}${w.pending&&!w.pending.prefetch?'<button class="secondary-button" data-deep="stop">Stop explanation</button>':''}</section>`;
  }
  const canAsk=()=>enabled()&&!workspace()?.question&&!(workspace()?.pending&&!workspace().pending.prefetch);
  function conversation(record) {
    const w=workspace(),waiting=w.question?.recordId===record.id,here=w.question?.index===record.position;
    const messages=(record.messages||[]).filter(m=>m.index===record.position);
    return `<div class="walk-chat deep-chat" role="log" aria-live="polite">${messages.map(m=>`<div class="chat-message ${m.role}">${messageBubble(m.role,m.text)}</div>`).join('')}${waiting&&here?`<div class="chat-message assistant ${partial?'':'pending'}">${partial?messageBubble('assistant',partial):'<div class="message-bubble">Thinking about these lines…</div>'}</div>`:''}</div>
      ${questionError?`<p class="guide-error" role="alert">${esc(questionError)}</p>`:''}
      <form id="deep-question" class="deep-question"><label class="sr-only" for="deep-draft">Ask about this section</label><textarea id="deep-draft" rows="2" maxlength="8000" placeholder="Ask about these lines…">${esc(record.draft||'')}</textarea><div class="composer-bottom"><span>${waiting&&!here?'Answering a question on another section…':''}</span><button class="send-control" type="${waiting?'button':'submit'}" ${waiting?'data-deep="stop-question"':''} aria-label="${waiting?'Stop response':'Send question'}" ${!waiting&&!canAsk()?'disabled':''}>${icon(waiting?'stop':'send')}</button></div></form>`;
  }
  async function ask(text) {
    const r=current(),w=workspace(),question=String(text??r?.draft??'').trim();
    if(!r||!question||!canAsk())return;
    player.pause();
    if(text===undefined)r.draft='';
    r.messages||=[];r.messages.push({role:'user',text:question,index:r.position,group:group()});
    w.question={requestId:randomId(),recordId:r.id,index:r.position,group:group(),question,acknowledged:false};questionError='';partial='';
    await save();render(false);pollQuestion();
  }
  async function pollQuestion(){const w=workspace(),q=w?.question;clearTimeout(questionTimer);questionTimer=null;if(!q||asking||!getState().online)return;asking=true;try{
    if(!q.acknowledged){await request('question',{requestId:q.requestId,conversationId:q.recordId,question:q.question,index:q.index,group:q.group,...choices()});q.acknowledged=true;await save();}
    const response=await apiFetch(`/api/guide/run?id=${encodeURIComponent(q.requestId)}`);const {run}=await response.json();if(!response.ok||!run)throw new Error('The question run is unavailable.');
    partial=run.text||'';questionError='';
    if(!['running','stopping'].includes(run.status)){const reply=await apiFetch(`/api/guide/conversation?id=${encodeURIComponent(q.recordId)}`);const {conversation}=await reply.json();const local=w.records[q.recordId];if(reply.ok&&conversation?.mode==='deep'&&local)local.messages=conversation.messages||local.messages;w.question=null;partial='';if(run.status!=='completed')questionError=run.error||'The guide stopped before answering.';await save();}
    render(false);
  }catch(e){if(e.status>=400&&e.status<500&&e.status!==429){w.question=null;questionError=`${errorMessage(e.message)} Your question is saved here; you can ask again.`;}else questionError=`${errorMessage(e.message)} Reconnecting will check the same answer.`;render(false);}finally{asking=false;if(w.question)questionTimer=setTimeout(pollQuestion,questionError?5000:1000);}}
  async function start(){if(!getState().online)return;const id=randomId(),snapshotId=getState().snapshot.snapshotId;error='';try{const {conversation}=await request('start',{requestId:id,snapshotId});const w=workspace();w.records[id]=conversation;w.activeId=id;w.mode='deep';await save();render(false);queueMicrotask(()=>ensureSection(0));}catch(e){error=errorMessage(e.message);render();}}
  async function poll(){const w=workspace(),pending=w?.pending;if(!pending||polling||!getState().online)return;polling=true;clearTimeout(retryTimer);try{
    if(!pending.acknowledged){const {model,effort}=choices();const result=await request('section',{requestId:pending.requestId,conversationId:pending.recordId,index:pending.index,prefetch:pending.prefetch,model,effort});pending.acknowledged=true;if(result.cached){const local=w.records[pending.recordId];w.records[pending.recordId]={...result.conversation,position:local.position,group:local.group||0,draft:local.draft||'',messages:local.messages||result.conversation.messages||[]};w.pending=null;await save();render();return;}await save();}
    const response=await apiFetch(`/api/guide/run?id=${encodeURIComponent(pending.requestId)}`);const {run}=await response.json();if(!response.ok||!run)throw new Error('The section run is unavailable.');
    if(!['running','stopping'].includes(run.status)){const response=await apiFetch(`/api/guide/conversation?id=${encodeURIComponent(pending.recordId)}`);const {conversation}=await response.json();if(response.ok&&conversation?.mode==='deep'){const local=w.records[pending.recordId];w.records[pending.recordId]={...conversation,position:local.position,completed:local.completed,scroll:local.scroll,group:local.group||0,draft:local.draft||'',messages:local.messages||conversation.messages||[]};}if(pending.prefetch&&run.status!=='completed')failedPrefetch(pending);w.pending=null;error=run.status==='completed'||pending.prefetch?'':run.error||'Section explanation stopped.';await save();render();if(run.status==='completed')schedulePrefetch();}
    else render();
  }catch(e){if(pending.prefetch){failedPrefetch(pending);w.pending=null;error='';}else if(e.status>=400&&e.status<500&&e.status!==429){w.pending=null;error=errorMessage(e.message);}else error=`${errorMessage(e.message)} Reconnecting will resume this section.`;render();}finally{polling=false;if(w.pending)retryTimer=setTimeout(poll,error?5000:1000);}}
  function ensureSection(index,prefetch=false){const w=workspace(),record=current();if(!record||!enabled()||w.pending||record.explanations[index]||record.sections[index]?.kind!=='code')return;w.pending={requestId:randomId(),recordId:record.id,index,prefetch,acknowledged:false};error='';save();render();poll();}
  // Keep up to two code sections ready ahead of the reader; each completion schedules the next.
  function schedulePrefetch(){clearTimeout(prefetchTimer);const r=current();if(!r)return;let next=-1;for(let i=r.position+1,ahead=0;i<r.sections.length&&ahead<2;i++){if(r.sections[i].kind!=='code')continue;ahead++;if(!r.explanations[i]){next=i;break;}}if(next<0||Date.now()-(prefetchFailures.get(`${r.id}:${next}`)||0)<30_000)return;prefetchTimer=setTimeout(()=>{if(getState().guideMode==='walkthrough'&&enabled()&&!workspace().pending&&current()===r)ensureSection(next,true);},2000);}
  async function cancelPrefetch(){clearTimeout(prefetchTimer);const w=workspace();if(!w?.pending?.prefetch)return;for(let attempt=0;polling&&attempt<30;attempt++)await new Promise(resolve=>setTimeout(resolve,100));const pending=w.pending;if(!pending?.prefetch)return;
    if(pending.acknowledged&&getState().online){await apiFetch('/api/guide/stop',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:pending.requestId})}).catch(()=>{});for(let attempt=0;attempt<30;attempt++){const response=await apiFetch(`/api/guide/run?id=${encodeURIComponent(pending.requestId)}`).catch(()=>null);const run=response?.ok?(await response.json()).run:null;if(!run||!['running','stopping'].includes(run.status))break;await new Promise(resolve=>setTimeout(resolve,100));}}
    if(w.pending===pending){w.pending=null;clearTimeout(retryTimer);retryTimer=null;await save();render();}
  }
  async function move(index,g=0,autoplay=false){
    clearTimeout(prefetchTimer);const r=current();if(!r||index<0||index>=r.sections.length)return;
    const own=++navigation;stopAudio();
    if(index!==r.position&&workspace().pending?.prefetch&&workspace().pending.index!==index)await cancelPrefetch();
    if(own!==navigation||current()?.id!==r.id)return;
    if(autoplay)player.requestAutoplay();if(index>r.position&&!r.completed.includes(r.position))r.completed.push(r.position);
    r.position=index;r.group=Math.max(0,Math.min((r.explanations[index]?.explanations.length||1)-1,g));r.scroll=0;error='';
    await save();if(own!==navigation)return;render(false);
    document.getElementById('deep-card')?.focus({preventScroll:true});
    if(getState().online)request('advance',{conversationId:r.id,position:index,completed:r.completed,group:r.group}).catch(()=>{});
    ensureSection(index);schedulePrefetch();
  }
  function navigate(direction,autoplay=false){const r=current(),count=r.explanations[r.position]?.explanations.length||1;
    if(direction>0&&group()+1<count)return move(r.position,group()+1,autoplay);
    if(direction<0&&group()>0)return move(r.position,group()-1);
    const index=r.position+direction;return move(index,direction<0?(r.explanations[index]?.explanations.length||1)-1:0,autoplay);
  }
  function selectFile(fileId){if(!active()||!current())return false;const r=current();if(r.sections[r.position].fileId===fileId)return false;const index=r.sections.findIndex(s=>s.fileId===fileId);if(index<0)return false;move(index);return true;}
  function bind(root){
    const w=workspace(),r=current();if(!r)return;
    root.querySelector('#deep-file')?.addEventListener('change',e=>move(Number(e.target.value)));
    root.querySelectorAll('[data-deep-section]').forEach(el=>el.addEventListener('click',()=>move(Number(el.dataset.deepSection),Number(el.dataset.deepGroup))));
    root.querySelectorAll('[data-deep-pointer]').forEach(el=>el.addEventListener('click',()=>{stopAudio();showSection({kind:'code',...current().explanations[current().position].pointers[Number(el.dataset.deepPointer)].citation},{reveal:true});}));
    root.querySelector('.deep-section-list')?.addEventListener('toggle',e=>{sectionsOpen=e.target.open;});
    root.querySelector('#deep-draft')?.addEventListener('input',e=>{current().draft=e.target.value;save();});
    root.querySelector('#deep-draft')?.addEventListener('focus',()=>player.pause());
    root.querySelector('#deep-question')?.addEventListener('submit',e=>{e.preventDefault();ask();});
    root.querySelectorAll('[data-deep-ask]').forEach(el=>el.addEventListener('click',()=>{const text=item()?.text;if(text)ask(`${el.dataset.deepAsk==='simpler'?'Explain this more simply, defining unfamiliar concepts':'Give another concrete example for this'}: ${text}`);}));
    const card=root.querySelector('#deep-card');
    if(card){card.querySelector('[data-deep="previous"]').disabled=r.position===0&&group()===0;card.querySelector('[data-deep="next"]').disabled=r.position===r.sections.length-1&&group()===(r.explanations[r.position]?.explanations.length||1)-1;}
    root.querySelectorAll('[data-deep]').forEach(el=>el.addEventListener('click',async()=>{switch(el.dataset.deep){
      case 'explain':error='';ensureSection(r.position);break;
      case 'previous':await navigate(-1);break;
      case 'next':await navigate(1);break;
      case 'show-code':focusCurrent(true);break;
      case 'play':focusCurrent(true,false);if(el.textContent==='Retry audio')await player.retry(audioItem(),followingAudio());else await player.play();break;
      case 'stop-question':if(w.question?.acknowledged){await apiFetch('/api/guide/stop',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:w.question.requestId})}).catch(()=>{});pollQuestion();}else if(w.question){w.question=null;await save();render(false);}break;
      case 'stop':if(w.pending){await apiFetch('/api/guide/stop',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:w.pending.requestId})}).catch(()=>{});poll();}break;
    }}));
    card?.addEventListener('keydown',e=>{if(e.defaultPrevented||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||e.target.closest('input,select,summary'))return;
      if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();e.stopPropagation();if(!e.repeat)navigate(e.key==='ArrowLeft'?-1:1);}
      else if(e.code==='Space'&&!e.target.closest('button,a')){e.preventDefault();e.stopPropagation();if(!e.repeat)player.play();}
    });
    player.bind(root,audioItem(),followingAudio(),getState().online);
    if(w?.pending&&!polling&&!retryTimer)queueMicrotask(poll);
    if(w?.question&&!asking&&!questionTimer)queueMicrotask(pollQuestion);
    if(!error&&!r.explanations[r.position]&&enabled()&&!w.pending)queueMicrotask(()=>ensureSection(r.position));
    if(r.explanations[r.position]&&!w.pending)schedulePrefetch();
    focusCurrent();
  }
  return {html,bind,start,current,workspace,stopAudio,cancelPrefetch,focusCurrent,filePicker,selectFile};
}
