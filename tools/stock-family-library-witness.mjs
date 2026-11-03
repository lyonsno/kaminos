import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,all)=>v.startsWith('--')?[...a,[v.slice(2),all[i+1]]]:a,[]));
if(!args.url||!args.out||!args.browser||!args.playwright||!args.name)throw Error('--url --out --browser --playwright --name required');
await fs.mkdir(args.out,{recursive:true});let context,page;
const report={ok:false,phase:'launch',requestedUrl:args.url,browser:args.browser,errors:[]};
try{
 const {chromium}=await import(pathToFileURL(args.playwright));context=await chromium.launchPersistentContext(path.join(args.out,'profile'),{executablePath:args.browser,headless:true,viewport:{width:1500,height:1050},args:['--enable-unsafe-webgpu','--use-mock-keychain','--password-store=basic']});
 page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(args.url);
 await page.waitForFunction(()=>document.querySelector('[aria-label="Stock source"]'));
 report.runtime=await page.evaluate(()=>fetch('/api/runtime-config').then(r=>r.json()).then(v=>v.source));
 if(args.commit){assert.equal(report.runtime.commit,args.commit);assert.equal(report.runtime.dirty,false);}
 const invoke=(name,value)=>page.evaluate(([n,v])=>window.kaminosWorkbenchExperiments.invoke(n,v),[name,value]);
 const initial=await invoke('read');report.initial=initial;
 report.phase='alternate-sources';
 for(const [sha,label,axis] of [['7be0be2857ce5100ffa86f329e4068ba83ebb701c8582e2f982d28e68b8f8bdd','Weathered timber','x'],['97b805c0f6d6b4d608874a4dcebc7102f9edf10c9f563bd5e4fa5a146139ad03','Open elbow (curved stress)','z']]){
  const entry=await page.evaluate(async sha=>(await fetch('/api/authoring-assets?collection=generated-meshes').then(r=>r.json())).entries.find(e=>e.kind==='mesh'&&e.path===sha+'.glb'),sha);assert.ok(entry,'Real alternate must exist in the native catalog');
  await invoke('asset',{entry:{...entry,label},axis});const state=await invoke('read');assert.equal(state.source.sha256,sha);assert.deepEqual(state.variants.map(v=>[v.objectId,v.parameters,v.pose]),initial.variants.map(v=>[v.objectId,v.parameters,v.pose]));
 }
 await invoke('source',{source:{...initial.source,label:'Steel trough'}});await invoke('select',{id:'bend'});await page.evaluate(()=>window.kaminosFrameSelected());
 report.phase='save';await page.getByLabel('Family name',{exact:true}).fill(args.name);
 async function save(){const response=page.waitForResponse(r=>r.url().endsWith('/api/stock-families')&&r.request().method()==='POST');await page.getByRole('button',{name:'Save family',exact:true}).click();const r=await response;assert.equal(r.status(),200);return r.json();}
 report.saved=await save();assert.equal(report.saved.recipe.sources.length,3);assert.equal(report.saved.name,args.name);
 assert.deepEqual(JSON.parse(new URL(page.url()).searchParams.get('experiment_inputs')),{assetSource:'/api/read?root=generated-meshes&path='+report.saved.id+'.stock-family.json'});
 await invoke('set',{id:'long',length:2.3});report.updated=await save();assert.equal(report.updated.id,report.saved.id);assert.notEqual(report.updated.revision,report.saved.revision);
 const catalog=await page.evaluate(()=>fetch('/api/authoring-assets?collection=generated-meshes').then(r=>r.json()));
 const entry=catalog.entries.find(e=>e.kind==='stock-family'&&e.path===report.saved.id+'.stock-family.json');assert.ok(entry);assert.equal(entry.label,args.name);report.entry=entry;
 report.conflict=await page.evaluate(async old=>{const r=await fetch('/api/stock-families',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(old)});return {status:r.status,body:await r.json()};},report.saved);assert.equal(report.conflict.status,409);
 report.phase='cold-browser-open';await page.goto(new URL('/?workspace=authoring',args.url).href);
 await page.waitForFunction(()=>window.kaminosAssets&&window.kaminosWorkbenchExperiments);
 await page.evaluate(()=>window.kaminosAssets.open('browse'));await page.waitForFunction(()=>!window.kaminosAssets.read().loading&&window.kaminosAssets.read().entries.length>0);
 await page.getByRole('searchbox',{name:'Search this asset collection',exact:true}).fill(args.name);
 await page.locator(`[data-asset-path="${entry.source}"]`).click();await page.screenshot({path:path.join(args.out,'family-in-assets.png')});
 await page.getByRole('button',{name:'Open family',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[aria-label="Long Length"]')?.value==='2.3'&&document.body.dataset.workspace==='workbench');
 report.reopened=await invoke('read');assert.deepEqual(report.reopened.recipe,report.updated.recipe);assert.equal((await invoke('library')).id,report.updated.id);
 await invoke('set',{id:'long',length:2.7});report.beforeReload=await save();await page.reload();await page.waitForFunction(()=>document.querySelector('[aria-label="Long Length"]')?.value==='2.7');assert.equal((await invoke('library')).revision,report.beforeReload.revision);report.reloaded=await invoke('read');
 await page.getByLabel('Stock source',{exact:true}).selectOption('7be0be2857ce5100ffa86f329e4068ba83ebb701c8582e2f982d28e68b8f8bdd');
 await page.waitForFunction(()=>{const s=document.querySelector('[aria-label="Stock source"]');return s?.value.startsWith('7be0')&&!s.disabled;});
 assert.equal((await invoke('read')).source.fit.axis,'x');await invoke('select',{id:'bend'});await page.evaluate(()=>window.kaminosFrameSelected());
 await page.screenshot({path:path.join(args.out,'saved-timber.png')});
 await page.getByLabel('Stock source',{exact:true}).selectOption(initial.source.sha256);await page.waitForFunction(sha=>{const s=document.querySelector('[aria-label="Stock source"]');return s?.value===sha&&!s.disabled;},initial.source.sha256);
 await invoke('set',{id:'long',length:2});report.final=await save();
 await invoke('select',{id:'bend'});await page.evaluate(()=>window.kaminosFrameSelected());await page.screenshot({path:path.join(args.out,'family-desktop.png')});
 await page.setViewportSize({width:430,height:932});await invoke('frame');await page.screenshot({path:path.join(args.out,'family-mobile.png')});
 const canvas=page.locator('canvas').filter({visible:true});let largest,best=0;for(const element of await canvas.all()){const b=await element.boundingBox();if(b&&b.width*b.height>best){best=b.width*b.height;largest=element;}}
 const captured=await largest.screenshot({path:path.join(args.out,'viewport.png')});
 report.pixels=await page.evaluate(async data=>{const img=new Image();img.src=data;await img.decode();const copy=document.createElement('canvas');copy.width=img.width;copy.height=img.height;const ctx=copy.getContext('2d');ctx.drawImage(img,0,0);const d=ctx.getImageData(0,0,copy.width,copy.height).data;let lo=255,hi=0;for(let i=0;i<d.length;i+=4){lo=Math.min(lo,d[i]);hi=Math.max(hi,d[i]);}return {width:copy.width,height:copy.height,lo,hi};},'data:image/png;base64,'+captured.toString('base64'));assert.ok(report.pixels.hi-report.pixels.lo>30);
 assert.deepEqual(report.errors,[]);report.ok=true;report.phase='complete';
}catch(e){report.error=e.stack;if(page){report.state=await page.evaluate(()=>({experiment:window.kaminosWorkbenchExperiments?.state(),text:document.body.innerText})).catch(()=>null);await page.screenshot({path:path.join(args.out,'failure.png')}).catch(()=>{});}process.exitCode=1;}
finally{await context?.close();await fs.writeFile(path.join(args.out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,phase:report.phase,error:report.error,out:args.out}));}
