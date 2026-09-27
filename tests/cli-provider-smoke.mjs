import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answerWithCli, childEnvironment, inspectAiProvider, resolveAiProvider, runCommand } from '../providers.mjs';
import { cliInvocation } from '../cli-launch.mjs';
import { mkdir } from 'node:fs/promises';

const tempRoot = await mkdtemp(join(tmpdir(), 'patchwork-cli-provider-'));
const fakeCli = join(tempRoot, 'fake-ai');
await writeFile(fakeCli, `#!/usr/bin/env node
if (process.argv.includes('auth')) console.log(JSON.stringify({loggedIn:true,authMethod:process.env.TEST_API?'api_key':'claude.ai'}));
else {
 let prompt='';process.stdin.on('data',s=>prompt+=s);process.stdin.on('end',()=>{
 const args=process.argv;
 if (args[args.indexOf('--tools')+1]!=='' || !args.includes('--strict-mcp-config') || process.env.ANTHROPIC_API_KEY) process.exit(1);
 if (args.includes('--json-schema')) {
  if (Number(args[args.indexOf('--max-turns')+1])<2) { console.log(JSON.stringify({subtype:'error_max_turns',is_error:true,errors:['Reached maximum number of turns (1)']})); process.exit(1); }
  console.log(JSON.stringify({result:'',structured_output:{summary:'structured'}})); return;
 }
 console.log(JSON.stringify({result:'Claude answer: '+prompt.includes('Explain this file.')}));
 });
}
`);
await chmod(fakeCli, 0o755);
try {
 const codexScript=join(tempRoot,'node_modules','@openai','codex','bin','codex.js');
 await mkdir(join(tempRoot,'node_modules','@openai','codex','bin'),{recursive:true});
 await writeFile(codexScript,'console.log("ok")');
 const windowsShim=join(tempRoot,'codex.cmd');
 await writeFile(windowsShim,'@echo off\r\n');
 assert.deepEqual(cliInvocation(windowsShim),{command:process.execPath,prefix:[codexScript]});
 assert.equal(resolveAiProvider({PATCHWORK_AI_PROVIDER:'codex',PATCHWORK_CODEX_BIN:windowsShim}).available,true);
 assert.equal((await runCommand(windowsShim,['--version'])).ok,true);
 const env={...process.env,OPENAI_API_KEY:'must-not-bill',ANTHROPIC_API_KEY:'must-not-bill',ANTHROPIC_AUTH_TOKEN:'must-not-bill'};
 assert.equal(childEnvironment('codex',env).OPENAI_API_KEY,undefined);
 assert.equal(childEnvironment('claude',env).ANTHROPIC_API_KEY,undefined);
 assert.equal(childEnvironment('claude',env).ANTHROPIC_AUTH_TOKEN,undefined);
 assert.equal(resolveAiProvider({...env,PATCHWORK_CODEX_BIN:'/nonexistent/codex',PATCHWORK_CLAUDE_BIN:'/nonexistent/claude'}).available,false);
 const info={provider:'claude',command:fakeCli,available:true};
 const fakeSpawn=process.platform==='win32' ? (_command,args,options)=>spawn(process.execPath,[fakeCli,...args],options) : undefined;
 const answer=await answerWithCli(info,{question:'Explain this file.',file:{path:'demo.js'},source:'const x=1;'}, {env,spawn:fakeSpawn});
 assert.equal(answer.status,200);assert.equal(answer.body.text,'Claude answer: true');
 const structured=await answerWithCli(info,{prompt:'Plan this.'},{env,spawn:fakeSpawn,jsonSchema:{type:'object'}});
 assert.equal(structured.status,200);assert.deepEqual(JSON.parse(structured.body.text),{summary:'structured'});
 assert.equal((await inspectAiProvider(info,{env:{...env,TEST_API:'yes'},spawn:fakeSpawn})).available,false);
 const aborted=new AbortController();aborted.abort();
 assert.equal((await runCommand(process.execPath,['-e','setTimeout(()=>{},5000)'],{signal:aborted.signal})).reason,'aborted');
 console.log('Providers: Windows npm shim, no automatic API billing, auth gates, tool isolation, stdin prompts and cancellation passed.');
} finally { await rm(tempRoot,{recursive:true,force:true}); }
