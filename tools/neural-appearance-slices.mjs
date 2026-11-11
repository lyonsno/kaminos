// Retained first-fit diagnosis, not a performance measurement or new training.
import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
const [configPath,out]=process.argv.slice(2);if(!out)throw Error('Caller-owned configuration/output required');await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'admission',job:process.env.GREENROOM_JOB_ID,configPath,root:process.cwd()};const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await save();
const hash=b=>createHash('sha256').update(b).digest('hex');
try{
 if(!report.job)throw Error('Response slice capture requires Greenroom admission');
 report.commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();if(report.commit!==process.env.EXPECTED_COMMIT||execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())throw Error('Pinned clean source required');
 const config=JSON.parse(await fs.readFile(configPath,'utf8'));report.config=config;report.phase='inputs';await save();
 const fit=JSON.parse(await fs.readFile(path.join(config.fitRoot,'report.json'),'utf8'));if(fit.status!=='passed'||fit.phase!=='complete'||!fit.checkpoints?.length)throw Error('Complete retained fit required');
 const sourceBytes=await fs.readFile(config.sourcePath);if(hash(sourceBytes)!==config.sourceSha256)throw Error('Source digest changed');
 if(execFileSync('git',['-C',config.teacherRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim()!==config.teacherCommit)throw Error('Teacher revision changed');
 const source=JSON.parse(sourceBytes),resolution=fit.options.resolution,light=[.4,.15,Math.sqrt(1-.4**2-.15**2)];
 const views=[{id:'normal',label:'Normal view',view:[0,0,1],light},{id:'reflection',label:'Near the specular direction',view:[-.4,-.15,light[2]],light},{id:'grazing',label:'Grazing view',view:[-.95,0,Math.sqrt(1-.95**2)],light}];
 const n=resolution*resolution,q=new Float32Array(n*views.length*8),directions=[];
 for(const [vIndex,v] of views.entries())for(let y=0;y<resolution;y++)for(let x=0;x<resolution;x++){
  const uv=[(x+.5)/resolution,(y+.5)/resolution],i=(vIndex*n+y*resolution+x)*8;
  q.set([...uv,-v.view[0],-v.view[1],-v.light[0],-v.light[1],0,0],i);directions.push([...uv,...v.view,...v.light]);
 }
 await fs.writeFile(path.join(out,'teacher-queries.f32'),Buffer.from(q.buffer));
 const {SurfaceMaterialTeacher}=await import(pathToFileURL(path.join(config.teacherRoot,'surface-material-teacher.mjs')));
 const {withKaminosGpu,withGpuErrorScopes,evalWgslBatch}=await import('./shader-herder.mjs');const {readNeuralAppearanceBundle}=await import('../neural-appearance-bundle.mjs');const {buildNeuralAppearanceWGSL}=await import('../neural-appearance.mjs');
 const manifest={schema:'kaminos.neural-appearance.trajectory.v1',status:'complete',width:resolution,height:resolution,response:'projected-bsdf',views,checkpoints:[],fit:{job:fit.job,sourceCommit:fit.sourceCommit,reportHash:hash(await fs.readFile(path.join(config.fitRoot,'report.json'))),meaning:fit.claim}};
 const entry=async(file,bytes)=>{await fs.writeFile(path.join(out,file),bytes);return {url:config.publicBase+encodeURIComponent(file),sha256:hash(bytes)};};
 report.phase='reference';await save();
 await withKaminosGpu(async ctx=>{
  report.adapter=ctx.adapterInfo;const teacher=new SurfaceMaterialTeacher(ctx.device,{...source,lights:[],environment:0,bounces:fit.config.capture.bounces});let reference;
  try{reference=await withGpuErrorScopes(ctx.device,'retained-response-slices',()=>teacher.evaluateMaterial(q,{tileSize:source.config.width,referenceHeight:source.referenceHeight,resolution,samples:config.samples,seed:config.seed}));}finally{teacher.dispose();}
  for(let i=0;i<reference.length;i++)reference[i]*=light[2];
  if(reference.length!==directions.length*3||!reference.every(x=>Number.isFinite(x)&&x>=0)||!reference.some(x=>x>0))throw Error('Missing/nonfinite/blank source response');
  for(const [i,v] of views.entries())v.reference=await entry(v.id+'-reference.f32',Buffer.from(reference.slice(i*n*3,(i+1)*n*3).buffer));
  report.referenceMeans=views.map((v,i)=>({view:v.id,mean:reference.slice(i*n*3,(i+1)*n*3).reduce((a,b)=>a+b,0)/(n*3)}));
  for(const checkpoint of fit.checkpoints){
   report.phase='checkpoint-'+checkpoint.step;await save();const folder='step-'+checkpoint.step;await fs.mkdir(path.join(out,folder),{recursive:true});
   const bytes=await fs.readFile(checkpoint.path);if(hash(bytes)!==checkpoint.sha256)throw Error('Checkpoint changed');
   const raw=JSON.parse(bytes),bundle=readNeuralAppearanceBundle(raw);if(bundle.levels.length!==1||bundle.levels[0].width!==resolution||bundle.levels[0].height!==resolution)throw Error('First-fit slice policy requires its original single authored level');
   const level=bundle.levels[0],zBytes=await fs.readFile(path.join(path.dirname(checkpoint.path),level.url));if(hash(zBytes)!==level.sha256||zBytes.length!==level.byteLength)throw Error('Latents changed');
   const z=new Float32Array(zBytes.buffer,zBytes.byteOffset,zBytes.byteLength/4),inputs=directions.map(([u,v,...d])=>{const x=Math.floor(u*resolution),y=Math.floor(v*resolution);return [...z.slice((y*resolution+x)*8,(y*resolution+x+1)*8),...d];});
   const predictions=await evalWgslBatch(ctx,{preamble:buildNeuralAppearanceWGSL(bundle.decoder),argTypes:Array(14).fill('f32'),returnType:'vec3<f32>',body:'return neuralAppearanceEvaluate(array<f32,8>('+Array.from({length:8},(_,i)=>'arg'+i).join(',')+'),vec3<f32>(arg8,arg9,arg10),vec3<f32>(arg11,arg12,arg13));',inputs});
   if(predictions.length!==directions.length||!predictions.flat().every(x=>Number.isFinite(x)&&x>=0))throw Error('Partial or invalid network response');
   const row={step:checkpoint.step,heldoutLogL1:checkpoint.heldoutLogL1,source:await entry(folder+'/model.model',bytes),slices:{},meanAbsoluteError:{}};
   await fs.writeFile(path.join(out,folder,level.url),zBytes);
   for(const [i,v] of views.entries()){const a=Float32Array.from(predictions.slice(i*n,(i+1)*n).flat());row.slices[v.id]=await entry(folder+'/'+v.id+'.f32',Buffer.from(a.buffer));row.meanAbsoluteError[v.id]=a.reduce((sum,value,k)=>sum+Math.abs(value-reference[i*n*3+k]),0)/a.length;}
   manifest.checkpoints.push(row);report.completedCheckpoint=checkpoint.step;await save();
  }
 },{onEvidence:e=>report.execution=e});
 const {readAppearanceTrajectory}=await import('../neural-appearance-trajectory.mjs');readAppearanceTrajectory(manifest);await fs.writeFile(path.join(out,'trajectory.model'),JSON.stringify(manifest,null,2)+'\n');
 report.status='passed';report.phase='complete';report.manifest=path.join(out,'trajectory.model');
}catch(e){report.status='failed';report.error=e.stack;process.exitCode=1;}finally{await save();console.log(JSON.stringify(report));}
