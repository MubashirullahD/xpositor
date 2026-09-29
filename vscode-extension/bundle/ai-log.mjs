import { appendFileSync, mkdirSync } from 'node:fs';
import { stateHome } from './state-home.mjs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

// Development-only record of each AI request: prompt, repository tool calls,
// provider turns and the final answer. Off unless XPOSITOR_AI_LOG is set.
// Logs contain captured code and questions, so files are private to the user.
export function aiLogEnabled(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String(env.XPOSITOR_AI_LOG || '').trim());
}

export function aiLogDirectory(env = process.env) {
  return env.XPOSITOR_AI_LOG_DIR || join(stateHome(), 'ai-logs');
}

const slug = value => String(value || 'request').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'request';

export function startAiLog(meta, env = process.env) {
  if (!aiLogEnabled(env)) return null;
  const started = Date.now();
  const stamp = new Date(started).toISOString();
  const folder = join(aiLogDirectory(env), stamp.slice(0, 10));
  const file = join(folder, `${stamp.slice(11, 19).replace(/:/g, '')}-${slug(meta.purpose)}-${randomBytes(3).toString('hex')}.jsonl`);
  let broken = false;
  function write(type, data) {
    if (broken) return;
    try {
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ms: Date.now() - started, type, ...data }) + '\n', { mode: 0o600 });
    } catch (error) {
      broken = true;
      console.warn(`Xpositor AI log disabled for this request: ${error.message}`);
    }
  }
  write('start', meta);
  return { file, event: write, end: data => write('end', { ...data, totalMs: Date.now() - started }) };
}

// Wrap repository tools so every provider's retrieval is recorded the same way.
export function loggedTools(tools, log) {
  if (!tools || !log) return tools;
  return {
    ...tools,
    call(name, args) {
      const began = Date.now();
      try {
        const value = tools.call(name, args);
        const text = JSON.stringify(value);
        log.event('tool', { name, args, ok: true, bytes: Buffer.byteLength(text), nextOffset: value?.nextOffset ?? null, toolMs: Date.now() - began });
        return value;
      } catch (error) {
        log.event('tool', { name, args, ok: false, error: error.message, toolMs: Date.now() - began });
        throw error;
      }
    },
  };
}
