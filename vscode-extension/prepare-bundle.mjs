import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = resolve(extensionRoot, '..');
const bundleRoot = resolve(extensionRoot, 'bundle');

rmSync(bundleRoot, { recursive: true, force: true });
mkdirSync(bundleRoot, { recursive: true });
// The extension entry point is CommonJS; its companion has a separate ESM scope.
writeFileSync(resolve(bundleRoot, 'package.json'), JSON.stringify({private:true,type:'module'},null,2)+'\n');
for (const name of ['lesson-plan.mjs', 'deep-review.mjs', 'speech-service.mjs', 'speech-worker.mjs', 'setup-voice.mjs', 'companion.mjs', 'providers.mjs', 'cli-launch.mjs', 'snapshot.mjs', 'codex-server.mjs', 'ai-service.mjs', 'review-guide.mjs', 'repository-tools.mjs', 'claude-tools.mjs', 'ai-log.mjs', 'agent-plan.mjs', 'file-overviews.mjs', 'guide-runs.mjs', 'agent-guide-service.mjs', 'guide-storage.mjs', 'walkthrough-service.mjs', 'state-home.mjs']) cpSync(resolve(sourceRoot, name), resolve(bundleRoot, name));
cpSync(resolve(sourceRoot, 'index.html'), resolve(bundleRoot, 'index.html'));
cpSync(resolve(sourceRoot, 'src'), resolve(bundleRoot, 'src'), { recursive: true });
cpSync(resolve(sourceRoot, 'public'), resolve(bundleRoot, 'public'), { recursive: true });

console.log(`Xpositor extension bundle prepared at ${bundleRoot}`);
