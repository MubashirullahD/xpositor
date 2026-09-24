async page => {
 const base=page.url();
 const testContext=await page.context().browser().newContext({serviceWorkers:'block'});
 page=await testContext.newPage();
 const snapshot={repoId:'deep-browser',snapshotId:'deep-browser-snapshot',scope:'unstaged',base:'head',head:'head',branch:'main',generatedAt:new Date().toISOString(),workspaceName:'Deep review pilot',files:[{id:'code',path:'src/change.js',version:'v1',source:'const answer = 42;\nexport { answer };\n// Shared answer\n',sourceAvailable:true,lines:[['added','1','const answer = 42;']],added:1,removed:0},{id:'lock',path:'package-lock.json',version:'v2',source:'{"lockfileVersion":3}',sourceAvailable:true,lines:[['added','1','{"lockfileVersion":3}']],added:1,removed:0}]};
 const sections=[{id:'0',fileId:'code',path:'src/change.js',kind:'code',side:'new',startLine:1,endLine:2,summary:null},{id:'1',fileId:'code',path:'src/change.js',kind:'code',side:'new',startLine:3,endLine:3,summary:null},{id:'2',fileId:'lock',path:'package-lock.json',kind:'summary',side:'new',startLine:null,endLine:null,summary:'Changed file; 1 added and 0 removed lines in the captured diff. Generated or lockfile content is summarized; line-by-line explanation is skipped.'}];
 let record,run,sectionRequests=0,speechRequests=0;
 await page.addInitScript(()=>{window.Audio=class{constructor(src){this.src=src;this.paused=true;this.allowed=false;this.currentTime=0;this.ended=false;(window.testAudio||=[]).push(this);}set src(value){this.url=value;this.ended=false;this.currentTime=0;}async play(){if(!this.allowed){this.allowed=true;const error=new Error('The request is not allowed by the user agent or the platform.');error.name='NotAllowedError';throw error;}this.paused=false;}pause(){this.paused=true;}};});
 await page.route('**/api/**',async route=>{
  const path='/api/'+route.request().url().split('/api/')[1].split('?')[0];
  const input=route.request().method()==='POST'?route.request().postDataJSON():{};
  let body;
  if(path==='/api/snapshot')body=snapshot;
  else if(path==='/api/config')body={aiEnabled:true,provider:'claude',capabilities:{repositoryGuide:false},message:'Claude Code connected'};
  else if(path==='/api/models')body={models:[]};
  else if(path==='/api/guide/deep/start'){record={id:input.requestId,mode:'deep',snapshotId:input.snapshotId,title:'Deep file review',sections,position:0,completed:[],explanations:{},runId:null};body={conversation:record};}
  else if(path==='/api/guide/deep/section'){sectionRequests++;record.explanations[input.index]={explanations:input.index===1?[{startLine:3,endLine:3,title:'Document the shared value',text:'This comment describes the shared answer.'}]:[{startLine:1,endLine:1,title:'Define the answer',text:'This line defines the answer.'},{startLine:2,endLine:2,text:'This line exports the answer.'}],pointers:[],narration:'This section explains both captured lines.'};run={id:input.requestId,status:'completed'};body={run};}
  else if(path==='/api/guide/deep/advance'){record.position=input.position;record.completed=input.completed;record.group=input.group;body={conversation:record};}
  else if(path==='/api/guide/run')body={run};
  else if(path==='/api/guide/conversation')body={conversation:record};
  else if(path==='/api/guide/deep/speech'){speechRequests++;await route.fulfill({contentType:'audio/wav',headers:{'x-patchwork-audio-chunks':'1','x-patchwork-speech-text':encodeURIComponent(input.group===0?'This line defines the answer.':'This line exports the answer.'),'x-patchwork-speech-timing':JSON.stringify([{start:0,end:28,time:0,duration:3}])},body:'RIFF audio'});return;}
  else if(path==='/api/file')body={source:snapshot.files[0].source};
  else {await route.continue();return;}
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto(base);await page.locator('h2').filter({hasText:'src/change.js'}).first().waitFor({state:'attached'});
 await page.getByRole('button',{name:'Code guide',exact:true}).click();
 await page.getByRole('button',{name:'Start Deep file review'}).click();
 await page.getByText('This line defines the answer.').waitFor();
 await page.getByText('Audio ready',{exact:true}).waitFor();
 await page.waitForFunction(()=>window.testAudio?.length>0);
 await page.locator('.source-line.citation-highlight').first().waitFor();
 if(await page.locator('.source-line.citation-highlight').count()!==1)throw Error('Only the current line group should be highlighted');
 if(await page.locator('#tab-source').getAttribute('aria-selected')!=='true')throw Error('Deep review did not switch to source');
 if(await page.locator('#deep-file').count()!==1||await page.locator('.deep-review h3,.deep-location').count())throw Error('Duplicate file/location chrome');
 if(sectionRequests<1||speechRequests<1)throw Error('Audio did not prepare automatically');
 await page.getByRole('button',{name:'Play',exact:true}).click();
 await page.getByText('Tap Play again to allow audio playback.').waitFor();
 await page.getByRole('button',{name:'Play',exact:true}).click();
 await page.getByRole('button',{name:'Pause',exact:true}).waitFor();
 await page.evaluate(()=>{const a=window.testAudio.at(-1);a.currentTime=.1;a.ontimeupdate();});
 if(await page.locator('.lesson-word.is-spoken').textContent()!=='This')throw Error('Word highlighting did not follow audio');
 await page.evaluate(()=>{const a=window.testAudio.at(-1);a.paused=true;a.ended=true;a.onended();});
 await page.getByRole('button',{name:'Play',exact:true}).waitFor();
 if(!await page.getByText('This line defines the answer.').count())throw Error('Default playback should pause at section end');
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await page.getByText('This line exports the answer.').waitFor();
 await page.waitForFunction(()=>document.querySelector('.citation-highlight [data-line]')?.dataset.line==='2');
 await page.getByText('Audio ready',{exact:true}).waitFor();
 await page.reload();await page.getByRole('button',{name:'Code guide',exact:true}).click();
 await page.getByText('This line exports the answer.').waitFor();
 await page.getByRole('button',{name:'Back',exact:true}).click();
 await page.getByText('This line defines the answer.').waitFor();
 await page.getByText('Audio ready',{exact:true}).waitFor();
 await page.getByLabel('Auto-advance').check();
 await page.getByRole('button',{name:'Play',exact:true}).click();
 await page.getByRole('button',{name:'Play',exact:true}).click();
 await page.getByRole('button',{name:'Pause',exact:true}).waitFor();
 await page.evaluate(()=>{window.Audio.prototype.play=async function(){this.paused=false;};const a=window.testAudio.at(-1);a.paused=true;a.ended=true;a.onended();});
 await page.getByText('This line exports the answer.').waitFor();
 await page.getByRole('button',{name:'Pause',exact:true}).waitFor();
 await page.getByLabel('Auto-advance').uncheck();
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await page.getByText('This comment describes the shared answer.').waitFor();
 await page.waitForFunction(()=>document.querySelector('.citation-highlight [data-line]')?.dataset.line==='3');
 await page.getByRole('button',{name:'Back',exact:true}).click();
 await page.getByText('This line exports the answer.').waitFor();
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Lines 2–2',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#chat-panel').getAttribute('aria-hidden')==='true');
 await page.getByRole('button',{name:'Open code guide'}).click();
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Deep review overflows phone viewport');
 await page.locator('#deep-file').selectOption('2');
 await page.getByText('Generated or lockfile content is summarized',{exact:false}).waitFor();
 await page.setViewportSize({width:1440,height:900});
 await page.locator('#tab-overview[aria-selected="true"]').waitFor();
 if(await page.locator('.source-line.citation-highlight').count())throw Error('Summary retained stale code highlighting');
 await page.locator('[data-file-id="code"]').click();
 await page.getByText('This line defines the answer.').waitFor();
 await page.context().setOffline(true);await page.evaluate(()=>dispatchEvent(new Event('offline')));
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await page.getByText('This line exports the answer.').waitFor();
 if(sectionRequests!==2)throw Error('Offline reading regenerated saved sections');
 if(await page.locator('.queue-progress').textContent().then(t=>!t.includes('0 of 2 reviewed')))throw Error('Listening changed file approval');
 await page.context().setOffline(false);await page.evaluate(()=>dispatchEvent(new Event('online')));
 return 'PASS logical cards, automatic preparation, word/source synchronization, pause/auto-advance, file picker, reload, offline, and phone layout';
}
