// Fractured material obstructs fluid where its surviving cells currently are.
// This is the existing coarse material occupancy, not a new triangle voxelizer.
export const BURN_REGION_SOLID_WGSL=`
struct Params {world:mat4x4f,domain:vec4f,lo:vec4f,size:vec4f,dims:vec4u}
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var material:texture_3d<f32>;
@group(0) @binding(2) var<storage,read> owners:array<u32>;
@group(0) @binding(3) var<storage,read> poses:array<mat4x4f>;
@group(0) @binding(4) var<storage,read_write> mask:array<atomic<u32>>;
fn separated(delta:vec3f,a:vec3f,b:vec3f,c:vec3f,axis:vec3f)->bool{
 let radius=abs(dot(a,axis))+abs(dot(b,axis))+abs(dot(c,axis));
 return abs(dot(delta,axis))>radius+1e-6*max(1.0,radius);
}
fn touches(delta:vec3f,a:vec3f,b:vec3f,c:vec3f)->bool{
 let basis=array<vec3f,3>(vec3f(1,0,0),vec3f(0,1,0),vec3f(0,0,1));
 let edges=array<vec3f,3>(a,b,c);
 if(separated(delta,a,b,c,cross(a,b))||separated(delta,a,b,c,cross(b,c))||separated(delta,a,b,c,cross(c,a))){return false;}
 for(var i=0u;i<3u;i++){
  if(separated(delta,a,b,c,basis[i])){return false;}
  for(var j=0u;j<3u;j++){if(separated(delta,a,b,c,cross(edges[i],basis[j]))){return false;}}
 }
 return true;
}
@compute @workgroup_size(64)
fn raster(@builtin(global_invocation_id) id:vec3u){
 let n=textureDimensions(material);let i=id.x;if(i>=n.x*n.y*n.z){return;}
 let cell=vec3u(i%n.x,(i/n.x)%n.y,i/(n.x*n.y));if(textureLoad(material,vec3i(cell),0).w<.5){return;}
 let matrix=p.world*poses[owners[i]];let pitch=p.size.xyz/vec3f(n);
 let scale=f32(p.dims.x)/(2.0*p.domain.w);
 let local=p.lo.xyz+(vec3f(cell)+vec3f(.5))*pitch;
 let center=((matrix*vec4f(local,1)).xyz-p.domain.xyz+vec3f(p.domain.w))*scale;
 let a=matrix[0].xyz*pitch.x*.5*scale;let b=matrix[1].xyz*pitch.y*.5*scale;let c=matrix[2].xyz*pitch.z*.5*scale;
 let extent=abs(a)+abs(b)+abs(c);
 let lo=max(vec3i(0),vec3i(floor(center-extent-vec3f(1e-6))));
 let hi=min(vec3i(p.dims.xyz)-vec3i(1),vec3i(floor(center+extent+vec3f(1e-6))));
 for(var z=lo.z;z<=hi.z;z++){for(var y=lo.y;y<=hi.y;y++){for(var x=lo.x;x<=hi.x;x++){
  let q=vec3i(x,y,z);if(touches(center-vec3f(q)-vec3f(.5),a,b,c)){atomicStore(&mask[u32(x)+p.dims.x*(u32(y)+p.dims.y*u32(z))],1u);}
 }}}
}`;

export function createBurnRegionSolidRaster(device,{grid,gridHeight,mask}){
 const module=device.createShaderModule({label:'Current surviving material collision',code:BURN_REGION_SOLID_WGSL});
 const pipeline=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'raster'}});
 const params=device.createBuffer({label:'Moving material collision domain',size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 let group=null,count=0,disposed=false;
 return {
  update(filter,domain){
   if(disposed)throw Error('Moving material raster is disposed');
   const r=filter?.regions;
   if(filter?.device!==device||!r?.ownerBuffer||!r.matrices||!Number.isInteger(r.count)||r.count<1||r.matrices.size<r.count*64
    ||!filter.texture?.createView||!Number.isInteger(filter.texture.width)||filter.texture.width<1
    ||!['world','lo','size'].every(k=>Array.isArray(r[k])&&r[k].length===(k==='world'?16:3)&&r[k].every(Number.isFinite))
    ||r.size.some(x=>x<=0)||!domain.translate?.every(Number.isFinite)||!(domain.scale>0))throw Error('Complete same-device moving material collision required');
   count=filter.texture.width*filter.texture.height*filter.texture.depthOrArrayLayers;
   if(r.ownerBuffer.size<count*4)throw Error('Complete moving material ownership required');
   const data=new ArrayBuffer(128),f=new Float32Array(data),u=new Uint32Array(data);
   f.set(r.world);f.set([...domain.translate,domain.scale],16);f.set(r.lo,20);f.set(r.size,24);u.set([grid,gridHeight,grid,0],28);
   group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:params}},{binding:1,resource:filter.texture.createView()},
    {binding:2,resource:{buffer:r.ownerBuffer}},{binding:3,resource:{buffer:r.matrices}},{binding:4,resource:{buffer:mask}},
   ]});device.queue.writeBuffer(params,0,data);
  },
  encode(encoder){if(disposed||!group)throw Error('Moving material collision is not bound');encoder.clearBuffer(mask);
   const pass=encoder.beginComputePass({label:'Current surviving material obstruction'});pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(count/64));pass.end();
  },
  dispose(){if(disposed)return;disposed=true;params.destroy();},
 };
}
