import {createGPUInputSlots} from './volume-inlet-perturbation-gpu.mjs';

// An oriented slab's conservative integer support, intersected with the old
// reference's reach cube. This computes bounds only; no source cells visit CPU.
export function immersedSourceIntegerBounds(e,{grid,gridHeight,worldSource=false}){
 if(!e?.admitted)return {lo:[0,0,0],span:[0,0,0],cells:0,exteriorCapacity:0};
 const half=Math.max(.5,e.thickness/2),reach=Math.ceil(Math.max(e.radiusCells,half)+1.5),domain=[grid,gridHeight,grid];
 const lo=[],span=[];let inside=1;
 for(let a=0;a<3;a++){
  const n=e.direction[a],extent=Math.abs(n)*(half+.5)+Math.sqrt(Math.max(0,1-n*n))*(e.radiusCells+.5);
  let lower=Math.max(Math.floor(e.centreCells[a]-reach),Math.floor(e.centreCells[a]-extent-.5)-1),upper=Math.min(Math.ceil(e.centreCells[a]+reach),Math.ceil(e.centreCells[a]+extent-.5)+1);
  if(!worldSource){lower=Math.max(0,lower);upper=Math.min(domain[a]-1,upper);}
  lo.push(lower);span.push(Math.max(0,upper-lower+1));inside*=Math.max(0,Math.min(upper+1,domain[a])-Math.max(lower,0));
 }
 const cells=span[0]*span[1]*span[2];if(!Number.isSafeInteger(cells)||cells>0xffffffff||lo.some(v=>v< -2147483648||v>2147483647))throw Error('Immersed source geometry exceeds GPU integer address space');
 return {lo,span,cells,exteriorCapacity:worldSource?cells-inside:0};
}
const cache=new WeakMap();
const CODE=/* wgsl */`
struct Params {centreRadius:vec4<f32>,normalHalf:vec4<f32>,basisPattern:vec4<f32>,otherFlux:vec4<f32>,lo:vec4<i32>,span:vec4<u32>,domain:vec4<u32>,work:vec4<u32>}
struct SourceCell {positionWeight:vec4<f32>,source:vec4<u32>}
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var pattern:texture_2d_array<f32>;
@group(0) @binding(2) var<storage,read_write> partials:array<vec4<f32>>;
@group(0) @binding(3) var<storage,read_write> stats:array<vec4<f32>>;
@group(0) @binding(4) var<storage,read_write> cells:array<SourceCell>;
@group(0) @binding(5) var<storage,read_write> counts:array<atomic<u32>>;
var<workgroup> sums:array<vec4<f32>,64>;
fn skirt(half:f32,x:f32)->f32{let t=clamp(half+.5-x,0.0,1.0);return t*t*(3.0-2.0*t);}
@compute @workgroup_size(64) fn measureSourceGeometry(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){
 let batch=group.x+group.y*groups.x;let i=batch*64u+lane;var sum=vec4<f32>(0);
 if(i<p.span.w){
  let c=p.lo.xyz+vec3<i32>(i32(i%p.span.x),i32((i/p.span.x)%p.span.y),i32(i/(p.span.x*p.span.y)));let d=vec3<f32>(c)+.5-p.centreRadius.xyz;
  let along=dot(d,p.normalHalf.xyz);let radial=length(d-along*p.normalHalf.xyz);let plain=skirt(p.normalHalf.w,abs(along))*skirt(p.centreRadius.w,radial);
  let uv=clamp(vec2<i32>(floor(vec2<f32>(f32(p.domain.x)*.5)+vec2<f32>(dot(d,p.basisPattern.xyz),dot(d,p.otherFlux.xyz)))),vec2<i32>(0),vec2<i32>(i32(p.domain.x)-1));
  var covered=plain;if(p.basisPattern.w>0.0){covered*=textureLoad(pattern,uv+vec2<i32>(0,1),i32(p.work.y+1u),0).x;}
  let inside=all(c>=vec3<i32>(0))&&all(c<vec3<i32>(i32(p.domain.x),i32(p.domain.y),i32(p.domain.x)));
  sum=vec4<f32>(plain,select(0.0,plain,inside),select(0.0,covered,inside),0);
  if(!inside&&p.domain.z>0u&&covered>0.0&&p.otherFlux.w>0.0){let slot=atomicAdd(&counts[0],1u);cells[slot]=SourceCell(vec4<f32>(vec3<f32>(c),covered),vec4<u32>(p.work.y,u32(uv.y)*p.domain.x+u32(uv.x),0,0));}
 }
 sums[lane]=sum;workgroupBarrier();for(var stride=32u;stride>0u;stride/=2u){if(lane<stride){sums[lane]+=sums[lane+stride];}workgroupBarrier();}
 if(lane==0u&&batch<p.work.x){partials[p.domain.w+batch]=sums[0];}
}
@compute @workgroup_size(64) fn finishSourceNormalization(@builtin(local_invocation_index) lane:u32){
 var sum=vec4<f32>(0);for(var i=lane;i<p.work.x;i+=64u){sum+=partials[p.domain.w+i];}sums[lane]=sum;workgroupBarrier();for(var stride=32u;stride>0u;stride/=2u){if(lane<stride){sums[lane]+=sums[lane+stride];}workgroupBarrier();}
 if(lane==0u){let s=sums[0];let denominator=max(1e-6,select(s.y,s.x,p.domain.z>0u));let fraction=min(1.0,s.z/denominator);stats[p.work.y]=vec4<f32>(p.otherFlux.w*fraction/max(1e-6,s.z),p.otherFlux.w/max(1e-6,s.x),fraction,s.x);}
}
@compute @workgroup_size(1) fn finishExteriorCount(){atomicStore(&counts[1],min(65535u,(atomicLoad(&counts[0])+63u)/64u));atomicStore(&counts[2],max(1u,((atomicLoad(&counts[0])+63u)/64u+65534u)/65535u));atomicStore(&counts[3],1u);}
`;
export function createGPUImmersedGeometry(device){
 const U=GPUBufferUsage;let packet=null,patternView=null,descriptors=[],resources=null,inputs=[],dirty=true,destroyed=false;
 if(!cache.has(device)){const module=device.createShaderModule({label:'GPU immersed source geometry',code:CODE});cache.set(device,Object.fromEntries(['measureSourceGeometry','finishSourceNormalization','finishExteriorCount'].map(entryPoint=>[entryPoint,device.createComputePipeline({label:entryPoint,layout:'auto',compute:{module,entryPoint}})])));}const pipelines=cache.get(device);
 const retire=old=>queueMicrotask(()=>{const done=()=>{for(const b of old??[])b.destroy();};device.queue.onSubmittedWorkDone().then(done,done);});
 const buffer=(label,size,extra=0)=>device.createBuffer({label,size:Math.max(16,size),usage:U.STORAGE|U.COPY_DST|U.COPY_SRC|extra});
 function clearInputs(){for(const s of inputs)s?.destroy();inputs=[];}
 return{
  get resources(){return resources;},
  update(next,view){
   if(destroyed)throw Error('GPU source geometry disposed');if(packet===next&&patternView===view)return;const grid=next.width<6?next.width:next.height-1,gridHeight=next.gridHeight??grid*2;
   let totalPartials=0,maxParcels=0;const nextDescriptors=[];
   for(const [index,source]of next.sources.entries()){
    const e=source.config.effective,b=immersedSourceIntegerBounds(e,{grid,gridHeight,worldSource:source.worldSource}),groups=Math.ceil(b.cells/64),data=new ArrayBuffer(128),f=new Float32Array(data),u=new Uint32Array(data),i=new Int32Array(data);
    if(e.admitted){f.set([...e.centreCells,e.radiusCells]);f.set([...e.direction,Math.max(.5,e.thickness/2)],4);f.set([...e.basis.e1,e.pattern?.kind!=='shape'?1:0],8);f.set([...e.basis.e2,e.fluxNominal??e.fluxRequested],12);}
    i.set([...b.lo,0],16);u.set([...b.span,b.cells],20);u.set([grid,gridHeight,source.worldSource?1:0,totalPartials],24);u.set([groups,index,0,0],28);nextDescriptors.push({data,groups});totalPartials+=groups;maxParcels+=b.exteriorCapacity;
   }
   for(const bytes of[Math.max(1,totalPartials)*16,Math.max(1,maxParcels)*32,Math.max(1,next.count)*16])if(!Number.isSafeInteger(bytes)||bytes>device.limits.maxStorageBufferBindingSize||bytes>device.limits.maxBufferSize)throw Error('Immersed source geometry exceeds GPU storage limits');
   const grow=!resources||resources.maxParcels<maxParcels||resources.maxPartials<totalPartials||resources.sourceCapacity<next.count;
   if(grow){clearInputs();const previous=resources;resources={cells:buffer('GPU compact exterior source geometry',Math.max(32,maxParcels*32)),stats:buffer('GPU source normalization',next.count*16),partials:buffer('GPU source normalization partials',totalPartials*16),counts:buffer('GPU exterior source count and dispatch',16,U.INDIRECT),maxParcels,maxPartials:totalPartials,sourceCapacity:next.count};if(previous)retire([previous.cells,previous.stats,previous.partials,previous.counts]);}
   if(patternView!==view)clearInputs();packet=next;patternView=view;descriptors=nextDescriptors;resources.packet=next;resources.activeMaxParcels=maxParcels;dirty=true;
  },
  encode(encoder){
   if(!dirty)return;encoder.clearBuffer(resources.counts);encoder.clearBuffer(resources.stats);
   for(const [index,d]of descriptors.entries()){
    if(!d.groups)continue;
    if(!inputs[index])inputs[index]=createGPUInputSlots(device,'GPU source geometry parameters',128,buffer=>{
     const bindings={0:{buffer},1:patternView,2:{buffer:resources.partials},3:{buffer:resources.stats},4:{buffer:resources.cells},5:{buffer:resources.counts}};
     return {measure:device.createBindGroup({layout:pipelines.measureSourceGeometry.getBindGroupLayout(0),entries:[0,1,2,4,5].map(binding=>({binding,resource:bindings[binding]}))}),finish:device.createBindGroup({layout:pipelines.finishSourceNormalization.getBindGroupLayout(0),entries:[0,2,3].map(binding=>({binding,resource:bindings[binding]}))})};
    });
    const groups=inputs[index].lease(encoder,d.data),pass=encoder.beginComputePass({label:'GPU source geometry and normalization'});pass.setPipeline(pipelines.measureSourceGeometry);pass.setBindGroup(0,groups.measure);const x=Math.min(d.groups,device.limits.maxComputeWorkgroupsPerDimension),y=Math.ceil(d.groups/x);if(y>device.limits.maxComputeWorkgroupsPerDimension)throw Error('Immersed source geometry exceeds GPU dispatch limits');pass.dispatchWorkgroups(x,y);pass.setPipeline(pipelines.finishSourceNormalization);pass.setBindGroup(0,groups.finish);pass.dispatchWorkgroups(1);pass.end();
   }
   const pass=encoder.beginComputePass({label:'GPU exterior source count'});pass.setPipeline(pipelines.finishExteriorCount);pass.setBindGroup(0,device.createBindGroup({layout:pipelines.finishExteriorCount.getBindGroupLayout(0),entries:[{binding:5,resource:{buffer:resources.counts}}]}));pass.dispatchWorkgroups(1);pass.end();dirty=false;
  },
  destroy(){if(destroyed)return;destroyed=true;clearInputs();if(resources)retire([resources.cells,resources.stats,resources.partials,resources.counts]);resources=null;},
 };
}
