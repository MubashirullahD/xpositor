const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { networkInterfaces } = require('node:os');
const { spawn } = require('node:child_process');
const vscode = require('vscode');
const { qrSvg } = require('./qr');

const MAX_LOG_CHARS = 4000;
let launcher;
let pairingView;

function activate(context) {
  launcher = new Launcher({ vscode, context, extensionDir: __dirname });
  launcher.activate();
}

function deactivate() { return launcher?.stop(false); }

class Launcher {
  constructor({ vscode: api, context, extensionDir, dependencies = {} }) {
    this.vscode = api;
    this.context = context || { subscriptions: [], secrets: { get: async () => undefined, store: async () => {} } };
    this.extensionDir = extensionDir;
    this.fs = dependencies.fs || fs;
    this.networkInterfaces = dependencies.networkInterfaces || networkInterfaces;
    this.spawn = dependencies.spawn || spawn;
    this.randomBytes = dependencies.randomBytes || crypto.randomBytes;
    this.setTimeout = dependencies.setTimeout || setTimeout;
    this.clearTimeout = dependencies.clearTimeout || clearTimeout;
    this.stopTimeout = dependencies.stopTimeout || 2000;
    this.session = undefined;
    this.startPromise = undefined;
    this.status = 'stopped';
    this.lastError = '';
    this.statusBar = undefined;
  }

  activate() {
    const api = this.vscode;
    this.statusBar = api.window.createStatusBarItem(api.StatusBarAlignment.Left, 100);
    this.statusBar.command = 'patchwork.start';
    this.statusBar.text = '$(broadcast) Patchwork';
    this.statusBar.tooltip = 'Start Patchwork and show the phone pairing QR';
    this.statusBar.show();
    this.context.subscriptions.push(this.statusBar);
    this.context.subscriptions.push(api.window.registerWebviewViewProvider('patchwork.pairing', new PairingViewProvider(this), { retainContextWhenHidden: true }));
    this.context.subscriptions.push(api.commands.registerCommand('patchwork.start', () => { void this.revealPairingView(); void this.start(); }));
    this.context.subscriptions.push(api.commands.registerCommand('patchwork.stop', () => this.stop(true)));
    this.context.subscriptions.push({ dispose: () => this.stop(false) });
    if (api.workspace.getConfiguration('patchwork').get('autoStart', false)) { void this.revealPairingView(); void this.start(); }
  }

  async start() {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startNewSession().finally(() => { this.startPromise = undefined; });
    return this.startPromise;
  }

  async startNewSession() {
    if (this.session?.phase === 'starting' || this.session?.phase === 'ready') { this.renderPairingView(); return; }
    if (this.session) await this.stop(false, { preserveError: true });
    const root = await chooseRepositoryFolder(this.vscode, this.fs);
    if (!root) return this.showFailure('Patchwork needs an open Git repository. In a multi-root workspace, choose the repository to review.');
    const config = this.vscode.workspace.getConfiguration('patchwork', root.uri);
    const script = this.companionPath();
    if (!this.fs.existsSync(script)) return this.showFailure(`Patchwork companion not found at ${script}. Set patchwork.companionPath in your settings.`);
    const transport=this.transport||config.get('transport','lan');
    const tunnel = transport==='lan'?{mode:'lan'}:readTunnelConfiguration(config);
    if (tunnel.error) return this.showFailure(tunnel.error);
    const port = readPort(config.get('port', 0));
    if (tunnel.mode === 'named' && port === 0) return this.showFailure('A named tunnel needs a fixed patchwork.port so its externally provisioned ingress can target http://127.0.0.1:<port>.');
    let token;
    try { token = await this.pairingToken(root.uri.fsPath, tunnel.mode === 'named'); }
    catch (error) { return this.showFailure(`Patchwork could not store the stable named-tunnel pairing token: ${error.message}`); }
    const session = {
      id: this.randomBytes(12).toString('hex'), root: root.uri.fsPath, phase: 'starting', token, tunnel,
      companion: undefined, tunnelProcess: undefined, companionStderr: '', tunnelStderr: '', companionOutput: '', tunnelOutput: '',
      stopping: false, cleanup: undefined, startupTimer: undefined,
    };
    this.session = session;
    this.lastError = '';
    this.setStatus('starting');
    const timeout = readStartupTimeout(config.get('startupTimeoutSeconds', 30));
    session.startupTimer = this.setTimeout(() => void this.fail(session, `Patchwork did not become ready within ${timeout} seconds. ${diagnostics(session)}`), timeout * 1000);
    try {
      session.companion = this.spawn(process.execPath, [script, session.root], {
        cwd: session.root,
        env: { ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}), PATCHWORK_HOST: tunnel.mode==='lan'?'0.0.0.0':'127.0.0.1', PATCHWORK_PORT: String(port), PATCHWORK_TOKEN: token, PATCHWORK_AI_PROVIDER: String(config.get('aiProvider', 'auto')) },
        stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      });
      this.bindCompanion(session, this.cloudflaredPath(config));
    } catch (error) { await this.fail(session, `Patchwork could not launch its companion: ${error.message}`); }
  }

  bindCompanion(session, cloudflaredPath) {
    const child = session.companion;
    child.stdout?.on('data', (chunk) => {
      if (!this.owns(session)) return;
      session.companionOutput = appendLog(session.companionOutput, chunk);
      for (const line of session.companionOutput.split(/\r?\n/)) {
        const match = line.trim().match(/^Patchwork companion: http:\/\/(?:127\.0\.0\.1|0\.0\.0\.0|localhost):(\d+)$/);
        if (match && !session.tunnelProcess && session.phase === 'starting') {
          session.port=Number(match[1]);
          if(session.tunnel.mode==='lan') {
            session.addresses=Object.values(this.networkInterfaces()).flatMap((entries)=>(entries||[]).filter((entry)=>!entry.internal&&(entry.family==='IPv4'||entry.family===4)).map((entry)=>entry.address));
            this.markReady(session,`http://${session.addresses[0]||'127.0.0.1'}:${session.port}`);
          } else this.startTunnel(session, session.port, cloudflaredPath);
        }
      }
    });
    child.stderr?.on('data', (chunk) => { if (this.owns(session)) session.companionStderr = appendLog(session.companionStderr, chunk); });
    child.once('error', (error) => { if (this.owns(session) && !session.stopping) void this.fail(session, `Patchwork companion could not start: ${error.message}. ${diagnostics(session)}`); });
    child.once('exit', (code, signal) => {
      if (this.owns(session) && !session.stopping) {
        const state = session.tunnelProcess ? 'after the tunnel started' : 'before the secure tunnel was ready';
        void this.fail(session, `Patchwork companion stopped ${state} (${exitDescription(code, signal)}). ${diagnostics(session)}`);
      }
    });
  }

  startTunnel(session, localPort, executable) {
    if (!this.owns(session) || session.tunnelProcess || session.phase !== 'starting') return;
    const args = session.tunnel.mode === 'named' ? ['tunnel', 'run', session.tunnel.name] : ['tunnel', '--url', `http://127.0.0.1:${localPort}`];
    try { session.tunnelProcess = this.spawn(executable, args, { cwd: session.root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); }
    catch (error) { void this.fail(session, `Cloudflare tunnel could not start: ${error.message}. ${cloudflaredHelp(executable)}`); return; }
    const readOutput = (chunk) => {
      if (!this.owns(session)) return;
      session.tunnelOutput = appendLog(session.tunnelOutput, chunk);
      if (session.tunnel.mode === 'quick') {
        const match = session.tunnelOutput.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\/?/i);
        if (match) this.markReady(session, match[0].replace(/\/$/, ''));
      } else if (/registered tunnel connection|connection .* registered|tunnel connection.*registered/i.test(session.tunnelOutput)) this.markReady(session, session.tunnel.publicUrl);
    };
    session.tunnelProcess.stdout?.on('data', readOutput);
    session.tunnelProcess.stderr?.on('data', (chunk) => { if (this.owns(session)) { session.tunnelStderr = appendLog(session.tunnelStderr, chunk); readOutput(chunk); } });
    session.tunnelProcess.once('error', (error) => { if (this.owns(session) && !session.stopping) void this.fail(session, `Cloudflare tunnel could not start: ${error.message}. ${cloudflaredHelp(executable)}`); });
    session.tunnelProcess.once('exit', (code, signal) => { if (this.owns(session) && !session.stopping) void this.fail(session, `Cloudflare tunnel stopped (${exitDescription(code, signal)}). ${diagnostics(session)}`); });
  }

  markReady(session, origin) {
    if (!this.owns(session) || session.phase !== 'starting') return;
    session.phase = 'ready';
    session.pairingUrl = `${origin}/?token=${encodeURIComponent(session.token)}`;
    this.clearTimeout(session.startupTimer);
    session.startupTimer = undefined;
    this.lastError = '';
    this.setStatus('ready');
  }

  async fail(session, message) {
    if (!this.owns(session) || session.phase === 'error') return;
    session.phase = 'error';
    this.lastError = message;
    this.setStatus('error');
    this.vscode.window.showErrorMessage(message);
    await this.closeSession(session, { preserveError: true });
  }

  async stop(showMessage, { preserveError = false } = {}) {
    if (this.session) await this.closeSession(this.session, { preserveError });
    else if (!preserveError) { this.lastError = ''; this.setStatus('stopped'); }
    if (showMessage) this.vscode.window.showInformationMessage('Patchwork companion stopped.');
  }

  async closeSession(session, { preserveError }) {
    if (session.cleanup) return session.cleanup;
    session.stopping = true;
    this.clearTimeout(session.startupTimer);
    session.startupTimer = undefined;
    session.cleanup = Promise.all([stopProcess(session.tunnelProcess, this.setTimeout, this.clearTimeout, this.stopTimeout), stopProcess(session.companion, this.setTimeout, this.clearTimeout, this.stopTimeout)]).then(() => {
      if (!this.owns(session)) return;
      this.session = undefined;
      if (!preserveError) { this.lastError = ''; this.setStatus('stopped'); }
    });
    return session.cleanup;
  }

  owns(session) { return this.session === session; }
  showFailure(message) { this.lastError = message; this.setStatus('error'); this.vscode.window.showErrorMessage(message); }
  companionPath() {
    const configured = this.vscode.workspace.getConfiguration('patchwork').get('companionPath', '');
    if (configured) return configured;
    const sibling = path.resolve(this.extensionDir, '..', 'companion.mjs');
    const bundled = path.resolve(this.extensionDir, 'bundle', 'companion.mjs');
    const dev = this.context.extensionMode === this.vscode.ExtensionMode?.Development;
    const candidates = dev ? [sibling, bundled] : [bundled, sibling];
    return candidates.find((candidate) => this.fs.existsSync(candidate)) || candidates[0];
  }
  cloudflaredPath(config) {
    const configured = String(config.get('cloudflaredPath', 'cloudflared')).trim();
    if (configured && configured !== 'cloudflared') return configured;
    const candidates = process.platform === 'darwin' ? ['/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared'] : process.platform === 'win32' ? [path.join(process.env.LOCALAPPDATA || '', 'cloudflared', 'cloudflared.exe')] : ['/usr/local/bin/cloudflared', '/usr/bin/cloudflared'];
    return candidates.find((candidate) => candidate && this.fs.existsSync(candidate)) || configured || 'cloudflared';
  }
  async pairingToken(repositoryPath, stable) {
    if (!stable) return this.randomBytes(18).toString('base64url');
    const key = `patchwork.pairingToken.${crypto.createHash('sha256').update(path.resolve(repositoryPath)).digest('hex')}`;
    const existing = await this.context.secrets.get(key);
    if (existing) return existing;
    const created = this.randomBytes(24).toString('base64url');
    await this.context.secrets.store(key, created);
    return created;
  }
  async revealPairingView() { try { await this.vscode.commands.executeCommand('workbench.view.extension.patchwork'); } catch (error) { this.vscode.window.showErrorMessage(`Patchwork could not open its sidebar: ${error.message}`); } }
  renderPairingView() {
    if (!pairingView) return;
    try { pairingView.webview.html = pairingHtml({ status: this.status, url: this.session?.pairingUrl || '', root: this.session?.root || '', error: this.lastError, mode:this.session?.tunnel.mode||(this.transport||this.vscode.workspace.getConfiguration('patchwork').get('transport','lan')), multipleAddresses:(this.session?.addresses?.length||0)>1 }); }
    catch (error) { this.vscode.window.showErrorMessage(`Patchwork could not render its sidebar: ${error.message}`); }
  }
  setStatus(status) {
    this.status = status;
    if (this.statusBar) this.statusBar.text = ({ starting: '$(sync~spin) Patchwork: starting', ready: '$(broadcast) Patchwork: ready', error: '$(warning) Patchwork: error', stopped: '$(broadcast) Patchwork' })[status] || '$(broadcast) Patchwork';
    this.renderPairingView();
  }
  async handlePairingMessage(message) {
    if(['lan','tunnel'].includes(message.type)) {if(this.startPromise)await this.startPromise;await this.stop(false);this.transport=message.type;await this.start();return;}
    if(message.type==='address'&&this.session?.tunnel.mode==='lan') {const session=this.session;const address=await this.vscode.window.showQuickPick(session.addresses,{title:'Choose the laptop address on your phone’s Wi-Fi network'});if(address&&this.owns(session)){session.pairingUrl=`http://${address}:${session.port}/?token=${encodeURIComponent(session.token)}`;this.renderPairingView();}return;}
    if (message.type === 'copy' && this.session?.pairingUrl) { await this.vscode.env.clipboard.writeText(this.session.pairingUrl); this.vscode.window.showInformationMessage('Patchwork pairing link copied.'); }
    if (message.type === 'open' && this.session?.pairingUrl) await this.vscode.env.openExternal(this.vscode.Uri.parse(this.session.pairingUrl));
    if (message.type === 'retry') await this.start();
    if (message.type === 'stop') await this.stop(true);
  }
}

class PairingViewProvider {
  constructor(owner) { this.owner = owner; }
  resolveWebviewView(view) {
    pairingView = view;
    view.webview.options = { enableScripts: true };
    const subscription = view.webview.onDidReceiveMessage((message) => void this.owner.handlePairingMessage(message));
    view.onDidDispose(() => { subscription.dispose(); if (pairingView === view) pairingView = undefined; });
    this.owner.renderPairingView();
    if (this.owner.status === 'stopped') void this.owner.start();
  }
}

async function chooseRepositoryFolder(api, fileSystem) {
  const folders = (api.workspace.workspaceFolders || []).filter((folder) => fileSystem.existsSync(path.join(folder.uri.fsPath, '.git')));
  if (folders.length === 1) return folders[0];
  if (!folders.length) return undefined;
  const picked = await api.window.showQuickPick(folders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, folder })), { title: 'Choose the Git repository to review with Patchwork', placeHolder: 'Patchwork only reads the repository you choose' });
  return picked?.folder;
}

function readTunnelConfiguration(config) {
  const name = String(config.get('tunnelName', '')).trim();
  const configuredUrl = String(config.get('publicUrl', '')).trim();
  if (!name && !configuredUrl) return { mode: 'quick' };
  if (!name || !configuredUrl) return { error: 'Set both patchwork.tunnelName and patchwork.publicUrl to use an existing named tunnel, or clear both to use a free Quick Tunnel.' };
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) return { error: 'patchwork.tunnelName may contain letters, numbers, periods, underscores, and hyphens only.' };
  try {
    const url = new URL(configuredUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
    return { mode: 'named', name, publicUrl: url.origin + (url.pathname.replace(/\/$/, '') || '') };
  } catch { return { error: 'patchwork.publicUrl must be an HTTPS origin or path without credentials, query parameters, or fragments.' }; }
}

function readPort(value) { const port = Number(value); return port === 0 ? 0 : Math.max(1024, Math.min(65535, Number.isFinite(port) ? Math.floor(port) : 4321)); }
function readStartupTimeout(value) { const valueNumber = Number(value); return Math.max(5, Math.min(300, Number.isFinite(valueNumber) ? Math.floor(valueNumber) : 30)); }
function appendLog(previous, chunk) { const next = previous + String(chunk); return next.length > MAX_LOG_CHARS ? next.slice(-MAX_LOG_CHARS) : next; }
function diagnostics(session) { const output = [session.tunnelStderr, session.companionStderr, session.tunnelOutput, session.companionOutput].join('\n').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1); return output ? `Last diagnostic: ${output}` : 'No diagnostic output was captured.'; }
function cloudflaredHelp(executable) { return executable.includes('/') || executable.includes('\\') ? `Check patchwork.cloudflaredPath (${executable}).` : process.platform === 'darwin' ? 'Install it once with "brew install cloudflared" or set patchwork.cloudflaredPath.' : 'Install cloudflared from https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/ or set patchwork.cloudflaredPath.'; }
function exitDescription(code, signal) { return signal ? `signal ${signal}` : `exit ${code ?? 0}`; }
function stopProcess(child, schedule, cancel, timeout) {
  if (!child || child.exitCode !== null || child.killed) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; cancel(timer); resolve(); } };
    const timer = schedule(finish, timeout);
    child.once?.('exit', finish); child.once?.('error', finish);
    try { child.kill(); } catch { finish(); }
  });
}

function pairingHtml(state) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const safeUrl = escapeHtml(state.url || '');
  const safeRoot = escapeHtml(state.root ? path.basename(state.root) : 'No workspace');
  const safeError = escapeHtml(state.error || '');
  const lan=state.mode==='lan';
  const transportButtons=`<div class="actions transport"><button class="${lan?'':'secondary'}" id="lan">Local LAN · HTTP</button><button class="${lan?'secondary':''}" id="tunnel">HTTPS tunnel</button></div>`;
  const content = state.status === 'ready' && state.url
    ? `<h1>Scan to review</h1><p>${lan?'Connect your phone to the same Wi-Fi and scan this link.':'Scan this HTTPS link from any network.'}</p><div class="card">${qrSvg(state.url)}</div><code>${safeUrl}</code><div class="actions"><button id="copy">Copy pairing link</button><button class="secondary" id="open">Open on this laptop</button></div><button class="link" id="stop">Stop companion</button><p class="note"><strong>${lan?'Local-network, read-only companion.':'HTTPS, read-only companion.'}</strong> ${lan?'HTTP is unencrypted. Use a trusted Wi-Fi network. Offline installation requires HTTPS; downloaded code remains readable in the open tab.':''} Keep this pairing link private. Patchwork cannot stage, edit, reset, or commit files.</p>`
    : state.status === 'starting' ? `<h1>${lan?'Starting local review':'Creating secure link'}</h1><div class="state"><span class="spinner"></span><strong>${lan?'Starting the companion…':'Starting the companion and tunnel…'}</strong></div><button class="link" id="stop">Cancel startup</button>`
      : state.status === 'error' ? `<h1>Patchwork needs attention</h1><p class="error">${safeError || 'The companion could not start.'}</p><div class="actions"><button id="retry">Try again</button></div>`
        : '<h1>Pair your phone</h1><p>Choose local LAN for a quick connection or HTTPS tunnel for access from another network.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'"><style>:root{color-scheme:light dark}body{margin:0;padding:18px 16px 24px;color:var(--vscode-foreground);font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.eyebrow{color:var(--vscode-textLink-foreground);font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}h1{margin:9px 0 8px;font-size:21px;line-height:1.15}p{color:var(--vscode-descriptionForeground);line-height:1.5}.card{display:grid;place-items:center;margin:18px 0 16px;padding:14px;border:1px solid var(--vscode-panel-border);border-radius:10px;background:#fff}svg{display:block;width:min(220px,100%);height:auto}code{display:block;margin:10px 0 8px;padding:10px;overflow-wrap:anywhere;border-radius:5px;background:var(--vscode-textBlockQuote-background);font-size:11px}.actions{display:flex;flex-wrap:wrap;gap:7px}button{padding:7px 10px;border:0;border-radius:4px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);cursor:pointer}button.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}button.link{margin-top:15px;padding:0;background:transparent;color:var(--vscode-textLink-foreground);text-decoration:underline}.note{margin-top:18px;padding:10px 11px;border-left:3px solid var(--vscode-textLink-foreground);background:var(--vscode-textBlockQuote-background)}.state{display:flex;align-items:center;gap:9px;margin:22px 0;padding:14px;border:1px solid var(--vscode-panel-border);border-radius:8px}.spinner{width:13px;height:13px;border:2px solid var(--vscode-panel-border);border-top-color:var(--vscode-textLink-foreground);border-radius:50%;animation:spin 800ms linear infinite}.error{padding:11px;border-left:3px solid var(--vscode-errorForeground);background:var(--vscode-textBlockQuote-background);overflow-wrap:anywhere}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><span class="eyebrow">Patchwork · ${safeRoot}</span>${transportButtons}${content}${state.multipleAddresses?'<button class="link" id="address">Choose LAN address</button>':''}<script nonce="${nonce}">const vscode=acquireVsCodeApi();for(const type of ['copy','open','retry','stop','lan','tunnel','address'])document.getElementById(type)?.addEventListener('click',()=>vscode.postMessage({type}));</script></body></html>`;
}
function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }

module.exports = { activate, deactivate, Launcher, chooseRepositoryFolder, readTunnelConfiguration, pairingHtml };
