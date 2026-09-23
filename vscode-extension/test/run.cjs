const { spawnSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const { join } = require('node:path');

const tests = readdirSync(__dirname)
  .filter((name) => name.endsWith('.test.cjs'))
  .map((name) => join(__dirname, name));

function run(args) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!tests.length) {
  throw new Error('No extension test files were found.');
}

run(['--test', ...tests]);
run([join(__dirname, 'qr-smoke.cjs')]);
