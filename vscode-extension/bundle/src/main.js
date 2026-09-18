import { createWalkthroughUI } from './walkthrough.js';
import { readReply } from './transport.js';
import { escapeHtml as esc, icon, renderMarkdown } from './render.js';
import { demoFiles } from './demo.js';
import { emptyState, openStorage, sanitizeState, migrateLegacy, validateSnapshot, reviewKey, sessionKey, comparisonKey, sessionFor, notesFor, noteIsCurrent, createBackup, parseBackup, mergeState, reviewSummary } from './storage.js';

const root = document.querySelector('#root');
export let data = emptyState();
export const state = { snapshot:null, selectedFile:'', activeTab:'diff', online:navigator.onLine, connection:'connecting', connectionError:'', aiEnabled:false, aiProvider:'', guideMode:'walkthrough', aiMessage:'', filesOpen:false, chatOpen:false, guideCollapsed:false, sourceLoading:new Set(), sourceErrors:new Map(), toast:'', storageError:'', demo:false, apiToken:'' };
let storage, saveTimer, scrollTimer, toastTimer, refreshSequence = 0, dialogReturnFocus;
const sourceRequests = new Map();
let chatController, citation;
const walkthrough = createWalkthroughUI({getState:()=>state,getData:()=>data,save:saveState,render,apiFetch,jump:jumpCitation});
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
async function saveSnapshot(snapshot) { if (!storage || state.demo) return; try { await storage.put('snapshot',snapshot); } catch(error) { storageFailure(error); } }
function capturePosition() {
  const session=currentSession(); if (!session) return;
  const panel=document.querySelector('.review-panel');
  const viewer=document.querySelector('.code-viewer,.markdown-preview');
  const chat=document.querySelector('.chat-scroll');
  const walk=document.querySelector('.walkthrough-scroll'), record=state.snapshot&&data.walkthroughs[JSON.stringify([state.snapshot.repoId,state.snapshot.snapshotId])];
  if(walk&&record)record.scroll=walk.scrollTop;
  if(panel) session.scroll.panel=panel.scrollTop;
  if(viewer) session.scroll[state.activeTab]=viewer.scrollTop;
  if(chat) session.scroll.chat=chat.scrollTop;
  session.scroll.window=window.scrollY;
}
export function apiFetch(path, options={}) {
  const headers = new Headers(options.headers || {});
  if(state.apiToken) headers.set('x-patchwork-token',state.apiToken);
  return fetch(path,{...options,headers,cache:'no-store',signal:options.signal || AbortSignal.timeout(path.startsWith('/api/ai') || path.startsWith('/api/walkthrough') ? 120000 : 20000)});
}
function toast(text) { state.toast=text; clearTimeout(toastTimer); render(); toastTimer=setTimeout(() => {state.toast=''; render();},4500); }
export function selectFile(id) {
  const next=files().find((f)=>f.id===id); if(!next) return;
  capturePosition();
  if(state.filesOpen && history.state?.patchworkPanel) history.back();
  state.selectedFile=id; state.filesOpen=false;
  data.selections[comparisonKey(state.snapshot)]=next.path;
  if(state.activeTab==='preview' && !isPreviewable(next)) state.activeTab='diff';
  saveState(); render(false);
  if(['source','preview'].includes(state.activeTab)) hydrateFileSource(next);
}
function nextFile(mark=false) {
  const file=selectedFile(); if(!file) return;
  if(mark) data.reviews[reviewKey(state.snapshot,file)]=true;
  const list=files(), index=list.indexOf(file), ordered=[...list.slice(index+1),...list.slice(0,index)];
  const next=mark ? ordered.find((f)=>!reviewed(f)) || ordered[0] : ordered[0];
  saveState();
  if(next) selectFile(next.id); else render();
  if(mark && list.every(reviewed)) toast('All files in this snapshot are reviewed. Export a summary for desktop follow-up.');
}
function setActiveTab(tab) {
  const f=selectedFile(); if(!f || !['diff','source','preview','notes'].includes(tab) || (tab==='preview'&&!isPreviewable(f))) return;
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
  const rows=(file.lines || []).map(([rawKind,number,text])=>{
    const kind=['context','normal','added','removed','blank','hunk'].includes(rawKind)?rawKind:'normal';
    const changed=kind==='added'||kind==='removed';
    const hunkStart=(changed&&!previousChange)||kind==='hunk'; previousChange=changed;
    const line=Number(number), validLine=Number.isInteger(line)&&line>0;
    return `<div class="code-line ${kind} ${hunkStart?'hunk-start':''}" ${hunkStart?`data-hunk="${hunk++}"`:''}><button class="line-number" ${validLine?`data-line="${line}" data-side="${kind==='removed'?'old':'new'}" aria-label="Add a note at ${kind==='removed'?'old':'new'} line ${line}"`:'disabled aria-label="Diff separator"'}>${esc(number)}</button><span class="line-sign">${kind==='added'?'+':kind==='removed'?'−':''}</span><code>${esc(text)||'&nbsp;'}</code></div>`;
  });
  if(!data.preferences.compactContext) return rows.join('');
  const output=[];
  for(let i=0;i<rows.length;) {
    if(['added','removed','hunk'].includes(file.lines[i][0])) {output.push(rows[i++]);continue;}
    const start=i; while(i<rows.length&&!['added','removed','hunk'].includes(file.lines[i][0])) i++;
    if(i-start>4) output.push(rows[start],`<details class="unchanged-context"><summary>${i-start-2} unchanged lines</summary>${rows.slice(start+1,i-1).join('')}</details>`,rows[i-1]);
    else output.push(...rows.slice(start,i));
  }
  return output.join('');
}
function notesContent(file) {
  const session=currentSession(), notes=notesFor(data,state.snapshot,file);
  return `<section class="notes-card"><div class="notes-content"><h3>Questions & notes</h3><p>Private to this browser. Export a backup before changing tunnel links. Tap a code line to anchor a question.</p><form id="note-form"><div class="note-range"><label>Side <select name="side"><option value="new" ${session.noteSide==='old'?'':'selected'}>New source</option><option value="old" ${session.noteSide==='old'?'selected':''}>Old source</option></select></label><label>Start line <input name="start" type="number" min="1" step="1" value="${esc(session.noteStart)}"></label><label>End line <input name="end" type="number" min="1" step="1" value="${esc(session.noteEnd)}"></label></div><label for="note-text">Question or follow-up</label><textarea id="note-text" name="note" required placeholder="What needs another look?">${esc(session.noteDraft)}</textarea><button class="primary-button" type="submit">Save question</button><span class="note-save-status">Draft saved on this device${state.storageError?' — storage error':''}</span></form><div class="note-list">${notes.map((n)=>`<article class="review-note"><span class="eyebrow">${noteIsCurrent(n,state.snapshot,file)?'CURRENT REVISION':`HISTORICAL · ${esc(n.version.slice(0,12))}`} · ${esc(n.status)}</span><p class="note-anchor">${n.start?`${n.side==='old'?'Old':'New'} lines ${n.start}–${n.end||n.start}`:'Whole file'} · ${esc(n.createdAt)}</p><p class="note-text">${esc(n.text)}</p><button class="secondary-button" data-note-toggle="${esc(n.id)}">${n.status==='resolved'?'Reopen question':'Resolve question'}</button></article>`).join('')}</div>${data.historicalNotes.length?`<details class="legacy-notes"><summary>${data.historicalNotes.length} legacy notes (repository and revision unverified)</summary>${data.historicalNotes.map((n)=>`<article><b>${esc(n.path)}</b><p>${esc(n.text)}</p></article>`).join('')}</details>`:''}</div></section>`;
}
function renderContent(file) {
  if(state.activeTab==='notes') return notesContent(file);
  const sourceTab=state.activeTab!=='diff', key=sessionKey(state.snapshot,file);
  if(sourceTab && typeof file.source!=='string') return `<section class="source-empty"><h3>${state.sourceLoading.has(key)?'Reading snapshot source…':file.sourceAvailable===false?'Source unavailable for this entry':state.online?'Source is not cached for this snapshot':'Offline — source not cached'}</h3><p>${esc(state.sourceErrors.get(key)||file.sourceReason||'The diff is available. Source must be fetched from this exact immutable snapshot.')}</p>${state.online&&file.sourceAvailable!==false&&!state.sourceLoading.has(key)?'<button class="secondary-button" data-action="retry-source">Load snapshot source</button>':''}</section>`;
  return `<section class="code-card ${state.activeTab==='preview'?'preview-card':''}"><div class="code-toolbar"><span>${icon('branch',15)} ${sourceTab?'Snapshot source':'Working tree diff'}</span>${!sourceTab?'<button class="secondary-button" data-action="next-hunk">Next hunk ↓</button>':''}</div><div class="code-meta"><span>${esc(file.path)}</span><span>Revision ${esc(file.version.slice(0,12))}</span></div>${state.activeTab==='preview'?`<article class="markdown-preview">${renderMarkdown(file.source)}</article>`:`<div class="code-viewer ${data.preferences.wrap?'wrap-code':''}">${sourceTab?file.source.split(/\r?\n/).map((line,i)=>`<div class="source-line"><button class="line-number" data-line="${i+1}" data-side="new" aria-label="Add a note at line ${i+1}">${i+1}</button><code>${esc(line)||'&nbsp;'}</code></div>`).join(''):renderDiff(file)||'<p class="empty-diff">No textual diff available. Review the status and source where available.</p>'}</div>`}</section>`;
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
export function render(preservePosition=true) {
  if(preservePosition) capturePosition();
  const active=document.activeElement;
  const focus=active?.id?{id:active.id,start:active.selectionStart,end:active.selectionEnd}:null;
  const file=selectedFile(), session=currentSession(), count=files().filter(reviewed).length;
  const guideHidden=overlayGuide()?!state.chatOpen:state.guideCollapsed;
  const drawerHidden=small()&&!state.filesOpen;
  const modal=small()&&state.filesOpen?'files':overlayGuide()&&state.chatOpen?'chat':null;
  const unresolved=data.notes.filter((n)=>n.repoId===state.snapshot?.repoId&&n.status==='open').length;
  const controls=`<div class="backup-actions"><button class="secondary-button" data-action="export-backup">Export backup</button><button class="secondary-button" data-action="import-backup">Import backup</button><button class="secondary-button" data-action="export-summary">Export summary</button><button class="secondary-button" data-action="clear-cache">Clear cached source</button></div>`;
  root.innerHTML=`<div class="app-shell ${state.filesOpen?'files-is-open':''} ${state.chatOpen?'chat-is-open':''} ${guideHidden?'guide-is-collapsed':''}" style="--code-size:${data.preferences.codeSize}px">
    <header class="mobile-topbar" ${modal?'inert':''}><button class="icon-button" data-action="toggle-files" aria-label="Open files">${icon('menu')}</button><div class="mobile-wordmark"><span class="wordmark-mark">${icon('logo')}</span>patchwork</div><button class="icon-button" data-action="toggle-chat" aria-label="Open code guide">${icon('message')}</button></header>
    <aside class="sidebar" ${modal?'inert':''}><div class="brand"><span class="brand-mark">${icon('logo',24)}</span><span>patchwork</span></div><div class="workspace-switcher"><span class="repo-avatar">${esc((state.snapshot?.workspaceName||'PW').slice(0,2).toUpperCase())}</span><span><b>${esc(state.snapshot?.workspaceName||'Your workspace')}</b><small>${state.demo?'Demo · sample code':'Device-private review'}</small></span></div><div class="primary-nav"><span class="nav-item active">${icon('grid')}<span>Review queue</span></span></div><div class="sidebar-spacer"></div><p class="privacy-copy">Notes stay in this browser. A new temporary tunnel has a new browser store; carry your review with a private backup.</p>${controls}</aside>
    ${modal?'<button class="file-drawer-scrim" data-action="close-panels" tabindex="-1" aria-label="Close panel"></button>':''}
    <aside class="file-panel" id="file-panel" ${drawerHidden?'inert aria-hidden="true"':''} ${modal==='chat'?'inert':''} ${modal==='files'?'role="dialog" aria-modal="true" aria-label="Review files"':''}><div class="file-panel-header"><div><span class="eyebrow">WORKSPACE</span><h1>Review queue</h1></div><button class="close-files icon-button" data-action="close-panels" aria-label="Close files">${icon('close')}</button></div><div class="branch-row"><span class="branch-name">${icon('branch',14)}${esc(state.snapshot?.branch||'No branch loaded')}</span></div><div class="queue-progress"><div class="progress-copy"><span>${count} of ${files().length} reviewed</span><b>${unresolved} open questions</b></div><progress max="${files().length||1}" value="${count}" aria-label="Files reviewed"></progress></div><div class="queue-heading"><span>CHANGED FILES ${files().length}</span><button data-action="refresh-snapshot">Refresh ${icon('wifi',14)}</button></div><div class="file-list">${files().map(renderFileRow).join('')}</div><div class="offline-card"><span>${icon('wifi')}</span><span><b>${esc(statusText())}</b><small>${esc(age())}</small></span></div><details class="mobile-backups"><summary>Backup & handoff</summary><p>Backups contain private notes, chats, and code. Share only when you choose.</p>${controls}</details></aside>
    <main class="review-panel" ${modal?'inert':''}><div class="review-topline"><div class="breadcrumbs">${esc(state.snapshot?.workspaceName||'Patchwork')}</div><button class="secondary-button" data-action="toggle-chat">${icon('message',16)} Code guide</button></div><div class="connection-details" role="status"><span>${state.online?'Internet available':'Internet offline'}</span><span>${esc(statusText())}</span><span>${esc(age())}</span></div>${state.connectionError?`<p class="connection-error">${esc(state.connectionError)}</p>`:''}<div id="storage-alert" role="alert" ${state.storageError?'':'hidden'}>${esc(state.storageError)}</div>${state.demo?'<p class="demo-banner">Demo workspace — sample files, no live repository.</p>':''}
    ${file?`<section class="review-heading"><div class="review-heading-main"><div class="file-type large type-${esc(file.tone)}">${esc(file.type)}</div><div><div class="file-title-row"><h2>${esc(file.label)}</h2><span class="${reviewed(file)?'reviewed':'needs-review'}-pill">${reviewed(file)?'Reviewed':'Needs review'}</span></div><p>${esc(file.path)}</p><p>${esc(file.status||'modified')}${file.oldPath?` · renamed from ${esc(file.oldPath)}`:''}</p></div></div></section><div class="reading-controls"><label>Code size <select id="code-size" aria-label="Code font size">${[13,14,16,18].map((n)=>`<option value="${n}" ${data.preferences.codeSize===n?'selected':''}>${n}px</option>`).join('')}</select></label><label><input id="wrap-code" type="checkbox" ${data.preferences.wrap?'checked':''}> Wrap</label><label><input id="compact-context" type="checkbox" ${data.preferences.compactContext?'checked':''}> Fold context</label></div><div class="review-tabs" role="tablist" aria-label="File views">${['diff','source',...(isPreviewable(file)?['preview']:[]),'notes'].map((tab)=>`<button id="tab-${tab}" role="tab" aria-selected="${state.activeTab===tab}" aria-controls="review-content" tabindex="${state.activeTab===tab?'0':'-1'}" class="review-tab ${state.activeTab===tab?'active':''}" data-tab="${tab}">${tab[0].toUpperCase()+tab.slice(1)}${tab==='notes'?` (${notesFor(data,state.snapshot,file).filter((n)=>n.status==='open').length})`:''}</button>`).join('')}</div><div id="review-content" role="tabpanel" aria-labelledby="tab-${state.activeTab}" tabindex="0">${renderContent(file)}</div><section class="review-footer"><div class="footer-actions"><button class="primary-button" data-action="review-next">Reviewed & next ${icon('check',16)}</button><button class="secondary-button" data-action="question">Question</button><button class="secondary-button" data-action="skip-file">Skip</button></div>${reviewed(file)?'<button class="secondary-button" data-action="reopen-file">Reopen review</button>':''}</section>`:emptyContent()}</main>
    <aside class="chat-panel" id="chat-panel" aria-label="Code guide" ${guideHidden?'inert aria-hidden="true"':''} ${modal==='files'?'inert':''} ${modal==='chat'?'role="dialog" aria-modal="true"':''}><div class="chat-header"><div class="chat-title"><div class="chat-avatar">${icon('spark')}</div><div><h2>Code guide</h2><span>${state.demo?'Demo · AI unavailable':esc(labelForProvider())}</span></div></div><button class="icon-button" data-action="close-guide" aria-label="Close code guide">${icon('close')}</button></div><div class="context-chip">${esc(file?.path||'Choose a file')}</div><div class="guide-modes"><button class="secondary-button" data-guide-mode="walkthrough" aria-pressed="${state.guideMode==='walkthrough'}">Walkthrough</button><button class="secondary-button" data-guide-mode="chat" aria-pressed="${state.guideMode==='chat'}">Conversation</button></div>${state.guideMode==='walkthrough'?`<div class="walkthrough-scroll">${walkthrough.html()}</div>`:`<div class="chat-scroll" role="log" aria-live="polite">${conversationHistory(file)}${session?.chat.length?session.chat.map((m)=>`<div class="chat-message ${m.role==='user'?'user':'assistant'} ${m.pending?'pending':''}"><div class="message-bubble">${esc(m.text)}</div></div>`).join(''):`<p class="guide-intro">${state.demo?'This is sample code. Connect your laptop to ask an AI guide about real changes.':esc(state.aiMessage||'Ask about the selected file’s exact snapshot. Your provider must be configured on the laptop. Questions are sent only when you press Send.')}</p>`}</div>${file?`<form class="chat-composer" id="chat-form"><label class="sr-only" for="chat-draft">Question about ${esc(file.label)}</label><textarea id="chat-draft" name="message" rows="2" placeholder="Ask about this snapshot…">${esc(session.draft)}</textarea><div class="composer-bottom"><span>${state.aiEnabled&&!state.demo?esc(labelForProvider()):esc(state.demo?'Demo · AI unavailable':labelForProvider())}</span><button type="submit" aria-label="Send question" ${!state.aiEnabled||!state.online||state.demo||session.chat.some((m)=>m.pending)?'disabled':''}>${icon('send')}</button></div><button type="button" class="secondary-button" data-action="new-chat" ${chatController?'disabled':''}>New conversation</button>${chatController?'<button type="button" class="secondary-button" data-action="stop-chat">Stop response</button>':''}</form>`:''}`}</aside>
    <input id="backup-file" type="file" accept="application/json,.json" hidden><div class="sr-only" role="status" aria-live="polite">${esc(state.toast)}</div>${state.toast?`<div class="toast">${esc(state.toast)}</div>`:''}</div>`;
  wireEvents();
  walkthrough.bind(root);
  highlightCitation();
  const walkPanel=root.querySelector('.walkthrough-scroll'), walkRecord=state.snapshot&&data.walkthroughs[JSON.stringify([state.snapshot.repoId,state.snapshot.snapshotId])];
  if(walkPanel&&walkRecord)walkPanel.scrollTop=walkRecord.scroll||0;
  if(session) {
    const viewer=document.querySelector('.code-viewer,.markdown-preview'); if(viewer) viewer.scrollTop=session.scroll[state.activeTab]||0;
    document.querySelector('.review-panel').scrollTop=session.scroll.panel||0;
    const chat=document.querySelector('.chat-scroll');
  const walk=document.querySelector('.walkthrough-scroll'), record=state.snapshot&&data.walkthroughs[JSON.stringify([state.snapshot.repoId,state.snapshot.snapshotId])];
  if(walk&&record)record.scroll=walk.scrollTop; if(chat) chat.scrollTop=session.scroll.chat||0;
    if(small()&&!modal) window.scrollTo(0,session.scroll.window||0);
  }
  if(focus) {const el=document.getElementById(focus.id); if(el&&!el.closest('[inert]')) {el.focus({preventScroll:true});if(typeof el.setSelectionRange==='function'&&focus.start!==null) {try{el.setSelectionRange(focus.start,focus.end);}catch{}}}}
}
function openPanel(which) {
  const active=document.activeElement;
  dialogReturnFocus=active?.dataset.action||null;
  if((which==='files'&&small())||(which==='chat'&&overlayGuide())) {
    const method=history.state?.patchworkPanel?'replaceState':'pushState';
    history[method]({patchworkPanel:which},'',location.href);
  }
  state.filesOpen=which==='files'; state.chatOpen=which==='chat'; if(which==='chat') state.guideCollapsed=false;
  render();
  const panel=document.querySelector(which==='files'?'#file-panel':'#chat-panel');
  panel?.querySelector('button,textarea')?.focus();
}
function closePanels(fromHistory=false) {
  if(!fromHistory&&history.state?.patchworkPanel)history.back();
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
  data.notes.push({id:crypto.randomUUID(),repoId:state.snapshot.repoId,base:state.snapshot.base,branch:state.snapshot.branch,path:file.path,version:file.version,snapshotId:state.snapshot.snapshotId,text,start,end,side,status:'open',createdAt:new Date().toISOString()});
  session.noteDraft='';session.noteStart='';session.noteEnd='';await saveState(true);toast(state.storageError?'Question is in this tab. Export a backup: device storage failed.':'Question saved privately on this device.');
}
function wireEvents() {
  root.querySelectorAll('[data-guide-mode]').forEach((el)=>el.addEventListener('click',()=>{state.guideMode=el.dataset.guideMode;render();}));
  root.querySelectorAll('[data-file-id]').forEach((el)=>el.addEventListener('click',()=>selectFile(el.dataset.fileId)));
  root.querySelectorAll('[data-tab]').forEach((el)=>{
    el.addEventListener('click',()=>setActiveTab(el.dataset.tab));
    el.addEventListener('keydown',(e)=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=[...root.querySelectorAll('[data-tab]')],index=tabs.indexOf(el),next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;setActiveTab(tabs[next].dataset.tab);document.getElementById(`tab-${tabs[next].dataset.tab}`)?.focus();});
  });
  root.querySelectorAll('[data-line]').forEach((el)=>el.addEventListener('click',()=>{const s=currentSession();s.noteStart=el.dataset.line;s.noteEnd=el.dataset.line;s.noteSide=el.dataset.side;setActiveTab('notes');document.querySelector('#note-text')?.focus();}));
  root.querySelectorAll('[data-note-toggle]').forEach((el)=>el.addEventListener('click',()=>{const n=data.notes.find((n)=>n.id===el.dataset.noteToggle);if(n)n.status=n.status==='open'?'resolved':'open';saveState();render();}));
  root.querySelectorAll('[data-action]').forEach((el)=>el.addEventListener('click',async()=>{
    switch(el.dataset.action) {
      case 'new-chat': {const s=currentSession();if(!s||chatController)break;s.archives||=[];if(s.chat.length)s.archives.push(s.chat);s.chat=[];s.conversationId=crypto.randomUUID();saveState();render();break;}
      case 'stop-chat':chatController?.abort();break;
      case 'toggle-files': state.filesOpen?closePanels():openPanel('files');break;
      case 'toggle-chat': (state.chatOpen||(!overlayGuide()&&!state.guideCollapsed))?(state.guideCollapsed=true,closePanels()):openPanel('chat');break;
      case 'close-guide': state.guideCollapsed=true;closePanels();break;
      case 'close-panels':closePanels();break;
      case 'refresh-snapshot':await hydrateFromCompanion();await hydrateAiConfig();break;
      case 'review-next':nextFile(true);break;
      case 'skip-file':nextFile();break;
      case 'reopen-file':delete data.reviews[reviewKey(state.snapshot,selectedFile())];saveState();render();break;
      case 'question':setActiveTab('notes');document.querySelector('#note-text')?.focus();break;
      case 'retry-source':hydrateFileSource(selectedFile());break;
      case 'load-demo':loadDemo();break;
      case 'next-hunk':{const viewer=root.querySelector('.code-viewer');if(!viewer)break;const hunks=[...viewer.querySelectorAll('[data-hunk]')];const next=hunks.find((h)=>h.offsetTop-viewer.offsetTop>viewer.scrollTop+8)||hunks[0];if(next)viewer.scrollTo({top:next.offsetTop-viewer.offsetTop,behavior:'smooth'});break;}
      case 'export-backup':capturePosition();download('patchwork-private-backup.json',JSON.stringify(createBackup(data,state.demo?null:state.snapshot),null,2));break;
      case 'import-backup':document.querySelector('#backup-file').click();break;
      case 'export-summary':download('patchwork-review.md',reviewSummary(data,state.snapshot),'text/markdown');break;
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
    try { if(file.size>50*1024*1024)throw new Error('Backup exceeds the 50 MB import limit.');const imported=parseBackup(await file.text());capturePosition();data=mergeState(data,imported.data);if(imported.snapshot){state.snapshot=imported.snapshot;state.demo=false;state.connection='cached';state.connectionError='Imported snapshot — reconnect to check the laptop.';state.selectedFile=files().find((f)=>f.path===data.selections[comparisonKey(state.snapshot)])?.id||files()[0]?.id||'';await saveSnapshot(state.snapshot);}await saveState(true);toast('Backup imported privately into this browser.'); }
    catch(error){toast(`Import failed: ${error.message}`);}
  });
  root.querySelectorAll('.code-viewer,.markdown-preview,.review-panel,.chat-scroll,.walkthrough-scroll').forEach((el)=>el.addEventListener('scroll',()=>{clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{capturePosition();saveState();},100);},{passive:true}));
}
/** Provider boundary: only explicit sends reach the laptop, using immutable context. */
export async function requestAi({ message, history=[], file, snapshotId, sessionId, signal, onDelta }) {
  const response=await apiFetch('/api/ai/stream',{method:'POST',headers:{'content-type':'application/json'},signal,body:JSON.stringify({message,history,file:{id:file.id,path:file.path},snapshotId,sessionId})});
  return readReply(response,onDelta);
}
async function sendChat() {
  const file=selectedFile(), snapshot=state.snapshot, session=currentSession();
  const question=session?.draft.trim();if(!file||!question||!state.aiEnabled||!state.online||state.demo||chatController)return;
  const history=session.chat.filter((m)=>!m.pending&&!m.error).map((m)=>({role:m.role,text:m.text}));
  session.conversationId ||= crypto.randomUUID();
  session.draft='';session.chat.push({role:'user',text:question});const pending={role:'assistant',text:'',pending:true};session.chat.push(pending);
  const controller=new AbortController();chatController=controller;saveState();render();let lastRender=0;
  try {const payload=await requestAi({message:question,history,file,snapshotId:snapshot.snapshotId,sessionId:session.conversationId,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(120000)]),onDelta:(text)=>{pending.text+=text;if(Date.now()-lastRender>100&&state.snapshot===snapshot&&selectedFile()===file){lastRender=Date.now();render();}}});pending.text=payload.text;}
  catch(error){pending.error=true;pending.text=controller.signal.aborted?'Stopped.':`Guide unavailable: ${error.message}. Your question remains in this conversation.`;}
  finally {pending.pending=false;chatController=null;saveState();render();}
}
async function jumpCitation(target) {
  const file=state.snapshot?.files.find((f)=>f.id===target.fileId);if(!file)return;
  citation={...target,snapshotId:state.snapshot.snapshotId};
  if(history.state?.patchworkPanel)history.back();
  state.activeTab=target.side==='old'?'diff':'source';state.chatOpen=false;state.filesOpen=false;
  selectFile(file.id);
  if(target.side==='new')await hydrateFileSource(file);
  render();
  const line=root.querySelector('.citation-highlight');
  if(line){line.closest('details')?.setAttribute('open','');line.scrollIntoView({block:'center',behavior:'smooth'});}
}
function highlightCitation() {
  if(!citation||citation.snapshotId!==state.snapshot?.snapshotId||citation.fileId!==state.selectedFile)return;
  root.querySelectorAll('[data-line]').forEach((el)=>{if(el.dataset.side===citation.side&&Number(el.dataset.line)>=citation.startLine&&Number(el.dataset.line)<=citation.endLine)el.closest('.code-line,.source-line')?.classList.add('citation-highlight');});
}
export async function hydrateFromCompanion() {
  const sequence=++refreshSequence;
  state.connection='connecting';state.connectionError='';render();
  try {
    const response=await apiFetch('/api/snapshot');
    if(response.status===401) {if(sequence===refreshSequence){state.connection='pairing';state.connectionError='Open the pairing link from the laptop to authorize this browser.';}return;}
    const payload=await response.json();if(!response.ok)throw new Error(payload.error||'The laptop could not capture the repository.');
    const snapshot=validateSnapshot(payload);if(sequence!==refreshSequence)return;
    capturePosition();const old=state.snapshot;
    // Sources are reusable only when both immutable snapshot identity and revision match.
    if(old?.repoId===snapshot.repoId&&old.snapshotId===snapshot.snapshotId) for(const file of snapshot.files){const prior=old.files.find((f)=>f.path===file.path&&f.version===file.version);if(typeof prior?.source==='string')file.source=prior.source;}
    state.snapshot=snapshot;state.demo=false;state.connection='connected';state.connectionError='';
    state.selectedFile=snapshot.files.find((f)=>f.path===data.selections[comparisonKey(snapshot)])?.id||snapshot.files[0]?.id||'';
    if(selectedFile()&&state.activeTab==='preview'&&!isPreviewable(selectedFile()))state.activeTab='diff';
    await saveSnapshot(snapshot);saveState();render(false);
    if(['source','preview'].includes(state.activeTab))hydrateFileSource(selectedFile());
  }catch(error){if(sequence===refreshSequence){state.connection=state.snapshot?'cached':'error';state.connectionError=`Laptop snapshot unavailable: ${error.message || 'connection failed'}. ${state.snapshot?'Showing the previously captured snapshot.':'No repository snapshot is loaded.'}`;}}
  finally{if(sequence===refreshSequence)render(false);}
}
async function hydrateAiConfig() {
  try {const response=await apiFetch('/api/config');if(!response.ok)throw new Error('Provider unavailable');const config=await response.json();state.aiEnabled=Boolean(config.aiEnabled);state.aiProvider=typeof config.provider==='string'?config.provider:'';state.aiMessage=typeof config.message==='string'?config.message:'';}
  catch {state.aiEnabled=false;state.aiProvider='';state.aiMessage='AI status is unavailable while the laptop cannot be reached.';}
  render();
}
function loadDemo(){capturePosition();state.demo=true;state.snapshot=validateSnapshot({repoId:'patchwork-demo',base:'demo-base',head:'demo-head',branch:'demo',snapshotId:'demo-v2',generatedAt:new Date().toISOString(),workspaceName:'Sample workspace',files:demoFiles.map((f)=>({...f,version:`demo-${f.id}-v2`,status:'modified',sourceAvailable:true,source:f.lines.filter(([kind])=>kind!=='removed').map(([, ,text])=>text).join('\n')}))});state.selectedFile=files()[0].id;state.connectionError='';render(false);}
async function initialize() {
  let legacy={}, legacySnapshot=null;
  try {legacy=JSON.parse(localStorage.getItem('patchwork-state-v1')||'{}');legacySnapshot=JSON.parse(localStorage.getItem('patchwork-snapshot-v1')||'null');state.apiToken=new URLSearchParams(location.search).get('token')||localStorage.getItem('patchwork-api-token')||legacy.apiToken||'';if(state.apiToken)localStorage.setItem('patchwork-api-token',state.apiToken);}
  catch(error){storageFailure(error);state.apiToken=new URLSearchParams(location.search).get('token')||'';}
  if(new URLSearchParams(location.search).has('token')){const url=new URL(location.href);url.searchParams.delete('token');history.replaceState(null,'',url.pathname+url.search+url.hash);}
  try {storage=await openStorage();const saved=await storage.get('state');data=saved?sanitizeState(saved):migrateLegacy(legacy,legacySnapshot);const snapshot=await storage.get('snapshot');if(snapshot){state.snapshot=validateSnapshot(snapshot);state.connection='cached';state.selectedFile=files().find((f)=>f.path===data.selections[comparisonKey(state.snapshot)])?.id||files()[0]?.id||'';}await storage.put('state',data);try{localStorage.removeItem('patchwork-state-v1');localStorage.removeItem('patchwork-snapshot-v1');}catch{}}
  catch(error){storageFailure(error);data=migrateLegacy(legacy,legacySnapshot);}
  render(false);await Promise.allSettled([hydrateFromCompanion(),hydrateAiConfig()]);
}
window.addEventListener('popstate',()=>closePanels(true));
window.addEventListener('online',()=>{state.online=true;hydrateFromCompanion();hydrateAiConfig();});
window.addEventListener('offline',()=>{state.online=false;state.connection=state.snapshot?'cached':'error';state.aiEnabled=false;render();});
window.addEventListener('resize',()=>render());
window.addEventListener('scroll',()=>{clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{capturePosition();saveState();},100);},{passive:true});
window.addEventListener('pagehide',()=>{capturePosition();saveState(true);});
document.addEventListener('visibilitychange',()=>{if(document.hidden){capturePosition();saveState(true);}});
document.addEventListener('keydown',(e)=>{
  const panel=small()&&state.filesOpen?root.querySelector('#file-panel'):overlayGuide()&&state.chatOpen?root.querySelector('#chat-panel'):null;if(!panel)return;
  if(e.key==='Escape'){e.preventDefault();closePanels();return;}
  if(e.key==='Tab'){const focusable=[...panel.querySelectorAll('button:not([disabled]),textarea,input,select,a[href],summary')].filter((el)=>el.getClientRects().length);const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
});
if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).catch(()=>{});
render(false);
initialize();
