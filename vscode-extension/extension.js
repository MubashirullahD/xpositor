const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const vscode = require('vscode');
const { qrSvg } = require('./qr');

let companionProcess;
let tunnelProcess;
let pairingView;
let pairingUrl;
let tunnelUrl;
let sessionToken;
let statusBar;
let stopping = false;
let companionStatus = 'stopped';
let lastError = '';

function activate(context) {
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'patchwork.start';
  statusBar.text = '$(broadcast) Patchwork';
  statusBar.tooltip = 'Start Patchwork over a secure Quick Tunnel and show the phone pairing QR';
  statusBar.show();
  context.subscriptions.push(statusBar);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('patchwork.pairing', new PairingViewProvider(), {
    retainContextWhenHidden: true,
  }));
  context.subscriptions.push(vscode.commands.registerCommand('patchwork.start', () => {
    void revealPairingView();
    startCompanion();
  }));
  context.subscriptions.push(vscode.commands.registerCommand('patchwork.stop', () => stopCompanion(true)));
  context.subscriptions.push({ dispose: () => stopCompanion(false) });

  if (vscode.workspace.getConfiguration('patchwork').get('autoStart', false)) {
    void revealPairingView();
    startCompanion();
  }
}

class PairingViewProvider {
  resolveWebviewView(webviewView) {
    pairingView = webviewView;
    webviewView.webview.options = { enableScripts: true };
    const messageSubscription = webviewView.webview.onDidReceiveMessage((message) => handlePairingMessage(message));
    webviewView.onDidDispose(() => {
      messageSubscription.dispose();
      if (pairingView === webviewView) pairingView = undefined;
    }, undefined, []);

    renderPairingView();
    if (workspaceRoot() && !companionProcess && companionStatus === 'stopped') startCompanion();
  }
}

function revealPairingView() {
  return vscode.commands.executeCommand('workbench.view.extension.patchwork').catch((error) => {
    vscode.window.showErrorMessage(`Patchwork could not open its sidebar: ${error.message}`);
  });
}

function workspaceRoot() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
}

function companionPath() {
  const configured = vscode.workspace.getConfiguration('patchwork').get('companionPath', '');
  if (configured) return configured;
  const bundled = path.resolve(__dirname, 'bundle', 'companion.mjs');
  if (fs.existsSync(bundled)) return bundled;
  return path.resolve(__dirname, '..', 'companion.mjs');
}

function cloudflaredPath() {
  const configured = String(vscode.workspace.getConfiguration('patchwork').get('cloudflaredPath', 'cloudflared')).trim();
  if (configured && configured !== 'cloudflared') return configured;
  const candidates = process.platform === 'darwin'
    ? ['/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared']
    : process.platform === 'win32'
      ? [path.join(process.env.LOCALAPPDATA || '', 'cloudflared', 'cloudflared.exe')]
      : ['/usr/local/bin/cloudflared', '/usr/bin/cloudflared'];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || configured || 'cloudflared';
}

function startCompanion() {
  const root = workspaceRoot();
  if (!root) {
    lastError = 'Open a workspace before starting Patchwork.';
    setStatus('error');
    vscode.window.showErrorMessage('Patchwork needs an open workspace first.');
    return;
  }
  if (companionProcess) {
    renderPairingView();
    if (pairingUrl) void revealPairingView();
    else vscode.window.showInformationMessage('Patchwork is still starting. The secure pairing QR will appear when the tunnel is ready.');
    return;
  }

  const script = companionPath();
  if (!fs.existsSync(script)) {
    lastError = `Patchwork companion not found at ${script}. Set patchwork.companionPath in your settings.`;
    setStatus('error');
    vscode.window.showErrorMessage(`Patchwork companion not found at ${script}. Set patchwork.companionPath in your settings.`);
    return;
  }

  const patchworkConfig = vscode.workspace.getConfiguration('patchwork');
  const configuredPort = patchworkConfig.get('port', 0);
  const parsedPort = Number(configuredPort);
  const port = parsedPort === 0 ? 0 : Math.max(1024, Math.min(65535, parsedPort || 4321));
  const aiProvider = String(patchworkConfig.get('aiProvider', 'auto'));
  const tunnelExecutable = cloudflaredPath();
  const electronHost = Boolean(process.versions.electron);
  const nodeArgs = [script, root];
  stopping = false;
  pairingUrl = '';
  tunnelUrl = '';
  // Base64url keeps the 144-bit token compact enough for a Quick Tunnel QR URL.
  sessionToken = crypto.randomBytes(18).toString('base64url');
  lastError = '';
  setStatus('starting');
  let stderrBuffer = '';
  companionProcess = spawn(process.execPath, nodeArgs, {
    cwd: root,
    env: {
      ...process.env,
      ...(electronHost ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      PATCHWORK_HOST: '127.0.0.1',
      PATCHWORK_PORT: String(port),
      PATCHWORK_TOKEN: sessionToken,
      PATCHWORK_AI_PROVIDER: aiProvider,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let outputBuffer = '';
  const readOutput = (chunk) => {
    outputBuffer += chunk.toString();
    const lines = outputBuffer.split(/\r?\n/);
    outputBuffer = lines.pop() || '';
    lines.forEach((line) => {
      const candidate = line.trim();
      const readyMatch = candidate.match(/^Patchwork companion: http:\/\/(?:127\.0\.0\.1|localhost):(\d+)$/);
      if (readyMatch) startQuickTunnel(Number(readyMatch[1]), tunnelExecutable, stderrBuffer);
    });
  };
  companionProcess.stdout.on('data', readOutput);
  companionProcess.stderr.on('data', (chunk) => {
    stderrBuffer += chunk.toString();
    if (stderrBuffer.length > 2000) stderrBuffer = stderrBuffer.slice(-2000);
  });
  companionProcess.once('error', (error) => {
    companionProcess = undefined;
    pairingUrl = '';
    lastError = error.message;
    setStatus('error');
    if (!stopping) vscode.window.showErrorMessage(`Patchwork could not start: ${error.message}`);
  });
  companionProcess.once('exit', (code) => {
    companionProcess = undefined;
    pairingUrl = '';
    if (!stopping && code && !tunnelProcess) {
      const detail = stderrBuffer.trim().split(/\r?\n/).filter(Boolean).at(-1) || 'No diagnostic output was captured.';
      lastError = `The companion stopped before pairing (exit ${code}). ${detail}`;
      setStatus('error');
      vscode.window.showErrorMessage(`Patchwork companion stopped before pairing (exit ${code}). ${detail}`);
      return;
    }
    if (!stopping && tunnelProcess) {
      failStart(tunnelUrl
        ? 'The Patchwork companion stopped unexpectedly. The secure tunnel was closed.'
        : 'The Patchwork companion stopped before the secure tunnel was ready.');
      return;
    }
    lastError = '';
    setStatus('stopped');
  });
}

function startQuickTunnel(localPort, cloudflaredPath, companionStderr) {
  if (stopping || tunnelProcess || tunnelUrl) return;
  const localOrigin = `http://127.0.0.1:${localPort}`;
  let tunnelOutput = '';
  let tunnelStderr = '';
  tunnelProcess = spawn(cloudflaredPath, ['tunnel', '--url', localOrigin], {
    cwd: workspaceRoot(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const readTunnelOutput = (chunk) => {
    tunnelOutput += chunk.toString();
    const match = tunnelOutput.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com(?:\/)?/i);
    if (!match) return;
    tunnelUrl = match[0].replace(/\/$/, '');
    pairingUrl = `${tunnelUrl}/?token=${encodeURIComponent(sessionToken)}`;
    lastError = '';
    setStatus('ready');
    void revealPairingView();
  };

  tunnelProcess.stdout.on('data', readTunnelOutput);
  tunnelProcess.stderr.on('data', (chunk) => {
    tunnelStderr += chunk.toString();
    if (tunnelStderr.length > 2000) tunnelStderr = tunnelStderr.slice(-2000);
    readTunnelOutput(chunk);
  });
  tunnelProcess.once('error', (error) => {
    if (stopping) return;
    const installHint = cloudflaredPath.includes('/') || cloudflaredPath.includes('\\')
      ? `Check patchwork.cloudflaredPath (${cloudflaredPath}).`
      : process.platform === 'darwin'
        ? `Install it once with "brew install cloudflared" or set patchwork.cloudflaredPath to its executable path.`
        : 'Install cloudflared from https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/ or set patchwork.cloudflaredPath to its executable path.';
    failStart(`Quick Tunnel could not start: ${error.message}. ${installHint}`);
  });
  tunnelProcess.once('exit', (code) => {
    tunnelProcess = undefined;
    if (stopping) return;
    const detail = tunnelStderr.trim().split(/\r?\n/).filter(Boolean).at(-1)
      || String(companionStderr || '').trim().split(/\r?\n/).filter(Boolean).at(-1)
      || 'No diagnostic output was captured.';
    failStart(`Quick Tunnel stopped${code ? ` (exit ${code})` : ''}. ${detail}`);
  });
}

function failStart(message) {
  stopping = true;
  if (tunnelProcess) tunnelProcess.kill();
  if (companionProcess) companionProcess.kill();
  tunnelProcess = undefined;
  companionProcess = undefined;
  pairingUrl = '';
  tunnelUrl = '';
  sessionToken = '';
  lastError = message;
  setStatus('error');
  vscode.window.showErrorMessage(message);
}

function stopCompanion(showMessage) {
  stopping = true;
  if (tunnelProcess) tunnelProcess.kill();
  if (companionProcess) companionProcess.kill();
  tunnelProcess = undefined;
  companionProcess = undefined;
  pairingUrl = '';
  tunnelUrl = '';
  sessionToken = '';
  lastError = '';
  setStatus('stopped');
  if (showMessage) vscode.window.showInformationMessage('Patchwork companion and secure tunnel stopped.');
}

function setStatus(status) {
  companionStatus = status;
  if (!statusBar) return;
  const labels = {
    starting: '$(sync~spin) Patchwork: starting',
    ready: '$(broadcast) Patchwork: ready',
    error: '$(warning) Patchwork: error',
    stopped: '$(broadcast) Patchwork',
  };
  statusBar.text = labels[status] || labels.stopped;
  renderPairingView();
}

function renderPairingView() {
  if (!pairingView) return;
  try {
    pairingView.webview.html = pairingHtml(pairingView.webview, {
      status: companionStatus,
      url: pairingUrl,
      root: workspaceRoot(),
      error: lastError,
    });
  } catch (error) {
    vscode.window.showErrorMessage(`Patchwork could not render its sidebar: ${error.message}`);
  }
}

async function handlePairingMessage(message) {
  if (message.type === 'copy' && pairingUrl) {
    await vscode.env.clipboard.writeText(pairingUrl);
    vscode.window.showInformationMessage('Patchwork pairing link copied.');
  }
  if (message.type === 'open' && pairingUrl) await vscode.env.openExternal(vscode.Uri.parse(pairingUrl));
  if (message.type === 'retry') startCompanion();
  if (message.type === 'stop') stopCompanion(true);
}

function pairingHtml(webview, state) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const safeUrl = escapeHtml(state.url || '');
  const safeRoot = escapeHtml(state.root ? path.basename(state.root) : 'No workspace');
  const safeError = escapeHtml(state.error || '');
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  const content = state.status === 'ready' && state.url
    ? readyPairingContent(state.url, safeUrl)
    : state.status === 'starting'
      ? startingPairingContent()
      : state.status === 'error'
        ? errorPairingContent(safeError)
        : stoppedPairingContent();
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Pair Patchwork</title>
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; padding: 18px 16px 24px; color: var(--vscode-foreground); font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .eyebrow { color: var(--vscode-textLink-foreground); font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: 9px 0 8px; font-size: 21px; line-height: 1.15; letter-spacing: -.03em; }
    p { color: var(--vscode-descriptionForeground); line-height: 1.5; }
    .card { display: grid; place-items: center; margin: 18px 0 16px; padding: 14px; border: 1px solid var(--vscode-panel-border); border-radius: 10px; background: #fff; }
    svg { display: block; width: min(220px, 100%); height: auto; shape-rendering: crispEdges; image-rendering: pixelated; }
    code { display: block; margin: 10px 0 8px; padding: 10px; overflow-wrap: anywhere; border-radius: 5px; background: var(--vscode-textBlockQuote-background); color: var(--vscode-textPreformat-foreground); font-size: 11px; line-height: 1.4; }
    .manual { margin: 0 0 12px; font-size: 11px; }
    .actions { display: flex; flex-wrap: wrap; gap: 7px; }
    button { padding: 7px 10px; border: 0; border-radius: 4px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    button.link { margin-top: 15px; padding: 0; background: transparent; color: var(--vscode-textLink-foreground); text-decoration: underline; }
    .note { margin-top: 18px; padding: 10px 11px; border-left: 3px solid var(--vscode-textLink-foreground); background: var(--vscode-textBlockQuote-background); }
    .state { display: flex; align-items: center; gap: 9px; margin: 22px 0; padding: 14px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; }
    .spinner { width: 13px; height: 13px; border: 2px solid var(--vscode-panel-border); border-top-color: var(--vscode-textLink-foreground); border-radius: 50%; animation: spin 800ms linear infinite; }
    .error { padding: 11px; border-left: 3px solid var(--vscode-errorForeground); background: var(--vscode-textBlockQuote-background); overflow-wrap: anywhere; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <span class="eyebrow">Patchwork · ${safeRoot}</span>
  ${content}
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const post = (id, type) => document.getElementById(id)?.addEventListener('click', () => vscode.postMessage({ type }));
    post('copy', 'copy');
    post('open', 'open');
    post('retry', 'retry');
    post('stop', 'stop');
  </script>
</body>
</html>`;
}

function readyPairingContent(url, safeUrl) {
  return `<h1>Scan to review</h1>
  <p>Use your phone camera to scan this secure link. Your phone and laptop can be on different networks.</p>
  <div class="card">${qrSvg(url)}</div>
  <p class="manual">If scanning fails, open the full link below on your phone.</p>
  <code>${safeUrl}</code>
  <div class="actions"><button id="copy">Copy pairing link</button><button class="secondary" id="open">Open on this laptop</button></div>
  <button class="link" id="stop">Stop companion</button>
  <p class="note"><strong>Secure, read-only companion.</strong> Keep this pairing link private. HTTPS protects it from local-network snooping; the connection is relayed through Cloudflare. Patchwork can show uncommitted changes and answer questions, but it cannot stage, edit, reset, or commit files.</p>`;
}

function startingPairingContent() {
  return `<h1>Creating secure link</h1>
  <div class="state"><span class="spinner" aria-hidden="true"></span><strong>Starting the companion and Quick Tunnel…</strong></div>
  <p>The QR code will appear here when the secure tunnel is ready.</p>`;
}

function errorPairingContent(error) {
  return `<h1>Patchwork needs attention</h1>
  <p class="error">${error || 'The companion could not start.'}</p>
  <div class="actions"><button id="retry">Try again</button></div>`;
}

function stoppedPairingContent() {
  return `<h1>Pair your phone</h1>
  <p>Patchwork starts a temporary HTTPS tunnel when you open this view. No phone certificate setup is required.</p>`;
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function deactivate() {
  stopCompanion(false);
}

module.exports = { activate, deactivate };
