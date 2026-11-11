// kaminos-test: manual — explicit source/config/output; Greenroom accelerator job.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createGroundTeacherSource} from '../ground-teacher-source.mjs';
import {createMaterialQueryPool} from '../material-query-pool.mjs';
import {createGrassMaterialSource} from '../grass-material-source.mjs';
import {SurfaceMaterialTeacher} from '../surface-material-teacher.mjs';
import {createNeumipStudent,createNeumipTraining,neumipTrainingLayout,neumipTrainingBufferSizes} from '../neumip-training.mjs';
import {writeNeumipModel,readNeumipModel} from '../neumip-model.mjs';
import {withKaminosGpu,withGpuErrorScopes} from './shader-herder.mjs';

const [configPath,out]=process.argv.slice(2);if(!configPath||!out)throw Error('Usage: node tools/ground-material-fit.mjs CONFIG_JSON OUTPUT_DIR');
await fs.mkdir(out,{recursive:true});
const report={schema:'kaminos.ground-material-fit.v1',status:'running',phase:'configuration',repoRoot:process.cwd(),job:process.env.GREENROOM_JOB_ID??null,configPath,checkpoints:[],
 claim:'Independent authored ground microgeometry, explicit diffuse/GGX multibounce directional transport, box-filtered labels; preliminary fit, not converged or simulated soil',
 receiver:'neurips-unix-eunuch-neumip-turnip-tender'};
const publish=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await publish();
const sourcePeriodicity=source=>source?.periodic?'periodic geometry and full path transport':'finite source, no periodic claim';
const digest=x=>createHash('sha256').update(x).digest('hex');
const raw=async(name,data)=>{const bytes=Buffer.from(data.buffer,data.byteOffset,data.byteLength);await fs.writeFile(path.join(out,name),bytes);return {file:name,sha256:digest(bytes),bytes:bytes.length};};
const loss=(a,b)=>a.reduce((s,x,i)=>s+.5*(x-b[i])**2,0)/(a.length/3);
try{
 if(!report.job)throw Error('Ground capture/training requires Greenroom admission');
 const config=JSON.parse(await fs.readFile(configPath,'utf8'));
 const options={resolution:64,steps:2000,batch:2048,queries:65536,heldout:2048,samples:8,heldoutSamples:32,bounces:3,seed:41,fresh:true,...config.fit};report.options=options;
 for(const [k,v]of Object.entries(options))if(k==='fresh'?typeof v!=='boolean':!Number.isSafeInteger(v)||v<1)throw Error(`Invalid fit option ${k}`);
 report.phase='source-preflight';report.sourceRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();report.sourceStatus=execFileSync('git',['status','--porcelain'],{encoding:'utf8'});
 if(config.sourceRevision!==undefined&&(config.sourceRevision!==report.sourceRevision||report.sourceStatus))throw Error('Requested clean source revision is not effective');
 report.sourceFiles={};for(const name of ['ground-teacher-source.mjs','material-query-pool.mjs','grass-material-source.mjs','surface-teacher-source.mjs','periodic-surface-source.mjs','surface-teacher-wgsl.mjs','surface-teacher.mjs','surface-material-teacher.mjs','neumip-training.mjs','neumip-model.mjs','tools/ground-material-fit.mjs']){const b=await fs.readFile(name);report.sourceFiles[name]=digest(b);await fs.writeFile(path.join(out,path.basename(name)),b);}
 const grass=config.sourceKind==='grass';if(config.sourceKind&&!['grass','ground'].includes(config.sourceKind))throw Error('Unknown material source kind');
 const grid=config.labels==='denoised-grid';if(config.labels&&!['denoised-grid','raw'].includes(config.labels))throw Error('Unknown label route');if(grid&&!options.fresh)throw Error('Denoised grids require fresh streaming');
 const gridWidth=config.grid?.width??32,gridHeight=config.grid?.height??64;
 if(grid&&(![gridWidth,gridHeight].every(v=>Number.isSafeInteger(v)&&v>0)||gridWidth*gridHeight!==options.batch||gridWidth>options.resolution||gridHeight>options.resolution||options.queries<options.batch))throw Error('Grid extent must be positive integers, equal batch, fit student resolution and rolling pool');
 report.receiver=config.receiver??report.receiver;report.claim=grass?`Preliminary fit of frozen grass ribbons, ${grid?'geometry-guided denoised':'raw box-footprint-averaged'} directional responses; ${sourcePeriodicity(config.source)}; no convergence claim`:report.claim;
 const source=grass?createGrassMaterialSource(config.source):createGroundTeacherSource(config.source);report.sourceKind=grass?'grass':'ground';report.ground={config:source.config,triangles:source.triangles.length,materials:source.materials,boundary:source.boundary,periodic:source.periodic??null,referenceHeight:source.referenceHeight,sha256:digest(JSON.stringify(source))};
 await fs.writeFile(path.join(out,'config.json'),JSON.stringify(config,null,2));await fs.writeFile(path.join(out,'source.json'),JSON.stringify(source));
 let state=options.seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return (state+.5)/4294967296;};
 const queries=n=>{const data=new Float32Array(n*8);for(let i=0;i<n;i++){const q=i*8;data[q]=random();data[q+1]=random();for(const d of [2,4]){const r=Math.sqrt(random()*.99),t=random()*Math.PI*2;data[q+d]=r*Math.cos(t);data[q+d+1]=r*Math.sin(t);}data[q+6]=random()<.6?0:random()*Math.log2(options.resolution/2);}return data;};
 const trainingQueries=grid?null:queries(options.queries),heldoutQueries=queries(options.heldout),student=createNeumipStudent({resolution:options.resolution,seed:options.seed});
 const buffers=neumipTrainingBufferSizes(neumipTrainingLayout(student),Math.max(options.batch,options.heldout,128**2));
 const largest=Math.max(...Object.values(buffers),options.queries*32,source.triangles.length*48);
 const requiredLimits={maxStorageBufferBindingSize:Math.max(128*1024**2,largest),maxBufferSize:Math.max(256*1024**2,largest)};
 report.phase='capture';await publish();
 await withKaminosGpu(async ctx=>{
  report.adapter=ctx.adapterInfo;let teacher,learner;const start=performance.now();
  try{
   teacher=new SurfaceMaterialTeacher(ctx.device,{...source,lights:[],environment:0,bounces:options.bounces});
   const capture={tileSize:source.config.width??source.config.tileSize,tileDepth:source.config.depth??source.config.tileSize,referenceHeight:source.referenceHeight,resolution:options.resolution,samples:options.samples,seed:options.seed};
   const labels=grid?null:await withGpuErrorScopes(ctx.device,'ground-label-capture',()=>teacher.evaluateMaterial(trainingQueries,capture));
   const heldoutLabels=await teacher.evaluateMaterial(heldoutQueries,{...capture,samples:options.heldoutSamples,seed:options.seed+1});
   report.captureMs=performance.now()-start;report.dataset={queries:trainingQueries?await raw('training-queries.f32',trainingQueries):null,labels:labels?await raw('training-labels.f32',labels):null,heldoutQueries:await raw('heldout-queries.f32',heldoutQueries),heldoutLabels:await raw('heldout-labels.f32',heldoutLabels),filter:'square box in normalized UV, world reference-plane extent (2^LOD/resolution)*[tileWidth,tileDepth]',response:'linear outgoing radiance under unit directional irradiance divided by macro light cosine; live material multiplies it back'};
   // These reference images were already part of the final comparison. Keep
   // them before fitting so an ordinary source check precedes training spend.
   report.phase='source-preview';report.images=[];const imageQueries=[];
   for(const [name,view,light]of [['front',[0,0],[.5,.3]],['oblique',[.75,.2],[-.5,.5]]]){
    const size=128,q=new Float32Array(size*size*8);for(let y=0;y<size;y++)for(let x=0;x<size;x++)q.set([(x+.5)/size,(y+.5)/size,...view,...light,0,0],(y*size+x)*8);
    const reference=await teacher.evaluateMaterial(q,{...capture,samples:32,seed:options.seed+2});
    report.images.push({name,width:size,height:size,view,light,lod:0,reference:await raw(`${name}-source.f32`,reference)});imageQueries.push(q);await publish();
   }
   learner=await createNeumipTraining(ctx.device,student,{batchSize:Math.max(options.batch,options.heldout,128**2)});
   const checkpoint=async step=>{
    learner.setQueries(heldoutQueries);const {rgb}=await learner.evaluate();
    const model=await learner.exportModel(),bytes=writeNeumipModel(model),name=`${grass?'grass':'ground'}-${options.resolution}-step-${step}.model`;
    // Round-trip the actual runtime artifact, not only training-resident state.
    readNeumipModel(bytes);await fs.writeFile(path.join(out,name),bytes);await raw(`heldout-${step}.f32`,rgb);
    const record={step,loss:loss(rgb,heldoutLabels),elapsedMs:performance.now()-start,file:name,sha256:digest(bytes),bytes:bytes.length};report.checkpoints.push(record);console.log(JSON.stringify(record));await publish();
   };
   report.phase='fit';await checkpoint(0);
   const fitStart=performance.now();let batch=new Float32Array(options.batch*8),targets=new Float32Array(options.batch*3);
   let gridCount=0;let queryStream,labelStream,rawLabelStream,gridRecipes,gridLabelStream,gridRawStream;const queryHash=createHash('sha256'),labelHash=createHash('sha256');
   try{
   if(options.fresh){queryStream=await fs.open(path.join(out,'fresh-training-queries.f32'),'w');labelStream=await fs.open(path.join(out,'fresh-training-labels.f32'),'w');report.dataset.trainingMode='Fresh independently traced query batch per optimizer update; every query and label retained';}
   else report.dataset.trainingMode='Resampled finite captured label set';
   if(grid){rawLabelStream=await fs.open(path.join(out,'fresh-training-raw-labels.f32'),'w');gridLabelStream=await fs.open(path.join(out,'captured-grid-labels.f32'),'w');gridRawStream=await fs.open(path.join(out,'captured-grid-raw-labels.f32'),'w');gridRecipes=await fs.open(path.join(out,'grid-recipes.jsonl'),'w');report.dataset.trainingMode='Fresh coherent captures enter rolling pool; optimizer batches mix retained spatial/angular samples across windows';report.dataset.filter='Three geometry-guided atrous passes, strides 1/2/4; linear response, no tone mapping, no temporal history';report.dataset.heldoutFilter=`Independent raw ${options.heldoutSamples}-spp queries, explicitly measures filtered-label bias as well as fit`;}
   const pool=grid?createMaterialQueryPool(options.queries):null;
   const captureGrid=async()=>{
    const direction=queries(1),uvScale=[gridWidth/options.resolution,gridHeight/options.resolution];
    const recipe={width:gridWidth,height:gridHeight,uvScale,uvOrigin:[random()*(1-uvScale[0]),random()*(1-uvScale[1])],tileWidth:source.config.width??source.config.tileSize,tileDepth:source.config.depth??source.config.tileSize,referenceHeight:source.referenceHeight,resolution:options.resolution,samples:options.samples,seed:options.seed+gridCount+3,view:Array.from(direction.subarray(2,4)),light:Array.from(direction.subarray(4,6)),lod:direction[6]};
    const captured=await teacher.evaluateMaterialGrid(recipe);pool.add(captured);gridCount++;
    await gridRawStream.writeFile(Buffer.from(captured.raw.buffer));await gridLabelStream.writeFile(Buffer.from(captured.filtered.buffer));await gridRecipes.writeFile(JSON.stringify({grid:gridCount,...recipe})+'\n');report.capturedGridCount=gridCount;
   };
   if(grid){report.phase='pool-warmup';await publish();while(pool.count<options.queries)await captureGrid();report.phase='fit';report.dataset.pool={capacity:options.queries,warmupGrids:gridCount,policy:'Replace oldest entries with a fresh capture per step; sample optimizer queries uniformly across current pool'};await publish();}
   for(let step=1;step<=options.steps;step++){
    if(options.fresh){
     if(grid){
      await captureGrid();const mixed=pool.sample(options.batch,random);batch=mixed.queries;targets=mixed.filtered;await rawLabelStream.writeFile(Buffer.from(mixed.raw.buffer));
     }else{batch=queries(options.batch);targets=await teacher.evaluateMaterial(batch,{...capture,seed:options.seed+step+3});}
     const qb=Buffer.from(batch.buffer,batch.byteOffset,batch.byteLength),tb=Buffer.from(targets.buffer,targets.byteOffset,targets.byteLength);
     await queryStream.writeFile(qb);await labelStream.writeFile(tb);queryHash.update(qb);labelHash.update(tb);report.lastCapturedStep=step;
    }else for(let i=0;i<options.batch;i++){const index=Math.floor(random()*options.queries);batch.set(trainingQueries.subarray(index*8,index*8+8),i*8);targets.set(labels.subarray(index*3,index*3+3),i*3);}
    learner.setQueries(batch);learner.setTargets(targets);
    const update=async()=>{const encoder=ctx.device.createCommandEncoder();learner.encodeUpdate(encoder);ctx.device.queue.submit([encoder.finish()]);await ctx.device.queue.onSubmittedWorkDone();};
    if(step===1)await withGpuErrorScopes(ctx.device,'ground-first-update',update);else await update();
    await new Promise(resolve=>setTimeout(resolve,16));
    if(step%250===0||step===options.steps)await checkpoint(step);
   }
   }finally{await queryStream?.close();await labelStream?.close();await rawLabelStream?.close();await gridRecipes?.close();await gridLabelStream?.close();await gridRawStream?.close();}
   if(grid)report.dataset.rawLabels={file:'fresh-training-raw-labels.f32',bytes:options.steps*options.batch*12,recipes:'grid-recipes.jsonl',capturedRaw:'captured-grid-raw-labels.f32',capturedFiltered:'captured-grid-labels.f32',capturedGridCount:gridCount};
   if(options.fresh)report.dataset.fresh={queries:{file:'fresh-training-queries.f32',bytes:options.steps*options.batch*32,sha256:queryHash.digest('hex')},labels:{file:'fresh-training-labels.f32',bytes:options.steps*options.batch*12,sha256:labelHash.digest('hex')}};
   report.fitMs=performance.now()-fitStart;
   // Matched 128px material-domain images: same UV, footprint, directions and
   // gain; these diagnose fitting, not projective camera or silhouette behavior.
   report.phase='comparison';await publish();
   for(const [i,image]of report.images.entries()){
    learner.setQueries(imageQueries[i]);const predicted=(await learner.evaluate()).rgb;image.student=await raw(`${image.name}-student.f32`,predicted);await publish();
   }
   report.elapsedMs=performance.now()-start;
   if(!(report.checkpoints.at(-1).loss<report.checkpoints[0].loss))throw Error('Held-out response did not improve');
  }finally{learner?.dispose();teacher?.dispose();}
 },{requiredLimits,onEvidence:e=>report.evidence=e});
 report.phase='source-postflight';if(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==report.sourceRevision||execFileSync('git',['status','--porcelain'],{encoding:'utf8'})!==report.sourceStatus)throw Error('Source changed during capture or fitting');
 report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=error.stack;if(error.capture)report.failedCapture={...error.capture,queries:await raw('failed-capture-queries.f32',error.queries)};process.exitCode=1;}
finally{await publish();console.log(JSON.stringify({status:report.status,phase:report.phase,elapsedMs:report.elapsedMs,error:report.error}));}
