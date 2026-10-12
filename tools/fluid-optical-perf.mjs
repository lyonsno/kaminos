// Replays the actual shared-host accumulation/composite passes on one held
// source. No solver replacement, private scene or production quality switch.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {fluidSourceIdentity} from '../fluid-session-browser.mjs';
import {fluidBrowserLaunch} from '../finger-fluid-browser-launch.mjs';
import {bindFluidWorkingSession} from '../fluid-working-session.mjs';
import {observationSession} from '../observation-session.mjs';
import {decodeScreenshotPngRgb} from '../screenshot-png-rgb.mjs';
import {validateOpticalTiming,validateOpticalRuntime,substituteBaseline} from './fluid-optical-perf-validation.mjs';

const {values:a}=parseArgs({options:Object.fromEntries(['out','url','repo','browser','playwright','replacements','samples','step','distance'].map(k=>[k,{type:'string'}]))});
if(!a.out)throw Error('--out is required');
const out=path.resolve(a.out);await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'arguments',argv:process.argv.slice(2),startedAt:new Date().toISOString()};
const reportPath=path.join(out,'report.json');await fs.writeFile(reportPath,'',{flag:'wx'});
const save=()=>fs.writeFile(reportPath,JSON.stringify(report,null,2));await save();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
let browser;
try {
  for(const k of ['url','repo','browser','playwright','replacements'])assert.ok(a[k],`--${k} required`);
  const samples=Number(a.samples??64),step=Number(a.step??284),distance=Number(a.distance??5);
  assert.ok(Number.isSafeInteger(samples)&&samples>0&&Number.isSafeInteger(step)&&step>=0&&distance>0);
  const replacements=JSON.parse(await fs.readFile(a.replacements,'utf8'));
  report.phase='source';await save();
  report.source=await fluidSourceIdentity(a.url,a.repo,{additionalFiles:['local-liquid-transport.mjs']});
  report.harnessSha=sha(await fs.readFile(new URL(import.meta.url)));
  report.replacementsSha=sha(await fs.readFile(a.replacements));
  const {chromium}=await import(pathToFileURL(path.resolve(a.playwright)));
  // Playwright owns the temporary profile; reuse the shared executable
  // admission before launch, including realpath and operator-Chrome rejection.
  const admittedBrowser=fluidBrowserLaunch({executable:a.browser,debugPort:0,userDataDir:out,width:1440,height:900}).executable;
  report.browserExecutable=admittedBrowser;
  report.phase='browser';await save();
  browser=await chromium.launch({executablePath:admittedBrowser,headless:true,timeout:0,args:['--enable-unsafe-webgpu','--use-angle=metal']});
  report.browserVersion=browser.version();
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);
  await page.addInitScript(({replacements})=>{
    const modules=new WeakMap(),pipelines=new WeakMap(),views=new WeakMap(),groups=new WeakMap(),passes=new WeakMap();
    const state=window.__outfoxedOpticalPerf={variant:'candidate',captured:{},errors:[],shaders:null};
    window.addEventListener('error',e=>state.errors.push(e.message));
    window.addEventListener('unhandledrejection',e=>state.errors.push(String(e.reason)));
    const moduleOriginal=GPUDevice.prototype.createShaderModule;
    GPUDevice.prototype.createShaderModule=function(d){
      const module=moduleOriginal.call(this,d);
      if(d.label==='wgsl-fluid-screen-space-surface-v0'){
        let baseline=d.code;
        for(const r of replacements){if(baseline.split(r.candidate).length-1!==1)throw Error('Effective shader replacement mismatch');baseline=baseline.replace(r.candidate,r.baseline);}
        modules.set(module,moduleOriginal.call(this,{label:'outfoxed-verified-baseline',code:baseline}));
        state.shaders={candidate:d.code,baseline};state.device=this;
        this.addEventListener('uncapturederror',e=>state.errors.push(e.error.message));
      }
      return module;
    };
    const pipelineOriginal=GPUDevice.prototype.createRenderPipelineAsync;
    GPUDevice.prototype.createRenderPipelineAsync=async function(d){
      const candidate=await pipelineOriginal.call(this,d);
      if(d.fragment?.entryPoint==='fs_refraction'&&modules.has(d.fragment.module)){
        const baselineModule=modules.get(d.fragment.module);
        const baseline=await pipelineOriginal.call(this,{...d,label:'outfoxed-baseline-composite',vertex:{...d.vertex,module:baselineModule},fragment:{...d.fragment,module:baselineModule}});
        pipelines.set(candidate,baseline);
      }
      return candidate;
    };
    const viewOriginal=GPUTexture.prototype.createView;
    GPUTexture.prototype.createView=function(d){const v=viewOriginal.call(this,d);views.set(v,this);return v;};
    const groupOriginal=GPUDevice.prototype.createBindGroup;
    GPUDevice.prototype.createBindGroup=function(d){const g=groupOriginal.call(this,d);groups.set(g,d.entries);return g;};
    const passOriginal=GPUCommandEncoder.prototype.beginRenderPass;
    GPUCommandEncoder.prototype.beginRenderPass=function(d){const p=passOriginal.call(this,d);passes.set(p,{descriptor:d,groups:[],draws:[]});return p;};
    const setPipeline=GPURenderPassEncoder.prototype.setPipeline;
    GPURenderPassEncoder.prototype.setPipeline=function(p){const c=passes.get(this);if(c)c.pipeline=p;return setPipeline.call(this,state.variant==='baseline'&&pipelines.has(p)?pipelines.get(p):p);};
    const setGroup=GPURenderPassEncoder.prototype.setBindGroup;
    GPURenderPassEncoder.prototype.setBindGroup=function(...args){passes.get(this)?.groups.push(args);return setGroup.apply(this,args);};
    const draw=GPURenderPassEncoder.prototype.draw;
    GPURenderPassEncoder.prototype.draw=function(...args){passes.get(this)?.draws.push(args);return draw.apply(this,args);};
    const end=GPURenderPassEncoder.prototype.end;
    GPURenderPassEncoder.prototype.end=function(){const c=passes.get(this),label=c?.descriptor.label??'';
      if(label.endsWith(':particle-depth-optical-thickness'))state.captured.accumulation=c;
      if(label.endsWith(':two-interface-optical-slab-composite'))state.captured.composite=c;
      return end.call(this);
    };
    state.measure=async(stage,variant,count)=>{
      const captured=state.captured[stage],device=state.device;
      if(!captured||!device.features.has('timestamp-query'))throw Error('Effective pass or timestamp-query unavailable');
      if(captured.groups.length!==1||captured.draws.length!==1)throw Error('Pass replay requires the observed single particle/composite draw; multiple carriers need their original command order');
      if(stage==='composite'&&!pipelines.has(captured.pipeline))throw Error('Effective composite pipeline not bound');
      const q=device.createQuerySet({type:'timestamp',count:2*count});
      const resolved=device.createBuffer({size:16*count,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});
      const readback=device.createBuffer({size:16*count,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      try {
        const encoder=device.createCommandEncoder({label:`outfoxed-${stage}-${variant}`});
        for(let i=0;i<count;i++){
          if(stage==='composite'){
            const entries=groups.get(captured.groups.find(g=>g[0]===0)[1]);
            const scene=views.get(entries.find(e=>e.binding===5).resource),target=views.get(captured.descriptor.colorAttachments[0].view);
            if(!scene||!target)throw Error('Actual host color/target texture identity missing');
            encoder.copyTextureToTexture({texture:scene},{texture:target},{width:target.width,height:target.height,depthOrArrayLayers:1});
          }
          const pass=passOriginal.call(encoder,{...captured.descriptor,timestampWrites:{querySet:q,beginningOfPassWriteIndex:i*2,endOfPassWriteIndex:i*2+1}});
          setPipeline.call(pass,variant==='baseline'&&stage==='composite'?pipelines.get(captured.pipeline):captured.pipeline);
          for(const g of captured.groups)setGroup.apply(pass,g);
          for(const args of captured.draws)draw.apply(pass,args);
          end.call(pass);
        }
        encoder.resolveQuerySet(q,0,2*count,resolved,0);encoder.copyBufferToBuffer(resolved,0,readback,0,16*count);
        device.queue.submit([encoder.finish()]);await readback.mapAsync(GPUMapMode.READ);
        const timestamps=new BigUint64Array(readback.getMappedRange().slice(0));
        return Array.from({length:count},(_,i)=>Number(timestamps[i*2+1]-timestamps[i*2])/1e6);
      } finally {if(readback.mapState==='mapped')readback.unmap();readback.destroy();resolved.destroy();q.destroy();}
    };
  },{replacements});
  report.phase='load';await save();await page.goto(a.url);
  await page.waitForFunction(()=>window.kaminosFingerFluidBenchSessionState?.().available||window.kaminosFingerFluidBenchDebugState?.().status==='error'||window.__outfoxedOpticalPerf.errors.length);
  assert.deepEqual(await page.evaluate(()=>window.__outfoxedOpticalPerf.errors),[]);
  const fluid=await bindFluidWorkingSession(page);const held=await fluid.hold();
  assert.ok(held.clock.step<=step,'Requested held step already passed');if(held.clock.step<step)await fluid.advanceTo(step);
  await fluid.view({...held.camera,distance});
  const state=await fluid.hold();validateOpticalRuntime(state);report.clock=state.clock;report.effectiveConfig=state.bench.config;
  const shaders=await page.evaluate(()=>window.__outfoxedOpticalPerf.shaders);assert.ok(shaders);
  assert.equal(shaders.baseline,substituteBaseline(shaders.candidate,replacements));assert.notEqual(shaders.candidate,shaders.baseline);
  report.shaderHashes=Object.fromEntries(Object.entries(shaders).map(([k,v])=>[k,sha(v)]));
  for(const [k,v] of Object.entries(shaders))await fs.writeFile(path.join(out,`${k}.wgsl`),v,{flag:'wx'});
  report.phase='images';await save();
  await observationSession({out:path.join(out,'observations'),source:report.source,capture:()=>page.screenshot(),exercise:async({retain})=>{
    for(const variant of ['baseline','candidate']){await page.evaluate(v=>window.__outfoxedOpticalPerf.variant=v,variant);await fluid.observe(retain,variant);}
    return {clock:report.clock,shaderHashes:report.shaderHashes};
  }});
  const before=decodeScreenshotPngRgb(await fs.readFile(path.join(out,'observations/baseline.png'))),after=decodeScreenshotPngRgb(await fs.readFile(path.join(out,'observations/candidate.png')));
  assert.equal(before.width,after.width);assert.equal(before.height,after.height);
  const bounds=await page.evaluate(()=>Array.from(document.querySelectorAll('canvas')).map(c=>{const r=c.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}).sort((a,b)=>b.width*b.height-a.width*a.height)[0]);
  let changed=0,sum=0,max=0,total=0;
  for(let y=Math.ceil(bounds.y);y<Math.min(before.height,bounds.y+bounds.height);y++)for(let x=Math.ceil(bounds.x);x<Math.min(before.width,bounds.x+bounds.width);x++){
    let different=false;for(let c=0;c<3;c++){const offset=(y*before.width+x)*before.channels+c,delta=Math.abs(before.pixels[offset]-after.pixels[offset]);sum+=delta;max=Math.max(max,delta);different ||= delta>0;}changed+=Number(different);total++;
  }
  report.imageDifference={bounds,pixels:total,changedPixels:changed,meanAbsoluteChannelDelta:sum/(total*3),maxChannelDelta:max};
  report.phase='timing';report.timings=[];await save();
  for(const stage of ['accumulation','composite']){
    await page.evaluate(async stage=>{await window.__outfoxedOpticalPerf.measure(stage,'baseline',8);await window.__outfoxedOpticalPerf.measure(stage,'candidate',8);},stage);
    for(let round=0;round<4;round++)for(const variant of round%2?['candidate','baseline']:['baseline','candidate']){
      const ms=await page.evaluate(({stage,variant,count})=>window.__outfoxedOpticalPerf.measure(stage,variant,count),{stage,variant,count:samples});
      validateOpticalTiming(ms,samples);report.timings.push({stage,variant,round,ms});await save();
    }
  }
  const final=await fluid.read();validateOpticalRuntime(final);assert.deepEqual(final.clock,report.clock,'Water clock changed during timing');
  report.errors=await page.evaluate(()=>window.__outfoxedOpticalPerf.errors);assert.deepEqual(report.errors,[]);
  assert.deepEqual(await fluidSourceIdentity(a.url,a.repo,{additionalFiles:['local-liquid-transport.mjs']}),report.source,'Source moved during benchmark');
  report.status='passed';report.phase='complete';
} catch(error){report.status='failed';report.failure=String(error.stack||error);process.exitCode=1;}
finally{await browser?.close();report.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({status:report.status,phase:report.phase,out,failure:report.failure}));}
