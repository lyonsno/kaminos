import {validateSceneSourceTransform} from './scene-volume-source.mjs';
// Transform immutable mesh-local trees (or a legacy world tree) into source
// coordinates. Motion changes only matrices, never CPU triangle data/topology.
export function createBvhReproject(device,{geometry,nodes,triangles}) {
  const coverages=()=>geometry.coverages??(geometry.coverage?[{...geometry.coverage,triangleStart:0,triangleCount:geometry.triangleCount}]:[]);
  for(const coverage of coverages())if(coverage.device!==device)throw Error('Resident light coverage must use the lighting device');
  const owned=[];
  const upload=(data)=>{const b=device.createBuffer({size:Math.max(16,data.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(b,0,data);owned.push(b);return b;};
  const worldNodes=upload(geometry.nodes),worldTriangles=upload(geometry.triangles);
  const owners=upload(geometry.owners??new Uint32Array(Math.max(1,geometry.nodeCount+geometry.triangleCount)));
  const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  const matrices=upload(geometry.matrices??identity);
  const params=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});owned.push(params);
  const limit=device.limits.maxComputeWorkgroupsPerDimension;
  const module=device.createShaderModule({label:'world BVH to moving source coordinates',code:`
struct Node {lo:vec4<f32>,hi:vec4<f32>,range:vec4<u32>}
struct Triangle {a:vec4<f32>,e1:vec4<f32>,e2:vec4<f32>}
@group(0) @binding(0) var<storage,read> worldNodes:array<Node>;
@group(0) @binding(1) var<storage,read> worldTriangles:array<Triangle>;
@group(0) @binding(2) var<storage,read_write> localNodes:array<Node>;
@group(0) @binding(3) var<storage,read_write> localTriangles:array<Triangle>;
@group(0) @binding(4) var<uniform> transform:vec4<f32>;
@group(0) @binding(5) var<storage,read> owners:array<u32>;
@group(0) @binding(6) var<storage,read> matrices:array<mat4x4<f32>>;
@compute @workgroup_size(64)
fn reproject(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x+gid.y*${limit*64}u;
 if(i<${geometry.nodeCount}u){
  let n=worldNodes[i];let m=matrices[owners[i]];let center=(m*vec4<f32>((n.lo.xyz+n.hi.xyz)*0.5,1.0)).xyz;
  let half=(n.hi.xyz-n.lo.xyz)*0.5;let extent=abs(m[0].xyz)*half.x+abs(m[1].xyz)*half.y+abs(m[2].xyz)*half.z;
  localNodes[i]=Node(vec4<f32>((center-extent-transform.xyz)/transform.w,n.lo.w),vec4<f32>((center+extent-transform.xyz)/transform.w,n.hi.w),n.range);
 }
 if(i<${geometry.triangleCount}u){
  let t=worldTriangles[i];let m=matrices[owners[${geometry.nodeCount}u+i]];
  localTriangles[i]=Triangle(vec4<f32>(((m*vec4<f32>(t.a.xyz,1.0)).xyz-transform.xyz)/transform.w,t.a.w),vec4<f32>((m*vec4<f32>(t.e1.xyz,0.0)).xyz/transform.w,t.e1.w),vec4<f32>((m*vec4<f32>(t.e2.xyz,0.0)).xyz/transform.w,t.e2.w));
 }
}`});
  const pipeline=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'reproject'}});
  const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[worldNodes,worldTriangles,nodes,triangles,params,owners,matrices].map((buffer,binding)=>({binding,resource:{buffer}}))});
  // Each range visits only its own triangles. Separate bindings avoid a fixed
  // texture-slot limit without gathering material state back to the CPU.
  const masks=[];
  if(coverages().length){
    const maskModule=device.createShaderModule({label:'resident material visibility',code:`
struct Triangle {a:vec4<f32>,e1:vec4<f32>,e2:vec4<f32>}
@group(0) @binding(0) var<storage,read_write> triangles:array<Triangle>;
@group(0) @binding(1) var remaining:texture_3d<f32>;
@group(0) @binding(2) var<uniform> range:vec4<u32>;
@compute @workgroup_size(64)
fn mask(@builtin(global_invocation_id) gid:vec3<u32>){
 let offset=gid.x+gid.y*${limit*64}u;if(offset>=range.y){return;}
 let i=range.x+offset;let tag=triangles[i].a.w;if(tag<=0.0){return;}
 let cell=u32(tag)-1u;let n=textureDimensions(remaining).x;
 let c=vec3<i32>(i32(cell%n),i32((cell/n)%n),i32(cell/(n*n)));
 if(textureLoad(remaining,c,0).w<0.5){triangles[i].e1=vec4<f32>(0.0);triangles[i].e2=vec4<f32>(0.0);}
}`});
    const maskPipeline=device.createComputePipeline({layout:'auto',compute:{module:maskModule,entryPoint:'mask'}});
    for(const c of coverages()){
      const range=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});owned.push(range);
      device.queue.writeBuffer(range,0,new Uint32Array([c.triangleStart,c.triangleCount,0,0]));
      const group=device.createBindGroup({layout:maskPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:triangles}},{binding:1,resource:c.texture.createView()},{binding:2,resource:{buffer:range}}]});
      masks.push({pipeline:maskPipeline,group,count:c.triangleCount});
    }
  }
  let key=null,pending=null;
  return {encode(encoder,value,meshMatrices=geometry.matrices??identity){
    pending=null; // A skipped/reverted retry must not commit an abandoned pose.
    if(meshMatrices.length!==(geometry.matrices??identity).length||!meshMatrices.every(Number.isFinite))throw Error('BVH matrix upload shape or values invalid');
    const t=validateSceneSourceTransform(value),next=JSON.stringify([t,Array.from(meshMatrices),coverages().map(c=>c.revision)]);if(next===key)return false;
    const groups=Math.ceil(Math.max(geometry.nodeCount,geometry.triangleCount)/64);
    if(groups>limit*limit)throw new Error('BVH reproject exceeds device dispatch capacity');
    device.queue.writeBuffer(params,0,new Float32Array([...t.translate,t.scale]));
    device.queue.writeBuffer(matrices,0,meshMatrices);
    if(groups){const pass=encoder.beginComputePass({label:'reproject world BVH without CPU rebuild'});pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.min(groups,limit),Math.ceil(groups/limit));pass.end();}
    for(const mask of masks){const groups=Math.ceil(mask.count/64);if(!groups)continue;const pass=encoder.beginComputePass({label:'apply resident material visibility'});pass.setPipeline(mask.pipeline);pass.setBindGroup(0,mask.group);pass.dispatchWorkgroups(Math.min(groups,limit),Math.ceil(groups/limit));pass.end();}
    pending=next;return true;
  },commit(){if(pending!==null)key=pending;pending=null;},destroy(){for(const b of owned)b.destroy();}};
}
