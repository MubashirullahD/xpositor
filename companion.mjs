import { createSpeechService } from './speech-service.mjs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { randomBytes } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir, networkInterfaces } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeProviders } from './providers.mjs';
import { createAiService } from './ai-service.mjs';
import { createGuideStorage } from './guide-storage.mjs';
import { createAgentGuideService } from './agent-guide-service.mjs';
import { GuideError } from './review-guide.mjs';
import { createWalkthroughService } from './walkthrough-service.mjs';
import { createSnapshotStore, SnapshotError } from './snapshot.mjs';

const appRoot = resolve(fileURLToPath(new URL('.', import.meta.url)));
const repoRoot = resolve(process.argv[2] || process.env.PATCHWORK_REPO || process.cwd());
const host = process.env.PATCHWORK_HOST || '127.0.0.1';
const port = Number(process.env.PATCHWORK_PORT || 4321);
const tlsKeyPath = process.env.PATCHWORK_TLS_KEY || '';
const tlsCertPath = process.env.PATCHWORK_TLS_CERT || '';
if (Boolean(tlsKeyPath) !== Boolean(tlsCertPath)) throw new Error('PATCHWORK_TLS_KEY and PATCHWORK_TLS_CERT must be provided together.');
const secureTransport = Boolean(tlsKeyPath && tlsCertPath);
const accessToken = process.env.PATCHWORK_TOKEN || (host === '127.0.0.1' || host === 'localhost' ? '' : randomBytes(18).toString('hex'));

let guideStorage;
const snapshots = createSnapshotStore(repoRoot,{loadSnapshot:id=>guideStorage?.loadSnapshot(id)});
guideStorage=createGuideStorage(process.env.PATCHWORK_STATE_DIR||join(homedir(),'.patchwork','reviews'),snapshots.repoId);
const ai = createAiService(snapshots);
const walkthrough = createWalkthroughService(snapshots, ai);
const speech=createSpeechService();
const agentGuide = createAgentGuideService(snapshots, ai, {storage:guideStorage});

function readBody(request, limit = 256 * 1024) {
  return new Promise((resolveBody, rejectBody) => {
    let body = '', bytes = 0, tooLarge = false;
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      if (tooLarge) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > limit) {
        tooLarge = true; body = ''; rejectBody(new SnapshotError('Request too large.', 413, 'REQUEST_LIMIT'));
      } else body += chunk;
    });
    request.on('end', () => resolveBody(body));
    request.on('error', rejectBody);
  });
}

function isAuthorized(request) {
  return !accessToken || request.headers['x-patchwork-token'] === accessToken;
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

function lanAddresses() {
  return Object.values(networkInterfaces()).flatMap((entries) => (entries || [])
    .filter((entry) => !entry.internal && (entry.family === 'IPv4' || entry.family === 4))
    .map((entry) => entry.address));
}

function contentType(path) {
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.webmanifest')) return 'application/manifest+json';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  return 'text/html; charset=utf-8';
}

const assetFiles = new Map([
  ['/', 'index.html'], ['/index.html', 'index.html'], ['/src/styles.css', 'src/styles.css'],
  ['/sw.js', 'public/sw.js'], ['/manifest.webmanifest', 'public/manifest.webmanifest'], ['/icon.svg', 'public/icon.svg'],
]);
function staticPath(urlPath) {
  const requested = assetFiles.get(urlPath) || (/^\/src\/[a-zA-Z0-9_-]+\.js$/.test(urlPath) ? urlPath.slice(1) : null);
  if (!requested) return null;
  const candidate = resolve(appRoot, requested);
  try {
    let cursor = appRoot;
    for (const part of requested.split('/')) { cursor = resolve(cursor, part); if (lstatSync(cursor).isSymbolicLink()) return null; }
    const real = realpathSync(candidate);
    const rel = relative(appRoot, real);
    if (rel === '..' || rel.startsWith(`..${sep}`) || !statSync(real).isFile()) return null;
    return real;
  } catch { return null; }
}

const handleRequest = async (request, response) => {
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  try {
    const url = new URL(request.url || '/', 'http://localhost');
    if (url.pathname.startsWith('/api/') && !accessToken && !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(request.headers.host || '')) return sendJson(response, 403, { error: 'Local API access requires a loopback hostname.' });
    if (url.pathname.startsWith('/api/') && request.headers.origin) {
      let originHost;
      try { originHost = new URL(request.headers.origin).host; } catch {}
      if (originHost !== request.headers.host) return sendJson(response, 403, { error: 'Cross-origin API access is not allowed.' });
    }
    if (url.pathname.startsWith('/api/') && request.method === 'POST' && !/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) return sendJson(response, 415, { error: 'Send application/json.' });
    if (url.pathname.startsWith('/api/') && !isAuthorized(request)) return sendJson(response, 401, { error: 'Pairing required.' });
    if (url.pathname === '/api/snapshot' && request.method === 'GET') {
      const snapshot=snapshots.capture(url.searchParams.get('scope')||'all', { reuse: true });
      return sendJson(response, 200, {...snapshot,files:snapshot.files.map((file)=>({...file,source:snapshots.getFile(snapshot.snapshotId,{id:file.id}).source}))});
    }
    if (url.pathname === '/api/file' && request.method === 'GET') {
      const requestedPath = url.searchParams.get('path');
      if (!requestedPath) throw new SnapshotError('An exact file path is required.', 400, 'FILE_REQUIRED');
      const snapshotId = url.searchParams.get('snapshotId');
      const { file, source } = snapshots.getFile(snapshotId, { path: requestedPath });
      return sendJson(response, 200, { snapshotId, id: file.id, path: file.path, version: file.version, source, sourceAvailable: file.sourceAvailable, sourceReason: file.sourceReason });
    }
    if(url.pathname==='/api/guide/voice'&&request.method==='GET')return sendJson(response,200,speech.status());
    if(url.pathname==='/api/guide/speech'&&request.method==='POST'){
      const input=JSON.parse(await readBody(request,4096));
      if(!input||typeof input!=='object'||Array.isArray(input))throw new GuideError('Invalid audio request.',400,'VOICE_INPUT');
      const record=agentGuide.conversation(input.conversationId);
      if(!Number.isSafeInteger(input.step)||!Number.isSafeInteger(input.segment))throw new GuideError('Choose a lesson segment.',400,'VOICE_SEGMENT');
      const segment=record.lessons?.[input.step]?.segments[input.segment];
      if(!segment)throw new GuideError('This lesson segment is unavailable.',404,'VOICE_SEGMENT');
      const audio=await speech.synthesize(segment.narration,input.voice);
      response.writeHead(200,{'content-type':'audio/wav','cache-control':'no-store'});response.end(audio);return;
    }
    if (url.pathname === '/api/guide/run'  && request.method === 'GET') return sendJson(response, 200, { run: agentGuide.runs.get(url.searchParams.get('id'), url.searchParams.has('after') ? Number(url.searchParams.get('after')) : undefined) });
    if (url.pathname === '/api/guide/conversation' && request.method === 'GET') return sendJson(response, 200, { conversation: agentGuide.conversation(url.searchParams.get('id')) });
    if (url.pathname === '/api/guide/conversations' && request.method === 'GET') return sendJson(response, 200, { conversations: agentGuide.list(url.searchParams.get('snapshotId')) });
    if (url.pathname === '/api/guide/source' && request.method === 'GET') {
      const repository = snapshots.getRepository(url.searchParams.get('snapshotId'));
      return sendJson(response, 200, { path: url.searchParams.get('path'), ...repository.read(url.searchParams.get('path')) });
    }
    if (['/api/guide/lesson', '/api/guide/start', '/api/guide/question', '/api/guide/stop', '/api/guide/step'].includes(url.pathname) && request.method === 'POST') {
      let input;
      try { input = JSON.parse(await readBody(request, 64 * 1024)); } catch (error) { if (error instanceof SnapshotError) throw error; throw new SnapshotError('Invalid guide JSON.', 400, 'GUIDE_INPUT'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SnapshotError('Invalid guide request.', 400, 'GUIDE_INPUT');
      if (url.pathname === '/api/guide/stop') return sendJson(response, 200, { run: agentGuide.runs.cancel(input.requestId) });
      if (url.pathname === '/api/guide/step') return sendJson(response, 200, { conversation: agentGuide.selectStep(input.conversationId, input.step) });
      const run = url.pathname === '/api/guide/start' ? agentGuide.start(input) : url.pathname==='/api/guide/lesson'?agentGuide.lesson(input):agentGuide.question(input);
      return sendJson(response, 202, { run });
    }
    if (url.pathname === '/api/models' && request.method === 'GET') return sendJson(response,200,await ai.models(url.searchParams.get('refresh')==='true'));
    if (url.pathname === '/api/config' && request.method === 'GET') return sendJson(response, 200, await ai.status(url.searchParams.get('refresh') === 'true'));
    if (['/api/ai', '/api/ai/stream', '/api/walkthrough', '/api/walkthrough/followup', '/api/walkthrough/followup/stream'].includes(url.pathname) && request.method === 'POST') {
      let input;
      try { input = JSON.parse(await readBody(request)); } catch (error) { if(error instanceof SnapshotError) throw error; throw new SnapshotError(error.message || 'Invalid request.', 400, 'INVALID_REQUEST'); }
      const controller = new AbortController();
      response.on('close', () => { if (!response.writableEnded) controller.abort(); });
      const stream = url.pathname.endsWith('/stream');
      const emit = (event) => { if (!response.destroyed && !response.writableEnded) response.write(JSON.stringify(event) + '\n'); };
      if (stream) {
        response.writeHead(200, {'content-type':'application/x-ndjson; charset=utf-8','cache-control':'no-store','x-accel-buffering':'no'});
        response.flushHeaders();
      }
      try {
        const action = url.pathname === '/api/walkthrough' ? walkthrough.create : url.pathname.startsWith('/api/walkthrough/') ? walkthrough.followup : ai.answer;
        const result = await action(input, { signal:controller.signal, onDelta: stream ? (text) => emit({type:'delta',text}) : undefined });
        if (!stream) return sendJson(response, result.status, result.body);
        emit({type:result.status===200?'done':'error',...result.body}); response.end(); return;
      } catch (error) {
        if (!stream) throw error;
        emit({type:'error',error:error.message}); response.end(); return;
      }
    }
    if (url.pathname.startsWith('/api/')) return sendJson(response, 404, { error: 'Unknown API route or method.' });
    const path = (request.method === 'GET' || request.method === 'HEAD') && staticPath(url.pathname);
    if (!path) { response.writeHead(404); response.end('Not found'); return; }
    response.writeHead(200, { 'content-type': contentType(path), 'cache-control': 'no-cache' });
    response.end(request.method === 'HEAD' ? undefined : readFileSync(path));
  } catch (error) {
    sendJson(response, error instanceof SnapshotError || error instanceof GuideError ? error.status : 500, { error: error instanceof Error ? error.message : 'Request failed.', code: error.code || 'REQUEST_FAILED' });
  }
};

const server = secureTransport
  ? createHttpsServer({ key: readFileSync(tlsKeyPath), cert: readFileSync(tlsCertPath) }, handleRequest)
  : createHttpServer(handleRequest);

const protocol = secureTransport ? 'https' : 'http';

server.listen(port, host, () => {
  const activePort = server.address()?.port || port;
  console.log(`Patchwork companion: ${protocol}://${host}:${activePort}`);
  console.log(`Reading git changes from: ${repoRoot}`);
  console.log('Read-only mode: the companion never stages, edits, or commits files.');
  if (secureTransport) console.log('Secure transport: HTTPS is enabled for service-worker installation and LAN review.');
  if (accessToken) {
    console.log(`Pairing token: ${accessToken}`);
    const addresses = lanAddresses();
    if (addresses.length) {
      console.log('Open one of these on the phone:');
      addresses.forEach((address) => console.log(`  ${protocol}://${address}:${activePort}/?token=${encodeURIComponent(accessToken)}`));
    }
  }
});

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  server.close();
  speech.close();
  agentGuide.close();
  await closeProviders();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
