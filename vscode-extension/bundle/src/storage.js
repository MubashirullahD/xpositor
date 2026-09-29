import { sanitizeAgentWorkspace } from './agent-guide.js';
import { sanitizeDeepWorkspace } from './deep-review.js';
import { newTimer, sanitizeTimer } from './focus-timer.js';
import { sanitizeWalkthrough } from './walkthrough.js';
/** Device-private, revision-scoped review state. No credentials enter this module. */
export const SCHEMA = 2;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
export const comparisonKey = (snapshot) => JSON.stringify([snapshot.repoId, snapshot.base, snapshot.branch]);
// Review decisions survive a refreshed snapshot only when the repository,
// comparison, path, and exact file revision are all unchanged.
export const reviewKey = (snapshot, file) => JSON.stringify([snapshot.repoId, snapshot.base, snapshot.branch, file.path, file.version]);
export const sessionKey = (snapshot, file) => JSON.stringify([snapshot.repoId, snapshot.snapshotId, file.path, file.version]);
export const emptyState = () => ({ schema: SCHEMA, pomodoro:newTimer(), reviews: {}, sessions: {}, walkthroughs: {}, agentGuides: {}, deepReviews:{}, notes: [], selections: {}, preferences: { scope:'unstaged', guideWidth:310, theme:'system', model:'', effort:'', codeSize: 14, wrap: false, compactContext: true, mindfulnessDuration:1, mindfulnessRate:6 }, historicalNotes: [] });
export function sessionFor(data, snapshot, file) {
  const key = sessionKey(snapshot, file);
  if (!own(data.sessions, key)) data.sessions[key] = { draft: '', chat: [], archives: [], scroll: {}, noteDraft: '', noteStart: '', noteEnd: '', noteSide: 'new' };
  return data.sessions[key];
}
export function validateSnapshot(value) {
  // An unborn Git repository has no HEAD yet. The companion represents that
  // honestly as null while using "empty-tree" as the comparison base.
  if (!value || typeof value !== 'object' || !['repoId','base','branch','snapshotId','generatedAt','workspaceName'].every((key) => typeof value[key] === 'string') || !(typeof value.head === 'string' || value.head === null) || !Array.isArray(value.files)) throw new Error('The companion returned an invalid snapshot.');
  const ids = new Set(), paths = new Set();
  const files = value.files.map((file) => {
    if (!file || typeof file.id !== 'string' || !file.id || typeof file.path !== 'string' || !file.path || typeof file.version !== 'string' || !file.version || ids.has(file.id) || paths.has(file.path)) throw new Error('Snapshot files need unique paths, IDs, and revisions.');
    ids.add(file.id); paths.add(file.path);
    return { ...file, lines: (Array.isArray(file.lines) ? file.lines : []).filter((line) => Array.isArray(line) && line.length >= 3).map(([kind, number, text]) => [String(kind), String(number), String(text)]), label: String(file.label ?? file.path.split('/').at(-1)), folder: String(file.folder ?? file.path.split('/').slice(0,-1).join('/')), type: String(file.type ?? 'FILE'), tone: ['lime','orange','blue','purple','pink'].includes(file.tone) ? file.tone : 'lime', added: Math.max(0, Number(file.added) || 0), removed: Math.max(0, Number(file.removed) || 0) };
  });
  return { ...value, scope:['all','staged','unstaged'].includes(value.scope)?value.scope:'all', files };
}
export function migrateLegacy(legacy = {}, snapshot = null) {
  const data = emptyState();
  for (const [id, text] of Object.entries(legacy.notes || {})) {
    if (typeof text !== 'string' || !text.trim()) continue;
    const file = snapshot?.files?.find((item) => item.id === id);
    data.historicalNotes.push({ id: `legacy:${id}`, path: file?.path || id, text, label: 'Legacy note — repository and revision unverified', createdAt: snapshot?.generatedAt || '' });
  }
  // Old reviewed flags and chats have no trustworthy repository/revision identity.
  return data;
}
export function sanitizeState(value) {
  const data = emptyState();
  if (!value || value.schema !== SCHEMA) return data;
  const validKey = (key, length) => { try { const parsed = JSON.parse(key); return Array.isArray(parsed) && parsed.length === length && parsed.every((x) => typeof x === 'string'); } catch { return false; } };
  data.pomodoro=sanitizeTimer(value.pomodoro);
  for (const [key, review] of Object.entries(value.reviews || {})) if (validKey(key, 5) && review === true) data.reviews[key] = true;
  for (const [key, item] of Object.entries(value.sessions || {})) {
    if (!validKey(key, 4) || !item || typeof item !== 'object') continue;
    data.sessions[key] = { conversationId:typeof item.conversationId==='string' && /^[a-zA-Z0-9_-]{16,80}$/.test(item.conversationId)?item.conversationId:undefined, draft: String(item.draft || ''), noteDraft: String(item.noteDraft || ''), noteStart: String(item.noteStart || ''), noteEnd: String(item.noteEnd || ''), noteSide: item.noteSide === 'old' ? 'old' : 'new', archives:(Array.isArray(item.archives)?item.archives:[]).filter(Array.isArray).map((chat)=>chat.filter((m)=>m&&['user','assistant'].includes(m.role)&&typeof m.text==='string').map(({role,text})=>({role,text}))), chat: (Array.isArray(item.chat) ? item.chat : []).filter((m) => m && ['user','assistant'].includes(m.role) && typeof m.text === 'string').map((m) => ({ role:m.role, error:Boolean(m.error||m.pending), text:m.pending ? 'The previous request was interrupted. Send your question again.' : m.text })), scroll: Object.fromEntries(Object.entries(item.scroll || {}).filter(([key, n]) => ['overview','diff','source','preview','notes','overviewX','diffX','sourceX','previewX','notesX','chat','panel','window'].includes(key) && Number.isFinite(n) && n >= 0)) };
  }
  for (const [key, record] of Object.entries(value.walkthroughs || {})) { if(validKey(key,2)) { const walk=sanitizeWalkthrough(record); if(walk)data.walkthroughs[key]=walk; } }
  for (const [key,record] of Object.entries(value.agentGuides||{})) if(validKey(key,2)) data.agentGuides[key]=sanitizeAgentWorkspace(record);
  for (const [key,record] of Object.entries(value.deepReviews||{})) if(validKey(key,2)) data.deepReviews[key]=sanitizeDeepWorkspace(record);
  data.notes = (Array.isArray(value.notes) ? value.notes : []).filter((n) => n && ['id','repoId','base','branch','path','version','snapshotId','text','createdAt'].every((key) => typeof n[key] === 'string')).map((n) => ({ id:n.id, repoId:n.repoId, base:n.base, branch:n.branch, path:n.path, version:n.version, snapshotId:n.snapshotId, text:n.text, createdAt:n.createdAt, status:n.status === 'resolved' ? 'resolved' : 'open', start: Number.isInteger(n.start) && n.start > 0 ? n.start : null, end: Number.isInteger(n.end) && n.end > 0 ? n.end : null, side:n.side === 'old' ? 'old' : 'new' }));
  data.historicalNotes = (Array.isArray(value.historicalNotes) ? value.historicalNotes : []).filter((n) => n && typeof n.text === 'string').map((n) => ({ id:String(n.id || ''), path:String(n.path || ''), text:n.text, label:'Legacy note — repository and revision unverified', createdAt:String(n.createdAt || '') }));
  for (const [key, path] of Object.entries(value.selections || {})) if (validKey(key,3) && typeof path === 'string') data.selections[key] = path;
  data.preferences = { guideWidth:Number.isFinite(value.preferences?.guideWidth)?Math.max(260,Math.min(640,value.preferences.guideWidth)):310, scope:['all','staged','unstaged'].includes(value.preferences?.scope)?value.preferences.scope:'unstaged', theme:['system','light','dark'].includes(value.preferences?.theme)?value.preferences.theme:'system', model:typeof value.preferences?.model==='string'?value.preferences.model:'', effort:typeof value.preferences?.effort==='string'?value.preferences.effort:'', codeSize: [13,14,16,18].includes(value.preferences?.codeSize) ? value.preferences.codeSize : 14, wrap: typeof value.preferences?.wrap==='boolean'?value.preferences.wrap:false, compactContext: typeof value.preferences?.compactContext==='boolean'?value.preferences.compactContext:true, mindfulnessDuration:[1,3,5].includes(value.preferences?.mindfulnessDuration)?value.preferences.mindfulnessDuration:1, mindfulnessRate:[6,8,10].includes(value.preferences?.mindfulnessRate)?value.preferences.mindfulnessRate:6 };
  return data;
}
function cleanSnapshot(value) {
  const s = validateSnapshot(value);
  return Object.fromEntries(['repoId','scope','base','head','branch','snapshotId','generatedAt','workspaceName','files'].map((key) => [key, key === 'files' ? s.files.map((f) => Object.fromEntries(['id','path','oldPath','version','status','sourceAvailable','sourceReason','source','label','folder','type','tone','added','removed','size','changed','summary','lines'].filter((k) => f[k] !== undefined).map((k) => [k, f[k]]))) : s[key]]));
}
export function createBackup(data, snapshot) { return { format:'patchwork-private-backup', schema:SCHEMA, exportedAt:new Date().toISOString(), state:sanitizeState(data), snapshot:snapshot ? cleanSnapshot(snapshot) : null }; }
export function parseBackup(text) {
  const value = JSON.parse(text);
  if (value.format !== 'patchwork-private-backup' || value.schema !== SCHEMA) throw new Error('This is not a supported Patchwork backup.');
  const data=sanitizeState(value.state);
  // Imported backups never submit a saved request automatically.
  for(const workspace of Object.values(data.agentGuides)){workspace.pending=null;workspace.prefetch=null;}
  for(const workspace of Object.values(data.deepReviews)){workspace.pending=null;workspace.question=null;}
  return { data, snapshot:value.snapshot ? cleanSnapshot(value.snapshot) : null };
}
export function mergeState(current, incoming) {
  return sanitizeState({ ...current, reviews:{...incoming.reviews,...current.reviews}, sessions:{...incoming.sessions,...current.sessions}, walkthroughs:{...incoming.walkthroughs,...current.walkthroughs}, agentGuides:{...incoming.agentGuides,...current.agentGuides}, deepReviews:{...incoming.deepReviews,...current.deepReviews}, selections:{...incoming.selections,...current.selections}, notes:[...new Map([...incoming.notes,...current.notes].map((n) => [n.id,n])).values()], historicalNotes:[...new Map([...incoming.historicalNotes,...current.historicalNotes].map((n) => [n.id,n])).values()] });
}
export function notesFor(data, snapshot, file) { return data.notes.filter((n) => n.repoId === snapshot.repoId && n.path === file.path); }
export function noteIsCurrent(note, snapshot, file) { return note.base === snapshot.base && note.branch === snapshot.branch && note.version === file.version; }
export function reviewSummary(data, snapshot) {
  if (!snapshot) return 'No snapshot loaded.';
  const lines = [`# Review: ${snapshot.workspaceName}`, `Branch: ${snapshot.branch}`, `Base: ${snapshot.base}`, `Head: ${snapshot.head}`, `Snapshot: ${snapshot.snapshotId}`, `Captured: ${snapshot.generatedAt}`, ''];
  for (const file of snapshot.files) {
    lines.push(`## ${file.path}`, `Decision: ${data.reviews[reviewKey(snapshot,file)] ? 'Reviewed' : 'Needs review'}`, `Revision: ${file.version}`);
    for (const n of notesFor(data,snapshot,file)) lines.push(`- [${n.status}] ${noteIsCurrent(n,snapshot,file) ? 'Current revision' : `Historical revision ${n.version}`} · ${n.start ? `${n.side} lines ${n.start}–${n.end || n.start}` : 'Whole file'}: ${n.text}`);
    lines.push('');
  }
  for (const n of data.historicalNotes) lines.push(`## ${n.path}`, n.label, n.text, '');
  return lines.join('\n');
}
export function openStorage(indexedDB = globalThis.indexedDB) {
  return new Promise((resolve,reject) => {
    if (!indexedDB) { reject(new Error('IndexedDB is unavailable.')); return; }
    const request = indexedDB.open('patchwork-private', SCHEMA);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('records')) request.result.createObjectStore('records'); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other Patchwork tabs to update device storage.'));
    request.onsuccess = () => {
      const db = request.result;
      const transact = (mode,key,value) => new Promise((done,fail) => {
        const tx=db.transaction('records',mode), store=tx.objectStore('records');
        const req=mode === 'readonly' ? store.get(key) : value === undefined ? store.delete(key) : store.put(value,key);
        tx.oncomplete=() => done(req.result); tx.onerror=() => fail(tx.error || req.error); tx.onabort=() => fail(tx.error || new Error('Storage transaction was aborted.'));
      });
      resolve({ get:(key) => transact('readonly',key), put:(key,value) => transact('readwrite',key,value), remove:(key) => transact('readwrite',key) });
    };
  });
}
