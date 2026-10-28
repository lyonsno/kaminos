import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {verifyAuthoringServer} from '../scene-authoring-witness-identity.mjs';
import {referenceTileStep,exposedFaces} from '../ash/tile-plan.mjs';
import {tiledCheckpointLocal} from '../ash/witness-state.mjs';
import {coveredSurfaceDelta} from '../ash/witness-pixels.mjs';
import {decodePng} from './poly-witness.mjs';
const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
const out=resolve(args.get('--out')),repo=resolve(args.get('--repo')),origin=args.get('--url');mkdirSync(out,{recursive:true});
let browser,page;const report={status:'running',phase:'identity',errors:[],consoleErrors:[],frames:[],interventions:[],requested:{repo,origin,experiment:'ash-tiled-landscape'}};
const save=()=>writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));save();
const hash=b=>createHash('sha256').update(b).digest('hex');
try{
 report.server=await verifyAuthoringServer({origin,repoRoot:repo});report.sources={};
 for(const path of ['index.html','ash/gpu-plan.mjs','ash/tile-plan.mjs','ash/tile-gpu.mjs','ash/fall-gpu.mjs','ash/fall-plan.mjs','ash/witness-state.mjs','ash/witness-pixels.mjs','tools/poly-witness.mjs','experiments/ash-gpu-deposition.experiment.mjs','experiments/ash-tiled-landscape.experiment.mjs','tools/ash-tile-witness.mjs']){const r=await fetch(new URL(path,origin));assert.ok(r.ok,path);const h=hash(Buffer.from(await r.arrayBuffer()));assert.equal(h,hash(readFileSync(resolve(repo,path))));report.sources[path]=h;}save();
 const {chromium}=await import(args.get('--playwright'));
 report.browserExecutable=args.get('--browser');assert.ok(report.browserExecutable.includes('Chrome for Testing')||report.browserExecutable.includes('chromium'),'independent automation executable required');
 browser=await chromium.launchPersistentContext(resolve(out,'profile'),{executablePath:report.browserExecutable,headless:true,viewport:{width:1280,height:960},args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu','--disable-gpu-sandbox','--use-angle=metal','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 page=browser.pages()[0];page.setDefaultTimeout(0);page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
 const invoke=async(name,input)=>{report.interventions.push({name,input});save();return page.evaluate(([n,v])=>window.kaminosWorkbenchExperiments.invoke(n,v),[name,input]);};
 const snapshot=async()=>{const state=await invoke('snapshot');tiledCheckpointLocal(state);return state;};
 const inputs={cellSize:.03,width:1.92,height:.48,centerZ:1,tileSize:8,initialVolume:0,landscapeObstacles:false};
 const url=new URL('/?workspace=workbench&experiment=ash-tiled-landscape',origin);url.searchParams.set('experiment_inputs',JSON.stringify(inputs));report.requested.inputs=inputs;
 report.phase='mount';save();await page.goto(url.href);await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='ash-tiled-landscape'||document.body.innerText.includes('Experiments unavailable:'));assert.equal(await page.evaluate(()=>window.kaminosWorkbenchExperiments?.state().id),'ash-tiled-landscape');
 await invoke('play',false);await invoke('cloudTime',10);report.initial=await invoke('read');assert.equal(report.initial.backend,'webgpu-connected-ash-tiles');assert.equal(report.initial.surface,'gpu-cached-exposed-faces');
 const capture=async name=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await invoke('settleFrame');assert.deepEqual(report.errors,[]);assert.deepEqual((await invoke('read')).errors,[]);await page.screenshot({path:resolve(out,name+'.png')});const canvas=await page.locator('#kaminos-host-renderer-canvas').screenshot();writeFileSync(resolve(out,name+'-canvas.png'),canvas);report.frames.push({name,state:await invoke('read')});save();return canvas.toString('base64');};
 const changed=(a,b)=>{const unpack=s=>{const p=decodePng(Buffer.from(s,'base64'));return {width:p.width,height:p.height,data:p.channels===4?p.pixels:Uint8Array.from({length:p.width*p.height*4},(_,i)=>i%4===3?255:p.pixels[Math.floor(i/4)*3+i%4])};};return coveredSurfaceDelta(unpack(a),unpack(b));};
 if(args.get('--negative-unmounted')==='yes'){await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());await invoke('read');throw Error('Unmounted route admitted');}
 const ground=report.initial.identity.groundY;
 await invoke('moveContact',{position:[2,ground+2,2]});
 const empty=await capture('00-empty');
 report.phase='covered-bed';await invoke('deposit',{volume:.10,radius:.78,center:[0,ground,1]});await invoke('advance',{steps:8});
 const before=await snapshot();writeFileSync(resolve(out,'before.json'),JSON.stringify(before));report.beforeDiagnostics=await invoke('diagnostics');
 const damaged=structuredClone(before);damaged.local.patch.values.fill(0);await assert.rejects(()=>invoke('restore',damaged),/Checkpoint volume differs from retained material/);const preserved=await snapshot();assert.deepEqual(preserved.local.patch.values,before.local.patch.values);assert.deepEqual(preserved.local.patch.falling,before.local.patch.falling);report.rejectedDamagedCheckpoint=true;
 if(args.get('--negative-hidden')==='yes')await invoke('visibility',false);
 const bed=await capture('01-covered-bed');report.coveredSurface=changed(empty,bed);assert.ok(report.coveredSurface.visible,'actual covered bed must produce a coherent visible surface change');
 // Exact GPU/CPU comparison on a tiny actual same-device field, including static kiln support.
 if(args.get('--first-look')!=='yes'){
 report.phase='reference';await invoke('newPatch',{width:.66,height:.42,cellSize:.06,centerZ:1});await invoke('deposit',{volume:.015,radius:.22,center:[0,ground,1]});
 const initial=await snapshot(),physical=await invoke('diagnostics',{fields:true});let expected=Float32Array.from(initial.local.patch.values),pending=new Set(initial.local.patch.pendingTiles),previous=initial.local.patch.lastContact;
 report.parity=[];
 for(let step=0;step<8;step++){
  const contact=[-.12+step*.035,ground+.035,1,.11];await invoke('moveContact',{position:contact.slice(0,3),radius:contact[3]});
  const ref=referenceTileStep(initial.local.patch.layout,{values:expected,solid:physical.solid,pending,contact,previous,all:true});
  await invoke('advance',{steps:1});const actual=await snapshot();const max=actual.local.patch.values.reduce((m,v,i)=>Math.max(m,Math.abs(v-ref.values[i])),0);
  assert.ok(max<2e-6,'GPU tiled law differs from monolithic reference: '+max);assert.equal(actual.local.patch.visibleFaces,exposedFaces(initial.local.patch.layout,actual.local.patch.values,physical.solid).length);
  report.parity.push({step,max,actual,expected:Array.from(ref.values)});expected=ref.values;pending=ref.pending;previous=contact;
 }
 save();report.phase='contact-removal';await invoke('newPatch',{cellSize:1,width:1,height:2,centerZ:1.5});
 const held=await snapshot(),heldFields=await invoke('diagnostics',{fields:true});assert.deepEqual(heldFields.solid,[0,0]);
 held.local.patch.values=[0,1];held.local.patch.pendingTiles=[];held.local.patch.seededVolume=1;held.local.patch.volume=1;held.local.patch.retainedVolume=1;held.local.contact=[0,ground+.5,1.5];held.local.contactRadius=.6;held.local.contactEnabled=true;held.local.patch.lastContact=[...held.local.contact,.6];
 await invoke('restore',held);await invoke('advance',{steps:2});const heldQuiet=await snapshot();assert.deepEqual(heldQuiet.local.patch.values,[0,1]);assert.deepEqual(heldQuiet.local.patch.pendingTiles,[]);
 await invoke('contactEnabled',false);await invoke('advance',{steps:1});const released=await snapshot();assert.deepEqual(released.local.patch.values,[1,0]);report.removedContact={held:heldQuiet,released};save();
 await invoke('newPatch',inputs);await invoke('restore',before);
 report.phase='contact-seam';
 for(let k=0;k<7;k++){await invoke('moveContact',{position:[-.7+k*.23,ground+.025,1.35],radius:.14});await invoke('advance',{steps:4});await capture('drag-'+k);}
 const after=await snapshot();writeFileSync(resolve(out,'after.json'),JSON.stringify(after));assert.notDeepEqual(after.local.patch.values,before.local.patch.values);assert.ok(Math.abs(after.local.patch.retainedVolume-before.local.patch.retainedVolume)<1e-5);report.contactDiagnostics=await invoke('diagnostics');
 report.phase='sleep';await invoke('moveContact',{position:[2,ground+2,2]});
 let diagnostic;for(let n=0;;n++){await invoke('advance',{steps:8});diagnostic=await invoke('diagnostics');if(diagnostic.stats.activeTiles===0)break;if(n%16===0){report.sleepProgress={batches:n,diagnostic};save();}}
 report.sleep=diagnostic;assert.equal(diagnostic.stats.rebuiltTiles,0);const sleeping=await snapshot();writeFileSync(resolve(out,'sleeping.json'),JSON.stringify(sleeping));await capture('09-sleeping');
 await invoke('advance',{steps:2});const quiet=await invoke('diagnostics');assert.equal(quiet.stats.exchangeCellVisits,0);assert.deepEqual(quiet.tiles.map(t=>t.surfaceRevision),diagnostic.tiles.map(t=>t.surfaceRevision));
 report.phase='falling';await invoke('setSource',{position:[0,ground+.85,1.25],spread:.24,rate:.008});await invoke('burst',.012);await invoke('advance',{steps:8});const air=await snapshot();writeFileSync(resolve(out,'airborne.json'),JSON.stringify(air));assert.ok(air.local.patch.falling.particles.some((v,i)=>i%8===3&&v>0));await capture('10-arriving-ash');
 const continuation=async()=>{await invoke('advance',{steps:4});return snapshot();};const continued=await continuation();
 report.phase='reopen';await page.reload();await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='ash-tiled-landscape');await invoke('play',false);await invoke('restore',air);const restored=await snapshot();assert.deepEqual(restored.local.patch.values,air.local.patch.values);assert.deepEqual(restored.local.patch.falling.particles,air.local.patch.falling.particles);const replay=await continuation();assert.ok(Math.abs(replay.local.patch.retainedVolume-continued.local.patch.retainedVolume)<1e-5);assert.ok(replay.local.patch.values.reduce((m,v,i)=>Math.max(m,Math.abs(v-continued.local.patch.values[i])),0)<2e-6);report.continuation={retainedVolume:replay.local.patch.retainedVolume,expected:continued.local.patch.retainedVolume};await capture('11-reopened');
 }
 if(args.get('--first-look')!=='yes'){
 report.phase='retained-area';report.scaling=[];
 for(const width of [1.92,3.84]){
  await invoke('newPatch',{...inputs,width});await invoke('moveContact',{position:[0,ground+2,1.2],radius:.14});
  const state=await snapshot(),physical=await invoke('diagnostics',{fields:true}),p=state.local.patch.layout;
  // An explicit broad, already settled bed isolates local work from settling history.
  state.local.patch.values=state.local.patch.values.map((_,i)=>physical.solid[i]?0:Math.floor(i/p.dims[0])%p.dims[1]<2?1:Math.floor(i/p.dims[0])%p.dims[1]===2?.25:0);
  state.local.patch.pendingTiles=[];state.local.patch.lastContact=[0,ground+2,1.2,.14];state.local.patch.seededVolume=state.local.patch.values.reduce((s,v)=>s+v,0)*p.cellSize**3;state.local.patch.volume=state.local.patch.seededVolume;state.local.patch.retainedVolume=state.local.patch.seededVolume;
  writeFileSync(resolve(out,'broad-bed-'+width+'.json'),JSON.stringify(state));await invoke('restore',state);await invoke('advance',{steps:2});
  const quiet=await invoke('diagnostics');assert.equal(quiet.stats.activeTiles,0);assert.equal(quiet.stats.exchangeCellVisits,0);assert.equal(quiet.stats.rebuiltTiles,0);
  const baseline=await snapshot();await capture('broad-bed-'+width);
  // Set the old contact beside the first target, then exercise one identical local sweep.
  baseline.local.contact=[.15,ground+.025,1.2];baseline.local.contactRadius=.14;baseline.local.patch.lastContact=[...baseline.local.contact,.14];await invoke('restore',baseline);
  const work=[];for(let k=0;k<4;k++){
   await invoke('moveContact',{position:[.2+k*.04,ground+.025,1.2],radius:.14});await invoke('advance',{steps:1});work.push(await invoke('diagnostics'));
  }
  const disturbed=await snapshot();assert.notDeepEqual(disturbed.local.patch.values,baseline.local.patch.values);assert.ok(Math.abs(disturbed.local.patch.retainedVolume-baseline.local.patch.retainedVolume)<1e-5);
  await capture('broad-disturbed-'+width);const effective=await invoke('read');report.scaling.push({width,layout:p,allocatedBytes:effective.allocatedBytes,quiet,work,retainedVolume:disturbed.local.patch.retainedVolume});save();
 }
 assert.equal(report.scaling[1].layout.count,4*report.scaling[0].layout.count);
 assert.equal(report.scaling[1].work[0].stats.exchangeCellVisits,report.scaling[0].work[0].stats.exchangeCellVisits,'same initial local disturbance must have equal cell work in four times the retained area');
 assert.ok(report.scaling[1].work[0].stats.activeTiles<report.scaling[1].layout.tiles.count);
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[]);report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack??error);if(page){report.lastPage=await page.evaluate(()=>({text:document.body.innerText,state:window.kaminosWorkbenchExperiments?.state()})).catch(String);await page.screenshot({path:resolve(out,'failed.png')}).catch(()=>{});}process.exitCode=1;
}finally{await browser?.close();report.browserClosed=true;save();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,report:resolve(out,'report.json')}));}
