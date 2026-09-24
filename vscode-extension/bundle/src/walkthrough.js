import { prepare, finishPreparation, restInvitation } from './preparation.js';
import { createAgentGuideUI } from './agent-guide.js';
import { createDeepReviewUI } from './deep-review.js';
import { escapeHtml as esc } from './render.js';
import { readReply, errorMessage } from './transport.js';

export const walkthroughKey = (snapshot) => JSON.stringify([snapshot.repoId, snapshot.snapshotId]);
export function sanitizeWalkthrough(value) {
  if (!value || typeof value !== 'object' || typeof value.selectedId !== 'string' || !value.guide || !Array.isArray(value.guide.steps) || value.guide.steps.length < 3 || value.guide.steps.length > 6) return null;
  const text = (v, max) => typeof v === 'string' && v.length <= max ? v : '';
  const citation=c=>c && typeof c.fileId==='string' && ['old','new'].includes(c.side) && Number.isInteger(c.startLine) && Number.isInteger(c.endLine) && c.startLine>0 && c.endLine>=c.startLine && c.endLine-c.startLine<80;
  const steps = value.guide.steps.map((step) => ({ title:text(step?.title,180), explanation:text(step?.explanation,3200), reviewPointers:(Array.isArray(step?.reviewPointers)?step.reviewPointers:[]).slice(0,4).filter(p=>p&&typeof p.text==='string'&&citation(p.citation)).map(p=>({text:text(p.text,500),citation:{fileId:p.citation.fileId,side:p.citation.side,startLine:p.citation.startLine,endLine:p.citation.endLine}})), citations:(Array.isArray(step?.citations)?step.citations:[]).slice(0,8).filter(citation).map(({fileId,side,startLine,endLine})=>({fileId,side,startLine,endLine})) }));
  if (steps.some((s)=>!s.title||!s.explanation||!s.citations.length)) return null;
  const chats={};
  for(let i=0;i<steps.length;i++) chats[i]=(Array.isArray(value.chats?.[i])?value.chats[i]:[]).filter((m)=>m&&['user','assistant'].includes(m.role)&&typeof m.text==='string').map((m)=>({role:m.role,text:m.pending?'This response was interrupted. Ask again.':m.text,error:Boolean(m.error||m.pending)}));
  return { scroll:Number.isFinite(value.scroll)&&value.scroll>=0?value.scroll:0, selectedId:value.selectedId, fileIds:Array.isArray(value.fileIds)?value.fileIds.filter((id)=>typeof id==='string').slice(0,12):undefined, guide:{title:text(value.guide.title,140),summary:text(value.guide.summary,1600),assumptions:(Array.isArray(value.guide.assumptions)?value.guide.assumptions:[]).filter((s)=>typeof s==='string').slice(0,12),steps}, scope:{includedPaths:(Array.isArray(value.scope?.includedPaths)?value.scope.includedPaths:[]).filter((s)=>typeof s==='string'),excludedCount:Math.max(0,Number(value.scope?.excludedCount)||0)}, step:Math.min(steps.length-1,Math.max(0,Number.isInteger(value.step)?value.step:0)), understood:Array.isArray(value.understood)?value.understood.filter((i)=>Number.isInteger(i)&&i>=0&&i<steps.length):[],draft:text(value.draft,1600),chats };
}

export function createWalkthroughUI({getState,getData,save,render,apiFetch,jump,showSection}) {
  const agent = createAgentGuideUI({getState,getData,save,render,apiFetch,jump});
  const deep = createDeepReviewUI({getState,getData,save,render,apiFetch,jump,showSection});
  const useAgent = () => getState().repositoryGuide || Boolean(getState().snapshot && getData().agentGuides?.[walkthroughKey(getState().snapshot)]);
  let controller, pending=false, preparingWalk=false, error='', setup={depth:'standard',timeMinutes:15,scope:'auto'};
  const current=()=>{const s=getState();return s.snapshot?getData().walkthroughs[walkthroughKey(s.snapshot)]:null;};
  const enabled=()=>{const s=getState();return s.aiEnabled&&s.online&&!s.demo;};
  function html() {
    if(deep.workspace()?.mode==='deep'&&deep.current())return deep.html();
    const deepChoice=getState().snapshot?.files.length?`<div class="deep-mode-choice"><p>Examine every changed file, section by section.</p><button class="secondary-button" data-walk-mode="deep" ${!getState().online?'disabled':''}>Start Deep file review</button>${deep.current()?'<button class="agent-step-link" data-walk-mode="resume-deep">Resume saved deep review</button>':''}</div>`:'';
    if(useAgent())return agent.html()+deepChoice;
    const state=getState(), walk=current(), disabled=!enabled()||pending;
    if(!state.snapshot?.files.length)return '<p class="guide-intro">Choose a changed file to start a walkthrough.</p>';
    const status=`${pending&&preparingWalk?restInvitation():''}${error?`<p class="guide-error" role="alert">${esc(error)}</p>`:''}${pending?'<p role="status">The guide is thinking…</p><button class="secondary-button" data-walk="stop">Stop</button>':''}`;
    if(!walk)return `<section class="walkthrough"><h3>Walk me through it</h3><p>Trace the change, examine an edge case, then decide what to verify. Notes stay private.</p><button class="primary-button" data-walk="start" ${disabled?'disabled':''}>Start overview walkthrough</button><p class="guide-intro">${esc(state.aiMessage||'Requires a connected laptop and provider.')} Context includes captured code and your questions.</p><details><summary>Customize overview</summary><label>Depth <select id="guide-depth">${['brief','standard','deep'].map((d)=>`<option ${setup.depth===d?'selected':''}>${d}</option>`).join('')}</select></label><label>Time <select id="guide-time">${[5,15,30].map((n)=>`<option value="${n}" ${setup.timeMinutes===n?'selected':''}>${n} minutes</option>`).join('')}</select></label><label>Context <select id="guide-scope"><option value="auto" ${setup.scope==='auto'?'selected':''}>Related changed files (up to 8)</option><option value="selected" ${setup.scope==='selected'?'selected':''}>Only this file</option></select></label></details>${status}</section>${deepChoice}`;
    const step=walk.guide.steps[walk.step], chats=walk.chats[walk.step]||[];
    return `<section class="walkthrough"><h3>${esc(walk.guide.title)}</h3><details><summary>Overview & scope</summary><p>${esc(walk.guide.summary)}</p><details><summary>${walk.scope.includedPaths.length} files included · ${walk.scope.excludedCount} outside this context</summary><ul>${walk.scope.includedPaths.map((p)=>`<li>${esc(p)}</li>`).join('')}</ul>${walk.guide.assumptions.map((a)=>`<p>${esc(a)}</p>`).join('')}</details></details><p class="eyebrow">STEP ${walk.step+1} OF ${walk.guide.steps.length}</p><h4 tabindex="-1" id="walk-step-title">${esc(step.title)}</h4><p class="step-explanation">${esc(step.explanation)}</p><div class="guide-citations">${step.citations.map((c,i)=>`<button class="secondary-button" data-citation="${i}">${esc(state.snapshot.files.find((f)=>f.id===c.fileId)?.path||'Unavailable file')} · ${c.side} ${c.startLine}–${c.endLine}</button>`).join('')}</div><div class="review-question"><strong>Things to double-check</strong>${step.reviewPointers.length?`<ul>${step.reviewPointers.map((p,i)=>`<li>${esc(p.text)} <button class="agent-step-link" data-walk-pointer="${i}">View lines ${p.citation.startLine}–${p.citation.endLine}</button></li>`).join('')}</ul>`:'<p>No specific concern identified from captured context. This does not verify the change.</p>'}</div><div class="walk-controls"><button class="secondary-button" data-walk="previous" ${walk.step===0||pending?'disabled':''}>Back</button><button class="primary-button" data-walk="understood" ${pending||(walk.step===walk.guide.steps.length-1&&walk.understood.includes(walk.step))?'disabled':''}>${walk.step<walk.guide.steps.length-1?'Next':walk.understood.includes(walk.step)?'Complete ✓':'Finish'}</button></div><div class="walk-chat" role="log" aria-live="polite">${chats.map((m)=>`<div class="chat-message ${m.role}"><div class="message-bubble">${esc(m.text)}</div></div>`).join('')}</div><form id="walk-question"><label for="walk-draft">Ask about this step</label><textarea id="walk-draft" maxlength="1600" rows="2">${esc(walk.draft)}</textarea><button class="primary-button" ${disabled?'disabled':''}>Ask guide</button></form>${status}<button class="secondary-button" data-walk="restart" ${pending?'disabled':''}>New walkthrough</button></section>`;
  }
  async function start() {
    const state=getState(),snapshot=state.snapshot,selectedId=state.selectedFile;
    if(!enabled()||pending)return;
    preparingWalk=true;prepare('legacy:'+snapshot.snapshotId,'Your walkthrough');pending=true;error='';controller=new AbortController();render();
    try {
      const fileIds=setup.scope==='selected'?[selectedId]:undefined;
      const response=await apiFetch('/api/walkthrough',{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(11*60*1000)]),body:JSON.stringify({model:getState().aiProvider==='codex'?getData().preferences.model||undefined:undefined,effort:getState().aiProvider==='codex'?getData().preferences.effort||undefined:undefined,snapshotId:snapshot.snapshotId,selectedId,fileIds,depth:setup.depth,timeMinutes:setup.timeMinutes})});
      const body=await response.json();if(!response.ok)throw new Error(errorMessage(body,'The walkthrough could not start.'));
      const walk=sanitizeWalkthrough({...body,fileIds,step:0,understood:[],chats:{},draft:''});if(!walk)throw new Error('The walkthrough response is invalid.');
      getData().walkthroughs[walkthroughKey(snapshot)]=walk;save();
    }catch(e){error=controller.signal.aborted?'Stopped. Your existing review is unchanged.':errorMessage(e.message);}
    finally{finishPreparation('legacy:'+snapshot.snapshotId,error?(controller.signal.aborted?'cancelled':'error'):'ready');preparingWalk=false;pending=false;controller=null;render();}
  }
  async function followup(question) {
    const walk=current(),snapshot=getState().snapshot,stepIndex=walk?.step;
    if(!walk||!question.trim()||!enabled()||pending)return;
    const messages=walk.chats[stepIndex]||=[];
    const history=messages.filter((m)=>!m.error&&!m.pending).map(({role,text})=>({role,text}));
    // Keep limits visible; never silently discard the conversation.
    if(history.length>12){error='This step conversation is full. Start a new walkthrough; export a backup first to retain this one.';render();return;}
    messages.push({role:'user',text:question});const reply={role:'assistant',text:'',pending:true};messages.push(reply);walk.draft='';pending=true;error='';controller=new AbortController();save();render();
    let lastRender=0;
    try{
      const response=await apiFetch('/api/walkthrough/followup/stream',{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(11*60*1000)]),body:JSON.stringify({model:getState().aiProvider==='codex'?getData().preferences.model||undefined:undefined,effort:getState().aiProvider==='codex'?getData().preferences.effort||undefined:undefined,snapshotId:snapshot.snapshotId,selectedId:walk.selectedId,fileIds:walk.fileIds,guide:walk.guide,stepIndex,question,history})});
      const body=await readReply(response,(text)=>{reply.text+=text;if(Date.now()-lastRender>100){lastRender=Date.now();render();}});reply.text=body.text;
    }catch(e){reply.error=true;reply.text=controller.signal.aborted?'Stopped.':`Guide unavailable: ${errorMessage(e.message)}`;}
    finally{reply.pending=false;pending=false;controller=null;save();render();}
  }
  function bind(root) {
    if(getState().guideMode!=='walkthrough'){deep.stopAudio();agent.bind(root);return;}
    if(deep.workspace()?.mode==='deep'&&deep.current()){agent.pause();deep.bind(root);return;}
    deep.stopAudio();
    root.querySelectorAll('[data-walk-mode]').forEach(el=>el.addEventListener('click',async()=>{
      if(el.dataset.walkMode==='resume-deep'){deep.workspace().mode='deep';await save();render();deep.focusCurrent(true,false);return;}
      await deep.start();
    }));
    if(useAgent()){agent.bind(root);return;}
    root.querySelector('#guide-depth')?.addEventListener('change',(e)=>{setup.depth=e.target.value;});
    root.querySelector('#guide-time')?.addEventListener('change',(e)=>{setup.timeMinutes=Number(e.target.value);});
    root.querySelector('#guide-scope')?.addEventListener('change',(e)=>{setup.scope=e.target.value;});
    root.querySelectorAll('[data-walk]').forEach((el)=>el.addEventListener('click',()=>{
      const walk=current(),action=el.dataset.walk;
      if(action==='start'){start();return;}if(action==='stop'){controller?.abort();return;}if(pending||!walk)return;
      if(action==='restart'){delete getData().walkthroughs[walkthroughKey(getState().snapshot)];error='';}
      if(action==='previous')walk.step=Math.max(0,walk.step-1);
      if(action==='understood'){if(!walk.understood.includes(walk.step))walk.understood.push(walk.step);walk.step=Math.min(walk.guide.steps.length-1,walk.step+1);}
      if(action==='next')walk.step=Math.min(walk.guide.steps.length-1,walk.step+1);
      save();render();root.querySelector('#walk-step-title')?.focus({preventScroll:true});
    }));
    root.querySelectorAll('[data-citation]').forEach((el)=>el.addEventListener('click',()=>{const walk=current();jump(walk.guide.steps[walk.step].citations[Number(el.dataset.citation)]);}));
    root.querySelectorAll('[data-walk-pointer]').forEach(el=>el.addEventListener('click',()=>jump(current().guide.steps[current().step].reviewPointers[Number(el.dataset.walkPointer)].citation,{reveal:true})));
    root.querySelectorAll('[data-followup]').forEach((el)=>el.addEventListener('click',()=>followup(el.dataset.followup)));
    root.querySelector('#walk-draft')?.addEventListener('input',(e)=>{current().draft=e.target.value;save();});
    root.querySelector('#walk-question')?.addEventListener('submit',(e)=>{e.preventDefault();followup(current().draft);});
  }
  return {html,bind,filePicker:deep.filePicker,selectFile:deep.selectFile,stopAudio:deep.stopAudio,cancelPrefetch:()=>deep.cancelPrefetch()};
}
