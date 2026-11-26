import {PARTICLE_LIGHT_MATERIAL_WGSL} from './volume-optical-particles.mjs';
import {PARTICLE_KERNEL_WGSL,PARTICLE_STATE_WGSL} from './volume-particle-state.mjs';
import {createPacketCandidates, PACKET_BUNDLE_STRUCT_WGSL} from './volume-packet-candidates.mjs';
import {createFixedExtinctionGrid} from './volume-packet-extinction-grid.mjs';

const vector=(v,n,name)=>{if(!Array.isArray(v)||v.length!==n||v.some(x=>!Number.isFinite(x)||!Number.isFinite(Math.fround(x))))throw Error('Invalid bundle '+name);return [...v];};
const count=(v,name)=>{if(!Number.isSafeInteger(v)||v<1||v>0xffffffff)throw Error('Invalid bundle '+name);return v;};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function finitePacketBundle({origin,target,halfSize,near=0,far,weight,receiver=0,source=0xffffffff,sourceSlot=0xffffffff}){
 origin=vector(origin,3,'origin');target=vector(target,3,'target');halfSize=vector(halfSize,2,'footprint');
 const delta=target.map((x,i)=>x-origin[i]),distance=Math.hypot(...delta);
 if(!(distance>0&&Number.isFinite(distance)))throw Error('Invalid bundle direction');
 if(!(near>=0&&far>near&&Number.isFinite(Math.fround(far))))throw Error('Invalid bundle endpoints');
 if(halfSize.some(x=>x<=0)||!(weight>=0&&Number.isFinite(Math.fround(weight))))throw Error('Invalid bundle footprint or weight');
 for(const x of [receiver,source,sourceSlot])if(!Number.isSafeInteger(x)||x<0||x>0xffffffff)throw Error('Invalid bundle membership');
 const forward=delta.map(x=>x/distance),seed=Math.abs(forward[1])<.9?[0,1,0]:[1,0,0];
 const tangent=cross(seed,forward),norm=Math.hypot(...tangent),right=tangent.map(x=>x/norm),up=cross(forward,right);
 return {origin,forward,right,up,near,far,halfSize,weight,receiver,source,sourceSlot,distance};
}
export function packPacketBundles(bundles){
 const data=new ArrayBuffer(bundles.length*96),f=new Float32Array(data),u=new Uint32Array(data);
 // ids.z belongs to the GPU packet network's direction. ids.w is zero
 // for all existing bundles, or one plus the isolated particle slot.
 bundles.forEach((b,i)=>{const at=i*24;f.set([...b.origin,b.near,...b.forward,b.far,...b.right,b.halfSize[0],...b.up,b.halfSize[1],b.weight,0,0,0],at);u.set([b.receiver,b.source,0,(b.sourceSlot??0xffffffff)===0xffffffff?0:b.sourceSlot+1],at+20);});return data;
}
export function packetBundlePlan(limits,{width,height,sections,bundles,slots,receivers}){
 for(const [k,v] of Object.entries({width,height,sections,bundles,slots,receivers}))count(v,k);
 const tiles=bundles*sections,maxColumns=Math.floor(limits.maxTextureDimension2D/width),maxRows=Math.floor(limits.maxTextureDimension2D/height);
 if(!Number.isSafeInteger(tiles)||tiles>0xffffffff||!maxColumns||!maxRows||tiles>maxColumns*maxRows)throw Error('Bundle atlas exceeds effective texture capacity');
 const columns=Math.max(Math.ceil(tiles/maxRows),Math.min(maxColumns,Math.ceil(Math.sqrt(tiles)))),rows=Math.ceil(tiles/columns);
 const solidColumns=Math.min(maxColumns,Math.max(1,Math.ceil(Math.sqrt(bundles)))),solidRows=Math.ceil(bundles/solidColumns);
 if(solidRows>maxRows)throw Error('Bundle solid atlas exceeds effective texture capacity');
 const rays=width*height*bundles,instances=slots*bundles,bundleBytes=bundles*96,receiverBytes=receivers*16;
 const sizes=[rays*16,bundleBytes,receiverBytes,bundles*16,slots*4];
 if(!Number.isSafeInteger(instances)||instances>0xffffffff||sizes.some(n=>!Number.isSafeInteger(n)||n>Math.min(limits.maxBufferSize,limits.maxStorageBufferBindingSize)))throw Error('Bundle solve exceeds effective buffer capacity');
 for(const n of [Math.ceil(rays/64),Math.ceil(receivers/64),Math.ceil(bundles/64)])if(n>limits.maxComputeWorkgroupsPerDimension)throw Error('Bundle solve exceeds effective dispatch capacity');
 return {width,height,sections,bundles,slots,receivers,tiles,columns,rows,atlasWidth:columns*width,atlasHeight:rows*height,solidColumns,solidRows,solidWidth:solidColumns*width,solidHeight:solidRows*height,rays,instances,bundleBytes,receiverBytes,
  bytes:columns*width*rows*height*8+solidColumns*width*solidRows*height*4+rays*16+bundleBytes+receiverBytes+bundles*16+slots*4+48};
}

// Provisional directional measure: project the inspected support onto a fresh
// orthographic plane; retain the acquired interval along this straight query.
// This is neither a normalized 3D Gaussian nor camera transfer reused as light.
export {PACKET_BUNDLE_STRUCT_WGSL} from './volume-packet-candidates.mjs';
const DECL=/* wgsl */`${PARTICLE_LIGHT_MATERIAL_WGSL}
${PARTICLE_KERNEL_WGSL}${PARTICLE_STATE_WGSL}${PACKET_BUNDLE_STRUCT_WGSL}
struct BundlePlan {image:vec4<u32>,count:vec4<u32>,solid:vec4<u32>}
@group(0) @binding(0) var<storage,read> medium:array<Particle>;
@group(0) @binding(1) var<uniform> material:Options;
@group(0) @binding(2) var<storage,read> bundles:array<Bundle>;
@group(0) @binding(3) var<storage,read> membership:array<u32>;
@group(0) @binding(4) var<uniform> plan:BundlePlan;
@group(0) @binding(5) var solids:texture_depth_2d;
@group(0) @binding(6) var moments:texture_2d<f32>;
@group(0) @binding(7) var<storage,read_write> rays:array<vec4<f32>>;
@group(0) @binding(8) var<storage,read_write> means:array<vec4<f32>>;
@group(0) @binding(9) var<storage,read_write> incident:array<vec4<f32>>;
@group(0) @binding(10) var<storage,read> triangles:array<vec4<f32>>;
@group(0) @binding(11) var<storage,read> candidatePairs:array<u32>;
@group(0) @binding(12) var<storage,read> candidateDraw:array<u32>;
fn bundleTile(tile:u32)->vec2<u32>{return vec2<u32>(tile%plan.image.z,tile/plan.image.z);}
fn bundleSlab(tau:f32)->f32{if(tau<1e-4){return 1.0-tau*.5+tau*tau/6.0;}return (1.0-exp(-tau))/tau;}
fn bundleLayer(distance:f32,b:Bundle)->u32{return min(plan.image.w-1u,u32(clamp((distance-b.origin.w)/(b.forward.w-b.origin.w),0.0,1.0)*f32(plan.image.w)));}
fn bundlePlane(point:vec3<f32>,b:Bundle)->vec2<f32>{let d=point-b.origin.xyz;return vec2<f32>(dot(d,b.right.xyz)/b.right.w,-dot(d,b.up.xyz)/b.up.w);}
`;
export const PACKET_BUNDLE_WGSL=DECL+/* wgsl */`
struct Splat {@builtin(position) position:vec4<f32>,@location(0) local:vec2<f32>,@location(1) @interpolate(flat) optical:vec4<f32>,@location(2) @interpolate(flat) depth:f32,@location(3) @interpolate(flat) interval:f32,@location(4) @interpolate(flat) bundle:u32,@location(5) @interpolate(flat) layer:u32}
@vertex fn splat(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Splat{
 return splatPair(vertex,instance);
}
@vertex fn splatCandidates(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Splat{
 var pair=instance;
 if(candidateDraw[4]==0u){pair=candidatePairs[instance];}
 return splatPair(vertex,pair);
}
fn splatPair(vertex:u32,instance:u32)->Splat{
 var out:Splat;out.position=vec4<f32>(2,2,2,1);
 let bi=instance/plan.count.x;let pi=instance%plan.count.x;let b=bundles[bi];if(b.weight.x<=0){return out;}let p=medium[pi];
 if(p.anchor.w<=0||p.shape.w<=0){return out;}
 let depth=dot(p.anchor.xyz-b.origin.xyz,b.forward.xyz);let interval=p.shape.w;
 if(depth+interval*.5<=b.origin.w||depth-interval*.5>=b.forward.w){return out;}
 let fade=select(1.0,particleLifeFade(p.motion.w,material.lifeControl.y),material.lifeControl.x>0);
 var source=particleLightIntrinsic(p)*material.gain.x*fade;
 if(plan.count.w!=0u||(b.ids.y!=0xffffffffu&&membership[pi]!=b.ids.y)||(b.ids.w!=0u&&pi!=b.ids.w-1u)){source=vec3<f32>(0);}
 let tau=select(particleLightExtinction(p,material)*fade,0.0,plan.solid.w!=0u);
 if(max(max(source.x,source.y),max(source.z,tau))<=0){return out;}
 let radius=particleLightBaseRadius(p,material);
 var axisY=vec3<f32>(0,1,0);if(material.raster.z>0){let v=mix(axisY,particleDirectionDecode(p.shape.yz),material.raster.z);if(dot(v,v)>1e-10){axisY=normalize(v);}}
 let axisX=normalize(cross(axisY,select(vec3<f32>(0,0,1),vec3<f32>(1,0,0),abs(axisY.z)>.99)));let axisZ=cross(axisX,axisY);
 let axes=array<vec3<f32>,3>(axisX,axisY,axisZ);var covariance=vec3<f32>(0);
 for(var i=0u;i<3u;i++){let v=vec2<f32>(dot(axes[i],b.right.xyz),-dot(axes[i],b.up.xyz))*radius[i];covariance+=vec3<f32>(v.x*v.x,v.y*v.y,v.x*v.y);}
 let disc=sqrt(max(0.0,(covariance.x-covariance.y)*(covariance.x-covariance.y)+4.0*covariance.z*covariance.z));
 let major=sqrt(max(0.0,(covariance.x+covariance.y+disc)*.5));let minor=sqrt(max(0.0,(covariance.x+covariance.y-disc)*.5));
 if(major<=0||minor<=0){return out;}
 var angle=0.0;if(abs(covariance.z)+abs(covariance.x-covariance.y)>1e-20){angle=.5*atan2(2.0*covariance.z,covariance.x-covariance.y);}
 let axis=vec2<f32>(cos(angle),sin(angle));let corners=array<vec2<f32>,6>(vec2<f32>(-1,-1),vec2<f32>(1,-1),vec2<f32>(1,1),vec2<f32>(-1,-1),vec2<f32>(1,1),vec2<f32>(-1,1));
 let local=corners[vertex]*2.5;let offset=axis*local.x*major+vec2<f32>(-axis.y,axis.x)*local.y*minor;
 let xy=bundlePlane(p.anchor.xyz,b)+offset/vec2<f32>(b.right.w,b.up.w);
 let layer=bundleLayer(depth,b);let tile=bundleTile(bi*plan.image.w+layer);
 let atlas=vec2<f32>(plan.solid.yz);
 let pixel=(vec2<f32>(tile)+(xy*.5+.5))*vec2<f32>(plan.image.xy);
 out.position=vec4<f32>(pixel/atlas*vec2<f32>(2,-2)+vec2<f32>(-1,1),0,1);
 out.local=local;out.optical=vec4<f32>(source,tau);out.depth=depth;out.interval=interval;out.bundle=bi;out.layer=layer;return out;
}
@fragment fn deposit(in:Splat)->@location(0) vec4<f32>{
 let tile=bundleTile(in.bundle*plan.image.w+in.layer);let at=vec2<i32>(floor(in.position.xy))-vec2<i32>(tile*plan.image.xy);
 if(any(at<vec2<i32>(0))||any(at>=vec2<i32>(plan.image.xy))){discard;}
 let b=bundles[in.bundle];let solidTile=vec2<u32>(in.bundle%plan.solid.x,in.bundle/plan.solid.x);
 let blocker=mix(b.origin.w,b.forward.w,textureLoad(solids,at+vec2<i32>(solidTile*plan.image.xy),0));
 let length=max(0.0,min(in.depth+in.interval*.5,min(b.forward.w,blocker))-max(in.depth-in.interval*.5,b.origin.w));
 let ke=particleFootprint(in.local,material.kernelE.xyz,material.kernelT.w);let kt=particleFootprint(in.local,material.kernelT.xyz,material.kernelT.w);
 return in.optical*vec4<f32>(vec3<f32>(ke),kt)*length;
}
@vertex fn solid(@builtin(vertex_index) vertex:u32,@builtin(instance_index) bi:u32)->@builtin(position)vec4<f32>{
 let b=bundles[bi];let point=triangles[vertex].xyz;let xy=bundlePlane(point,b);let distance=dot(point-b.origin.xyz,b.forward.xyz);
 return vec4<f32>(xy.x,-xy.y,(distance-b.origin.w)/(b.forward.w-b.origin.w),1);
}
@compute @workgroup_size(64) fn integrate(@builtin(global_invocation_id) gid:vec3<u32>){
 let samples=plan.image.x*plan.image.y;let index=gid.x;if(index>=samples*plan.count.y){return;}
 let bi=index/samples;let xy=vec2<u32>(index%samples%plan.image.x,index%samples/plan.image.x);var light=vec3<f32>(0);var transmission=1.0;var valid=true;
 for(var k=0u;k<plan.image.w;k++){
  let value=textureLoad(moments,vec2<i32>(xy+bundleTile(bi*plan.image.w+k)*plan.image.xy),0);
  if(any(value.xyz>=vec3<f32>(65504.0))){valid=false;continue;}
  let tau=min(value.w,65504.0);light+=transmission*value.xyz*bundleSlab(tau);transmission*=exp(-tau);
 }
 rays[index]=vec4<f32>(light,select(-1.0,transmission,valid));
}
@compute @workgroup_size(64) fn average(@builtin(global_invocation_id) gid:vec3<u32>){
 let bi=gid.x;if(bi>=plan.count.y){return;}let samples=plan.image.x*plan.image.y;var light=vec3<f32>(0);var valid=true;
 for(var i=0u;i<samples;i++){let r=rays[bi*samples+i];light+=r.xyz;if(r.w<0){valid=false;}}
 means[bi]=vec4<f32>(light/f32(samples)*bundles[bi].weight.x,select(0.0,1.0,valid));
}
@compute @workgroup_size(64) fn gather(@builtin(global_invocation_id) gid:vec3<u32>){
 let receiver=gid.x;if(receiver>=plan.count.z){return;}var light=vec3<f32>(0);var valid=true;var found=false;
 for(var bi=0u;bi<plan.count.y;bi++){if(bundles[bi].ids.x==receiver){found=true;light+=means[bi].xyz;if(means[bi].w==0){valid=false;}}}
 incident[receiver]=vec4<f32>(light,select(0.0,1.0,valid&&found));
}
`;

export function createPacketBundleTransport(device){
 const module=device.createShaderModule({label:'finite orthographic particle bundles',code:PACKET_BUNDLE_WGSL});
 const pipelines={};let resources=null,key=null,receipt=null,candidates=null,grid=null;const retired=[];
 const retire=items=>{retired.push(...items.filter(Boolean));queueMicrotask(()=>{const old=retired.splice(0);device.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>old.forEach(b=>b.destroy()));});};
 function pipeline(entry){return pipelines[entry]??=device.createComputePipeline({label:'packet bundle '+entry,layout:'auto',compute:{module,entryPoint:entry}});}
 function bind(p,entries){return device.createBindGroup({layout:p.getBindGroupLayout(0),entries:entries.map(([binding,resource])=>({binding,resource:resource?.createView?resource.createView():{buffer:resource}}))});}
 const solidDescriptor={label:'finite packet solid depth',layout:'auto',vertex:{module,entryPoint:'solid'},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less'}};
 const splatDescriptor={label:'packet intrinsic and extinction deposition',layout:'auto',vertex:{module,entryPoint:'splat'},fragment:{module,entryPoint:'deposit',targets:[{format:'rgba16float',blend:{color:{srcFactor:'one',dstFactor:'one'},alpha:{srcFactor:'one',dstFactor:'one'}}}]},primitive:{topology:'triangle-list'}};
 let preparing=null;
 return {
  prepare(){return preparing??=Promise.all([
   ...['integrate','average','gather'].map(async entry=>{pipelines[entry]=await device.createComputePipelineAsync({label:'packet bundle '+entry,layout:'auto',compute:{module,entryPoint:entry}});}),
   device.createRenderPipelineAsync(solidDescriptor).then(p=>{pipelines.solid=p;}),
   device.createRenderPipelineAsync(splatDescriptor).then(p=>{pipelines.splat=p;}),
  ]);},
  encode(encoder,{material,bundles,width,height,sections,receivers,membership=null,triangles=null,triangleCount=0,momentsOnly=false,cull=false,extinctionGridWidth=0,extinctionOnly=false,profileWrites=()=>({})}){
   if(!Number.isSafeInteger(extinctionGridWidth)||extinctionGridWidth<0)throw Error('Invalid fixed extinction width');
   if(!material?.particles||!material.options||!material.identity)throw Error('Packet bundles require current native material');
   const list=Array.isArray(bundles),bundleCount=list?bundles.length:bundles?.count;
   const plan=packetBundlePlan(device.limits,{width,height,sections,bundles:bundleCount,slots:material.slots,receivers});
   if(list&&bundles.some(b=>b.receiver>=receivers))throw Error('Bundle receiver is outside the incident result');
   if(!Number.isSafeInteger(triangleCount)||triangleCount<0||triangleCount*48>(triangles?.size??0))throw Error('Bundle solid triangle buffer is incomplete');
   const next=JSON.stringify(plan);
   if(next!==key){
    if(resources)retire(Object.values(resources));
    const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;
    resources={atlas:device.createTexture({label:'packet source and extinction slices',size:[plan.atlasWidth,plan.atlasHeight],format:'rgba16float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC}),
     solids:device.createTexture({label:'finite packet world visibility',size:[plan.solidWidth,plan.solidHeight],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),
     plan:device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),bundles:device.createBuffer({size:plan.bundleBytes,usage:storage}),
     membership:device.createBuffer({size:material.slots*4,usage:storage}),emptyTriangles:device.createBuffer({size:16,usage:storage}),
     rays:device.createBuffer({size:plan.rays*16,usage:storage}),means:device.createBuffer({size:bundleCount*16,usage:storage}),incident:device.createBuffer({size:plan.receiverBytes,usage:storage})};key=next;
   }
   const r=resources,bundleBuffer=list?r.bundles:bundles.buffer;
   if(!bundleBuffer||bundleBuffer.size<plan.bundleBytes)throw Error('Bundle descriptors are incomplete');
   if(membership&&membership.size<material.slots*4)throw Error('Bundle source membership is incomplete');
   if(list)device.queue.writeBuffer(r.bundles,0,packPacketBundles(bundles));
   const gridOnly=extinctionGridWidth>0&&extinctionOnly;
   device.queue.writeBuffer(r.plan,0,new Uint32Array([width,height,plan.columns,sections,material.slots,bundleCount,receivers,Number(extinctionOnly),plan.solidColumns,plan.atlasWidth,plan.atlasHeight,extinctionGridWidth]));
   const selection=cull&&!gridOnly?(candidates??=createPacketCandidates(device,PACKET_BUNDLE_STRUCT_WGSL)).encode(encoder,{material,bundleBuffer,plan,profileWrites}):null;
   pipelines.solid??=device.createRenderPipeline(solidDescriptor);
   let pass=encoder.beginRenderPass({label:'packet current finite solid visibility',...profileWrites('packet-solid'),colorAttachments:[],depthStencilAttachment:{view:r.solids.createView(),depthLoadOp:'clear',depthStoreOp:'store',depthClearValue:1}});
   if(triangleCount){pass.setPipeline(pipelines.solid);pass.setBindGroup(0,bind(pipelines.solid,[[2,bundleBuffer],[10,triangles]]));
    for(let bi=0;bi<bundleCount;bi++){const x=bi%plan.solidColumns*width,y=Math.floor(bi/plan.solidColumns)*height;pass.setViewport(x,y,width,height,0,1);pass.setScissorRect(x,y,width,height);pass.draw(triangleCount*3,1,0,bi);}}
   pass.end();
   if(!gridOnly){
   const raster=selection
    ?pipelines.splatCandidates??=device.createRenderPipeline({...splatDescriptor,vertex:{module,entryPoint:'splatCandidates'}})
    :pipelines.splat??=device.createRenderPipeline(splatDescriptor);
   // The splat uses atlas extent from the uniform. Sampling the render target
   // itself would be a texture feedback hazard, so its dimensions are explicit.
   pass=encoder.beginRenderPass({label:'packet joint source and extinction slices',...profileWrites('packet-raster'),colorAttachments:[{view:r.atlas.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});
   const entries=[[0,material.particles],[1,material.options],[2,bundleBuffer],[3,membership??r.membership],[4,r.plan],[5,r.solids]];
   if(selection)entries.push([11,selection.ids],[12,selection.draw]);
   pass.setPipeline(raster);pass.setBindGroup(0,bind(raster,entries));
   if(selection)pass.drawIndirect(selection.draw,0);else pass.draw(6,plan.instances);
   pass.end();
   }
   const fixed=extinctionGridWidth?(grid??=createFixedExtinctionGrid(device,DECL)).encode(encoder,{material,width:extinctionGridWidth,plan,resources:r,bundleBuffer,profileWrites,retire,gridOnly}):null;
   if(!momentsOnly)for(const [entry,entries,groups] of [
    ['integrate',[[4,r.plan],[6,r.atlas],[7,r.rays]],Math.ceil(plan.rays/64)],
    ['average',[[2,bundleBuffer],[4,r.plan],[7,r.rays],[8,r.means]],Math.ceil(bundleCount/64)],
    ['gather',[[2,bundleBuffer],[4,r.plan],[8,r.means],[9,r.incident]],Math.ceil(receivers/64)]]){
    const p=pipeline(entry);pass=encoder.beginComputePass({label:'packet bundle '+entry,...profileWrites('packet-'+entry)});pass.setPipeline(p);pass.setBindGroup(0,bind(p,entries));pass.dispatchWorkgroups(groups);pass.end();
   }
   receipt={...plan,bytes:plan.bytes+(selection?.bytes??0),identity:{...material.identity},coverage:{...material.coverage},measure:'projected-base-support-with-acquired-axial-interval',visibility:triangleCount?'current-finite-triangle-depth':'empty-solid-scene',history:'fresh-only',source:'intrinsic-emission-only',quantity:momentsOnly?'ordered-emission-and-extinction-slabs':'spherical-mean-incoming-radiance',depth:'explicit-axial-distance; center-slice mixture',work:{
    rasterSubmission:gridOnly?'none-grid-only':selection?'gpu-current-support-index':'dense',
    submittedInstances:gridOnly?0:selection?null:plan.instances,denseInstances:plan.instances,
    indexedSlots:selection?plan.slots:0,indexedCells:selection?.cellCount??0,
    subrays:plan.rays,sectionReads:plan.rays*sections,solidTriangles:triangleCount*bundleCount}};
   receipt.extinction=fixed?'fixed-particle-grid':'directional-particle-splats';
   if(extinctionOnly)receipt.source='none-extinction-only';
   if(fixed){receipt.fixedGrid=fixed;receipt.bytes+=fixed.bytes;}
   return {buffer:momentsOnly?null:r.incident,count:momentsOnly?0:receivers,identity:{...material.identity},submission:selection?.draw??null,receipt};
  },
  read:()=>receipt,
  get buffers(){return resources;},
  dispose(){if(resources)retire(Object.values(resources));candidates?.dispose();grid?.dispose(retire);grid=null;candidates=null;resources=null;key=null;receipt=null;},
 };
}
