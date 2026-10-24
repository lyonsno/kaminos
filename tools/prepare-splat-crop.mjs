import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {cropSurfaceField} from '../surface-field-crop.mjs';
import {reduceSurfelRows} from '../surfel-field-reduction.mjs';
import {adaptSurfaceSplats} from '../adaptive-surface-splats.mjs';
import {fitSurfaceFootprints} from '../surface-splat-footprints.mjs';
const [source,output,boundsJSON]=process.argv.slice(2);
if(!source||!output||!boundsJSON)throw Error('Usage: prepare-splat-crop.mjs SOURCE NEW_OUTPUT BOUNDS_JSON');
// A new output directory cannot alias or replace a source, including through symlinks.
fs.mkdirSync(output);const report={ok:false,phase:'load',source:path.resolve(source),variants:[]};
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const bytes=a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength);
try{
 const meta=JSON.parse(fs.readFileSync(path.join(source,'report.json')));
 const read=(file,sha,Type)=>{const b=fs.readFileSync(path.join(source,file));if(hash(b)!==sha)throw Error('Source hash mismatch: '+file);return new Type(b.buffer.slice(b.byteOffset,b.byteOffset+b.length));};
 if(!meta.ok||meta.stride!==12||!meta.triangles)throw Error('Exact source triangles required');
 const data=read('surfels.f32',meta.dataSHA256,Float32Array),indices=read(meta.triangles.file,meta.triangles.sha256,Uint32Array);
 if(data.length!==meta.count*12||indices.length!==meta.triangles.count*3)throw Error('Source count mismatch');
 report.repoRoot=execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();report.commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 report.phase='crop';const bounds=JSON.parse(boundsJSON),crop=cropSurfaceField(data,indices,bounds);
 report.sourceDataSHA256=meta.dataSHA256;report.sourceTrianglesSHA256=meta.triangles.sha256;report.bounds=bounds;
 const cropSHA=hash(bytes(crop.data)),cm={...meta,count:crop.sourceIds.length,sourceCount:crop.sourceIds.length,dataSHA256:cropSHA,crop:{bounds,policy:'whole triangles incident to inside vertices',originalCount:meta.count,sourceDataSHA256:meta.dataSHA256,sourceTrianglesSHA256:meta.triangles.sha256},regionNormalizedYUp:bounds.map(p=>p.map((v,a)=>(v-meta.bounds[0][a])/(meta.bounds[1][a]-meta.bounds[0][a])))};
 const original={data:crop.data,parent:Uint32Array.from(crop.sourceIds,(_,i)=>i),meta:cm};
 const uniform=reduceSurfelRows(crop.data,cm,2),adaptive=adaptSurfaceSplats(crop.data,cm,crop.triangles,{targetCount:uniform.meta.count});
 for(const [name,result] of [['source',original],['uniform',uniform],['adaptive',adaptive]]){
  report.phase='write-'+name;const fitted=result.footprints??fitSurfaceFootprints(crop.data,result.data,result.parent,meta.radius);
  for(const scale of [1,2/3,.5]){
   const dir=path.join(output,name+'-'+scale.toFixed(3));fs.mkdirSync(dir);
   const footprint=fitted.slice();for(let i=0;i<footprint.length;i+=8){footprint[i+3]*=scale;footprint[i+7]*=scale;}
   const m={...result.meta,ok:true,phase:'done',dataSHA256:hash(bytes(result.data)),sourceDataSHA256:cropSHA,diagnosticFootprintScale:scale};delete m.triangles;
   const write=(key,file,a,extra={})=>{const b=bytes(a);fs.writeFileSync(path.join(dir,file),b);m[key]={file,sha256:hash(b),...extra};};
   fs.writeFileSync(path.join(dir,'surfels.f32'),bytes(result.data));write('footprints','footprints.f32',footprint,{stride:8,supportSigma:3});
   write('parent','parent.u32',result.parent);
   if(result.depthTolerance)write('depthTolerance','depth-tolerance.f32',result.depthTolerance);
   if(name==='source'){write('triangles','triangles.u32',crop.triangles,{count:crop.triangles.length/3});write('sourceIds','source-ids.u32',crop.sourceIds);write('triangleIds','triangle-ids.u32',crop.triangleIds);}
   fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(m,null,2));report.variants.push({name,scale,path:dir,count:m.count,dataSHA256:m.dataSHA256,footprintSHA256:m.footprints.sha256});
  }
 }
 report.count=crop.sourceIds.length;report.triangles=crop.triangles.length/3;report.ok=true;report.phase='done';
}catch(e){report.error=String(e);process.exitCode=1;}
finally{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
