import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fitSurfaceFootprints} from '../surface-splat-footprints.mjs';

const [source,reduced,output,mesh,...extra]=process.argv.slice(2);
if(!source||!reduced||!output||extra.length)throw Error('Usage: prepare-boundary-splats.mjs SOURCE_DIR REDUCED_DIR NEW_OUTPUT_DIR [PAIRED_MESH_GLB]');
// Never replace a source or a previous experiment, including via a symlink.
fs.mkdirSync(output);
const report={ok:false,phase:'source',source:path.resolve(source),reduced:path.resolve(reduced)};
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=(root,file,sha)=>{const b=fs.readFileSync(path.join(root,file));if(hash(b)!==sha)throw Error('Source hash mismatch: '+file);return b;};
const floats=b=>new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.length));
try{
 const meta=JSON.parse(fs.readFileSync(path.join(source,'report.json'))),level=JSON.parse(fs.readFileSync(path.join(reduced,'report.json')));
 if(!meta.ok||!level.ok||!meta.triangles||meta.stride!==12||level.stride!==12||level.sourceDataSHA256!==meta.dataSHA256||level.sourceCount!==meta.count)throw Error('Reduced field does not belong to source');
 const raw=read(source,'surfels.f32',meta.dataSHA256),indices=read(source,meta.triangles.file,meta.triangles.sha256);
 const data=read(reduced,'surfels.f32',level.dataSHA256),parents=read(reduced,'parent.u32',level.parentSHA256),previous=read(reduced,level.footprints.file,level.footprints.sha256);
 if(raw.length!==meta.count*12*4||data.length!==level.count*12*4||parents.length!==meta.count*4||indices.length!==meta.triangles.count*3*4||previous.length!==level.count*8*4)throw Error('Field shape mismatch');
 const src=floats(raw),dst=floats(data),parent=new Uint32Array(parents.buffer.slice(parents.byteOffset,parents.byteOffset+parents.length)),triangles=new Uint32Array(indices.buffer.slice(indices.byteOffset,indices.byteOffset+indices.length));
 report.phase='baseline';
 const baseline=fitSurfaceFootprints(src,dst,parent,meta.radius);
 if(!Buffer.from(baseline.buffer).equals(previous))throw Error('Existing footprints differ from point-covariance baseline');
 let boundaryVertices,pairedMesh;
 if(mesh){
  report.phase='paired-mesh';
  const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js'),{Vector3}=await import('three');
  const payload=fs.readFileSync(mesh),asset=await new GLTFLoader().parseAsync(payload.buffer.slice(payload.byteOffset,payload.byteOffset+payload.length),'');
  const positions=new Set(),p=new Vector3(),key=(x,y,z)=>[Math.fround(x),Math.fround(y),Math.fround(z)].join(',');asset.scene.updateMatrixWorld(true);
  asset.scene.traverse(object=>{if(object.isMesh){const a=object.geometry.attributes.position;for(let i=0;i<a.count;i++){p.fromBufferAttribute(a,i).applyMatrix4(object.matrixWorld);positions.add(key(p.x,p.y,p.z));}}});
  boundaryVertices=Uint8Array.from({length:meta.count},(_,i)=>Number(positions.has(key(src[i*12],src[i*12+1],src[i*12+2]))));
  const sharedVertices=boundaryVertices.reduce((n,v)=>n+v,0);if(!sharedVertices)throw Error('Paired mesh shares no source vertices');
  pairedMesh={path:path.resolve(mesh),sha256:hash(payload),sharedVertices};
 }
 report.phase='fit';
 const fitted=fitSurfaceFootprints(src,dst,parent,meta.radius,triangles,{boundaryOnly:true,boundaryVertices}),footprints=Buffer.from(fitted.buffer);
 if(!fitted.every(Number.isFinite))throw Error('Nonfinite fitted footprint');
 let changed=0;for(let i=0;i<level.count;i++)if(!footprints.subarray(i*32,(i+1)*32).equals(previous.subarray(i*32,(i+1)*32)))changed++;
 report.phase='write';
 fs.writeFileSync(path.join(output,'surfels.f32'),data);fs.writeFileSync(path.join(output,'parent.u32'),parents);fs.writeFileSync(path.join(output,'footprints.f32'),footprints);
 if(level.depthTolerance)fs.writeFileSync(path.join(output,level.depthTolerance.file),read(reduced,level.depthTolerance.file,level.depthTolerance.sha256));
 const next={...level,footprintFit:mesh?'shared-boundary-triangle-dual-cell':'boundary-triangle-dual-cell',footprints:{...level.footprints,sha256:hash(footprints)},boundaryFit:{sourceTrianglesSHA256:meta.triangles.sha256,previousFootprintsSHA256:hash(previous),changedGroups:changed,unchangedGroups:level.count-changed,...(pairedMesh?{pairedMesh}:{})}};
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(next,null,2));
 Object.assign(report,{ok:true,phase:'done',count:level.count,dataSHA256:hash(data),footprintsSHA256:hash(footprints),...next.boundaryFit});
}catch(error){report.error=String(error);process.exitCode=1;}
finally{fs.writeFileSync(path.join(output,'conversion.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
