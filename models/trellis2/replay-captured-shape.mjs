// Offline diagnostic: replay one saved shape latent, preserve complete raw
// decoder fields and an extracted mesh. No image/flow model, cleanup or material.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {admitCapturedShape} from './captured-shape-replay-checks.mjs';
const {values:v}=parseArgs({options:Object.fromEntries(['repo-root','capture','checkpoints','output-dir','browser','puppeteer','expected-commit'].map(k=>[k,{type:'string'}]))});
if(!v['output-dir'])throw Error('explicit --output-dir required');
const out=path.resolve(v['output-dir']),hash=b=>createHash('sha256').update(b).digest('hex');
const report={schema:'trellis2.captured-shape-replay.v0',status:'failed',phase:'admission',requested:{...v},outputs:{},phases:[],
  claim:'saved grass-r3 latent replay, not recovery of f306 mesh, material, GLB, or MLX parity'};
const persist=async()=>{await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');};
let browser,server;
try{
  await persist();for(const key of ['repo-root','capture','checkpoints','browser','puppeteer','expected-commit'])assert.ok(v[key],'explicit --'+key+' required');
  const root=await fs.realpath(v['repo-root']),capture=await fs.realpath(v.capture),checkpoints=await fs.realpath(v.checkpoints);
  report.source={repoRoot:root,commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    dirty:!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim()};
  assert.equal(report.source.commit,v['expected-commit'],'effective source revision mismatch');assert.equal(report.source.dirty,false,'clean replay source required');
  const meta=JSON.parse(await fs.readFile(path.join(capture,'capture.json'),'utf8'));
  const manifestBytes=await fs.readFile(path.join(checkpoints,'manifest.json'));
  report.capture=await admitCapturedShape(meta,name=>fs.readFile(path.join(capture,name+'.bin')),manifestBytes);
  report.probeSha256=hash(await fs.readFile(new URL(import.meta.url)));
  server=http.createServer(async(req,res)=>{try{
    const name=new URL(req.url,'http://localhost').pathname;
    if(name==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Saved shape decoder replay</title>');return;}
    const [base,relative]=name.startsWith('/capture/')?[capture,name.slice(9)]:name.startsWith('/checkpoint/')?[checkpoints,name.slice(12)]:[root,name.slice(1)];
    const file=path.resolve(base,relative);if(!file.startsWith(base+path.sep))throw Error('path outside source root');
    res.setHeader('Content-Type',/\.(mjs|js)$/.test(file)?'text/javascript':'application/octet-stream');res.end(await fs.readFile(file));
  }catch(error){res.statusCode=404;res.end(error.message);}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  report.browserExecutable=await fs.realpath(v.browser);report.browserProfile=await fs.mkdtemp(path.join(out,'browser-profile-'));
  const {default:puppeteer}=await import(v.puppeteer);
  browser=await puppeteer.launch({executablePath:report.browserExecutable,headless:true,protocolTimeout:0,timeout:0,
    args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic','--user-data-dir='+report.browserProfile,'--no-first-run','--no-default-browser-check']});
  report.browserVersion=await browser.version();report.browserPid=browser.process().pid;
  const page=await browser.newPage();
  await page.exposeFunction('__phase',async phase=>{report.phase=phase;report.phases.push({phase,at:Date.now()});await persist();});
  await page.exposeFunction('__save',async(name,encoded,offset,total)=>{
    if(!['geometry.features','geometry.coordinates','mesh.vertices','mesh.triangles'].includes(name))throw Error('unknown replay output');
    const file=path.join(out,name+'.bin'),previous=report.outputs[name];
    if(offset!==(previous?.writtenBytes??0)||previous?.complete)throw Error('noncontiguous replay output');
    const bytes=Buffer.from(encoded,'base64');if(offset+bytes.length>total)throw Error('replay output overflow');
    if(offset===0)await fs.writeFile(file,bytes);else await fs.appendFile(file,bytes);
    report.outputs[name]={path:file,byteLength:total,writtenBytes:offset+bytes.length,complete:offset+bytes.length===total};
    if(report.outputs[name].complete)report.outputs[name].sha256=hash(await fs.readFile(file));
    await persist();return true;
  });
  await page.goto('http://127.0.0.1:'+server.address().port,{timeout:0});
  report.native=await page.evaluate(async({meta,manifestSha256})=>{
    const hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
    const {createWebGpuInferenceSession,WEBGPU_BUFFER_USAGE:U}=await import('/webgpu-inference-kit/src/core.js');
    const {createTrellisSLatDecoderAdapterAsync}=await import('/models/trellis2/slat-decoder.js');
    const {readGenerationTensor}=await import('/models/trellis2/generation-storage.js');
    const {extractTrellisDualGridMesh}=await import('/models/trellis2/trellis-mesh.js');
    const {validateNativePrefixBackend}=await import('/models/trellis2/sparse-prefix-witness-checks.js');
    const manifestRaw=await(await fetch('/checkpoint/manifest.json')).arrayBuffer();
    if(await hash(manifestRaw)!==manifestSha256)throw Error('checkpoint manifest changed after admission');
    const manifest=JSON.parse(new TextDecoder().decode(manifestRaw));
    const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('native WebGPU adapter required');
    const backend={vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description,
      isFallbackAdapter:adapter.info.isFallbackAdapter??adapter.isFallbackAdapter};validateNativePrefixBackend(backend);
    for(const feature of ['shader-f16','timestamp-query'])if(!adapter.features.has(feature))throw Error('native feature required: '+feature);
    const device=await adapter.requestDevice({requiredFeatures:['shader-f16','timestamp-query'],requiredLimits:{maxBufferSize:adapter.limits.maxBufferSize,maxStorageBufferBindingSize:adapter.limits.maxStorageBufferBindingSize}});
    const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));device.pushErrorScope('validation');
    const session=await createWebGpuInferenceSession({sessionId:'grass-saved-shape-'+crypto.randomUUID(),device,queue:device.queue,adapter,
      adapterName:backend.description||backend.device||backend.vendor,deviceOwnership:'borrowed'});
    let decoder;const inputs=[];
    const save=async(name,raw)=>{const u=new Uint8Array(raw);for(let offset=0;offset<u.length;offset+=1<<20){
      const part=u.subarray(offset,offset+(1<<20));let s='';for(let i=0;i<part.length;i+=32768)s+=String.fromCharCode(...part.subarray(i,i+32768));
      await window.__save(name,btoa(s),offset,u.length);}};
    try{
      const route=await session.registerRoute({routeId:'trellis2.saved-shape-mesh-replay',runtimeOptions:{requiredStages:meta.decoder.plan.stages}}),runtime=route.runtime;
      const readParameter=key=>readGenerationTensor(manifest.tensors[key],{fetchFile:file=>fetch('/checkpoint/'+file),hash});
      const upload=async name=>{const spec=meta.files.find(f=>f.name===name),bytes=await(await fetch('/capture/'+name+'.bin')).arrayBuffer();
        if(bytes.byteLength!==spec.byteLength||await hash(bytes)!==spec.sha256)throw Error('captured input changed: '+name);
        const t=runtime.createTensor({name,shape:spec.shape,dtype:spec.dtype,usage:U.storage|U.copySrc|U.copyDst});runtime.uploadTensor(t,bytes);inputs.push(t);return t;};
      await window.__phase('decoder-parameter-loading');
      decoder=await createTrellisSLatDecoderAdapterAsync({route,config:meta.decoder.plan,
        sampleTensor:await upload('tensor.inputs.sample'),coordinateTensor:await upload('tensor.inputs.coordinates'),
        siluTable:await readParameter(manifest.models.shapeDecoder.siluTable),loadWeight:name=>readParameter(manifest.models.shapeDecoder.tensors[name])});
      await window.__phase('learned-geometry-decoding');
      const terminal=await route.enqueue({jobId:'saved-shape-complete',execute:i=>decoder.run(i)}).completion;
      if(terminal.status!=='succeeded')throw Error(terminal.failure?.message??'saved decoder failed');
      await window.__phase('raw-geometry-retention');const decoded=terminal.output;
      const features=await runtime.readTensor(decoded.features),coordinates=await runtime.readTensor(decoded.coordinates);
      await save('geometry.features',features);await save('geometry.coordinates',coordinates);
      await window.__phase('mesh-extraction');
      const mesh=extractTrellisDualGridMesh({features:new Float32Array(features),coordinates:new Int32Array(coordinates),resolution:decoded.resolution});
      if(mesh.status!=='surface'||!mesh.triangles.length)throw Error('replayed geometry has no surface');
      await save('mesh.vertices',mesh.vertices.buffer);await save('mesh.triangles',mesh.triangles.buffer);
      const validation=await device.popErrorScope();if(validation||errors.length)throw Error('native GPU errors: '+JSON.stringify({validation:validation?.message,errors}));
      return {backend,effectiveFeatures:[...device.features],routeId:route.routeId,activationStorage:decoded.activationStorage,resolution:decoded.resolution,
        geometryRows:decoded.features.shape[0],vertices:mesh.vertices.length/3,faces:mesh.triangles.length/3,levels:decoded.levels,meshMetadata:mesh.metadata,errors};
    }finally{await device.queue.onSubmittedWorkDone();decoder?.dispose();for(const t of inputs)runtimeSafeDispose(t);await session.drain();session.close();device.destroy();}
    function runtimeSafeDispose(t){t?.buffer?.destroy();}
  },{meta,manifestSha256:report.capture.manifestSha256});
  for(const name of ['geometry.features','geometry.coordinates','mesh.vertices','mesh.triangles'])assert.equal(report.outputs[name]?.complete,true,'complete output required: '+name);
  report.phase='done';report.status='succeeded';
}catch(error){report.error={name:error.name,message:error.message,stack:error.stack};process.exitCode=1;}
finally{if(browser){await browser.close();report.ownedBrowserClosed=true;}if(server)await new Promise(resolve=>server.close(resolve));await persist();}
console.log(JSON.stringify({status:report.status,phase:report.phase,faces:report.native?.faces,error:report.error?.message,report:path.join(out,'report.json')}));
