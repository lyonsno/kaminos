// Actual native scene editing, field retention and local cadence comparison.
// Caller supplies an observed preset and independent browser paths. Run timing through Greenroom.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [out,presetFile]=process.argv.slice(2);
assert.ok(out&&presetFile,'Caller-owned output and observed preset required');
await fs.mkdir(out,{recursive:true});
const materialWidth=Number(process.argv.find(a=>a.startsWith('--material-width='))?.split('=')[1]??32);
const root=process.cwd(),report={status:'failed',phase:'setup',root,errors:[],arms:[]};
let server,browser,page;
const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
let sourceFiles;
const discoverSources=()=>execFileSync('git',['ls-files','-co','--exclude-standard'],{encoding:'utf8'}).trim().split('\n').filter(f=>/^(volume-|experiments\/material-hierarchy|tools\/live-domain|index.html|scene-edit-session)/.test(f));
const hashes=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async f=>[f,createHash('sha256').update(await fs.readFile(path.join(root,f))).digest('hex')])));
try{
 assert.ok(Number.isInteger(materialWidth)&&materialWidth>=16&&materialWidth%16===0,'Material width must be a multiple of sixteen');
 await fs.access(path.join(root,'node_modules/three-mesh-bvh/build/index.module.js'));report.materialWidth=materialWidth;
 report.phase='source-discovery';report.source=null;await save();sourceFiles=discoverSources();
 report.commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();report.source=await hashes();
 const dirs=Object.fromEntries(['settings','sessions','layouts','scenes','profile'].map(k=>[k,path.join(out,k)]));
 for(const d of Object.values(dirs))await fs.mkdir(d,{recursive:true});
 await fs.mkdir(path.join(dirs.settings,'presets'),{recursive:true});await fs.copyFile(presetFile,path.join(dirs.settings,'presets',path.basename(presetFile)));
 report.preset={path:presetFile,sha256:createHash('sha256').update(await fs.readFile(presetFile)).digest('hex')};
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('KAMINOS_')));
 report.server={port,args:['-u','serve.py',String(port),'--volume-settings-store',dirs.settings,'--no-shared-basin-store','--volume-basin-session-store',dirs.sessions,'--volume-cockpit-layout-store',dirs.layouts]};
 const log=await fs.open(path.join(out,'server.log'),'a');
 server=spawn('python3',report.server.args,{cwd:root,env:{...env,KAMINOS_BIND_HOST:'127.0.0.1',KAMINOS_SCENES_DIR:dirs.scenes},stdio:['ignore',log.fd,log.fd]});report.server.pid=server.pid;await log.close();
 report.phase='server';await save();const origin='http://127.0.0.1:'+port;report.origin=origin;
 for(;;){if(server.exitCode!==null)throw Error('Server exited '+server.exitCode);try{const r=await fetch(origin+'/api/runtime-config');if(r.ok){report.runtime=await r.json();break;}}catch{}await new Promise(r=>setTimeout(r,100));}
 assert.equal(report.runtime.source.repoRoot,root);assert.equal(report.runtime.sharedBasinStore,null);
 report.executable=process.env.CHROME_EXECUTABLE;assert.ok(report.executable?.includes('Google Chrome for Testing'));
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
 browser=await chromium.launchPersistentContext(dirs.profile,{executablePath:report.executable,headless:true,viewport:{width:1100,height:800},args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 browser.setDefaultTimeout(0);browser.setDefaultNavigationTimeout(0);page=await browser.newPage();
 page.on('response',r=>{if(r.status()>=400)report.errors.push(`HTTP ${r.status()} ${r.url()}`);});
 page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 report.phase='load';await save();await page.goto(origin+'/index.html?workspace=authoring');if(report.errors.length)throw Error(report.errors.join('\n'));

 await page.waitForFunction(()=>window.kaminosSceneAuthoring?.addFlameEmitter);
 report.phase='scene-create';await save();
 await page.evaluate(id=>window.kaminosSceneAuthoring.addFlameEmitter(id),path.basename(presetFile,'.json'));
 const control=async(id,value)=>page.evaluate(({id,value})=>{const e=document.getElementById(id);if(!e)throw Error('Missing '+id);e.value=String(value);if(e.value!==String(value))throw Error('Rejected '+id);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},{id,value});
 for(const [id,v] of Object.entries({'volume-look-freeze':1,'volume-resolution':materialWidth,'volume-grid-height-ratio':2,'volume-fine-velocity':materialWidth/2,'volume-fine-pressure':materialWidth/4,'volume-render-scale':.5,'volume-steps':8,'volume-pressure-solver-iterations':12,'volume-world-smoke':'on','volume-world-smoke-flow':8,'volume-world-smoke-material':16,'volume-world-smoke-pressure':4,'volume-world-smoke-iterations':12,'volume-world-smoke-intermediate':'off'}))await control(id,v);
 await page.waitForFunction(()=>window.kaminosWorkbenchExperiments);
 await page.evaluate(async()=>{await window.kaminosWorkbenchExperiments.open('material-hierarchy',{enabled:true,overlay:true,options:{budget:1,maxDetail:2}});window.selectSceneField('flame-field');window.kaminosSetCameraDebugPose({position:[14,10,18],target:[0,4,0]});});

 const state=()=>page.evaluate(()=>{
   const d=window.__kaminosVolumePrototype.debugState(),a=window.__kaminosVolumePrototype.adaptiveMaterialState();
   return {backend:d.backend,active:d.active,error:d.error,frame:d.frameCount,step:d.simStepCount,
     allocation:d.thermalFluidAllocationId,resets:d.fluidStateResetCount,remap:d.domainRemap,
     pose:window.kaminosFlameDomain.read(),sources:window.kaminosSceneAuthoring.read().objects.filter(x=>x.type==='flame-emitter'),
     world:d.worldSmoke,adaptive:a,controls:d.controls,timing:d.timing};
 });
 const check=(s,prior)=>{
   assert.match(s.backend,/^webgpu:apple/i);assert.equal(s.active,true);assert.ok(!s.error,s.error);
   assert.ok(s.adaptive.effective);assert.ok(!s.adaptive.error);
   if(prior){assert.equal(s.allocation,prior.allocation,'must retain Fine allocation');assert.equal(s.resets,prior.resets,'must not reset Fine');assert.ok(s.step>=prior.step,'clock must continue');assert.ok(s.world.steps>=prior.world.steps,'World must continue');}
 };
 const capture=async name=>{const s=await state();check(s);report.arms.push({name,...s});await save();await page.screenshot({path:path.join(out,name+'.png')});return s;};
 const waitSteps=async n=>{const s=await state();await page.waitForFunction(({step,n})=>{const d=window.__kaminosVolumePrototype.debugState();if(d.error)throw Error(d.error);return d.simStepCount>=step+n;},{step:s.step,n});};
 const waitRemap=async count=>page.waitForFunction(count=>{const d=window.__kaminosVolumePrototype.debugState();if(d.error)throw Error(d.error);return d.domainRemap?.count>count;},count);
 report.phase='warmup';await save();await control('volume-look-freeze',0);await waitSteps(80);await control('volume-look-freeze',1);
 const initial=await capture('before-move');
 for(const mutate of [s=>s.backend='software',s=>s.allocation='replacement',s=>s.resets++,s=>s.step=-1,s=>s.adaptive.effective=null]){const lie=structuredClone(initial);mutate(lie);assert.throws(()=>check(lie,initial));}
 report.negativeChecks=['software backend','replacement allocation','reset field','restarted clock','missing adaptive field'];
 // Retain raw actual solver fields around an integer-cell native editor move.
 report.phase='paused-integer-transfer';await save();
 const beforeField=await page.evaluate(()=>window.__kaminosVolumePrototype.sampleReactantFields());assert.equal(beforeField.ok,true);
 await fs.writeFile(path.join(out,'before-field.json'),JSON.stringify(beforeField));
 const pose=await page.evaluate(()=>window.kaminosSceneEdits.begin('@flame-domain','Live domain transfer').active.before);
 const cellWidth=2*initial.pose.scale/materialWidth;
 await page.evaluate(({pose,cellWidth})=>window.kaminosSceneEdits.preview({...pose,position:pose.position.map((v,i)=>v+(i===0?cellWidth:0))}),{pose,cellWidth});
 await waitRemap(initial.remap?.count||0);
 const afterField=await page.evaluate(()=>window.__kaminosVolumePrototype.sampleReactantFields());assert.equal(afterField.ok,true);
 await fs.writeFile(path.join(out,'after-field.json'),JSON.stringify(afterField));
 const decode=b64=>{const b=Buffer.from(b64,'base64');return new Float32Array(b.buffer,b.byteOffset,b.byteLength/4);};
 const old=decode(beforeField.fluidBase64),fresh=decode(afterField.fluidBase64),dims=beforeField.grid;
 let maxError=0,signal=0;
 for(let z=0;z<dims[2];z++)for(let y=0;y<dims[1];y++)for(let x=0;x<dims[0]-1;x++)for(let c=0;c<16;c++){
   const i=(x+y*dims[0]+z*dims[0]*dims[1])*16+c,j=i+16;
   assert.ok(Number.isFinite(fresh[i]));maxError=Math.max(maxError,Math.abs(fresh[i]-old[j]));signal+=Math.abs(old[j]);
 }
 assert.ok(signal>0,'nonempty flame required');assert.ok(maxError<.002,'integer move must retain solver fields, error '+maxError);
 report.pausedTransfer={maxError,signal,dims,cellWidth};
 const moved=await capture('paused-moved');check(moved,initial);assert.equal(moved.step,initial.step);assert.deepEqual(moved.sources,initial.sources,'coverage movement must not move authored emitters');
 await page.evaluate(()=>window.kaminosSceneEdits.cancel());await waitRemap(moved.remap.count);
 const cancelled=await capture('cancelled');check(cancelled,initial);assert.deepEqual(cancelled.pose,initial.pose);
 // Cadence uses the same inexpensive render configuration for both arms.
 // Raw per-frame intervals and actual simulation/frame counters are retained.
 await control('volume-look-freeze',0);await waitSteps(10);
 report.phase='live-cadence';await save();
 report.cadence=await page.evaluate(async()=>{
   const proto=window.__kaminosVolumePrototype,edits=window.kaminosSceneEdits;
   const run=async(moving)=>{
     const pose=moving?edits.begin('@flame-domain','Continuous coverage move and scale').active.before:null;
     const rows=[];let previous;
     for(let i=0;i<90;i++){
       const now=await new Promise(requestAnimationFrame),d=proto.debugState();
       if(d.error)throw Error(d.error);
       rows.push({at:now,dt:previous===undefined?null:now-previous,frame:d.frameCount,step:d.simStepCount,allocation:d.thermalFluidAllocationId,resets:d.fluidStateResetCount,remapCount:d.domainRemap?.count||0});previous=now;
       if(moving){const phase=i/89*2*Math.PI;edits.preview({...pose,position:pose.position.map((v,a)=>v+(a===0?.25*Math.sin(phase):0)),scale:pose.scale.map(v=>v*(1+.12*Math.sin(phase)))});}
     }
     if(moving)edits.commit();return rows;
   };
   return {before:await run(false),moving:await run(true),after:await run(false)};
 });
 const live=await capture('after-live-drag');check(live,initial);
 for(const rows of Object.values(report.cadence)){assert.equal(rows.length,90);for(const r of rows){assert.equal(r.allocation,initial.allocation);assert.equal(r.resets,initial.resets);}assert.ok(rows.at(-1).step>rows[0].step);}
 assert.ok(report.cadence.moving.at(-1).remapCount-report.cadence.moving[0].remapCount>60,'drag must exercise remapping across frames');
 // Non-overlap jump, scale, normal history and paused rendering path.
 report.phase='jump-and-history';await save();
 await page.evaluate(pose=>window.kaminosSceneEdits.apply('@flame-domain',{...pose,position:pose.position.map((v,i)=>v+(i===0?8:0)),scale:pose.scale.map(v=>v*1.3)},'Coverage jump'),pose);
 await waitSteps(8);const jumped=await capture('jumped');check(jumped,initial);
 await page.evaluate(()=>window.kaminosSceneEdits.undo());await waitSteps(8);check(await capture('undo-jump'),initial);
 await page.evaluate(()=>window.kaminosSceneEdits.redo());await waitSteps(8);check(await capture('redo-jump'),initial);
 await page.evaluate(()=>window.kaminosSceneEdits.undo());await waitSteps(8);check(await capture('restored'),initial);
 report.final=await state();assert.deepEqual(report.errors,[]);assert.deepEqual(await hashes(),report.source,'Source changed during run');report.status='passed';report.phase='complete';
}catch(e){report.error=e.stack;if(page)try{report.failureState=await page.evaluate(()=>window.__kaminosVolumePrototype?.debugState());await page.screenshot({path:path.join(out,'failure.png')});}catch(c){report.captureError=String(c);}process.exitCode=1;}
finally{await browser?.close();report.browserClosed=true;if(server&&server.exitCode===null){const stopped=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await stopped;}report.serverClosed=true;await save();}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));
