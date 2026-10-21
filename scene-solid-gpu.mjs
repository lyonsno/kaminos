import {sceneSolidRevision} from './volume-scene-solid.mjs';

// Local triangles are uploaded only when their geometry changes. World matrices
// deliberately do not participate in this cache: a drag updates 80 bytes/mesh.
export function createResidentSolidMeshes({upload,release}) {
  const meshes=new Map();
  return {
    update(objects,transform) {
      if(!Number.isFinite(transform.scale)||transform.scale<=0||!transform.translate?.every(Number.isFinite))throw Error('Invalid solid domain transform');
      const seen=new Set(),members=[],ids=new Set();
      for(const {id,object} of objects) {
        if(!id||ids.has(id))throw Error('Invalid scene collider object identity');ids.add(id);
        const revision=sceneSolidRevision(object,transform),draws=[];
        object.traverse(mesh=>{
          if(!mesh.isMesh)return;
          for(let p=mesh;p;p=p.parent)if(p.visible===false)return;
          if(mesh.isSkinnedMesh||mesh.morphTargetInfluences?.some(v=>v!==0))throw Error('Deformed scene collider requires evaluated geometry');
          const geometry=mesh.geometry,position=geometry?.getAttribute('position'),index=geometry?.getIndex();
          if(!position||position.count<3)throw Error('scene solid requires position triangles');
          const count=index?.count??position.count;
          if(count%3)throw Error('scene solid triangle index count is incomplete');
          const key=mesh,version=[geometry,position,position.data??position,position.version??position.data?.version??0,index,index?.version??0,count];
          let cached=meshes.get(key);
          if(!cached||version.some((v,i)=>v!==cached.version[i])) {
            const triangles=new Float32Array(count*4);
            for(let i=0;i<count;i++) {
              const vertex=index?index.getX(i):i;
              if(!Number.isInteger(vertex)||vertex<0||vertex>=position.count)throw Error('scene solid triangle index out of range');
              const xyz=[position.getX(vertex),position.getY(vertex),position.getZ(vertex)];
              if(!xyz.every(Number.isFinite))throw Error('scene solid has nonfinite position');
              triangles.set([...xyz,1],i*4);
            }
            const resource=upload(triangles);if(cached)release(cached.resource);
            cached={version,resource,triangleCount:count/3};meshes.set(key,cached);
          }
          const matrix=Array.from(mesh.matrixWorld.elements);
          if(!matrix.every(Number.isFinite)||matrix[3]!==0||matrix[7]!==0||matrix[11]!==0||matrix[15]!==1)throw Error('scene solid requires finite affine transform');
          seen.add(key);draws.push({...cached,matrix});
        });
        if(!draws.length)throw Error('scene solid has no visible triangles');
        members.push({id,revision,draws,triangleCount:draws.reduce((n,d)=>n+d.triangleCount,0)});
      }
      for(const [key,cached] of meshes)if(!seen.has(key)){release(cached.resource);meshes.delete(key);}
      return members;
    },
    destroy(){for(const c of meshes.values())release(c.resource);meshes.clear();}
  };
}

export const SCENE_SOLID_GPU_WGSL=/* wgsl */`
struct Params { matrix:mat4x4<f32>, domain:vec4<f32>, dims:vec4<u32> }
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var<storage,read> triangles:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read_write> shell:array<atomic<u32>>;
@group(0) @binding(3) var<storage,read_write> parent:array<atomic<u32>>;
@group(0) @binding(4) var<storage,read_write> mask:array<atomic<u32>>;
@group(0) @binding(5) var<storage,read_write> combined:array<atomic<u32>>;
@group(0) @binding(6) var output:texture_storage_3d<r32uint,write>;
@group(0) @binding(7) var<storage,read> support:array<u32>;
@group(0) @binding(8) var<storage,read_write> stats:array<atomic<u32>>;
struct MaterialMask {worldToMaterial:mat4x4<f32>,enabled:vec4<u32>}
@group(0) @binding(9) var materialState:texture_3d<f32>;
@group(0) @binding(10) var<uniform> material:MaterialMask;
fn indexOf(c:vec3<u32>)->u32{return c.x+p.dims.x*(c.y+p.dims.y*c.z);}
fn coord(i:u32)->vec3<u32>{return vec3<u32>(i%p.dims.x,(i/p.dims.x)%p.dims.y,i/(p.dims.x*p.dims.y));}
fn count()->u32{return p.dims.x*p.dims.y*p.dims.z;}
fn point(v:vec4<f32>)->vec3<f32>{return (((p.matrix*v).xyz-p.domain.xyz)/p.domain.w+vec3<f32>(1))*f32(p.dims.x)*0.5;}
fn separated(a:vec3<f32>,b:vec3<f32>,c:vec3<f32>,axis:vec3<f32>)->bool{
 let r=0.5*dot(abs(axis),vec3<f32>(1));let d=vec3<f32>(dot(a,axis),dot(b,axis),dot(c,axis));
 let epsilon=1e-6*max(1.0,r);
 return min(min(d.x,d.y),d.z)>r+epsilon||max(max(d.x,d.y),d.z)< -r-epsilon;
}
fn touches(a0:vec3<f32>,b0:vec3<f32>,c0:vec3<f32>,cell:vec3<i32>)->bool{
 let center=vec3<f32>(cell)+vec3<f32>(0.5);let a=a0-center;let b=b0-center;let c=c0-center;
 let edges=array<vec3<f32>,3>(b-a,c-b,a-c);
 if(separated(a,b,c,vec3<f32>(1,0,0))||separated(a,b,c,vec3<f32>(0,1,0))||separated(a,b,c,vec3<f32>(0,0,1))||separated(a,b,c,cross(edges[0],edges[1]))){return false;}
 for(var e=0u;e<3u;e++){
  let v=edges[e];if(separated(a,b,c,vec3<f32>(0,-v.z,v.y))||separated(a,b,c,vec3<f32>(v.z,0,-v.x))||separated(a,b,c,vec3<f32>(-v.y,v.x,0))){return false;}
 }return true;
}
@compute @workgroup_size(64) fn raster(@builtin(global_invocation_id) gid:vec3<u32>){
 let t=gid.x;if(t>=p.dims.w){return;}let a=point(triangles[t*3u]);let b=point(triangles[t*3u+1u]);let c=point(triangles[t*3u+2u]);
 let lo=max(vec3<i32>(0),vec3<i32>(floor(min(a,min(b,c))-vec3<f32>(1e-7))));
 let hi=min(vec3<i32>(p.dims.xyz)-vec3<i32>(1),vec3<i32>(floor(max(a,max(b,c))+vec3<f32>(1e-7))));
 for(var z=lo.z;z<=hi.z;z++){for(var y=lo.y;y<=hi.y;y++){for(var x=lo.x;x<=hi.x;x++){
  let cell=vec3<i32>(x,y,z);if(touches(a,b,c,cell)){atomicStore(&shell[indexOf(vec3<u32>(cell))],1u);}
 }}}
}
@compute @workgroup_size(64) fn init(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=count()){return;}let c=coord(i);var root=i+1u;
 if(any(c==vec3<u32>(0))||any(c==p.dims.xyz-vec3<u32>(1))){root=0u;}
 if(atomicLoad(&shell[i])!=0u){root=0xffffffffu;}
 atomicStore(&parent[i+1u],root);if(i==0u){atomicStore(&parent[0],0u);}
}
fn rootOf(start:u32)->u32{
 var r=start;loop{let next=atomicLoad(&parent[r]);if(next==r){return r;}
  let grand=atomicLoad(&parent[next]);atomicMin(&parent[r],grand);r=next;
 }
}
fn join(a:u32,b:u32){
 var x=a;var y=b;loop{x=rootOf(x);y=rootOf(y);if(x==y){return;}
  let high=max(x,y);let low=min(x,y);let old=atomicMin(&parent[high],low);
  if(old==high){return;}x=old;y=low;
 }
}
@compute @workgroup_size(64) fn connect(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=count()||atomicLoad(&shell[i])!=0u){return;}let c=coord(i);
 if(c.x>0u&&atomicLoad(&shell[i-1u])==0u){join(i+1u,i);}
 if(c.y>0u&&atomicLoad(&shell[i-p.dims.x])==0u){join(i+1u,i-p.dims.x+1u);}
 let plane=p.dims.x*p.dims.y;if(c.z>0u&&atomicLoad(&shell[i-plane])==0u){join(i+1u,i-plane+1u);}
}
@compute @workgroup_size(64) fn fill(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=count()){return;}var solid=atomicLoad(&shell[i]);
 if(solid==0u&&rootOf(i+1u)!=0u){solid=1u;}atomicStore(&mask[i],solid);
}
@compute @workgroup_size(64) fn merge(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=count()){return;}
 if(material.enabled.x!=0u){
  let world=(vec3<f32>(coord(i))+vec3<f32>(0.5))*2.0*p.domain.w/f32(p.dims.x)-vec3<f32>(p.domain.w)+p.domain.xyz;
  let uv=(material.worldToMaterial*vec4<f32>(world,1)).xyz;
  let dims=textureDimensions(materialState);
  let cell=clamp(vec3<i32>(floor(uv*vec3<f32>(dims))),vec3<i32>(0),vec3<i32>(dims)-vec3<i32>(1));
  if(textureLoad(materialState,cell,0).w<0.5){return;}
 }
 atomicOr(&combined[i],atomicLoad(&mask[i]));
}
@compute @workgroup_size(64) fn present(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i<count()){
  let valid=atomicLoad(&stats[0])>0u&&(atomicLoad(&stats[2])==0u||atomicLoad(&stats[3])>0u);
  textureStore(output,vec3<i32>(coord(i)),vec4<u32>(select(0u,atomicLoad(&combined[i]),valid),0,0,0));
 }
}
@compute @workgroup_size(64) fn measure(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=count()){return;}let solid=atomicLoad(&combined[i]);let c=coord(i);
 if(support[i]!=0u){atomicAdd(&stats[2],1u);if(solid==0u){atomicAdd(&stats[3],1u);}}
 if(solid==0u){return;}atomicAdd(&stats[0],1u);var faces=0u;let plane=p.dims.x*p.dims.y;
 if(c.x>0u&&atomicLoad(&combined[i-1u])==0u){faces++;}if(c.x+1u<p.dims.x&&atomicLoad(&combined[i+1u])==0u){faces++;}
 if(c.y>0u&&atomicLoad(&combined[i-p.dims.x])==0u){faces++;}if(c.y+1u<p.dims.y&&atomicLoad(&combined[i+p.dims.x])==0u){faces++;}
 if(c.z>0u&&atomicLoad(&combined[i-plane])==0u){faces++;}if(c.z+1u<p.dims.z&&atomicLoad(&combined[i+plane])==0u){faces++;}
 atomicAdd(&stats[1],faces);
}
`;

export function createGpuSceneSolidProducer(device,{grid,gridHeight=grid}) {
  const dims=[grid,gridHeight,grid],cells=grid*gridHeight*grid,bytes=cells*4;
  const buffer=(label,size,extra=0)=>device.createBuffer({label,size:Math.max(16,size),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|extra});
  const texture=device.createTexture({label:'GPU resident scene solid',size:dims,dimension:'3d',format:'r32uint',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
  const view=texture.createView(),combined=buffer('scene solid union',bytes,GPUBufferUsage.COPY_SRC),dummy=buffer('scene solid unused triangles',48);
  const support=buffer('scene solid source support',bytes),stats=buffer('scene solid validation',32,GPUBufferUsage.COPY_SRC);
  const noMaterial=device.createTexture({label:'unfiltered scene solid material',size:[1,1,1],dimension:'3d',format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING});
  device.queue.writeBuffer(support,0,new Uint32Array(cells));
  const meshCache=createResidentSolidMeshes({upload(data){const b=buffer('resident scene solid local triangles',data.byteLength);device.queue.writeBuffer(b,0,data);return b;},release:b=>b.destroy()});
  const module=device.createShaderModule({label:'GPU scene solid conservative raster and exterior connectivity',code:SCENE_SOLID_GPU_WGSL});
  const layout=device.createBindGroupLayout({entries:[
    {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},
    {binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
    ...[2,3,4,5].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}})),
    {binding:6,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:'write-only',format:'r32uint',viewDimension:'3d'}},
    {binding:7,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
    {binding:8,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
    {binding:9,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'float',viewDimension:'3d'}},
    {binding:10,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}}
  ]});
  const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
  const pipelines=Object.fromEntries(['raster','init','connect','fill','merge','measure','present'].map(entryPoint=>[entryPoint,device.createComputePipeline({label:'scene solid '+entryPoint,layout:pipelineLayout,compute:{module,entryPoint}})]));
  const objects=new Map();let pending=false,key='',builds=0,current=null,wallKey='',one;
  function makeGroup(member,triangles=dummy,triangleCount=0,matrix=null,materialMask=null){
    const uniform=device.createBuffer({label:'scene solid transform',size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const values=new ArrayBuffer(96),floats=new Float32Array(values),uints=new Uint32Array(values);
    floats.set(matrix??[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
    uints.set([...dims,triangleCount],20);
    const materialUniform=device.createBuffer({label:'scene solid remaining material',size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const group=device.createBindGroup({layout,entries:[{binding:0,resource:{buffer:uniform}},{binding:1,resource:{buffer:triangles}},
      {binding:2,resource:{buffer:member.shell}},{binding:3,resource:{buffer:member.parent}},{binding:4,resource:{buffer:member.mask}},
      {binding:5,resource:{buffer:combined}},{binding:6,resource:view},{binding:7,resource:{buffer:support}},{binding:8,resource:{buffer:stats}},
      {binding:9,resource:(materialMask?.texture??noMaterial).createView()},{binding:10,resource:{buffer:materialUniform}}]});
    return {uniform,materialUniform,values,floats,group};
  }
  function dispatch(encoder,name,group,n){const pass=encoder.beginComputePass({label:'scene solid '+name});pass.setPipeline(pipelines[name]);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(n/64));pass.end();}
  function destroyGroup(g){g.uniform.destroy();g.materialUniform.destroy();}
  function destroyMember(m){m.shell.destroy();m.parent.destroy();m.mask.destroy();destroyGroup(m.base);for(const d of m.draws)destroyGroup(d);}
  return {
    backend:'gpu',texture,view,
    setSourceSupport(values){if(!(values instanceof Uint32Array)||values.length!==cells)throw Error('Invalid GPU source support');device.queue.writeBuffer(support,0,values);pending=true;},
    update(input,transform,shape,{wallCells=[],materialMasks=[]}={}){
      if(shape.grid!==grid||shape.gridHeight!==gridHeight)throw Error('GPU scene solid shape mismatch');
      const members=meshCache.update(input,transform),seen=new Set();builds=0;
      for(const member of members){
        seen.add(member.id);let m=objects.get(member.id);
        if(!m){m={shell:buffer('scene solid shell',bytes),parent:buffer('scene solid components',bytes+4),mask:buffer('scene solid object mask',bytes,GPUBufferUsage.COPY_SRC),draws:[]};m.base=makeGroup(m);objects.set(member.id,m);}
        const filter=materialMasks.find(mask=>mask.objectId===member.id);
        if(filter&&(filter.device!==device||!filter.texture?.createView||!Array.isArray(filter.matrix)||filter.matrix.length!==16||!filter.matrix.every(Number.isFinite)))throw Error('Invalid same-device remaining material mask');
        if(m.materialTexture!==(filter?.texture??null)){
          destroyGroup(m.base);m.base=makeGroup(m,dummy,0,null,filter);m.materialTexture=filter?.texture??null;pending=true;
        }
        if(filter){const data=new ArrayBuffer(80);new Float32Array(data).set(filter.matrix);new Uint32Array(data)[16]=1;device.queue.writeBuffer(m.base.materialUniform,0,data);}
        const materialRevision=filter?.revision??null;if(m.materialRevision!==materialRevision){m.materialRevision=materialRevision;pending=true;}
        m.base.floats.set([...transform.translate,transform.scale],16);device.queue.writeBuffer(m.base.uniform,0,m.base.values);
        if(m.revision===member.revision)continue;
        for(const d of m.draws)destroyGroup(d);m.draws=[];
        for(const draw of member.draws){const d=makeGroup(m,draw.resource,draw.triangleCount,draw.matrix);d.floats.set([...transform.translate,transform.scale],16);device.queue.writeBuffer(d.uniform,0,d.values);m.draws.push({...d,triangleCount:draw.triangleCount});}
        m.base.floats.set([...transform.translate,transform.scale],16);device.queue.writeBuffer(m.base.uniform,0,m.base.values);
        m.revision=member.revision;m.dirty=true;pending=true;builds++;
      }
      for(const [id,m] of objects)if(!seen.has(id)){destroyMember(m);objects.delete(id);pending=true;}
      const nextWallKey=JSON.stringify(wallCells);if(nextWallKey!==wallKey){wallKey=nextWallKey;pending=true;}
      key=JSON.stringify(members.map(m=>[m.id,m.revision,objects.get(m.id).materialRevision]));
      current={backend:'gpu',key,revision:key,builds,triangleCount:members.reduce((n,m)=>n+m.triangleCount,0),members:members.map(m=>({id:m.id,triangleCount:m.triangleCount})),wallCells};
      return current;
    },
    encode(encoder){
      if(!pending)return false;
      encoder.clearBuffer(combined);
      // Sparse authored walls are cheap host inputs, not mesh voxelization.
      for(const cell of current.wallCells){const i=cell.x+grid*(cell.y+gridHeight*cell.z);encoder.copyBufferToBuffer(wallOne(),0,combined,i*4,4);}
      for(const m of objects.values()){
        if(m.dirty){encoder.clearBuffer(m.shell);for(const d of m.draws)dispatch(encoder,'raster',d.group,d.triangleCount);
          for(const phase of ['init','connect','fill'])dispatch(encoder,phase,m.base.group,cells);m.dirty=false;}
        dispatch(encoder,'merge',m.base.group,cells);
      }
      encoder.clearBuffer(stats);
      const first=objects.values().next().value;if(first){dispatch(encoder,'measure',first.base.group,cells);dispatch(encoder,'present',first.base.group,cells);}
      pending=false;return true;
    },
    async snapshot(){
      const members=[...objects.entries()],revision=key;
      const staging=device.createBuffer({label:'explicit scene solid diagnostic snapshot',size:bytes*(members.length+1)+32,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      try{const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(combined,0,staging,0,bytes);
        members.forEach(([,m],i)=>encoder.copyBufferToBuffer(m.mask,0,staging,bytes*(i+1),bytes));
        encoder.copyBufferToBuffer(stats,0,staging,bytes*(members.length+1),32);
        device.queue.submit([encoder.finish()]);await staging.mapAsync(GPUMapMode.READ);
        const values=new Uint32Array(staging.getMappedRange()),counts=Array.from(values.subarray(cells*(members.length+1))),valid=counts[0]>0&&(counts[2]===0||counts[3]>0);
        const installed=Uint8Array.from(values.subarray(0,cells));if(!valid)installed.fill(0);
        return {cells:installed,revision,dimensions:dims,backend:'gpu',counts,valid,
          members:members.map(([id],i)=>({id,solidCellCount:values.subarray(cells*(i+1),cells*(i+2)).reduce((a,b)=>a+b,0)}))};
      }finally{staging.unmap();staging.destroy();}
    },
    destroy(){meshCache.destroy();for(const m of objects.values())destroyMember(m);objects.clear();combined.destroy();dummy.destroy();support.destroy();stats.destroy();one?.destroy();noMaterial.destroy();texture.destroy();}
  };
  function wallOne(){if(!one){one=buffer('scene solid wall value',16,GPUBufferUsage.COPY_SRC);device.queue.writeBuffer(one,0,new Uint32Array([1]));}return one;}
}
