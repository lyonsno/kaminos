// Independent extinction of the current single-grid field. No light evaluation.
export function validateParticleGridExtinction(field,{viewProj,dims}){
 if(!field?.texture||field.status!=='encoded'||!Number.isSafeInteger(field.generation)||field.generation<1||field.frame!==field.expectedFrame)throw Error('Current grid extinction is missing or stale');
 if(field.exterior)throw Error('Fill missing extinction currently requires a single grid');
 if(field.coefficientLengthSpace!=='volume-local')throw Error('Grid extinction requires volume-local coefficient lengths');
 const hi=[1,2*dims[1]/dims[0]-1,1];
 if(!field.localMin?.every(v=>v===-1)||!field.localMax?.every((v,i)=>Math.abs(v-hi[i])<1e-5))throw Error('Grid extinction domain does not match the particle grid');
 if(![3,7,11].some(i=>Math.abs(viewProj[i])>1e-10))throw Error('Grid extinction depth requires a perspective camera');
 return field;
}

export const PARTICLE_GRID_EXTINCTION_WGSL=/* wgsl */`
struct GridDepthParams {size:vec4<u32>}
@group(0) @binding(0) var medium:texture_3d<f32>;
@group(0) @binding(1) var<uniform> u:Options;
@group(0) @binding(2) var<uniform> depthParams:GridDepthParams;
@group(0) @binding(3) var<storage,read> depthBounds:array<u32>;
@group(0) @binding(4) var gridPrefix:texture_storage_2d<r32float,write>;
@group(0) @binding(5) var gridBaseTotal:texture_storage_2d<rg32float,write>;
@group(0) @binding(6) var sceneDepth:SCENE_DEPTH_TYPE;
fn gridBox(ro:vec3<f32>,rd:vec3<f32>,hi:vec3<f32>)->vec2<f32>{
 var near=0.0;var far=1e30;
 for(var a=0u;a<3u;a++){if(abs(rd[a])<1e-12){if(ro[a]<-1.0||ro[a]>hi[a]){return vec2<f32>(1,0);}}else{let x=(-1.0-ro[a])/rd[a];let y=(hi[a]-ro[a])/rd[a];near=max(near,min(x,y));far=min(far,max(x,y));}}
 return vec2<f32>(near,far);
}
// Exact traversal of the prepared piecewise-constant coefficient cells.
fn gridSegmentTau(ro:vec3<f32>,rd:vec3<f32>,start:f32,end:f32,hi:vec3<f32>)->f32{
 if(end<=start){return 0.0;}let dims=vec3<i32>(textureDimensions(medium));let pitch=(hi+vec3<f32>(1))/vec3<f32>(dims);
 let at=(ro+rd*start+vec3<f32>(1))/pitch;var cell=clamp(vec3<i32>(floor(at)),vec3<i32>(0),dims-1);
 for(var a=0u;a<3u;a++){if(rd[a]<0&&at[a]==floor(at[a])){cell[a]=max(0,cell[a]-1);}}
 var t=start;var tau=0.0;
 loop{
  var next=vec3<f32>(1e30);
  for(var a=0u;a<3u;a++){if(abs(rd[a])>1e-12){let edge=-1.0+(f32(cell[a])+select(0.0,1.0,rd[a]>0))*pitch[a];next[a]=(edge-ro[a])/rd[a];}}
  let stop=min(end,min(next.x,min(next.y,next.z)));
  tau+=max(0.0,textureLoad(medium,cell,0).w)*max(0.0,stop-t);
  if(stop>=end){break;}
  for(var a=0u;a<3u;a++){if(next[a]<=stop){cell[a]+=select(-1,1,rd[a]>0);}}
  if(any(cell<vec3<i32>(0))||any(cell>=dims)){break;}t=max(t,stop);
 }return tau;
}
@compute @workgroup_size(8,8) fn build(@builtin(global_invocation_id) id:vec3<u32>){
 if(any(id.xy>=depthParams.size.xy)){return;}let xy=vec2<i32>(id.xy);let uv=(vec2<f32>(id.xy)+.5)/vec2<f32>(depthParams.size.xy);let ndc=uv*vec2<f32>(2,-2)+vec2<f32>(-1,1);
 let nearClip=select(-1.0,0.0,u.gain.w>.5);let a=u.inverse*vec4<f32>(ndc,nearClip,1);let b=u.inverse*vec4<f32>(ndc,1,1);let ro=a.xyz/a.w;let rd=normalize(b.xyz/b.w-ro);
 let hi=vec3<f32>(1,2.0*u.fine.y/u.fine.x-1.0,1);var hit=gridBox(ro,rd,hi);
 let pixel=clamp(vec2<i32>(uv*vec2<f32>(textureDimensions(sceneDepth))),vec2<i32>(0),vec2<i32>(textureDimensions(sceneDepth))-1);
 var solid=textureLoad(sceneDepth,pixel,0);SCENE_DEPTH_REDUCE
 if(solid<1.0){let c=u.inverse*vec4<f32>(ndc,select(solid*2.0-1.0,solid,u.gain.w>.5),1);hit.y=min(hit.y,dot(c.xyz/c.w-ro,rd));}
 let start=hit.x;let end=max(start,hit.y);let originDepth=(u.vp*vec4<f32>(ro,1)).w;let slope=(u.vp*vec4<f32>(rd,0)).w;
 var lo=bitcast<f32>(depthBounds[0]);var high=bitcast<f32>(depthBounds[1]);if(high<=lo){if(lo<1e30&&lo>0.0){high=lo+.5;lo-=.5;}else{lo=originDepth;high=lo+1.0;}}
 var cursor=start;var tau=0.0;var base=0.0;
 for(var k=0u;k<=depthParams.size.w;k++){
  let z=mix(lo,high,f32(k)/f32(depthParams.size.w));let stop=clamp((z-originDepth)/slope,start,end);
  tau+=gridSegmentTau(ro,rd,cursor,stop,hi);cursor=stop;
  if(k==0u){base=tau;}else{let layer=k-1u;let at=id.xy+vec2<u32>(layer%depthParams.size.z,layer/depthParams.size.z)*depthParams.size.xy;textureStore(gridPrefix,vec2<i32>(at),vec4<f32>(tau));}
 }
 tau+=gridSegmentTau(ro,rd,cursor,end,hi);textureStore(gridBaseTotal,xy,vec4<f32>(base,tau,0,0));
}
`;

export const PARTICLE_EXTINCTION_QUERY_WGSL=/* wgsl */`
@group(0) @binding(6) var particleGridPrefix:texture_2d<f32>;
@group(0) @binding(7) var particleGridBase:texture_2d<f32>;
fn particleGridCumulative(xy:vec2<i32>,layer:i32)->f32{
 if(layer<0){return textureLoad(particleGridBase,xy,0).x;}return textureLoad(particleGridPrefix,xy+vec2<i32>(particleDepthTile(u32(layer))*particleDepth.size.xy),0).r;
}
fn particleEffectiveTau(particle:f32,grid:f32,strength:f32)->f32{return particle+strength*max(0.0,grid-particle-u.visibility.y);}
fn particleAssistedWeight(xy:vec2<f32>,depth:vec2<f32>,selfTau:f32)->f32{
 let at=clamp(vec2<i32>(xy/u.raster.xy*vec2<f32>(particleDepth.size.xy)),vec2<i32>(0),vec2<i32>(particleDepth.size.xy)-1);let layer=i32(depth.x);
 let strength=select(u.visibility.x,1.0,u.visibility.z>0.0);
 let before=particleEffectiveTau(particleDepthCumulative(at,layer-1),particleGridCumulative(at,layer-1),strength);
 let after=particleEffectiveTau(particleDepthCumulative(at,layer),particleGridCumulative(at,layer),strength);let tau=max(0.0,after-before);
 if(PARTICLE_DEPTH_MODE==2u){let own=select(1.0,(1.0-exp(-selfTau))/max(selfTau,1e-6),selfTau>1e-5);return exp(-before-max(0.0,tau-selfTau)*depth.y)*own;}
 return exp(-before)*select(1.0,(1.0-exp(-tau))/max(tau,1e-6),tau>1e-5);
}
`;

export function createParticleGridExtinction(device,{optionsWgsl,options}){
 const pipelines=new Map();let prefix=null,base=null,key=null;
 const destroy=()=>{const old=[prefix,base].filter(Boolean);prefix=base=null;key=null;if(old.length)queueMicrotask(()=>device.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>old.forEach(t=>t.destroy())));};
 return {
  encode(encoder,{field,depthField,layout,sceneDepth,profileWrites=()=>({})}){
   const next=JSON.stringify(layout);if(next!==key){destroy();key=next;prefix=device.createTexture({label:'independent grid extinction prefix',size:[layout.atlasWidth,layout.atlasHeight],format:'r32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING});base=device.createTexture({label:'grid extinction before first slice and total',size:[layout.width,layout.height],format:'rg32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING});}
   const ms=sceneDepth.sampleCount>1;let pipeline=pipelines.get(ms);
   if(!pipeline){const code=(optionsWgsl+PARTICLE_GRID_EXTINCTION_WGSL).replace('SCENE_DEPTH_TYPE',ms?'texture_depth_multisampled_2d':'texture_depth_2d').replace('SCENE_DEPTH_REDUCE',ms?'for(var i=1u;i<textureNumSamples(sceneDepth);i++){solid=min(solid,textureLoad(sceneDepth,pixel,i));}':'');pipeline=device.createComputePipeline({label:'current single-grid extinction prefix',layout:'auto',compute:{module:device.createShaderModule({code}),entryPoint:'build'}});pipelines.set(ms,pipeline);}
   const depthEntries=depthField.entries();const entries=[{binding:0,resource:field.texture.createView()},{binding:1,resource:{buffer:options}},{binding:2,resource:depthEntries[0].resource},{binding:3,resource:depthEntries[1].resource},{binding:4,resource:prefix.createView()},{binding:5,resource:base.createView()},{binding:6,resource:sceneDepth.createView()}];
   const pass=encoder.beginComputePass({label:'independent current-grid extinction',...profileWrites('gridExtinction')});pass.setPipeline(pipeline);pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries}));pass.dispatchWorkgroups(Math.ceil(layout.width/8),Math.ceil(layout.height/8));pass.end();
  },
  entries(){return [{binding:6,resource:prefix.createView()},{binding:7,resource:base.createView()}];},
  get base(){return base;},dispose:destroy,
 };
}
