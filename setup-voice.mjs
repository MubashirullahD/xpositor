// One-time local dependency/model setup. Never sends repository code anywhere.
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const root=process.env.PATCHWORK_VOICE_HOME||join(homedir(),'.patchwork','voice');
mkdirSync(root,{recursive:true,mode:0o700});
writeFileSync(join(root,'package.json'),JSON.stringify({name:'patchwork-local-voice',private:true,type:'module',dependencies:{'kokoro-js':'1.2.1'}}),{mode:0o600});
console.log('Installing local Kokoro runtime. The initial download can take a few minutes.');
execFileSync(process.platform==='win32'?'npm.cmd':'npm',['install','--omit=dev','--no-audit','--no-fund','--maxsockets=3','--fetch-timeout=120000','--fetch-retries=3'],{cwd:root,stdio:'inherit'});
const { createSpeechService }=await import('./speech-service.mjs');
const speech=createSpeechService();
try{await speech.synthesize('Your local voice is ready. Let us walk through the code together.','af_heart');console.log('Local voice ready. Refresh an open Patchwork phone page to see it.');}finally{speech.close();}
