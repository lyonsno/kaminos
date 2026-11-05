// Actual authoring consumer; isolated writable stores; no timing verdict.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {solidCubeCadenceNative} from './solid-cube-cadence-native.mjs';
import {compositionRestoreUrl} from '../scene-authoring.mjs';
const [out,presetFile]=process.argv.slice(2);
assert.ok(out&&presetFile,'Caller-owned output and observed preset required');
await fs.mkdir(out,{recursive:true});
const materialWidth=32;
const root=process.cwd(),report={status:'failed',phase:'setup',root,errors:[],arms:[]};
let server,browser,page;
const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
let sourceFiles;
const discoverSources=()=>execFileSync('git',['ls-files','-co','--exclude-standard'],{encoding:'utf8'}).trim().split('\n').filter(f=>/^(volume-|scene-|fire-|tools\/solid-cube-cadence|index.html)/.test(f));
const hashes=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async f=>[f,createHash('sha256').update(await fs.readFile(path.join(root,f))).digest('hex')])));
try{
 assert.ok(Number.isInteger(materialWidth)&&materialWidth>=16&&materialWidth%16===0,'Material width must be a multiple of sixteen');
 await fs.access(path.join(root,'node_modules/three-mesh-bvh/build/index.module.js'));report.materialWidth=materialWidth;
 report.phase='source-discovery';report.source=null;await save();sourceFiles=discoverSources();
 report.commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();report.source=await hashes();
 const dirs=Object.fromEntries(['home','settings','sessions','layouts','scenes','profile'].map(k=>[k,path.join(out,k)]));
 for(const d of Object.values(dirs))await fs.mkdir(d,{recursive:true});
 await fs.mkdir(path.join(dirs.home,'.local/state/gpu-greenroom/done'),{recursive:true});
 await fs.mkdir(path.join(dirs.settings,'presets'),{recursive:true});await fs.copyFile(presetFile,path.join(dirs.settings,'presets',path.basename(presetFile)));
 report.preset={path:presetFile,sha256:createHash('sha256').update(await fs.readFile(presetFile)).digest('hex')};
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('KAMINOS_')));
 report.server={port,args:['-u','serve.py',String(port),'--volume-settings-store',dirs.settings,'--no-shared-basin-store','--volume-basin-session-store',dirs.sessions,'--volume-cockpit-layout-store',dirs.layouts]};
 const log=await fs.open(path.join(out,'server.log'),'a');
 server=spawn('python3',report.server.args,{cwd:root,env:{...env,HOME:dirs.home,KAMINOS_BIND_HOST:'127.0.0.1',KAMINOS_SCENES_DIR:dirs.scenes},stdio:['ignore',log.fd,log.fd]});report.server.pid=server.pid;await log.close();
 report.phase='server';await save();const origin='http://127.0.0.1:'+port;report.origin=origin;
 for(;;){if(server.exitCode!==null)throw Error('Server exited '+server.exitCode);try{const r=await fetch(origin+'/api/runtime-config');if(r.ok){report.runtime=await r.json();break;}}catch{}await new Promise(r=>setTimeout(r,100));}
 assert.equal(report.runtime.source.repoRoot,root);assert.equal(report.runtime.sharedBasinStore,null);
 report.executable=process.env.CHROME_EXECUTABLE;assert.ok(report.executable?.includes('Google Chrome for Testing'));
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
 browser=await chromium.launchPersistentContext(dirs.profile,{executablePath:report.executable,headless:true,viewport:{width:1100,height:800},args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 browser.setDefaultTimeout(0);browser.setDefaultNavigationTimeout(0);page=await browser.newPage();
 page.on('response',r=>{if(r.status()>=400)report.errors.push(`HTTP ${r.status()} ${r.url()}`);});
 page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});

 report.phase='native';await save();
 await page.route('**/solid-cube-native-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Solid cube cadence conformance</title>'}));
 await page.goto(origin+'/solid-cube-native-fixture');report.native=await page.evaluate(solidCubeCadenceNative);await save();
 const n=report.native;assert.equal(n.validation,null);assert.deepEqual(n.errors,[]);assert.equal(n.outputFrame,true);
 assert.equal(n.rows.length,5);assert.deepEqual(n.rows[0].state.solidShadowCapture.ages,[0,0,0,0,0,0]);
 const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
 for(let f=0;f<n.rows.length;f++){
  const row=n.rows[f],selected=row.state.solidShadowCapture.refreshedIndices;
  assert.equal(row.state.residentShadowCount,6);assert.equal(row.state.evaluatedPointCount,6);assert.equal(row.state.frame.frame,f+1);
  assert.equal(row.origins.capture.ordinal,f+1);assert.equal(row.points.frame,f+1);assert.ok(row.state.shadows.every(s=>s.effective));
  for(let i=0;i<6;i++){
   const p=row.origins.sources[i].world,live=row.points.regions[i].position;
   if(selected.includes(i))assert.ok(distance(p,live)<1e-5,`frame${f} slot${i} captured GPU centroid`);
   else{assert.deepEqual(p,n.rows[f-1].origins.sources[i].world);assert.deepEqual(row.cubes[i],n.rows[f-1].cubes[i]);}
   if(f)assert.equal(row.state.shadows[i].renderCount-n.rows[f-1].state.shadows[i].renderCount,selected.includes(i)?1:0);
  }
  if(f>0&&f<4){assert.equal(selected.length,2);assert.ok(row.state.solidShadowCapture.oldestAge<=2);assert.ok(row.origins.sources.some((p,i)=>!selected.includes(i)&&distance(p.world,row.points.regions[i].position)>1e-4),'moving source must distinguish retained and live coordinates');}
 }
 assert.ok(n.rows[1].points.regions.some((r,i)=>distance(r.energy,n.rows[0].points.regions[i].energy)>1e-3),'live power must change');
 assert.ok(n.rows[1].state.solidShadowCapture.refreshedIndices.some(i=>JSON.stringify(n.rows[1].cubes[i])!==JSON.stringify(n.rows[0].cubes[i])),'real refreshed cube pixels must change');
 report.phase='load';await save();await page.goto(origin+'/index.html?workspace=workbench');
 await page.waitForFunction(()=>window.kaminosSceneAuthoring?.addFlameEmitter);
 await page.evaluate(id=>window.kaminosSceneAuthoring.addFlameEmitter(id,{lightingRoute:{volume_light_field_shared_source:'1',volume_light_field_distributed:'1',volume_light_field_hybrid:'1',volume_light_field_hybrid_points:'6',volume_light_field_hybrid_shadow_capture_budget:'2',volume_light_field_hybrid_shadow_resolution:'16',volume_light_field_hybrid_blocker_samples:'1',volume_light_field_hybrid_filter_samples:'1',volume_light_field_hybrid_light_grid:'4',volume_light_field_hybrid_light_directions:'8',volume_light_field_hybrid_smoke_refinement:'1'}}),path.basename(presetFile,'.json'));
 const control=async(id,value)=>page.evaluate(({id,value})=>{const e=document.getElementById(id);if(!e)throw Error('Missing '+id);e.value=String(value);if(e.value!==String(value))throw Error('Rejected '+id);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},{id,value});
 for(const [id,v] of Object.entries({'volume-look-freeze':1,'volume-resolution':32,'volume-grid-height-ratio':2,'volume-fine-velocity':16,'volume-fine-pressure':8,'volume-render-scale':.5,'volume-steps':8,'volume-pressure-solver-iterations':4,'volume-world-smoke':'off'}))await control(id,v);
 await page.waitForFunction(()=>window.__kaminosSceneRadiance?.canRender());
 await page.evaluate(()=>window.kaminosSetCameraDebugPose({position:[7,5,9],target:[0,1.5,0]}));
 await control('volume-look-freeze',0);
 await page.waitForFunction(()=>window.__kaminosVolumePrototype.debugState().simStepCount>=12&&window.__kaminosSceneRadiance.canRender());
 await page.evaluate(()=>window.__kaminosVolumePrototype.setSimulationPaused(true));
 report.phase='controls';await save();await page.getByRole('button',{name:'Scene',exact:true}).click();
 const input=page.getByRole('spinbutton',{name:'Solid cube captures per frame (0 = all)',exact:true});assert.equal(await input.count(),1);
 await input.evaluate(e=>{for(let p=e.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;});await input.scrollIntoViewIfNeeded();assert.ok(await input.isVisible());
 await input.evaluate(e=>{e.value='1';e.dispatchEvent(new Event('change',{bubbles:true}));});
 await page.waitForFunction(()=>window.__kaminosSceneRadiance.debugState().shadowCaptureBudget===1&&window.__kaminosSceneRadiance.canRender());
 await page.evaluate(()=>window.kaminosSceneEdits.undo());assert.equal(await page.evaluate(()=>window.__kaminosSceneRadiance.debugState().shadowCaptureBudget),2);
 await page.evaluate(()=>window.kaminosSceneEdits.redo());assert.equal(await page.evaluate(()=>window.__kaminosSceneRadiance.debugState().shadowCaptureBudget),1);
 await page.screenshot({path:path.join(out,'inspector.png')});
 report.live=await page.evaluate(()=>({simulation:window.__kaminosVolumePrototype.debugState(),lighting:window.__kaminosSceneRadiance.debugState(),work:document.querySelector('[aria-label="Solid shadow refresh workload"]').textContent}));
 assert.equal(report.live.lighting.pointCount,6);assert.equal(report.live.lighting.residentShadowCount,6);assert.equal(report.live.lighting.evaluatedPointCount,6);
 report.phase='save';await save();report.saved=await page.evaluate(()=>window.saveSceneAs({result:true,name:'beaming-solid-cube-stagger'}));assert.equal(report.saved.ok,true,report.saved.error);
 const scene=await(await fetch(origin+'/api/read?root=scenes&path='+encodeURIComponent(report.saved.filename))).json();await fs.writeFile(path.join(out,'scene.json'),JSON.stringify(scene,null,2));
 report.phase='cold-reopen';await save();await page.goto('about:blank');await page.goto(compositionRestoreUrl(scene.composition,report.saved.filename,origin,'workbench'));
 await page.waitForFunction(()=>/^(Scene loaded|Volume scene loaded)/.test(document.getElementById('info-bar')?.textContent||''));
 await page.waitForFunction(()=>window.__kaminosSceneRadiance?.canRender());await page.evaluate(()=>window.__kaminosVolumePrototype.setSimulationPaused(true));
 report.reopened=await page.evaluate(()=>({simulation:window.__kaminosVolumePrototype.debugState(),lighting:window.__kaminosSceneRadiance.debugState()}));
 assert.equal(report.reopened.lighting.shadowCaptureBudget,1);assert.equal(report.reopened.lighting.pointCount,6);assert.equal(report.reopened.lighting.residentShadowCount,6);
 assert.deepEqual(report.errors,[]);assert.deepEqual(await hashes(),report.source,'Source changed during run');
 await page.screenshot({path:path.join(out,'cold-reopened.png')});report.status='passed';report.phase='complete';
}catch(e){report.error=e.stack;if(page)try{report.failureState=await page.evaluate(()=>({volume:window.__kaminosVolumePrototype?.debugState(),lighting:window.__kaminosSceneRadiance?.debugState(),info:document.getElementById('info-bar')?.textContent}));await page.screenshot({path:path.join(out,'failure.png')});}catch(c){report.captureError=String(c);}process.exitCode=1;}
finally{await browser?.close();if(server&&server.exitCode===null){const stopped=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await stopped;}await save();}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,errors:report.errors}));
