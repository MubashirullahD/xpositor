async page => {
 const base=page.url();let conversation,run,lessonStarts=0,speechRequests=0;
 const citation={path:'queue.js',fileId:'a',side:'new',startLine:1,endLine:2};
 const lesson={title:'Avoid duplicate requests',step:0,checkQuestion:'Why should a retry keep its ID?',segments:Array.from({length:4},(_,i)=>({title:['The problem','Follow one request','Try a retry','What to remember'][i],narration:'Imagine your phone disconnects after sending a question. The same request ID lets the laptop return the existing answer instead of asking twice.',citation,focusLine:2,code:[{line:1,text:'const previous = runs.get(id);'},{line:2,text:'if (previous) return previous;'}]}))};
 const guide={title:'Review the queue',summary:'Avoid duplicate work.',assumptions:[],totalChangedFiles:1,coverage:[],steps:[{title:'Request identity',explanation:'One question keeps the same ID.',files:[{fileId:'a',path:'queue.js'}],citations:[citation]}]};
 await page.addInitScript(()=>{window.testAudios=[];window.Audio=class{constructor(src){this.src=src;this.paused=true;window.testAudios.push(this);}async play(){this.paused=false;}pause(){this.paused=true;}};});
 await page.route('**/api/**',async route=>{
  const path=route.request().url().split('/api/')[1].split('?')[0];const input=route.request().method()==='POST'?route.request().postDataJSON():{};let body;
  if(path==='snapshot')body={repoId:'lesson-browser',snapshotId:'lesson-snapshot',scope:'unstaged',base:'head',head:'head',branch:'main',generatedAt:new Date().toISOString(),workspaceName:'Teaching pilot',files:[{id:'a',path:'queue.js',version:'1',source:'const previous = runs.get(id);\nif (previous) return previous;',lines:[['added','1','const previous = runs.get(id);']],added:1,removed:0}]};
  else if(path==='config')body={aiEnabled:true,provider:'codex',capabilities:{repositoryGuide:true}};
  else if(path==='models')body={models:[]};
  else if(path==='guide/start'){conversation={id:input.requestId,snapshotId:'lesson-snapshot',title:guide.title,step:0,guide,messages:[],lessons:{}};run={id:input.requestId,status:'completed'};body={run};}
  else if(path==='guide/lesson'){lessonStarts++;conversation.lessons[0]=lesson;run={id:input.requestId,status:'completed'};body={run};}
  else if(path==='guide/run')body={run};
  else if(path==='guide/conversation')body={conversation};
  else if(path==='guide/speech'){speechRequests++;await route.fulfill({contentType:'audio/wav',body:'test clip'});return;}
  else body={};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.setViewportSize({width:1440,height:900});await page.goto(base);await page.getByRole('heading',{name:'queue.js',exact:true}).waitFor();await page.getByRole('button',{name:'Code guide',exact:true}).click();await page.getByRole('button',{name:'Start walkthrough',exact:true}).click();await page.getByRole('button',{name:'Teach this chapter · audio pilot',exact:true}).click();
 await page.getByRole('heading',{name:'The problem',exact:true}).waitFor();if(await page.locator('.lesson-focus code').textContent()!=='if (previous) return previous;')throw Error('Wrong code highlighted');
 await page.getByRole('button',{name:'Play',exact:true}).click();await page.getByRole('button',{name:'Pause',exact:true}).waitFor();const bufferedRequests=speechRequests;await page.getByRole('button',{name:'Pause',exact:true}).click();if(!await page.evaluate(()=>testAudios.at(-1).paused))throw Error('Pause failed');
 await page.getByRole('button',{name:'Play',exact:true}).click();await page.getByRole('button',{name:'Pause',exact:true}).waitFor();if(speechRequests!==bufferedRequests)throw Error('Resume regenerated audio');
 await page.evaluate(()=>testAudios.at(-1).onended());await page.getByRole('heading',{name:'Follow one request',exact:true}).waitFor();await page.getByRole('button',{name:'Pause',exact:true}).waitFor();
 await page.locator('#agent-draft').focus();await page.getByRole('button',{name:'Play',exact:true}).waitFor();if(!await page.evaluate(()=>testAudios.at(-1).paused))throw Error('Question did not pause lesson');
 await page.reload();await page.getByRole('heading',{name:'queue.js',exact:true}).waitFor();await page.getByRole('button',{name:'Code guide',exact:true}).click();await page.getByRole('heading',{name:'Follow one request',exact:true}).waitFor();if(lessonStarts!==1)throw Error('Reload regenerated lesson');
 await page.emulateMedia({colorScheme:'dark'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/patchwork-audio-pilot-mobile.png'});await page.setViewportSize({width:320,height:740});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile overflow');
 await page.getByRole('button',{name:'Next teaching segment',exact:true}).click();await page.getByRole('button',{name:'Next teaching segment',exact:true}).click();await page.getByText('Why should a retry keep its ID?',{exact:false}).waitFor();
 await page.context().setOffline(true);await page.evaluate(()=>dispatchEvent(new Event('offline')));await page.getByRole('heading',{name:'What to remember',exact:true}).waitFor();await page.context().setOffline(false);
 return 'PASS lesson generation, synchronized code, pause/resume, automatic segment advance, question interruption, reload position, transcript offline and mobile layout';
}
