import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answerWithCli, childEnvironment, inspectAiProvider, listProviderModels, resolveAiProvider, runCommand } from '../providers.mjs';
import { REPOSITORY_TOOLS } from '../repository-tools.mjs';
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
 const flag=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
 if (flag('--permission-mode')!=='dontAsk') process.exit(1);
 if (prompt.includes('Use a tool.')) {
  // Exercise the loopback MCP endpoint the way Claude Code would.
  const server=JSON.parse(flag('--mcp-config')).mcpServers.patchwork;
  if (!flag('--allowedTools').split(',').includes('mcp__patchwork__review_read') || flag('--max-turns')!=='100') process.exit(1);
  const call=body=>fetch(server.url,{method:'POST',headers:{...server.headers,'content-type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
  (async()=>{
   const denied=await fetch(server.url,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
   const listed=await call({jsonrpc:'2.0',id:1,method:'tools/list'});
   const read=await call({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'review_read',arguments:{path:'x.js'}}});
   const bad=await call({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'shell',arguments:{}}});
   console.log(JSON.stringify({type:'result',subtype:'success',result:[denied.status,listed.result.tools.length,read.result.content[0].text,bad.result.isError].join('|')}));
  })();
  return;
 }
 if (flag('--max-turns')!=='4') process.exit(1);
 if (prompt.includes('Take too long.')) { setTimeout(()=>{},60_000); return; }
 if (prompt.includes('Stream please.')) {
  if (flag('--output-format')!=='stream-json' || !args.includes('--include-partial-messages')) process.exit(1);
  for (const text of ['Hello ','**world**']) console.log(JSON.stringify({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text}}}));
  console.log(JSON.stringify({type:'result',subtype:'success',result:'Hello **world**'})); return;
 }
 if (prompt.includes('Pick a model.')) { console.log(JSON.stringify({type:'result',subtype:'success',result:[flag('--model'),flag('--effort')].join('|')})); return; }
 if (args.includes('--json-schema')) {
  if (Number(flag('--max-turns'))<2) { console.log(JSON.stringify({type:'result',subtype:'error_max_turns',is_error:true,errors:['Reached maximum number of turns (1)']})); process.exit(1); }
  for (const content_block of [{type:'thinking'},{type:'tool_use',name:'StructuredOutput'}]) console.log(JSON.stringify({type:'stream_event',event:{type:'content_block_start',content_block}}));
  console.log(JSON.stringify({type:'assistant',message:{content:[{type:'thinking',thinking:'plan'},{type:'tool_use',name:'StructuredOutput',input:{summary:'structured'}}],usage:{output_tokens:9}}}));
  console.log(JSON.stringify({type:'result',subtype:'success',num_turns:2,result:'',structured_output:{summary:'structured'}})); return;
 }
 console.log(JSON.stringify({type:'result',subtype:'success',result:'Claude answer: '+prompt.includes('Explain this file.')}));
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
 const labels=[],logged=[];
 const structured=await answerWithCli(info,{prompt:'Plan this.'},{env,spawn:fakeSpawn,jsonSchema:{type:'object'},onActivity:value=>labels.push(value.tool),log:{event:(type,data)=>logged.push({type,...data})}});
 assert.deepEqual(labels,['Thinking','Writing the answer'],'Claude reports thinking and writing instead of the last file read.');
 assert.deepEqual(logged.map(event=>event.type),['claude-command','claude-turn','claude-result']);
 assert.equal(logged[0].input,'Plan this.');assert(!logged[0].args.includes('{"type":"object"}'),'Bulky schema/config arguments are left out of the log.');
 assert.deepEqual(logged[1].blocks,[{type:'thinking',chars:4},{type:'tool_use',name:'StructuredOutput',input:{summary:'structured'}}]);
 assert.equal(structured.status,200);assert.deepEqual(JSON.parse(structured.body.text),{summary:'structured'});
 assert.equal((await answerWithCli(info,{prompt:'Pick a model.'},{env,spawn:fakeSpawn,model:'opus',effort:'high'})).body.text,'opus|high');
 assert.deepEqual((await listProviderModels(info)).models.map(model=>model.id),['opus','sonnet','haiku']);
 const deltas=[];
 const streamedAnswer=await answerWithCli(info,{prompt:'Stream please.'},{env,spawn:fakeSpawn,onDelta:text=>deltas.push(text)});
 assert.equal(streamedAnswer.body.text,'Hello **world**');assert.deepEqual(deltas,['Hello ','**world**'],'Claude text must stream once, not repeat at the end.');
 const slow=await answerWithCli(info,{prompt:'Take too long.'},{env,spawn:fakeSpawn,turnTimeoutMs:1500});
 assert.equal(slow.status,504);assert.match(slow.body.error,/did not finish within 1 minutes/);
 const activity=[];
 const tools={definitions:REPOSITORY_TOOLS,call(name,args){if(name!=='review_read')throw new Error('Only repository tools are available.');return {path:args.path,text:'captured'};}};
 const toolAnswer=await answerWithCli(info,{prompt:'Use a tool.'},{env,spawn:fakeSpawn,repositoryTools:tools,onActivity:value=>activity.push(value)});
 assert.equal(toolAnswer.body.text,'401|4|{"path":"x.js","text":"captured"}|true');
 assert.deepEqual(activity,[{tool:'review_read',path:'x.js'}]);
 assert.equal((await inspectAiProvider(info,{env:{...env,TEST_API:'yes'},spawn:fakeSpawn})).available,false);
 const aborted=new AbortController();aborted.abort();
 assert.equal((await runCommand(process.execPath,['-e','setTimeout(()=>{},5000)'],{signal:aborted.signal})).reason,'aborted');
 console.log('Providers: Windows npm shim, no automatic API billing, auth gates, tool isolation, Claude models and loopback repository tools, stdin prompts and cancellation passed.');
} finally { await rm(tempRoot,{recursive:true,force:true}); }
