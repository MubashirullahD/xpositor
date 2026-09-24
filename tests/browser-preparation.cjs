async page => {
 const base=page.url();let conversation,run,lessonStarts=0,speechRequests=0,rootReady=false,voiceReady=false,releaseSpeech;
 const citation={path:'queue.js',fileId:'a',side:'new',startLine:1,endLine:2};
 const lesson={title:'Avoid duplicate requests',step:0,reviewPointers:[{text:'Check whether retrying preserves the same request ID.',citation}],segments:Array.from({length:4},(_,i)=>({title:['The problem','Follow one request','Try a retry','What to remember'][i],narration:'Imagine your phone disconnects after sending a question. The same request ID lets the laptop return the existing answer instead of asking twice.',citation,focusLine:2,code:[{line:1,text:'const previous = runs.get(id);'},{line:2,text:'if (previous) return previous;'}]}))};
 const guide={title:'Review the queue',summary:'Avoid duplicate work.',assumptions:[],totalChangedFiles:1,coverage:[],steps:[{title:'Request identity',explanation:'One question keeps the same ID.',files:[{fileId:'a',path:'queue.js'}],citations:[citation]}]};
 await page.addInitScript(()=>{window.testAudios=[];window.Audio=class{constructor(src){this.src=src;this.paused=true;window.testAudios.push(this);}async play(){this.paused=false;}pause(){this.paused=true;}};});
 await page.route('**/api/**',async route=>{
  const path=route.request().url().split('/api/')[1].split('?')[0];const input=route.request().method()==='POST'?route.request().postDataJSON():{};let body;
  if(path==='snapshot')body={repoId:'lesson-browser',snapshotId:'lesson-snapshot',scope:'unstaged',base:'head',head:'head',branch:'main',generatedAt:new Date().toISOString(),workspaceName:'Teaching pilot',files:[{id:'a',path:'queue.js',version:'1',source:'const previous = runs.get(id);\nif (previous) return previous;',lines:[['added','1','const previous = runs.get(id);']],added:1,removed:0}]};
  else if(path==='config')body={aiEnabled:true,provider:'codex',capabilities:{repositoryGuide:true}};
  else if(path==='models')body={models:[]};
  else if(path==='guide/start'){conversation={id:input.requestId,snapshotId:'lesson-snapshot',title:guide.title,step:0,guide,messages:[],lessons:{}};run={id:input.requestId,status:'completed'};body={run};}
  else if(path==='guide/lesson'){lessonStarts++;conversation.lessons[0]=lesson;run={id:input.requestId,status:'completed'};body={run};}
  else if(path==='guide/run')body={run:{...run,status:rootReady?'completed':'running'}};
  else if(path==='guide/conversation')body={conversation};
  else if(path==='guide/speech'){speechRequests++;if(!voiceReady)await new Promise(resolve=>releaseSpeech=resolve);await route.fulfill({contentType:'audio/wav',body:'test clip'});return;}
  else body={};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 });

 await page.setViewportSize({width:390,height:844});await page.goto(base);await page.getByRole('heading',{name:'queue.js',exact:true}).waitFor();await page.getByRole('button',{name:'Open code guide',exact:true}).click();
 await page.getByRole('button',{name:'Start walkthrough',exact:true}).click();await page.getByRole('button',{name:'Try a breathing exercise',exact:true}).click();
 await page.getByRole('dialog',{name:'Mindful breathing',exact:true}).waitFor();await page.getByRole('button',{name:'Pause',exact:true}).waitFor();
 await page.getByRole('button',{name:'Notice your surroundings',exact:true}).click();await page.getByRole('dialog',{name:'Notice this moment',exact:true}).waitFor();
 if(await page.locator('.breath-orb').evaluate(el=>getComputedStyle(el).animationName)!=='none')throw Error('Grounding should not pace breathing');
 rootReady=true;await page.getByText('Your audio is still preparing. Take your time.',{exact:true}).waitFor();
 if(!await page.locator('.mindfulness-overlay').isVisible())throw Error('Readiness interrupted the exercise');
 await page.clock.install();await page.clock.fastForward(61000);await page.getByText('A moment, taken',{exact:true}).waitFor();await page.getByText('Your audio is still preparing. Take your time.',{exact:true}).waitFor();
 voiceReady=true;releaseSpeech();await page.getByRole('button',{name:'Continue to audio',exact:true}).waitFor();
 if(!await page.evaluate(()=>testAudios.at(-1).paused))throw Error('Audio interrupted mindfulness');
 for(const [width,height] of [[320,568],[390,667],[844,390],[390,844]]){await page.setViewportSize({width,height});const overflow=await page.locator('.mindfulness-card').evaluate(el=>el.scrollHeight>el.clientHeight+1);if(overflow)throw Error('Breathing modal overflow '+width+'x'+height);}
 await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await page.screenshot({path:'/tmp/patchwork-mindful-ready-mobile.png'});
 await page.getByRole('button',{name:'Continue to audio',exact:true}).click();await page.getByRole('button',{name:'Pause',exact:true}).waitFor();
 if(await page.locator('.mindfulness-overlay').count())throw Error('Continue did not leave the exercise');
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile overflow');
 return 'PASS waiting invitation, grounding, background completion, honest slow preparation, quiet audio readiness and explicit playback handoff';
}
