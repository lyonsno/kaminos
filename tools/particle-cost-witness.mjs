import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
export async function runParticleCosts({configPath,out}){
 await fs.mkdir(out,{recursive:true});const report={status:'failed',phase:'admission',claim:'Recorded-source native particle-pass GPU cost only; excludes fresh ray/lighting/simulation and is not whole-frame FPS',arms:[]};const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v,2));await save();
 try{
  const config=JSON.parse(await fs.readFile(configPath,'utf8'));report.config=config;
  for(const source of [config.baseline,config.candidate]){const head=execFileSync('git',['-C',source.root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();const dirty=execFileSync('git',['-C',source.root,'status','--porcelain'],{encoding:'utf8'}).trim();if(head!==source.commit||dirty)throw Error('Wrong or dirty cost source: '+source.root);}
  const raw=await fs.readFile(config.records.path);if(createHash('sha256').update(raw).digest('hex')!==config.records.sha256)throw Error('Recorded input hash mismatch');
  const recorded=new Float32Array(raw.buffer,raw.byteOffset,raw.length/4);if(recorded.length!==config.records.width*config.records.height*24)throw Error('Recorded population shape mismatch');
  const native=JSON.parse(await fs.readFile(config.records.report,'utf8'));if(native.status!=='passed'||native.runtime.source.commit!==config.baseline.commit)throw Error('Recorded native source was not the admitted baseline');
  const {withKaminosGpu}=await import(pathToFileURL(path.join(config.candidate.root,'tools/shader-herder.mjs')));
  const THREE=await import(pathToFileURL(path.join(config.candidate.root,'lib/three.core.js')));
  const signature=native.arms[0].state.cameraSignature.split('|');const position=new THREE.Vector3(...signature.slice(0,3).map(Number)),quaternion=new THREE.Quaternion(...signature.slice(3,7).map(Number));const world=new THREE.Matrix4().compose(position,quaternion,new THREE.Vector3(1,1,1));const vp=new THREE.Matrix4().fromArray(signature[7].split(',').map(Number)).multiply(world.invert());
  report.phase='hardware';await save();
  await withKaminosGpu(async ctx=>{const d=ctx.device;report.device=ctx.adapterInfo;report.features=[...d.features];
   for(const [width,height] of [[268,429],[1013,926]]){
    const pixels=width*height,worldCells=12*18*12,birthRows=new Float32Array(pixels*16+worldCells*4);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const src=24*(Math.floor(y*config.records.height/height)*config.records.width+Math.floor(x*config.records.width/width)),dst=16*(x+y*width);birthRows.set(recorded.subarray(src+4,src+8),dst);birthRows.set(recorded.subarray(src,src+4),dst+4);const length=recorded[src+19],pitch=recorded[src+16];birthRows.set([-length/2,length/2,length,pitch],dst+8);birthRows.set(recorded.subarray(src+8,src+11),dst+12);}
    const births=d.createBuffer({size:birthRows.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});d.queue.writeBuffer(births,0,birthRows);
    const uniform=d.createBuffer({size:240,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),sf=new Float32Array(60);sf.set(vp.elements);sf.set([0,2,.2,1],28);sf.set([-5,-5,-5,10/12],32);sf.set([12,18,12,1],36);sf.set([0,0,0,1],40);new Uint32Array(sf.buffer).set([0,0,pixels*4,0],56);d.queue.writeBuffer(uniform,0,sf);
    const fine=d.createBuffer({size:10*15*10*64,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
    const depth=d.createTexture({size:[1,1],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});const output=d.createTexture({size:[width,height],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    try{
     for(const [source,spacing,radius] of [[config.baseline,1,.1],[config.candidate,1,.1],[config.candidate,2,.1],[config.candidate,4,.1],[config.candidate,1,.03]]){
      const {createOpticalParticles}=await import(pathToFileURL(path.join(source.root,'volume-optical-particles.mjs')));const owner=createOpticalParticles(d);
      const frame={buffer:births,uniform,width,height,pixels,step:0,backtrace:.1,reactionStepScale:1,viewProj:vp.elements};
      const camera=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,1,1,0,0,0,1,0]);const settings={enabled:true,spacing,radius,stretch:.2,gain:1.68,opacity:.3,burnTime:2,cooling:23,heatRelease:.6,sootYield:.15,smokeLife:242,flow:.2,rise:0,drag:8,expansion:.3,refresh:.51};
      const encode=e=>{const pass=e.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:depth.createView(),depthLoadOp:'clear',depthClearValue:1,depthStoreOp:'store'}});pass.end();return owner.encode(e,{view:output.createView(),format:'rgba8unorm',source:frame,fine,dims:[10,15,10],invViewProj:vp.clone().invert().elements,settings,cameraValues:camera,depth,identity:'recorded-source-cost',depthZeroToOne:true});};
      const arm={source,width,height,spacing,radius,settings,samples:[]};report.arms.push(arm);report.phase='profile';await save();
      try{const warm=d.createCommandEncoder();encode(warm);d.queue.submit([warm.finish()]);await d.queue.onSubmittedWorkDone();for(let sample=0;sample<3;sample++){frame.step++;const timed=await ctx.profileCommandSubmission(encode);arm.samples.push(timed);await save();}arm.effective=owner.read();
       const labels=[...new Set(arm.samples.flatMap(s=>s.passes.map(p=>p.label)))];arm.medianPassMs=Object.fromEntries(labels.map(label=>{const v=arm.samples.map(s=>s.passes.find(p=>p.label===label).durationMs).sort((a,b)=>a-b);return [label,v[1]];}));
      }finally{owner.dispose();await d.queue.onSubmittedWorkDone();}await save();
     }
    }finally{for(const x of [births,uniform,fine,depth,output])x.destroy();}
   }
  },{onEvidence:e=>{report.hardwareEvidence=e;}});report.status='passed';report.phase='complete';
 }catch(e){report.failurePhase=report.phase;report.error=e.stack??String(e);}finally{await save();}return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname)){const [configPath,out]=process.argv.slice(2);if(!out)throw Error('Usage: configPath outputDir');const r=await runParticleCosts({configPath,out});console.log(JSON.stringify({status:r.status,phase:r.phase,error:r.error,out}));if(r.status!=='passed')process.exitCode=1;}
