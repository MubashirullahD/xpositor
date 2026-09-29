import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexReviewClient } from '../codex-server.mjs';
const root = await mkdtemp(join(tmpdir(), 'xpositor-retrieval-rpc-'));
const binary = join(root, 'codex');
await writeFile(binary, `#!/usr/bin/env node
const output = value => process.stdout.write(JSON.stringify(value)+'\\n');
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
 const m=JSON.parse(line), p=m.params||{};
 const reply = result => output({id:m.id,result});
 if(m.method==='initialize') { if(!p.capabilities.experimentalApi) process.exit(1); reply({}); }
 else if(m.method==='config/read') reply({config:{}});
 else if(m.method==='account/read') reply({account:{type:'chatgpt',planType:'plus'}});
 else if(m.method==='account/rateLimits/read') reply({});
 else if(m.method==='thread/start') {
  if(p.dynamicTools?.[0]?.name!=='review_read'||p.config.features.shell_tool!==false||p.config.features.code_mode_host!==true||!process.argv.includes('features.code_mode_host=true')) process.exit(2);
  reply({thread:{id:'thread'}});
 } else if(m.method==='turn/start') {
  output({id:'read',method:'item/tool/call',params:{threadId:'thread',turnId:'turn',tool:'review_read',arguments:{path:'caller.js'}}});
  output({id:'stale',method:'item/tool/call',params:{threadId:'thread',turnId:'old',tool:'review_read',arguments:{path:'private'}}});
  output({id:'write',method:'item/tool/call',params:{threadId:'thread',turnId:'turn',tool:'exec',arguments:{command:'touch evil'}}});
  reply({turn:{id:'turn'}});
 } else if(m.id==='stale' && !m.error) process.exit(3);
 else if(m.id==='write') {
  if(m.result?.success!==false) process.exit(4);
  output({method:'item/agentMessage/delta',params:{threadId:'thread',turnId:'turn',delta:'Found unchanged caller.'}});
  output({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}});
 } else if(m.method&&m.id!==undefined) reply({});
});
`);
await chmod(binary, 0o755);
const fakeSpawn = process.platform === 'win32'
  ? (_command, args, options) => spawn(process.execPath, [binary, ...args], options)
  : undefined;
const client = new CodexReviewClient(binary, { timeoutMs: 2000, repositoryMode: true, spawn: fakeSpawn });
const calls = [], activity = [];
try {
 const text = await client.answer('Explore', { repositoryTools: {
  definitions: [{name:'review_read'}],
  call(name,args) { if(name!=='review_read') throw new Error('Denied'); calls.push(args.path); return 'captured caller'; },
 }, onActivity: value => activity.push(value) });
 assert.equal(text, 'Found unchanged caller.'); assert.deepEqual(calls, ['caller.js']);
 assert.equal(activity[0].path, 'caller.js');
 console.log('Codex retrieval RPC passed: dynamic tools, early events, stale turn denial, forbidden tools and activity.');
} finally { await client.close(); await rm(root,{recursive:true,force:true}); }
