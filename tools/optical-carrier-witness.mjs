import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyParticleImage} from './optical-particles-witness.mjs';

export function carrierRenderingErrors(errors,responses){
 const forbidden=responses.filter(r=>r.status===403);
 const notesOnly=forbidden.length>0&&forbidden.every(r=>['/api/notes/stream','/api/vantage/presence'].includes(new URL(r.url).pathname));
 return errors.filter(message=>!(notesOnly&&message==='Failed to load resource: the server responded with a status of 403 (Forbidden)'));
}

export function verifyOpticalCarrierSnapshot(snapshot){
 assert.equal(snapshot.state.effectiveRoute,'native-3d-compute-fluid-raymarch-v0');
 assert.match(snapshot.state.backend,/webgpu:apple/i);
 const p=snapshot.state.opticalParticles;
 assert.equal(p.settings.carrierMode,1);assert.equal(p.carrier.rayAcquisition,false);assert.equal(p.carrier.chemistry,false);assert.equal(p.carrier.exchange,false);assert.equal(p.freshSamples,0);assert.equal(p.gridAssist.effective,'off');assert.equal(p.raymarchVisible,false);
 assert.equal(snapshot.records.length,p.slots*24);assert.equal(snapshot.deformation.length,p.slots*12);
 assert.ok(snapshot.records.every(Number.isFinite));assert.ok(snapshot.deformation.every(Number.isFinite));assert.ok(snapshot.records.some((v,i)=>i%24===3&&v>0),'missing active carriers');
 return p;
}

export async function run({origin,out,expected,repoRoot,playwrightModule,executable}){
 await fs.mkdir(out,{recursive:true});let browser,page,writing=Promise.resolve();
 const report={status:'failed',phase:'runtime',origin,expected,repoRoot,executable,errors:[],failedResponses:[]};
 const save=()=>{const json=JSON.stringify(report,null,2);writing=writing.then(()=>fs.writeFile(path.join(out,'report.json'),json));return writing;};await save();
 try{
  report.runtime=await fetch(origin+'/api/runtime-config').then(r=>{assert.ok(r.ok);return r.json();});assert.equal(report.runtime.source.commit,expected);assert.equal(report.runtime.source.dirty,false);
  const {chromium}=await import(playwrightModule);report.phase='browser';await save();
  browser=await chromium.launchPersistentContext(path.join(out,'profile'),{executablePath:executable,headless:true,viewport:{width:1200,height:900},args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});page=browser.pages()[0]??await browser.newPage();page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);
  page.on('pageerror',error=>{report.errors.push(error.stack??String(error));void save();});page.on('console',m=>{if(m.type()==='error'){report.errors.push(m.text());void save();}});await page.route('**/favicon.ico',r=>r.fulfill({status:204,body:''}));
  page.on('response',response=>{if(response.status()>=400){report.failedResponses.push({url:response.url(),status:response.status()});void save();}});
  report.notes='Notes/vantage authentication is outside this optical rendering check; any observed 403 remains in failedResponses and warnings.';report.url=origin+'/index.html?workspace=workbench#scene=Raystep-retained-optical-1107.kaminos.json&experiment=optical-carriers';report.phase='load';await save();await page.goto(report.url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state()?.id==='optical-carriers'||window.kaminosWorkbenchExperiments?.state()?.error);
  report.entry=await page.evaluate(()=>window.kaminosWorkbenchExperiments.state());assert.equal(report.entry.id,'optical-carriers');assert.deepEqual(carrierRenderingErrors(report.errors,report.failedResponses),[]);
  await page.evaluate(()=>{const v=window.__kaminosVolumePrototype;v.setCapturePaused(true);v.setSimulationPaused(true);v.setControls({resolution:32,gridHeightRatio:1.5,fineVelocity:32,finePressure:32,worldSmoke:'off',raySteps:8,renderScale:.4,rayNoiseFrame:0});});
  report.phase='evolve';await save();await page.evaluate(async()=>{const v=window.__kaminosVolumePrototype;v.setSimulationPaused(false);for(let i=0;i<36;i++){const r=await v.sampleFrame({advanceSim:true,now:1000+i*16});if(!r.ok)throw Error(r.reason+': '+r.validationError);}v.setSimulationPaused(true);});
  const snapshot=()=>page.evaluate(async()=>{const v=window.__kaminosVolumePrototype,s=await v.sampleOpticalParticles();return {state:v.debugState(),records:Array.from(s.records),deformation:Array.from(s.deformation)};});
  const a=await snapshot();verifyOpticalCarrierSnapshot(a);await fs.writeFile(path.join(out,'held.json'),JSON.stringify(a));report.effective=a.state.opticalParticles;
  const frame=()=>page.evaluate(async()=>{const r=await window.__kaminosVolumePrototype.sampleFrame({advanceSim:false,now:4000,includeRgba:true});if(!r.ok)throw Error(r.reason+': '+r.validationError);return {width:r.image.width,height:r.image.height,rgba:Array.from(r.image.rgba)};});
  const first=await frame();verifyParticleImage(first);await fs.writeFile(path.join(out,'held.rgba8'),new Uint8Array(first.rgba));assert.deepEqual(await frame(),first,'paused output must repeat');const held=await snapshot();assert.deepEqual(held.records,a.records,'paused material must hold');assert.deepEqual(held.deformation,a.deformation,'paused deformation must hold');
  await page.evaluate(async()=>{window.__kaminosVolumePrototype.setCapturePaused(false);for(let i=0;i<3;i++)await new Promise(requestAnimationFrame);});await page.screenshot({path:path.join(out,'candidate.png')});await page.evaluate(()=>window.__kaminosVolumePrototype.setCapturePaused(true));
  report.phase='controls';await save();const gain=page.getByRole('spinbutton',{name:'Emission gain',exact:true});await gain.fill('1.5');await gain.dispatchEvent('input');await page.waitForFunction(()=>window.__kaminosVolumePrototype.opticalParticleSettings().gain===1.5);await frame();const edited=await snapshot();assert.deepEqual(edited.records,a.records);assert.deepEqual(edited.deformation,a.deformation);
  await page.screenshot({path:path.join(out,'controls.png')});assert.deepEqual(carrierRenderingErrors(report.errors,report.failedResponses),[]);report.warnings=report.failedResponses;report.status='passed';report.phase='complete';
 }catch(error){report.failurePhase=report.phase;report.error=error.stack??String(error);if(page)try{await page.screenshot({path:path.join(out,'failure.png')});report.lastState=await page.evaluate(()=>({entry:window.kaminosWorkbenchExperiments?.state(),volume:window.__kaminosVolumePrototype?.debugState()}));}catch(cause){report.captureError=String(cause);}}
 finally{try{await browser?.close();report.browserClosed=true;}catch(cause){report.status='failed';report.cleanupError=String(cause);}await save();}
 return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const [origin,out,expected,repoRoot,playwrightModule,executable]=process.argv.slice(2);const r=await run({origin,out,expected,repoRoot,playwrightModule,executable});console.log(JSON.stringify({status:r.status,phase:r.phase,error:r.error,out}));if(r.status!=='passed')process.exitCode=1;}
