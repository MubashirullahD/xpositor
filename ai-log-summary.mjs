#!/usr/bin/env node
// Summarize a Xpositor AI session log (see XPOSITOR_AI_LOG): one line per
// provider turn and repository tool call, with timings and output sizes.
// Usage: node ai-log-summary.mjs <log.jsonl | log directory> [--prompt] [--answer]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const target = args.find(arg => !arg.startsWith('--'));
if (!target) { console.error('Usage: node ai-log-summary.mjs <log.jsonl | log directory> [--prompt] [--answer]'); process.exit(1); }
const files = statSync(target).isDirectory() ? readdirSync(target).filter(name => name.endsWith('.jsonl')).sort().map(name => join(target, name)) : [target];
const seconds = ms => `${(ms / 1000).toFixed(1).padStart(6)}s`;
const describe = input => input?.path ? `${input.path}${input.offset ? ` @${input.offset}` : ''}` : input?.query !== undefined ? JSON.stringify(input.query) : input?.changedOnly !== undefined ? `changedOnly=${input.changedOnly}` : input?.offset ? `@${input.offset}` : '';

for (const file of files) {
  const events = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  const start = events.find(event => event.type === 'start') || {};
  const end = events.find(event => event.type === 'end');
  console.log(`\n${file}\n${start.purpose} · ${start.provider} · model ${start.model || 'default'} · effort ${start.effort || 'default'} · prompt ${Buffer.byteLength(start.prompt || '')} bytes${start.repositoryTools ? ' · repository tools' : ''}`);
  if (args.includes('--prompt')) console.log(`--- prompt ---\n${start.prompt}\n--- end prompt ---`);
  const tools = new Map();
  let last = 0;
  for (const event of events) {
    const gap = event.ms - last; last = event.ms;
    if (event.type === 'tool') {
      tools.set(event.name, (tools.get(event.name) || 0) + 1);
      console.log(`${seconds(event.ms)} +${seconds(gap).trim().padStart(6)}  tool ${event.name} ${describe(event.args)}${event.ok ? ` → ${event.bytes} B${event.nextOffset !== null ? ` (more at ${event.nextOffset})` : ''}` : ` ✗ ${event.error}`}`);
    } else if (event.type === 'claude-turn') {
      const parts = event.blocks.map(block => block.type === 'tool_use' ? `call ${block.name.replace('mcp__xpositor__', '')}` : block.type === 'text' ? `text ${block.text.length} chars` : block.type === 'thinking' ? 'thinking' : block.type);
      console.log(`${seconds(event.ms)} +${seconds(gap).trim().padStart(6)}  claude ${parts.join(', ')}`);
    } else if (event.type === 'claude-tool-results') {
      for (const result of event.results.filter(result => result.isError)) console.log(`${seconds(event.ms)}          tool error: ${result.preview.slice(0, 200)}`);
    } else if (event.type === 'claude-result') {
      console.log(`${seconds(event.ms)}          claude finished: ${event.subtype}, ${event.turns} turns, ${event.usage?.output_tokens ?? '?'} output tokens`);
    }
  }
  console.log(`tool calls: ${[...tools].map(([name, count]) => `${name} ×${count}`).join(', ') || 'none'}`);
  console.log(end ? `result: ${end.status}${end.error ? ` · ${end.error}` : ''} · ${seconds(end.totalMs).trim()}` : 'result: (no end event: still running or interrupted)');
  if (args.includes('--answer') && end?.text) console.log(`--- answer ---\n${end.text}\n--- end answer ---`);
}
