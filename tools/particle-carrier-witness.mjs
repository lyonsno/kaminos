import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const ROUTE='native-3d-compute-fluid-raymarch-v0';
const REACTION_KEYS=['burnTime','cooling','heatRelease','sootYield','smokeLife'];
const DEFAULT_PARTICLES={enabled:true,acquisitionMode:1,capacity:8192,acquisitionSamples:2048,depthMode:1,depthSlices:16,targetScale:.5,depthScale:.5,showParticles:true,showRaymarch:false,renewalDiagnostics:true,exchangeStrength:1,exchangeTime:8,exchangeCellSize:1,stateLife:1,lifeFuel:24,lifeHeat:24,lifeSmoke:48,lifeQuiet:6,lifeFade:.2,followFraction:.75,followJitter:.25,followFuel:1,followHeat:1,followSmoke:1,debugView:0,emissionFalloff:1,extinctionFalloff:1,emissionEdgeSoftness:.2,extinctionEdgeSoftness:.3};
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const bytes=value=>Buffer.isBuffer(value)?value:typeof value==='string'?Buffer.from(value,'base64'):ArrayBuffer.isView(value)?Buffer.from(value.buffer,value.byteOffset,value.byteLength):Buffer.alloc(0);
const floats=value=>{const b=bytes(value);assert.equal(b.byteLength%4,0,'partial FP32 record bytes');return new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
export function carrierRecipe(recipe){
 assert.ok(recipe&&typeof recipe==='object'&&typeof recipe.url==='string'&&recipe.url,'Native carrier recipe URL required');
 const particles={...DEFAULT_PARTICLES,...recipe.particles},source={renderScale:.5,raySteps:8,...recipe.source};
 for(const key of ['enabled','acquisitionMode','capacity','acquisitionSamples','depthMode','depthSlices','targetScale','depthScale','showParticles','showRaymarch','debugView'])assert.equal(particles[key],DEFAULT_PARTICLES[key],'carrier recipe config '+key);
 for(const key of ['exchangeStrength','stateLife','followFraction'])assert.ok(particles[key]>0&&particles[key]<=1,'carrier recipe must exercise '+key);
 assert.ok(source.renderScale>0&&Number.isFinite(source.renderScale));assert.ok(source.raySteps>0&&Number.isFinite(source.raySteps),'native witness ray steps must be positive finite');
 const developSteps=recipe.developSteps??28,continueSteps=recipe.continueSteps??4;
 for(const n of [developSteps,continueSteps])assert.ok(Number.isSafeInteger(n)&&n>0,'witness step counts must be positive integers');
 const viewport=recipe.viewport??{width:1100,height:900};for(const n of [viewport.width,viewport.height])assert.ok(Number.isSafeInteger(n)&&n>0,'viewport dimensions must be positive integers');
 return {...recipe,particles,source,developSteps,continueSteps,viewport};
}
export function verifyCarrierState(state,expected){
 assert.match(state.backend,/webgpu:apple/i,'native WebGPU Apple backend required');
 assert.equal(state.active,true,'native route must remain active');assert.equal(state.effectiveRoute,ROUTE,'wrong effective native route');
 assert.equal(state.gridHeight?.widthCells,8,'single-grid width must be 8');assert.equal(state.gridHeight?.heightCells,12,'single-grid height must be 12');
 assert.equal(state.worldSmoke?.effective,'off','single-grid carrier witness requires Coarse/World off');
 assert.equal(state.opticalParticles?.effective,'world-optical-particles','actual particle route required');assert.equal(state.opticalParticles.recordFloats,24,'complete 96-byte carrier record required');
 assert.ok(['gpu-count-exclusive-prefix-scatter','off'].includes(state.opticalParticles.exchange?.grouping),'native GPU exchange grouping or explicitly held work required');assert.ok(state.opticalParticles.exchange.cellCount>0&&state.opticalParticles.exchange.bytes>0,'missing effective exchange resources');
 assert.equal(state.splitIntegral?.effective,'source-observations','native source observation route required');assert.equal(state.splitIntegral.freshEvaluations,1,'one actual fresh evaluation required');
 for(const [key,value] of Object.entries(expected))assert.equal(state.opticalParticles.settings[key],value,'effective particle setting '+key);
 const p=state.opticalParticles;if(expected.capacity)assert.equal(p.slots,expected.capacity,'effective population slots differ from requested capacity');if(expected.acquisitionSamples){assert.equal(p.work?.configuredFreshBudget??p.freshSamples,expected.acquisitionSamples,'configured fresh samples differ from acquisition request');if(p.work)assert.ok([0,expected.acquisitionSamples].includes(p.freshSamples),'effective fresh budget must name a skipped or full acquisition');}
 if(expected.exchangeCellSize){const dims=[8,12,8].map(n=>Math.ceil(n/expected.exchangeCellSize));assert.deepEqual((p.exchange.planned??p.exchange).cellDims,dims,'stale effective exchange cell grouping');assert.equal((p.exchange.planned??p.exchange).cellCount,dims.reduce((a,b)=>a*b),'stale effective exchange cell count');}
 if(expected.targetScale){assert.ok(Array.isArray(p.outputSize)&&p.outputSize.length===2,'missing effective output size');assert.deepEqual(p.targetSize,p.outputSize.map(n=>Math.max(1,Math.ceil(n*expected.targetScale))),'stale effective particle target size');}
 if(expected.debugView>0){assert.equal(p.effectiveDepthMode,0,'diagnostic effective depth must be unsliced');assert.equal(p.depthField,null,'diagnostic depth field must be absent');assert.equal(p.gridAssist?.effective,'off','diagnostic extinction assist must be suspended');assert.equal(p.gridAssist.effectiveStrength,0,'diagnostic extinction assist strength must be zero');}
 else if(expected.debugView===0){
  assert.equal(p.effectiveDepthMode,expected.depthMode,'stale effective depth mode');
  if(expected.depthMode){assert.equal(p.depthField?.slices,expected.depthSlices,'stale effective depth slices');if(expected.depthScale){assert.equal(p.depthField.width,Math.max(1,Math.ceil(p.targetSize[0]*expected.depthScale)),'stale effective depth width');assert.equal(p.depthField.height,Math.max(1,Math.ceil(p.targetSize[1]*expected.depthScale)),'stale effective depth height');}}else assert.equal(p.depthField,null,'unsliced optical view must not claim a depth field');
  if(expected.fillExtinction>0||expected.extinctionView>0){assert.equal(p.gridAssist?.effective,'current-single-grid-extinction','requested extinction assist did not execute');assert.ok(p.gridAssist.generation>0,'current extinction generation required');}
 }
}
export function carrierImageDelta(before,after){
 assert.equal(before.width,after.width,'native image width changed');assert.equal(before.height,after.height,'native image height changed');
 const a=bytes(before.rgba),b=bytes(after.rgba);assert.equal(a.length,b.length,'native image byte shape changed');assert.equal(a.length,before.width*before.height*4,'partial native image');
 let changedPixels=0,changedChannels=0,changedRgbPixels=0,maxChannelDelta=0,absoluteChannelDelta=0;
 for(let i=0;i<a.length;i+=4){let changed=false,rgb=false;for(let k=0;k<4;k++){const d=Math.abs(a[i+k]-b[i+k]);if(d){changed=true;changedChannels++;if(k<3)rgb=true;}maxChannelDelta=Math.max(maxChannelDelta,d);absoluteChannelDelta+=d;}if(changed)changedPixels++;if(rgb)changedRgbPixels++;}
 return {exact:changedChannels===0,changedPixels,changedRgbPixels,changedChannels,maxChannelDelta,absoluteChannelDelta,meanAbsoluteChannelDelta:a.length?absoluteChannelDelta/a.length:0,beforeSha256:digest(a),afterSha256:digest(b)};
}
export function verifyCarrierSnapshot(snapshot,expected,{allowBlank=false}={}){
 verifyCarrierState(snapshot.state,expected);assert.equal(snapshot.frame?.ok,true,'native frame sample failed');assert.equal(snapshot.available,true,'missing retained carrier sample');
 assert.equal(snapshot.frame.effectiveRoute,ROUTE,'frame used wrong route');assert.equal(snapshot.frame.backend,snapshot.state.backend,'frame/backend identity mismatch');assert.equal(snapshot.frame.simStepCount,snapshot.state.simStepCount,'frame and state step differ');
 assert.equal(snapshot.particleState?.step,snapshot.state.opticalParticles.step,'particle readback step is stale');assert.equal(snapshot.particleState?.slots,snapshot.state.opticalParticles.slots,'particle readback population is stale');
 assert.ok(Number.isSafeInteger(snapshot.particleState?.frames)&&snapshot.particleState.frames>0,'missing particle readback frame identity');assert.equal(snapshot.particleState.frames,snapshot.state.opticalParticles.frames,'particle readback frame is stale');
 const {width,height}=snapshot.image??{};assert.ok(Number.isSafeInteger(width)&&width>0&&Number.isSafeInteger(height)&&height>0,'missing native image dimensions');const rgba=bytes(snapshot.image.rgba);
 assert.equal(rgba.length,width*height*4,'missing or partial native image size');assert.equal(width,snapshot.state.width,'native image width differs from effective output');assert.equal(height,snapshot.state.height,'native image height differs from effective output');
 const nonblank=rgba.some((v,i)=>i%4!==3&&v>10);if(!allowBlank)assert.ok(nonblank,'blank native image');
 const raw=bytes(snapshot.records);assert.equal(raw.length,snapshot.state.opticalParticles.slots*96,'missing or partial full carrier population');const records=floats(raw);let active=0;
 for(let i=0;i<records.length;i++){assert.ok(Number.isFinite(records[i]),'nonfinite carrier record');if(i%24===3&&records[i]>0)active++;if(i%24>=20&&records[i-((i%24)-3)]>0)assert.ok(records[i]>=-1e-6,'negative carried composition');}
 assert.ok(active>0,'blank active carrier population');assert.equal(snapshot.state.opticalParticles.reset,false,'unexpected particle pool reset');
 return {active,slots:snapshot.state.opticalParticles.slots,nonblank,recordBytes:raw.length,rgbaBytes:rgba.length};
}
export function verifyCarrierPause(live,paused,onObservation=()=>{}){
 assert.equal(live.state.simulationPaused,false,'live capture must precede the pause');assert.equal(paused.state.simulationPaused,true,'paused capture is not paused');assert.equal(paused.state.simStepCount,live.state.simStepCount,'pause advanced simulation time');
 assert.equal(live.frame.simAdvanced,true,'live image was not an advancing frame');assert.equal(paused.frame.simAdvanced,false,'paused image attempted simulation advancement');
 const observation={recordsExact:bytes(live.records).equals(bytes(paused.records)),step:live.state.simStepCount,image:carrierImageDelta(live.image,paused.image),livePhase:{time:live.frame.renderPhaseTimeMs,frame:live.frame.renderPhaseFrame,authority:live.frame.renderPhaseAuthority},pausedPhase:{time:paused.frame.renderPhaseTimeMs,frame:paused.frame.renderPhaseFrame,authority:paused.frame.renderPhaseAuthority},claim:'Carrier-byte equality and pixel delta at the same step are measured separately; neither substitutes for the other'};
 onObservation(observation);assert.ok(observation.recordsExact,'live-to-pause changed retained carrier bytes');return observation;
}
export function verifyCarrierProgress(before,after){
 const a=floats(before),b=floats(after);assert.equal(a.length,b.length,'continued carrier population shape changed');let retained=0,moved=0,materialChanged=0,survivalAdvanced=0;
 for(let i=0;i<a.length;i+=24){if(a[i+3]<=0||b[i+3]<=a[i+3])continue;if(![4,5,6,7,11,16,19].every(k=>a[i+k]===b[i+k]))continue;retained++;if([0,1,2].some(k=>a[i+k]!==b[i+k]))moved++;if([20,21,22,23].some(k=>a[i+k]!==b[i+k]))materialChanged++;if(b[i+15]>a[i+15])survivalAdvanced++;}
 assert.ok(retained>0&&moved>0,'no retained carrier motion');assert.ok(materialChanged>0,'no carried composition evolution');assert.ok(survivalAdvanced>0,'no representation survival-clock progress');return {retained,moved,materialChanged,survivalAdvanced};
}
export function verifyCarrierFollow(statistics,step){
 assert.equal(statistics?.available,true,'native population statistics unavailable');assert.equal(statistics.identity?.step,step,'follow statistics are stale');assert.ok(Number.isSafeInteger(statistics.followed)&&statistics.followed>0,'no consumed native carrier-follow source rows');assert.ok(statistics.followed<=statistics.evaluated,'followed rows exceed actual source evaluations');return {followed:statistics.followed,evaluated:statistics.evaluated,step};
}
export function verifyCarrierAdvanceHistory(steps,start,count){
 assert.ok(Number.isSafeInteger(start)&&start>=0,'missing native initial simulation step');assert.equal(steps.length,count,'partial development history');
 for(let i=0;i<steps.length;i++){assert.equal(steps[i].ok,true,'native development frame failed');assert.equal(steps[i].step,start+i+1,'cached or nonadvancing native development frame');}
 return {start,end:start+count,count};
}
export async function writeCarrierSnapshot(out,name,snapshot){
 const records=bytes(snapshot.records),rgba=bytes(snapshot.image?.rgba),files={records:path.join(out,name+'.records.f32'),rgba:path.join(out,name+'.rgba8'),metadata:path.join(out,name+'.snapshot.json')};
 await fs.mkdir(out,{recursive:true});await fs.writeFile(files.records,records);await fs.writeFile(files.rgba,rgba);
 const metadata={...snapshot,records:{path:files.records,bytes:records.length,sha256:digest(records)},image:{width:snapshot.image?.width,height:snapshot.image?.height,path:files.rgba,bytes:rgba.length,sha256:digest(rgba)}};
 await fs.writeFile(files.metadata,JSON.stringify(metadata,null,2));return {name,files,step:snapshot.state?.simStepCount,recordsSha256:digest(records),imageSha256:digest(rgba),settings:snapshot.settings,effective:snapshot.effective};
}

// Executed in the actual page. Base64 chunks transport every byte; they do not
// select or cap records/pixels. The pause happens before returning the live
// snapshot, while automatic capture remains held throughout the transition.
async function snapshotInPage({advanceSim=false,now,pauseAfter=false,statistics=false}){
 const v=window.__kaminosVolumePrototype;const frame=await v.sampleFrame({advanceSim,now,includeRgba:true});let sample=null,sampleError=null,population=null;
 try{sample=await v.sampleOpticalParticles();if(statistics)population=await v.sampleOpticalParticleStatistics();}catch(error){sampleError=String(error);}
 function encode(bytes){let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);}
 const {image,preview,...receipt}=frame;const state=structuredClone(v.debugState());
 const result={frame:{...receipt,preview:preview?{width:preview.width,height:preview.height}:null},state,effective:v.opticalParticleState(),settings:v.opticalParticleSettings(),available:sample?.available===true,particleState:sample?.state??null,sampleError,statistics:population,records:sample?.records?encode(new Uint8Array(sample.records.buffer,sample.records.byteOffset,sample.records.byteLength)):null,image:image?{width:image.width,height:image.height,rgba:encode(new Uint8Array(image.rgba))}:null};
 if(pauseAfter)result.pauseReceipt=v.setSimulationPaused(true);return result;
}

export async function runParticleCarrierWitness({origin,out,expectedCommit,expected,repoRoot,recipePath,playwrightModule,ChromeForTesting,executable}={}){
 assert.ok(out,'Caller-owned witness output directory required');await fs.mkdir(out,{recursive:true});let browser,page;
 const report={schema:'kaminos.particle-carrier-witness.v1',status:'failed',phase:'recipe',origin,expectedCommit:expectedCommit??expected,repoRoot,recipePath,requestedExecutable:ChromeForTesting??executable,errors:[],snapshots:[],checks:{},lastTrustworthy:null};
 let saves=Promise.resolve();const save=()=>{const text=JSON.stringify(report,null,2);saves=saves.then(()=>fs.writeFile(path.join(out,'report.json'),text));return saves;};await save();
 try{
  assert.ok(origin&&report.expectedCommit&&repoRoot&&recipePath&&playwrightModule&&report.requestedExecutable,'Complete native witness source/browser arguments required');
  const rawRecipe=await fs.readFile(recipePath);report.recipeSha256=digest(rawRecipe);report.requestedRecipe=JSON.parse(rawRecipe);report.recipe=carrierRecipe(report.requestedRecipe);
  report.phase='runtime';await save();report.runtime=await fetch(new URL('/api/runtime-config',origin)).then(r=>{assert.ok(r.ok,'native runtime config unavailable');return r.json();});
  assert.equal(report.runtime.source?.commit,report.expectedCommit,'wrong source revision');assert.equal(report.runtime.source?.repoRoot,repoRoot,'wrong source checkout');assert.equal(report.runtime.source?.dirty,false,'committed native source required');report.lastTrustworthy={phase:'runtime',source:report.runtime.source};
  report.phase='browser';await save();report.effectiveExecutable=await fs.realpath(report.requestedExecutable);assert.ok(!/google chrome\.app(?:\/|$)/i.test(report.effectiveExecutable),'Installed GUI Chrome cannot run headless');assert.match(report.effectiveExecutable,/chrome for testing|chromium|chrome[-_]headless[-_]shell/i,'Independent Chrome for Testing/Chromium executable required');await fs.access(report.effectiveExecutable,fs.constants.X_OK);
  const {chromium}=await import(playwrightModule);browser=await chromium.launchPersistentContext(path.join(out,'profile'),{executablePath:report.effectiveExecutable,headless:true,viewport:report.recipe.viewport,recordVideo:{dir:path.join(out,'video'),size:report.recipe.viewport},args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});report.browserVersion=browser.browser()?.version()??null;
  page=browser.pages()[0]??await browser.newPage();page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);
  let failBrowser;const failedBrowser=new Promise((_,reject)=>{failBrowser=reject;});void failedBrowser.catch(()=>{});const guard=p=>Promise.race([p,failedBrowser]);
  const browserError=e=>{report.errors.push(e.stack??String(e));failBrowser(Error(String(e)));void save();};page.on('pageerror',browserError);page.on('console',m=>{if(m.type()==='error')browserError(m.text());});page.on('crash',()=>browserError('Native witness page crashed'));await page.route('**/favicon.ico',r=>r.fulfill({status:204,body:''}));
  const evaluate=(fn,arg)=>guard(page.evaluate(fn,arg));const url=new URL(report.recipe.url,origin),host=new URL(origin);url.protocol=host.protocol;url.host=host.host;report.url=url.href;
  report.phase='load';await save();await guard(page.goto(report.url,{waitUntil:'domcontentloaded'}));await guard(page.waitForFunction(()=>window.__kaminosVolumePrototype?.debugState()?.active&&window.kaminosWorkbenchExperiments?.state()?.id==='optical-particles'));
  report.phase='configure';await save();report.configured=await evaluate(async recipe=>{const v=window.__kaminosVolumePrototype;v.setCapturePaused(true);v.setSimulationPaused(true);v.setControls({worldSmoke:'off',resolution:8,gridHeightRatio:1.5,fineVelocity:8,finePressure:8,raymarchMode:'budgeted',raySteps:8,occupancySkip:0,rayNoiseFrame:0,integralReconstruction:'off'});await window.kaminosWorkbenchExperiments.invoke('setSource',recipe.source);await window.kaminosWorkbenchExperiments.invoke('setOptions',recipe.particles);return v.debugState();},report.recipe);
  const verify=async(name,snapshot,expectedSettings,options={})=>{const artifact=report.snapshots.find(s=>s.name===name);artifact.verification=verifyCarrierSnapshot(snapshot,expectedSettings,options);report.lastTrustworthy={phase:report.phase,name,files:artifact.files,step:artifact.step};await save();};
  const record=async(name,snapshot,expectedSettings,{allowBlank=false,deferVerification=false}={})=>{const artifact=await writeCarrierSnapshot(out,name,snapshot);report.snapshots.push(artifact);report.lastCaptured={phase:report.phase,name,files:artifact.files,step:artifact.step};await save();if(!deferVerification)await verify(name,snapshot,expectedSettings,{allowBlank});return snapshot;};
  const invoke=patch=>evaluate(p=>window.kaminosWorkbenchExperiments.invoke('setOptions',p),patch);
  const capture=async(name,settings,options={})=>record(name,await evaluate(snapshotInPage,{now:report.captureNow,...options}),settings,options);
  const viewport=async(name,snapshot)=>{
   await evaluate(async()=>{const v=window.__kaminosVolumePrototype;if(!v.debugState().simulationPaused)throw Error('Viewport presentation requires paused material');v.setCapturePaused(false);for(let i=0;i<3;i++)await new Promise(requestAnimationFrame);v.setCapturePaused(true);});
   const png=path.join(out,name+'.viewport.png');await guard(page.locator('#viewport').screenshot({path:png}));
   const presented=await evaluate(async()=>{const v=window.__kaminosVolumePrototype,s=await v.sampleOpticalParticles();let text='';const b=new Uint8Array(s.records.buffer,s.records.byteOffset,s.records.byteLength);for(let i=0;i<b.length;i+=32768)text+=String.fromCharCode(...b.subarray(i,i+32768));return {state:v.debugState(),records:btoa(text),available:s.available};});
   const recordFile=path.join(out,name+'.viewport.records.f32');await fs.writeFile(recordFile,bytes(presented.records));const receipt={png,recordFile,state:presented.state,recordSha256:digest(bytes(presented.records)),rawSnapshotStep:snapshot.state.simStepCount,rawSnapshotFrame:snapshot.frame.frameCount,relationship:'Paused viewport presentation after the raw sample; screenshot is not substituted for raw RGBA'};await fs.writeFile(path.join(out,name+'.viewport.json'),JSON.stringify(receipt,null,2));report.snapshots.find(s=>s.name===name).viewport=receipt;await save();assert.equal(presented.available,true);assert.equal(presented.state.simStepCount,snapshot.state.simStepCount,'viewport presentation advanced simulation');assert.ok(bytes(presented.records).equals(bytes(snapshot.records)),'viewport presentation changed carrier bytes');
  };
  report.phase='develop';await save();report.development=await evaluate(async count=>{const v=window.__kaminosVolumePrototype;v.setSimulationPaused(false);const steps=[];for(let i=0;i<count;i++){const f=await v.sampleFrame({advanceSim:true,now:1000+16*i});steps.push({ok:f.ok,reason:f.reason,validationError:f.validationError,step:f.simStepCount,frame:f.frameCount});if(!f.ok)break;}return {steps,state:v.debugState()};},report.recipe.developSteps-1);await save();report.checks.development=verifyCarrierAdvanceHistory(report.development.steps,report.configured.simStepCount,report.recipe.developSteps-1);
  report.captureNow=1000+16*(report.recipe.developSteps-1);report.phase='live-pause';await save();
  const live=await record('last-advancing',await evaluate(snapshotInPage,{advanceSim:true,now:report.captureNow,pauseAfter:true,statistics:true}),report.recipe.particles,{deferVerification:true});
  const paused=await capture('immediately-paused',report.recipe.particles,{statistics:true,deferVerification:true});await verify('last-advancing',live,report.recipe.particles);await verify('immediately-paused',paused,report.recipe.particles);assert.equal(live.state.simStepCount,report.configured.simStepCount+report.recipe.developSteps,'last live sample was cached or did not advance');report.checks.livePause=verifyCarrierPause(live,paused,observation=>{report.checks.livePause=observation;});report.checks.follow=verifyCarrierFollow(live.statistics,live.state.simStepCount);await save();await viewport('immediately-paused',paused);
  const held=bytes(paused.records);let settings={...report.recipe.particles};
  const heldArm=async(name,patch,options={})=>{await invoke(patch);settings={...settings,...patch};const sample=await capture(name,settings,options);assert.equal(sample.state.simStepCount,paused.state.simStepCount,'paused control advanced simulation');assert.ok(bytes(sample.records).equals(held),'paused '+name+' changed carrier bytes');await viewport(name,sample);return sample;};
  report.phase='controls';await save();const strength=settings.exchangeStrength===.6?.4:.6,control=page.getByLabel('Exchange strength',{exact:true});await guard(control.focus());await guard(control.fill(String(strength)));await guard(control.press('Enter'));await guard(page.waitForFunction(v=>window.__kaminosVolumePrototype.opticalParticleSettings().exchangeStrength===v,strength));settings.exchangeStrength=strength;const typed=await capture('typed-exchange',settings);assert.ok(bytes(typed.records).equals(held),'typed exchange edit reset material');await viewport('typed-exchange',typed);
  report.phase='paused-work';await save();const captureStep=paused.effective.work.lastCaptureStep;
  const pausedBudget=await heldArm('paused-acquisition-edited',{acquisitionSamples:report.recipe.particles.acquisitionSamples+1,acquisitionEvery:3});
  assert.equal(pausedBudget.effective.work.freshEvaluationBudget,0,'paused budget edit evaluated a dropped batch');assert.equal(pausedBudget.effective.work.updateSlots,0,'paused draw dispatched a no-op update');assert.equal(pausedBudget.effective.work.birthCapacityPerFrame,0);assert.equal(pausedBudget.effective.work.lastCaptureStep,captureStep,'paused policy edit consumed the capture interval');
  report.checks.pausedWork={...pausedBudget.effective.work};
  const pausedTiming=await evaluate(()=>window.__kaminosVolumePrototype.measureOpticalParticleFrame());assert.equal(pausedTiming.ok,true,pausedTiming.reason);for(const name of ['acquisition','follow','update','births','exchangeField','exchangeGather'])assert.equal(name in pausedTiming.passes,false,'paused GPU profile encoded '+name);report.checks.pausedTiming=pausedTiming;
  await heldArm('paused-acquisition-restored',{acquisitionSamples:report.recipe.particles.acquisitionSamples,acquisitionEvery:1});
  await invoke({hud:false});report.checks.hudHidden=await evaluate(()=>document.querySelector('[aria-label="Live particle work"]').style.display);assert.equal(report.checks.hudHidden,'none','HUD switch must apply immediately');await invoke({hud:true});
  await heldArm('exchange-off',{exchangeStrength:0});await heldArm('exchange-tuned',{exchangeStrength:1,exchangeTime:settings.exchangeTime*1.5,exchangeCellSize:settings.exchangeCellSize*2});
  await heldArm('survival-tuned',{stateLife:.7,lifeFuel:settings.lifeFuel*1.25,lifeHeat:settings.lifeHeat*1.25,lifeSmoke:settings.lifeSmoke*1.25,lifeQuiet:settings.lifeQuiet*1.25,lifeFade:.4});
  await heldArm('follow-tuned',{followFraction:1,followJitter:.1,followFuel:.5,followHeat:2,followSmoke:1.5});
  const reaction=paused.effective.simulationReaction;assert.ok(reaction,'active native Reactant law required');const patch=Object.fromEntries(REACTION_KEYS.map(k=>{assert.ok(Number.isFinite(reaction[k]),'missing shared reaction '+k);return [k,reaction[k]*(k==='sootYield'?.8:1.1)];}));
  await evaluate(p=>window.kaminosWorkbenchExperiments.invoke('setReaction',p),patch);settings={...settings,...patch};const shared=await capture('shared-reaction-edited',settings);for(const [key,v] of Object.entries(patch))assert.equal(shared.effective.simulationReaction[key],v,'shared reaction setting '+key);assert.ok(bytes(shared.records).equals(held),'shared reaction edit reset or mutated paused carriers');await viewport('shared-reaction-edited',shared);
  report.phase='kernels';await save();const normalPatch={profileMode:1,debugView:0,emissionFalloff:report.recipe.particles.emissionFalloff,extinctionFalloff:report.recipe.particles.extinctionFalloff,emissionEdgeSoftness:report.recipe.particles.emissionEdgeSoftness,extinctionEdgeSoftness:report.recipe.particles.extinctionEdgeSoftness};const kernelBefore=await heldArm('kernel-before',normalPatch),kernelAfter=await heldArm('kernel-tuned',{emissionFalloff:2.4,extinctionFalloff:.6,emissionEdgeSoftness:.8,extinctionEdgeSoftness:.7}),kernelRestored=await heldArm('kernel-restored',normalPatch);
  report.checks.kernel={changed:carrierImageDelta(kernelBefore.image,kernelAfter.image),restored:carrierImageDelta(kernelBefore.image,kernelRestored.image),recordsExact:true};assert.ok(report.checks.kernel.changed.changedRgbPixels>0,'kernel edits did not change the native image');await save();
  report.phase='diagnostics';await save();for(const [name,debugView] of [['fuel',1],['heat',2],['survival',6],['exchange-field-heat',8]])await heldArm('debug-'+name,{debugView},{allowBlank:true});
  report.phase='continued';await save();await invoke({...report.recipe.particles,...patch,refresh:0,debugView:0});settings={...report.recipe.particles,...patch,refresh:0,debugView:0};const before=await capture('continued-before',settings);assert.ok(bytes(before.records).equals(held));
  report.continuation=await evaluate(async({count,now})=>{const v=window.__kaminosVolumePrototype;v.setSimulationPaused(false);const steps=[];for(let i=0;i<count-1;i++){const f=await v.sampleFrame({advanceSim:true,now:now+16*(i+1)});steps.push({ok:f.ok,reason:f.reason,validationError:f.validationError,step:f.simStepCount});if(!f.ok)break;}return steps;},{count:report.recipe.continueSteps,now:report.captureNow});await save();report.checks.continuation=verifyCarrierAdvanceHistory(report.continuation,before.state.simStepCount,report.recipe.continueSteps-1);report.captureNow+=16*report.recipe.continueSteps;
  const continued=await record('continued-advancing',await evaluate(snapshotInPage,{advanceSim:true,now:report.captureNow,pauseAfter:true,statistics:true}),settings);assert.equal(continued.state.simStepCount,before.state.simStepCount+report.recipe.continueSteps,'continued live sample did not advance');report.checks.progress=verifyCarrierProgress(before.records,continued.records);const continuedPaused=await capture('continued-paused',settings);report.checks.continuedPause=verifyCarrierPause(continued,continuedPaused,observation=>{report.checks.continuedPause=observation;});await viewport('continued-paused',continuedPaused);
  report.phase='hard-work-gates';await save();
  const gatePatch={acquisitionEnabled:false,birthsEnabled:false,updateEnabled:false,exchangeEnabled:false,groupingEnabled:false,transportEnabled:false,reactionEnabled:false,liveTimings:false};
  await invoke(gatePatch);const frozenBefore=await evaluate(snapshotInPage,{now:report.captureNow});await evaluate(()=>window.__kaminosVolumePrototype.setSimulationPaused(false));report.captureNow+=16;
  const gated=await record('hard-gates-advancing',await evaluate(snapshotInPage,{advanceSim:true,now:report.captureNow,pauseAfter:true}),{...settings,...gatePatch},{deferVerification:true});
  assert.equal(gated.state.effectiveRoute,ROUTE);assert.equal(gated.state.active,true);assert.ok(bytes(gated.records).equals(bytes(frozenBefore.records)),'hard work gates changed retained records');
  for(const key of ['freshEvaluationBudget','acquisitionPixels','updateSlots','birthCapacityPerFrame'])assert.equal(gated.effective.work[key],0,'disabled '+key+' still ran');
  for(const key of ['grouping','fieldReduce','fieldGather'])assert.equal(gated.effective.exchange.work[key],false,'disabled '+key+' still ran');
  report.checks.hardGates={passed:true,step:gated.state.simStepCount,work:gated.effective.work,exchange:gated.effective.exchange.work};await viewport('hard-gates-advancing',gated);
  await invoke({...report.recipe.particles,...patch,refresh:0,profileMode:0,maxFootprint:2,exchangeHeat:4,exchangeSpecies:1,exchangeSoot:1,exchangeRate:2,exchangeEvery:2,acquisitionEvery:3,acquisitionEnabled:true,birthsEnabled:true,updateEnabled:true,exchangeEnabled:true,groupingEnabled:true,transportEnabled:true,reactionEnabled:true,liveTimings:true,timingEvery:1});
  report.checks.finalControls=await evaluate(()=>window.__kaminosVolumePrototype.opticalParticleSettings());
  report.phase='field-cadence';await save();await evaluate(()=>window.__kaminosVolumePrototype.setSimulationPaused(false));const cadence=[];
  for(let i=0;i<6;i++){report.captureNow+=16;const snap=await record('field-cadence-'+i,await evaluate(snapshotInPage,{advanceSim:true,now:report.captureNow,pauseAfter:i===5}),report.checks.finalControls);cadence.push({step:snap.state.simStepCount,work:snap.effective.work,exchange:snap.effective.exchange.work,field:snap.effective.exchange.field});}
  assert.ok(cadence.some(r=>r.work.freshEvaluationBudget===0)&&cadence.some(r=>r.work.freshEvaluationBudget>0),'acquisition cadence did not alternate actual work');assert.ok(cadence.some(r=>r.exchange.fieldGather)&&cadence.some(r=>!r.exchange.fieldGather),'field cadence did not alternate actual work');report.checks.cadence=cadence;

  assert.deepEqual(report.errors,[]);report.status='passed';report.phase='complete';report.visualExact=report.checks.livePause.image.exact&&report.checks.continuedPause.image.exact&&report.checks.kernel.restored.exact;report.verdict=report.visualExact?'Carrier/control predicates passed with exact measured pause/restoration pixels':'Carrier/control predicates passed; measured pause or restoration image delta remains in raw evidence';
 }catch(error){report.failurePhase=report.phase;report.error=error.stack??String(error);if(page)try{await page.screenshot({path:path.join(out,'failure.png')});report.lastState=await page.evaluate(()=>window.__kaminosVolumePrototype?.debugState());}catch(e){report.failureCaptureError=String(e);}}
 finally{try{await browser?.close();report.browserClosed=!!browser;}catch(error){report.status='failed';report.cleanupFailure=String(error);}if(report.errors.length){report.status='failed';report.failurePhase??='browser';}try{report.videos=await Promise.all((await fs.readdir(path.join(out,'video'))).map(async name=>{const file=path.join(out,'video',name);return {path:file,bytes:(await fs.stat(file)).size};}));}catch{report.videos=[];}if(report.status==='passed'&&(!report.videos.length||report.videos.some(v=>v.bytes===0))){report.status='failed';report.failurePhase='video';report.error='Native browser video is missing or empty';}await save();}
 return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [origin,out,expectedCommit,repoRoot,recipePath,playwrightModule,ChromeForTesting]=process.argv.slice(2);if(!out)throw Error('Usage: origin out expectedCommit repoRoot recipePath playwrightModule ChromeForTesting');
 const report=await runParticleCarrierWitness({origin,out,expectedCommit,repoRoot,recipePath,playwrightModule,ChromeForTesting});console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,visualExact:report.visualExact,verdict:report.verdict,out}));if(report.status!=='passed')process.exitCode=1;
}
