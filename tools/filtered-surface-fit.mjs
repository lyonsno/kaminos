// kaminos-test: manual — Greenroom source capture and provisional response fit.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createGrassMaterialSource} from '../grass-material-source.mjs';
import {SurfaceMaterialTeacher} from '../surface-material-teacher.mjs';
import {fitFilteredSurface,evaluateFilteredSurface,filteredSurfaceCasePlan} from '../filtered-surface-lod.mjs';
import {withKaminosGpu} from './shader-herder.mjs';
const [configPath,out]=process.argv.slice(2);
if(!configPath||!out)throw Error('Usage: node tools/filtered-surface-fit.mjs CONFIG OUTPUT');
await fs.mkdir(out,{recursive:true});
const report={schema:'kaminos.filtered-surface-fit.v1',status:'running',phase:'configuration',configPath,repoRoot:process.cwd(),job:process.env.GREENROOM_JOB_ID??null,cases:[],claim:'Provisional fixed-footprint approximation of an explicit grass teacher, not a neural fit or measured runtime saving'};
const publish=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await publish();
const sha=b=>createHash('sha256').update(b).digest('hex');
const raw=async(name,a)=>{const b=Buffer.from(a.buffer,a.byteOffset,a.byteLength);await fs.writeFile(path.join(out,name),b);return {file:name,bytes:b.length,sha256:sha(b)};};
let teacher;
try{
 if(!report.job)throw Error('Teacher capture requires Greenroom admission');
 const config=JSON.parse(await fs.readFile(configPath,'utf8'));
 for(const k of ['grid','trainAngles','testAngles','samples','testSamples','bounces','seed'])if(!Number.isSafeInteger(config[k])||config[k]<1)throw Error(`Invalid ${k}`);
 if(config.trainAngles<16||!Array.isArray(config.footprints)||!config.footprints.length||!config.footprints.every(v=>Number.isFinite(v)&&v>0&&v<=1))throw Error('Invalid fit design');
 const resolution=config.referenceResolution??256,cases=filteredSurfaceCasePlan(config.footprints,resolution);
 report.sourceRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();report.sourceStatus=execFileSync('git',['status','--porcelain'],{encoding:'utf8'});report.config=config;
 if(config.sourceRevision!==report.sourceRevision||report.sourceStatus)throw Error('Requested clean source revision is not effective');
 const source=createGrassMaterialSource(config.source);report.source={config:source.config,triangles:source.triangles.length,sha256:sha(JSON.stringify(source)),boundary:source.boundary};
 await fs.writeFile(path.join(out,'config.json'),JSON.stringify(config,null,2));await fs.writeFile(path.join(out,'source.json'),JSON.stringify(source));
 report.sourceFiles={};for(const file of ['tools/filtered-surface-fit.mjs','filtered-surface-lod.mjs','surface-material-teacher.mjs','surface-teacher-wgsl.mjs','grass-material-source.mjs']){const bytes=await fs.readFile(file);report.sourceFiles[file]=sha(bytes);await fs.writeFile(path.join(out,path.basename(file)),bytes);}
 let state=config.seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return (state+.5)/4294967296;};
 const angles=n=>Array.from({length:n},()=>[0,1].flatMap(()=>{const r=Math.sqrt(random()*.96),a=random()*2*Math.PI;return [r*Math.cos(a),r*Math.sin(a)];}));
 const train=angles(config.trainAngles),heldout=angles(config.testAngles);await fs.writeFile(path.join(out,'angles.json'),JSON.stringify({train,heldout}));
 const queries=(dirs,shift,lod)=>{const q=new Float32Array(config.grid**2*dirs.length*8);for(let y=0;y<config.grid;y++)for(let x=0;x<config.grid;x++)dirs.forEach((a,i)=>q.set([(x+.5+shift)/config.grid,(y+.5+shift)/config.grid,...a,lod,0],((y*config.grid+x)*dirs.length+i)*8));return q;};
 report.phase='capture';await publish();
 await withKaminosGpu(async ctx=>{
  report.adapter=ctx.adapterInfo;teacher=new SurfaceMaterialTeacher(ctx.device,{...source,lights:[],environment:0,bounces:config.bounces});
  const capture={tileSize:source.config.width,tileDepth:source.config.depth,referenceHeight:source.referenceHeight,resolution,samples:config.samples,seed:config.seed};
  for(const {footprint,tag,lod,index} of cases){
   const entry={tag,index,footprint,lod,referenceResolution:resolution,physicalFootprint:[source.config.width*footprint,source.config.depth*footprint],filter:'Square box in normalized UV at the reference plane; physical dimensions recorded explicitly',status:'running'};report.cases.push(entry);await publish();
   const q=queries(train,0,lod),test=queries(heldout,.25,lod);
   const labels=await teacher.evaluateMaterial(q,capture),testLabels=await teacher.evaluateMaterial(test,{...capture,samples:config.testSamples,seed:config.seed+1});
   entry.trainQueries=await raw(tag+'-train-queries.f32',q);entry.trainLabels=await raw(tag+'-train-labels.f32',labels);entry.testQueries=await raw(tag+'-test-queries.f32',test);entry.testLabels=await raw(tag+'-test-labels.f32',testLabels);
   report.phase='fit';await publish();const model=fitFilteredSurface({width:config.grid,height:config.grid,angles:train,labels});
   model.footprint=footprint;model.source=report.source;model.sourceRevision=report.sourceRevision;
   // The .moments artifact carries JSON bytes through the server's binary
   // read route. /api/read reformats .json, so its wire hash differs from disk.
   const serial={...model,coefficients:Array.from(model.coefficients),mean:Array.from(model.mean)},bytes=Buffer.from(JSON.stringify(serial)),file=tag+'.moments';await fs.writeFile(path.join(out,file),bytes);entry.model={file,sha256:sha(bytes),bytes:bytes.length};
   const predicted=new Float32Array(testLabels.length),meanPredicted=new Float32Array(testLabels.length);
   // Compare held-out directions and quarter-cell shifted spatial locations.
   for(let i=0;i<test.length/8;i++){
    predicted.set(evaluateFilteredSurface(model,Array.from(test.subarray(i*8,i*8+2)),Array.from(test.subarray(i*8+2,i*8+6))),i*3);
   }
   // Mean is a separate no-direction baseline with the same spatial sampling.
   const constant={...model,coefficients:new Float32Array(model.coefficients.length)};for(let p=0;p<config.grid**2;p++)constant.coefficients.set(model.mean.subarray(p*3,p*3+3),p*48);
   for(let i=0;i<test.length/8;i++)meanPredicted.set(evaluateFilteredSurface(constant,Array.from(test.subarray(i*8,i*8+2)),[0,0,0,0]),i*3);
   const mse=a=>a.reduce((s,v,i)=>s+(v-testLabels[i])**2,0)/a.length;
   entry.error={momentsMSE:mse(predicted),meanMSE:mse(meanPredicted),heldoutDirections:config.testAngles,spatialShiftCells:.25};entry.predicted=await raw(tag+'-predicted.f32',predicted);entry.meanPredicted=await raw(tag+'-mean.f32',meanPredicted);
   entry.images=[];report.phase='comparison';await publish();
   for(const [name,view,light]of [['front',[0,0],[.5,.3]],['oblique',[.75,.2],[-.5,.5]]]){
    const size=128,imageQ=new Float32Array(size*size*8);for(let y=0;y<size;y++)for(let x=0;x<size;x++)imageQ.set([(x+.5)/size,(y+.5)/size,...view,...light,lod,0],(y*size+x)*8);
    const reference=await teacher.evaluateMaterial(imageQ,{...capture,samples:config.testSamples,seed:config.seed+2}),rgb=new Float32Array(size*size*3);
    for(let i=0;i<size*size;i++)rgb.set(evaluateFilteredSurface(model,Array.from(imageQ.subarray(i*8,i*8+2)),[...view,...light]),i*3);
    entry.images.push({name,width:size,height:size,view,light,lod,source:await raw(tag+'-'+name+'-source.f32',reference),student:await raw(tag+'-'+name+'-student.f32',rgb)});
   }
   entry.status='complete';await publish();
  }
 },{onEvidence:e=>report.evidence=e});report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}finally{teacher?.dispose();await publish();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error}));}
