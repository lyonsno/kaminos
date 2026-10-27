import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {verifyAuthoringServer} from '../scene-authoring-witness-identity.mjs';
import {referenceTileStep,seededTiles,exposedFaces} from '../ash/tile-plan.mjs';
const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
const out=resolve(args.get('--out')),repo=resolve(args.get('--repo')),origin=args.get('--url');mkdirSync(out,{recursive:true});
let browser,page;const report={status:'running',phase:'identity',errors:[],consoleErrors:[],frames:[],interventions:[],requested:{repo,origin,experiment:'ash-tiled-landscape'}};
const save=()=>writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));save();
const hash=b=>createHash('sha256').update(b).digest('hex');
try{
 report.server=await verifyAuthoringServer({origin,repoRoot:repo});report.sources={};
 for(const path of ['index.html','ash/gpu-plan.mjs','ash/tile-plan.mjs','ash/tile-gpu.mjs','ash/fall-gpu.mjs','ash/fall-plan.mjs','experiments/ash-gpu-deposition.experiment.mjs','experiments/ash-tiled-landscape.experiment.mjs','tools/ash-tile-witness.mjs']){const r=await fetch(new URL(path,origin));assert.ok(r.ok,path);const h=hash(Buffer.from(await r.arrayBuffer()));assert.equal(h,hash(readFileSync(resolve(repo,path))));report.sources[path]=h;}save();
 const {chromium}=await import(args.get('--playwright'));
 report.browserExecutable=args.get('--browser');assert.ok(report.browserExecutable.includes('Chrome for Testing')||report.browserExecutable.includes('chromium'),'independent automation executable required');
 browser=await chromium.launchPersistentContext(resolve(out,'profile'),{executablePath:report.browserExecutable,headless:true,viewport:{width:1280,height:960},args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu','--disable-gpu-sandbox','--use-angle=metal','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 page=browser.pages()[0];page.setDefaultTimeout(0);page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
 const invoke=async(name,input)=>{report.interventions.push({name,input});save();return page.evaluate(([n,v])=>window.kaminosWorkbenchExperiments.invoke(n,v),[name,input]);};
 const inputs={cellSize:.03,width:1.92,height:.48,centerZ:1,tileSize:8,initialVolume:0};
 const url=new URL('/?workspace=workbench&experiment=ash-tiled-landscape',origin);url.searchParams.set('experiment_inputs',JSON.stringify(inputs));report.requested.inputs=inputs;
 report.phase='mount';save();await page.goto(url.href);await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='ash-tiled-landscape'||document.body.innerText.includes('Experiments unavailable:'));assert.equal(await page.evaluate(()=>window.kaminosWorkbenchExperiments?.state().id),'ash-tiled-landscape');
 await invoke('play',false);await invoke('cloudTime',10);report.initial=await invoke('read');assert.equal(report.initial.backend,'webgpu-connected-ash-tiles');assert.equal(report.initial.surface,'gpu-cached-exposed-faces');
 const capture=async name=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await invoke('settleFrame');assert.deepEqual(report.errors,[]);assert.deepEqual((await invoke('read')).errors,[]);await page.screenshot({path:resolve(out,name+'.png')});const canvas=await page.locator('#kaminos-host-renderer-canvas').screenshot();writeFileSync(resolve(out,name+'-canvas.png'),canvas);report.frames.push({name,state:await invoke('read')});save();return canvas.toString('base64');};
 const changed=async(a,b)=>page.evaluate(async([a,b])=>{const pixels=async s=>{const i=new Image();i.src='data:image/png;base64,'+s;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);return {width:c.width,height:c.height,bytes:ctx.getImageData(0,0,c.width,c.height).data};};const A=await pixels(a),B=await pixels(b);if(A.width!==B.width||A.height!==B.height)throw Error('changed canvas');let n=0;for(let y=0;y<A.height*.85;y++)for(let x=0;x<A.width;x++){const i=(x+y*A.width)*4;if(Math.max(...[0,1,2].map(k=>Math.abs(A.bytes[i+k]-B.bytes[i+k])))>12)n++;}return n;},[a,b]);
 if(args.get('--negative-unmounted')==='yes'){await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());await invoke('read');throw Error('Unmounted route admitted');}
 const ground=report.initial.identity.groundY;
 await invoke('moveContact',{position:[2,ground+2,2]});
 const empty=await capture('00-empty');
 report.phase='covered-bed';await invoke('deposit',{volume:.10,radius:.78,center:[0,ground,1]});await invoke('advance',{steps:8});
 const before=await invoke('snapshot');writeFileSync(resolve(out,'before.json'),JSON.stringify(before));report.beforeDiagnostics=await invoke('diagnostics');
 if(args.get('--negative-hidden')==='yes')await invoke('visibility',false);
 const bed=await capture('01-covered-bed');report.coveredPixels=await changed(empty,bed);assert.ok(report.coveredPixels>300,'actual covered bed must alter visible canvas');
 // Exact GPU/CPU comparison on a tiny actual same-device field, including static kiln support.
 if(args.get('--first-look')!=='yes'){
 report.phase='reference';await invoke('newPatch',{width:.66,height:.42,cellSize:.06,centerZ:1});await invoke('deposit',{volume:.015,radius:.22,center:[0,ground,1]});
 const initial=await invoke('snapshot'),physical=await invoke('diagnostics',{fields:true});let expected=Float32Array.from(initial.patch.values),pending=new Set(initial.patch.pendingTiles),previous=initial.patch.lastContact;
 report.parity=[];
 for(let step=0;step<8;step++){
  const contact=[-.12+step*.035,ground+.035,1,.11];await invoke('moveContact',{position:contact.slice(0,3),radius:contact[3]});
  const ref=referenceTileStep(initial.patch.layout,{values:expected,solid:physical.solid,pending,contact,previous,all:true});
  await invoke('advance',{steps:1});const actual=await invoke('snapshot');const max=actual.patch.values.reduce((m,v,i)=>Math.max(m,Math.abs(v-ref.values[i])),0);
  assert.ok(max<2e-6,'GPU tiled law differs from monolithic reference: '+max);assert.equal(actual.patch.visibleFaces,exposedFaces(initial.patch.layout,actual.patch.values,physical.solid).length);
  report.parity.push({step,max,actual,expected:Array.from(ref.values)});expected=ref.values;pending=ref.pending;previous=contact;
 }
 save();await invoke('newPatch',inputs);await invoke('restore',before);
 report.phase='contact-seam';
 for(let k=0;k<7;k++){await invoke('moveContact',{position:[-.7+k*.23,ground+.025,1.35],radius:.14});await invoke('advance',{steps:4});await capture('drag-'+k);}
 const after=await invoke('snapshot');writeFileSync(resolve(out,'after.json'),JSON.stringify(after));assert.notDeepEqual(after.patch.values,before.patch.values);assert.ok(Math.abs(after.patch.retainedVolume-before.patch.retainedVolume)<1e-5);report.contactDiagnostics=await invoke('diagnostics');
 report.phase='sleep';await invoke('moveContact',{position:[2,ground+2,2]});
 let diagnostic;for(let n=0;;n++){await invoke('advance',{steps:8});diagnostic=await invoke('diagnostics');if(diagnostic.stats.activeTiles===0)break;if(n%16===0){report.sleepProgress={batches:n,diagnostic};save();}}
 report.sleep=diagnostic;assert.equal(diagnostic.stats.rebuiltTiles,0);const sleeping=await invoke('snapshot');writeFileSync(resolve(out,'sleeping.json'),JSON.stringify(sleeping));await capture('09-sleeping');
 await invoke('advance',{steps:2});const quiet=await invoke('diagnostics');assert.equal(quiet.stats.exchangeCellVisits,0);assert.deepEqual(quiet.tiles.map(t=>t.surfaceRevision),diagnostic.tiles.map(t=>t.surfaceRevision));
 report.phase='falling';await invoke('setSource',{position:[0,ground+.85,1.25],spread:.24,rate:.008});await invoke('burst',.012);await invoke('advance',{steps:8});const air=await invoke('snapshot');writeFileSync(resolve(out,'airborne.json'),JSON.stringify(air));assert.ok(air.patch.falling.particles.some((v,i)=>i%8===3&&v>0));await capture('10-arriving-ash');
 const continuation=async()=>{await invoke('advance',{steps:4});return invoke('snapshot');};const continued=await continuation();
 report.phase='reopen';await page.reload();await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='ash-tiled-landscape');await invoke('play',false);await invoke('restore',air);const restored=await invoke('snapshot');assert.deepEqual(restored.patch.values,air.patch.values);assert.deepEqual(restored.patch.falling.particles,air.patch.falling.particles);const replay=await continuation();assert.ok(Math.abs(replay.patch.retainedVolume-continued.patch.retainedVolume)<1e-5);assert.ok(replay.patch.values.reduce((m,v,i)=>Math.max(m,Math.abs(v-continued.patch.values[i])),0)<2e-6);report.continuation={retainedVolume:replay.patch.retainedVolume,expected:continued.patch.retainedVolume};await capture('11-reopened');
 }
 if(args.get('--first-look')!=='yes'){
 report.phase='retained-area';report.scaling=[];
 for(const width of [1.92,3.84]){
  await invoke('newPatch',{...inputs,width});await invoke('moveContact',{position:[0,ground+2,1.2],radius:.14});
  const state=await invoke('snapshot'),physical=await invoke('diagnostics',{fields:true}),p=state.patch.layout;
  // An explicit broad, already settled bed isolates local work from settling history.
  state.patch.values=state.patch.values.map((_,i)=>physical.solid[i]?0:Math.floor(i/p.dims[0])%p.dims[1]<2?1:Math.floor(i/p.dims[0])%p.dims[1]===2?.25:0);
  state.patch.pendingTiles=[];state.patch.lastContact=[0,ground+2,1.2,.14];state.patch.seededVolume=state.patch.values.reduce((s,v)=>s+v,0)*p.cellSize**3;
  writeFileSync(resolve(out,'broad-bed-'+width+'.json'),JSON.stringify(state));await invoke('restore',state);await invoke('advance',{steps:2});
  const quiet=await invoke('diagnostics');assert.equal(quiet.stats.activeTiles,0);assert.equal(quiet.stats.exchangeCellVisits,0);assert.equal(quiet.stats.rebuiltTiles,0);
  const baseline=await invoke('snapshot');await capture('broad-bed-'+width);
  // Set the old contact beside the first target, then exercise one identical local sweep.
  baseline.contact=[.15,ground+.025,1.2];baseline.contactRadius=.14;baseline.patch.lastContact=[...baseline.contact,.14];await invoke('restore',baseline);
  const work=[];for(let k=0;k<4;k++){
   await invoke('moveContact',{position:[.2+k*.04,ground+.025,1.2],radius:.14});await invoke('advance',{steps:1});work.push(await invoke('diagnostics'));
  }
  const disturbed=await invoke('snapshot');assert.notDeepEqual(disturbed.patch.values,baseline.patch.values);assert.ok(Math.abs(disturbed.patch.retainedVolume-baseline.patch.retainedVolume)<1e-5);
  await capture('broad-disturbed-'+width);const effective=await invoke('read');report.scaling.push({width,layout:p,allocatedBytes:effective.allocatedBytes,quiet,work,retainedVolume:disturbed.patch.retainedVolume});save();
 }
 assert.equal(report.scaling[1].layout.count,4*report.scaling[0].layout.count);
 assert.equal(report.scaling[1].work[0].stats.exchangeCellVisits,report.scaling[0].work[0].stats.exchangeCellVisits,'same initial local disturbance must have equal cell work in four times the retained area');
 assert.ok(report.scaling[1].work[0].stats.activeTiles<report.scaling[1].layout.tiles.count);
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[]);report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack??error);if(page){report.lastPage=await page.evaluate(()=>({text:document.body.innerText,state:window.kaminosWorkbenchExperiments?.state()})).catch(String);await page.screenshot({path:resolve(out,'failed.png')}).catch(()=>{});}process.exitCode=1;
}finally{await browser?.close();report.browserClosed=true;save();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,report:resolve(out,'report.json')}));}
