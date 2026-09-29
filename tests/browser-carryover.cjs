async page => {
 const base=page.url();
 const context=await page.context().browser().newContext({serviceWorkers:'block'});
 page=await context.newPage();
 let version=1,conversation,run;
 const citation={path:'queue.js',fileId:'a',side:'new',startLine:1,endLine:1};
 const guide={title:'Review the queue',summary:'Avoid duplicate work.',assumptions:[],totalChangedFiles:1,coverage:[],steps:[{title:'Request identity',explanation:'One question keeps the same ID.',files:[{fileId:'a',path:'queue.js'}],citations:[citation]}]};
 const snapshot=()=>({repoId:'carryover-browser',snapshotId:`carry-snapshot-${version}`,scope:'unstaged',base:'head',head:'head',branch:'main',generatedAt:new Date(Date.UTC(2026,8,29,9,version)).toISOString(),workspaceName:'Carryover',files:[{id:'a',path:'queue.js',version:`v${version}`,source:`const previous = runs.get(id); // ${version}`,lines:[['added','1','const previous = runs.get(id);']],added:1,removed:0}]});
 const compares=[];
 await page.route('**/api/**',async route=>{
  const url=route.request().url(),path=url.split('/api/')[1].split('?')[0],input=route.request().method()==='POST'?route.request().postDataJSON():{};let body;
  if(path==='snapshot')body=snapshot();
  else if(path==='config')body={aiEnabled:true,provider:'claude',capabilities:{repositoryGuide:true,modelSelection:true}};
  else if(path==='models')body={models:[]};
  else if(path==='snapshot/compare'){const from=decodeURIComponent(url.match(/[?&]from=([^&]+)/)[1]);compares.push(from);body={from:{snapshotId:from,scope:'unstaged',generatedAt:new Date(Date.UTC(2026,8,29,9,Number(from.split('-').at(-1)))).toISOString()},to:{snapshotId:snapshot().snapshotId,scope:'unstaged'},sameScope:true,changed:['queue.js']};}
  else if(path==='guide/start'){conversation={id:input.requestId,snapshotId:input.snapshotId,title:guide.title,step:0,guide,messages:[],lessons:{}};run={id:input.requestId,status:'completed'};body={run};}
  else if(path==='guide/lesson')body={run:{id:input.requestId,status:'running'}};
  else if(path==='guide/run')body={run:run&&url.includes(run.id)?run:{id:'lesson',status:'running'}};
  else if(path==='guide/conversation')body={conversation};
  else body={};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 });
 const openGuide=async()=>{await page.goto(base);await page.getByRole('heading',{name:'queue.js',exact:true}).waitFor();await page.getByRole('button',{name:'Code guide',exact:true}).click();};
 await page.setViewportSize({width:1400,height:900});await openGuide();
 await page.getByRole('button',{name:'Start overview',exact:true}).click();await page.getByRole('heading',{name:'Request identity',exact:true}).waitFor();

 // The reviewed file changes: the earlier walkthrough is offered, not silently hidden.
 version=2;await openGuide();
 await page.getByText('Continue your earlier walkthrough?').waitFor();
 if(!await page.getByText(/1 of the files you’re reviewing changed \(queue\.js\)/).count())throw Error('The offer must name the changed files');
 await page.screenshot({path:'/tmp/patchwork-carryover.png'});
 await page.getByRole('button',{name:'Continue it',exact:true}).click();
 await page.getByRole('heading',{name:'Request identity',exact:true}).waitFor();
 await openGuide();await page.getByRole('heading',{name:'Request identity',exact:true}).waitFor();
 if(await page.getByText('Continue your earlier walkthrough?').count())throw Error('A continued walkthrough stays with the current capture');

 // Starting fresh is remembered for that capture.
 version=3;await openGuide();
 await page.getByText('Continue your earlier walkthrough?').waitFor();
 await page.getByRole('button',{name:'Start fresh',exact:true}).click();
 await page.locator('.carryover').waitFor({state:'detached',timeout:5000}).catch(()=>{throw Error('Start fresh must dismiss the offer');});
 await page.getByRole('heading',{name:'How would you like to review?',exact:true}).waitFor();
 await openGuide();await page.getByRole('heading',{name:'How would you like to review?',exact:true}).waitFor();await page.waitForTimeout(500);
 if(await page.getByText('Continue your earlier walkthrough?').count())throw Error('A dismissed offer must not return after reload');
 await context.close();
 return 'PASS earlier walkthrough offered with changed files, continued into the current capture, and fresh start remembered';
}
