// Native saved-scene/basin consumer of independent world calibration. No timing claim.
// Caller supplies an observed preset and independent browser paths. Lightweight correctness check at 32/48 cells and eight rays; no performance comparison.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {checkCalibrationState} from './world-calibration-check.mjs';
import {coverageSceneUrl,coverageSceneLoaded} from './automatic-coverage-load.mjs';
const [out,presetFile]=process.argv.slice(2);
assert.ok(out&&presetFile,'Caller-owned output and observed preset required');
await fs.mkdir(out,{recursive:true});
const materialWidth=32;
const root=process.cwd(),report={status:'failed',phase:'setup',root,errors:[],arms:[]};
let server,browser,page;
const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
let sourceFiles;
const discoverSources=()=>execFileSync('git',['ls-files','-co','--exclude-standard'],{encoding:'utf8'}).trim().split('\n').filter(f=>/^(volume-|experiments\/material-hierarchy|tools\/(world-calibration|automatic-coverage|live-domain|domain-remap)|index.html|scene-edit-session)/.test(f));
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
 report.executable=process.env.CHROME_EXECUTABLE;assert.ok(report.executable?.includes('Google Chrome for Testing')||report.executable?.includes('/chromium_headless_shell-'), 'Independent test browser required');
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
 browser=await chromium.launchPersistentContext(dirs.profile,{executablePath:report.executable,headless:true,viewport:{width:1440,height:1000},args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 browser.setDefaultTimeout(0);browser.setDefaultNavigationTimeout(0);page=await browser.newPage();
 page.on('response',r=>{if(r.status()>=400)report.errors.push(`HTTP ${r.status()} ${r.url()}`);});
 const runtimeError=message=>{report.errors.push(message);(report.errorEvents??=[]).push({phase:report.phase,message});};
 page.on('pageerror',e=>runtimeError(String(e)));page.on('console',m=>{if(m.type()==='error')runtimeError(m.text());});
 report.phase='entry-error-control';await save();await page.goto(origin+'/volume-settings-preset.html');
 await assert.rejects(page.waitForFunction(coverageSceneLoaded),/settings preset id is required/);
 report.expectedEntryErrors=report.errors.splice(0);assert.ok(report.expectedEntryErrors.some(e=>e.includes('settings preset id is required')));
 report.phase='load';await save();await page.goto(origin+'/index.html?workspace=authoring');if(report.errors.length)throw Error(report.errors.join('\n'));

 await page.waitForFunction(()=>window.kaminosSceneAuthoring?.addFlameEmitter);
 report.phase='scene-create';await save();
 await page.evaluate(id=>window.kaminosSceneAuthoring.addFlameEmitter(id),path.basename(presetFile,'.json'));
 const control=async(id,value)=>page.evaluate(({id,value})=>{const e=document.getElementById(id);if(!e)throw Error('Missing '+id);e.value=String(value);if(e.value!==String(value))throw Error('Rejected '+id);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},{id,value});
 for(const [id,v] of Object.entries({'volume-look-freeze':1,'volume-resolution':materialWidth,'volume-grid-height-ratio':1,'volume-fine-velocity':materialWidth/2,'volume-fine-pressure':materialWidth/4,'volume-render-scale':.5,'volume-steps':8,'volume-pressure-solver-iterations':12,'volume-world-smoke':'on','volume-world-smoke-flow':8,'volume-world-smoke-material':16,'volume-world-smoke-pressure':4,'volume-world-smoke-iterations':12,'volume-world-smoke-intermediate':'off'}))await control(id,v);
 await page.waitForFunction(()=>window.kaminosWorkbenchExperiments);
 await page.evaluate(async()=>{await window.kaminosWorkbenchExperiments.open('material-hierarchy',{overlay:true});await window.kaminosWorkbenchExperiments.invoke('setOptions',{budget:1,maxDetail:2});await window.kaminosWorkbenchExperiments.invoke('setEnabled',true);window.selectSceneField('flame-field');window.kaminosSetCameraDebugPose({position:[12,7,15],target:[0,3,0]});});

 const state=()=>page.evaluate(()=>{
   const d=window.__kaminosVolumePrototype.debugState();return {backend:d.backend,active:d.active,error:d.error,step:d.simStepCount,calibration:d.worldCalibration,
    dims:d.simGridDimensions,velocityDims:d.fineGrid?.velocityDims,pose:window.kaminosFlameDomain.read(),controls:d.controls,source:d.immersedSource,reactant:d.reactantCombustion,world:d.worldSmoke?.identity,render:d.worldRender,adaptive:window.__kaminosVolumePrototype.adaptiveMaterialState()?.effective};
 });
 const waitSteps=async n=>{const s=await state();await page.waitForFunction(({step,n})=>{const d=window.__kaminosVolumePrototype.debugState();if(d.error)throw Error(d.error);return d.simStepCount>=step+n;},{step:s.step,n});assert.deepEqual(report.errors,[]);};
 const patch=async controls=>page.evaluate(controls=>{const s=window.kaminosFlameAuthoring.read();for(const [id,value] of Object.entries(controls)){const d=s.domControls[id];if(!d)throw Error('Missing control '+id);d.value=value;if('rawValue' in d)d.rawValue=String(value);}window.kaminosFlameAuthoring.apply(s,'Calibration witness');},controls);
 await control('volume-look-freeze',0);await waitSteps(20);
 report.baseline=await state();assert.equal(report.baseline.calibration.enabled,false);
 report.phase='capture-reference';await save();
 await page.keyboard.press('Alt+KeyG');await page.locator('#grid-calibration-capture').click();await waitSteps(3);
 let expected={width:2*report.baseline.pose.scale,materialCells:32,velocityCells:16,dims:[32,32,32],velocityDims:[16,16,16]};
 const capture=async name=>{const s=await state();checkCalibrationState(s,expected);report.arms.push({name,...s});await save();await page.screenshot({path:path.join(out,name+'.png')});return s;};
 await capture('reference-controls');
 report.phase='independent-detail';await save();
 for(const [key,value] of Object.entries({resolution:48,fineVelocity:24,finePressure:12})){const field=page.locator('#grid-draft-'+key);await field.click();await field.fill(String(value));}
 await page.locator('#grid-tuning-apply').click();await waitSteps(20);expected={...expected,dims:[48,48,48],velocityDims:[24,24,24]};await capture('independent-detail');
 report.phase='shared-detail';await save();await patch({'volume-fine-velocity':48});await waitSteps(12);expected.velocityDims=[48,48,48];await capture('shared-detail');
 report.phase='coverage-scale';await save();await page.locator('#grid-tuning-close').click();
 await patch({'volume-coverage-mode':'off'});
 await page.evaluate(()=>{const edits=window.kaminosSceneEdits,p=edits.begin('@flame-domain','Calibration coverage change').active.before;edits.preview({...p,scale:p.scale.map(x=>x*1.25)});edits.commit();});
 await waitSteps(12);await capture('coverage-scale');
 report.phase='authored-scale';await save();await page.keyboard.press('Alt+KeyG');await page.locator('#grid-calibration-width').click();await page.locator('#grid-calibration-width').fill(String(expected.width*1.2));await page.locator('#grid-calibration-width').blur();expected.width*=1.2;await waitSteps(12);await capture('authored-scale-controls');
 report.savedSettings=await page.evaluate(()=>window.kaminosFlameAuthoring.read());
 report.savedScene=await page.evaluate(()=>window.saveSceneAs({result:true,name:'Independent simulation world scale'}));assert.equal(report.savedScene.ok,true);
 report.savedBasin=await page.evaluate(()=>window.__kaminosSaveVolumeSettingsPreset({label:'Independent simulation world scale'}));assert.equal(report.savedBasin.ok,true);await save();
 report.phase='scene-reload';await save();report.savedUrl=coverageSceneUrl(report.savedScene.url,origin);await page.goto(report.savedUrl);await page.waitForFunction(coverageSceneLoaded);await capture('scene-restored');
 report.phase='basin-reload';await save();await patch({'volume-calibration-mode':'legacy'});await waitSteps(3);assert.equal((await state()).calibration.enabled,false);
 await page.evaluate(id=>window.kaminosFlameAuthoring.applyBasin(id),report.savedBasin.effective.presetId);await waitSteps(12);await capture('basin-restored');
 report.final=await state();assert.deepEqual(report.errors,[]);assert.deepEqual(await hashes(),report.source,'Source changed during run');report.status='passed';report.phase='complete';
}catch(e){report.error=e.stack;if(page)try{report.failureState=await page.evaluate(()=>window.__kaminosVolumePrototype?.debugState());await page.screenshot({path:path.join(out,'failure.png')});}catch(c){report.captureError=String(c);}process.exitCode=1;}
finally{await browser?.close();report.browserClosed=true;if(server&&server.exitCode===null){const stopped=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await stopped;}report.serverClosed=true;await save();}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));
