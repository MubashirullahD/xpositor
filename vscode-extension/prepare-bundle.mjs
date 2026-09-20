import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = resolve(extensionRoot, '..');
const bundleRoot = resolve(extensionRoot, 'bundle');

rmSync(bundleRoot, { recursive: true, force: true });
mkdirSync(bundleRoot, { recursive: true });
for (const name of ['companion.mjs', 'providers.mjs', 'snapshot.mjs', 'codex-server.mjs', 'ai-service.mjs', 'review-guide.mjs', 'repository-tools.mjs', 'agent-plan.mjs', 'guide-runs.mjs', 'agent-guide-service.mjs', 'walkthrough-service.mjs']) cpSync(resolve(sourceRoot, name), resolve(bundleRoot, name));
cpSync(resolve(sourceRoot, 'index.html'), resolve(bundleRoot, 'index.html'));
cpSync(resolve(sourceRoot, 'src'), resolve(bundleRoot, 'src'), { recursive: true });
cpSync(resolve(sourceRoot, 'public'), resolve(bundleRoot, 'public'), { recursive: true });

console.log(`Patchwork extension bundle prepared at ${bundleRoot}`);
