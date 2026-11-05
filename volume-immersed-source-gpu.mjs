import {createGPUImmersedGeometry} from './volume-immersed-source-geometry-gpu.mjs';
import {createGPUStochasticSignalSet,createGPUInputSlots} from './volume-inlet-perturbation-gpu.mjs';
import {inletDynamicsTauSteps,INLET_TURBULENCE_CORRELATION_SECONDS} from './volume-inlet-perturbation.mjs';
const pipelines=new WeakMap();
const CODE=/* wgsl */`
struct SourceFieldParams {shape:vec4<u32>,noise:vec4<f32>,lattice:vec4<u32>,extra:vec4<f32>}
@group(0) @binding(0) var<uniform> p:SourceFieldParams;
@group(0) @binding(1) var base:texture_2d_array<f32>;
@group(0) @binding(2) var<storage,read> noiseNodes:array<vec4<u32>>;
@group(0) @binding(3) var<storage,read> puffNodes:array<vec4<u32>>;
@group(0) @binding(5) var<storage,read> normalization:array<vec4<f32>>;
@group(0) @binding(4) var output:texture_storage_2d_array<rgba32float,write>;
fn noiseAt(i:u32)->f32{return clamp(bitcast<f32>(noiseNodes[i].x),-1.0,1.0);}
@compute @workgroup_size(8,8) fn buildSourceField(@builtin(global_invocation_id) c:vec3<u32>){
 if(c.x>=p.shape.y||c.y>=p.shape.z){return;}let layer=i32(p.shape.x);var value=textureLoad(base,vec2<i32>(c.xy),layer,0);var puff=1.0;
 if(p.noise.y>0.0){puff=max(0.0,1.0+p.noise.y*clamp(bitcast<f32>(puffNodes[0].x),-1.0,1.0));}
 if(c.y==0u){if(c.x==3u){value.z=normalization[p.shape.x-1u].x*puff;}}
 else if(c.x<p.shape.w){
  var noise=0.0;if(p.noise.x>0.0){let q=(vec2<f32>(f32(c.x),f32(c.y-1u))+.5)/p.noise.z;let cell=min(vec2<u32>(p.lattice.x-1u),vec2<u32>(floor(q)));let f=q-vec2<f32>(cell);let stride=p.lattice.x+1u;let i=cell.x+stride*cell.y;
   noise=(noiseAt(i)*(1.0-f.x)+noiseAt(i+1u)*f.x)*(1.0-f.y)+(noiseAt(i+stride)*(1.0-f.x)+noiseAt(i+stride+1u)*f.x)*f.y;}
  let sourceOn=textureLoad(base,vec2<i32>(0),layer,0).x>.5;let plain=textureLoad(base,vec2<i32>(5,0),layer,0).x<.5;value=select(vec4<f32>(0),vec4<f32>(select(value.x,1.0,plain),noise,0,puff),sourceOn);
 }
 textureStore(output,vec2<i32>(c.xy),layer,value);
}
`;
export function createGPUImmersedCollection(device){
 const U=GPUBufferUsage,T=GPUTextureUsage,streams=new Map(),retired=new Set();let packet=null,last=null,shape=null,base=null,texture=null,baseView=null,outputView=null,destroyed=false,encodedStep=-1,observePuffs=false,readingPuffs=false,puffObservation=null,observationTask=Promise.resolve(null);
 const geometry=createGPUImmersedGeometry(device);let patterns=[];const pendingPatternRows=new Set();
 const dummy=device.createBuffer({label:'inactive GPU inlet streams',size:16,usage:U.STORAGE});
 const retire=(resources)=>{for(const r of resources)if(r)retired.add(r);queueMicrotask(()=>{const done=()=>{for(const r of resources)if(r&&retired.delete(r))r.destroy();};device.queue.onSubmittedWorkDone().then(done,done);});};
 if(!pipelines.has(device)){const module=device.createShaderModule({label:'GPU immersed source fields',code:CODE});pipelines.set(device,device.createComputePipeline({label:'GPU immersed source fields',layout:'auto',compute:{module,entryPoint:'buildSourceField'}}));}const pipeline=pipelines.get(device);
 function capturePuffs(encoder,step){
  if(!observePuffs||readingPuffs||!packet)return;observePuffs=false;const sampledPacket=packet,sampledAt=performance.now()/1000,points=packet.sources.map((source,index)=>({source,index})).filter(({source})=>source.config.effective.admitted),factors=packet.sources.map(s=>({id:s.id,factor:1,coverageFraction:0}));
  if(!points.length){puffObservation={status:'constant-input',packet:sampledPacket,sampledAt,step,factors};observationTask=Promise.resolve(puffObservation);return;}
  const copy=device.createBuffer({label:'source puff observation',size:points.length*256+packet.count*16,usage:U.COPY_DST|U.MAP_READ});for(const [i,{index}]of points.entries())encoder.copyTextureToBuffer({texture,origin:[0,1,index+1]},{buffer:copy,offset:i*256,bytesPerRow:256,rowsPerImage:1},[1,1,1]);encoder.copyBufferToBuffer(geometry.resources.stats,0,copy,points.length*256,packet.count*16);readingPuffs=true;let finish;observationTask=new Promise(resolve=>{finish=resolve;});
  queueMicrotask(async()=>{let mapped=false;try{await copy.mapAsync(GPUMapMode.READ);mapped=true;const data=new Float32Array(copy.getMappedRange());for(const [i,{index}]of points.entries()){const factor=data[i*64+3];if(!Number.isFinite(factor)||factor<0)throw Error('Invalid GPU source puff observation');factors[index].factor=factor;const fraction=data[points.length*64+index*4+2];if(!Number.isFinite(fraction)||fraction<0||fraction>1)throw Error('Invalid GPU source coverage observation');factors[index].coverageFraction=fraction;}if(!destroyed&&packet===sampledPacket)puffObservation={status:'measured',packet:sampledPacket,sampledAt,step,factors};}catch(e){if(!destroyed&&packet===sampledPacket)puffObservation={status:'measurement-error',packet:sampledPacket,sampledAt,step,factors:[],error:e.message};}finally{if(mapped)copy.unmap();copy.destroy();readingPuffs=false;finish(puffObservation);}});
 }
 function resetBindings(){for(const s of streams.values()){s.inputs?.destroy();s.inputs=null;}}
 return{
  observePuffs(value=true){observePuffs=!!value;},puffObservation(){return puffObservation;},observationComplete(){return observationTask;},get geometry(){return geometry.resources;},get encodedStep(){return encodedStep;},get texture(){return texture;},get baseTexture(){return base;},get packet(){return packet;},
  update(next,{grid,step=0,legacyId=null}={}){
   if(destroyed)throw Error('GPU source collection disposed');const width=next?.width??Math.max(6,grid),height=next?.height??grid+1,layers=next?.layers??1,key=[width,height,layers].join(':');
   if(layers>device.limits.maxTextureArrayLayers)throw Error(`immersed-source-collection-capacity:requested=${layers-1}:supported=${device.limits.maxTextureArrayLayers-1}`);
   const changed=shape!==key;
   if(changed){const previous=[base,texture];base=device.createTexture({label:'static authored source inputs',size:[width,height,layers],format:'rgba32float',usage:T.TEXTURE_BINDING|T.COPY_DST});texture=device.createTexture({label:'GPU authored source collection',size:[width,height,layers],format:'rgba32float',usage:T.TEXTURE_BINDING|T.STORAGE_BINDING|T.COPY_DST|T.COPY_SRC});baseView=base.createView({dimension:'2d-array'});outputView=texture.createView({dimension:'2d-array'});shape=key;last=null;patterns=[];pendingPatternRows.clear();resetBindings();retire(previous);}
   if(last!==next||changed){
    const metadata=new Float32Array([1,next?.count??0,grid,0]);for(const target of[base,texture])device.queue.writeTexture({texture:target},metadata,{bytesPerRow:16},[1,1,1]);
    for(const [index,source]of(next?.sources??[]).entries()){
     device.queue.writeTexture({texture:base,origin:[0,0,index+1]},source.coefficients,{bytesPerRow:96},[6,1,1]);
     if(source.pattern&&patterns[index]!==source.pattern){pendingPatternRows.add(index);const values=new Float32Array(grid*grid*4);for(let i=0;i<source.pattern.cells.length;i++)values[i*4]=source.pattern.cells[i];device.queue.writeTexture({texture:base,origin:[0,1,index+1]},values,{bytesPerRow:grid*16,rowsPerImage:grid},[grid,grid,1]);}
     patterns[index]=source.pattern;
    }last=next;
   }
   const oldStats=geometry.resources?.stats;geometry.update(next,baseView);if(oldStats!==geometry.resources.stats)resetBindings();
   if(packet!==next||changed)encodedStep=-1;packet=next;
   for(const source of next?.sources??[]){const e=source.config.effective,settings=source.config.requested?.inletDynamics??e.inletDynamics??{};let s=streams.get(source.id);if(!s||s.grid!==grid){if(s){s.noise?.destroy();s.puff?.destroy();s.inputs?.destroy();}s={grid,birth:source.id===legacyId?0:step,noise:null,puff:null,scale:null,inputs:null};streams.set(source.id,s);}
    const scale=Math.max(1,Math.min(grid,Math.round(settings.turbulenceScaleCells||8))),patches=Math.ceil(grid/scale);
    if(settings.turbulence>0&&(!s.noise||s.scale!==scale)){s.noise?.destroy();s.noise=createGPUStochasticSignalSet(device,{seed:7919+scale,count:(patches+1)**2,label:'GPU inlet noise '+source.id});s.scale=scale;s.inputs?.destroy();s.inputs=null;}
    if(settings.puff>0&&!s.puff){s.puff=createGPUStochasticSignalSet(device,{seed:2,count:1,label:'GPU inlet puff '+source.id});s.inputs?.destroy();s.inputs=null;}
   }
   return changed;
  },
  encode(encoder,{step,controls={}}){
   if(destroyed)throw Error('GPU source collection disposed');geometry.encode(encoder);for(const [index,source]of(packet?.sources??[]).entries()){
    const e=source.config.effective,settings=source.config.requested?.inletDynamics??e.inletDynamics??{},s=streams.get(source.id);
    const local={...controls,...source.controls},age=Math.max(0,step-s.birth);if(settings.turbulence>0)s.noise.encode(encoder,age,inletDynamicsTauSteps(local,INLET_TURBULENCE_CORRELATION_SECONDS));if(settings.puff>0)s.puff.encode(encoder,age,inletDynamicsTauSteps(local,settings.puffPeriod));
    s.inputs??=createGPUInputSlots(device,'GPU source field parameters '+source.id,64,buffer=>device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer}},{binding:1,resource:baseView},{binding:2,resource:{buffer:s.noise?.buffer??dummy}},{binding:3,resource:{buffer:s.puff?.buffer??dummy}},{binding:4,resource:outputView},{binding:5,resource:{buffer:geometry.resources.stats}}]}));
    const data=new ArrayBuffer(64);new Uint32Array(data).set([index+1,packet.width,packet.height,s.grid]);new Float32Array(data).set([settings.turbulence,settings.puff,s.scale??1,0],4);new Uint32Array(data).set([Math.ceil(s.grid/(s.scale??1)),0,0,0],8);
    const group=s.inputs.lease(encoder,data),pass=encoder.beginComputePass({label:'GPU immersed source fields'});pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(packet.width/8),Math.ceil((settings.turbulence>0||pendingPatternRows.has(index)?packet.height:2)/8));pass.end();pendingPatternRows.delete(index);
   }encodedStep=step;capturePuffs(encoder,step);
  },
  releaseTextures(){resetBindings();retire([base,texture]);base=null;texture=null;baseView=null;outputView=null;shape=null;last=null;packet=null;},
  destroy(){if(destroyed)return;destroyed=true;for(const s of streams.values()){s.inputs?.destroy();s.noise?.destroy();s.puff?.destroy();}geometry.destroy();retire([base,texture,dummy,...retired]);},
 };
}
