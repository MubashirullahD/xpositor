async page => {
 const base=page.url().replace(/\/$/,'');
 const files=Array.from({length:50},(_,i)=>({id:`file-${i}`,path:`src/file-${i}.js`,label:`file-${i}.js`,folder:'src',version:`v${i}`,status:'modified',type:'JS',tone:'lime',added:1,removed:0,sourceAvailable:false,lines:[['added','1',`export const value = ${i};`]]}));
 const snapshot={repoId:'queue-scroll',base:'base',head:'head',branch:'main',snapshotId:'queue-scroll-snapshot',generatedAt:new Date().toISOString(),workspaceName:'Queue scroll fixture',files};
 await page.route('**/api/**',async route=>{
  const path='/api/'+route.request().url().split('/api/')[1].split('?')[0];
  const body=path==='/api/snapshot'?snapshot:path==='/api/config'?{aiEnabled:false}:{error:'Unexpected request'};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.setViewportSize({width:1200,height:650});
 await page.goto(base);
 await page.getByRole('heading',{name:'file-0.js',exact:true}).waitFor();
 await page.waitForFunction(async()=>{const {state}=await import('/src/main.js');return state.connection==='connected'&&state.snapshotSaved;});
 const queue=page.locator('#file-panel');
 await queue.evaluate(el=>{el.scrollTop=650;});
 const desktopScroll=await queue.evaluate(el=>el.scrollTop);
 if(desktopScroll<600)throw Error('Desktop fixture did not scroll');
 await page.getByRole('button',{name:'Code guide',exact:true}).click();
 if(Math.abs(await queue.evaluate(el=>el.scrollTop)-desktopScroll)>2)throw Error('Opening guide reset desktop queue scroll');
 await page.getByRole('button',{name:'Close code guide',exact:true}).click();
 if(Math.abs(await queue.evaluate(el=>el.scrollTop)-desktopScroll)>2)throw Error('Closing guide reset desktop queue scroll');
 await page.setViewportSize({width:390,height:650});
 await page.getByRole('button',{name:'Open files',exact:true}).click();
 await queue.evaluate(el=>{el.scrollTop=750;});
 const phoneScroll=await queue.evaluate(el=>el.scrollTop);
 if(phoneScroll<700)throw Error('Phone fixture did not scroll');
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Open files',exact:true}).click();
 if(Math.abs(await queue.evaluate(el=>el.scrollTop)-phoneScroll)>2)throw Error('Reopening phone queue reset scroll');
 return 'PASS review queue retains scroll across desktop renders and phone drawer toggles';
}
