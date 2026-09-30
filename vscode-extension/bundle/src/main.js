import { preparation, preparationMessage, watchPreparation, setResting } from './preparation.js';
import { advanceTimer, toggleTimer, timerLabel, newTimer } from './focus-timer.js';
import { newMindfulnessSession, mindfulnessProgress, startMindfulness, pauseMindfulness } from './mindfulness.js';
import { randomId } from './platform.js';
import { createWalkthroughUI } from './walkthrough.js';
import { readReply, errorMessage } from './transport.js';
import { escapeHtml as esc, icon, renderMarkdown, messageBubble } from './render.js';
import { highlightLines } from './syntax.js';
import { demoFiles } from './demo.js';
import { emptyState, openStorage, sanitizeState, migrateLegacy, validateSnapshot, reviewKey, sessionKey, comparisonKey, sessionFor, notesFor, noteIsCurrent, createBackup, parseBackup, mergeState, reviewSummary } from './storage.js';

const root = document.querySelector('#root');
export let data = emptyState();
export const state = { snapshot:null, selectedFile:'', activeTab:'diff', online:navigator.onLine, connection:'connecting', connectionError:'', aiEnabled:false, aiProvider:'', repositoryGuide:false, modelSelection:false, guideMode:'walkthrough', aiMessage:'', models:[], modelSettingsOpen:false, modelsLoading:false, modelsError:'', queueCollapsed:false, utilityMenu:'', snapshotSaved:false, filesOpen:false, chatOpen:false, guideCollapsed:true, sourceLoading:new Set(), sourceErrors:new Map(), toast:'', storageError:'', demo:false, apiToken:'' };
let storage, saveTimer, scrollTimer, toastTimer, refreshSequence = 0, dialogReturnFocus, mindfulnessSession, mindfulnessReturnAction, mindfulnessTickTimer, mindfulnessMode='breathing', mindfulnessWaiting=false, mindfulnessSettingsOpen=false, queueScroll=0;
const sourceRequests = new Map();
let chatController, citation, supportingSource;
// Send a saved model only when the connected provider lists it; otherwise use the laptop default.
function guideChoices(){const choice=state.modelSelection&&state.models.find((m)=>m.id===data.preferences.model);return choice?{model:choice.id,effort:choice.efforts.includes(data.preferences.effort)?data.preferences.effort:undefined}:{};}
const walkthrough = createWalkthroughUI({getState:()=>state,getData:()=>data,save:saveState,render,apiFetch,jump:jumpCitation,showSection:showDeepSection,choices:guideChoices});
export const selectedFile = () => state.snapshot?.files.find((f) => f.id === state.selectedFile);
export const currentSession = () => selectedFile() ? sessionFor(data,state.snapshot,selectedFile()) : null;
const reviewed = (file) => Boolean(data.reviews[reviewKey(state.snapshot,file)]);
const files = () => state.snapshot?.files || [];
const isPreviewable = (file) => /\.(md|markdown)$/i.test(file.path);
const small = () => matchMedia('(max-width:820px)').matches;
const overlayGuide = () => matchMedia('(max-width:1050px)').matches;
// The companion determines auth and billing state. The browser only displays
// that state; it never guesses that an installed CLI is usable or billed.
const labelForProvider = () => state.aiMessage || (state.aiProvider === 'api' ? 'API billing mode' : state.aiProvider ? `${state.aiProvider} on laptop` : 'AI not connected');
const age = () => { const at=Date.parse(state.snapshot?.generatedAt); if (!Number.isFinite(at)) return 'No snapshot'; const minutes=Math.max(0,Math.floor((Date.now()-at)/60000)); return minutes < 1 ? 'Captured just now' : minutes < 60 ? `Captured ${minutes} min ago` : `Captured ${Math.floor(minutes/60)} hr ago`; };
function storageFailure(error) { state.storageError=`Device storage could not save this review (${error?.name || 'storage unavailable'}). Keep this tab open and export a backup.`; renderStorageError(); }
function renderStorageError() { let box=document.querySelector('#storage-alert'); if(box) { box.hidden=!state.storageError; box.textContent=state.storageError; } }
export function saveState(immediate = true) {
  clearTimeout(saveTimer);
  const save = async () => { if (!storage) return; try { await storage.put('state',data); } catch(error) { storageFailure(error); } };
  if (immediate) return save();
  saveTimer=setTimeout(save,150);
}
async function saveSnapshot(snapshot) { if (!storage || state.demo) return; try { await storage.put('snapshot',snapshot); if(state.snapshot===snapshot)state.snapshotSaved=true; } catch(error) { storageFailure(error); } }
function currentWalkRecord() {
  if(!state.snapshot)return null;
  const key=JSON.stringify([state.snapshot.repoId,state.snapshot.snapshotId]), workspace=data.agentGuides?.[key];
  const deep=data.deepReviews?.[key];
  if(state.guideMode==='walkthrough'&&deep?.mode==='deep'&&deep.records?.[deep.activeId])return deep.records[deep.activeId];
  return workspace?.records?.[workspace.activeId] || data.walkthroughs[key];
}
function capturePosition() {
  const session=currentSession(); if (!session) return;
  const panel=document.querySelector('.review-panel');
  const viewer=document.querySelector('.code-viewer,.markdown-preview');
  const chat=document.querySelector('.chat-scroll');
  const walk=document.querySelector('.walkthrough-scroll'), record=currentWalkRecord();
  if(walk&&record)record.scroll=walk.scrollTop;
  if(panel) session.scroll.panel=panel.scrollTop;
  if(viewer) {
    session.scroll[state.activeTab]=viewer.scrollTop;
    session.scroll[`${state.activeTab}X`]=viewer.scrollLeft;
  }
  if(chat) session.scroll.chat=chat.scrollTop;
  session.scroll.window=window.scrollY;
}
export function apiFetch(path, options={}) {
  const headers = new Headers(options.headers || {});
  if(state.apiToken) headers.set('x-xpositor-token',state.apiToken);
  return fetch(path,{...options,headers,cache:'no-store',signal:options.signal || AbortSignal.timeout(path.startsWith('/api/ai') || path.startsWith('/api/walkthrough') ? 120000 : ['/api/config','/api/models'].some(p=>path.startsWith(p))?45000:60000)});
}
function toast(text) { state.toast=text; clearTimeout(toastTimer); render(); toastTimer=setTimeout(() => {state.toast=''; render();},4500); }
export function selectFile(id) {
  walkthrough.selectFile(id);
  const next=files().find((f)=>f.id===id); if(!next) return;
  supportingSource=null;
  capturePosition();
  if(state.filesOpen && history.state?.xpositorPanel) history.back();
  state.selectedFile=id; state.filesOpen=false;
  data.selections[comparisonKey(state.snapshot)]=next.path;
  if(state.activeTab==='preview' && !isPreviewable(next)) state.activeTab='diff';
  saveState(); render(false);
  if(['source','preview'].includes(state.activeTab)) hydrateFileSource(next);
}
function restoredSelection(snapshot) {
  const path=data.selections[comparisonKey(snapshot)];
  const pending=snapshot.files.find(f=>!data.reviews[reviewKey(snapshot,f)]);
  if(path===''&&!pending)return '';
  return snapshot.files.find(f=>f.path===path)?.id||pending?.id||snapshot.files[0]?.id||'';
}
function nextFile(mark=false) {
  const file=selectedFile(); if(!file) return;
  if(mark) data.reviews[reviewKey(state.snapshot,file)]=true;
  const list=files(), index=list.indexOf(file), ordered=[...list.slice(index+1),...list.slice(0,index)];
  if(mark&&list.every(reviewed)) {
    capturePosition();state.selectedFile='';data.selections[comparisonKey(state.snapshot)]='';
    state.guideCollapsed=true;state.chatOpen=false;saveState();render(false);
    root.querySelector('#review-complete-title')?.focus();return;
  }
  const next=mark ? ordered.find(f=>!reviewed(f)) : list[index+1];
  saveState();if(next)selectFile(next.id);else render();
}
function completionContent() {
  const questions=data.notes.filter(n=>n.repoId===state.snapshot.repoId&&n.status==='open').length;
  return `<section class="review-complete"><span class="completion-mark">${icon('check',32)}</span><h2 id="review-complete-title" tabindex="-1">Nice work. Review complete!</h2><p>You reviewed all ${files().length} file${files().length===1?'':'s'} in this snapshot.</p>${questions?`<p>${questions} open question${questions===1?' remains':'s remain'} in your notes.</p>`:''}<div><button class="primary-button" data-action="export-summary">Export review summary</button><button class="secondary-button" data-action="browse-reviewed">Browse reviewed files</button></div><button class="next-button" data-action="refresh-snapshot">Check for new changes</button></section>`;
}
function setActiveTab(tab) {
  const f=selectedFile(); if(!f || !['overview','diff','source','preview','notes'].includes(tab) || (tab==='preview'&&!isPreviewable(f))) return;
  capturePosition(); state.activeTab=tab; saveState(); render(false);
  if(['source','preview'].includes(tab)) hydrateFileSource(f);
}
export async function hydrateFileSource(file) {
  const snapshot=state.snapshot;
  if(!file || !snapshot || typeof file.source==='string' || file.sourceAvailable===false || state.demo) return;
  const key=sessionKey(snapshot,file);
  if(sourceRequests.has(key)) return sourceRequests.get(key);
  if(!state.online) return;
  state.sourceLoading.add(key); state.sourceErrors.delete(key); render();
  const promise=(async()=>{
    try {
      const response=await apiFetch(`/api/file?snapshotId=${encodeURIComponent(snapshot.snapshotId)}&path=${encodeURIComponent(file.path)}`);
      const payload=await response.json();
      if(!response.ok) throw new Error(response.status===409 ? 'This snapshot expired on the laptop. Refresh the snapshot to read source.' : payload.error || 'Source could not be loaded.');
      if(payload.snapshotId!==snapshot.snapshotId || payload.path!==file.path || payload.version!==file.version || typeof payload.source!=='string') throw new Error('Source did not match this exact snapshot. Refresh and try again.');
      file.source=payload.source;
      if(state.snapshot===snapshot) await saveSnapshot(snapshot);
    } catch(error) { state.sourceErrors.set(key,error.message || 'The laptop is unreachable.'); }
    finally { state.sourceLoading.delete(key); sourceRequests.delete(key); if(state.snapshot===snapshot && selectedFile()===file) render(); }
  })();
  sourceRequests.set(key,promise); return promise;
}
function renderFileRow(file) {
  const unresolved=notesFor(data,state.snapshot,file).filter((n)=>n.status==='open').length;
  return `<button class="file-row ${file.id===state.selectedFile?'selected':''} ${reviewed(file)?'reviewed':''}" data-file-id="${esc(file.id)}" aria-current="${file.id===state.selectedFile?'page':'false'}"><span class="file-type type-${esc(file.tone)}">${esc(file.type)}</span><span class="file-row-copy"><span class="file-name">${esc(file.label)}</span><span class="file-path">${esc(file.folder)}${unresolved?` · ${unresolved} open question${unresolved===1?'':'s'}`:''}</span></span><span class="file-row-meta"><span class="change-count"><b>+${file.added}</b><i>−${file.removed}</i></span><span class="review-state" aria-label="${reviewed(file)?'Reviewed':'Needs review'}">${icon(reviewed(file)?'check':'chevron',14)}</span></span></button>`;
}
function renderDiff(file) {
  let previousChange=false, hunk=0;
  const diffLines=file.lines || [];
  const oldLines=[], newLines=[], oldIndexes=[], newIndexes=[];
  diffLines.forEach(([kind,,text],index)=>{
    if(kind==='hunk')return;
    if(kind!=='added'){oldIndexes[index]=oldLines.length;oldLines.push(text);}
    if(kind!=='removed'){newIndexes[index]=newLines.length;newLines.push(text);}
  });
  const oldHtml=highlightLines(oldLines.join('\n'),file.path);
  const newHtml=highlightLines(newLines.join('\n'),file.path);
  const rows=diffLines.map(([rawKind,number,text],index)=>{
    const kind=['context','normal','added','removed','blank','hunk'].includes(rawKind)?rawKind:'normal';
    const changed=kind==='added'||kind==='removed';
    const hunkStart=(changed&&!previousChange)||kind==='hunk'; previousChange=changed;
    const line=Number(number), validLine=Number.isInteger(line)&&line>0;
    const code=kind==='hunk'?esc(text):kind==='removed'?oldHtml[oldIndexes[index]]:newHtml[newIndexes[index]];
    return `<div class="code-line ${kind} ${hunkStart?'hunk-start':''}" ${hunkStart?`data-hunk="${hunk++}"`:''}><button class="line-number" ${validLine?`data-line="${line}" data-side="${kind==='removed'?'old':'new'}" aria-label="Add a note at ${kind==='removed'?'old':'new'} line ${line}"`:'disabled aria-label="Diff separator"'}>${esc(number)}</button><span class="line-sign">${kind==='added'?'+':kind==='removed'?'−':''}</span><code>${code||'&nbsp;'}</code></div>`;
  });
  if(!data.preferences.compactContext) return rows.join('');
  const output=[];
  for(let i=0;i<rows.length;) {
    if(['added','removed','hunk'].includes(file.lines[i][0])) {output.push(rows[i++]);continue;}
    const start=i; while(i<rows.length&&!['added','removed','hunk'].includes(file.lines[i][0])) i++;
    if(i-start>0) output.push(`<details class="unchanged-context"><summary>Show ${i-start} unchanged line${i-start===1?'':'s'}</summary>${rows.slice(start,i).join('')}</details>`);
    else output.push(...rows.slice(start,i));
  }
  return output.join('');
}
function notesContent(file) {
  const session=currentSession(), notes=notesFor(data,state.snapshot,file);
  return `<section class="notes-card"><div class="notes-content"><h3>Questions & notes</h3><p>Private to this browser. Export a backup before changing tunnel links. Tap a code line to anchor a question.</p><form id="note-form"><div class="note-range"><label>Side <select name="side"><option value="new" ${session.noteSide==='old'?'':'selected'}>New source</option><option value="old" ${session.noteSide==='old'?'selected':''}>Old source</option></select></label><label>Start line <input name="start" type="number" min="1" step="1" value="${esc(session.noteStart)}"></label><label>End line <input name="end" type="number" min="1" step="1" value="${esc(session.noteEnd)}"></label></div><label for="note-text">Question or follow-up</label><textarea id="note-text" name="note" required placeholder="What needs another look?">${esc(session.noteDraft)}</textarea><button class="primary-button" type="submit">Save question</button><span class="note-save-status">Draft saved on this device${state.storageError?' — storage error':''}</span></form><div class="note-list">${notes.map((n)=>`<article class="review-note"><span class="eyebrow">${noteIsCurrent(n,state.snapshot,file)?'CURRENT REVISION':`HISTORICAL · ${esc(n.version.slice(0,12))}`} · ${esc(n.status)}</span><p class="note-anchor">${n.start?`${n.side==='old'?'Old':'New'} lines ${n.start}–${n.end||n.start}`:'Whole file'} · ${esc(n.createdAt)}</p><p class="note-text">${esc(n.text)}</p><button class="secondary-button" data-note-toggle="${esc(n.id)}">${n.status==='resolved'?'Reopen question':'Resolve question'}</button></article>`).join('')}</div>${data.historicalNotes.length?`<details class="legacy-notes"><summary>${data.historicalNotes.length} legacy notes (repository and revision unverified)</summary>${data.historicalNotes.map((n)=>`<article><b>${esc(n.path)}</b><p>${esc(n.text)}</p></article>`).join('')}</details>`:''}</div></section>`;
}
function renderContent(file) {
  if(state.activeTab==='overview') {
    const record=currentWalkRecord(),guide=record?.guide,status=record?.overviewStatus?.[file.path];
    const summary=status==='ready'?record.fileOverviews?.[file.path]:status?null:guide?.fileOverviews?.[file.path];
    const workspace=state.snapshot&&data.agentGuides?.[JSON.stringify([state.snapshot.repoId,state.snapshot.snapshotId])];
    const preparing=workspace?.pending?.action==='start'&&workspace.pending.recordId===record?.id;
    const message=status==='skipped'?'Overview skipped for this lockfile.':status==='failed'?'A file-specific overview could not be prepared.':preparing?'Preparing this file’s overview…':guide?'This walkthrough has no file-specific overview for this file.':'Start a Code guide walkthrough to prepare an overview of this file.';
    return `<section class="file-overview"><h3>File overview</h3><p>${esc(summary||message)}</p>${guide?`<p class="overview-context">${esc(guide.summary)}</p>`:''}</section>`;
  }
  if(state.activeTab==='notes') return notesContent(file);
  const sourceTab=state.activeTab!=='diff', key=sessionKey(state.snapshot,file);
  if(sourceTab && typeof file.source!=='string') return `<section class="source-empty"><h3>${state.sourceLoading.has(key)?'Reading snapshot source…':file.sourceAvailable===false?'Source unavailable for this entry':state.online?'Source is not cached for this snapshot':'Offline — source not cached'}</h3><p>${esc(state.sourceErrors.get(key)||file.sourceReason||'The diff is available. Source must be fetched from this exact immutable snapshot.')}</p>${state.online&&file.sourceAvailable!==false&&!state.sourceLoading.has(key)?'<button class="secondary-button" data-action="retry-source">Load snapshot source</button>':''}</section>`;
  return `<section class="code-card ${state.activeTab==='preview'?'preview-card':''}">${state.activeTab==='preview'?`<article class="markdown-preview">${renderMarkdown(file.source)}</article>`:`<div class="code-viewer ${data.preferences.wrap?'wrap-code':''}">${sourceTab?highlightLines(file.source,file.path).map((line,i)=>`<div class="source-line"><button class="line-number" data-line="${i+1}" data-side="new" aria-label="Add a note at line ${i+1}">${i+1}</button><code>${line||'&nbsp;'}</code></div>`).join(''):renderDiff(file)||'<p class="empty-diff">No textual diff available. Review the status and source where available.</p>'}</div>`}</section>`;
}
function focusControls() {
  const timer=data.pomodoro;
  return `<div class="focus-controls"><p id="focus-phase">${timer.phase==='break'?'Screen-free break':'Focus session'}</p><output id="focus-clock" aria-live="off">${timerLabel(timer)}</output><p>25 minutes of focus · 5 minutes of rest</p><div><button class="primary-button" data-action="focus-toggle">${timer.endsAt===null?'Start / resume':'Pause'}</button><button class="secondary-button" data-action="focus-reset">Reset</button></div><p class="break-suggestions">During your break: do nothing, walk, stretch, have a conversation, or enjoy a small sweet snack if you fancy one. Give scrolling and feeds a rest.</p><p id="focus-status" role="status"></p></div>`;
}
function mindfulnessContent() {
  const session=mindfulnessSession, progress=mindfulnessProgress(session);
  const grounding=mindfulnessMode==='grounding';
  const job=mindfulnessWaiting?preparation():null;
  const active=session.status==='running'||session.status==='paused';
  const remaining=remainingMindfulnessTime(progress.remainingMs);
  return `<section class="mindfulness-overlay" role="dialog" aria-modal="true" aria-labelledby="mindfulness-title" aria-describedby="mindfulness-intro">
    <div class="mindfulness-card">
      <header><span class="mindfulness-kicker">${mindfulnessWaiting?'WHILE WE GET THINGS READY':'A MOMENT FOR YOURSELF'}</span><button class="icon-button" data-action="mindfulness-close" aria-label="Close mindfulness exercise" title="Close">${icon('close')}</button></header>
      <h2 id="mindfulness-title">${grounding?'Notice this moment':'Mindful breathing'}</h2>
      <p id="mindfulness-intro">${grounding?'Let your eyes rest on the room around you. There’s nothing to solve right now.':'You don’t need to empty your mind. Let your breath stay comfortable.'}</p>
      <div class="mindfulness-modes" role="group" aria-label="Choose a mindful pause"><button data-action="mindfulness-breathing" aria-pressed="${!grounding}">Follow your breath</button><button data-action="mindfulness-grounding" aria-pressed="${grounding}">Notice your surroundings</button></div>
      <div class="breath-stage ${!grounding&&active?'is-active':''} ${!grounding&&session.status==='running'?'is-running':''}" style="--breath-cycle:${session.cycleMs}ms;--breath-offset:-${progress.elapsedMs}ms">
        <div class="breath-halo"><div class="breath-orb"></div></div>
        <p id="breath-phase" aria-live="off">${session.status==='complete'?'A moment, taken':grounding?groundingPrompt(progress.elapsedMs):active?progress.phase==='in'?'Breathe in':'Breathe out':'Ready when you are'}</p>
      </div>
      <p class="mindfulness-prompt">${session.status==='complete'?'No need to feel any particular way. Return when it suits you.':grounding?'Feel the support beneath you. You can keep your eyes open and breathe normally.':'When a thought appears, you can notice it without following it. Gently return to the feeling of breathing.'}</p>
      ${active?`<p class="mindfulness-remaining" id="mindfulness-remaining" aria-live="off">${remaining} remaining</p>`:''}
      ${session.status==='ready'||session.status==='complete'?`<details class="mindfulness-settings" ${mindfulnessSettingsOpen?'open':''}><summary>Time & pace</summary><div class="mindfulness-options"><label>Duration <select id="mindfulness-duration" aria-label="Mindfulness duration">${[1,3,5].map(n=>`<option value="${n}" ${session.durationMs===n*60000?'selected':''}>${n} ${n===1?'minute':'minutes'}</option>`).join('')}</select></label><label>Breathing pace <select id="mindfulness-rate" aria-label="Breathing pace">${[6,8,10].map(n=>`<option value="${n}" ${Math.round(60000/session.cycleMs)===n?'selected':''}>${n} breaths / min</option>`).join('')}</select></label></div></details>`:''}
      <div class="mindfulness-actions"><button class="${job?.status==='ready'?'secondary-button':'primary-button'}" data-action="mindfulness-toggle">${session.status==='running'?'Pause':session.status==='paused'?'Resume':session.status==='complete'?'Begin again':'Begin'}</button>${active?'<button class="secondary-button" data-action="mindfulness-end">End session</button>':''}</div>
      ${job?`<div class="mindfulness-readiness" role="status"><p>${esc(preparationMessage())}</p><button class="${job.status==='ready'?'primary-button':'secondary-button'}" data-action="mindfulness-return">${job.status==='ready'?'Continue to '+(job.label==='Your audio'?'audio':'review'):job.status==='pending'?'Return to review':'View status'}</button></div>`:''}
      <p class="mindfulness-footnote">Breathe gently at your own pace. Stop if you feel lightheaded.</p>
    </div>
  </section>`;
}
function groundingPrompt(elapsed){return ['Notice one colour around you','Feel where your feet are supported','Listen for one nearby sound','Let your attention rest here'][Math.min(3,Math.floor(elapsed/15000))];}
watchPreparation(()=>{if(mindfulnessSession)queueMicrotask(()=>render(false));});
function remainingMindfulnessTime(ms) {
  const seconds=Math.ceil(ms/1000);
  return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
}
function tickMindfulness() {
  if(!mindfulnessSession||mindfulnessSession.status!=='running')return;
  const progress=mindfulnessProgress(mindfulnessSession);
  if(progress.complete){pauseMindfulness(mindfulnessSession);clearInterval(mindfulnessTickTimer);render(false);return;}
  const phase=root.querySelector('#breath-phase');
  if(phase)phase.textContent=mindfulnessMode==='grounding'?groundingPrompt(progress.elapsedMs):progress.phase==='in'?'Breathe in':'Breathe out';
  const remaining=root.querySelector('#mindfulness-remaining');
  if(remaining)remaining.textContent=`${remainingMindfulnessTime(progress.remainingMs)} remaining`;
}
function closeMindfulness() {
  clearInterval(mindfulnessTickTimer);
  mindfulnessSession=null;setResting(false);mindfulnessWaiting=false;
  render(false);
  const target=[...root.querySelectorAll('[data-action="mindfulness-open"]')].find(el=>el.dataset.location===mindfulnessReturnAction&&el.getClientRects().length)||root.querySelector('[data-lesson="play"],#agent-step-title');target?.focus({preventScroll:true});
}
function tickFocusTimer() {
  const message=advanceTimer(data.pomodoro);
  if(message){saveState();toast(message);}
  const phase=root.querySelector('#focus-phase');if(phase)phase.textContent=data.pomodoro.phase==='break'?'Screen-free break':'Focus session';
  const control=root.querySelector('[data-action="focus-toggle"]');if(control)control.textContent=data.pomodoro.endsAt===null?'Start / resume':'Pause';
  const status=root.querySelector('#focus-status');if(status&&message)status.textContent=message;
  const clock=root.querySelector('#focus-clock');if(clock)clock.textContent=timerLabel(data.pomodoro);
  const railClock=root.querySelector('.rail-timer-label');if(railClock){railClock.textContent=timerLabel(data.pomodoro);railClock.hidden=data.pomodoro.endsAt===null;}
}
function guideWidthLimit(){return Math.max(260,Math.min(640,innerWidth-54-(state.queueCollapsed?0:250)-320));}
function guideWidth(){return Math.max(260,Math.min(guideWidthLimit(),data.preferences.guideWidth));}
function bindGuideResize() {
  const handle=root.querySelector('.guide-resizer');if(!handle)return;
  const update=width=>{data.preferences.guideWidth=Math.max(260,Math.min(guideWidthLimit(),width));root.querySelector('.app-shell').style.setProperty('--guide-width',`${data.preferences.guideWidth}px`);handle.setAttribute('aria-valuenow',String(Math.round(data.preferences.guideWidth)));};
  handle.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();
    update(event.key==='Home'?260:event.key==='End'?guideWidthLimit():guideWidth()+(event.key==='ArrowLeft'?20:-20));saveState();
  });
  handle.addEventListener('dblclick',()=>{update(guideWidthLimit());saveState();});
  handle.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;event.preventDefault();handle.focus();
    const startX=event.clientX,startWidth=guideWidth(),listeners=new AbortController();
    handle.setPointerCapture(event.pointerId);handle.classList.add('resizing');
    const finish=()=>{listeners.abort();handle.classList.remove('resizing');saveState();};
    handle.addEventListener('pointermove',move=>update(startWidth+startX-move.clientX),{signal:listeners.signal});
    for(const name of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(name,finish,{signal:listeners.signal});
  });
}
function modelControls() {
  if(!state.modelSelection)return '';
  const choice=state.models.find((m)=>m.id===data.preferences.model);
  return `<details class="model-settings" ${state.modelSettingsOpen?'open':''}><summary>Model · ${esc(choice?.name||'laptop default')} · ${esc(choice&&data.preferences.effort?`${data.preferences.effort} effort`:'default effort')}</summary><label>Model <select id="guide-model" ${state.modelsLoading?'disabled':''}><option value="">Laptop default</option>${state.models.map((m)=>`<option value="${esc(m.id)}" ${m.id===data.preferences.model?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label><label>Reasoning <select id="guide-effort" ${!choice?'disabled':''}><option value="">Model default</option>${(choice?.efforts||[]).map((e)=>`<option value="${esc(e)}" ${e===data.preferences.effort?'selected':''}>${esc(e)}</option>`).join('')}</select></label><button type="button" class="secondary-button" data-action="refresh-models" ${state.modelsLoading?'disabled':''}>${state.modelsLoading?'Loading models…':'Refresh models'}</button>${state.modelsError?`<p role="alert">${esc(state.modelsError)}</p>`:''}</details>`;
}
async function hydrateModels(refresh=false) {
  if(!state.modelSelection||state.modelsLoading)return;
  state.modelsLoading=true;state.modelsError='';render();
  try {const response=await apiFetch(`/api/models${refresh?'?refresh=true':''}`);const result=await response.json();if(!response.ok)throw new Error(errorMessage(result));state.models=Array.isArray(result.models)?result.models:[];if(!state.models.length)state.modelsError=result.message||'The provider returned no models.';}
  catch(error){state.modelsError=errorMessage(error.message);}
  finally{state.modelsLoading=false;render();}
}
function conversationHistory(file) {
  if(!file)return '';
  const currentKey=sessionKey(state.snapshot,file), histories=[];
  for(const [key,session] of Object.entries(data.sessions)) {
    let identity;try{identity=JSON.parse(key);}catch{continue;}
    if(identity[0]!==state.snapshot.repoId||identity[2]!==file.path)continue;
    for(const chat of session.archives||[])histories.push({label:'Earlier conversation',chat});
    if(key!==currentKey&&session.chat.length)histories.push({label:`Earlier snapshot · ${identity[1].slice(0,12)}`,chat:session.chat});
  }
  return histories.length?`<details class="chat-history"><summary>${histories.length} saved earlier conversation(s)</summary>${histories.map((h)=>`<section><h4>${esc(h.label)}</h4>${h.chat.map((m)=>`<p><b>${m.role==='user'?'You':'Guide'}:</b> ${esc(m.text)}</p>`).join('')}</section>`).join('')}</details>`:'';
}
function statusText() {
  if(state.demo) return 'Demo workspace';
  if(state.connection==='connecting') return 'Connecting to laptop…';
  if(state.connection==='connected') return 'Laptop reached';
  if(state.connection==='pairing') return 'Pairing required';
  return state.snapshot?'Cached snapshot · laptop unavailable':'Laptop unavailable';
}
function emptyContent() {
  const clean=Boolean(state.snapshot && !state.demo && !files().length);
  return `<section class="empty-state"><div class="empty-orbit"><span>${icon(clean?'check':'wifi',28)}</span></div><h2>${clean?'No changed files in this snapshot.':state.connection==='connecting'?'Connecting to your laptop…':'Connect a laptop to start reviewing.'}</h2><p>${clean?`Captured ${esc(state.snapshot.generatedAt)}. Refresh to check for new changes.`:esc(state.connectionError||'Open the paired companion link from your laptop. You can also import a private backup or explore an explicitly labeled demo.')}</p><button class="primary-button" data-action="refresh-snapshot">Reconnect</button>${!state.snapshot?'<button class="secondary-button" data-action="load-demo">Explore demo</button>':''}</section>`;
}
const systemTheme = matchMedia('(prefers-color-scheme:dark)');
systemTheme.addEventListener('change',()=>render());
export function render(preservePosition=true) {
  if(supportingSource&&supportingSource.snapshotId!==state.snapshot?.snapshotId)supportingSource=null;
  stopKeyboardScroll();
  const visibleQueue=root.querySelector('.file-panel:not([inert])');
  if(visibleQueue)queueScroll=visibleQueue.scrollTop;
  const theme=data.preferences.theme||'system';
  document.documentElement.dataset.theme=theme==='system'?(systemTheme.matches?'dark':'light'):theme;
  const mindfulnessSettings=root.querySelector('.mindfulness-settings');if(mindfulnessSettings)mindfulnessSettingsOpen=mindfulnessSettings.open;
  const modelPanel=root.querySelector('.model-settings');if(modelPanel)state.modelSettingsOpen=modelPanel.open;
  if(preservePosition) capturePosition();
  const active=document.activeElement;
  const focus=active?.id?{id:active.id,start:active.selectionStart,end:active.selectionEnd}:null;
  const mindfulnessFocusAction=active?.closest?.('.mindfulness-overlay')?active.dataset.action:null;
  const file=selectedFile(), session=currentSession(), count=files().filter(reviewed).length;
  const guideHidden=overlayGuide()?!state.chatOpen:state.guideCollapsed;
  const drawerHidden=small()?!state.filesOpen:state.queueCollapsed;
  const modal=small()&&state.filesOpen?'files':overlayGuide()&&state.chatOpen?'chat':null;
  const unresolved=data.notes.filter((n)=>n.repoId===state.snapshot?.repoId&&n.status==='open').length;
  const controls=`<div class="backup-actions"><button class="secondary-button" data-action="export-backup">Export backup</button><button class="secondary-button" data-action="import-backup">Import backup</button><button class="secondary-button" data-action="export-summary">Export summary</button><button class="secondary-button" data-action="clear-cache">Clear cached source</button></div>`;
  root.innerHTML=`<div class="app-shell ${state.queueCollapsed?'queue-is-collapsed':''} ${state.filesOpen?'files-is-open':''} ${state.chatOpen?'chat-is-open':''} ${guideHidden?'guide-is-collapsed':''}" style="--code-size:${data.preferences.codeSize}px;--guide-width:${guideWidth()}px">
    <header class="mobile-topbar" ${modal?'inert':''}><button class="icon-button" data-action="toggle-files" aria-label="Open files">${icon('menu')}</button><div class="mobile-wordmark"><span class="wordmark-mark">${icon('logo')}</span>xpositor</div><button class="icon-button" data-action="mindfulness-open" data-location="mobile" aria-label="Mindful breathing" title="Mindful breathing">${icon('breathe')}</button><button class="icon-button" data-action="preferences" aria-label="Preferences" title="Preferences">${icon('sliders')}</button><button class="icon-button" data-action="toggle-chat" aria-label="Open code guide">${icon('message')}</button></header>
    <nav class="sidebar rail" aria-label="Workspace navigation" ${modal?'inert':''}><div class="rail-brand" title="Xpositor" aria-label="Xpositor">${icon('logo',24)}</div><button class="icon-button" data-action="toggle-files" aria-label="Review queue" aria-controls="file-panel" aria-expanded="${!drawerHidden}" title="Review queue">${icon('panel')}</button><button class="icon-button" data-action="toggle-chat" aria-label="Code guide" aria-controls="chat-panel" aria-expanded="${!guideHidden}" title="Code guide">${icon('message')}</button><div class="rail-bottom"><button class="icon-button" data-action="mindfulness-open" data-location="rail" aria-label="Mindful breathing" title="Mindful breathing">${icon('breathe')}</button><button class="icon-button rail-timer" data-action="focus" aria-label="Focus timer" title="Focus timer">${icon('clock')}<span class="rail-timer-label" ${data.pomodoro.endsAt===null?'hidden':''}>${timerLabel(data.pomodoro)}</span></button><button class="icon-button" data-action="backups" aria-label="Backup & handoff" aria-expanded="${state.utilityMenu==='backups'}" title="Backup & handoff">${icon('archive')}</button><button class="icon-button" data-action="preferences" aria-label="Preferences" aria-expanded="${state.utilityMenu==='preferences'}" title="Preferences">${icon('sliders')}</button></div></nav>
    ${modal?'<button class="file-drawer-scrim" data-action="close-panels" tabindex="-1" aria-label="Close panel"></button>':''}
    <aside class="file-panel" id="file-panel" ${drawerHidden?'inert aria-hidden="true"':''} ${modal==='chat'?'inert':''} ${modal==='files'?'role="dialog" aria-modal="true" aria-label="Review files"':''}><div class="file-panel-header"><div><h1>${esc(state.snapshot?.workspaceName||'Review queue')}</h1></div><button class="close-files icon-button" data-action="close-queue" aria-label="Close files">${icon('close')}</button></div><div class="branch-row"><span class="branch-name">${icon('branch',14)}${esc(state.snapshot?.branch||'No branch loaded')}</span></div><label class="scope-control">Review <select id="review-scope" aria-label="Review scope">${['unstaged','staged','all'].map(scope=>`<option value="${scope}" ${(state.snapshot?.scope||data.preferences.scope)===scope?'selected':''}>${scope==='all'?'All changes':scope[0].toUpperCase()+scope.slice(1)}</option>`).join('')}</select></label><div class="queue-progress"><div class="progress-copy"><span>${count} of ${files().length} reviewed</span><b>${unresolved} open questions</b></div><progress max="${files().length||1}" value="${count}" aria-label="Files reviewed"></progress></div><div class="queue-heading"><span>CHANGED FILES ${files().length}</span><button data-action="refresh-snapshot" title="${esc(age())}">Refresh ${icon('wifi',14)}</button></div><div class="file-list">${files().map(renderFileRow).join('')}</div><details class="mobile-backups"><summary>Backup & handoff</summary><p>Backups contain private notes, chats, and code. Share only when you choose.</p>${controls}</details></aside>
    <main class="review-panel" ${modal?'inert':''}>${state.connection!=='connected'&&!state.connectionError?`<p class="connection-details" role="status">${esc(statusText())}</p>`:''}${state.connectionError?`<p class="connection-error">${esc(state.connectionError)}</p>`:''}<div id="storage-alert" role="alert" ${state.storageError?'':'hidden'}>${esc(state.storageError)}</div>${state.demo?'<p class="demo-banner">Demo workspace — sample files, no live repository.</p>':''}
    ${supportingSource?supportingContent():file?`<header class="file-heading"><h2 aria-label="${esc(file.label)}" title="${esc(file.path)} · ${esc(file.status||'modified')} · Revision ${esc(file.version.slice(0,12))}"><span>${esc(file.path.slice(0,-file.label.length))}</span>${esc(file.label)}</h2>${file.oldPath?`<small class="rename-detail">Renamed from ${esc(file.oldPath)}</small>`:''}</header><div class="view-toolbar"><div class="review-tabs" role="tablist" aria-label="File views">${['overview','diff','source',...(isPreviewable(file)?['preview']:[]),'notes'].map((tab)=>`<button id="tab-${tab}" role="tab" aria-selected="${state.activeTab===tab}" aria-controls="review-content" class="review-tab ${state.activeTab===tab?'active':''}" data-tab="${tab}">${tab[0].toUpperCase()+tab.slice(1)}${tab==='notes'?` (${notesFor(data,state.snapshot,file).filter((n)=>n.status==='open').length})`:''}</button>`).join('')}</div>${state.activeTab==='diff'?'<button class="next-hunk-button" data-action="next-hunk">Next change ↓</button>':''}</div><div id="review-content" role="tabpanel" aria-labelledby="tab-${state.activeTab}" tabindex="0">${renderContent(file)}</div><section class="review-footer"><div class="footer-actions"><button class="primary-button" data-action="review-next" title="Reviewed & next (Return)" aria-keyshortcuts="Enter">Reviewed & next ${icon('check',16)}</button></div>${reviewed(file)?'<button class="secondary-button" data-action="reopen-file">Reopen review</button>':''}</section>`:files().length&&files().every(reviewed)?completionContent():emptyContent()}</main>
    <aside class="chat-panel" id="chat-panel" aria-label="Code guide" ${guideHidden?'inert aria-hidden="true"':''} ${modal==='files'?'inert':''} ${modal==='chat'?'role="dialog" aria-modal="true"':''}><div class="guide-resizer" role="separator" aria-label="Resize Code Guide" aria-orientation="vertical" aria-valuemin="260" aria-valuemax="${guideWidthLimit()}" aria-valuenow="${Math.round(guideWidth())}" tabindex="0" title="Drag to resize · Arrow keys to adjust · Double-click to reset"></div><div class="chat-header"><div class="chat-title"><div class="chat-avatar">${icon('spark')}</div><div><h2>Code guide</h2><span>${state.demo?'Demo · AI unavailable':esc(labelForProvider())}</span></div></div><button class="icon-button" data-action="close-guide" aria-label="Close code guide">${icon('close')}</button></div>${walkthrough.filePicker()||`<div class="context-chip">${esc(file?.path||'Choose a file')}</div>`}<div class="guide-modes" role="tablist" aria-label="Code guide view"><button id="guide-tab-walkthrough" role="tab" aria-selected="${state.guideMode==='walkthrough'}" aria-controls="guide-walkthrough-panel" data-guide-mode="walkthrough">Walkthrough</button><button id="guide-tab-chat" role="tab" aria-selected="${state.guideMode==='chat'}" aria-controls="guide-chat-panel" data-guide-mode="chat">Conversation</button></div>${state.guideMode==='walkthrough'?`<div class="walkthrough-scroll" id="guide-walkthrough-panel" role="tabpanel" aria-labelledby="guide-tab-walkthrough">${walkthrough.html()}${modelControls()}</div>`:`<div class="chat-scroll" id="guide-chat-panel" role="tabpanel" aria-labelledby="guide-tab-chat" aria-live="polite">${conversationHistory(file)}${session?.chat.length?session.chat.map((m)=>`<div class="chat-message ${m.role==='user'?'user':'assistant'} ${m.pending?'pending':''}">${messageBubble(m.role==='user'?'user':'assistant',m.text)}</div>`).join(''):`<p class="guide-intro">${state.demo?'This is sample code. Connect your laptop to ask an AI guide about real changes.':esc(state.aiMessage||'Ask about the selected file’s exact snapshot. Your provider must be configured on the laptop. Questions are sent only when you press Send.')}</p>`}</div>${file?`<form class="chat-composer" id="chat-form"><label class="sr-only" for="chat-draft">Question about ${esc(file.label)}</label><textarea id="chat-draft" name="message" rows="2" placeholder="Ask about this snapshot…">${esc(session.draft)}</textarea><div class="composer-bottom"><button type="button" class="new-conversation" data-action="new-chat" aria-label="New conversation" title="New conversation" ${chatController?'disabled':''}>${icon('plus')}</button>${modelControls()}<button class="send-control" type="${chatController?'button':'submit'}" ${chatController?'data-action="stop-chat"':''} aria-label="${chatController?'Stop response':'Send question'}" ${!chatController&&(!state.aiEnabled||!state.online||state.demo)?'disabled':''}>${icon(chatController?'stop':'send')}</button></div></form>`:''}`}</aside>
    ${state.utilityMenu?`<section id="utility-menu" class="utility-menu" popover="auto" aria-label="${state.utilityMenu==='preferences'?'Preferences':state.utilityMenu==='focus'?'Focus timer':'Backup & handoff'}"><header><h2>${state.utilityMenu==='preferences'?'Preferences':state.utilityMenu==='focus'?'Focus timer':'Backup & handoff'}</h2><button class="icon-button" data-action="close-utility" aria-label="Close menu">${icon('close')}</button></header>${state.utilityMenu==='focus'?focusControls():state.utilityMenu==='preferences'?`<label>Appearance <select id="theme-preference">${['system','light','dark'].map(t=>`<option value="${t}" ${theme===t?'selected':''}>${t[0].toUpperCase()+t.slice(1)}</option>`).join('')}</select></label><label>Code size <select id="code-size" aria-label="Code font size">${[13,14,16,18].map(n=>`<option value="${n}" ${data.preferences.codeSize===n?'selected':''}>${n}px</option>`).join('')}</select></label><label>Wrap long lines <input id="wrap-code" type="checkbox" ${data.preferences.wrap?'checked':''}></label><label>Fold unchanged context <input id="compact-context" type="checkbox" ${data.preferences.compactContext?'checked':''}></label><p>Keyboard: ↑ ↓ to scroll · ← → to switch files · Return to review & next</p><button class="secondary-button" data-action="focus">${icon('clock',16)} Focus timer</button>`:`<p>Backups contain private code, notes, and chats. Carry one when changing pairing links.</p>${controls}`}</section>`:''}
    <input id="backup-file" type="file" accept="application/json,.json" hidden><div class="sr-only" role="status" aria-live="polite">${esc(state.toast)}</div>${state.toast?`<div class="toast">${esc(state.toast)}</div>`:''}</div>${mindfulnessSession?mindfulnessContent():''}`;
  root.querySelector('.app-shell').inert=Boolean(mindfulnessSession);
  document.documentElement.classList.toggle('modal-open',Boolean(modal||mindfulnessSession));
  document.body.classList.toggle('modal-open',Boolean(modal||mindfulnessSession));
  const utility=root.querySelector('#utility-menu');
  if(utility) {
    utility.showPopover();
    utility.addEventListener('toggle',event=>{if(event.newState==='closed'&&root.contains(utility)){state.utilityMenu='';root.querySelectorAll('[data-action="preferences"],[data-action="backups"]').forEach(el=>el.setAttribute('aria-expanded','false'));}});
  }
  wireEvents();
  root.querySelector('[data-action="close-supporting"]')?.addEventListener('click',()=>{supportingSource=null;citation=null;render();});
  bindGuideResize();
  walkthrough.bind(root);
  highlightCitation();
  root.querySelector('.file-panel').scrollTop=queueScroll;
  const walkPanel=root.querySelector('.walkthrough-scroll'), walkRecord=currentWalkRecord();
  if(walkPanel&&walkRecord)walkPanel.scrollTop=walkRecord.scroll||0;
  if(session) {
    const viewer=document.querySelector('.code-viewer,.markdown-preview');
    if(viewer) {
      viewer.scrollTop=session.scroll[state.activeTab]||0;
      viewer.scrollLeft=session.scroll[`${state.activeTab}X`]||0;
    }
    document.querySelector('.review-panel').scrollTop=session.scroll.panel||0;
    const chat=document.querySelector('.chat-scroll');
  const walk=document.querySelector('.walkthrough-scroll'), record=currentWalkRecord();
  if(walk&&record)record.scroll=walk.scrollTop; if(chat) chat.scrollTop=session.scroll.chat||0;
    if(small()&&!modal) window.scrollTo(0,session.scroll.window||0);
  }
  if(focus) {const el=document.getElementById(focus.id); if(el&&!el.closest('[inert]')) {el.focus({preventScroll:true});if(typeof el.setSelectionRange==='function'&&focus.start!==null) {try{el.setSelectionRange(focus.start,focus.end);}catch{}}}}
  if(mindfulnessFocusAction)root.querySelector(`.mindfulness-overlay [data-action="${mindfulnessFocusAction}"]`)?.focus({preventScroll:true});
}
function openPanel(which) {
  const active=document.activeElement;
  dialogReturnFocus=active?.dataset.action||null;
  if((which==='files'&&small())||(which==='chat'&&overlayGuide())) {
    const method=history.state?.xpositorPanel?'replaceState':'pushState';
    history[method]({xpositorPanel:which},'',location.href);
  }
  state.filesOpen=which==='files'; state.chatOpen=which==='chat'; if(which==='chat') state.guideCollapsed=false;
  render();
  const panel=document.querySelector(which==='files'?'#file-panel':'#chat-panel');
  panel?.querySelector('button,textarea')?.focus({preventScroll:true});
}
function closePanels(fromHistory=false) {
  if(!fromHistory&&history.state?.xpositorPanel)history.back();
  state.filesOpen=false; state.chatOpen=false; render();
  if(dialogReturnFocus) [...root.querySelectorAll('[data-action]')].find((el)=>el.dataset.action===dialogReturnFocus&&!el.closest('[inert]'))?.focus();
}
function download(name,text,type='application/json') {
  const url=URL.createObjectURL(new Blob([text],{type})), anchor=document.createElement('a'); anchor.href=url; anchor.download=name; anchor.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function saveNote(form) {
  const file=selectedFile(), session=currentSession(); if(!file) return;
  const fields=new FormData(form), text=String(fields.get('note')||'').trim(); if(!text) return;
  const start=fields.get('start')?Number(fields.get('start')):null, end=fields.get('end')?Number(fields.get('end')):start, side=fields.get('side')==='old'?'old':'new';
  const lineNumbers=file.lines.filter(([kind])=>side==='old'?kind!=='added':kind!=='removed').map(([,line])=>Number(line)).filter((n)=>Number.isInteger(n)&&n>0);
  const maxLine=side==='new'&&typeof file.source==='string'?file.source.split(/\r?\n/).length:Math.max(0,...lineNumbers);
  if((start!==null&&(!Number.isInteger(start)||start<1||!Number.isInteger(end)||end<start||end>maxLine)) || (start===null&&end!==null)) {toast(`Use a valid ${side} line range within this snapshot (1–${maxLine}), or leave both fields empty.`);return;}
  data.notes.push({id:randomId(),repoId:state.snapshot.repoId,base:state.snapshot.base,branch:state.snapshot.branch,path:file.path,version:file.version,snapshotId:state.snapshot.snapshotId,text,start,end,side,status:'open',createdAt:new Date().toISOString()});
  session.noteDraft='';session.noteStart='';session.noteEnd='';await saveState(true);toast(state.storageError?'Question is in this tab. Export a backup: device storage failed.':'Question saved privately on this device.');
}
function wireEvents() {
  for(const [id,preference] of [['mindfulness-duration','mindfulnessDuration'],['mindfulness-rate','mindfulnessRate']]) root.querySelector(`#${id}`)?.addEventListener('change',e=>{
    data.preferences[preference]=Number(e.target.value);
    mindfulnessSession=newMindfulnessSession(data.preferences.mindfulnessDuration,data.preferences.mindfulnessRate);
    saveState();render(false);root.querySelector(`#${id}`)?.focus();
  });
  root.querySelector('#review-scope')?.addEventListener('change',async e=>{data.preferences.scope=e.target.value;await saveState();await hydrateFromCompanion();});
  root.querySelector('#theme-preference')?.addEventListener('change',e=>{data.preferences.theme=e.target.value;saveState();render();});
  root.querySelector('#guide-model')?.addEventListener('change',(e)=>{data.preferences.model=e.target.value;data.preferences.effort='';saveState();render();});
  root.querySelector('#guide-effort')?.addEventListener('change',(e)=>{data.preferences.effort=e.target.value;saveState();render();});
  root.querySelectorAll('[data-guide-mode]').forEach((el)=>el.addEventListener('click',()=>{state.guideMode=el.dataset.guideMode;render();}));
  root.querySelectorAll('[data-file-id]').forEach((el)=>el.addEventListener('click',()=>selectFile(el.dataset.fileId)));
  root.querySelectorAll('[data-tab]').forEach((el)=>{
    el.addEventListener('click',()=>setActiveTab(el.dataset.tab));
  });
  root.querySelectorAll('[data-line]').forEach((el)=>el.addEventListener('click',()=>{const s=currentSession();s.noteStart=el.dataset.line;s.noteEnd=el.dataset.line;s.noteSide=el.dataset.side;setActiveTab('notes');document.querySelector('#note-text')?.focus();}));
  root.querySelectorAll('[data-note-toggle]').forEach((el)=>el.addEventListener('click',()=>{const n=data.notes.find((n)=>n.id===el.dataset.noteToggle);if(n)n.status=n.status==='open'?'resolved':'open';saveState();render();}));
  root.querySelectorAll('[data-action]').forEach((el)=>el.addEventListener('click',async()=>{
    switch(el.dataset.action) {
      case 'mindfulness-return':{const resume=preparation()?.status==='ready'?preparation().resume:null;closeMindfulness();resume?.();break;}
      case 'mindfulness-grounding':case 'mindfulness-breathing':mindfulnessMode=el.dataset.action==='mindfulness-grounding'?'grounding':'breathing';render(false);break;
      case 'mindfulness-open':
        walkthrough.stopAudio();mindfulnessReturnAction=el.dataset.location;mindfulnessWaiting=el.dataset.location==='waiting';setResting(true);mindfulnessMode='breathing';mindfulnessSettingsOpen=false;
        state.utilityMenu='';
        mindfulnessSession=newMindfulnessSession(data.preferences.mindfulnessDuration,data.preferences.mindfulnessRate);
        if(mindfulnessWaiting){startMindfulness(mindfulnessSession);clearInterval(mindfulnessTickTimer);mindfulnessTickTimer=setInterval(tickMindfulness,100);}
        render();root.querySelector('[data-action="mindfulness-toggle"]')?.focus();break;
      case 'mindfulness-close':case 'mindfulness-end':closeMindfulness();break;
      case 'mindfulness-toggle':
        if(mindfulnessSession.status==='running') {pauseMindfulness(mindfulnessSession);clearInterval(mindfulnessTickTimer);}
        else {
          if(mindfulnessSession.status==='complete')mindfulnessSession=newMindfulnessSession(data.preferences.mindfulnessDuration,data.preferences.mindfulnessRate);
          startMindfulness(mindfulnessSession);
          clearInterval(mindfulnessTickTimer);mindfulnessTickTimer=setInterval(tickMindfulness,100);
        }
        render(false);root.querySelector('[data-action="mindfulness-toggle"]')?.focus();break;
      case 'refresh-models':hydrateModels(true);break;
      case 'new-chat': {const s=currentSession();if(!s||chatController)break;s.archives||=[];if(s.chat.length)s.archives.push(s.chat);s.chat=[];s.conversationId=randomId();saveState();render();break;}
      case 'focus-toggle':{el.disabled=true;const message=toggleTimer(data.pomodoro);await saveState();render();if(message)toast(message);break;}
      case 'focus-reset':el.disabled=true;data.pomodoro=newTimer();await saveState();render();break;
      case 'preferences':case 'backups':case 'focus':state.utilityMenu=state.utilityMenu===el.dataset.action?'':el.dataset.action;render();root.querySelector('#utility-menu button')?.focus();break;
      case 'close-utility':{const action=state.utilityMenu;state.utilityMenu='';render();[...root.querySelectorAll(`[data-action="${action}"]`)].find(el=>el.getClientRects().length)?.focus();break;}
      case 'stop-chat':chatController?.abort();break;
      case 'toggle-files': if(!small()){state.queueCollapsed=!state.queueCollapsed;render();}else{state.filesOpen?closePanels():openPanel('files');}break;
      case 'close-queue':if(small())closePanels();else{state.queueCollapsed=true;render();}break;
      case 'toggle-chat': (state.chatOpen||(!overlayGuide()&&!state.guideCollapsed))?(state.guideCollapsed=true,closePanels()):openPanel('chat');break;
      case 'close-guide': walkthrough.stopAudio();state.guideCollapsed=true;closePanels();break;
      case 'close-panels':closePanels();break;
      case 'refresh-snapshot':await hydrateFromCompanion();await hydrateAiConfig();break;
      case 'browse-reviewed':if(files().length)selectFile(files()[0].id);break;
      case 'review-next':nextFile(true);break;
      case 'reopen-file':delete data.reviews[reviewKey(state.snapshot,selectedFile())];saveState();render();break;
      case 'retry-source':hydrateFileSource(selectedFile());break;
      case 'load-demo':loadDemo();break;
      case 'next-hunk':{const viewer=root.querySelector('.code-viewer');if(!viewer)break;const hunks=[...viewer.querySelectorAll('[data-hunk]')];const next=hunks.find((h)=>h.offsetTop-viewer.offsetTop>viewer.scrollTop+8)||hunks[0];if(next)viewer.scrollTo({top:next.offsetTop-viewer.offsetTop,behavior:'smooth'});break;}
      case 'export-backup':capturePosition();download('xpositor-private-backup.json',JSON.stringify(createBackup(data,state.demo?null:state.snapshot),null,2));break;
      case 'import-backup':document.querySelector('#backup-file').click();break;
      case 'export-summary':download('xpositor-review.md',reviewSummary(data,state.snapshot),'text/markdown');break;
      case 'clear-cache':if(state.snapshot){for(const f of files())delete f.source;await saveSnapshot(state.snapshot);toast('Cached source cleared. Notes and review decisions are retained.');}break;
    }
  }));
  root.querySelector('#code-size')?.addEventListener('change',(e)=>{data.preferences.codeSize=Number(e.target.value);saveState();render();});
  root.querySelector('#wrap-code')?.addEventListener('change',(e)=>{data.preferences.wrap=e.target.checked;saveState();render();});
  root.querySelector('#compact-context')?.addEventListener('change',(e)=>{data.preferences.compactContext=e.target.checked;saveState();render();});
  root.querySelector('#chat-draft')?.addEventListener('input',(e)=>{currentSession().draft=e.target.value;saveState();});
  root.querySelector('#chat-form')?.addEventListener('submit',(e)=>{e.preventDefault();sendChat();});
  const noteForm=root.querySelector('#note-form');
  noteForm?.addEventListener('input',()=>{const s=currentSession();s.noteDraft=noteForm.elements.note.value;s.noteStart=noteForm.elements.start.value;s.noteEnd=noteForm.elements.end.value;s.noteSide=noteForm.elements.side.value;saveState();});
  noteForm?.addEventListener('submit',(e)=>{e.preventDefault();saveNote(noteForm);});
  root.querySelector('#backup-file')?.addEventListener('change',async(e)=>{
    const file=e.target.files[0];if(!file)return;
    try { if(file.size>50*1024*1024)throw new Error('Backup exceeds the 50 MB import limit.');const imported=parseBackup(await file.text());capturePosition();data=mergeState(data,imported.data);if(imported.snapshot){state.snapshot=imported.snapshot;state.demo=false;state.connection='cached';state.connectionError='Imported snapshot — reconnect to check the laptop.';state.selectedFile=restoredSelection(state.snapshot);await saveSnapshot(state.snapshot);}await saveState(true);toast('Backup imported privately into this browser.'); }
    catch(error){toast(`Import failed: ${error.message}`);}
  });
  root.querySelectorAll('.code-viewer,.markdown-preview,.review-panel,.chat-scroll,.walkthrough-scroll').forEach((el)=>el.addEventListener('scroll',()=>{clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{capturePosition();saveState();},100);},{passive:true}));
}
/** Provider boundary: only explicit sends reach the laptop, using immutable context. */
export async function requestAi({ message, history=[], file, snapshotId, sessionId, signal, onDelta }) {
  const response=await apiFetch('/api/ai/stream',{method:'POST',headers:{'content-type':'application/json'},signal,body:JSON.stringify({message,history,file:{id:file.id,path:file.path},snapshotId,sessionId,...guideChoices()})});
  return readReply(response,onDelta);
}
async function sendChat() {
  const file=selectedFile(), snapshot=state.snapshot, session=currentSession();
  const question=session?.draft.trim();if(!file||!question||!state.aiEnabled||!state.online||state.demo||chatController)return;
  await walkthrough.cancelPrefetch();
  const history=session.chat.filter((m)=>!m.pending&&!m.error).map((m)=>({role:m.role,text:m.text}));
  session.conversationId ||= randomId();
  session.draft='';session.chat.push({role:'user',text:question});const pending={role:'assistant',text:'',pending:true};session.chat.push(pending);
  const controller=new AbortController();chatController=controller;saveState();render();let lastRender=0;
  try {const payload=await requestAi({message:question,history,file,snapshotId:snapshot.snapshotId,sessionId:session.conversationId,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(120000)]),onDelta:(text)=>{pending.text+=text;if(Date.now()-lastRender>100&&state.snapshot===snapshot&&selectedFile()===file){lastRender=Date.now();render();}}});pending.text=payload.text;}
  catch(error){pending.error=true;pending.text=controller.signal.aborted?'Stopped.':`Guide unavailable: ${errorMessage(error.message)} Your question remains in this conversation.`;}
  finally {pending.pending=false;chatController=null;saveState();render();}
}
function supportingContent(){
 const source=supportingSource;
 return `<header class="file-heading"><h2>${esc(source.path)}</h2><button class="secondary-button" data-action="close-supporting">Return to changed file</button></header><p class="agent-activity">Supporting code · captured with this review</p><div id="review-content" tabindex="0"><section class="code-card"><div class="code-viewer ${data.preferences.wrap?'wrap-code':''}">${source.error?`<p role="alert">${esc(source.error)}</p>`:typeof source.text==='string'?highlightLines(source.text,source.path).map((line,i)=>`<div class="source-line"><span class="line-number" data-reference-line="${i+1}" data-side="new">${i+1}</span><code>${line||'&nbsp;'}</code></div>`).join(''):'Reading captured code…'}</div></section></div>`;
}
async function jumpCitation(target,{reveal=true}={}) {
  const snapshot=state.snapshot,file=snapshot?.files.find((f)=>f.id===target.fileId);if(!snapshot)return;
  const reference=citation={...target,snapshotId:snapshot.snapshotId};
  if(reveal){if(history.state?.xpositorPanel)history.back();state.chatOpen=false;state.filesOpen=false;}
  if(file){
    state.activeTab=target.side==='old'?'diff':'source';selectFile(file.id);
    if(target.side==='new')await hydrateFileSource(file);
  }else{
    const source=supportingSource={path:target.path,text:null,snapshotId:snapshot.snapshotId};render();
    try{const response=await apiFetch(`/api/guide/source?snapshotId=${encodeURIComponent(snapshot.snapshotId)}&path=${encodeURIComponent(target.path)}`);const body=await response.json();if(!response.ok||typeof body.source!=='string')throw new Error(body.error||body.reason||'Captured source unavailable.');source.text=body.source;}catch(e){source.error=errorMessage(e.message);}
  }
  if(citation!==reference||state.snapshot!==snapshot)return;
  render();
  const line=root.querySelector('.citation-focus,.citation-highlight');
  if(line){line.closest('details')?.setAttribute('open','');line.scrollIntoView({block:'center',behavior:'smooth'});}
}
function showDeepSection(section,{reveal=false}={}) {
  const file=state.snapshot?.files.find(item=>item.id===section.fileId||item.path===section.path);
  if(!file)return;
  if(section.kind==='code')return jumpCitation({path:file.path,fileId:file.id,side:section.side==='old'?'old':'new',startLine:section.startLine,endLine:section.endLine,focusLine:section.startLine},{reveal:reveal&&overlayGuide()});
  citation=null;
  if(reveal&&overlayGuide()){if(history.state?.xpositorPanel)history.back();state.chatOpen=false;state.filesOpen=false;}
  state.activeTab=section.kind==='pending'?'source':'overview';selectFile(file.id);
}
function highlightCitation() {
  if(!citation||citation.snapshotId!==state.snapshot?.snapshotId)return;
  if(supportingSource?citation.path!==supportingSource.path:citation.fileId!==state.selectedFile)return;
  root.querySelectorAll('[data-line],[data-reference-line]').forEach((el)=>{const line=Number(el.dataset.line||el.dataset.referenceLine);if(el.dataset.side===citation.side&&line>=citation.startLine&&line<=citation.endLine){const row=el.closest('.code-line,.source-line');row?.classList.add('citation-highlight');if(line===citation.focusLine)row?.classList.add('citation-focus');}});
}
export async function hydrateFromCompanion() {
  const sequence=++refreshSequence;
  state.connection='connecting';state.connectionError='';render();
  try {
    const response=await apiFetch(`/api/snapshot?scope=${encodeURIComponent(data.preferences.scope)}`);
    if(response.status===401) {if(sequence===refreshSequence){state.connection='pairing';state.connectionError='Open the pairing link from the laptop to authorize this browser.';}return;}
    const payload=await response.json();if(!response.ok)throw new Error(payload.error||'The laptop could not capture the repository.');
    const snapshot=validateSnapshot(payload);if(sequence!==refreshSequence)return;
    capturePosition();const old=state.snapshot;
    // Sources are reusable only when both immutable snapshot identity and revision match.
    if(old?.repoId===snapshot.repoId&&old.snapshotId===snapshot.snapshotId) for(const file of snapshot.files){const prior=old.files.find((f)=>f.path===file.path&&f.version===file.version);if(typeof prior?.source==='string')file.source=prior.source;}
    state.snapshotSaved=false;state.snapshot=snapshot;state.demo=false;state.connection='connected';state.connectionError='';
    state.selectedFile=restoredSelection(snapshot);
    if(selectedFile()&&state.activeTab==='preview'&&!isPreviewable(selectedFile()))state.activeTab='diff';
    await saveSnapshot(snapshot);saveState();render(false);
    if(['source','preview'].includes(state.activeTab))hydrateFileSource(selectedFile());
  }catch(error){if(sequence===refreshSequence){state.connection=state.snapshot?'cached':'error';state.connectionError=`Laptop snapshot unavailable: ${error.message || 'connection failed'}. ${state.snapshot?'Showing the previously captured snapshot.':'No repository snapshot is loaded.'}`;}}
  finally{if(sequence===refreshSequence)render(false);}
}
async function hydrateAiConfig() {
  try {const response=await apiFetch('/api/config');if(!response.ok)throw new Error('Provider unavailable');const config=await response.json();state.aiEnabled=Boolean(config.aiEnabled);state.repositoryGuide=Boolean(config.capabilities?.repositoryGuide);state.modelSelection=config.capabilities?.modelSelection??['codex','claude'].includes(config.provider);state.aiProvider=typeof config.provider==='string'?config.provider:'';state.aiMessage=typeof config.message==='string'?config.message:'';if(state.modelSelection)hydrateModels();}
  catch {state.aiEnabled=false;state.aiProvider='';state.aiMessage='AI status is unavailable while the laptop cannot be reached.';}
  render();
}
function loadDemo(){capturePosition();state.demo=true;state.snapshot=validateSnapshot({repoId:'xpositor-demo',base:'demo-base',head:'demo-head',branch:'demo',snapshotId:'demo-v2',generatedAt:new Date().toISOString(),workspaceName:'Sample workspace',files:demoFiles.map((f)=>({...f,version:`demo-${f.id}-v2`,status:'modified',sourceAvailable:true,source:f.lines.filter(([kind])=>kind!=='removed').map(([, ,text])=>text).join('\n')}))});state.selectedFile=files()[0].id;state.connectionError='';render(false);}
async function initialize() {
  let legacy={}, legacySnapshot=null;
  try {legacy=JSON.parse(localStorage.getItem('patchwork-state-v1')||'{}');legacySnapshot=JSON.parse(localStorage.getItem('patchwork-snapshot-v1')||'null');state.apiToken=new URLSearchParams(location.search).get('token')||localStorage.getItem('xpositor-api-token')||localStorage.getItem('patchwork-api-token')||legacy.apiToken||'';if(state.apiToken)localStorage.setItem('xpositor-api-token',state.apiToken);}
  catch(error){storageFailure(error);state.apiToken=new URLSearchParams(location.search).get('token')||'';}
  if(new URLSearchParams(location.search).has('token')){const url=new URL(location.href);url.searchParams.delete('token');history.replaceState(null,'',url.pathname+url.search+url.hash);}
  try {storage=await openStorage();const saved=await storage.get('state');data=saved?sanitizeState(saved):migrateLegacy(legacy,legacySnapshot);const snapshot=await storage.get('snapshot');if(snapshot){state.snapshot=validateSnapshot(snapshot);state.snapshotSaved=true;state.connection='cached';state.selectedFile=restoredSelection(state.snapshot);}await storage.put('state',data);try{localStorage.removeItem('patchwork-state-v1');localStorage.removeItem('patchwork-snapshot-v1');localStorage.removeItem('patchwork-api-token');}catch{}}
  catch(error){storageFailure(error);data=migrateLegacy(legacy,legacySnapshot);}
  render(false);await Promise.allSettled([hydrateFromCompanion(),hydrateAiConfig()]);
}
window.addEventListener('popstate',()=>closePanels(true));
window.addEventListener('online',()=>{state.online=true;hydrateFromCompanion();hydrateAiConfig();});
window.addEventListener('offline',()=>{state.online=false;state.connection=state.snapshot?'cached':'error';state.aiEnabled=false;render();});
window.addEventListener('resize',()=>render());
window.addEventListener('scroll',()=>{clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{capturePosition();saveState();},100);},{passive:true});
window.addEventListener('pagehide',()=>{capturePosition();saveState(true);});
document.addEventListener('visibilitychange',()=>{if(document.hidden){capturePosition();saveState(true);if(mindfulnessSession?.status==='running'){pauseMindfulness(mindfulnessSession);clearInterval(mindfulnessTickTimer);render(false);}}else tickFocusTimer();});
// One animation owns the scroll position; key repeat never restarts the easing.
let keyboardScroll=null, keyboardScrollFrame=0;
function stopKeyboardScroll() {cancelAnimationFrame(keyboardScrollFrame);keyboardScroll=null;}
function scrollReader(scroller,direction,key) {
  if(matchMedia('(prefers-reduced-motion:reduce)').matches) {
    stopKeyboardScroll();scroller.scrollBy({top:direction*80,behavior:'instant'});return;
  }
  if(keyboardScroll?.scroller===scroller&&keyboardScroll.key===key&&keyboardScroll.held)return;
  stopKeyboardScroll();
  const motion={scroller,key,direction,held:true,position:scroller.scrollTop,target:scroller.scrollTop+direction*64,last:performance.now()};
  keyboardScroll=motion;
  function frame(now) {
    if(keyboardScroll!==motion||!scroller.isConnected)return;
    const dt=Math.min(40,now-motion.last);motion.last=now;
    if(motion.held)motion.target+=direction*420*dt/1000;
    motion.target=Math.max(0,Math.min(scroller.scrollHeight-scroller.clientHeight,motion.target));
    const remaining=motion.target-motion.position;
    motion.position=Math.abs(remaining)<1?motion.target:motion.position+remaining*(1-Math.exp(-dt/140));
    scroller.scrollTo({top:motion.position,behavior:'instant'});
    if(!motion.held&&Math.abs(motion.target-scroller.scrollTop)<1){stopKeyboardScroll();return;}
    keyboardScrollFrame=requestAnimationFrame(frame);
  }
  keyboardScrollFrame=requestAnimationFrame(frame);
}
document.addEventListener('keyup',e=>{if(keyboardScroll?.key===e.key)keyboardScroll.held=false;});
for(const name of ['wheel','touchstart','pointerdown'])document.addEventListener(name,stopKeyboardScroll,{passive:true});
window.addEventListener('blur',stopKeyboardScroll);
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopKeyboardScroll();});
// Reader shortcuts leave text fields, native controls, tab navigation and guide dialogs alone.
document.addEventListener('keydown',e=>{
  if(e.defaultPrevented||e.isComposing||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||mindfulnessSession||state.utilityMenu||state.filesOpen||state.chatOpen&&overlayGuide())return;
  if(e.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="tablist"],[role="separator"],.chat-panel,.utility-menu'))return;
  if(!selectedFile())return;
  if(e.key==='Enter') {
    if(supportingSource||e.target.closest('button,a,summary,[role="button"]'))return;
    e.preventDefault();if(!e.repeat)nextFile(true);
  }else if(e.key==='ArrowLeft'||e.key==='ArrowRight') {
    e.preventDefault();const list=files(),index=list.findIndex(f=>f.id===state.selectedFile),next=list[index+(e.key==='ArrowRight'?1:-1)];
    if(next)selectFile(next.id);
  }else if(e.key==='ArrowDown'||e.key==='ArrowUp') {
    const direction=e.key==='ArrowDown'?1:-1;
    const candidates=[root.querySelector('.code-viewer,.markdown-preview'),root.querySelector('#review-content'),root.querySelector('.review-panel'),document.scrollingElement];
    const scroller=candidates.find(el=>el&&el.scrollHeight>el.clientHeight+1&&(direction>0?el.scrollTop+el.clientHeight<el.scrollHeight-1:el.scrollTop>0));
    if(scroller){e.preventDefault();scrollReader(scroller,direction,e.key);}
  }
});
document.addEventListener('keydown',(e)=>{
  if(mindfulnessSession){
    const panel=root.querySelector('.mindfulness-overlay');
    if(e.key==='Escape'){e.preventDefault();closeMindfulness();return;}
    if(e.key==='Tab'){const focusable=[...panel.querySelectorAll('button:not([disabled]),select,summary')].filter(el=>el.getClientRects().length);const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
    return;
  }
  const panel=small()&&state.filesOpen?root.querySelector('#file-panel'):overlayGuide()&&state.chatOpen?root.querySelector('#chat-panel'):null;if(!panel)return;
  if(e.key==='Escape'){e.preventDefault();closePanels();return;}
  if(e.key==='Tab'){const focusable=[...panel.querySelectorAll('button:not([disabled]),textarea,input,select,a[href],summary')].filter((el)=>el.getClientRects().length);const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
});
if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).catch(()=>{});
render(false);
initialize().then(tickFocusTimer);
setInterval(tickFocusTimer,1000);
