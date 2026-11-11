// kaminos-test: manual — Greenroom capture of an existing owner-authored source.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {withKaminosGpu,withGpuErrorScopes} from './shader-herder.mjs';
import {publishedQueryBatch} from '../neural-appearance-training-recipe.mjs';
import {createAppearanceDirectionCapture} from '../neural-appearance-direction-capture.mjs';
const [configPath,out]=process.argv.slice(2);await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'configuration',configPath,job:process.env.GREENROOM_JOB_ID};
const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await save();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
try{
 if(!report.job)throw Error('Material corpus capture requires Greenroom admission');
 const config=JSON.parse(await fs.readFile(configPath,'utf8')),c=config.capture,resolution=config.fit?.resolution??64;
 const {SurfaceMaterialTeacher}=await import(pathToFileURL(path.join(c.teacherRoot,'surface-material-teacher.mjs')));
 const sourceBytes=await fs.readFile(c.sourcePath);if(hash(sourceBytes)!==c.sourceSha256)throw Error('Authored source digest mismatch');
 const source=JSON.parse(sourceBytes);await fs.writeFile(path.join(out,'source.json'),sourceBytes);
 report.teacher={sourcePath:c.sourcePath,teacherRoot:c.teacherRoot,sourceProvenance:c.sourceProvenance,teacherCommit:execFileSync('git',['-C',c.teacherRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceHash:hash(sourceBytes),boundary:source.boundary};
 if(report.teacher.teacherCommit!==c.teacherCommit)throw Error('Teacher revision changed');
 if(execFileSync('git',['-C',c.teacherRoot,'status','--porcelain'],{encoding:'utf8'}).trim())throw Error('Teacher source is dirty');
 if(source.config.width!==source.config.depth)throw Error('This material corpus requires a square source chart');
 report.teacher.moduleHashes={};for(const name of ['surface-material-teacher.mjs','surface-teacher.mjs','surface-teacher-wgsl.mjs','scene-light-visibility.mjs']){const bytes=await fs.readFile(path.join(c.teacherRoot,name));report.teacher.moduleHashes[name]=hash(bytes);await fs.writeFile(path.join(out,name),bytes);}
 const sampling=c.directionalSampling??'legacy-cosine-fixed';if(!['UniformRusinkiewicz','legacy-cosine-fixed'].includes(sampling))throw Error('Reference-material importance sampler required for the requested strategy');
 const published=sampling==='UniformRusinkiewicz';report.directionalSampling=sampling;const counts={queries:c.queries??16384,heldoutQueries:c.heldout??(published?4096:2048)};for(const n of Object.values(counts))if(!Number.isSafeInteger(n)||n<1)throw Error('Positive capture count required');
 let state=c.seed??41;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return (state+.5)/4294967296;};
 const make=count=>{const q=new Float32Array(count*8);for(let i=0;i<count;i++){const j=i*8;q[j]=(Math.floor(random()*resolution)+.5)/resolution;q[j+1]=(Math.floor(random()*resolution)+.5)/resolution;for(const d of [2,4]){const r=Math.sqrt(random()*.99),a=random()*2*Math.PI;q[j+d]=r*Math.cos(a);q[j+d+1]=r*Math.sin(a);}}return q;};
 const queries=published?publishedQueryBatch(counts.queries,random,{batchSize:config.fit?.batch??1024}):make(counts.queries),heldout=published?publishedQueryBatch(counts.heldoutQueries,random):make(counts.heldoutQueries),dataset={directionalSampling:sampling,spatialSampling:published?'per-batch-stratified-jittered':'random-texel-centers',schema:'kaminos.neural-appearance.corpus.v1',resolution,response:'projected-bsdf',teacher:report.teacher};
 const raw=async(name,data)=>{const bytes=Buffer.from(data.buffer,data.byteOffset,data.byteLength);await fs.writeFile(path.join(out,name),bytes);return {file:name,sha256:hash(bytes),bytes:bytes.length};};
 report.phase='capture';await save();
 await withKaminosGpu(async ctx=>{
  report.adapter=ctx.adapterInfo;const teacher=new SurfaceMaterialTeacher(ctx.device,{...source,lights:[],environment:0,bounces:c.bounces??3});
  const {SURFACE_TEACHER_COMMON_WGSL}=await import(pathToFileURL(path.join(c.teacherRoot,'surface-teacher-wgsl.mjs')));const explicit=published?createAppearanceDirectionCapture(teacher,SURFACE_TEACHER_COMMON_WGSL):null;
  try{for(const [qname,lname,q,samples] of [['queries','labels',queries,c.samples??8],['heldoutQueries','heldoutLabels',heldout,c.heldoutSamples??32]]){
   const labels=await withGpuErrorScopes(ctx.device,'neural-appearance-'+qname,()=>published?explicit.evaluate(q,{tileSize:source.config.width,referenceHeight:source.referenceHeight,resolution,samples,seed:c.seed??41}):teacher.evaluateMaterial(q,{tileSize:source.config.width,referenceHeight:source.referenceHeight,resolution,samples,seed:c.seed??41}));
   const directions=published?q.slice():new Float32Array(q.length);
   if(!published)for(let i=0;i<q.length;i+=8){const vz=Math.sqrt(1-q[i+2]**2-q[i+3]**2),lz=Math.sqrt(1-q[i+4]**2-q[i+5]**2);directions.set([q[i],q[i+1],-q[i+2],-q[i+3],vz,-q[i+4],-q[i+5],lz],i);for(let k=0;k<3;k++)labels[i/8*3+k]*=lz;}
   dataset[qname]=await raw(qname+'.f32',directions);dataset[lname]=await raw(lname+'.f32',labels);report.completed=qname;await save();
  }}finally{teacher.dispose();}
 },{onEvidence:e=>report.evidence=e});
 dataset.queryLayout='UV, outward view XYZ, outward light XYZ; chart U=X,V=Z,N=Y';dataset.filter='Existing source teacher square footprint at integer LOD0, width1/resolution; native nearest learned texel';
 await fs.writeFile(path.join(out,'dataset.json'),JSON.stringify(dataset,null,2));report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}finally{await save();console.log(JSON.stringify(report));}
