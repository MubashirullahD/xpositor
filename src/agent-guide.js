import { createAudioLesson, sanitizeLessons } from './audio-lesson.js';
import { escapeHtml as esc, icon } from './render.js';
import { randomId } from './platform.js';
import { errorMessage } from './transport.js';
const idValid = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(value);
const text = (value, max = 8000) => typeof value === 'string' ? value.slice(0, max) : '';
const keyFor = snapshot => JSON.stringify([snapshot.repoId, snapshot.snapshotId]);
export function sanitizeAgentWorkspace(value) {
  const records = {};
  for (const record of Object.values(value?.records || {}).slice(0, 128)) {
    if (!idValid(record?.id) || typeof record.snapshotId !== 'string') continue;
    let guide = null;
    if (record.guide && Array.isArray(record.guide.steps) && record.guide.steps.length && record.guide.steps.length <= 2000) {
      guide = { title:text(record.guide.title,140),summary:text(record.guide.summary,4000),assumptions:(Array.isArray(record.guide.assumptions)?record.guide.assumptions:[]).filter(v=>typeof v==='string').slice(0,30),
        steps:record.guide.steps.filter(step=>step&&typeof step==='object').map(step=>({title:text(step.title,180),explanation:text(step.explanation,6000),files:(Array.isArray(step.files)?step.files:[]).slice(0,2000).filter(f=>f&&typeof f.path==='string'&&typeof f.fileId==='string').map(f=>({path:f.path,fileId:f.fileId})),citations:(Array.isArray(step.citations)?step.citations:[]).slice(0,30).filter(c=>c&&typeof c.path==='string'&&['new','old'].includes(c.side)&&Number.isInteger(c.startLine)&&Number.isInteger(c.endLine)&&c.startLine>0&&c.endLine>=c.startLine&&c.endLine-c.startLine<80).map(c=>({path:c.path,fileId:typeof c.fileId==='string'?c.fileId:null,side:c.side,startLine:c.startLine,endLine:c.endLine}))})),
        coverage:(Array.isArray(record.guide.coverage)?record.guide.coverage:[]).slice(0,2000).filter(c=>c&&typeof c==='object').map(c=>({path:text(c.path,4096),sourceRead:Boolean(c.sourceRead),diffExamined:Boolean(c.diffExamined),reason:text(c.reason,500)})),
        totalChangedFiles:Math.max(0,Number(record.guide.totalChangedFiles)||0) };
    }
    if(guide&&!guide.steps.length)guide=null;
    records[record.id] = {id:record.id,snapshotId:record.snapshotId,parentId:idValid(record.parentId)?record.parentId:null,title:text(record.title,140),guide,lessons:sanitizeLessons(record.lessons),lessonPosition:Object.fromEntries(Object.entries(record.lessonPosition||{}).filter(([key,n])=>/^\d{1,4}$/.test(key)&&Number.isInteger(n)&&n>=0&&n<8)),step:Math.max(0,Math.min((guide?.steps.length||1)-1,Number.isInteger(record.step)?record.step:0)),finished:Boolean(record.finished),scroll:Number.isFinite(record.scroll)?Math.max(0,record.scroll):0,overviewOpen:Boolean(record.overviewOpen),draft:text(record.draft),runId:idValid(record.runId)?record.runId:null,messages:(Array.isArray(record.messages)?record.messages:[]).filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.text==='string').slice(-2000).map(m=>({role:m.role,text:text(m.text,256*1024)}))};
  }
  const pending = value?.pending;
  return {records,activeId:idValid(value?.activeId)?value.activeId:'',pending:pending&&idValid(pending.input?.requestId)&&['start','question','lesson'].includes(pending.action)?{action:pending.action,input:JSON.parse(JSON.stringify(pending.input)),recordId:text(pending.recordId,80),acknowledged:Boolean(pending.acknowledged)}:null};
}

export function createAgentGuideUI({getState,getData,save,render,apiFetch,jump}) {
  let polling=false,error='',activity='',partial='',source=null,sourceError='',retryTimer;
  const workspace=()=>{const state=getState();if(!state.snapshot)return null;getData().agentGuides||={};return getData().agentGuides[keyFor(state.snapshot)]||=( {records:{},activeId:'',pending:null} );};
  const current=()=>{const w=workspace();return w?.records[w.activeId];};
  const captureScroll=()=>{const record=current(),panel=document.querySelector('.walkthrough-scroll');if(record&&panel)record.scroll=panel.scrollTop;};
  function selectConversation(id){captureScroll();workspace().activeId=id;source=null;error='';save();render(false);}
  const enabled=()=>getState().online&&getState().aiEnabled&&!getState().demo;
  const choices=()=>({model:getData().preferences.model||undefined,effort:getData().preferences.effort||undefined});
  const player=createAudioLesson({current,apiFetch,save,render,jump,ask:question=>{current().draft=question;ask();}});
  async function request(path, input) {
    const response=await apiFetch(`/api/guide/${path}`,input===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
    const body=await response.json();if(!response.ok){const failure=new Error(errorMessage(body));failure.status=response.status;throw failure;}return body;
  }
  function html() {
    const state=getState(),w=workspace(),record=current(),pending=Boolean(w?.pending);
    if(!state.snapshot?.files.length)return '<p class="guide-intro">No changes to walk through in this scope.</p>';
    const status=`${error?`<p role="alert" class="guide-error">${esc(error)}</p>`:''}${pending?`<p class="agent-activity" role="status">${esc(activity||'Reading the captured repository…')}</p>`:''}`;
    if(!record)return `<section class="walkthrough"><h3>Walk me through these changes</h3><p>Start with the big picture, then follow the code together.</p><button class="primary-button" data-agent="start" ${!enabled()||pending?'disabled':''}>Start walkthrough</button>${status}</section>`;
    const guide=record.guide,step=guide?.steps[record.step];
    const branches=Object.values(w.records);
    const unexamined=guide?.coverage.filter(file=>!file.sourceRead&&!file.diffExamined)||[];
    return `<section class="walkthrough agent-walkthrough">
      ${branches.length>1?`<label class="agent-conversations">Conversation <select id="agent-conversation">${branches.map(r=>`<option value="${esc(r.id)}" ${r.id===record.id?'selected':''}>${esc(r.parentId?'↳ '+r.title:r.title||'Main walkthrough')}</option>`).join('')}</select></label>`:''}
      ${record.parentId?'<button class="secondary-button" data-agent="parent">← Back to walkthrough</button>':''}
      ${guide?`<details class="agent-overview" ${record.overviewOpen?'open':''}><summary>${esc(guide.title)}</summary><p>${esc(guide.summary)}</p><p>${guide.totalChangedFiles} changed files in the plan.</p>${guide.assumptions.map(a=>`<p>${esc(a)}</p>`).join('')}${unexamined.length?`<details><summary>${unexamined.length} files not examined</summary><ul>${unexamined.map(f=>`<li>${esc(f.path)}${f.reason?': '+esc(f.reason):''}</li>`).join('')}</ul></details>`:''}<ol>${guide.steps.map((s,i)=>`<li><button class="agent-step-link" data-agent-step="${i}">${esc(s.title)}</button></li>`).join('')}</ol></details>
      ${record.lessons?.[record.step]?'':`<p class="eyebrow">${record.parentId?'EXPLORING':'STEP '+(record.step+1)+' OF '+guide.steps.length}</p><h3 id="agent-step-title" tabindex="-1">${esc(step.title)}</h3><p class="step-explanation">${esc(step.explanation)}</p>
      <div class="guide-citations">${step.citations.map((c,i)=>`<button class="secondary-button" data-agent-citation="${i}">${esc(c.path)} · ${c.side} ${c.startLine}–${c.endLine}</button>`).join('')}</div>`}
      ${!record.lessons?.[record.step]&&!record.parentId?`<div class="walk-controls"><button class="secondary-button" data-agent="previous" ${record.step===0?'disabled':''}>Back</button><button class="primary-button" data-agent="next" ${record.finished?'disabled':''}>${record.finished?'Walkthrough complete ✓':record.step===guide.steps.length-1?'Finish':'Next'}</button></div>`:''}`:'<h3>Putting the walkthrough together</h3>'}
      ${guide?`${record.lessons?.[record.step]?player.html()+`<button class="agent-step-link" data-agent="next" ${record.finished?'disabled':''}>${record.finished?'Chapter complete ✓':record.step===guide.steps.length-1?'Finish walkthrough':'Next chapter'}</button>`:`<button class="secondary-button" data-agent="lesson" ${pending||!enabled()?'disabled':''}>Teach this chapter · audio pilot</button>`}`:''}
      ${source?`<section class="agent-source"><header><strong>${esc(source.path)}</strong><button class="icon-button" data-agent="close-source" aria-label="Close supporting code">${icon('close')}</button></header>${sourceError?`<p role="alert">${esc(sourceError)}</p>`:`<pre tabindex="0">${esc(source.text)}</pre>`}</section>`:''}
      <div class="walk-chat" role="log" aria-live="polite">${record.messages.map(m=>`<div class="chat-message ${m.role}"><div class="message-bubble">${esc(m.text)}</div></div>`).join('')}${pending&&w.pending.recordId===record.id&&guide&&pending&&w.pending.action!=='lesson'&&partial?`<div class="chat-message assistant"><div class="message-bubble">${esc(partial)}</div></div>`:''}</div>
      ${status}
      ${guide?`<form id="agent-question"><label class="sr-only" for="agent-draft">Ask your guide</label><textarea id="agent-draft" rows="2" maxlength="8000" placeholder="Ask your guide…">${esc(record.draft||'')}</textarea><div class="composer-bottom"><button class="icon-button" type="button" data-agent="branch" aria-label="Explore in a separate conversation" title="Explore in a separate conversation" ${pending||!enabled()?'disabled':''}>${icon('branch')}</button><button class="send-control" type="${pending?'button':'submit'}" ${pending?'data-agent="stop"':''} aria-label="${pending?'Stop response':'Send question'}" ${!pending&&!enabled()?'disabled':''}>${icon(pending?'stop':'send')}</button></div></form>`:pending?'<button class="secondary-button" data-agent="stop">Stop</button>':''}
      ${!pending?`<button class="agent-step-link" data-agent="start" ${!enabled()?'disabled':''}>New walkthrough</button>`:''}
    </section>`;
  }
  async function submit(action, input, record) {
    const w=workspace();if(w.pending)return;
    player.pause();captureScroll();error='';activity='';partial='';source=null;w.records[record.id]=record;w.activeId=record.id;
    w.pending={action,input,recordId:record.id,acknowledged:false};await save();render(false);poll();
  }
  async function start() {
    if(!enabled()||workspace().pending)return;
    const state=getState(),id=randomId();
    return submit('start',{requestId:id,snapshotId:state.snapshot.snapshotId,selectedPath:state.snapshot.files.find(f=>f.id===state.selectedFile)?.path,...choices()}, {id,snapshotId:state.snapshot.snapshotId,parentId:null,title:'Main walkthrough',step:0,guide:null,messages:[],draft:'',runId:id});
  }
  async function ask(branch=false) {
    const parent=current();if(!parent?.draft.trim()||!enabled()||workspace().pending)return;
    const question=parent.draft.trim(),id=randomId();parent.draft='';
    const record=branch?{...structuredClone(parent),id,parentId:parent.id,title:question.slice(0,80),draft:'',scroll:0,runId:id}:parent;
    record.messages.push({role:'user',text:question});record.runId=id;
    return submit('question',{requestId:id,conversationId:parent.id,question,step:parent.step,branch,...choices()},record);
  }
  async function poll() {
    clearTimeout(retryTimer);retryTimer=null;
    const w=workspace(),pending=w?.pending;if(polling||!pending||!getState().online)return;
    polling=true;
    try {
      if(!pending.acknowledged){await request(pending.action,pending.input);pending.acknowledged=true;await save();}
      const {run}=await request(`run?id=${encodeURIComponent(pending.input.requestId)}`);
      if(!run)throw new Error('The laptop did not return this guide run.');
      activity=run.activity?.path?`Reading ${run.activity.path}`:run.activity?.tool==='review_search'?'Finding related code…':run.status==='stopping'?'Stopping…':'Your guide is thinking…';
      partial=run.text||'';error='';
      if(!['running','stopping'].includes(run.status)) {
        const {conversation}=await request(`conversation?id=${encodeURIComponent(pending.recordId)}`);
        const old=w.records[pending.recordId];
        w.records[pending.recordId]={...conversation,draft:old?.draft||'',finished:old?.finished||false,scroll:old?.scroll||0,overviewOpen:old?.overviewOpen||false,lessonPosition:old?.lessonPosition||{}};
        w.pending=null;partial='';activity='';
        if(run.status!=='completed')error=run.error||'The guide stopped before finishing.';else if(conversation.persistenceError)error=conversation.persistenceError;
        await save();
      }
      if(workspace()===w)render();
    } catch(e) {if(e.status>=400&&e.status<500&&e.status!==429){w.pending=null;await save();error=`${errorMessage(e.message)} Your saved conversation remains here; you can try again.`;}else error=`${errorMessage(e.message)} Your request is saved; reconnecting will check the same response.`;if(workspace()===w)render();}
    finally {polling=false;if(w.pending&&workspace()===w)retryTimer=setTimeout(()=>{retryTimer=null;poll();},error?5000:1000);}
  }
  async function move(step) {
    const record=current();record.step=step;record.finished=false;source=null;await save();render();
    try{await request('step',{conversationId:record.id,step});}catch(e){error=errorMessage(e.message);render();}
  }
  async function citation(index) {
    const c=current().guide.steps[current().step].citations[index];if(c.fileId){jump(c);return;}
    const record=current(), loading={path:c.path,text:'Loading captured code…'};source=loading;sourceError='';render();
    try{const value=await request(`source?snapshotId=${encodeURIComponent(record.snapshotId)}&path=${encodeURIComponent(c.path)}`);if(source!==loading||current()!==record)return;if(value.source===null)throw new Error(value.reason||'Source unavailable.');const lines=value.source.split('\n');source={path:c.path,text:lines.slice(Math.max(0,c.startLine-4),c.endLine+3).map((line,i)=>`${Math.max(1,c.startLine-3)+i} | ${line}`).join('\n')};}catch(e){if(source!==loading||current()!==record)return;sourceError=errorMessage(e.message);}render();
  }
  function bind(root) {
    player.bind(root);
    root.querySelector('.agent-overview')?.addEventListener('toggle',e=>{if(current()){current().overviewOpen=e.target.open;save();}});
    root.querySelector('#agent-draft')?.addEventListener('input',e=>{current().draft=e.target.value;save();});
    root.querySelector('#agent-question')?.addEventListener('submit',e=>{e.preventDefault();ask();});
    root.querySelector('#agent-conversation')?.addEventListener('change',e=>{selectConversation(e.target.value);});
    root.querySelectorAll('[data-agent-step]').forEach(el=>el.addEventListener('click',()=>move(Number(el.dataset.agentStep))));
    root.querySelectorAll('[data-agent-citation]').forEach(el=>el.addEventListener('click',()=>citation(Number(el.dataset.agentCitation))));
    root.querySelectorAll('[data-agent]').forEach(el=>el.addEventListener('click',async()=>{
      const record=current();
      switch(el.dataset.agent){
        case 'lesson':await submit('lesson',{requestId:randomId(),conversationId:record.id,step:record.step,...choices()},record);break;
        case 'start':await start();break;
        case 'branch':await ask(true);break;
        case 'stop':try{await request('stop',{requestId:workspace().pending.input.requestId});poll();}catch(e){error=errorMessage(e.message);render();}break;
        case 'parent':selectConversation(record.parentId);break;
        case 'previous':await move(record.step-1);break;
        case 'next':if(record.step<record.guide.steps.length-1)await move(record.step+1);else{record.finished=true;save();render();}break;
        case 'close-source':source=null;render();break;
      }
    }));
    if(workspace()?.pending&&!polling&&!retryTimer)queueMicrotask(poll);
  }
  return {html,bind};
}
