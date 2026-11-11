import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
export function verifySingleGridParticleState(state,expected){
 assert.match(state.backend,/webgpu:apple/i,'native WebGPU Apple backend required');
 assert.equal(state.gridHeight?.widthCells,8,'single-grid fixture width must be 8');assert.equal(state.gridHeight?.heightCells,12,'single-grid fixture height must be 12');
 assert.notEqual(state.worldSmoke?.effective,'one-way-world-field','single-grid fixture must have Coarse/World off');
 assert.equal(state.opticalParticles?.effective,'world-optical-particles','effective particle route required');
 for(const [key,value] of Object.entries(expected))assert.equal(state.opticalParticles.settings[key],value,'effective particle setting '+key);
 if(expected.fillExtinction>0||expected.extinctionView>0){assert.equal(state.opticalParticles.gridAssist?.effective,'current-single-grid-extinction','independent extinction assist must execute');assert.ok(state.opticalParticles.gridAssist.generation>0,'current extinction generation required');}
}
export function verifyParticleImage({width,height,rgba}){
 assert.ok(Number.isSafeInteger(width)&&width>0&&Number.isSafeInteger(height)&&height>0,'native image dimensions required');assert.equal(rgba.length,width*height*4,'partial native image size');
 assert.ok(rgba.some((v,i)=>i%4!==3&&v>10),'blank native image');
}
export function verifyParticleProgress(before,after){
 assert.equal(before.length,after.length,'particle population shape changed');let retained=0,changed=0;
 for(let i=0;i<before.length;i+=24){if(before[i+3]<=0||after[i+3]<=before[i+3])continue;let same=true;for(let k=4;k<12;k++)if(before[i+k]!==after[i+k])same=false;if(!same)continue;retained++;if([0,1,2,20,21,22].some(k=>Math.abs(before[i+k]-after[i+k])>1e-7))changed++;}
 assert.ok(retained>0&&changed>0,'no retained carrier movement or material evolution');return {retained,changed};
}
export async function runParticleWitness({origin,out,expected,repoRoot,playwrightModule,executable}){
 await fs.mkdir(out,{recursive:true});let browser,page;
 const report={status:'failed',phase:'runtime',origin,expected,repoRoot,executable,errors:[],arms:[]};
 const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await save();
 try{
  report.runtime=await fetch(origin+'/api/runtime-config').then(r=>{if(!r.ok)throw Error(`Runtime HTTP ${r.status}`);return r.json();});
  assert.equal(report.runtime.source.commit,expected,'wrong source revision');assert.equal(report.runtime.source.repoRoot,repoRoot,'wrong source checkout');assert.equal(report.runtime.source.dirty,false,'witness requires committed source');
  report.phase='browser';await save();
  const {chromium}=await import(playwrightModule);await fs.access(executable);
  browser=await chromium.launchPersistentContext(path.join(out,'profile'),{executablePath:executable,headless:true,viewport:{width:1100,height:900},recordVideo:{dir:path.join(out,'video'),size:{width:1100,height:900}},args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
  page=browser.pages()[0]??await browser.newPage();page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);
  await page.route('**/favicon.ico',r=>r.fulfill({status:204,body:''}));
  page.on('pageerror',e=>{report.errors.push(e.stack??String(e));void save();});page.on('console',m=>{if(m.type()==='error'){report.errors.push(m.text());void save();}});
  report.phase='load';await save();report.url=origin+'/index.html?workspace=workbench#scene=Raystep-retained-optical-1107.kaminos.json&experiment=optical-particles';
  await page.goto(report.url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__kaminosVolumePrototype?.debugState()?.active&&window.kaminosWorkbenchExperiments?.state()?.id==='optical-particles');
  assert.deepEqual(report.errors,[]);
  await page.evaluate(()=>{const v=window.__kaminosVolumePrototype;v.setCapturePaused(true);v.setSimulationPaused(true);v.setControls({raymarchMode:'budgeted',raySteps:1,renderScale:.5,occupancySkip:0,rayStartNoise:true,integralReconstruction:'off'});});
  report.initial=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState());assert.match(report.initial.backend,/webgpu:apple/i);
  report.phase='develop';await save();
  await page.evaluate(async()=>{const v=window.__kaminosVolumePrototype;v.setSimulationPaused(false);for(let i=0;i<40;i++){const result=await v.sampleFrame({advanceSim:true,now:1000+i*16});if(!result.ok)throw Error(result.reason);}v.setSimulationPaused(true);v.setControls({rayNoiseFrame:0});});
  const saveRecords=async name=>{const sample=await page.evaluate(async()=>{const v=window.__kaminosVolumePrototype;const sample=await v.sampleOpticalParticles();if(!sample.available)throw Error('No particle output');let binary='';const bytes=new Uint8Array(sample.records.buffer);for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));let active=0,emissive=0;for(let i=0;i<sample.records.length;i+=24){if(sample.records[i+3]>0)active++;if(sample.records[i+8]+sample.records[i+9]+sample.records[i+10]>0)emissive++;}return {state:v.debugState(),active,emissive,records:btoa(binary)};});
   await fs.writeFile(path.join(out,name+'.f32'),Buffer.from(sample.records,'base64'));delete sample.records;assert.equal(sample.state.opticalParticles.effective,'world-optical-particles');assert.equal(sample.state.splitIntegral.effective,'source-observations');assert.equal(sample.state.splitIntegral.freshEvaluations,1);assert.ok(sample.active>0&&sample.emissive>0,'developed flame sources absent');report.arms.push({name,...sample});await save();};
  const draw=async name=>{const sample=await page.evaluate(async name=>{const f=await window.__kaminosVolumePrototype.sampleFrame({advanceSim:false,now:2000,includeRgba:!!name});if(!f.ok)throw Error(f.reason);if(!name)return null;if(!f.image?.rgba?.length)throw Error('Missing actual rendered pixels');let s='';const bytes=new Uint8Array(f.image.rgba);for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return {width:f.image.width,height:f.image.height,rgba:btoa(s)};},name);if(sample){await fs.writeFile(path.join(out,name+'.rgba8'),Buffer.from(sample.rgba,'base64'));delete sample.rgba;await fs.writeFile(path.join(out,name+'-image.json'),JSON.stringify(sample));}};
  const capture=async name=>{await page.evaluate(async()=>{const v=window.__kaminosVolumePrototype;v.setCapturePaused(false);for(let i=0;i<3;i++)await new Promise(requestAnimationFrame);});await page.locator('#viewport').screenshot({path:path.join(out,name+'.png')});await page.evaluate(()=>window.__kaminosVolumePrototype.setCapturePaused(true));};
  report.phase='inspect';await save();await draw();await saveRecords('developed');await capture('developed');
  await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('setOptions',{radius:.12,stretch:1}));await draw('small-support');await capture('small-support');
  await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('setOptions',{radius:.5,stretch:2}));await draw('large-support');await capture('large-support');assert.notDeepEqual(await fs.readFile(path.join(out,'small-support.rgba8')),await fs.readFile(path.join(out,'large-support.rgba8')),'support controls must change rendered output');await saveRecords('paused-large-support');assert.deepEqual(await fs.readFile(path.join(out,'developed.f32')),await fs.readFile(path.join(out,'paused-large-support.f32')),'paused support edits must preserve carrier state at the default refresh fraction');
  report.phase='motion';await save();await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('setOptions',{refresh:0,rise:.001,expansion:.5}));
  await page.evaluate(async()=>{const v=window.__kaminosVolumePrototype;v.setSimulationPaused(false);for(let i=0;i<12;i++){const r=await v.sampleFrame({advanceSim:true,now:2200+16*i});if(!r.ok)throw Error(r.reason);}v.setSimulationPaused(true);});await saveRecords('continued');const before=await fs.readFile(path.join(out,'developed.f32')),after=await fs.readFile(path.join(out,'continued.f32'));report.progress=verifyParticleProgress(new Float32Array(before.buffer,before.byteOffset,before.length/4),new Float32Array(after.buffer,after.byteOffset,after.length/4));await capture('continued');await saveRecords('continued-presented');assert.deepEqual(await fs.readFile(path.join(out,'continued.f32')),await fs.readFile(path.join(out,'continued-presented.f32')),'display capture must match recorded carrier state');
  report.phase='controls';await save();const control=page.getByRole('spinbutton',{name:'Emission gain',exact:true});await control.click();await control.fill('1.5');await control.dispatchEvent('input');await page.waitForFunction(()=>window.__kaminosVolumePrototype.opticalParticleSettings().gain===1.5);assert.equal((await page.evaluate(()=>window.__kaminosVolumePrototype.opticalParticleSettings())).gain,1.5);
  await page.screenshot({path:path.join(out,'controls.png')});assert.deepEqual(report.errors,[]);report.status='passed';report.phase='complete';
 }catch(error){report.failurePhase=report.phase;report.error=error.stack??String(error);if(page)try{await page.screenshot({path:path.join(out,'failure.png')});report.lastState=await page.evaluate(()=>window.__kaminosVolumePrototype?.debugState());}catch(e){report.captureFailure=String(e);}}
 finally{try{await browser?.close();report.browserClosed=true;}catch(e){report.status='failed';report.cleanupFailure=String(e);}await save();}
 return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname)){
 const [origin,out,expected,repoRoot,playwrightModule,executable]=process.argv.slice(2);if(!out)throw Error('Usage: origin out expectedCommit repoRoot playwrightModule browserExecutable');
 const r=await runParticleWitness({origin,out,expected,repoRoot,playwrightModule,executable});console.log(JSON.stringify({status:r.status,phase:r.phase,error:r.error,out}));if(r.status!=='passed')process.exitCode=1;
}
