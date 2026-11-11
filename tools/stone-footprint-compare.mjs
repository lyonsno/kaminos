// kaminos-test: manual — Greenroom-only traced comparisons of a retained fit.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {SurfaceMaterialTeacher} from '../surface-material-teacher.mjs';
import {readNeumipModel} from '../neumip-model.mjs';
import {createNeumipTraining} from '../neumip-training.mjs';
import {stoneWindowRegion} from '../stone-material-window.mjs';
import {withKaminosGpu} from './shader-herder.mjs';

const [fitDir,out]=process.argv.slice(2);if(!fitDir||!out)throw Error('Usage: node tools/stone-footprint-compare.mjs FIT_DIR OUTPUT_DIR');
await fs.mkdir(out,{recursive:true});
const report={schema:'kaminos.stone-footprint-comparison.v1',status:'running',phase:'inputs',fitDir,job:process.env.GREENROOM_JOB_ID??null,images:[],claim:'Matched material-domain footprint comparisons; output-fade is a control, not a learned bridge or screen-space GI comparison'};
const publish=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await publish();
const sha=x=>createHash('sha256').update(x).digest('hex');
const raw=async(name,array)=>{const bytes=Buffer.from(array.buffer,array.byteOffset,array.byteLength);await fs.writeFile(path.join(out,name),bytes);return {file:name,sha256:sha(bytes),bytes:bytes.length};};
try{
 if(!report.job)throw Error('Traced footprint comparison requires Greenroom admission');
 const fit=JSON.parse(await fs.readFile(path.join(fitDir,'report.json'),'utf8'));
 if(fit.sourceKind!=='stone-transition'||!fit.ground?.sha256)throw Error('Observed stone fit report required');
 const source=JSON.parse(await fs.readFile(path.join(fitDir,'source.json'),'utf8'));
 if(source.schema!=='kaminos.stone-transition-source.v1'||sha(JSON.stringify(source))!==fit.ground.sha256)throw Error('Source bytes disagree with the observed fit');
 const checkpoint=fit.checkpoints?.at(-1);if(!checkpoint?.file||!checkpoint.sha256)throw Error('No actual model checkpoint available');
 const bytes=await fs.readFile(path.join(fitDir,checkpoint.file));if(sha(bytes)!==checkpoint.sha256)throw Error('Checkpoint digest mismatch');
 const model=readNeumipModel(bytes),resolution=model.offset.width;
 report.fit={status:fit.status,phase:fit.phase,sourceRevision:fit.sourceRevision,sourceDigest:fit.ground.sha256,checkpoint};report.resolution=resolution;
 const size=128,samples=32,lods=[0,1.5,3,Math.log2(resolution/2)],collar=.04;
 report.configuration={size,samples,lods,collar,bounces:fit.options.bounces};
 const c=source.config,w=source.captureDomain?.width??c.width,d=source.captureDomain?.depth??c.depth,plane=(2*c.halo+1),a=[-w*plane/2,0,-d*plane/2],b=[w*plane/2,0,-d*plane/2],e=[w*plane/2,0,d*plane/2],f=[-w*plane/2,0,d*plane/2];
 const endpoint={triangles:[{a,b:e,c:b,materialIndex:0},{a,b:f,c:e,materialIndex:0}],materials:[source.materials[0]]};
 report.phase='evaluate';await publish();
 await withKaminosGpu(async ctx=>{
  report.adapter=ctx.adapterInfo;let teacher,pbr,learner;
  try{
   teacher=new SurfaceMaterialTeacher(ctx.device,{...source,lights:[],environment:0,bounces:fit.options.bounces});
   pbr=new SurfaceMaterialTeacher(ctx.device,{...endpoint,lights:[],environment:0,bounces:1});
   learner=await createNeumipTraining(ctx.device,model,{batchSize:size*size});
   for(const [name,view,light]of [['front',[0,0],[.5,.3]],['oblique',[.75,.2],[-.5,.5]]])for(const lod of lods){
    const q=new Float32Array(size*size*8);for(let y=0;y<size;y++)for(let x=0;x<size;x++)q.set([(x+.5)/size,(y+.5)/size,...view,...light,lod,0],(y*size+x)*8);
    const capture={tileSize:w,tileDepth:d,referenceHeight:source.referenceHeight,resolution,samples,seed:fit.options.seed+2};
    const reference=await teacher.evaluateMaterial(q,capture),flat=await pbr.evaluateMaterial(q,{...capture,samples:1});learner.setQueries(q);const predicted=(await learner.evaluate()).rgb;
    const mixed=new Float32Array(predicted.length),metrics={rich:{count:0,student:0,control:0},overlap:{count:0,student:0,control:0},cheap:{count:0,student:0,control:0}},half=2**lod/resolution/2;
    let cheapFootprintsTouchingRich=0;
    for(let i=0;i<size*size;i++){
     const uv=[q[i*8],q[i*8+1]],region=stoneWindowRegion(uv,source),inner=Math.max(c.margin,c.bevel),t=Math.max(0,Math.min(1,(inner+collar-region.distance)/collar)),weight=t*t*(3-2*t),kind=region.distance<=inner?'rich':region.distance<inner+collar?'overlap':'cheap';metrics[kind].count++;
     if(kind==='cheap'&&region.distance-half*Math.max(w,d)<inner)cheapFootprintsTouchingRich++;
     for(let channel=0;channel<3;channel++){const j=i*3+channel;mixed[j]=flat[j]*(1-weight)+predicted[j]*weight;metrics[kind].student+=(predicted[j]-reference[j])**2/3;metrics[kind].control+=(mixed[j]-reference[j])**2/3;}
    }
    for(const m of Object.values(metrics))for(const k of ['student','control'])m[k]=m.count?m[k]/m.count:null;
    const tag=name+'-lod-'+String(lod).replace('.','p');
    report.images.push({name,lod,width:size,height:size,view,light,metrics,cheapFootprintsTouchingRich,queries:await raw(tag+'-queries.f32',q),source:await raw(tag+'-source.f32',reference),student:await raw(tag+'-student.f32',predicted),pbr:await raw(tag+'-pbr.f32',flat),control:await raw(tag+'-control.f32',mixed)});await publish();
   }
  }finally{learner?.dispose();teacher?.dispose();pbr?.dispose();}
 },{requiredLimits:{maxStorageBufferBindingSize:128*1024**2,maxBufferSize:256*1024**2},onEvidence:e=>report.evidence=e});
 report.phase='complete';report.status='observed';
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}
finally{await publish();console.log(JSON.stringify({status:report.status,phase:report.phase,images:report.images.length,error:report.error}));}
