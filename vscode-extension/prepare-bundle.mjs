import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = resolve(extensionRoot, '..');
const bundleRoot = resolve(extensionRoot, 'bundle');

rmSync(bundleRoot, { recursive: true, force: true });
mkdirSync(bundleRoot, { recursive: true });
cpSync(resolve(sourceRoot, 'companion.mjs'), resolve(bundleRoot, 'companion.mjs'));
cpSync(resolve(sourceRoot, 'providers.mjs'), resolve(bundleRoot, 'providers.mjs'));
cpSync(resolve(sourceRoot, 'index.html'), resolve(bundleRoot, 'index.html'));
cpSync(resolve(sourceRoot, 'src'), resolve(bundleRoot, 'src'), { recursive: true });
cpSync(resolve(sourceRoot, 'public'), resolve(bundleRoot, 'public'), { recursive: true });

console.log(`Patchwork extension bundle prepared at ${bundleRoot}`);
