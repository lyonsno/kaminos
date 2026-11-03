// Actual authoring consumer; isolated writable stores; no timing verdict.
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
const discoverSources=()=>execFileSync('git',['ls-files','-co','--exclude-standard'],{encoding:'utf8'}).trim().split('\n').filter(f=>/^(volume-|experiments\/material-hierarchy|tools\/material-hierarchy|index.html)/.test(f));
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
 report.phase='load';await save();await page.goto(origin+'/index.html?workspace=authoring');if(report.errors.length)throw Error(report.errors.join('\n'));

 await page.waitForFunction(()=>window.kaminosSceneAuthoring?.addFlameEmitter);
 report.phase='scene-create';await save();
 await page.evaluate(id=>window.kaminosSceneAuthoring.addFlameEmitter(id),path.basename(presetFile,'.json'));
 const control=async(id,value)=>page.evaluate(({id,value})=>{const e=document.getElementById(id);if(!e)throw Error('Missing '+id);e.value=String(value);if(e.value!==String(value))throw Error('Rejected '+id);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},{id,value});
 for(const [id,v] of Object.entries({'volume-look-freeze':1,'volume-resolution':32,'volume-grid-height-ratio':2,'volume-fine-velocity':16,'volume-fine-pressure':8,'volume-render-scale':.5,'volume-steps':8,'volume-pressure-solver-iterations':12,'volume-world-smoke':'on','volume-world-smoke-flow':8,'volume-world-smoke-material':16,'volume-world-smoke-pressure':4,'volume-world-smoke-iterations':12,'volume-world-smoke-intermediate':'off'}))await control(id,v);
 await page.waitForFunction(()=>window.kaminosWorkbenchExperiments);
 await page.evaluate(async()=>{await window.kaminosWorkbenchExperiments.open('material-hierarchy',{enabled:true,overlay:true,options:{budget:1,maxDetail:2}});window.selectSceneField('flame-field');window.kaminosSetCameraDebugPose({position:[14,10,18],target:[0,4,0]});});
 const advance=async(n)=>{const start=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState().simStepCount);await control('volume-look-freeze',0);await page.waitForFunction(({start,n})=>{const s=window.__kaminosVolumePrototype.debugState();if(s.error)throw Error(s.error);return s.simStepCount>=start+n;},{start,n});await control('volume-look-freeze',1);};
 const capture=async name=>{const state=await page.evaluate(async()=>({experiment:await window.kaminosWorkbenchExperiments.read(),simulation:window.__kaminosVolumePrototype.debugState()}));report.arms.push({name,...state});await save();assert.match(state.simulation.backend,/^webgpu:apple/i);assert.ok(state.experiment.effective?.steps>0);assert.equal(state.experiment.effective.error,null);assert.ok(state.experiment.effective.allocatedBricks<=state.experiment.effective.capacity);await page.screenshot({path:path.join(out,name+'.png')});return state;};
 report.phase='live-fire';await save();await advance(60);const baseline=await capture('live-allocation');assert.ok(baseline.experiment.effective.levels.some(l=>l.level>0),'Live material demand must refine');
 // Actual UI path, then the identical operation through the agent entry.
 report.phase='controls';await save();await page.evaluate(()=>window.kaminosWorkspace.setMode('workbench'));assert.ok(await page.getByRole('spinbutton',{name:'Extra material budget',exact:true}).isVisible(),'Allocation controls must be visible');await page.getByRole('spinbutton',{name:'Extra material budget',exact:true}).click();await page.getByRole('spinbutton',{name:'Extra material budget',exact:true}).fill('0');await page.getByRole('spinbutton',{name:'Extra material budget',exact:true}).press('Tab');await advance(4);const zero=await capture('zero-budget');assert.ok(zero.experiment.effective.levels.every(l=>l.level===0));
 await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('setOptions',{budget:2,spread:.2}));await advance(30);const more=await capture('more-detail');assert.equal(more.experiment.effective.options.spread,.2);assert.ok(more.experiment.effective.levels.some(l=>l.level>0));assert.equal(await page.getByRole('spinbutton',{name:'Extra material budget',exact:true}).inputValue(),'2');
 await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('setOverlay',false));assert.equal(await page.getByRole('checkbox',{name:'Show refinement',exact:true}).isChecked(),false);await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('setOverlay',true));assert.equal(await page.getByRole('checkbox',{name:'Show refinement',exact:true}).isChecked(),true);
 const bad=await page.evaluate(async()=>{try{await window.kaminosWorkbenchExperiments.invoke('setOptions',{budget:1e12});return null;}catch(e){return e.message;}});assert.match(bad,/GPU storage/);await advance(2);await capture('invalid-request-preserved');
 report.phase='lifetime';await save();const inputs=await page.evaluate(()=>window.kaminosWorkbenchExperiments.state());report.retainedState=inputs;
 await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());assert.equal(await page.evaluate(()=>window.__kaminosVolumePrototype.adaptiveMaterialState().effective),null);
 await page.evaluate(()=>window.kaminosWorkbenchExperiments.open('material-hierarchy',{enabled:true,overlay:true,options:{budget:2,spread:.2,maxDetail:2}}));await advance(4);await capture('reopened');
 assert.deepEqual(report.errors,[]);assert.deepEqual(await hashes(),report.source,'Source changed during run');report.status='passed';report.phase='complete';
}catch(e){report.error=e.stack;if(page)try{report.failureState=await page.evaluate(()=>window.__kaminosVolumePrototype?.debugState());await page.screenshot({path:path.join(out,'failure.png')});}catch(c){report.captureError=String(c);}process.exitCode=1;}
finally{await browser?.close();if(server&&server.exitCode===null){const stopped=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await stopped;}await save();}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));
