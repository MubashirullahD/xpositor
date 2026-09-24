async page => {
 const base=page.url();
 const testContext=await page.context().browser().newContext({serviceWorkers:'block'});
 page=await testContext.newPage();
 const snapshot={repoId:'deep-browser',snapshotId:'deep-browser-snapshot',scope:'unstaged',base:'head',head:'head',branch:'main',generatedAt:new Date().toISOString(),workspaceName:'Deep review pilot',files:[{id:'code',path:'src/change.js',version:'v1',source:'const answer = 42;\nexport { answer };\n',sourceAvailable:true,lines:[['added','1','const answer = 42;']],added:1,removed:0},{id:'lock',path:'package-lock.json',version:'v2',source:'{"lockfileVersion":3}',sourceAvailable:true,lines:[['added','1','{"lockfileVersion":3}']],added:1,removed:0}]};
 const sections=[{id:'0',fileId:'code',path:'src/change.js',kind:'code',side:'new',startLine:1,endLine:2,summary:null},{id:'1',fileId:'lock',path:'package-lock.json',kind:'summary',side:'new',startLine:null,endLine:null,summary:'Changed file; 1 added and 0 removed lines in the captured diff. Generated or lockfile content is summarized; line-by-line explanation is skipped.'}];
 let record,run,sectionRequests=0,speechRequests=0;
 await page.addInitScript(()=>{window.Audio=class{constructor(src){this.src=src;this.paused=true;this.allowed=false;}async play(){if(!this.allowed){this.allowed=true;const error=new Error('The request is not allowed by the user agent or the platform.');error.name='NotAllowedError';throw error;}this.paused=false;}pause(){this.paused=true;}};});
 await page.route('**/api/**',async route=>{
  const path='/api/'+route.request().url().split('/api/')[1].split('?')[0];
  const input=route.request().method()==='POST'?route.request().postDataJSON():{};
  let body;
  if(path==='/api/snapshot')body=snapshot;
  else if(path==='/api/config')body={aiEnabled:true,provider:'claude',capabilities:{repositoryGuide:false},message:'Claude Code connected'};
  else if(path==='/api/models')body={models:[]};
  else if(path==='/api/guide/deep/start'){record={id:input.requestId,mode:'deep',snapshotId:input.snapshotId,title:'Deep file review',sections,position:0,completed:[],explanations:{},runId:null};body={conversation:record};}
  else if(path==='/api/guide/deep/section'){sectionRequests++;record.explanations[input.index]={explanations:[{startLine:1,endLine:2,text:'This section explains both captured lines.'}],pointers:[],narration:'This section explains both captured lines.'};run={id:input.requestId,status:'completed'};body={run};}
  else if(path==='/api/guide/deep/advance'){record.position=input.position;record.completed=input.completed;body={conversation:record};}
  else if(path==='/api/guide/run')body={run};
  else if(path==='/api/guide/conversation')body={conversation:record};
  else if(path==='/api/guide/deep/speech'){speechRequests++;await route.fulfill({contentType:'audio/wav',headers:{'x-patchwork-audio-chunks':'1'},body:'RIFF audio'});return;}
  else if(path==='/api/file')body={source:snapshot.files[0].source};
  else {await route.continue();return;}
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto(base);await page.locator('h2').filter({hasText:'src/change.js'}).first().waitFor({state:'attached'});
 await page.getByRole('button',{name:'Code guide',exact:true}).click();
 await page.getByRole('button',{name:'Start Deep file review'}).click();
 await page.getByText('This section explains both captured lines.').waitFor();
 await page.setViewportSize({width:390,height:844});
 if(sectionRequests!==1||speechRequests!==0)throw Error('Deep mode should generate one section and no audio until Play');
 await page.getByRole('button',{name:'Play section'}).click();
 await page.getByRole('button',{name:'Play ready audio'}).waitFor();
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Deep review overflows the phone viewport');
 if(await page.getByText('The request is not allowed by the user agent',{exact:false}).count())throw Error('Raw browser audio error leaked into the guide');
 await page.getByRole('button',{name:'Play ready audio'}).click();
 await page.getByRole('button',{name:'Pause',exact:true}).waitFor();
 if(speechRequests!==1)throw Error('Play did not request section audio');
 await page.getByRole('button',{name:'Next section'}).click();
 await page.getByText('Generated or lockfile content is summarized').waitFor();
 await page.setViewportSize({width:1440,height:900});
 await page.reload();await page.getByRole('button',{name:'Code guide',exact:true}).click();
 await page.getByText('Generated or lockfile content is summarized').waitFor();
 await page.context().setOffline(true);await page.evaluate(()=>dispatchEvent(new Event('offline')));
 await page.getByRole('button',{name:'Back',exact:true}).click();
 await page.getByText('This section explains both captured lines.').waitFor();
 if(sectionRequests!==1)throw Error('Offline reading regenerated a saved section');
 await page.context().setOffline(false);await page.evaluate(()=>dispatchEvent(new Event('online')));
 return 'PASS deep section, generated notice, reload, offline reading, and audio only on Play';
}
