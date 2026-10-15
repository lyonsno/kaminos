// kaminos-test: manual — short actual Workbench gesture, not a throughput benchmark
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {launchChrome,sourceIdentity} from '../models/flux2-klein/cdp-harness.mjs';
const [url,out]=process.argv.slice(2);assert(out,'evidence directory required');
await fs.mkdir(out,{recursive:true});
const report={source:sourceIdentity(resolve('.')),url,phase:'start',claim:'edit hold/commit/cancel consumer conformance; not scene frame-budget closure'};
const save=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));
let browser;
try{
 await save();await fs.copyFile(new URL(import.meta.url),out+'/effective-smoke.mjs');
 report.runtime=await (await fetch(new URL('/api/runtime-config',url))).json();
 assert.equal(report.runtime.source.repoRoot,resolve('.'));assert.equal(report.runtime.source.commit,report.source.rev);
 report.executable='/Users/noahlyons/.local/state/kaminos/browser-cache/cft154-verified-0930/chrome/mac_arm-154.0.8037.92/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
 browser=await launchChrome(report.executable,['--use-angle=metal','--window-size=1200,900'],report,{profileDir:out+'/profile'});
 report.phase='load';await save();
 await browser.navigate(url,'Boolean(window.__kaminosVolumePrototype && window.kaminosSceneAuthoring && window.kaminosSceneEdits)');
 await browser.evaluate(`window.__editWait=target=>new Promise((resolve,reject)=>{const tick=()=>{const s=window.__kaminosVolumePrototype.debugState();if(s.error)return reject(Error(s.error));if(s.simStepCount>=target)return resolve(s);requestAnimationFrame(tick);};tick();})`);
 await browser.evaluate('window.__editWait(15).then(()=>window.__kaminosVolumePrototype.setSimulationPaused(true))');
 report.before=await browser.evaluate('window.__kaminosVolumePrototype.debugState()');
 assert(report.before.joinedExterior?.admitted);assert(report.before.joinedRendering?.enabled);assert.equal(report.before.sceneCollision?.effective,'mesh-voxel-solid');
 report.scene=await browser.evaluate('window.kaminosSceneAuthoring.read()');
 const target=report.scene.objects.find(o=>o.type==='procedural-mesh'&&o.collision?.enabled);assert(target,'no marked obstacle');report.target=target;
 const evaluate=browser.evaluate,step=async count=>evaluate(`window.__editWait(window.__kaminosVolumePrototype.debugState().simStepCount+${count})`);
 const shot=async name=>{const r=await browser.send('Page.captureScreenshot',{format:'png'});assert(r.result?.data,'missing frame');await fs.writeFile(out+'/'+name+'.png',Buffer.from(r.result.data,'base64'));};
 await evaluate(`window.__kaminosSetActiveTab('volume');window.kaminosSetCameraDebugPose({position:[0,2,10],target:[0,2,0]});window._kaminosDirty();window.kaminosSceneEdits.begin(${JSON.stringify(target.id)},'Edit hold witness');window.__kaminosVolumePrototype.setSimulationPaused(false)`);
 report.phase='drag';await save();report.previews=[];
 for(const dx of [.05,.1,.15]){
  const pose={...target.transform,position:target.transform.position.map((v,a)=>v+(a===0?dx:0))};
  await evaluate(`window.kaminosSceneEdits.preview(${JSON.stringify(pose)})`);
  report.previews.push(await step(3));
 }
 for(const s of report.previews){assert.equal(s.joinedEditing?.held,true);assert.equal(s.joinedExterior.steps,report.before.joinedExterior.steps);assert.equal(s.sceneSolidGeometryBuilds,report.before.sceneSolidGeometryBuilds);assert.equal(s.joinedRendering.enabled,true);assert.equal(s.joinedExterior.generation,report.before.joinedExterior.generation);}
 await shot('drag-held');
 report.phase='commit';await save();await evaluate('window.kaminosSceneEdits.commit()');report.placed=await step(3);
 assert.equal(report.placed.joinedEditing.held,false);assert.equal(report.placed.joinedEditing.pending,false);
 assert(report.placed.joinedExterior.steps>report.before.joinedExterior.steps);assert.equal(report.placed.sceneSolidGeometryBuilds,report.before.sceneSolidGeometryBuilds+1);
 assert.equal(report.placed.joinedExterior.generation,report.before.joinedExterior.generation);
 report.phase='cancel';await save();
 await evaluate(`window.kaminosSceneEdits.begin(${JSON.stringify(target.id)},'Cancel witness');window.kaminosSceneEdits.preview(${JSON.stringify(target.transform)})`);
 report.cancelHeld=await step(3);assert.equal(report.cancelHeld.joinedEditing.held,true);
 assert.equal(report.cancelHeld.sceneSolidGeometryBuilds,report.placed.sceneSolidGeometryBuilds);
 await evaluate('window.kaminosSceneEdits.cancel()');report.cancelled=await step(3);
 assert.equal(report.cancelled.sceneSolidGeometryBuilds,report.placed.sceneSolidGeometryBuilds);assert.equal(report.cancelled.joinedEditing.pending,false);
 await evaluate('window.__kaminosVolumePrototype.setSimulationPaused(true)');await shot('resumed');
 report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.error=String(e.stack||e);if(browser)report.lastState=await browser.evaluate('window.__kaminosVolumePrototype?.debugState()').catch(()=>null);process.exitCode=1;}
finally{await browser?.close();report.terminal=true;await save();}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));
