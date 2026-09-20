import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const fixture = mkdtempSync(join(tmpdir(), 'patchwork-http-test-'));
const repo = join(fixture, 'repo');
const app = join(fixture, 'app');
mkdirSync(repo); mkdirSync(app); mkdirSync(join(app, 'src')); mkdirSync(join(app, 'public'));
for (const name of readdirSync(appRoot).filter((name) => name.endsWith('.mjs'))) cpSync(join(appRoot, name), join(app, name));
writeFileSync(join(app, 'index.html'), '<html><script type="module" src="/src/main.js"></script></html>');
writeFileSync(join(app, 'src/main.js'), 'export const safe = true;');
writeFileSync(join(app, 'src/module.js'), 'export const module = true;');
writeFileSync(join(app, '.env'), 'STATIC_SECRET');
writeFileSync(join(fixture, 'secret'), 'EXTERNAL_SECRET');
symlinkSync(join(fixture, 'secret'), join(app, 'src/leak.js'));
const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
writeFileSync(join(repo, 'unchanged.txt'), 'not part of review');
writeFileSync(join(repo, 'file name.js'), 'before\n'); git('add', '.'); git('commit', '-qm', 'Fixture');
writeFileSync(join(repo, 'file name.js'), 'CAPTURED_SOURCE\n');
writeFileSync(join(repo, 'helper.js'), 'export const helper = () => true;\n');
symlinkSync(join(fixture, 'secret'), join(repo, 'link'));
let received = '';
let providerCalls = 0;
const provider = createServer((request, response) => {
  providerCalls++;
  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => { body += chunk; });
  request.on('end', () => {
    received = body;
    const payload = JSON.parse(body);
    const prompt = payload.input?.at(-1)?.content || '';
    const structured = payload.text?.format?.name === 'patchwork_walkthrough';
    let text = 'Stub provider answer.';
    if (structured) {
      const marker = 'SNAPSHOT_CONTEXT:\n';
      const context = JSON.parse(prompt.slice(prompt.indexOf(marker) + marker.length));
      const fileId = prompt.includes('requested depth is brief') ? 'invented-file-id' : context.files[0].id;
      text = JSON.stringify({
        title: 'Captured walkthrough', summary: 'A plan grounded in the supplied immutable snapshot.', assumptions: [],
        steps: ['Intent', 'Trace', 'Verify'].map((title) => ({ title, explanation: `Review ${context.files[0].path}.`, reviewQuestion: 'What behavior should this preserve?', citations: [{ fileId, startLine: 1, endLine: 1, side: 'new' }] })),
      });
    } else if (prompt.includes('Continue the validated walkthrough')) {
      text = 'Stub walkthrough follow-up.';
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ model: 'stub-model', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }));
  });
});
let companion;
try {
  await new Promise((resolveListen) => provider.listen(0, '127.0.0.1', resolveListen));
  companion = spawn(process.execPath, [join(app, 'companion.mjs'), repo], {
    cwd: app,
    env: { ...process.env, PATCHWORK_HOST: '127.0.0.1', PATCHWORK_PORT: '0', PATCHWORK_TOKEN: 'test-pairing', PATCHWORK_TLS_KEY: '', PATCHWORK_TLS_CERT: '', PATCHWORK_AI_PROVIDER: 'api', OPENAI_API_KEY: 'stub-key', OPENAI_MODEL: 'stub-model', OPENAI_API_URL: `http://127.0.0.1:${provider.address().port}/responses` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const base = await new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => rejectReady(new Error(`Companion did not start. ${output}`)), 10000);
    const cleanup = () => clearTimeout(timeout);
    companion.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/Patchwork companion: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { cleanup(); resolveReady(match[1]); }
    });
    companion.stderr.on('data', (chunk) => { output += chunk; });
    companion.on('error', (error) => { cleanup(); rejectReady(error); });
    companion.on('exit', (code) => { cleanup(); rejectReady(new Error(`Companion exited ${code}: ${output}`)); });
  });
  const headers = { 'x-patchwork-token': 'test-pairing' };
  const get = (path) => fetch(`${base}${path}`, { headers });
  assert.equal((await fetch(`${base}/api/snapshot`)).status, 401);
  for (const path of ['/.git/config', '/.env', '/companion.mjs', '/providers.mjs', '/snapshot.mjs', '/src/leak.js', '/src/../.env', '/%2eenv']) assert.equal((await fetch(`${base}${path}`)).status, 404, path);
  for (const path of ['/', '/src/main.js', '/src/module.js']) assert.equal((await fetch(`${base}${path}`)).status, 200, path);
  const shell = await fetch(base);
  assert.match(shell.headers.get('content-security-policy'), /script-src 'self';/);
  assert.equal(shell.headers.get('x-content-type-options'), 'nosniff');
  const config = await (await get('/api/config')).json();
  assert.equal(config.aiEnabled, true); assert.equal(config.provider, 'api'); assert.equal(config.model, 'stub-model');
  const snapshotResponse = await get('/api/snapshot');
  assert.equal(snapshotResponse.status, 200);
  const snapshot = await snapshotResponse.json();
  const file = snapshot.files.find((item) => item.path === 'file name.js');
  assert.equal(file.source,'CAPTURED_SOURCE\n','snapshot eagerly carries immutable source');
  assert.ok(file?.id); assert.ok(file.version); assert.ok(snapshot.repoId); assert.ok(snapshot.head); assert.ok(snapshot.base);
  const fileUrl = `/api/file?snapshotId=${snapshot.snapshotId}&path=${encodeURIComponent(file.path)}`;
  assert.equal((await get('/api/file?path=file%20name.js')).status, 400);
  assert.equal((await get(`/api/file?snapshotId=${snapshot.snapshotId}&path=unchanged.txt`)).status, 404);
  assert.equal((await get(`/api/file?snapshotId=${snapshot.snapshotId}&path=../secret`)).status, 404);
  writeFileSync(join(repo, file.path), 'EDITED_AFTER_CAPTURE\n');
  const sourcePayload = await (await get(fileUrl)).json();
  assert.equal(sourcePayload.source, 'CAPTURED_SOURCE\n'); assert.equal(sourcePayload.version, file.version);
  const linkPayload = await (await get(`/api/file?snapshotId=${snapshot.snapshotId}&path=link`)).json();
  assert.equal(linkPayload.source, null); assert.equal(linkPayload.sourceAvailable, false);
  const ask = (body) => fetch(`${base}/api/ai`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await ask({ message: 'Explain', file })).status, 400);
  assert.equal((await ask({ snapshotId: snapshot.snapshotId, message: 'Explain', file: { id: file.id, path: 'unchanged.txt' } })).status, 404);
  assert.equal(providerCalls, 0);
  const ai = await ask({ snapshotId: snapshot.snapshotId, message: 'Explain this file.', history: [], file: { ...file, lines: [['added', '1', 'FORGED_CLIENT_DIFF']], source: 'FORGED_CLIENT_SOURCE' } });
  assert.equal(ai.status, 200); assert.equal((await ai.json()).text, 'Stub provider answer.');
  const request = JSON.parse(received);
  assert.equal(request.store, false); assert.equal(request.model, 'stub-model');
  assert.match(received, /CAPTURED_SOURCE/);
  assert.ok(!received.includes('EDITED_AFTER_CAPTURE')); assert.ok(!received.includes('FORGED_CLIENT')); assert.ok(!received.includes('EXTERNAL_SECRET'));
  const helper = snapshot.files.find((item) => item.path === 'helper.js');
  assert.ok(helper?.id);
  const post = (path, body, extraHeaders = {}) => fetch(`${base}${path}`, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json', ...extraHeaders }, body: JSON.stringify(body),
  });
  const walkthroughInput = { snapshotId: snapshot.snapshotId, selectedId: file.id, fileIds: [helper.id], depth: 'deep', timeMinutes: 15 };
  assert.equal((await post('/api/walkthrough', walkthroughInput, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await fetch(`${base}/api/walkthrough`, { method: 'POST', headers: { ...headers, 'content-type': 'text/plain' }, body: JSON.stringify(walkthroughInput) })).status, 415);
  const walkthroughResponse = await post('/api/walkthrough', walkthroughInput);
  assert.equal(walkthroughResponse.status, 200);
  const walkthrough = await walkthroughResponse.json();
  assert.equal(walkthrough.snapshotId, snapshot.snapshotId);
  assert.equal(walkthrough.selectedId, file.id);
  assert.deepEqual(walkthrough.scope.includedPaths, [file.path, helper.path]);
  assert.equal(walkthrough.guide.steps.length, 3);
  assert.deepEqual(walkthrough.guide.steps[0].citations[0], { fileId: file.id, startLine: 1, endLine: 1, side: 'new' });
  const walkthroughProviderRequest = JSON.parse(received);
  assert.equal(walkthroughProviderRequest.text.format.name, 'patchwork_walkthrough');
  assert.match(walkthroughProviderRequest.input.at(-1).content, /CAPTURED_SOURCE/);
  assert.ok(!walkthroughProviderRequest.input.at(-1).content.includes('EDITED_AFTER_CAPTURE'));
  assert.ok(!walkthroughProviderRequest.input.at(-1).content.includes('EXTERNAL_SECRET'));
  const invalidGuide = await post('/api/walkthrough', { ...walkthroughInput, depth: 'brief' });
  assert.equal(invalidGuide.status, 502);
  assert.equal((await invalidGuide.json()).code, 'GUIDE_INVALID_RESPONSE');
  const followupInput = {
    snapshotId: snapshot.snapshotId, selectedId: file.id, fileIds: [helper.id], guide: walkthrough.guide,
    stepIndex: 0, question: 'Explain this more slowly with an example.', history: [{ role: 'user', text: 'What changed?' }],
  };
  const followup = await post('/api/walkthrough/followup', followupInput);
  assert.equal(followup.status, 200);
  assert.equal((await followup.json()).text, 'Stub walkthrough follow-up.');
  const stream = await post('/api/walkthrough/followup/stream', followupInput);
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get('content-type'), /^application\/x-ndjson/);
  const events = (await stream.text()).trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(events.map((event) => event.type), ['delta', 'done']);
  assert.equal(events[0].text, 'Stub walkthrough follow-up.');
  assert.equal(events[1].text, 'Stub walkthrough follow-up.');
  const next = await (await get('/api/snapshot')).json();
  assert.notEqual(next.files.find((item) => item.id === file.id).version, file.version);
  assert.equal((await (await get(fileUrl)).json()).source, 'CAPTURED_SOURCE\n');
  const contextUrl = `/api/guide/source?snapshotId=${snapshot.snapshotId}&path=unchanged.txt`;
  assert.equal((await (await get(contextUrl)).json()).source, 'not part of review');
  assert.equal((await get(`/api/guide/source?snapshotId=${snapshot.snapshotId}&path=../secret`)).status, 404);
  assert.equal((await (await get(`/api/guide/source?snapshotId=${snapshot.snapshotId}&path=link`)).json()).source, null);
  assert.equal((await get('/api/guide/run?id=unknown')).status, 404);
  const beforeRepositoryCalls = providerCalls;
  const repositoryRequest = {requestId:'http-guide-request-001',snapshotId:snapshot.snapshotId,selectedPath:file.path};
  const started = await post('/api/guide/start', repositoryRequest);
  assert.equal(started.status, 202);
  let guideRun;
  for(let attempt=0;attempt<30;attempt++) {
    guideRun = (await (await get('/api/guide/run?id=http-guide-request-001')).json()).run;
    if(guideRun.status !== 'running')break;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal(guideRun.status,'failed');
  assert.match(guideRun.error,/requires Codex/);
  assert.equal(providerCalls,beforeRepositoryCalls,'Repository mode must not fall back to API billing');
  assert.equal((await post('/api/guide/start',repositoryRequest)).status,202);
  assert.equal((await post('/api/guide/start',{...repositoryRequest,selectedPath:helper.path})).status,409);
  const conversation=(await (await get('/api/guide/conversation?id=http-guide-request-001')).json()).conversation;
  assert(!('threadId' in conversation));
  console.log('Companion smoke passed: portable fixtures, immutable source, authoritative AI, walkthrough HTTP/streaming, pairing, static allowlist, CSP, symlinks.');
} finally {
  if (companion && companion.exitCode === null) { const exited = once(companion, 'exit'); companion.kill('SIGTERM'); await exited; }
  if (provider.listening) await new Promise((resolveClose) => provider.close(resolveClose));
  rmSync(fixture, { recursive: true, force: true });
}
