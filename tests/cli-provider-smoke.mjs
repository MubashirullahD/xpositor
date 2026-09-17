import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { answerWithCli } from '../providers.mjs';

const appRoot = resolve(new URL('..', import.meta.url).pathname);
const tempRoot = await mkdtemp(join(tmpdir(), 'patchwork-cli-provider-'));
const fakeCli = join(tempRoot, 'fake-ai');
await writeFile(fakeCli, `#!/usr/bin/env node
const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY);
const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
if (process.argv.includes('exec')) {
  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Codex answer; keys=' + [hasOpenAiKey, hasAnthropicKey].join(',') } }));
} else {
  console.log(JSON.stringify({ result: 'Claude answer; keys=' + [hasOpenAiKey, hasAnthropicKey].join(',') }));
}
`);
await chmod(fakeCli, 0o755);

const input = {
  question: 'Explain this file.',
  history: [],
  file: { path: 'src/example.js', type: 'JS' },
  source: 'export const answer = 42;',
  code: '+ export const answer = 42;',
};
const env = {
  ...process.env,
  OPENAI_API_KEY: 'must-be-removed',
  ANTHROPIC_API_KEY: 'must-be-removed',
};

try {
  const codex = await answerWithCli({ provider: 'codex', command: fakeCli }, input, { repoRoot: appRoot, env });
  assert.equal(codex.status, 200);
  assert.equal(codex.body.text, 'Codex answer; keys=false,true');

  const claude = await answerWithCli({ provider: 'claude', command: fakeCli }, input, { repoRoot: appRoot, env });
  assert.equal(claude.status, 200);
  assert.equal(claude.body.text, 'Claude answer; keys=true,false');

  console.log(JSON.stringify({ codex: 'ok', claude: 'ok', subscriptionEnvSafe: true }));
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
