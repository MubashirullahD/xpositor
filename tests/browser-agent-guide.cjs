async page => {
 const base=page.url(),conversations={},runs={};let starts=0,rootId,rootReady=false,branchReady=false,branchId,rejectQuestion=false;
 const file={id:'a',path:'a.js',label:'a.js',version:'v1',source:'export const a=1;',sourceAvailable:true,lines:[['added','1','export const a=1;']],added:1,removed:0};
 const snapshot={repoId:'agent-browser',scope:'unstaged',base:'unstaged:head',head:'head',branch:'main',snapshotId:'agent-snapshot',generatedAt:new Date().toISOString(),workspaceName:'Agent guide',files:[file]};
 const guide={title:'Understand the change',summary:'Start with intent, then trace the caller.',assumptions:[],fileOverviews:{'a.js':'This file exports the changed constant used by its caller.'},totalChangedFiles:1,coverage:[{path:'a.js',sourceRead:true,diffExamined:true}],steps:[{title:'Intent',explanation:'The changed constant is one.',files:[{path:'a.js',fileId:'a'}],citations:[{path:'a.js',fileId:'a',side:'new',startLine:1,endLine:1}]},{title:'Caller',explanation:'The unchanged caller uses the constant.',files:[{path:'a.js',fileId:'a'}],citations:[{path:'caller.js',fileId:null,side:'new',startLine:1,endLine:1}]}]};
 await page.route('**/api/**',async route=>{
  const raw=route.request().url(),path='/api/'+raw.split('/api/')[1].split('?')[0],param=name=>decodeURIComponent(raw.match(new RegExp('[?&]'+name+'=([^&]+)'))?.[1]||'');let body;
  if(path==='/api/guide/question'&&rejectQuestion){await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Update the Codex CLI'})});return;}
  const input=route.request().method()==='POST'?route.request().postDataJSON():{};
  if(path==='/api/snapshot')body=snapshot;
  else if(path==='/api/config')body={aiEnabled:true,provider:'codex',capabilities:{repositoryGuide:true}};
  else if(path==='/api/models')body={models:[]};
  else if(path==='/api/guide/start'){
   starts++;rootId=input.requestId;conversations[rootId]={id:rootId,snapshotId:snapshot.snapshotId,parentId:null,title:guide.title,step:0,guide:null,messages:[],runId:rootId};runs[rootId]={id:rootId,conversationId:rootId,status:'running',text:'',revision:1};body={run:runs[rootId]};
  }else if(path==='/api/guide/lesson'){
   runs[input.requestId]={id:input.requestId,conversationId:input.conversationId,status:'failed',error:'Audio chapter unavailable in this mock.',revision:1};body={run:runs[input.requestId]};
  }else if(path==='/api/guide/run'){
   const id=param('id');if(id===rootId&&rootReady){runs[id].status='completed';conversations[rootId].guide=guide;}
   if(id===branchId&&branchReady){runs[id].status='completed';conversations[id].messages=[{role:'user',text:'Explain the caller'},{role:'assistant',text:'The caller imports a.js.'}];}
   body={run:runs[id]};
  }else if(path==='/api/guide/conversation')body={conversation:conversations[param('id')]};
  else if(path==='/api/guide/step'){conversations[input.conversationId].step=input.step;body={conversation:conversations[input.conversationId]};}
  else if(path==='/api/guide/question'){
   branchId=input.requestId;const parent=conversations[input.conversationId];conversations[branchId]={...parent,id:branchId,parentId:parent.id,title:input.question,step:input.step,messages:[{role:'user',text:input.question}],runId:branchId};runs[branchId]={id:branchId,conversationId:branchId,status:'running',text:'A streamed reply',revision:1};body={run:runs[branchId]};
  }else if(path==='/api/guide/source')body={path:'caller.js',source:'import {a} from "./a.js";\nuse(a);'};
  else if(path==='/api/guide/stop'){runs[input.requestId].status='cancelled';runs[input.requestId].error='Stopped.';body={run:runs[input.requestId]};}
  else body={error:'Unexpected '+path};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.setViewportSize({width:1440,height:900});await page.goto(base);await page.getByRole('heading',{name:'a.js',exact:true}).waitFor();
 await page.getByRole('button',{name:'Code guide',exact:true}).click();await page.getByRole('button',{name:'Start walkthrough',exact:true}).click();
 await page.getByRole('button',{name:'Stop',exact:true}).waitFor();await page.reload();await page.getByRole('heading',{name:'a.js',exact:true}).waitFor();await page.getByRole('button',{name:'Code guide',exact:true}).click();
 if(starts!==1)throw Error('Reload duplicated guide generation');rootReady=true;
 await page.getByRole('heading',{name:'Intent',exact:true}).waitFor();await page.getByRole('button',{name:'Next',exact:true}).click();
 await page.getByRole('tab',{name:'Overview'}).click();await page.getByText('This file exports the changed constant used by its caller.',{exact:true}).waitFor();
 await page.getByRole('heading',{name:'Caller',exact:true}).waitFor();
 await page.getByRole('button',{name:'caller.js · new 1–1',exact:true}).click();await page.getByRole('heading',{name:'caller.js',exact:true}).waitFor();await page.getByText('import {a} from "./a.js";',{exact:true}).waitFor();
 await page.setViewportSize({width:1440,height:600});await page.locator('.walkthrough-scroll').evaluate(el=>{el.scrollTop=60;});
 await page.locator('#agent-draft').fill('Explain the caller');await page.getByRole('button',{name:'Explore in a separate conversation',exact:true}).scrollIntoViewIfNeeded();
 const parentScroll=await page.locator('.walkthrough-scroll').evaluate(el=>el.scrollTop);
 await page.getByRole('button',{name:'Explore in a separate conversation',exact:true}).click();
 await page.getByRole('button',{name:'← Back to walkthrough',exact:true}).waitFor();branchReady=true;await page.getByText('The caller imports a.js.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'← Back to walkthrough',exact:true}).click();await page.getByRole('heading',{name:'Caller',exact:true}).waitFor();
 if(await page.locator('.walkthrough-scroll').evaluate((el,expected)=>Math.abs(el.scrollTop-Math.min(expected,el.scrollHeight-el.clientHeight))>2,parentScroll))throw Error('Branch lost main scroll position: '+parentScroll+' vs '+await page.locator('.walkthrough-scroll').evaluate(el=>el.scrollTop));
 if(await page.getByText('The caller imports a.js.',{exact:true}).count())throw Error('Branch leaked into main conversation');
 await page.reload();await page.getByRole('heading',{name:'a.js',exact:true}).waitFor();await page.getByRole('button',{name:'Code guide',exact:true}).click();await page.getByRole('heading',{name:'Caller',exact:true}).waitFor();
 await page.locator('#agent-conversation').selectOption(branchId);await page.getByText('The caller imports a.js.',{exact:true}).waitFor();
 await page.setViewportSize({width:1440,height:900});await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:'/tmp/patchwork-agent-desktop-dark.png'});
 await page.setViewportSize({width:390,height:844});await page.getByRole('dialog',{name:'Code guide',exact:true}).waitFor();
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile guide overflows');
 await page.screenshot({path:'/tmp/patchwork-agent-mobile.png'});
 await page.locator('#agent-draft').fill('Stop this reply');branchReady=false;await page.getByRole('button',{name:'Explore in a separate conversation',exact:true}).click();await page.getByRole('button',{name:'Stop response',exact:true}).click();await page.getByText('Stopped.',{exact:true}).waitFor();
 rejectQuestion=true;await page.locator('#agent-draft').fill('Try a rejected request');await page.getByRole('button',{name:'Send question',exact:true}).click();await page.getByRole('alert').filter({hasText:'Update Codex on the laptop'}).waitFor();await page.getByRole('button',{name:'Send question',exact:true}).waitFor();
 await page.setViewportSize({width:320,height:740});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Small phone guide overflows');
 await page.locator('#agent-conversation').selectOption(rootId);await page.locator('#agent-draft').fill('Saved offline draft');
 await page.context().setOffline(true);await page.evaluate(()=>dispatchEvent(new Event('offline')));await page.getByRole('heading',{name:'Caller',exact:true}).waitFor();if(await page.locator('#agent-draft').inputValue()!=='Saved offline draft')throw Error('Offline draft lost');if(!await page.getByRole('button',{name:'Send question',exact:true}).isDisabled())throw Error('Offline send remains enabled');await page.context().setOffline(false);
 return 'PASS one-action guide, reload without duplicate generation, supporting citations, branching, main-step preservation, saved conversations, mobile layout and explicit stop';
}
