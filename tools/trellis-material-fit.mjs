// kaminos-test: manual — explicit source/config/output, admitted Greenroom job.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const [configPath,out]=process.argv.slice(2);
if(!configPath||!out)throw Error('Usage: node tools/trellis-material-fit.mjs CONFIG_JSON OUTPUT_DIR');
await fs.mkdir(out,{recursive:true});
const report={schema:'kaminos.trellis-material-fit.v1',status:'running',phase:'admission',receiver:null,repoRoot:process.cwd(),configPath,job:process.env.GREENROOM_JOB_ID??null,checkpoints:[],claim:'preliminary RGB panel-control fit from original source maps and clipped geometry; no support coverage, exit continuation or runtime advantage'};
const publish=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await publish();
const hash=b=>createHash('sha256').update(b).digest('hex');
const raw=async(name,v)=>{const b=Buffer.from(v.buffer,v.byteOffset,v.byteLength);await fs.writeFile(path.join(out,name),b);return {file:name,bytes:b.length,sha256:hash(b)};};
const loss=(a,b)=>a.reduce((s,v,i)=>s+(v-b[i])**2,0)/a.length;
let source,learner,trainStream,labelStream;
try{
 if(!report.job)throw Error('TRELLIS capture/training requires Greenroom admission');
 report.phase='configuration';await publish();
 const config=JSON.parse(await fs.readFile(configPath,'utf8')),fit=config.fit;
 for(const k of ['resolution','steps','batch','heldout','samples','heldoutSamples','seed'])if(!Number.isSafeInteger(fit?.[k])||fit[k]<1)throw Error(`Positive explicit fit.${k} required`);
 if(!config.source?.path||!/^[a-f0-9]{64}$/.test(config.source.sha256))throw Error('Explicit source path and SHA256 required');
 const bytes=await fs.readFile(config.source.path);if(hash(bytes)!==config.source.sha256)throw Error('Source GLB hash mismatch');
 report.receiver=config.receiver??null;report.config=config;await fs.copyFile(configPath,path.join(out,'config.json'));await fs.writeFile(path.join(out,'source.glb'),bytes);
 report.revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();report.sourceStatus=execFileSync('git',['status','--porcelain'],{encoding:'utf8'});report.code={};
 for(const name of ['trellis-training-source.mjs','trellis-surface-teacher.mjs','trellis-source-material.mjs','trellis-local-support.mjs','trellis-support-gpu.mjs','trellis-support-rays.mjs','surface-teacher.mjs','surface-teacher-wgsl.mjs','surface-material-teacher.mjs','scene-light-visibility.mjs','poly-glb-io.mjs','lod-mesh-bake.mjs','neumip-training.mjs','neumip-model.mjs','tools/trellis-material-fit.mjs']){const b=await fs.readFile(new URL('../'+name,import.meta.url));report.code[name]=hash(b);const dest=path.join(out,'code',name);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,b);}
 report.phase='imports';await publish();
 const {createTrellisTrainingSource}=await import('../trellis-training-source.mjs'),{createNeumipStudent,createNeumipTraining,neumipTrainingLayout,neumipTrainingBufferSizes}=await import('../neumip-training.mjs'),{writeNeumipModel,readNeumipModel}=await import('../neumip-model.mjs'),{withKaminosGpu,withGpuErrorScopes}=await import('./shader-herder.mjs');
 if(typeof writeNeumipModel!=='function'||typeof readNeumipModel!=='function')throw Error('Trainer runtime-format reader and writer required before source capture');
 const student=createNeumipStudent(fit),capacity=Math.max(fit.batch,fit.heldout,64**2),sizes=neumipTrainingBufferSizes(neumipTrainingLayout(student),capacity),largest=Math.max(...Object.values(sizes));
 let rng=fit.seed>>>0;const random=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return (rng+.5)/4294967296;};
 // Same near-hemisphere sampling convention as the existing ground fit. LOD0
 // only is the explicit initial panel control; independent higher mips untrained.
 const queries=count=>{const q=new Float32Array(count*8);for(let i=0;i<count;i++){q[i*8]=random();q[i*8+1]=random();for(const d of [2,4]){const r=Math.sqrt(random()*.99),a=random()*2*Math.PI;q[i*8+d]=r*Math.cos(a);q[i*8+d+1]=r*Math.sin(a);}}return q;};
 const heldoutQueries=queries(fit.heldout);report.queryDomain={uv:'uniform [0,1)^2 inside configured tile',viewAndLight:'independent disk, radius sqrt(.99), existing ground-fit convention',lod:0,freshTraining:true};
 trainStream=await fs.open(path.join(out,'fresh-queries.f32'),'w');labelStream=await fs.open(path.join(out,'fresh-labels.f32'),'w');
 await withKaminosGpu(async ctx=>{
  report.adapter=ctx.adapterInfo;report.phase='source';await publish();
  try{
   source=await createTrellisTrainingSource(ctx.device,bytes,config.source);report.source=source.source;
   await fs.writeFile(path.join(out,'source-triangles.json'),JSON.stringify(source.triangles));
   const capture={...source.capture,resolution:fit.resolution,samples:fit.samples,seed:fit.seed};
   const labels=await withGpuErrorScopes(ctx.device,'source heldout labels',()=>source.teacher.evaluateMaterial(heldoutQueries,{...capture,samples:fit.heldoutSamples}));
   report.heldout={queries:await raw('heldout-queries.f32',heldoutQueries),targets:await raw('heldout-labels.f32',labels)};if(!labels.some(v=>v>0))throw Error('Blank source labels cannot establish a material fit');
   learner=await createNeumipTraining(ctx.device,student,{batchSize:capacity});
   const checkpoint=async step=>{learner.setQueries(heldoutQueries);const {rgb}=await learner.evaluate();const model=await learner.exportModel(),archive=writeNeumipModel(model);readNeumipModel(archive);const filename=`panel-${fit.resolution}-step-${step}.model`;await fs.writeFile(path.join(out,filename),archive);const predictions=await raw(`heldout-${step}.f32`,rgb);report.checkpoints.push({step,mse:loss(rgb,labels),file:filename,bytes:archive.length,sha256:hash(archive),predictions});await publish();};
   report.phase='initial-checkpoint';await publish();await checkpoint(0);report.phase='training';await publish();
   for(let step=0;step<fit.steps;step++){
    const q=queries(fit.batch),target=await withGpuErrorScopes(ctx.device,'source fresh training labels',()=>source.teacher.evaluateMaterial(q,{...capture,seed:fit.seed+step+1}));
    await trainStream.write(Buffer.from(q.buffer));await labelStream.write(Buffer.from(target.buffer));
    learner.setQueries(q);learner.setTargets(target);
    await withGpuErrorScopes(ctx.device,'source student update',async()=>{const e=ctx.device.createCommandEncoder();learner.encodeUpdate(e);ctx.device.queue.submit([e.finish()]);await ctx.device.queue.onSubmittedWorkDone();});
    // Retain the existing trainer assay's provisional native scheduling yield.
    await new Promise(resolve=>setTimeout(resolve,16));
   }
   await checkpoint(fit.steps);report.result={heldoutLossDecreased:report.checkpoints.at(-1).mse<report.checkpoints[0].mse};
   report.phase='comparison';await publish();report.images=[];const size=64;
   for(const [name,view,light]of [['front',[0,0],[.5,.3]],['oblique',[.75,.2],[-.5,.5]]]){
    const q=new Float32Array(size*size*8);for(let y=0;y<size;y++)for(let x=0;x<size;x++)q.set([(x+.5)/size,(y+.5)/size,...view,...light,0,0],(y*size+x)*8);
    const reference=await source.teacher.evaluateMaterial(q,{...capture,samples:fit.heldoutSamples,seed:fit.seed+fit.steps+1});learner.setQueries(q);const prediction=(await learner.evaluate()).rgb;
    report.images.push({name,width:size,height:size,view,light,lod:0,reference:await raw(name+'-source.f32',reference),student:await raw(name+'-student.f32',prediction),mse:loss(prediction,reference)});
   }
  }finally{learner?.dispose();learner=null;source?.dispose();source=null;}
 },{requiredLimits:{maxStorageBufferBindingSize:Math.max(128*1024**2,largest),maxBufferSize:Math.max(256*1024**2,largest)}});
 await trainStream.close();trainStream=null;await labelStream.close();labelStream=null;
 report.freshStreams={};for(const name of ['fresh-queries.f32','fresh-labels.f32']){const b=await fs.readFile(path.join(out,name));report.freshStreams[name]={bytes:b.length,sha256:hash(b)};}
 report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.error=String(e.stack??e);process.exitCode=1;}
finally{await trainStream?.close();await labelStream?.close();await publish();console.log(JSON.stringify({status:report.status,phase:report.phase,report:path.join(out,'report.json'),error:report.error}));}
