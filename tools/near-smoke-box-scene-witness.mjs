// Actual authoring consumer; isolated writable stores; no timing verdict.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {compositionRestoreUrl} from '../scene-authoring.mjs';
const [out,presetFile]=process.argv.slice(2);
assert.ok(out&&presetFile,'Caller-owned output and observed preset required');
await fs.mkdir(out,{recursive:true});
const materialWidth=32;
const root=process.cwd(),report={status:'failed',phase:'setup',root,errors:[],arms:[]};
let server,browser,page;
const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
let sourceFiles;
const discoverSources=()=>execFileSync('git',['ls-files','-co','--exclude-standard'],{encoding:'utf8'}).trim().split('\n').filter(f=>/^(volume-|scene-|fire-|tools\/near-smoke-box|index.html)/.test(f));
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

 report.phase='load';await save();await page.goto(origin+'/index.html?workspace=workbench');
 await page.waitForFunction(()=>window.kaminosSceneAuthoring?.addFlameEmitter);
 report.phase='scene-create';await save();
 await page.evaluate(id=>window.kaminosSceneAuthoring.addFlameEmitter(id,{lightingRoute:{volume_light_field_shared_source:'1',volume_light_field_distributed:'1',volume_light_field_hybrid:'1',volume_light_field_hybrid_points:'2',volume_light_field_hybrid_shadow_resolution:'16',volume_light_field_hybrid_blocker_samples:'1',volume_light_field_hybrid_filter_samples:'1',volume_light_field_hybrid_light_grid:'4',volume_light_field_hybrid_light_directions:'8',volume_light_field_hybrid_smoke_refinement:'1',volume_light_field_hybrid_surface_enabled:'0'}}),path.basename(presetFile,'.json'));
 const control=async(id,value)=>page.evaluate(({id,value})=>{const e=document.getElementById(id);if(!e)throw Error('Missing '+id);e.value=String(value);if(e.value!==String(value))throw Error('Rejected '+id);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},{id,value});
 for(const [id,v] of Object.entries({'volume-look-freeze':1,'volume-resolution':32,'volume-grid-height-ratio':2,'volume-fine-velocity':16,'volume-fine-pressure':8,'volume-render-scale':.5,'volume-steps':8,'volume-pressure-solver-iterations':4,'volume-world-smoke':'on','volume-world-smoke-flow':8,'volume-world-smoke-material':16,'volume-world-smoke-pressure':4,'volume-world-smoke-iterations':4,'volume-world-smoke-intermediate':'off'}))await control(id,v);
 await page.waitForFunction(()=>window.__kaminosSceneRadiance?.canRender());
 await page.evaluate(async()=>{await window.kaminosFireLightingSettings.invoke('setNearBox',{enabled:true,grid:4,directions:8,extent:[1.5,1.5,1.5]});window.selectSceneField('flame-field');window.kaminosSetCameraDebugPose({position:[9,6,12],target:[0,3,0]});});
 const live=async()=>{await control('volume-look-freeze',0);await page.waitForFunction(()=>{const s=window.__kaminosVolumePrototype.debugState(),l=window.__kaminosSceneRadiance.debugState();if(s.error||l.error)throw Error(s.error||l.error);return s.simStepCount>=30&&l.frame?.exterior?.middle?.coverage==='independent-near-receivers';});await control('volume-look-freeze',1);};
 await live();
 const capture=async name=>{const state=await page.evaluate(()=>({simulation:window.__kaminosVolumePrototype.debugState(),lighting:window.__kaminosSceneRadiance.debugState(),history:window.kaminosSceneEdits.state()}));report.arms.push({name,...state});await save();assert.match(state.simulation.backend,/^webgpu:apple/i);assert.equal(state.lighting.error,null);assert.equal(state.simulation.worldSmoke.effective,'one-way-world-field');assert.ok(state.lighting.frame.exterior.middle.activeVolumeReceivers>0);await page.screenshot({path:path.join(out,name+'.png')});return state;};
 report.phase='controls';await save();
 const input=page.getByRole('spinbutton',{name:'Near light height multiplier',exact:true});assert.equal(await input.count(),1);await input.scrollIntoViewIfNeeded();assert.ok(await input.isVisible());
 await input.evaluate(e=>{e.value='1.75';e.dispatchEvent(new Event('change',{bubbles:true}));});
 await page.waitForFunction(()=>window.__kaminosSceneRadiance.debugState().nearBox.extent[1]===1.75&&window.__kaminosSceneRadiance.canRender());
 await page.evaluate(()=>window.kaminosSceneEdits.undo());assert.equal(await page.evaluate(()=>window.__kaminosSceneRadiance.debugState().nearBox.extent[1]),1.5);
 await page.evaluate(()=>window.kaminosSceneEdits.redo());assert.equal(await page.evaluate(()=>window.__kaminosSceneRadiance.debugState().nearBox.extent[1]),1.75);
 for(const emission of ['on','off']){await control('volume-world-emissive',emission);await live();await capture('world-emission-'+emission);}
 await page.evaluate(()=>window.kaminosFireLightingSettings.invoke('setNearBox',{enabled:false}));
 await page.waitForFunction(()=>window.__kaminosSceneRadiance.canRender()&&window.__kaminosSceneRadiance.debugState().frame?.exterior?.middle===null);
 report.disabled=await page.evaluate(()=>window.__kaminosSceneRadiance.debugState());
 await page.evaluate(()=>window.kaminosFireLightingSettings.invoke('setNearBox',{enabled:true}));await live();await capture('near-reenabled');
 report.phase='save';await save();report.saved=await page.evaluate(()=>window.saveSceneAs({result:true,name:'beaming-nearbox-sexy'}));assert.equal(report.saved.ok,true,report.saved.error);
 const scene=await(await fetch(origin+'/api/read?root=scenes&path='+encodeURIComponent(report.saved.filename))).json();await fs.writeFile(path.join(out,'scene.json'),JSON.stringify(scene,null,2));
 report.phase='cold-reopen';await save();await page.goto('about:blank');await page.goto(compositionRestoreUrl(scene.composition,report.saved.filename,origin,'workbench'));
 await page.waitForFunction(()=>window.__kaminosSceneRadiance?.canRender()&&window.__kaminosSceneRadiance.debugState().frame?.exterior?.middle);
 await control('volume-look-freeze',1);report.reopened=await capture('cold-reopened');
 assert.deepEqual(report.reopened.lighting.nearBox,{enabled:true,grid:4,directions:8,extent:[1.5,1.75,1.5]});
 assert.equal(report.reopened.simulation.controls.worldEmissive,'off');
 assert.equal(report.reopened.simulation.controls.resolution,32);assert.deepEqual(report.errors,[]);assert.deepEqual(await hashes(),report.source,'Source changed during run');report.status='passed';report.phase='complete';
}catch(e){report.error=e.stack;if(page)try{report.failureState=await page.evaluate(()=>({volume:window.__kaminosVolumePrototype?.debugState(),lighting:window.__kaminosSceneRadiance?.debugState(),info:document.getElementById('info-bar')?.textContent}));await page.screenshot({path:path.join(out,'failure.png')});}catch(c){report.captureError=String(c);}process.exitCode=1;}
finally{await browser?.close();if(server&&server.exitCode===null){const stopped=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await stopped;}await save();}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,errors:report.errors}));
