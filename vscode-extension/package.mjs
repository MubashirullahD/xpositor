import { cpSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8'));
const outputPath = join(extensionRoot, `${manifest.name}-${manifest.version}.vsix`);
const stageRoot = mkdtempSync(join(tmpdir(), 'xpositor-vsix-'));

function copy(relativePath) {
  cpSync(join(extensionRoot, relativePath), join(stageRoot, relativePath), { recursive: true });
}

try {
  execFileSync(process.execPath, ['prepare-bundle.mjs'], { cwd: extensionRoot, stdio: 'inherit' });
  ['extension.js', 'qr.js', 'README.md', 'resources', 'bundle'].forEach(copy);

  const packageForInstall = { ...manifest };
  delete packageForInstall.scripts;
  delete packageForInstall.devDependencies;
  writeFileSync(join(stageRoot, 'package.json'), `${JSON.stringify(packageForInstall, null, 2)}\n`);
  writeFileSync(join(stageRoot, '.vscodeignore'), '.vscode/**\ntest/**\nprepare-bundle.mjs\npackage.mjs\n');

  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('Run packaging with npm run package.');
  const productionPackages = execFileSync(process.execPath, [npmCli, 'ls', '--omit=dev', '--all', '--parseable'], {
    cwd: extensionRoot,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  }).split(/\r?\n/).filter(Boolean);
  const sourceNodeModules = join(extensionRoot, 'node_modules');
  for (const packagePath of productionPackages) {
    if (!packagePath.startsWith(`${sourceNodeModules}${sep}`)) continue;
    const packageRelativePath = relative(extensionRoot, packagePath);
    if (lstatSync(packagePath).isSymbolicLink()) throw new Error(`Linked runtime dependency cannot be packaged: ${packageRelativePath}. Run npm ci in vscode-extension.`);
    cpSync(packagePath, join(stageRoot, packageRelativePath), { recursive: true });
  }

  execFileSync(process.execPath, [join(extensionRoot, 'test', 'bundle-runtime.mjs'), stageRoot], {stdio:'inherit'});

  const vsce = join(extensionRoot, 'node_modules', '@vscode', 'vsce', 'vsce');
  execFileSync(process.execPath, [
    vsce,
    'package',
    '--allow-missing-repository',
    '--skip-license',
    '--out',
    outputPath,
  ], { cwd: stageRoot, stdio: 'inherit' });
} finally {
  rmSync(stageRoot, { recursive: true, force: true });
}
