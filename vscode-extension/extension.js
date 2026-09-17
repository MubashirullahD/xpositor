const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const vscode = require('vscode');
const { qrSvg } = require('./qr');

let companionProcess;
let pairingPanel;
let pairingUrl;
let statusBar;
let stopping = false;

function activate(context) {
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'patchwork.start';
  statusBar.text = '$(broadcast) Patchwork';
  statusBar.tooltip = 'Start Patchwork and show the phone pairing QR';
  statusBar.show();
  context.subscriptions.push(statusBar);
  context.subscriptions.push(vscode.commands.registerCommand('patchwork.start', () => startCompanion()));
  context.subscriptions.push(vscode.commands.registerCommand('patchwork.stop', () => stopCompanion(true)));
  context.subscriptions.push({ dispose: () => stopCompanion(false) });

  if (vscode.workspace.getConfiguration('patchwork').get('autoStart', false)) void startCompanion();
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

function startCompanion() {
  const root = workspaceRoot();
  if (!root) {
    vscode.window.showErrorMessage('Patchwork needs an open workspace first.');
    return;
  }
  if (companionProcess) {
    if (pairingUrl) showPairingPanel(pairingUrl, root);
    else vscode.window.showInformationMessage('Patchwork is still starting. The pairing QR will appear when the companion is ready.');
    return;
  }

  const script = companionPath();
  if (!fs.existsSync(script)) {
    vscode.window.showErrorMessage(`Patchwork companion not found at ${script}. Set patchwork.companionPath in your settings.`);
    return;
  }

  const patchworkConfig = vscode.workspace.getConfiguration('patchwork');
  const configuredPort = patchworkConfig.get('port', 0);
  const parsedPort = Number(configuredPort);
  const port = parsedPort === 0 ? 0 : Math.max(1024, Math.min(65535, parsedPort || 4321));
  const aiProvider = String(patchworkConfig.get('aiProvider', 'auto'));
  const electronHost = Boolean(process.versions.electron);
  const nodeArgs = [script, root];
  stopping = false;
  pairingUrl = '';
  setStatus('starting');
  let stderrBuffer = '';
  companionProcess = spawn(process.execPath, nodeArgs, {
    cwd: root,
    env: { ...process.env, ...(electronHost ? { ELECTRON_RUN_AS_NODE: '1' } : {}), PATCHWORK_HOST: '0.0.0.0', PATCHWORK_PORT: String(port), PATCHWORK_AI_PROVIDER: aiProvider },
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
      if (!candidate.includes('?token=')) return;
      if (candidate.includes('0.0.0.0') || candidate.includes('127.0.0.1') || candidate.includes('localhost')) return;
      if (!/^https?:\/\/[^\s]+\/\?token=[^\s]+$/.test(candidate)) return;
      pairingUrl = candidate;
      setStatus('ready');
      showPairingPanel(pairingUrl, root);
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
    setStatus('error');
    if (!stopping) vscode.window.showErrorMessage(`Patchwork could not start: ${error.message}`);
  });
  companionProcess.once('exit', (code) => {
    companionProcess = undefined;
    pairingUrl = '';
    setStatus('stopped');
    if (!stopping && code) {
      const detail = stderrBuffer.trim().split(/\r?\n/).filter(Boolean).at(-1) || 'No diagnostic output was captured.';
      vscode.window.showErrorMessage(`Patchwork companion stopped before pairing (exit ${code}). ${detail}`);
    }
  });
}

function stopCompanion(showMessage) {
  stopping = true;
  if (companionProcess) companionProcess.kill();
  companionProcess = undefined;
  pairingUrl = '';
  if (pairingPanel) {
    pairingPanel.dispose();
    pairingPanel = undefined;
  }
  setStatus('stopped');
  if (showMessage) vscode.window.showInformationMessage('Patchwork companion stopped.');
}

function setStatus(status) {
  if (!statusBar) return;
  const labels = {
    starting: '$(sync~spin) Patchwork: starting',
    ready: '$(broadcast) Patchwork: ready',
    error: '$(warning) Patchwork: error',
    stopped: '$(broadcast) Patchwork',
  };
  statusBar.text = labels[status] || labels.stopped;
}

function showPairingPanel(url, root) {
  try {
    const panel = pairingPanel || vscode.window.createWebviewPanel('patchworkPairing', 'Patchwork pairing', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
    pairingPanel = panel;
    panel.title = 'Patchwork pairing';
    panel.webview.html = pairingHtml(panel.webview, url, root);
    panel.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'copy') {
        await vscode.env.clipboard.writeText(url);
        vscode.window.showInformationMessage('Patchwork pairing link copied.');
      }
      if (message.type === 'open') await vscode.env.openExternal(vscode.Uri.parse(url));
    }, undefined, []);
    panel.onDidDispose(() => { if (pairingPanel === panel) pairingPanel = undefined; }, undefined, []);
    panel.reveal(vscode.ViewColumn.Beside);
  } catch (error) {
    vscode.window.showErrorMessage(`Patchwork could not create the pairing QR: ${error.message}`);
  }
}

function pairingHtml(webview, url, root) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const qr = qrSvg(url);
  const safeUrl = escapeHtml(url);
  const safeRoot = escapeHtml(path.basename(root));
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Pair Patchwork</title>
  <style>
    :root { color-scheme: light dark; }
    body { max-width: 620px; margin: 0 auto; padding: 36px 28px; color: var(--vscode-foreground); font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .eyebrow { color: var(--vscode-textLink-foreground); font-size: 11px; font-weight: 700; letter-spacing: .13em; text-transform: uppercase; }
    h1 { margin: 10px 0 8px; font-size: 28px; letter-spacing: -.04em; }
    p { color: var(--vscode-descriptionForeground); line-height: 1.55; }
    .card { display: grid; place-items: center; margin: 26px 0 22px; padding: 30px; border: 1px solid var(--vscode-panel-border); border-radius: 16px; background: #fff; }
    svg { display: block; width: min(360px, 82vw); height: auto; shape-rendering: crispEdges; image-rendering: pixelated; }
    code { display: block; margin: 12px 0 8px; padding: 13px; overflow-wrap: anywhere; border-radius: 6px; background: var(--vscode-textBlockQuote-background); color: var(--vscode-textPreformat-foreground); font-size: 13px; line-height: 1.45; }
    .manual { margin: 0 0 16px; color: var(--vscode-descriptionForeground); font-size: 12px; }
    .actions { display: flex; flex-wrap: wrap; gap: 9px; }
    button { padding: 8px 13px; border: 0; border-radius: 5px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .note { margin-top: 22px; padding: 13px 15px; border-left: 3px solid var(--vscode-textLink-foreground); background: var(--vscode-textBlockQuote-background); }
  </style>
</head>
<body>
  <span class="eyebrow">Patchwork · ${safeRoot}</span>
  <h1>Scan to review on your phone</h1>
  <p>Open the camera on your phone and scan this code. Both devices must be on the same Wi‑Fi network.</p>
  <div class="card">${qr}</div>
  <p class="manual">If scanning still fails, use the full link below with your phone’s browser.</p>
  <code>${safeUrl}</code>
  <div class="actions"><button id="copy">Copy pairing link</button><button class="secondary" id="open">Open on this laptop</button></div>
  <p class="note"><strong>Read-only companion.</strong> Patchwork can show your uncommitted changes and answer questions, but it cannot stage, edit, reset, or commit files.</p>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('copy').addEventListener('click', () => vscode.postMessage({ type: 'copy' }));
    document.getElementById('open').addEventListener('click', () => vscode.postMessage({ type: 'open' }));
  </script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function deactivate() {
  stopCompanion(false);
}

module.exports = { activate, deactivate };
