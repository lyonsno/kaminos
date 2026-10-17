// kaminos-test: manual — actual shared Workbench consumer, explicit URL/output
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {launchChrome,sourceIdentity} from '../models/flux2-klein/cdp-harness.mjs';
const [input,out]=process.argv.slice(2);assert(input&&out,'URL and evidence directory required');
await fs.mkdir(out,{recursive:true});
const report={source:sourceIdentity(resolve('.')),phase:'launch',receiver:'sexy-fireman',url:input,claim:'joined distributed-lighting consumer exercise; not frame-budget or boundary-artifact causality'};
const save=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));
let browser;
try{
 await fs.copyFile(new URL(import.meta.url),out+'/effective-smoke.mjs');await save();
 report.executable='/Users/noahlyons/.local/state/kaminos/browser-cache/cft154-verified-0930/chrome/mac_arm-154.0.8037.92/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
 browser=await launchChrome(report.executable,['--use-angle=metal','--window-size=1200,900'],report,{profileDir:out+'/profile'});
 report.phase='load';await save();
 await browser.navigate(input,'Boolean(window.__kaminosVolumePrototype && window.kaminosSceneAuthoring)');
 report.phase='settle';await save();
 await browser.evaluate(`new Promise((resolve,reject)=>{const t=setInterval(()=>{const v=window.__kaminosVolumePrototype,s=v.debugState(),l=window.__kaminosSceneRadiance?.debugState();if(s.error||l?.error||window.__kaminosSceneRadianceSetup?.status==='failed'){clearInterval(t);reject(Error(s.error||l?.error||JSON.stringify(window.__kaminosSceneRadianceSetup)));}else if(s.simStepCount>=80&&l?.frame?.exteriorSmokeReconstruction){v.setSimulationPaused(true);clearInterval(t);resolve();}},100)})`);
 await browser.evaluate(`window.__kaminosSetActiveTab('volume');window.kaminosSetCameraDebugPose({position:[0,2,10],target:[0,2,0]});window._kaminosDirty();new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
 report.phase='admission';await save();
 report.runtime=await (await fetch(new URL('/api/runtime-config',input))).json();
 assert.equal(report.runtime.source.repoRoot,resolve('.'));assert.equal(report.runtime.source.commit,report.source.rev);
 report.state=await browser.evaluate('window.__kaminosVolumePrototype.debugState()');
 report.lighting=await browser.evaluate('window.__kaminosSceneRadiance.debugState()');
 report.sourceField=await browser.evaluate(`(()=>{const s=window.__kaminosVolumePrototype.sceneVolumeSourceField();return {...s,texture:!!s.texture,scatteringTexture:!!s.scatteringTexture,exterior:s.exterior?{...s.exterior,texture:!!s.exterior.texture,scatteringTexture:!!s.exterior.scatteringTexture}:null};})()`);
 assert.equal(report.lighting.identity,'hybrid-distributed-smoke-point-surfaces-v0');assert.equal(report.lighting.pointCount,2);assert.equal(report.lighting.shadowSampling,'complementary');
 assert.equal(report.lighting.smokeMode,'distributed');assert.equal(report.lighting.frame.integration,'exact-cell');
 assert.equal(report.lighting.directions,8);assert.equal(report.lighting.frame.angularPattern,'guided');
 assert.equal(report.state.physicalColor.incidentLight.legacyDispatched,false);
 assert.equal(report.state.physicalColor.materialLawEffective,'physics-soot-blackbody-v0');
 assert.equal(report.state.reactantCombustion.effective.admitted,true);
 assert.equal(report.state.reactantCombustion.effective.law,'reactant-v0');
 assert(report.lighting.frame.exteriorVolumeReceivers>0);assert(report.sourceField.exterior?.texture);assert(report.state.joinedRendering.enabled);assert(report.state.ordinarySceneDepth.effective);
 report.canRender=await browser.evaluate('window.__kaminosSceneRadiance.canRender()');assert.equal(report.canRender,true);
 const shot=async name=>{const r=await browser.send('Page.captureScreenshot',{format:'png'});assert(r.result?.data,'screenshot missing');await fs.writeFile(out+'/'+name+'.png',Buffer.from(r.result.data,'base64'));};
 await shot('distributed');
 report.phase='held-light-control';await save();
 await browser.evaluate(`window.__kaminosSceneRadiance.setGain(0);window._kaminosDirty();new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);await shot('incident-zero');
 await browser.evaluate(`window.__kaminosSceneRadiance.setGain(${JSON.stringify(report.lighting.gain)});window._kaminosDirty();new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);await shot('restored');
 report.finalState=await browser.evaluate('window.__kaminosVolumePrototype.debugState()');assert.equal(report.finalState.simStepCount,report.state.simStepCount,'held comparisons advanced simulation');
 report.phase='save';await save();
 report.saved=await browser.evaluate(`window.saveSceneAs({result:true,name:'Joined distributed lighting '+Date.now()})`);assert(report.saved?.ok);
 report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.error=String(e.stack||e);if(browser)report.lastState=await browser.evaluate('({volume:window.__kaminosVolumePrototype?.debugState(),lighting:window.__kaminosSceneRadiance?.debugState(),setup:window.__kaminosSceneRadianceSetup})').catch(()=>null);process.exitCode=1;}
finally{await browser?.close();report.terminal=true;await save();}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));
