import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8'));
const outputPath = join(extensionRoot, `${manifest.name}-${manifest.version}.vsix`);
const stageRoot = mkdtempSync(join(tmpdir(), 'xpositor-vsix-'));

function copy(relativePath) {
  cpSync(join(extensionRoot, relativePath), join(stageRoot, relativePath), { recursive: true });
}

// Bundled npm packages lose their own license files, so collect them into one notice.
function thirdPartyNotices(inputs) {
  const packageDirs = new Set(Object.keys(inputs).flatMap((input) => {
    const match = input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
    return match ? [match[1]] : [];
  }));
  return [...packageDirs].sort().map((dir) => {
    const root = join(extensionRoot, dir);
    const { name, version, license } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const licenseFile = readdirSync(root).find((file) => /^licen[cs]e/i.test(file));
    if (!licenseFile) throw new Error(`Bundled package ${name} has no license file.`);
    return `${name} ${version} (${license})\n\n${readFileSync(join(root, licenseFile), 'utf8').trim()}\n`;
  }).join('\n' + '-'.repeat(72) + '\n\n');
}

try {
  execFileSync(process.execPath, ['prepare-bundle.mjs'], { cwd: extensionRoot, stdio: 'inherit' });
  ['README.md', 'CHANGELOG.md', 'resources', 'bundle'].forEach(copy);
  // One readable file instead of qrcode's dependency tree; left unminified so users can audit it.
  const { metafile } = await build({
    entryPoints: [join(extensionRoot, 'extension.js')],
    outfile: join(stageRoot, 'extension.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode'],
    metafile: true,
    logLevel: 'warning',
  });
  writeFileSync(join(stageRoot, 'ThirdPartyNotices.txt'), thirdPartyNotices(metafile.inputs));
  ['LICENSE', 'NOTICE'].forEach((name) => cpSync(join(extensionRoot, '..', name), join(stageRoot, name)));

  const packageForInstall = { ...manifest };
  delete packageForInstall.scripts;
  delete packageForInstall.devDependencies;
  delete packageForInstall.dependencies;
  writeFileSync(join(stageRoot, 'package.json'), `${JSON.stringify(packageForInstall, null, 2)}\n`);
  writeFileSync(join(stageRoot, '.vscodeignore'), '.vscode/**\ntest/**\nprepare-bundle.mjs\npackage.mjs\n');

  execFileSync(process.execPath, [join(extensionRoot, 'test', 'bundle-runtime.mjs'), stageRoot], {stdio:'inherit'});

  const vsce = join(extensionRoot, 'node_modules', '@vscode', 'vsce', 'vsce');
  execFileSync(process.execPath, [
    vsce,
    'package',
    '--no-dependencies',
    '--out',
    outputPath,
  ], { cwd: stageRoot, stdio: 'inherit' });
} finally {
  rmSync(stageRoot, { recursive: true, force: true });
}
