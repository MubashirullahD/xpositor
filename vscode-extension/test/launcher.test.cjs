const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const { resolve } = require('node:path');
const test = require('node:test');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'vscode') return {};
  return originalLoad.call(this, request, parent, isMain);
};
const { Launcher, pairingHtml } = require('../extension.js');
Module._load = originalLoad;

test('pairing panel explains CLI setup and shows verified provider status', () => {
  const html = pairingHtml({status:'ready',url:'http://localhost:4321/?token=x',mode:'lan',aiChoice:'auto',aiStatus:{state:'connected',provider:'claude',billing:'subscription'}});
  assert.match(html,/Claude Code connected · subscription login verified/);
  assert.match(html,/npm install -g @openai\/codex/);
  assert.match(html,/refresh-ai/);
});

class FakeProcess extends EventEmitter {
  constructor() {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.exitCode = null;
    this.killed = false;
  }
  kill() {
    this.killed = true;
    queueMicrotask(() => { this.exitCode = 0; this.emit('exit', 0, null); });
    return true;
  }
}

function makeHarness({ configuration = {transport:'tunnel'}, folders = ['/repo'] } = {}) {
  const errors = [];
  const infos = [];
  const commands = [];
  const spawns = [];
  const secrets = new Map();
  const timers = [];
  const providerChecks = [];
  configuration={transport:'tunnel',...configuration};
  const api = {
    ExtensionMode: { Development: 1 },
    workspace: {
      workspaceFolders: folders.map((fsPath) => ({ name: fsPath.split('/').at(-1), uri: { fsPath } })),
      getConfiguration: () => ({ get: (key, fallback) => Object.hasOwn(configuration, key) ? configuration[key] : fallback }),
    },
    window: {
      createStatusBarItem: () => ({ show() {} }),
      registerWebviewViewProvider: () => ({ dispose() {} }),
      showErrorMessage: (message) => errors.push(message),
      showInformationMessage: (message) => infos.push(message),
      showQuickPick: async (items) => items.at(-1),
    },
    commands: { registerCommand: () => ({ dispose() {} }), executeCommand: async (...args) => commands.push(args) },
    env: { clipboard: { writeText: async () => {} }, openExternal: async () => {} },
    Uri: { parse: (value) => value },
    StatusBarAlignment: { Left: 1 },
  };
  const fakeFs = { existsSync: (candidate) => candidate.endsWith('.git') || candidate.endsWith('companion.mjs') || candidate.endsWith('setup-voice.mjs') };
  const extension = new Launcher({
    vscode: api,
    context: { subscriptions: [], secrets: { get: async (key) => secrets.get(key), store: async (key, value) => secrets.set(key, value) } },
    extensionDir: '/extension',
    dependencies: {
      fs: fakeFs,
      fetch: async (url, options) => {
        providerChecks.push({url,options});
        return {ok:true,json:async()=>({aiEnabled:true,provider:'claude',billing:'subscription',message:'Claude Code · subscription login'})};
      },
      networkInterfaces:()=>({wifi:[{address:'192.168.1.10',family:'IPv4',internal:false}]}),
      spawn: (file, args, options) => { const child = new FakeProcess(); spawns.push({ file, args, options, child }); return child; },
      randomBytes: (length) => Buffer.alloc(length, spawns.length + 1),
      setTimeout: (fn, ms) => { const timer = { fn, ms, active: true }; timers.push(timer); return timer; },
      clearTimeout: (timer) => { if (timer) timer.active = false; },
      stopTimeout: 1,
    },
  });
  return { extension, errors, infos, commands, spawns, timers, secrets, providerChecks };
}

async function settle() { await new Promise((resolve) => setImmediate(resolve)); }

test('quick tunnel becomes ready once and stale callbacks cannot alter a restarted session', async () => {
  const h = makeHarness();
  let readyTransitions = 0;
  const setStatus = h.extension.setStatus.bind(h.extension);
  h.extension.setStatus = (status) => { if (status === 'ready') readyTransitions += 1; setStatus(status); };
  await h.extension.start();
  const firstCompanion = h.spawns[0].child;
  firstCompanion.stdout.emit('data', Buffer.from('Patchwork companion: http://127.0.0.1:4311\n'));
  const firstTunnel = h.spawns[1].child;
  firstTunnel.stderr.emit('data', Buffer.from('https://first.trycloudflare.com\nhttps://first.trycloudflare.com\n'));
  assert.equal(h.extension.status, 'ready');
  assert.equal(readyTransitions, 1);
  const firstUrl = h.extension.session.pairingUrl;

  await h.extension.stop(false);
  await h.extension.start();
  const secondCompanion = h.spawns[2].child;
  secondCompanion.stdout.emit('data', Buffer.from('Patchwork companion: http://127.0.0.1:4312\n'));
  h.spawns[3].child.stderr.emit('data', Buffer.from('https://second.trycloudflare.com\n'));
  firstTunnel.stderr.emit('data', Buffer.from('https://stale.trycloudflare.com\n'));
  firstCompanion.emit('error', new Error('late process error'));

  assert.equal(h.extension.status, 'ready');
  assert.match(h.extension.session.pairingUrl, /second\.trycloudflare\.com/);
  assert.notEqual(h.extension.session.pairingUrl, firstUrl);
  assert.equal(h.errors.length, 0);
});

test('ready companion verifies AI login over loopback with its pairing token', async () => {
  const h = makeHarness({configuration:{transport:'lan'}});
  await h.extension.start();
  h.spawns[0].child.stdout.emit('data', Buffer.from('Patchwork companion: http://127.0.0.1:4311\n'));
  await settle();
  assert.equal(h.extension.aiStatus.state,'connected');
  assert.equal(h.extension.aiStatus.provider,'claude');
  assert.equal(h.providerChecks[0].url,'http://127.0.0.1:4311/api/config?refresh=true');
  assert.equal(h.providerChecks[0].options.headers['x-patchwork-token'],h.extension.session.token);
});

test('startup deadline preserves a useful failure after cleanup', async () => {
  const h = makeHarness({ configuration: { startupTimeoutSeconds: 5 } });
  await h.extension.start();
  h.spawns[0].child.stderr.emit('data', Buffer.from('address already in use\n'));
  h.timers[0].fn();
  await settle();
  assert.equal(h.extension.status, 'error');
  assert.match(h.extension.lastError, /did not become ready within 5 seconds/);
  assert.match(h.extension.lastError, /address already in use/);
  assert.equal(h.errors.length, 1);
});

test('named tunnels use argv-safe arguments and keep a repository token', async () => {
  const h = makeHarness({ configuration: { tunnelName: 'review-tunnel', publicUrl: 'https://review.example.test', port: 4311 } });
  await h.extension.start();
  h.spawns[0].child.stdout.emit('data', Buffer.from('Patchwork companion: http://127.0.0.1:4311\n'));
  assert.deepEqual(h.spawns[1].args, ['tunnel', 'run', 'review-tunnel']);
  h.spawns[1].child.stderr.emit('data', Buffer.from('INF Registered tunnel connection\n'));
  const firstUrl = h.extension.session.pairingUrl;
  await h.extension.stop(false);
  await h.extension.start();
  h.spawns[2].child.stdout.emit('data', Buffer.from('Patchwork companion: http://127.0.0.1:4311\n'));
  h.spawns[3].child.stderr.emit('data', Buffer.from('INF Registered tunnel connection\n'));
  assert.equal(h.extension.session.pairingUrl, firstUrl);
  assert.match(firstUrl, /^https:\/\/review\.example\.test\/\?token=/);
  assert.equal(h.secrets.size, 1);
});

test('multi-root workspaces launch the Git repository chosen by the user', async () => {
  const h = makeHarness({ folders: ['/repo-a', '/repo-b'] });
  await h.extension.start();
  assert.equal(h.spawns[0].options.cwd, '/repo-b');
});

test('development hosts prefer the sibling companion while deployed extensions prefer the bundle', () => {
  const h = makeHarness();
  h.extension.context.extensionMode = 1;
  assert.equal(h.extension.companionPath(), resolve('/companion.mjs'));
  h.extension.context.extensionMode = 0;
  assert.equal(h.extension.companionPath(), resolve('/extension/bundle/companion.mjs'));
});

test('LAN is ready immediately without cloudflared and can switch to a tunnel', async()=>{
 const h=makeHarness({configuration:{transport:'lan'}});
 await h.extension.start();
 assert.equal(h.spawns[0].options.env.PATCHWORK_HOST,'0.0.0.0');
 h.spawns[0].child.stdout.emit('data',Buffer.from('Patchwork companion: http://0.0.0.0:4311\n'));
 assert.equal(h.spawns.length,1);assert.equal(h.extension.status,'ready');
 assert.match(h.extension.session.pairingUrl,/^http:\/\/192\.168\.1\.10:4311\/\?token=/);
 await h.extension.handlePairingMessage({type:'tunnel'});
 assert.deepEqual(h.spawns[1].args,['tunnel','--url','http://127.0.0.1:4311']);
 assert.equal(h.spawns.length,2);
 assert.equal(h.spawns[0].child.killed,false);
});

test('LAN and tunnel switches preserve the companion, token, and tunnel URL', async () => {
  const h=makeHarness({configuration:{transport:'lan'}});
  await h.extension.start();
  h.spawns[0].child.stdout.emit('data',Buffer.from('Patchwork companion: http://0.0.0.0:4311\n'));
  const lanUrl=h.extension.session.pairingUrl;
  await h.extension.handlePairingMessage({type:'tunnel'});
  assert.equal(h.spawns.length,2);
  await h.extension.handlePairingMessage({type:'lan'});
  h.spawns[1].child.stderr.emit('data',Buffer.from('https://retained.trycloudflare.com\n'));
  assert.equal(h.extension.session.pairingUrl,lanUrl);
  await h.extension.handlePairingMessage({type:'tunnel'});
  assert.match(h.extension.session.pairingUrl,/retained.trycloudflare.com/);
  await h.extension.handlePairingMessage({type:'lan'});
  await h.extension.handlePairingMessage({type:'tunnel'});
  assert.equal(h.spawns.length,2);
  assert.ok(h.spawns.every(({child})=>!child.killed));
  await h.extension.stop(false);
  assert.ok(h.spawns.every(({child})=>child.killed));
});

test('pairing panel explains the tunnel dependency and offers voice setup', () => {
  const html = pairingHtml({ status:'ready', url:'https://example.test/?token=private', root:'/repo', mode:'tunnel', voiceStatus:'idle' });
  assert.match(html, /needs <strong>cloudflared<\/strong> installed on this laptop/);
  assert.match(html, /Installation instructions/);
  assert.match(html, /Install local voice/);
});

test('voice setup runs once and reports completion or failure', async () => {
  const h = makeHarness({ configuration:{transport:'lan'} });
  h.extension.installVoice();
  h.extension.installVoice();
  assert.equal(h.spawns.length, 1);
  assert.equal(h.spawns[0].args[0], resolve('/extension/bundle/setup-voice.mjs'));
  assert.equal(h.extension.voiceStatus, 'installing');
  h.spawns[0].child.emit('exit', 0, null);
  assert.equal(h.extension.voiceStatus, 'ready');
  h.extension.installVoice();
  h.spawns[1].child.stderr.emit('data', Buffer.from('npm unavailable\n'));
  h.spawns[1].child.emit('exit', 1, null);
  assert.equal(h.extension.voiceStatus, 'error');
  assert.match(h.extension.voiceError, /npm unavailable/);
});
