// Actual native scene editing, field retention and local cadence comparison.
// Caller supplies an observed preset and independent browser paths. Run timing through Greenroom.
import fs from 'node:fs/promises';
import path from 'node:path';
import {reserveWitnessPort,spawnWitnessServer,finishWitness} from './witness-process.mjs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {coverageSceneUrl,coverageSceneLoaded} from './automatic-coverage-load.mjs';
const [out,presetFile]=process.argv.slice(2);
assert.ok(out&&presetFile,'Caller-owned output and observed preset required');
await fs.mkdir(out,{recursive:true});
const materialWidth=Number(process.argv.find(a=>a.startsWith('--material-width='))?.split('=')[1]??32);
const root=process.cwd(),report={status:'failed',phase:'setup',root,errors:[],arms:[]};
let server,browser,page;
const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
let sourceFiles;
const discoverSources=()=>execFileSync('git',['ls-files','-co','--exclude-standard'],{encoding:'utf8'}).trim().split('\n').filter(f=>/^(volume-|experiments\/material-hierarchy|tools\/(witness-process|automatic-coverage|live-domain|domain-remap)|index.html|scene-edit-session)/.test(f));
const hashes=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async f=>[f,createHash('sha256').update(await fs.readFile(path.join(root,f))).digest('hex')])));
try{
 assert.ok(Number.isInteger(materialWidth)&&materialWidth>=16&&materialWidth%16===0,'Material width must be a multiple of sixteen');
 await fs.access(path.join(root,'node_modules/three-mesh-bvh/build/index.module.js'));report.materialWidth=materialWidth;
 report.phase='source-discovery';report.source=null;await save();sourceFiles=discoverSources();
 report.commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();report.source=await hashes();
 report.phase='preset-preparation';await save();
 const dirs=Object.fromEntries(['settings','sessions','layouts','scenes','profile'].map(k=>[k,path.join(out,k)]));
 for(const d of Object.values(dirs))await fs.mkdir(d,{recursive:true});
 await fs.mkdir(path.join(dirs.settings,'presets'),{recursive:true});await fs.copyFile(presetFile,path.join(dirs.settings,'presets',path.basename(presetFile)));
 report.preset={path:presetFile,sha256:createHash('sha256').update(await fs.readFile(presetFile)).digest('hex')};
 report.phase='port-reservation';await save();const port=await reserveWitnessPort();
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('KAMINOS_')));
 report.server={port,args:['-u','serve.py',String(port),'--volume-settings-store',dirs.settings,'--no-shared-basin-store','--volume-basin-session-store',dirs.sessions,'--volume-cockpit-layout-store',dirs.layouts]};
 report.phase='server-spawn';await save();
 const log=await fs.open(path.join(out,'server.log'),'a');
 try{server=await spawnWitnessServer('python3',report.server.args,{cwd:root,env:{...env,KAMINOS_BIND_HOST:'127.0.0.1',KAMINOS_SCENES_DIR:dirs.scenes},stdio:['ignore',log.fd,log.fd]},child=>{server=child;report.server.pid=child.pid??null;});}finally{await log.close();}
 report.phase='server';await save();const origin='http://127.0.0.1:'+port;report.origin=origin;
 for(;;){if(server.witnessError)throw server.witnessError;if(server.exitCode!==null)throw Error('Server exited '+server.exitCode);try{const r=await fetch(origin+'/api/runtime-config');if(r.ok){report.runtime=await r.json();break;}}catch{}await new Promise(r=>setTimeout(r,100));}
 assert.equal(report.runtime.source.repoRoot,root);assert.equal(report.runtime.sharedBasinStore,null);
 report.phase='browser-start';await save();
 report.executable=process.env.CHROME_EXECUTABLE;assert.ok(report.executable?.includes('Google Chrome for Testing'));
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
 browser=await chromium.launchPersistentContext(dirs.profile,{executablePath:report.executable,headless:true,viewport:{width:1440,height:1000},args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 browser.setDefaultTimeout(0);browser.setDefaultNavigationTimeout(0);page=await browser.newPage();
 page.on('response',r=>{if(r.status()>=400)report.errors.push(`HTTP ${r.status()} ${r.url()}`);});
 page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 report.phase='entry-error-control';await save();await page.goto(origin+'/volume-settings-preset.html');
 await assert.rejects(page.waitForFunction(coverageSceneLoaded),/settings preset id is required/);
 report.expectedEntryErrors=report.errors.splice(0);assert.ok(report.expectedEntryErrors.some(e=>e.includes('settings preset id is required')));
 report.phase='load';await save();await page.goto(origin+'/index.html?workspace=authoring');if(report.errors.length)throw Error(report.errors.join('\n'));

 await page.waitForFunction(()=>window.kaminosSceneAuthoring?.addFlameEmitter);
 report.phase='scene-create';await save();
 await page.evaluate(id=>window.kaminosSceneAuthoring.addFlameEmitter(id),path.basename(presetFile,'.json'));
 const control=async(id,value)=>page.evaluate(({id,value})=>{const e=document.getElementById(id);if(!e)throw Error('Missing '+id);e.value=String(value);if(e.value!==String(value))throw Error('Rejected '+id);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},{id,value});
 for(const [id,v] of Object.entries({'volume-look-freeze':1,'volume-resolution':materialWidth,'volume-grid-height-ratio':2,'volume-fine-velocity':materialWidth/2,'volume-fine-pressure':materialWidth/4,'volume-render-scale':.5,'volume-steps':8,'volume-pressure-solver-iterations':12,'volume-world-smoke':'on','volume-world-smoke-flow':8,'volume-world-smoke-material':16,'volume-world-smoke-pressure':4,'volume-world-smoke-iterations':12,'volume-world-smoke-intermediate':'off'}))await control(id,v);
 await page.waitForFunction(()=>window.kaminosWorkbenchExperiments);
 await page.evaluate(async()=>{await window.kaminosWorkbenchExperiments.open('material-hierarchy',{overlay:true});await window.kaminosWorkbenchExperiments.invoke('setOptions',{budget:1,maxDetail:2});await window.kaminosWorkbenchExperiments.invoke('setEnabled',true);window.selectSceneField('flame-field');window.kaminosSetCameraDebugPose({position:[14,10,18],target:[0,4,0]});});

 const state=()=>page.evaluate(()=>{
   const d=window.__kaminosVolumePrototype.debugState(),a=window.__kaminosVolumePrototype.adaptiveMaterialState();
   return {backend:d.backend,active:d.active,error:d.error,frame:d.frameCount,step:d.simStepCount,
     allocation:d.thermalFluidAllocationId,resets:d.fluidStateResetCount,remap:d.domainRemap,
     pose:window.kaminosFlameDomain.read(),sources:window.kaminosSceneAuthoring.read().objects.filter(x=>x.type==='flame-emitter'),
     world:d.worldSmoke,adaptive:a,controls:d.controls,timing:d.timing,coverage:window.kaminosFineCoverage.read(),coverageInput:window.__kaminosVolumePrototype.fineCoverageInputs({activity:true})};
 });
 const authoredSource=({id,type,transform,sceneTransform,emissionEnabled,emission})=>({id,type,transform,sceneTransform,emissionEnabled,domainId:emission?.domainId});
 const check=(s,prior,{advancing=false}={})=>{
   assert.match(s.backend,/^webgpu:apple/i);assert.equal(s.active,true);assert.ok(!s.error,s.error);
   assert.ok(s.adaptive.effective);assert.ok(!s.adaptive.error);
   assert.equal(s.world.worldAnchored,true);
   if(prior){
     assert.equal(s.allocation,prior.allocation,'must retain Fine allocation');assert.equal(s.resets,prior.resets,'must not reset Fine');
     assert.deepEqual(s.world.anchor,prior.world.anchor,'World anchor must stay fixed');
     assert.deepEqual(s.adaptive.effective.anchor,prior.adaptive.effective.anchor,'adaptive anchor must stay fixed');
     assert.equal(s.world.identity,prior.world.identity);assert.equal(s.adaptive.effective.identity,prior.adaptive.effective.identity);
     for(const [name,now,then] of [['Fine',s.step,prior.step],['World',s.world.steps,prior.world.steps],['adaptive',s.adaptive.effective.steps,prior.adaptive.effective.steps]]){
       assert.ok(Number.isFinite(now)&&Number.isFinite(then),`${name} step receipt required`);
       assert.ok(advancing?now>then:now>=then,`${name} must ${advancing?'advance':'not restart'}`);
     }
   }
 };
 const capture=async name=>{const s=await state();check(s);report.arms.push({name,...s});await save();await page.screenshot({path:path.join(out,name+'.png')});return s;};
 const waitSteps=async n=>{const s=await state();await page.waitForFunction(({step,n})=>{const d=window.__kaminosVolumePrototype.debugState();if(d.error)throw Error(d.error);return d.simStepCount>=step+n;},{step:s.step,n});};
 const waitRemap=async count=>page.waitForFunction(count=>{const d=window.__kaminosVolumePrototype.debugState();if(d.error)throw Error(d.error);return d.domainRemap?.count>count;},count);
 report.phase='warmup';await save();await control('volume-look-freeze',0);await waitSteps(30);
 const initial=await capture('initial');check(initial);
 for(const mutate of [s=>s.backend='software',s=>s.allocation='replacement',s=>s.resets++,s=>s.step=-1,s=>s.adaptive.effective=null]){const lie=structuredClone(initial);mutate(lie);assert.throws(()=>check(lie,initial));}
 report.negativeChecks=['software backend','replacement allocation','reset field','restarted clock','missing adaptive field'];
 const source=await page.evaluate(()=>window.kaminosFlameEmitterState());
 report.sourceBefore=source;
 const id=source.sources[0].id,pose=source.pose,scale=initial.pose.scale;
 const patch=async options=>page.evaluate(options=>window.kaminosFineCoverage.set(options),options);
 await patch({mode:'sources',margin:.15,headroom:.75,lookahead:0,interval:.25,hysteresis:.05});
 const move=async p=>page.evaluate(({id,p})=>window.kaminosSetSceneObjectTransform(id,p),{id,p});
 const elevated={...pose,position:pose.position.map((x,a)=>x+(a===1?scale*3.6:0))};
 report.phase='upward-source';await save();await move(elevated);await waitSteps(30);
 const up=await capture('upward-source');check(up,initial,{advancing:true});
 assert.ok(up.pose.translation[1]>initial.pose.translation[1]+scale*.5,'Fine must follow the source upward');
 assert.equal(up.pose.scale,initial.pose.scale);assert.ok(up.coverage.moves>0);assert.notEqual(up.coverage.status,'error');
 assert.deepEqual((await page.evaluate(()=>window.kaminosFlameEmitterState())).pose,elevated,'moving coverage must preserve source pose');
 // Close the panel; following belongs to the runtime, not its mounted editor.
 report.phase='panel-closed';await save();await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());
 await move(pose);await waitSteps(30);const closed=await capture('panel-closed');check(closed,up,{advancing:true});assert.ok(closed.coverage.moves>up.coverage.moves);
 report.phase='cadence-controls';await save();
 report.cadence=[];
 for(const interval of [0,.5]){
  await patch({interval});
  const rows=await page.evaluate(async({id,pose,scale,interval})=>{
   const edits=window.kaminosSceneEdits,proto=window.__kaminosVolumePrototype,rows=[];edits.begin(id,'Coverage tracking witness');
   for(let i=0;i<60;i++){
    const at=await new Promise(requestAnimationFrame);const p={...pose,position:pose.position.map((x,a)=>x+(a===0?scale*1.3*Math.sin(i/59*2*Math.PI):a===1?scale*.8*Math.sin(i/59*Math.PI):0))};
    edits.preview(p);const d=proto.debugState(),c=window.kaminosFineCoverage.read();if(d.error||c.status==='error')throw Error(d.error||c.error);
    rows.push({at,step:d.simStepCount,frame:d.frameCount,moves:c.moves,checks:c.checks,remap:d.domainRemap?.count??0,pose:p,coverage:window.kaminosFlameDomain.read(),status:c.status});
   }
   edits.commit();return {interval,rows};
  },{id,pose,scale,interval});
  report.cadence.push(rows);await save();
 }
 for(const arm of report.cadence){const rows=arm.rows;assert.equal(rows.length,60);assert.ok(rows.at(-1).step>rows[0].step);assert.ok(rows.at(-1).remap>rows[0].remap,'each policy must actually move');}
 const delayed=report.cadence[1];for(let i=1;i<delayed.rows.length;i++)if(delayed.rows[i].checks>delayed.rows[i-1].checks){const prev=delayed.rows.slice(0,i).findLast((r,j,a)=>j===0||r.checks>a[j-1].checks);if(prev&&prev!==delayed.rows[0])assert.ok(delayed.rows[i].at-prev.at>=480,'cadence must honor half-second checks');}
 const followed=await capture('followed');check(followed,closed,{advancing:true});
 report.phase='fire-demand';await save();await patch({mode:'fire',activityWeight:1,interval:.25});await waitSteps(30);
 const demand=await capture('fire-demand');check(demand,followed,{advancing:true});assert.equal(demand.coverage.demandStatus,'measured');assert.ok(demand.coverageInput.demand.some(b=>b.weight>0));
 report.phase='disabled';await save();await patch({mode:'off'});await waitSteps(3);const off=await state();await move(elevated);await waitSteps(20);const stayed=await state();assert.deepEqual(stayed.pose,off.pose,'disabled policy must leave the box fixed');
 report.phase='visible-controls';await save();
 await page.evaluate(async()=>{window.kaminosWorkspace.setMode('workbench');await window.kaminosWorkbenchExperiments.open('material-hierarchy',{overlay:true});});
 const mode=page.locator('[data-coverage="mode"]');await mode.selectOption('sources');
 const intervalField=page.locator('[data-coverage="interval"]');await intervalField.click();await intervalField.fill('0.5');await intervalField.blur();
 await page.waitForFunction(()=>window.kaminosFineCoverage.read().options.mode==='sources'&&window.kaminosFineCoverage.read().options.interval===.5);
 const visible=await page.locator('[data-coverage]').evaluateAll(es=>es.map(e=>({key:e.dataset.coverage,visible:e.checkVisibility()})));
 report.visibleCoverageControls=visible.filter(e=>e.visible).length;assert.equal(report.visibleCoverageControls,7,'All native controls must be mounted and visible');
 await intervalField.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'coverage-controls.png')});
 report.phase='settings-save';report.savedOptions=await page.evaluate(()=>window.kaminosFineCoverage.read().options);await save();
 const settings=await page.evaluate(()=>window.kaminosFlameAuthoring.read());assert.equal(settings.domControls['volume-coverage-mode'].value,'sources');assert.equal(Number(settings.domControls['volume-coverage-interval'].value),.5);
 await fs.writeFile(path.join(out,'authored-settings.json'),JSON.stringify(settings,null,2));
 report.savedScene=await page.evaluate(()=>window.saveSceneAs({result:true,name:'Automatic Fine coverage — moving fire'}));assert.equal(report.savedScene.ok,true);await save();
 report.savedBasin=await page.evaluate(()=>window.__kaminosSaveVolumeSettingsPreset({label:'Automatic Fine coverage — moving fire'}));assert.equal(report.savedBasin.ok,true);await save();
 // Keep the source still, displace coverage through the native editor, then
 // remove the source. Only real measured gas can bring Fine back afterwards.
 report.phase='source-free-gas';await save();await patch({mode:'off'});
 await page.evaluate(()=>{
  const edits=window.kaminosSceneEdits,i=window.__kaminosVolumePrototype.fineCoverageInputs(),p=edits.begin('@flame-domain','Displace coverage from retained gas').active.before;
  const ends=[i.world.lo[0]+i.frame.scale,i.world.hi[0]-i.frame.scale];
  const x=ends.sort((a,b)=>Math.abs(b-p.position[0])-Math.abs(a-p.position[0]))[0];edits.preview({...p,position:[x,p.position[1],p.position[2]]});edits.commit();
 });
 await waitSteps(3);await page.evaluate(id=>window.kaminosBurnerAuthoring.remove(id),id);await waitSteps(3);
 await patch({mode:'sources'});await waitSteps(3);const noSource=await state();assert.equal(noSource.sources.length,0);assert.equal(noSource.coverage.status,'no-demand');
 await patch({mode:'fire',activityWeight:0,hysteresis:0,lookahead:0,interval:0});await waitSteps(3);const zero=await state();assert.deepEqual(zero.pose,noSource.pose,'Zero priority cannot chase residual gas');
 await patch({activityWeight:1});await waitSteps(15);const gas=await capture('source-free-gas');check(gas,zero,{advancing:true});
 assert.equal(gas.sources.length,0,'Following gas cannot recreate an emitter');assert.ok(gas.coverage.moves>zero.coverage.moves,'Measured gas must move Fine with no source');report.gasComparison={sourceOnly:noSource.coverage,zero:zero.coverage,gas:gas.coverage};
 // Fresh ordinary scene load must restore all seven controls, then a real
 // basin save/load must replace an intentionally different policy.
 report.phase='scene-reload';await save();const url=coverageSceneUrl(report.savedScene.url,origin);report.savedUrl=url;
 await page.goto(url);await page.waitForFunction(coverageSceneLoaded);
 const savedOptions=report.savedOptions;
 const restored=await state();assert.deepEqual(restored.coverage.options,savedOptions);report.sceneRestored=restored.coverage;
 report.phase='basin-reload';await save();await patch({mode:'off',interval:2});
 await page.evaluate(id=>window.kaminosFlameAuthoring.applyBasin(id),report.savedBasin.effective.presetId);
 await waitSteps(3);const basin=await state();assert.deepEqual(basin.coverage.options,savedOptions);report.basinRestored=basin.coverage;
 await page.locator('[data-coverage="mode"]').scrollIntoViewIfNeeded();await capture('final-panel');
 report.final=await state();assert.deepEqual(report.errors,[]);assert.deepEqual(await hashes(),report.source,'Source changed during run');report.status='passed';report.phase='complete';
}catch(e){report.error=e.stack;if(page)try{report.failureState=await page.evaluate(()=>window.__kaminosVolumePrototype?.debugState());await page.screenshot({path:path.join(out,'failure.png')});}catch(c){report.captureError=String(c);}process.exitCode=1;}
finally{await finishWitness(report,{browser,server,save});}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));
