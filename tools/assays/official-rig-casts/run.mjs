// Finite derived assay, using the production in-page shared application GPU route.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {launchChrome,sourceIdentity} from '../../../models/flux2-klein/cdp-harness.mjs';
import {verifyAuthoringServer} from '../../../scene-authoring-witness-identity.mjs';
import {validateCast} from './receipt.mjs';
import {closeOwnedBrowser} from './cleanup.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const [planPath,mode,castId]=process.argv.slice(2),plan=JSON.parse(await fs.readFile(planPath)),root=path.dirname(planPath);
const cast=mode==='cast'?plan.casts.find(c=>`${c.cell}-seed${c.seed}`===castId):null;
const prepDir=plan.preparedDir??path.join(root,'prepared');
const out=mode==='prep'?prepDir:path.join(root,mode==='probe'?'startup-probe':castId??'invalid');await fs.mkdir(out,{recursive:true});
const report={receiver:plan.receiver,startedAt:new Date().toISOString(),phase:'preflight',ok:false,mode,requested:cast??plan.cells,source:sourceIdentity(plan.repoRoot),runnerSha256:sha(await fs.readFile(new URL(import.meta.url))),cells:[]};
let browser;const write=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');await write();
async function saveArray(expr,file){
 const size=await browser.evaluate(`(${expr}).byteLength`);assert.ok(Number.isInteger(size)&&size>0,`missing ${file}`);
 const handle=await fs.open(path.join(out,file),'w');let offset=0;
 try{while(offset<size){const n=Math.min(2**20,size-offset);const b64=await browser.evaluate(`(()=>{const a=${expr};const b=new Uint8Array(a.buffer??a,(a.byteOffset??0)+${offset},${n});let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return btoa(s)})()`);const bytes=Buffer.from(b64,'base64');assert.equal(bytes.length,n);await handle.write(bytes,0,n,offset);offset+=n;}}finally{await handle.close();}
 const bytes=await fs.readFile(path.join(out,file));return {path:path.join(out,file),bytes:size,sha256:sha(bytes)};
}
try{
 assert.ok(['prep','cast','probe'].includes(mode));assert.equal(report.source.rev,plan.revision,'source revision');
 for(const c of mode==='cast'?[plan.cells.find(c=>c.id===cast?.cell)]:plan.cells){assert.ok(c,'named cell');assert.equal(sha(await fs.readFile(c.sourcePath)),c.sourceSha256,'original image bytes');}
 report.serving=await verifyAuthoringServer({origin:plan.origin,repoRoot:plan.repoRoot});
 report.runtime=await(await fetch(`${plan.origin}/api/runtime-config`)).json();
 assert.equal(report.runtime.trellisPage?.mounted,true);assert.equal(report.runtime.trellisPage?.checkpointRoot??report.runtime.trellisPage?.modelRoot,plan.checkpointRoot,'installed checkpoint root');
 report.phase='browser';await write();
 report.executable=await fs.realpath(plan.chrome);assert.ok(!report.executable.includes('/Google Chrome.app/'));
 browser=await launchChrome(report.executable,['--disable-background-timer-throttling','--disable-renderer-backgrounding'],report);
 await browser.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await browser.navigate(`${plan.origin}/index.html?workspace=authoring`,'!!window.kaminosAppGpu');
 await browser.evaluate(`(async()=>{const {awaitAppGpu}=await import('./tools/assays/official-rig-casts/startup.mjs');window.assayHost=await awaitAppGpu(()=>window.kaminosAppGpu());window.assayPhases=[];window.assayErrors=[];window.assayHost.device.addEventListener('uncapturederror',e=>window.assayErrors.push(e.error.message));window.assayHash=async a=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',a)),x=>x.toString(16).padStart(2,'0')).join('');window.assayPng=async (rgba,w,h)=>{const canvas=new OffscreenCanvas(w,h);canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba),w,h),0,0);return(await canvas.convertToBlob({type:'image/png'})).arrayBuffer()};})()`);
 if(mode==='prep'){
  for(const c of plan.cells){
   report.phase=`prepare:${c.id}`;await write();const bytes=await fs.readFile(c.sourcePath);
   const prepared=await browser.evaluate(`(async()=>{
    const {prepareImageForTrellis}=await import('./authoring-trellis-page.mjs');const {prepareTrellisAlphaRgba}=await import('./models/trellis2/alpha-preparation.js');const {removeForegroundU2Net}=await import('./models/u2net/rembg-u2net.js');const {createU2NetRunner,loadU2NetPackage}=await import('./models/u2net/u2net-webgpu.js');
    const bytes=Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}),x=>x.charCodeAt(0));if(await assayHash(bytes)!==${JSON.stringify(c.sourceSha256)})throw Error('browser source digest mismatch');
    window.assayPrepared=await prepareImageForTrellis({bytes,type:'image/png',prepareTrellisAlphaRgba,runner:()=>window.assayU2net??=(async()=>createU2NetRunner({device:assayHost.device,...await loadU2NetPackage('https://huggingface.co/BasinShapers/u2net-webgpu/resolve/f4f82a54b6e8d7ffd4321005dbff1cb03198c78b/f32/')}))(),removeForegroundU2Net:async options=>{const run=await assayHost.beginRun('u2net-'+crypto.randomUUID(),{routeId:'u2net.foreground-removal'});try{return await removeForegroundU2Net({...options,foreground:run})}finally{await run.finish()}}});
    const p=assayPrepared;if(p.width!==512||p.height!==512||p.pixels.length!==512*512*3)throw Error('incomplete prepared pixels');
    const rgba=new Uint8Array(512*512*4);for(let i=0,j=0;i<p.pixels.length;i+=3,j+=4){rgba.set(p.pixels.subarray(i,i+3),j);rgba[j+3]=255;}window.assayPreview=await assayPng(rgba,512,512);window.assayCutout=p.cutout?await assayPng(p.cutout.rgba,p.cutout.width,p.cutout.height):bytes;
    return {sourceSha256:await assayHash(bytes),preparedSha256:await assayHash(p.pixels),width:p.width,height:p.height,provenance:p.provenance};
   })()`);
   const pixels=await saveArray('window.assayPrepared.pixels',`${c.id}.rgb`);assert.equal(pixels.sha256,prepared.preparedSha256);
   const preview=await saveArray('window.assayPreview',`${c.id}.prepared.png`);const cutout=await saveArray('window.assayCutout',`${c.id}.cutout.png`);
   report.cells.push({id:c.id,...prepared,pixels,preview,cutout});await write();
  }
 }else if(mode==='cast'){
  const c=plan.cells.find(c=>c.id===cast.cell),prep=JSON.parse(await fs.readFile(path.join(prepDir,'report.json'))),p=prep.cells.find(c=>c.id===cast.cell);
  assert.equal(prep.ok,true);assert.equal(p.sourceSha256,c.sourceSha256);const admission=JSON.parse(await fs.readFile(path.join(prepDir,'visual-inspection.json')));assert.equal(admission.cells[cast.cell]?.admitted,true,'prepared image visually admitted');assert.equal(admission.cells[cast.cell]?.sha256,p.preparedSha256);
  const pixels=await fs.readFile(p.pixels.path);assert.equal(sha(pixels),p.preparedSha256);assert.equal(pixels.length,512*512*3);
  report.phase='generation';report.input=p;await write();
  report.result=await browser.evaluate(`(async()=>{
   const [{runTrellisInPage,createTrellisPageCheckpoints},host,inputs,generation,material,mesh,cleanup,uv]=await Promise.all([import('./authoring-trellis-page.mjs'),import('./models/trellis2/shared-host.js'),import('./models/trellis2/generation-inputs.js'),import('./models/trellis2/trellis-generation.js'),import('./models/trellis2/trellis-material.js'),import('./models/trellis2/trellis-mesh.js'),import('./models/trellis2/mesh-cleanup.js'),import('./models/trellis2/wasm-xatlas.js')]);
   const config=await(await fetch('/api/runtime-config')).json(),pack=await createTrellisPageCheckpoints({config:config.trellisPage});const manifest=structuredClone(pack.manifest);manifest.seed=${cast.seed};if(manifest.pipelineType!=='512'||manifest.meshResolution!==512||manifest.samplingSteps!==8)throw Error('unexpected effective preview settings');window.assayManifest=manifest;
   const pixels=Uint8Array.from(atob(${JSON.stringify(pixels.toString('base64'))}),x=>x.charCodeAt(0));if(await assayHash(pixels)!==${JSON.stringify(p.preparedSha256)})throw Error('browser prepared digest mismatch');
   const post=cleanup.createBrowserMeshPostprocess({targetFaces:200000,WorkerClass:Worker});window.assayNoise=[];window.assayPostprocess=null;
   const deps={createTrellisSharedHost:host.createTrellisSharedHost,loadGenerationInputs:inputs.loadGenerationInputs,createTrellisMeshAdapter:mesh.createTrellisMeshAdapter,createTrellisAssetAdapter:material.createTrellisAssetAdapter,createTrellisImageGenerationAdapter:options=>generation.createTrellisImageGenerationAdapter({...options,onNoiseInput:async n=>{assayNoise.push({stage:n.stage,seed:n.seed,source:n.source,shape:n.shape,sha256:await assayHash(n.values)})}})};
   const startFrames=window.kaminosAppFrameSource().completedFrames;window.assayStarted=performance.now();
   try{window.assayResult=await runTrellisInPage({appGpu:assayHost,manifest,fetchTensor:pack.fetchTensor,pixelValues:inputs.normalizePreparedTrellisRgb({pixels,width:512,height:512}),decoderActivationStorage:'f16',deps,finishing:{postprocessMesh:async raw=>{window.assayRaw={vertices:raw.vertices.slice(),triangles:raw.triangles.slice()};const result=await post(raw);window.assayPostprocess=result.metadata.postprocess;return result},unwrapMesh:uv.createWasmXatlasUnwrapper({WorkerClass:Worker})},onPhase:e=>assayPhases.push({...e,atMs:performance.now()}),provenance:{sourceSha256:${JSON.stringify(c.sourceSha256)},preparedSha256:${JSON.stringify(p.preparedSha256)},seed:${cast.seed},checkpointManifestSha256:pack.manifestSha256}});}catch(e){window.assayFailure=e.trellisCapture;window.assayRetainedSurfels=e.trellisSurfels;throw e;}
   const r=assayResult;return {sourceSha256:${JSON.stringify(c.sourceSha256)},preparedSha256:await assayHash(pixels),seed:manifest.seed,pipelineType:manifest.pipelineType,samplingSteps:manifest.samplingSteps,meshResolution:manifest.meshResolution,decoderActivationStorage:'f16',route:r.route,appHost:true,receiptValidation:r.receiptValidation,checkpointManifestSha256:pack.manifestSha256,effectiveManifest:manifest,postprocess:assayPostprocess,raw:{vertices:assayRaw.vertices.length/3,triangles:assayRaw.triangles.length/3},noise:assayNoise,noiseSeeds:assayNoise.map(n=>n.seed),output:{bytes:r.glb.byteLength,glbMagic:new DataView(r.glb).getUint32(0,true)},frames:{before:startFrames,after:window.kaminosAppFrameSource().completedFrames},wallMs:performance.now()-assayStarted,timing:r.timing,uv:r.uv,material:r.material,surfels:r.surfels};
  })()`);
  report.phase='persist';await write();
  report.glb=await saveArray('window.assayResult.glb','creature.glb');
  report.rawVertices=await saveArray('window.assayRaw.vertices','raw-vertices.f32');report.rawTriangles=await saveArray('window.assayRaw.triangles','raw-triangles.u32');
  if(await browser.evaluate('!!window.assayResult.surfelGlb'))report.surfels=await saveArray('window.assayResult.surfelGlb','surfels.glb');
  if(await browser.evaluate('!!window.assayResult.levelInputs')){for(const name of ['coordinates','features'])await saveArray(`window.assayResult.levelInputs.materialFields.${name}`,`material-${name}.bin`);report.materialResolution=await browser.evaluate('window.assayResult.levelInputs.materialFields.resolution');}
  validateCast(report.result,{...c,preparedSha256:p.preparedSha256,seed:cast.seed});
 }
 if(mode==='probe')report.host=await browser.evaluate('({deviceAvailable:!!assayHost.device,frameOwnerAvailable:!!assayHost.frameOwner(),features:Array.from(assayHost.device.features),frames:window.kaminosAppFrameSource()})');
 report.ok=true;report.phase='done';
}catch(e){report.failurePhase=report.phase;report.error=String(e.stack??e);process.exitCode=1;}
finally{
 if(browser){try{
  if(!report.ok&&await browser.evaluate('!!window.assayRaw')){report.retainedRawVertices=await saveArray('window.assayRaw.vertices','failure-raw-vertices.f32');report.retainedRawTriangles=await saveArray('window.assayRaw.triangles','failure-raw-triangles.u32');}
  if(!report.ok&&await browser.evaluate('!!window.assayRetainedSurfels?.surfelGlb'))report.retainedSurfels=await saveArray('window.assayRetainedSurfels.surfelGlb','failure-surfels.glb');
  report.phases=await browser.evaluate('window.assayPhases??[]');report.gpuErrors=await browser.evaluate('window.assayErrors??[]');
  if(await browser.evaluate('!!window.assayFailure')){const capture=await browser.evaluate(`(()=>{const c=assayFailure;return {...c,tensors:Object.fromEntries(Object.entries(c.tensors??{}).map(([k,v])=>[k,{...v,bytes:undefined}])),noise:Object.fromEntries(Object.entries(c.noise??{}).map(([k,v])=>[k,{...v,values:undefined}]))}})()`);for(const [k,v] of Object.entries(capture.tensors??{}))v.file=await saveArray(`window.assayFailure.tensors[${JSON.stringify(k)}].bytes`,`failure-${k}.bin`);for(const [k,v] of Object.entries(capture.noise??{}))v.file=await saveArray(`window.assayFailure.noise[${JSON.stringify(k)}].values`,`failure-noise-${k}.bin`);report.failureCapture=capture;}
 }catch(e){report.captureError=String(e);}
 try{await closeOwnedBrowser(browser,report);}catch(e){report.cleanupError=String(e);report.ok=false;process.exitCode=1;}
 }else if(report.ownedBrowserPid&&!report.browserExit){process.kill(report.ownedBrowserPid,'SIGTERM');report.startupCleanup=report.ownedBrowserPid;}
 report.finishedAt=new Date().toISOString();await write();if(!report.ok)await fs.writeFile(path.join(out,'failure.json'),JSON.stringify(report,null,2)+'\n');
}

// All artifacts are awaited and the exact browser has exited. Do not retain the
// generic CDP launcher's startup deadline timer in this finite CLI process.
process.exit(report.ok?0:1);
