import { existsSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

// npm's Windows launchers are .cmd files. Node cannot spawn those with
// shell:false, and using a shell would let prompt/schema arguments be parsed.
export function cliInvocation(command) {
  if (!/\.cmd$/i.test(command)) return { command, prefix: [] };
  const name = basename(command, extname(command)).toLowerCase();
  const script = name === 'codex' ? join(dirname(command), 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
    : name === 'claude' ? join(dirname(command), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js') : '';
  if (!script || !existsSync(script)) throw new Error(`Cannot launch ${command} directly. Install the CLI with npm or configure its native executable.`);
  return { command: process.execPath, prefix: [script] };
}
