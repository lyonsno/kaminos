import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {restrictOptical,reconstructOpticalFrame,validateOpticalFrame} from '../volume-temporal-material.mjs';
import {opticalRgbToXyz} from '../volume-optical-color.mjs';

const args=Object.fromEntries(process.argv.slice(2).map((value,i,all)=>value.startsWith('--')?[value.slice(2),all[i+1]]:null).filter(Boolean));
for(const key of ['out','preset','browser','playwright','port'])if(!args[key])throw Error('--'+key+' is required');
const out=path.resolve(args.out),repo=path.resolve(import.meta.dirname,'..');
const warmup=Number(args.warmup??128),count=Number(args.frames??24),stride=Number(args.stride??2),width=Number(args.coarse??16),iterations=Number(args.iterations??8),radius=Number(args.radius??2);
for(const [name,value]of Object.entries({warmup,count,stride,width,iterations,radius}))if(!Number.isSafeInteger(value)||value<(name==='radius'?0:1))throw Error('Positive integer '+name+' required');
await fs.mkdir(out,{recursive:true});
const report={schema:'kaminos.fleshweaver-capture.v1',status:'running',phase:'start',started:new Date().toISOString(),repo,out,command:process.argv,receiver:'future-filament-fleshweaver',source:{commit:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim()},config:{warmup,count,stride,width,iterations,radius},browser:path.resolve(args.browser)};
const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await save();
let server,context;
const hash=data=>createHash('sha256').update(data).digest('hex');
const writeField=async(name,array)=>{const bytes=Buffer.from(array.buffer,array.byteOffset,array.byteLength);await fs.writeFile(path.join(out,name),bytes);return {path:name,bytes:bytes.length,sha256:hash(bytes)};};
try{
 report.source.files={};for(const name of ['volume-core.js','volume-temporal-material.mjs','volume-optical-color.mjs','volume-optical-sequence.mjs','volume-optical-preview.mjs','tools/fleshweaver-capture.mjs'])report.source.files[name]=hash(await fs.readFile(path.join(repo,name)));
 const presetBytes=await fs.readFile(args.preset),preset=JSON.parse(presetBytes);report.source.presetId=preset.presetId??preset.id??path.basename(args.preset,'.json');report.source.presetHash=hash(presetBytes);await fs.writeFile(path.join(out,'source-preset.json'),presetBytes);
 report.phase='server';await save();
 const log=await fs.open(path.join(out,'server.log'),'a');server=spawn('python3',['serve.py',args.port],{cwd:repo,stdio:['ignore',log.fd,log.fd]});await log.close();
 const base='http://127.0.0.1:'+args.port;
 for(;;){if(server.exitCode!==null)throw Error('Owned server exited before admission');try{const r=await fetch(base+'/api/runtime-config');if(r.ok){report.runtime=await r.json();break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
 assert.equal(report.runtime.source.repoRoot,repo,'Capture must serve its owning worktree');
 const {chromium}=await import(path.resolve(args.playwright));context=await chromium.launchPersistentContext(path.join(out,'browser-profile'),{executablePath:report.browser,headless:true,viewport:{width:640,height:480},args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 const page=context.pages()[0],consoleErrors=[];report.consoleErrors=consoleErrors;page.on('pageerror',error=>consoleErrors.push(String(error)));
 await page.goto(base+'/api/runtime-config');
 report.phase='native-optical-shader';await save();
 report.nativeShader=await page.evaluate(async()=>{
  const {OPTICAL_SAMPLE_WGSL,OPTICAL_PREVIEW_WGSL}=await import('/volume-optical-preview.mjs');
  const adapter=await navigator.gpu.requestAdapter();if(!adapter||adapter.isFallbackAdapter)throw Error('Native GPU required');
  const info={vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description};if(!/apple/i.test(JSON.stringify(info))||/swiftshader/i.test(JSON.stringify(info)))throw Error('Apple native route required');
  const device=await adapter.requestDevice();device.pushErrorScope('validation');
  const shader=device.createShaderModule({code:OPTICAL_SAMPLE_WGSL+OPTICAL_PREVIEW_WGSL+`
   @group(0) @binding(0) var field:texture_3d<f32>;
   @group(0) @binding(1) var<storage,read_write> output:array<vec4<f32>>;
   @compute @workgroup_size(1) fn main(){output[0]=opticalPreview(field,vec3<f32>(0,0,2),vec3<f32>(0,0,-1),vec3<f32>(2),1.0,0.0,40.0);output[1]=opticalPreview(field,vec3<f32>(0,0,2),vec3<f32>(0,0,-1),vec3<f32>(2),1.0,1.0,40.0);}`});
  const compilation=await shader.getCompilationInfo();if(compilation.messages.some(m=>m.type==='error'))throw Error(compilation.messages.map(m=>m.message).join('\n'));
  const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:shader,entryPoint:'main'}}),texture=device.createTexture({dimension:'3d',size:[2,2,2],format:'rgba32float',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING});
  const data=new Float32Array(32);for(let i=0;i<8;i++)data.set([1,.5,.25,.4],i*4);device.queue.writeTexture({texture},data,{bytesPerRow:32,rowsPerImage:2},[2,2,2]);
  const output=device.createBuffer({size:32,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),read=device.createBuffer({size:32,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
  const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:texture.createView()},{binding:1,resource:{buffer:output}}]}),encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1);pass.end();encoder.copyBufferToBuffer(output,0,read,0,32);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);const values=Array.from(new Float32Array(read.getMappedRange()));read.unmap();const error=await device.popErrorScope();read.destroy();output.destroy();texture.destroy();device.destroy();if(error)throw Error(error.message);return {info,values};
 });
 const alpha=1-Math.exp(-.8),{opticalXyzToRgb}=await import('../volume-optical-color.mjs'),expected=opticalXyzToRgb(new Float32Array([alpha/.4,alpha/.8,alpha/1.6,alpha,2,1,.5,0]));report.nativeShader.values.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<2e-5,'Production optical shader analytic transfer '+i));
 report.phase='source-load';await save();
 await page.goto(base+'/index.html?workspace=workbench&experiment=flame');
 await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state()?.id==='flame');
 report.flame=await page.evaluate(id=>window.kaminosWorkbenchExperiments.invoke('applyBasin',id),report.source.presetId);
 await page.waitForFunction(()=>window.__kaminosVolumePrototype?.debugState().active);
 report.phase='recording';await save();
 report.replay=await page.evaluate(async warmup=>{const p=window.__kaminosVolumePrototype;p.setSelectiveHeadLiveCapturePaused(true);p.setSceneVolumeSourceEnabled(true);return p.sampleDeterministicReplayFrame({steps:warmup,restoreControls:true});},warmup);
 assert.equal(report.replay.ok,true);assert.equal(report.replay.backend,'WebGPU:apple');
 const frames=[],rows=[];
 for(let i=0;i<count;i++){
  const raw=await page.evaluate(async({stride,now})=>{
   const p=window.__kaminosVolumePrototype;
   for(let k=0;k<stride;k++){const r=await p.sampleFrame({advanceSim:true,includeRgba:false,now:now+k*1000/60});if(!r.ok)throw Error('Held simulation sample failed: '+JSON.stringify({reason:r.reason,validation:r.validationError}));}
   const {captureOpticalSequenceFrame}=await import('/volume-optical-sequence.mjs');const f=await captureOpticalSequenceFrame(p,p.foregroundGpuContext().device);
   return {...f,optical:Array.from(f.optical),velocity:Array.from(f.velocity)};
  },{stride,now:1000+(warmup+i*stride)*1000/60});
  const rawOptical=Float32Array.from(raw.optical),rawEntry=await writeField(`source-rgb-${i}.f32`,rawOptical);
  const f={...raw,optical:opticalRgbToXyz(rawOptical),velocity:Float32Array.from(raw.velocity)};
  rows.push({step:f.time,identity:f.identity,sourceRgb:rawEntry,optical:await writeField(`native-${i}.f32`,f.optical),velocity:await writeField(`velocity-${i}.f32`,f.velocity)});
  await fs.writeFile(path.join(out,'recording.json'),JSON.stringify({status:'recording',source:report.source,dimensions:f.dimensions,bounds:f.bounds,frames:rows},null,2));
  report.lastField={dimensions:f.dimensions,opticalLength:f.optical.length,expectedOpticalLength:f.dimensions.reduce((a,x)=>a*x,4),nonfinite:f.optical.reduce((n,x)=>n+(!Number.isFinite(x)?1:0),0),negative:f.optical.reduce((n,x)=>n+(x<0?1:0),0),minimum:f.optical.reduce((n,x)=>Math.min(n,x),Infinity),maximum:f.optical.reduce((n,x)=>Math.max(n,x),-Infinity)};await save();validateOpticalFrame(f);frames.push(f);
  report.recorded=rows.length;await save();
 }
 await page.screenshot({path:path.join(out,'source.png')});report.consoleErrors=consoleErrors;
 await context.close();context=null;server.kill('SIGTERM');server=null;
 assert.ok(frames.some(f=>f.optical.some((v,i)=>i%4!==3&&v>0)),'Recorded source must contain actual emission');
 report.phase='reconstruction';await save();
 const d=frames[0].dimensions,coarseDimensions=d.map(n=>n*width/d[0]);assert.ok(coarseDimensions.every(Number.isSafeInteger),'Coarse width must divide all native dimensions');
 const coarse=frames.map(f=>restrictOptical(f,coarseDimensions));
 for(let i=0;i<count;i++){rows[i].coarseOptical=await writeField(`coarse-${i}.f32`,coarse[i].optical);rows[i].coarseVelocity=await writeField(`coarse-velocity-${i}.f32`,coarse[i].velocity);}
 const reconstructions={},errors={};
 for(const mode of ['single','forward','future']){
  let previous=null;reconstructions[mode]=[];errors[mode]=[];
  for(let i=0;i<count;i++){
   const reconstructed=reconstructOpticalFrame(coarse,i,{dimensions:d,mode,radius,iterations,previous});previous=reconstructed;
   const reduced=restrictOptical(reconstructed,coarseDimensions);let maxRelative=0;
   for(let k=0;k<reduced.optical.length;k++)maxRelative=Math.max(maxRelative,Math.abs(reduced.optical[k]-coarse[i].optical[k])/Math.max(1,coarse[i].optical[k]));assert.ok(maxRelative<2e-6,'Current optical block means changed');
   const mse=reconstructed.optical.reduce((s,v,k)=>s+(v-frames[i].optical[k])**2,0)/reconstructed.optical.length;
   errors[mode].push(mse);reconstructions[mode].push({...await writeField(`${mode}-${i}.f32`,reconstructed.optical),step:frames[i].time,reconstruction:reconstructed.reconstruction,mse,maxCoarseRelativeError:maxRelative});
   report.reconstructing={mode,frame:i+1};await save();
  }
 }
 const manifest={schema:'kaminos.optical-sequence.v1',status:'captured',basis:'cie-xyz-d65',source:{...report.source,backend:report.replay.backend,simulation:report.replay},dimensions:d,bounds:frames[0].bounds,coarseDimensions,reconstructionDimensions:d,playbackFps:60/stride,frames:rows,reconstructions,reconstruction:{label:`Coarsened ${coarseDimensions.join('×')} → ${d.join('×')}; recorded base flow`,radius,iterations,relaxation:.3,model:'transport plus global per-channel power normalization; current positive XYZ/extinction block means fixed',limits:'Recorded optical-source reconstruction, not coarse-solver recovery. Base velocity excludes procedural wavelet perturbations. No scattering fit or live lookahead integration.'}};
 await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));report.errors=Object.fromEntries(Object.entries(errors).map(([mode,values])=>[mode,{perFrameMse:values,meanMse:values.reduce((a,b)=>a+b,0)/values.length}]));
 report.executionChecks='passed';report.reconstructionBenefit={futureVsSingle:report.errors.future.meanMse/report.errors.single.meanMse,futureVsPastOnly:report.errors.future.meanMse/report.errors.forward.meanMse,verdict:report.errors.future.meanMse<report.errors.single.meanMse?'lower-reference-field-error':'higher-reference-field-error',visualJudgement:'pending-inspection'};
 report.status='completed';report.phase='complete';report.manifest=path.join(out,'manifest.json');
}catch(error){report.status='failed';report.error=String(error.stack??error);if(context){try{const page=context.pages()[0];report.lastPage={url:page.url(),text:await page.locator('body').innerText()};await page.screenshot({path:path.join(out,'failure.png')});}catch{}}process.exitCode=1;}
finally{
 await context?.close();server?.kill('SIGTERM');report.finished=new Date().toISOString();await save();
}
console.log(JSON.stringify({status:report.status,phase:report.phase,report:path.join(out,'report.json'),error:report.error}));
