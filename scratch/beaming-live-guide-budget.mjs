// Narrow extension of the accepted kiln witness: held source, live guide data.
// No emission hierarchy or whole-frame performance claim is made by this assay.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {assertSourceGuideEvidence} from './beaming-surface-evidence.mjs';
const [url,out,iterationsText='32']=process.argv.slice(2),iterations=Number(iterationsText);
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'preflight',requestedUrl:url,iterations,claim:'held-source changing-guide visibility and gather cost only',source:{root:process.cwd(),revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'})},errors:[],httpFailures:[],arms:[]};
const save=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));
const hash=v=>createHash('sha256').update(Buffer.from(new Float32Array(v).buffer)).digest('hex');
await save();let browser;
try{
 assert(Number.isSafeInteger(iterations)&&iterations>0,'positive explicit sample count');
 for(const name of ['beaming-live-guide-budget.mjs','beaming-source-aware-gpu.mjs','beaming-gather-profiler.mjs','beaming-surface-evidence.mjs'])await fs.copyFile(new URL(name,import.meta.url),out+'/'+name);
 report.runtime=await(await fetch(new URL('/api/runtime-config',url))).json();
 assert.equal(report.runtime.source.repoRoot,report.source.root);assert.equal(report.runtime.source.commit,report.source.revision);assert.equal(report.source.dirty,'');assert.equal(report.runtime.source.dirty,false);
 const params=new URLSearchParams(new URL(url).hash.slice(1)),sceneName=params.get('scene');assert(sceneName);
 const sceneResponse=await fetch(new URL('/api/read?root=scenes&path='+encodeURIComponent(sceneName),url));assert(sceneResponse.ok);
 report.scene=await sceneResponse.json();assert.equal(report.scene.label,'bounced-light-bluederbachhkkerrr');assert.equal(report.scene.postprocessing.sceneGI.gain,10);
 assert.equal(new URL(url).searchParams.get('preset'),report.scene.composition.flame.presetId);assert((await fetch(new URL(report.scene.model.source,url))).ok);
 report.executable=process.env.KAMINOS_BROWSER_EXECUTABLE;assert(report.executable?.includes('Chrome for Testing.app'),'independent browser required');await fs.access(report.executable);
 const {chromium}=await import(process.env.KAMINOS_PLAYWRIGHT_MODULE);
 browser=await chromium.launch({headless:true,executablePath:report.executable,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 const page=await browser.newPage({viewport:{width:1600,height:1200}});page.setDefaultTimeout(0);
 let fail;const broken=new Promise((_,reject)=>{fail=reject;});broken.catch(()=>{});
 page.on('pageerror',e=>{report.errors.push(String(e));fail(e);void save();});
 page.on('console',m=>{if(m.type()==='error'&&!m.location().url.endsWith('/favicon.ico')){report.errors.push(m.text());fail(Error(m.text()));void save();}});
 page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('/favicon.ico')){report.httpFailures.push({url:r.url(),status:r.status()});fail(Error('resource failed '+r.url()));void save();}});
 await page.goto(new URL('/api/runtime-config',url).href);
 report.phase='native-changing-guide-oracle';await save();
 report.oracle=await page.evaluate(async()=>{const m=await import('/scratch/beaming-source-aware-gpu.mjs');return m.checkSourceAwareGPU({guided:true,liveGuide:true});});await save();
 assert.equal(report.oracle.status,'passed');assert.equal(report.oracle.outputs.length,5);
 await page.route('**/scene-volume-gather.mjs',async route=>{
   const response=await route.fetch(),original=await response.text(),needle='  const resources=[];',capture='      const state=angularState();\n      const encoder=device.createCommandEncoder';
   assert.equal(original.split(needle).length,2);assert.equal(original.split(capture).length,2);
   const body="import {installGatherProfiler} from './scratch/beaming-gather-profiler.mjs';\n"+original.replace(needle,needle+` installGatherProfiler(device);
     if(!window.__beamingAllocations){window.__beamingAllocations={buffers:[],pipelines:[]};for(const [method,key] of [['createBuffer','buffers'],['createComputePipeline','pipelines']]){const originalMethod=device[method].bind(device);device[method]=spec=>{window.__beamingAllocations[key].push({label:spec.label||'',size:spec.size});return originalMethod(spec);};}}
   `).replace(capture,`      window.__beamingEncodeCount=(window.__beamingEncodeCount||0)+1;
      window.__beamingCurrentGather={api:this,field,options:{gain,stepLength,smokeEnabled,sourceSoftness,surfaceReconstruction,surfaceScattering}};
`+capture);
   await fs.writeFile(out+'/scene-volume-gather.executed.mjs',body);await fs.writeFile(out+'/scene-volume-gather.original.mjs',original);
   await route.fulfill({response,body});
 });
 report.phase='registered-kiln-load';await save();await page.goto(url);
 await Promise.race([page.waitForFunction(()=>window.__kaminosVolumePrototype?.debugState().error||window.__kaminosSceneRadianceSetup?.status==='failed'||window.__kaminosSceneRadiance?.canRender()&&window.__kaminosVolumePrototype.debugState().frameCount>=120,null,{timeout:0}),broken]);
 report.initial=await page.evaluate(()=>({lighting:window.__kaminosSceneRadiance.debugState(),volume:window.__kaminosVolumePrototype.debugState(),gi:window.kaminosSceneGIDebugState()}));await save();
 assert.equal(report.initial.volume.error,null);assert.equal(report.initial.gi.gain,10);assert.equal(report.initial.lighting.frame.angularPattern,'guided');assert.equal(report.initial.lighting.frame.directions,8);
 await page.evaluate(()=>{window.setGizmoMode?.(null);window.__kaminosVolumePrototype.setSimulationPaused(true);window.kaminosWorkspace.setMode('workbench');window.__kaminosSetActiveTab('assets');});
 await page.click('#right-tab-rendering');await page.selectOption('#rendering-light-mode','shared');await page.check('#rendering-match-flame-camera');await page.check('#rendering-surface-scattering');await page.selectOption('#rendering-receiver-spacing','0.16');
 await page.evaluate(gain=>{for(const[id,value]of [['rendering-shared-gain',gain],['rendering-surface-gain',0],['rendering-source-softness',0],['rendering-surface-reconstruction',0]]){const e=document.getElementById(id);e.value=String(value);e.dispatchEvent(new Event('input',{bubbles:true}));}},report.scene.composition.lightGainStops);
 await page.waitForFunction(()=>{const d=window.__kaminosSceneRadiance.debugState();return !d.previewStale&&d.frame?.receiverSampling?.spacing===.16&&d.frame?.sourceSoftness===0&&d.frame?.surfaceReconstruction?.passes===0&&d.frame?.surfaceScattering?.enabled;},null,{timeout:0});
 await page.evaluate(async()=>{window.__kaminosVolumePrototype.setSelectiveHeadLiveCapturePaused(true);await window.__beamingGatherDevice.queue.onSubmittedWorkDone();});
 report.adapter=await page.evaluate(async()=>{const a=await navigator.gpu.requestAdapter();return {vendor:a.info.vendor,architecture:a.info.architecture,isFallbackAdapter:a.info.isFallbackAdapter};});
 const capture=await page.evaluate(async()=>{const fields=await window.__kaminosSceneRadiance.readback(),source=await window.__kaminosVolumePrototype.sampleSceneVolumeSource();return {lighting:window.__kaminosSceneRadiance.debugState(),sourceGeneration:source.generation,sourceMetadata:{...source,values:undefined},primary:source.values,front:Array.from(fields.surface.data),back:Array.from(fields.surfaceBack.data),smoke:Array.from(fields.smoke.data),dimensions:{front:fields.surface.dimensions,back:fields.surfaceBack.dimensions,smoke:fields.smoke.dimensions}};});
 report.baseline={...capture,primary:undefined,front:undefined,back:undefined,smoke:undefined};
 for(const key of ['primary','front','back','smoke'])await fs.writeFile(out+'/baseline-'+key+'.f32',Buffer.from(new Float32Array(capture[key]).buffer));await save();
 assertSourceGuideEvidence({...capture,runtime:report.runtime,source:report.source,adapter:report.adapter,errors:report.errors,httpFailures:report.httpFailures},{pattern:'guided',count:8,gain:2**report.scene.composition.lightGainStops,spacing:.16});
 assert.deepEqual(capture.lighting.frame.angularCache.counts,[8],'no hidden higher capacity');
 assert.equal(capture.lighting.frame.surfaceReceivers,194914,'accepted receiver population');assert.equal(capture.lighting.frame.allocatedVolumeReceivers,8192);
 await page.screenshot({path:out+'/accepted-held-kiln.png'});
 report.phase='sequential-lighting-only-budget';report.samples=[];await save();
 let expectedPreparation=capture.lighting.frame.angularCache.visibilityPreparations;
 const baselineGuide=capture.lighting.frame.sourceGuide;
 for(const name of ['cached','changing','restored']){
   const arm={name,records:[]};report.arms.push(arm);await save();
   for(let i=0;i<iterations;i++){
     const guide=name==='changing'?{lo:[-.7+.04*(i%8),-1,-.7],hi:[.65+.04*(i%8),1.44,.7]}:baselineGuide;
     const changed=name==='changing'||name==='restored'&&i===0;
     const sample=await Promise.race([page.evaluate(async({guide})=>{
       const {api,field,options}=window.__beamingCurrentGather,device=window.__beamingGatherDevice;
       if(!device.features.has('timestamp-query'))throw Error('native timestamp queries unavailable');
       const before={encodes:window.__beamingEncodeCount,pipelines:window.__beamingAllocations.pipelines.length,rayBuffers:window.__beamingAllocations.buffers.filter(b=>b.label==='cached first solid distance per receiver ray').length};
       const profile=window.__beamingGatherProfile={remaining:1,records:[],errors:[]};
       const started=performance.now();api.setSourceGuide(guide);const metadata=api.encode(field,options),encodeMs=performance.now()-started;
       await device.queue.onSubmittedWorkDone();const submitAndCompleteMs=performance.now()-started;
       while(!profile.records.length&&!profile.errors.length)await new Promise(r=>setTimeout(r,1));
       return {guide,metadata,encodeMs,submitAndCompleteMs,profile,before,after:{encodes:window.__beamingEncodeCount,pipelines:window.__beamingAllocations.pipelines.length,rayBuffers:window.__beamingAllocations.buffers.filter(b=>b.label==='cached first solid distance per receiver ray').length}};
     },{guide}),broken]);
     arm.records.push(sample);await save();
     assert.equal(sample.after.encodes,sample.before.encodes+1,'no background lighting interleaving');
     assert.equal(sample.after.pipelines,sample.before.pipelines);assert.equal(sample.after.rayBuffers,sample.before.rayBuffers);
     assert.equal(sample.metadata.directions,8);assert.equal(sample.metadata.angularPattern,'guided');assert.equal(sample.metadata.generation,capture.sourceGeneration);
     if(changed)expectedPreparation++;
     assert.equal(sample.metadata.angularCache.visibilityPreparations,expectedPreparation,'fresh visibility exactly when guide changes');
     assert.equal(sample.profile.records.length,1);assert.deepEqual(sample.profile.errors,[]);assert.equal(sample.profile.records[0].valid,true);
     const passes=sample.profile.records[0].passes;assert.equal(passes.filter(p=>p.label==='static kiln visibility preparation').length,changed?1:0);
   }
 }
 report.phase='restoration-readback';await save();
 const restored=await page.evaluate(async()=>{const {api}=window.__beamingCurrentGather,fields=await api.readback({includeSource:true});return Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,{dimensions:v.dimensions,data:Array.from(v.data)}]));});
 report.restoredHashes={};for(const [key,original] of [['surface','front'],['surfaceBack','back'],['smoke','smoke'],['primarySource','primary']]){const values=restored[key].data;await fs.writeFile(out+'/restored-'+key+'.f32',Buffer.from(new Float32Array(values).buffer));report.restoredHashes[key]=hash(values);assert.equal(hash(values),hash(capture[original]),'restored source/output mismatch '+key);}
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.httpFailures,[]);
 report.status='measured';report.phase='complete';await save();
}catch(e){report.status='failed';report.error=String(e.stack||e);process.exitCode=1;}
finally{await save();await browser?.close();}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));
