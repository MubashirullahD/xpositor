async page => {
 const base=page.url().replace(/\/$/,'');
 const source=Array.from({length:80},(_,i)=>`const value${i} = '${'long readable text '.repeat(12)}';`).join('\n');
 const lines=[...Array.from({length:3},(_,i)=>['normal',String(i+1),source.split('\n')[i]]),['added','4',source.split('\n')[3]],...Array.from({length:3},(_,i)=>['normal',String(i+5),source.split('\n')[i+4]])];
 const file={id:'a',path:'src/long-name-example.js',label:'long-name-example.js',folder:'src',version:'v1',sourceAvailable:true,source,lines,added:1234,removed:56,type:'JS',tone:'lime'};
 const snapshot={repoId:'feedback',base:'base',head:'head',branch:'main',snapshotId:'capture',generatedAt:new Date().toISOString(),workspaceName:'Feedback fixture',files:[file]};
 let sent;
 await page.route('**/api/**',async route=>{
  const path='/api/'+route.request().url().split('/api/')[1].split('?')[0];
  let body=path==='/api/snapshot'?snapshot:path==='/api/config'?{aiEnabled:true,provider:'codex',message:'Codex · existing ChatGPT plan'}:path==='/api/models'?{models:[{id:'future-small',name:'Future Small',efforts:['low','xhigh'],defaultEffort:'low'}]}:{error:'Unexpected request'};
  if(path==='/api/ai/stream'){sent=route.request().postDataJSON();await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:JSON.stringify({error:{message:'The selected model requires a newer version of Codex. Please upgrade the CLI.'}})})});return;}
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.setViewportSize({width:1440,height:900});await page.goto(base);
 await page.getByRole('heading',{name:file.label,exact:true}).waitFor();
 await page.locator('#wrap-code').check();
 if(!await page.locator('.code-viewer').evaluate(el=>el.scrollWidth<=el.clientWidth+1))throw Error('Desktop wrap overflows');
 await page.locator('#compact-context').check();
 if(await page.locator('.unchanged-context:not([open])').count()!==2)throw Error('Context not folded');
 if(await page.locator('.code-line:visible').count()!==1)throw Error('Folded lines remain visible');
 if(await page.locator('.desktop-backups').getAttribute('open')!==null)throw Error('Desktop backups expanded');
 const countBox=await page.locator('.change-count').boundingBox(),queueBox=await page.locator('#file-panel').boundingBox();
 if(countBox.x+countBox.width>queueBox.x+queueBox.width-8)throw Error('Count clips panel');
 await page.getByRole('button',{name:'Close files',exact:true}).click();
 if(await page.locator('#file-panel').getAttribute('inert')===null)throw Error('Queue did not collapse');
 await page.getByRole('button',{name:'Review queue',exact:true}).click();
 await page.locator('.model-settings summary').click();
 await page.locator('#guide-model').selectOption('future-small');
 await page.locator('#guide-effort').selectOption('xhigh');
 await page.getByRole('button',{name:'Conversation',exact:true}).click();
 await page.locator('#chat-draft').fill('Explain');
 await page.getByRole('button',{name:'Send question',exact:true}).click();
 await page.getByText(/Update Codex on the laptop, restart Patchwork/).waitFor();
 if(sent.model!=='future-small'||sent.effort!=='xhigh')throw Error('Model choice not sent');
 await page.emulateMedia({colorScheme:'dark'});
 if(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor)!=='rgb(23, 28, 25)')throw Error('Dark theme not applied');
 await page.screenshot({path:'/tmp/patchwork-feedback-desktop-dark.png'});
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Open code guide',exact:true}).click();
 const before=await page.evaluate(()=>scrollY);await page.locator('.chat-scroll').hover();await page.mouse.wheel(0,-1400);
 if(await page.evaluate(()=>scrollY)!==before)throw Error('Guide scroll moved review background');
 await page.screenshot({path:'/tmp/patchwork-feedback-mobile-dark.png'});
 await page.getByRole('button',{name:'Close code guide',exact:true}).click();
 await page.getByRole('tab',{name:'Source',exact:true}).click();
 if(!await page.locator('.code-viewer').evaluate(el=>el.scrollWidth<=el.clientWidth+1))throw Error('Mobile source wrap overflows');
 await page.evaluate(()=>window.scrollTo(0,200));
 const footer=await page.locator('.review-footer').boundingBox();
 if(Math.abs(footer.y+footer.height-844)>2)throw Error(`Sticky footer gap: ${844-footer.y-footer.height}`);
 // Previously unopened source is already part of the device snapshot.
 await page.context().setOffline(true);
 await page.getByRole('tab',{name:'Diff',exact:true}).click();await page.getByRole('tab',{name:'Source',exact:true}).click();
 if(!(await page.locator('.source-line').count()))throw Error('Offline source missing');
 await page.context().setOffline(false);
 return 'PASS wrap, folding, queue, spacing, backups, model/effort, actionable errors, dark theme, scroll isolation, sticky footer, offline source';
}
