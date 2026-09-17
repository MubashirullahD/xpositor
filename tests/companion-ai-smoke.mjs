import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';

const appRoot = resolve(new URL('..', import.meta.url).pathname);
let received = '';
const provider = createServer((request, response) => {
  request.setEncoding('utf8');
  request.on('data', (chunk) => { received += chunk; });
  request.on('end', () => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ model: 'stub-model', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Stub provider answer.' }] }] }));
  });
});
await new Promise((resolveListen) => provider.listen(0, '127.0.0.1', resolveListen));
const providerPort = provider.address().port;
const companionPort = 4330;
const companion = spawn(process.execPath, ['companion.mjs', '/Users/mubashir/Documents/Repository/map-of-experience'], {
  cwd: appRoot,
  env: { ...process.env, PATCHWORK_PORT: String(companionPort), OPENAI_API_KEY: 'stub-key', OPENAI_MODEL: 'stub-model', OPENAI_API_URL: `http://127.0.0.1:${providerPort}/responses` },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
companion.stdout.on('data', (chunk) => { output += chunk; });
await new Promise((resolveReady, rejectReady) => {
  const timeout = setTimeout(() => rejectReady(new Error(`Companion did not start. ${output}`)), 5000);
  companion.stdout.on('data', () => {
    if (output.includes('Patchwork companion:')) { clearTimeout(timeout); resolveReady(); }
  });
  companion.on('error', rejectReady);
});

try {
  const config = await fetch(`http://127.0.0.1:${companionPort}/api/config`);
  assert.deepEqual(await config.json(), { aiEnabled: true, model: 'stub-model' });
  const ai = await fetch(`http://127.0.0.1:${companionPort}/api/ai`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'Explain this file.', history: [], file: { path: '.env.example', type: 'ENV', lines: [['added', '1', 'DATABASE_URL=']] } }),
  });
  assert.equal(ai.status, 200);
  assert.deepEqual(await ai.json(), { text: 'Stub provider answer.', model: 'stub-model' });
  const request = JSON.parse(received);
  assert.equal(request.store, false);
  assert.equal(request.model, 'stub-model');
  assert.match(JSON.stringify(request), /DATABASE_URL/);
  assert.match(JSON.stringify(request), /Current file contents/);
  console.log(JSON.stringify({ aiRoute: 'ok', forwardedCurrentFile: true, store: request.store }));
} finally {
  companion.kill('SIGTERM');
  await once(companion, 'exit');
  await new Promise((resolveClose) => provider.close(resolveClose));
}
