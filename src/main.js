let files = [
  {
    id: 'runtime',
    path: 'src/lib/runtime.ts',
    folder: 'src/lib',
    label: 'runtime.ts',
    type: 'TS',
    added: 18,
    removed: 5,
    size: '4.8 KB',
    changed: '12 min ago',
    tone: 'lime',
    summary: 'Request lifecycle and cached context',
    lines: [
      ['context', '1', 'import { createContext } from "./context";'],
      ['context', '2', 'import { cache } from "./cache";'],
      ['blank', '3', ''],
      ['normal', '4', 'export async function runRequest(request: Request) {'],
      ['removed', '5', '  const session = await getSession(request);'],
      ['added', '5', '  const session = await cache.session(request);'],
      ['added', '6', '  const context = createContext({ request, session });'],
      ['normal', '7', ''],
      ['normal', '8', '  if (context.isOffline) {'],
      ['added', '9', '    return context.fromSnapshot();'],
      ['normal', '10', '  }'],
      ['normal', '11', ''],
      ['normal', '12', '  const response = await context.execute();'],
      ['removed', '13', '  await saveSession(session);'],
      ['added', '13', '  await cache.persist({ session, response });'],
      ['normal', '14', ''],
      ['normal', '15', '  return response;'],
      ['normal', '16', '}'],
    ],
  },
  {
    id: 'shell',
    path: 'src/components/app/shell.tsx',
    folder: 'src/components/app',
    label: 'shell.tsx',
    type: 'TSX',
    added: 32,
    removed: 14,
    size: '8.1 KB',
    changed: '24 min ago',
    tone: 'orange',
    summary: 'Responsive app frame and navigation',
    lines: [
      ['context', '1', 'import { Outlet } from "react-router";'],
      ['context', '2', 'import { BottomNav } from "./bottom-nav";'],
      ['blank', '3', ''],
      ['normal', '4', 'export function AppShell() {'],
      ['added', '5', '  const isSmallScreen = useMediaQuery("(max-width: 720px)");'],
      ['normal', '6', ''],
      ['removed', '7', '  return <div className="shell"><Sidebar /></div>;'],
      ['added', '7', '  return ('],
      ['added', '8', '    <div className={cn("shell", isSmallScreen && "compact")}>'],
      ['added', '9', '      <Sidebar />'],
      ['added', '10', '      <main><Outlet /></main>'],
      ['added', '11', '      {isSmallScreen && <BottomNav />}'],
      ['added', '12', '    </div>'],
      ['normal', '13', '  );'],
      ['normal', '14', '}'],
    ],
  },
  {
    id: 'service',
    path: 'src/lib/media/service.ts',
    folder: 'src/lib/media',
    label: 'service.ts',
    type: 'TS',
    added: 11,
    removed: 2,
    size: '3.2 KB',
    changed: '48 min ago',
    tone: 'blue',
    summary: 'Local media fallback and upload queue',
    lines: [
      ['normal', '1', 'export async function resolveMedia(id: string) {'],
      ['normal', '2', '  const local = await mediaStore.get(id);'],
      ['added', '3', '  if (local) return local;'],
      ['normal', '4', '  return remoteMedia.fetch(id);'],
      ['normal', '5', '}'],
    ],
  },
  {
    id: 'compose',
    path: 'src/app/compose/page.tsx',
    folder: 'src/app/compose',
    label: 'page.tsx',
    type: 'TSX',
    added: 8,
    removed: 1,
    size: '2.2 KB',
    changed: '1 hr ago',
    tone: 'purple',
    summary: 'Draft composer state',
    lines: [
      ['normal', '1', 'export default function ComposePage() {'],
      ['added', '2', '  const draft = useDraftStore();'],
      ['normal', '3', '  return <Composer draft={draft} />;'],
      ['normal', '4', '}'],
    ],
  },
  {
    id: 'spec',
    path: 'docs/SPEC.md',
    folder: 'docs',
    label: 'SPEC.md',
    type: 'MD',
    added: 4,
    removed: 0,
    size: '1.4 KB',
    changed: '2 hrs ago',
    tone: 'pink',
    summary: 'Product notes and review checklist',
    lines: [
      ['normal', '1', '# Offline review notes'],
      ['added', '2', '- Keep the latest snapshot available on device'],
      ['added', '3', '- Explain one file at a time'],
      ['normal', '4', '- Defer sync actions until desktop handoff'],
    ],
  },
];

const snapshotStorageKey = 'patchwork-snapshot-v1';
const cachedSnapshot = loadSnapshot();
if (cachedSnapshot && Array.isArray(cachedSnapshot.files)) files = cachedSnapshot.files;

const defaultChat = [
  {
    role: 'assistant',
    text: 'This file is the request boundary for the app. It now builds a small context object, then chooses a local snapshot when the device is offline.',
  },
  {
    role: 'assistant',
    text: 'The important change is the cache lookup on line 5. It means the rest of the request can stay unaware of where its data came from.',
    bullets: ['Offline reads happen before network work', 'The response is persisted for the next review session'],
  },
];

const storageKey = 'patchwork-state-v1';
const saved = loadState();
const queryToken = new URLSearchParams(location.search).get('token') || '';
const initialApiToken = queryToken || saved.apiToken || '';
if (queryToken) {
  localStorage.setItem('patchwork-api-token', queryToken);
  history.replaceState({}, '', `${location.pathname}${location.hash}`);
}
const initialSelectedFile = saved.selectedFile && files.some((file) => file.id === saved.selectedFile)
  ? saved.selectedFile
  : cachedSnapshot?.files?.[0]?.id || 'runtime';
const savedChats = saved.chats && typeof saved.chats === 'object' ? saved.chats : {};
const savedNotes = saved.notes && typeof saved.notes === 'object' ? saved.notes : {};
const state = {
  selectedFile: initialSelectedFile,
  reviewed: saved.reviewed || { service: true, spec: true },
  activeTab: saved.activeTab || 'diff',
  queueCollapsed: Boolean(saved.queueCollapsed),
  guideCollapsed: Boolean(saved.guideCollapsed),
  filesOpen: false,
  chatOpen: false,
  chat: savedChats[initialSelectedFile] || (cachedSnapshot ? defaultChatFor(files.find((file) => file.id === initialSelectedFile)) : saved.chat || defaultChat),
  chats: savedChats,
  notes: savedNotes,
  online: navigator.onLine,
  toast: '',
  source: cachedSnapshot && Array.isArray(cachedSnapshot.files) ? 'cached' : 'sample',
  workspaceName: cachedSnapshot?.workspaceName || saved.workspaceName || 'map-of-experience',
  branchName: cachedSnapshot?.branch || saved.branchName || 'feature/media-queue',
  reminder: Boolean(saved.reminder),
  lastReminderDate: saved.lastReminderDate || '',
  aiEnabled: false,
  aiProvider: '',
  apiToken: initialApiToken || localStorage.getItem('patchwork-api-token') || '',
  pairingRequired: false,
  sourceLoading: '',
  sourceError: '',
  snapshotAt: cachedSnapshot?.generatedAt || null,
};

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || '{}');
  } catch {
    return {};
  }
}

function loadSnapshot() {
  try {
    return JSON.parse(localStorage.getItem(snapshotStorageKey) || 'null');
  } catch {
    return null;
  }
}

function cacheSnapshot(payload) {
  try {
    localStorage.setItem(snapshotStorageKey, JSON.stringify(payload));
  } catch {
    // A large repository can exceed localStorage; the service worker remains the other cache layer.
  }
}

function snapshotAge() {
  if (!state.snapshotAt) return 'waiting for first sync';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(state.snapshotAt).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 min ago';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr${hours === 1 ? '' : 's'} ago`;
}

function saveState() {
  if (state.selectedFile) state.chats[state.selectedFile] = state.chat;
  localStorage.setItem(storageKey, JSON.stringify({
    selectedFile: state.selectedFile,
    reviewed: state.reviewed,
    activeTab: state.activeTab,
    queueCollapsed: state.queueCollapsed,
    guideCollapsed: state.guideCollapsed,
    chat: state.chat,
    chats: state.chats,
    notes: state.notes,
    workspaceName: state.workspaceName,
    branchName: state.branchName,
    reminder: state.reminder,
    lastReminderDate: state.lastReminderDate,
    apiToken: state.apiToken,
  }));
}

function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (state.apiToken) headers.set('x-patchwork-token', state.apiToken);
  return fetch(path, { ...options, headers });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function icon(name, size = 20) {
  const paths = {
    logo: '<path d="M4 4h9.5c4 0 6.8 2.5 6.8 6 0 2.4-1.3 4.2-3.5 5.1l3.9 5.1h-4.5l-3.3-4.5H8.2v4.5H4V4Zm4.2 3.4v4.8h4.5c1.7 0 2.7-.8 2.7-2.4s-1-2.4-2.7-2.4H8.2Z"/><circle cx="20" cy="4.5" r="2.5"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    branch: '<path d="M6 4v12a3 3 0 0 0 3 3h9"/><circle cx="6" cy="4" r="2.3"/><circle cx="18" cy="19" r="2.3"/><path d="M18 7V5a3 3 0 0 0-3-3H9"/><circle cx="18" cy="7" r="2.3"/>',
    spark: '<path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Z"/><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.3 2"/>',
    settings: '<path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/><circle cx="12" cy="12" r="3.2"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    check: '<path d="m5 12 4.2 4L19 7"/>',
    message: '<path d="M19 15a3 3 0 0 1-3 3H9l-4 3v-6a3 3 0 0 1-1-2.4V8a3 3 0 0 1 3-3h9a3 3 0 0 1 3 3v7Z"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    send: '<path d="m21 3-7.2 18-3.2-7.6L3 10.2 21 3Z"/><path d="m10.6 13.4 4.8-4.8"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    wifi: '<path d="M4 9.5a12.2 12.2 0 0 1 16 0M7.5 13a7 7 0 0 1 9 0M11 16.3a2 2 0 0 1 2 0"/><circle cx="12" cy="19" r=".8" fill="currentColor" stroke="none"/>',
    bolt: '<path d="m13 2-8 12h6l-1 8 8-12h-6l1-8Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    more: '<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>',
    bookmark: '<path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-3.5L6 21V4.5Z"/>',
  };
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.grid}</svg>`;
}

function selectedFile() {
  return files.find((file) => file.id === state.selectedFile) || files[0];
}

function aiProviderLabel() {
  if (state.aiProvider === 'codex') return 'Codex subscription';
  if (state.aiProvider === 'claude') return 'Claude Code subscription';
  if (state.aiProvider === 'api') return 'OpenAI API';
  return 'laptop provider';
}

function defaultChatFor(file) {
  if (!file) return defaultChat;
  return [
    { role: 'assistant', text: `This is a focused change in ${file.path}. I can explain the behavior, trace the diff, or help you look for review risks.` },
    { role: 'assistant', text: 'A useful first pass is to follow the new lines from their inputs to their outputs, then check what happens when the happy path is unavailable.', bullets: ['Start with the added control flow', 'Ask about edge cases or unfamiliar symbols'] },
  ];
}

function selectFile(fileId) {
  const nextFile = files.find((file) => file.id === fileId);
  if (!nextFile) return;
  saveState();
  state.selectedFile = fileId;
  state.chat = state.chats[fileId] || defaultChatFor(nextFile);
  if (state.activeTab === 'preview' && !isPreviewable(nextFile)) state.activeTab = 'diff';
  state.sourceError = '';
  setFilesOpen(false);
  saveState();
  render();
  if (state.activeTab === 'source' || state.activeTab === 'preview') hydrateFileSource(nextFile);
}

function fileCount() {
  return files.filter((file) => !state.reviewed[file.id]).length;
}

function nextReviewFile() {
  return files.find((file) => !state.reviewed[file.id]) || null;
}

function totalChanges() {
  return files.reduce((sum, file) => sum + file.added, 0);
}

function renderFileRow(file) {
  const reviewed = Boolean(state.reviewed[file.id]);
  const selected = state.selectedFile === file.id;
  return `<button class="file-row ${selected ? 'selected' : ''} ${reviewed ? 'reviewed' : ''}" data-file-id="${file.id}" aria-current="${selected ? 'page' : 'false'}">
    <span class="file-type type-${file.tone}">${file.type}</span>
    <span class="file-row-copy">
      <span class="file-name">${file.label}</span>
      <span class="file-path">${file.folder}</span>
    </span>
    <span class="file-row-meta">
      <span class="change-count"><b>+${file.added}</b>${file.removed ? `<i>−${file.removed}</i>` : ''}</span>
      <span class="review-state">${reviewed ? icon('check', 13) : icon('chevron', 14)}</span>
    </span>
  </button>`;
}

function renderChatMessage(message) {
  const bullets = message.bullets?.length ? `<ul>${message.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('')}</ul>` : '';
  return `<div class="chat-message ${message.role}${message.pending ? ' pending' : ''}">
    ${message.role === 'assistant' ? `<div class="assistant-avatar">${icon('spark', 15)}</div>` : ''}
    <div class="message-bubble">${escapeHtml(message.text)}${bullets}</div>
  </div>`;
}

function renderCode(file) {
  return (file.lines || []).map(([kind, number, text]) => `<div class="code-line ${kind}">
    <span class="line-number">${number}</span><span class="line-sign">${kind === 'added' ? '+' : kind === 'removed' ? '−' : ''}</span><code>${escapeHtml(text) || '&nbsp;'}</code>
  </div>`).join('');
}

function isPreviewable(file) {
  return Boolean(file && (file.type === 'MD' || /\.(md|markdown)$/i.test(file.path || '')));
}

function fileSource(file) {
  if (typeof file.source === 'string') return file.source;
  return (file.lines || [])
    .filter(([kind]) => kind !== 'removed')
    .map(([, , text]) => text || '')
    .join('\n');
}

function renderSourceLines(source) {
  return source.split(/\r?\n/).map((line, index) => `<div class="source-line"><span class="line-number">${index + 1}</span><code>${escapeHtml(line) || '&nbsp;'}</code></div>`).join('');
}

function renderSourceUnavailable(file) {
  const offline = !state.online;
  return `<section class="source-empty"><div class="source-empty-icon">${icon(offline ? 'wifi' : 'branch', 20)}</div><span class="eyebrow">${offline ? 'OFFLINE SOURCE' : 'SOURCE UNAVAILABLE'}</span><h3>${offline ? 'This file has not been cached yet.' : (state.sourceError || 'The current file could not be loaded.')}</h3><p>${offline ? 'Reconnect to the laptop once while viewing this file. After that, its normal source will be available offline.' : 'The diff is still available. Try loading the current file again when the companion is reachable.'}</p>${offline ? '' : '<button class="secondary-button" data-action="retry-source">Try again</button>'}</section>`;
}

function renderSource(file) {
  const hasSource = typeof file.source === 'string' || state.source === 'sample';
  if (state.sourceLoading === file.id) return `<section class="source-empty"><div class="source-loading"><span></span><span></span><span></span></div><span class="eyebrow">READING CURRENT FILE</span><h3>Loading the normal file view…</h3><p>The laptop companion is sending the file as it exists in your working tree.</p></section>`;
  if (!hasSource) return renderSourceUnavailable(file);
  const source = fileSource(file);
  return `<section class="code-card source-card"><div class="code-toolbar"><span>${icon('branch', 15)} Current file</span><span class="source-badge">normal source</span></div><div class="code-meta"><span>${escapeHtml(file.path)}</span><span>${file.size} · ${source.split(/\r?\n/).length} lines</span></div><div class="code-viewer source-viewer">${renderSourceLines(source)}</div></section>`;
}

function inlineMarkdown(text) {
  let value = escapeHtml(text);
  value = value.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  value = value.replace(/`([^`]+)`/g, '<code>$1</code>');
  value = value.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  value = value.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return value;
}

function renderMarkdown(source) {
  const output = [];
  const lines = source.split(/\r?\n/);
  let inCode = false;
  let listType = '';
  const closeList = () => {
    if (listType) output.push(`</${listType}>`);
    listType = '';
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (inCode) output.push('</code></pre>');
      else output.push('<pre><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      output.push(escapeHtml(line) || '\n');
      continue;
    }
    const unordered = line.match(/^\s*[-*+]\s+(.+)/);
    const ordered = line.match(/^\s*\d+\.\s+(.+)/);
    if (unordered || ordered) {
      const nextType = unordered ? 'ul' : 'ol';
      if (listType !== nextType) {
        closeList();
        listType = nextType;
        output.push(`<${listType}>`);
      }
      output.push(`<li>${inlineMarkdown((unordered || ordered)[1])}</li>`);
      continue;
    }
    closeList();
    if (!line.trim()) continue;
    const heading = line.match(/^\s*(#{1,6})\s+(.+)/);
    if (heading) {
      const level = heading[1].length;
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (/^\s*>\s?/.test(line)) {
      output.push(`<blockquote>${inlineMarkdown(line.replace(/^\s*>\s?/, ''))}</blockquote>`);
    } else {
      output.push(`<p>${inlineMarkdown(line)}</p>`);
    }
  }
  closeList();
  if (inCode) output.push('</code></pre>');
  return output.join('');
}

function renderPreview(file) {
  if (!isPreviewable(file)) return renderSource(file);
  const hasSource = typeof file.source === 'string' || state.source === 'sample';
  if (state.sourceLoading === file.id) return `<section class="source-empty"><div class="source-loading"><span></span><span></span><span></span></div><span class="eyebrow">RENDERING MARKDOWN</span><h3>Loading the normal file first…</h3><p>Preview uses the current file, not only the changed lines.</p></section>`;
  if (!hasSource) return renderSourceUnavailable(file);
  const source = fileSource(file);
  return `<section class="code-card preview-card"><div class="code-toolbar"><span>${icon('bookmark', 15)} Rendered Markdown</span><span class="source-badge">preview</span></div><div class="code-meta"><span>${escapeHtml(file.path)}</span><span>${source.split(/\r?\n/).length} lines</span></div><article class="markdown-preview">${renderMarkdown(source)}</article></section>`;
}

function renderReviewContent(file) {
  if (state.activeTab === 'source') return renderSource(file);
  if (state.activeTab === 'preview') return renderPreview(file);
  if (state.activeTab === 'overview') return `<section class="overview-card"><div class="overview-illustration"><span></span><span></span><span></span></div><div><span class="eyebrow">FILE OVERVIEW</span><h3>${file.summary}</h3><p>This change touches one focused part of the project. Read the diff below as a short story: what changed, why it changed, and what might surprise you later.</p><div class="overview-chips"><span>+${file.added} additions</span><span>−${file.removed} removals</span><span>${file.type}</span></div></div></section>`;
  if (state.activeTab === 'notes') return `<section class="notes-card"><div class="notes-icon">${icon('bookmark', 21)}</div><div><h3>Keep a note for future-you</h3><p>Notes stay on this device, even when you are offline. Capture a question, a follow-up, or the part you want to revisit.</p><textarea data-note-input placeholder="Add a note about this file…">${escapeHtml(state.notes[file.id] || '')}</textarea><div class="note-save-status" data-note-status>${state.notes[file.id] ? 'Saved on this device' : 'Private note · saved on this device'}</div></div></section>`;
  return `<section class="code-card"><div class="code-toolbar"><span>${icon('branch', 15)} Working tree changes</span><span class="code-toolbar-right"><span class="diff-legend"><i class="add-dot"></i> additions <i class="remove-dot"></i> removals</span><button aria-label="More diff actions">${icon('more', 17)}</button></span></div><div class="code-meta"><span>${escapeHtml(file.path)}</span><span>${file.size} · ${file.changed}</span></div><div class="code-viewer">${renderCode(file)}</div></section>`;
}

function setActiveTab(tab) {
  const file = selectedFile();
  if (!file || !['diff', 'source', 'preview', 'overview', 'notes'].includes(tab)) return;
  if (tab === 'preview' && !isPreviewable(file)) return;
  state.activeTab = tab;
  state.sourceError = '';
  saveState();
  render();
  if (tab === 'source' || tab === 'preview') hydrateFileSource(file);
}

async function hydrateFileSource(file) {
  if (!file || typeof file.source === 'string') return;
  if (!state.online || state.source === 'sample') {
    render();
    return;
  }
  state.sourceLoading = file.id;
  state.sourceError = '';
  render();
  try {
    const response = await apiFetch(`/api/file?path=${encodeURIComponent(file.path)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('The current file is unavailable.');
    const payload = await response.json();
    if (typeof payload.source !== 'string') throw new Error('The companion returned no file contents.');
    file.source = payload.source;
    cacheSnapshot({ workspaceName: state.workspaceName, branch: state.branchName, generatedAt: state.snapshotAt || new Date().toISOString(), files });
  } catch (error) {
    state.sourceError = error instanceof Error ? error.message : 'The current file could not be loaded.';
  } finally {
    if (state.sourceLoading === file.id) state.sourceLoading = '';
    if (state.selectedFile === file.id) render();
  }
}

function render() {
  const file = selectedFile();
  if (!file) {
    renderEmpty();
    return;
  }
  const reviewed = Boolean(state.reviewed[file.id]);
  const reviewedCount = files.length - fileCount();
  const progress = Math.round((reviewedCount / files.length) * 100);
  const next = files.find((item) => item.id !== file.id && !state.reviewed[item.id]);
  document.body.classList.toggle('files-menu-open', state.filesOpen);

  document.querySelector('#root').innerHTML = `
    <div class="app-shell ${state.chatOpen ? 'chat-is-open' : ''} ${state.filesOpen ? 'files-is-open' : ''} ${state.queueCollapsed ? 'queue-is-collapsed' : ''} ${state.guideCollapsed ? 'guide-is-collapsed' : ''}">
      <header class="mobile-topbar">
        <button class="icon-button" data-action="toggle-files" aria-label="Open files">${icon('menu', 21)}</button>
        <div class="mobile-wordmark"><span class="wordmark-mark">${icon('logo', 22)}</span>patchwork</div>
        <button class="icon-button ${state.chatOpen ? 'active' : ''}" data-action="toggle-chat" aria-label="Open code guide">${icon('message', 20)}</button>
      </header>
      ${state.filesOpen ? '<button class="file-drawer-scrim" data-action="toggle-files" aria-label="Close file list"></button>' : ''}

      <aside class="sidebar">
        <div class="brand"><span class="brand-mark">${icon('logo', 24)}</span><span>patchwork</span><span class="brand-dot"></span></div>
        <div class="workspace-switcher"><span class="repo-avatar">${escapeHtml(state.workspaceName.slice(0, 2).toUpperCase())}</span><span><b>${escapeHtml(state.workspaceName)}</b><small>${state.source === 'companion' ? 'laptop companion' : state.source === 'cached' ? 'offline snapshot' : 'sample workspace'}</small></span>${icon('down', 14)}</div>
        <nav class="primary-nav" aria-label="Primary navigation">
          <button class="nav-item active">${icon('grid', 18)}<span>Review queue</span><em>${fileCount()}</em></button>
          <button class="nav-item">${icon('branch', 18)}<span>Branches</span></button>
          <button class="nav-item">${icon('bookmark', 18)}<span>Saved notes</span></button>
        </nav>
        <div class="sidebar-spacer"></div>
        <div class="streak-card">
          <div class="streak-icon">${icon('bolt', 16)}</div>
          <div><strong>2 day streak</strong><span>One small review counts.</span></div>
          <button class="reminder-button ${state.reminder ? 'set' : ''}" data-action="toggle-reminder">${state.reminder ? 'Nudge set · 7:30 PM' : 'Set a gentle nudge'}</button>
        </div>
        <button class="nav-item muted">${icon('settings', 18)}<span>Preferences</span></button>
        <div class="profile"><span class="profile-avatar">M</span><span><b>Mubashir</b><small>Solo developer</small></span>${icon('more', 18)}</div>
      </aside>

      <aside class="file-panel">
        <div class="file-panel-header">
          <div><span class="eyebrow">WORKSPACE</span><h1>Review queue</h1></div>
          <div class="file-panel-header-actions"><button class="queue-toggle" data-action="toggle-queue" aria-label="Collapse review queue">${icon('chevron', 17)}</button><button class="close-files" data-action="toggle-files" aria-label="Close files">${icon('close', 19)}</button><button class="panel-more" aria-label="More workspace actions">${icon('more', 18)}</button></div>
        </div>
        <div class="branch-row"><span class="branch-name">${icon('branch', 14)} ${escapeHtml(state.branchName)}</span><span class="branch-status">${state.source === 'companion' ? 'synced' : state.source === 'cached' ? 'cached' : 'local'}</span></div>
        ${state.pairingRequired ? '<div class="pairing-card"><span class="pairing-icon">' + icon('lock', 14) + '</span><span><b>Pair this device</b><small>Open the companion link with its token.</small></span></div>' : ''}
        <div class="queue-progress"><div class="progress-copy"><span>${reviewedCount} of ${files.length} reviewed</span><b>${progress}%</b></div><div class="progress-track"><span style="width:${progress}%"></span></div></div>
        <div class="queue-heading"><span>CHANGED FILES <b>${files.length}</b></span><button data-action="refresh-snapshot">Refresh ${icon('wifi', 13)}</button></div>
        <div class="file-list">${files.map(renderFileRow).join('')}</div>
        <div class="offline-card"><span class="offline-icon">${icon('wifi', 16)}</span><span><b>${state.source === 'companion' ? 'Laptop snapshot' : 'Ready offline'}</b><small>Last snapshot · ${snapshotAge()}</small></span><span class="ready-dot"></span></div>
      </aside>

      <main class="review-panel">
        <div class="review-topline">
          <div class="breadcrumbs"><span>Review queue</span>${icon('chevron', 13)}<b>${file.label}</b></div>
          <div class="topline-actions">${state.queueCollapsed ? `<button class="queue-expand secondary-button" data-action="toggle-queue">${icon('branch', 14)} Show queue</button>` : ''}${state.guideCollapsed ? `<button class="guide-expand secondary-button" data-action="toggle-chat">${icon('message', 14)} Code guide</button>` : ''}<span class="connection ${state.pairingRequired ? 'pairing' : state.online ? 'online' : 'offline'}"><i></i>${state.pairingRequired ? 'Pair device' : state.online ? 'Online' : 'Offline'}</span><button class="icon-button desktop-more" aria-label="More file actions">${icon('more', 18)}</button></div>
        </div>

        <section class="review-heading">
          <div class="review-heading-main"><div class="file-type large type-${file.tone}">${file.type}</div><div><div class="file-title-row"><h2>${file.label}</h2>${reviewed ? '<span class="reviewed-pill">Reviewed</span>' : '<span class="needs-review-pill">Needs review</span>'}</div><p>${file.path}</p></div></div>
          <div class="review-heading-actions"><button class="secondary-button" data-action="explain-file">${icon('spark', 17)} Explain this file</button><button class="icon-button" aria-label="Bookmark file">${icon('bookmark', 18)}</button></div>
        </section>

        <div class="review-tabs" role="tablist"><button class="review-tab ${state.activeTab === 'diff' ? 'active' : ''}" data-tab="diff">Diff <span>+${file.added} −${file.removed}</span></button><button class="review-tab ${state.activeTab === 'source' ? 'active' : ''}" data-tab="source">Source</button>${isPreviewable(file) ? `<button class="review-tab ${state.activeTab === 'preview' ? 'active' : ''}" data-tab="preview">Preview</button>` : ''}<button class="review-tab ${state.activeTab === 'overview' ? 'active' : ''}" data-tab="overview">Overview</button><button class="review-tab ${state.activeTab === 'notes' ? 'active' : ''}" data-tab="notes">Notes <span class="note-count">${state.notes[file.id] ? '1' : '0'}</span></button></div>

        ${renderReviewContent(file)}

        <section class="review-footer"><div class="review-prompt"><span class="prompt-icon">${icon(reviewed ? 'check' : 'spark', 16)}</span><span>${reviewed ? 'Nice. This file is in your reviewed set.' : 'A focused 6-minute review is enough for today.'}</span></div><div class="footer-actions"><button class="secondary-button" data-action="skip-file">Skip for now</button><button class="primary-button" data-action="mark-reviewed">${reviewed ? icon('check', 16) + ' Reviewed' : 'Mark as reviewed ' + icon('check', 16)}</button>${next ? `<button class="next-button" data-action="next-file">Next file ${icon('chevron', 16)}</button>` : ''}</div></section>
      </main>

      <aside class="chat-panel" aria-label="Code guide">
        <div class="chat-header"><div class="chat-title"><div class="chat-avatar">${icon('spark', 17)}</div><div><h2>Code guide</h2><span>${!state.online ? 'AI needs a connection' : state.aiEnabled ? `AI guide · ${aiProviderLabel()}` : 'Demo guide · connect AI on laptop'}</span></div></div><button class="icon-button close-chat" data-action="close-guide" aria-label="Close code guide">${icon('close', 19)}</button></div>
        <div class="context-chip"><span class="context-file type-${file.tone}">${file.type}</span><span>${file.label}</span><button aria-label="Change file context">${icon('down', 13)}</button></div>
        <div class="chat-scroll"><div class="conversation-label">TODAY <span></span></div>${state.chat.map(renderChatMessage).join('')}${state.chat.length === 2 ? '<div class="suggestions"><span>Try asking</span><button data-suggestion="What could break here?">What could break here?</button><button data-suggestion="Explain the offline path">Explain the offline path</button></div>' : ''}</div>
        <form class="chat-composer" data-action="send-chat"><textarea name="message" rows="1" placeholder="Ask about ${file.label}…" ${state.online ? '' : 'disabled'}></textarea><div class="composer-bottom"><span>${icon('bolt', 13)} ${state.online ? state.aiEnabled ? `Connected · ${aiProviderLabel()}` : 'Preview response · connect AI on laptop' : 'Reconnect to ask AI'}</span><button type="submit" aria-label="Send message" ${state.online ? '' : 'disabled'}>${icon('send', 17)}</button></div></form>
      </aside>

      <nav class="mobile-bottom-nav" aria-label="Mobile navigation"><button class="active">${icon('grid', 19)}<span>Queue</span></button><button data-action="toggle-files">${icon('branch', 19)}<span>Files</span></button><button data-action="toggle-chat">${icon('message', 19)}<span>Guide</span></button><button>${icon('settings', 19)}<span>More</span></button></nav>
      ${state.toast ? `<div class="toast">${icon('check', 15)} ${escapeHtml(state.toast)}</div>` : ''}
    </div>`;

  wireEvents();
}

function renderEmpty() {
  const sourceLabel = state.source === 'companion' ? 'Laptop companion' : state.source === 'cached' ? 'Offline snapshot' : 'Sample workspace';
  document.body.classList.toggle('files-menu-open', state.filesOpen);
  document.querySelector('#root').innerHTML = `
    <div class="app-shell ${state.chatOpen ? 'chat-is-open' : ''} ${state.filesOpen ? 'files-is-open' : ''} ${state.queueCollapsed ? 'queue-is-collapsed' : ''} ${state.guideCollapsed ? 'guide-is-collapsed' : ''}">
      <header class="mobile-topbar">
        <button class="icon-button" data-action="toggle-files" aria-label="Open files">${icon('menu', 21)}</button>
        <div class="mobile-wordmark"><span class="wordmark-mark">${icon('logo', 22)}</span>patchwork</div>
        <button class="icon-button ${state.chatOpen ? 'active' : ''}" data-action="toggle-chat" aria-label="Open code guide">${icon('message', 20)}</button>
      </header>
      ${state.filesOpen ? '<button class="file-drawer-scrim" data-action="toggle-files" aria-label="Close file list"></button>' : ''}
      <aside class="sidebar">
        <div class="brand"><span class="brand-mark">${icon('logo', 24)}</span><span>patchwork</span><span class="brand-dot"></span></div>
        <div class="workspace-switcher"><span class="repo-avatar">${escapeHtml(state.workspaceName.slice(0, 2).toUpperCase())}</span><span><b>${escapeHtml(state.workspaceName)}</b><small>${sourceLabel.toLowerCase()}</small></span>${icon('down', 14)}</div>
        <nav class="primary-nav" aria-label="Primary navigation"><button class="nav-item active">${icon('grid', 18)}<span>Review queue</span><em>0</em></button><button class="nav-item">${icon('branch', 18)}<span>Branches</span></button><button class="nav-item">${icon('bookmark', 18)}<span>Saved notes</span></button></nav>
        <div class="sidebar-spacer"></div>
        <div class="streak-card"><div class="streak-icon">${icon('bolt', 16)}</div><div><strong>2 day streak</strong><span>One small review counts.</span></div><button class="reminder-button ${state.reminder ? 'set' : ''}" data-action="toggle-reminder">${state.reminder ? 'Nudge set · 7:30 PM' : 'Set a gentle nudge'}</button></div>
        <button class="nav-item muted">${icon('settings', 18)}<span>Preferences</span></button>
        <div class="profile"><span class="profile-avatar">M</span><span><b>Mubashir</b><small>Solo developer</small></span>${icon('more', 18)}</div>
      </aside>
      <aside class="file-panel">
        <div class="file-panel-header"><div><span class="eyebrow">WORKSPACE</span><h1>Review queue</h1></div><div class="file-panel-header-actions"><button class="queue-toggle" data-action="toggle-queue" aria-label="Collapse review queue">${icon('chevron', 17)}</button><button class="close-files" data-action="toggle-files" aria-label="Close files">${icon('close', 19)}</button><button class="panel-more" aria-label="More workspace actions">${icon('more', 18)}</button></div></div>
        <div class="branch-row"><span class="branch-name">${icon('branch', 14)} ${escapeHtml(state.branchName)}</span><span class="branch-status">${state.source === 'companion' ? 'synced' : 'cached'}</span></div>
        ${state.pairingRequired ? '<div class="pairing-card"><span class="pairing-icon">' + icon('lock', 14) + '</span><span><b>Pair this device</b><small>Open the companion link with its token.</small></span></div>' : ''}
        <div class="queue-progress"><div class="progress-copy"><span>0 files to review</span><b>All clear</b></div><div class="progress-track"><span style="width:100%"></span></div></div>
        <div class="queue-heading"><span>CHANGED FILES <b>0</b></span><button data-action="refresh-snapshot">Refresh ${icon('down', 13)}</button></div>
        <div class="empty-file-list"><span>${icon('check', 16)}</span><p>Nothing waiting here.</p><small>Make a change on the laptop and refresh.</small></div>
      </aside>
      <main class="review-panel">
        <div class="review-topline"><div class="breadcrumbs"><span>Review queue</span>${icon('chevron', 13)}<b>All clear</b></div><div class="topline-actions">${state.queueCollapsed ? `<button class="queue-expand secondary-button" data-action="toggle-queue">${icon('branch', 14)} Show queue</button>` : ''}${state.guideCollapsed ? `<button class="guide-expand secondary-button" data-action="toggle-chat">${icon('message', 14)} Code guide</button>` : ''}<span class="connection ${state.pairingRequired ? 'pairing' : state.online ? 'online' : 'offline'}"><i></i>${state.pairingRequired ? 'Pair device' : state.online ? 'Online' : 'Offline'}</span><button class="icon-button desktop-more" aria-label="More file actions">${icon('more', 18)}</button></div></div>
        <section class="empty-state"><div class="empty-orbit"><span>${icon('check', 28)}</span></div><span class="eyebrow">WORKTREE CLEAR</span><h2>Nothing waiting for review.</h2><p>Your current workspace has no uncommitted changes. When you make a small change, it will appear here as a focused file-sized review.</p><button class="primary-button" data-action="refresh-snapshot">${icon('wifi', 16)} Check laptop again</button><div class="empty-tip"><span>${icon('bolt', 14)}</span><div><b>Good stopping point</b><small>A clean queue is progress too. Come back after your next small change.</small></div></div></section>
      </main>
      <aside class="chat-panel"><div class="chat-header"><div class="chat-title"><div class="chat-avatar">${icon('spark', 17)}</div><div><h2>Code guide</h2><span>${state.online ? 'Pick a file to start a conversation' : 'AI needs a connection'}</span></div></div><button class="icon-button close-chat" data-action="close-guide" aria-label="Close code guide">${icon('close', 19)}</button></div><div class="empty-chat"><div class="empty-chat-icon">${icon('spark', 19)}</div><h3>Your guide is ready.</h3><p>When a file lands in the queue, Patchwork will keep its explanation and questions in that file’s own conversation.</p></div></aside>
      <nav class="mobile-bottom-nav" aria-label="Mobile navigation"><button class="active">${icon('grid', 19)}<span>Queue</span></button><button data-action="toggle-files">${icon('branch', 19)}<span>Files</span></button><button data-action="toggle-chat">${icon('message', 19)}<span>Guide</span></button><button>${icon('settings', 19)}<span>More</span></button></nav>
      ${state.toast ? `<div class="toast">${icon('check', 15)} ${escapeHtml(state.toast)}</div>` : ''}
    </div>`;
  wireEvents();
}

let fileMenuHistoryEntry = false;

function setFilesOpen(open) {
  if (open === state.filesOpen) return;
  if (open) {
    state.filesOpen = true;
    fileMenuHistoryEntry = true;
    history.pushState({ ...(history.state || {}), patchworkFileMenu: true }, '', location.href);
  } else {
    state.filesOpen = false;
    if (fileMenuHistoryEntry) {
      fileMenuHistoryEntry = false;
      history.back();
    }
  }
  render();
}

function wireEvents() {
  document.querySelectorAll('[data-file-id]').forEach((button) => button.addEventListener('click', () => selectFile(button.dataset.fileId)));

  document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => {
    setActiveTab(button.dataset.tab);
  }));

  document.querySelectorAll('[data-note-input]').forEach((textarea) => textarea.addEventListener('input', () => {
    state.notes[state.selectedFile] = textarea.value;
    saveState();
    document.querySelectorAll('.note-count').forEach((count) => { count.textContent = textarea.value ? '1' : '0'; });
    const status = document.querySelector('[data-note-status]');
    if (status) status.textContent = 'Saved locally';
  }));

  document.querySelectorAll('[data-suggestion]').forEach((button) => button.addEventListener('click', () => {
    const input = document.querySelector('.chat-composer textarea');
    if (input) { input.value = button.dataset.suggestion; input.focus(); }
  }));

  document.querySelectorAll('[data-action="toggle-chat"]').forEach((button) => button.addEventListener('click', () => {
    state.chatOpen = !state.chatOpen || state.guideCollapsed;
    state.guideCollapsed = false;
    setFilesOpen(false);
    render();
    if (state.chatOpen) setTimeout(() => document.querySelector('.chat-composer textarea')?.focus(), 80);
  }));

  document.querySelectorAll('[data-action="close-guide"]').forEach((button) => button.addEventListener('click', () => {
    state.chatOpen = false;
    state.guideCollapsed = true;
    setFilesOpen(false);
    render();
  }));

  document.querySelectorAll('[data-action="explain-file"]').forEach((button) => button.addEventListener('click', () => {
    state.chatOpen = true;
    state.guideCollapsed = false;
    setFilesOpen(false);
    render();
    requestAi('Explain this file in plain language. Point out the main behavior, why the change matters, and one thing I should verify.');
  }));

  document.querySelectorAll('[data-action="toggle-files"]').forEach((button) => button.addEventListener('click', () => {
    state.chatOpen = false;
    setFilesOpen(!state.filesOpen);
  }));

  document.querySelectorAll('[data-action="toggle-queue"]').forEach((button) => button.addEventListener('click', () => {
    state.queueCollapsed = !state.queueCollapsed;
    saveState();
    render();
  }));

  document.querySelectorAll('[data-action="retry-source"]').forEach((button) => button.addEventListener('click', () => {
    const file = selectedFile();
    if (file) hydrateFileSource(file);
  }));

  document.querySelectorAll('[data-action="refresh-snapshot"]').forEach((button) => button.addEventListener('click', () => {
    state.toast = 'Checking the laptop companion…';
    render();
    hydrateFromCompanion();
  }));

  document.querySelectorAll('[data-action="mark-reviewed"]').forEach((button) => button.addEventListener('click', () => {
    state.reviewed[state.selectedFile] = !state.reviewed[state.selectedFile];
    state.toast = state.reviewed[state.selectedFile] ? 'Added to your reviewed set' : 'Moved back to your queue';
    saveState();
    scheduleReminder();
    render();
    setTimeout(() => { state.toast = ''; render(); }, 2600);
  }));

  document.querySelectorAll('[data-action="toggle-reminder"]').forEach((button) => button.addEventListener('click', async () => {
    if (state.reminder) {
      state.reminder = false;
      clearTimeout(reminderTimer);
      state.toast = 'Gentle nudge turned off';
    } else if (!('Notification' in window)) {
      state.toast = 'This browser cannot schedule notifications';
    } else {
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (permission === 'granted') {
        state.reminder = true;
        scheduleReminder();
        state.toast = 'Gentle nudge planned for 7:30 PM';
      } else {
        state.toast = 'Notifications are blocked in this browser';
      }
    }
    saveState();
    render();
    setTimeout(() => { state.toast = ''; render(); }, 2600);
  }));

  document.querySelectorAll('[data-action="next-file"], [data-action="skip-file"]').forEach((button) => button.addEventListener('click', () => {
    const currentIndex = files.findIndex((item) => item.id === state.selectedFile);
    const pending = files.filter((item) => !state.reviewed[item.id]);
    const next = pending.find((item) => files.indexOf(item) > currentIndex) || pending[0] || files[(currentIndex + 1) % files.length];
    if (next) {
      saveState();
      state.selectedFile = next.id;
      state.chat = state.chats[next.id] || defaultChatFor(next);
    }
    state.toast = button.dataset.action === 'skip-file' ? 'We’ll keep this one in your queue' : '';
    saveState();
    render();
    if (state.toast) setTimeout(() => { state.toast = ''; render(); }, 2600);
  }));

  const form = document.querySelector('.chat-composer');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = form.querySelector('textarea');
    const text = input?.value.trim();
    if (!text || !state.online) return;
    input.value = '';
    requestAi(text);
  });
}

let reminderTimer;

function scheduleReminder() {
  clearTimeout(reminderTimer);
  if (!state.reminder || !('Notification' in window) || Notification.permission !== 'granted') return;
  const target = nextReviewFile();
  if (!target) return;
  const next = new Date();
  next.setHours(19, 30, 0, 0);
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  reminderTimer = setTimeout(() => {
    state.lastReminderDate = reminderDateKey();
    saveState();
    new Notification('One file is enough', { body: `Open Patchwork to review ${target.label} · a focused 6-minute pass.`, icon: '/icon.svg', tag: 'patchwork-review' });
    scheduleReminder();
  }, Math.min(next.getTime() - Date.now(), 2_147_000_000));
}

function reminderDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function maybeShowOverdueReminder() {
  if (!state.reminder || !files.length || !nextReviewFile()) return;
  const now = new Date();
  const due = new Date(now);
  due.setHours(19, 30, 0, 0);
  const today = reminderDateKey(now);
  if (now < due || state.lastReminderDate === today) return;
  state.lastReminderDate = today;
  state.toast = `One file is enough · ${nextReviewFile().label}`;
  saveState();
  render();
  setTimeout(() => {
    if (state.toast.startsWith('One file is enough')) { state.toast = ''; render(); }
  }, 5000);
}

async function requestAi(question) {
  const file = selectedFile();
  if (!question || !state.online) return;
  const history = state.chat.filter((message) => !message.pending && (message.role === 'user' || message.role === 'assistant')).slice(-10);
  state.chat.push({ role: 'user', text: question });
  const pending = { role: 'assistant', text: state.aiEnabled ? 'Reading the diff…' : 'Thinking through the diff…', pending: true };
  state.chat.push(pending);
  saveState();
  render();
  document.querySelector('.chat-scroll')?.scrollTo({ top: 99999, behavior: 'smooth' });

  if (!state.aiEnabled) {
    setTimeout(() => {
      pending.pending = false;
      pending.text = answerFor(question, file);
      saveState();
      render();
      document.querySelector('.chat-scroll')?.scrollTo({ top: 99999, behavior: 'smooth' });
    }, 520);
    return;
  }

  try {
    const response = await apiFetch('/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: question, history, file }),
    });
    const payload = await response.json();
    pending.pending = false;
    pending.text = response.ok && payload.text ? payload.text : `${payload.error || 'The AI guide could not answer right now.'}${payload.detail ? ` ${payload.detail}` : ''}`;
  } catch {
    pending.pending = false;
    pending.text = 'The laptop companion could not reach the AI provider. Your review is still available offline.';
  }
  saveState();
  render();
  document.querySelector('.chat-scroll')?.scrollTo({ top: 99999, behavior: 'smooth' });
}

function answerFor(question, file) {
  const normalized = question.toLowerCase();
  if (normalized.includes('break') || normalized.includes('risk')) return `The main risk is keeping the snapshot fresh. If cache.persist fails after execute(), the next offline session can look one step behind. I would add a small error boundary or telemetry around that write.`;
  if (normalized.includes('offline')) return `The offline path starts at line 8. context.isOffline short-circuits the network call and returns the last snapshot. That keeps the UI useful without pretending the latest response is available.`;
  return `${file.label} keeps the change focused: it moves session lookup behind cache.session() and gives the rest of the request a single context object. I’d review the cache invalidation rules next.`;
}

async function hydrateFromCompanion() {
  try {
    const response = await apiFetch('/api/snapshot', { cache: 'no-store' });
    if (response.status === 401) { state.pairingRequired = true; render(); return; }
    if (!response.ok) return;
    const payload = await response.json();
    if (!Array.isArray(payload.files)) return;
    files = payload.files;
    cacheSnapshot(payload);
    if (files.length && !files.some((item) => item.id === state.selectedFile)) state.selectedFile = files[0].id;
    state.chat = files.length ? state.chats[state.selectedFile] || defaultChatFor(selectedFile()) : defaultChat;
    state.source = 'companion';
    state.pairingRequired = false;
    state.workspaceName = payload.workspaceName || state.workspaceName;
    state.branchName = payload.branch || state.branchName;
    state.snapshotAt = payload.generatedAt || new Date().toISOString();
    saveState();
    render();
  } catch {
    // Static hosting and offline launches intentionally keep the sample workspace.
  } finally {
    if (state.toast === 'Checking the laptop companion…') {
      state.toast = '';
      render();
    }
    scheduleReminder();
    maybeShowOverdueReminder();
  }
}

async function hydrateAiConfig() {
  try {
    const response = await apiFetch('/api/config', { cache: 'no-store' });
    if (response.status === 401) { state.pairingRequired = true; render(); return; }
    if (!response.ok) return;
    const payload = await response.json();
    state.aiEnabled = Boolean(payload.aiEnabled);
    state.aiProvider = typeof payload.provider === 'string' ? payload.provider : '';
    render();
  } catch {
    // Static hosting intentionally remains in preview mode.
  }
}

window.addEventListener('online', () => {
  state.online = true;
  render();
  if (state.activeTab === 'source' || state.activeTab === 'preview') hydrateFileSource(selectedFile());
});
window.addEventListener('offline', () => { state.online = false; render(); });
window.addEventListener('popstate', () => {
  if (!state.filesOpen) return;
  fileMenuHistoryEntry = false;
  state.filesOpen = false;
  state.chatOpen = false;
  render();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
render();
hydrateFromCompanion();
hydrateAiConfig();
scheduleReminder();
