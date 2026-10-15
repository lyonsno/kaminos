import {StorageBufferAttribute} from '../../lib/three.webgpu.js';
import {storage,Fn,wgslFn,instanceIndex,uint} from '../../lib/three.tsl.js';
import {transportDualQuaternions} from '../../hindquarter-live-core.mjs';
import {prepareGpuSkin} from './gpu-skin-data.mjs';

const deform=wgslFn(`fn dense_dq(v:u32, channels:u32,
 rest:ptr<storage,array<f32>,read>, weights:ptr<storage,array<f32>,read>, dominant:ptr<storage,array<u32>,read>,
 palette:ptr<storage,array<vec4<f32>>,read>, positions:ptr<storage,array<f32>,read_write>) -> void {
 let anchor=(*palette)[(*dominant)[v]*2u];
 var r=vec4<f32>(0.0);var d=vec4<f32>(0.0);
 for(var j=0u;j<channels;j++){
  var w=(*weights)[v*channels+j];
  if(w==0.0){continue;}
  let q=(*palette)[j*2u];if(dot(q,anchor)<0.0){w=-w;}
  r+=w*q;d+=w*(*palette)[j*2u+1u];
 }
 let magnitude=length(r);r/=magnitude;d/=magnitude;d-=r*dot(r,d);
 let p=vec3<f32>((*rest)[v*3u],(*rest)[v*3u+1u],(*rest)[v*3u+2u]);
 let t=2.0*cross(r.yzw,p);
 let translation=2.0*(-d.x*r.yzw+r.x*d.yzw-cross(d.yzw,r.yzw));
 let out=p+r.x*t+cross(r.yzw,t)+translation;
 (*positions)[v*3u]=out.x;(*positions)[v*3u+1u]=out.y;(*positions)[v*3u+2u]=out.z;
}`);
const normals=wgslFn(`fn dense_normals(v:u32,
 positions:ptr<storage,array<f32>,read_write>, triangles:ptr<storage,array<u32>,read>,
 offsets:ptr<storage,array<u32>,read>, faces:ptr<storage,array<u32>,read>, output:ptr<storage,array<f32>,read_write>) -> void {
 var sum=vec3<f32>(0.0);
 for(var k=(*offsets)[v];k<(*offsets)[v+1u];k++){
  let f=(*faces)[k]*3u;let a=(*triangles)[f]*3u;let b=(*triangles)[f+1u]*3u;let c=(*triangles)[f+2u]*3u;
  let pa=vec3<f32>((*positions)[a],(*positions)[a+1u],(*positions)[a+2u]);
  let pb=vec3<f32>((*positions)[b],(*positions)[b+1u],(*positions)[b+2u]);
  let pc=vec3<f32>((*positions)[c],(*positions)[c+1u],(*positions)[c+2u]);
  sum+=cross(pc-pb,pa-pb);
 }
 let magnitude=length(sum);if(magnitude>0.0){sum/=magnitude;}
 (*output)[v*3u]=sum.x;(*output)[v*3u+1u]=sum.y;(*output)[v*3u+2u]=sum.z;
}`);

// Uses the renderer supplied by the actual object's draw, never a second device,
// renderer or animation loop. The output buffers are also its vertex attributes.
export function createGpuSkinDeformer({geometry,rest,triangles,weights,channels}){
 const payload=prepareGpuSkin({rest,triangles,weights,channels});
 const attributes=[],computes=[];
 const input=(array,type)=>{const attr=new StorageBufferAttribute(array,1);attributes.push(attr);return storage(attr,type,array.length).toReadOnly();};
 const restNode=input(payload.rest,'float'),weightNode=input(payload.weights,'float'),dominant=input(payload.dominant,'uint');
 const triangleNode=input(payload.triangles,'uint'),offsets=input(payload.offsets,'uint'),faces=input(payload.faces,'uint');
 const paletteAttribute=new StorageBufferAttribute(new Float32Array(channels*8),4);attributes.push(paletteAttribute);
 const palette=storage(paletteAttribute,'vec4',channels*2).toReadOnly();
 const positionAttribute=new StorageBufferAttribute(rest.slice(),3),normalAttribute=new StorageBufferAttribute(geometry.attributes.normal.array.slice(),3);
 const positions=storage(positionAttribute,'float',rest.length),normalOutput=storage(normalAttribute,'float',rest.length);
 geometry.setAttribute('position',positionAttribute);geometry.setAttribute('normal',normalAttribute);
 computes.push(Fn(()=>deform({v:instanceIndex,channels:uint(channels),rest:restNode,weights:weightNode,dominant,palette,positions}).append())().compute(payload.vertices));
 computes.push(Fn(()=>normals({v:instanceIndex,positions,triangles:triangleNode,offsets,faces,output:normalOutput}).append())().compute(payload.vertices));
 let pending=true,disposed=false,dispatches=0,renderer=null;
 return {
  update(matrices){
   if(disposed)throw Error('GPU skin is disposed');
   const {real,dual}=transportDualQuaternions(matrices);
   if(real.length!==channels)throw Error('GPU palette channel count differs');
   for(let j=0;j<channels;j++){paletteAttribute.array.set(real[j],j*8);paletteAttribute.array.set(dual[j],j*8+4);}
   paletteAttribute.needsUpdate=true;pending=true;
  },
  flush(actualRenderer){
   if(disposed)throw Error('GPU skin is disposed');
   if(!actualRenderer?.backend?.isWebGPUBackend)throw Error('Dense GPU skin requires the actual WebGPU renderer; no CPU/WebGL fallback');
   if(renderer&&renderer!==actualRenderer)throw Error('GPU skin renderer changed');renderer=actualRenderer;
   if(pending){actualRenderer.compute(computes);pending=false;dispatches++;}
  },
  async readback(){
   if(!renderer)throw Error('GPU skin has not been rendered');this.flush(renderer);
   const [p,n]=await Promise.all([renderer.getArrayBufferAsync(positionAttribute),renderer.getArrayBufferAsync(normalAttribute)]);
   return {positions:new Float32Array(p),normals:new Float32Array(n),backend:'webgpu-dense-dq',dispatches};
  },
  read:()=>({backend:'webgpu-dense-dq',dispatches,pending,paletteBytes:paletteAttribute.array.byteLength,poseCacheBytes:0,allInfluences:true}),
  dispose(){if(disposed)return;disposed=true;for(const node of computes)node.dispose();/* geometry owns the two output attributes */
   if(renderer)for(const attr of attributes)renderer.backend.destroyAttribute(attr);
  },
 };
}
