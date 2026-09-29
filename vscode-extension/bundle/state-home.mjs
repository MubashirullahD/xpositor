import { existsSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Private state lives in ~/.xpositor. Installs from before the rename kept it in
// ~/.patchwork, so move that directory the first time it is needed.
export function stateHome(home = homedir()) {
  const dir = join(home, '.xpositor'), legacy = join(home, '.patchwork');
  if (!existsSync(dir) && existsSync(legacy)) try { renameSync(legacy, dir); } catch {}
  return dir;
}
