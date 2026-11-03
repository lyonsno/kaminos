import {sceneLightingDomain,sceneSourceDomain} from './scene-volume-source.mjs';

export function validateShadowMediumResolution(value=0){
  if(!Number.isSafeInteger(value)||value<0)throw Error('shadow medium resolution must be a nonnegative integer');
  return value;
}
export function shadowMediumPlan(sourceDimensions,resolution,limits={}){
  sceneSourceDomain(sourceDimensions);validateShadowMediumResolution(resolution);
  if(!resolution)throw Error('prepared shadow medium needs a positive resolution');
  const dimensions=[resolution,Math.max(1,Math.round(resolution*sourceDimensions[1]/sourceDimensions[0])),resolution];
  const dispatch=dimensions.map(n=>Math.ceil(n/4));
  if(dimensions.some(n=>n>(limits.maxTextureDimension3D??256)))throw Error('shadow medium grid exceeds device texture capacity');
  if(dispatch.some(n=>n>(limits.maxComputeWorkgroupsPerDimension??65535)))throw Error('shadow medium dispatch exceeds device capacity');
  const axisReads=dimensions.map((n,a)=>Array.from({length:n},(_,i)=>Math.ceil((i+1)*sourceDimensions[a]/n)-Math.floor(i*sourceDimensions[a]/n)).reduce((x,y)=>x+y,0));
  return {resolution,dimensions,dispatch,bytes:dimensions.reduce((x,y)=>x*y,4),sourceReads:axisReads.reduce((x,y)=>x*y,1),domain:sceneSourceDomain(sourceDimensions)};
}

// Offline reference: volume-overlap averages of already classified extinction.
// Domain extent stays exact even when the smaller grid has rectangular cells.
export function shadowMediumReference(field,resolution){
  const plan=shadowMediumPlan(field.dimensions,resolution,{maxTextureDimension3D:Infinity}),src=field.dimensions,dst=plan.dimensions;
  const values=new Float32Array(dst.reduce((a,b)=>a*b,1));
  for(let z=0;z<dst[2];z++)for(let y=0;y<dst[1];y++)for(let x=0;x<dst[0];x++){
    const a=[x,y,z].map((c,k)=>c*src[k]/dst[k]),b=[x+1,y+1,z+1].map((c,k)=>c*src[k]/dst[k]);let sum=0;
    for(let k=Math.floor(a[2]);k<Math.ceil(b[2]);k++)for(let j=Math.floor(a[1]);j<Math.ceil(b[1]);j++)for(let i=Math.floor(a[0]);i<Math.ceil(b[0]);i++){
      const w=[i,j,k].reduce((w,c,q)=>w*Math.max(0,Math.min(b[q],c+1)-Math.max(a[q],c)),1);
      sum+=Math.max(0,field.values[4*(i+src[0]*(j+src[1]*k))+3])*w;
    }
    values[x+dst[0]*(y+dst[1]*z)]=sum/b.reduce((v,c,k)=>v*(c-a[k]),1);
  }
  return {...plan,values};
}
export function sampleShadowMediumReference(field,p){
  const {dimensions:d,domain:{lo,hi},values}=field,q=p.map((v,a)=>(v-lo[a])/(hi[a]-lo[a])*d[a]-.5),base=q.map(Math.floor),f=q.map((v,a)=>v-base[a]);let sum=0;
  for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++){
    const c=[x,y,z].map((v,a)=>Math.max(0,Math.min(d[a]-1,base[a]+v))),w=[x,y,z].reduce((w,v,a)=>w*(v?f[a]:1-f[a]),1);
    sum+=values[c[0]+d[0]*(c[1]+d[1]*c[2])]*w;
  }
  return sum;
}

export function createShadowMedium(device){
  let texture=null,pipeline=null,group=null,source=null,plan=null,signature=null,committed=null,pending=null,builds=0;
  const same=(a,b)=>a&&b&&a.source===b.source&&a.generation===b.generation&&a.frame===b.frame&&a.signature===b.signature;
  return {
    encode(encoder,field,resolution){
      if(field.status!=='encoded'||!field.texture?.createView)throw Error('shadow medium requires current encoded extinction');
      const domain=sceneLightingDomain(field),nextPlan=shadowMediumPlan(field.dimensions,resolution,device.limits),nextSignature=JSON.stringify([field.dimensions,nextPlan.dimensions]);
      pipeline??=device.createComputePipeline({label:'volume-average shadow extinction',layout:'auto',compute:{module:device.createShaderModule({code:SHADOW_MEDIUM_WGSL}),entryPoint:'prepareMedium'}});
      if(signature!==nextSignature||source!==field.texture){
        const nextTexture=signature===nextSignature?texture:device.createTexture({label:'prepared coarse shadow extinction',dimension:'3d',size:nextPlan.dimensions,format:'r32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});
        let nextGroup;try{nextGroup=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:field.texture.createView()},{binding:1,resource:nextTexture.createView()}]});}catch(error){if(nextTexture!==texture)nextTexture.destroy();throw error;}
        if(nextTexture!==texture){texture?.destroy();committed=null;}
        texture=nextTexture;group=nextGroup;source=field.texture;plan=nextPlan;signature=nextSignature;
      }
      const key={source:field.texture,generation:field.generation,frame:field.frame,signature};
      pending={...key,encoded:!same(committed,key)};
      if(pending.encoded){const pass=encoder.beginComputePass({label:'prepare coarse smoke-shadow density'});pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(...plan.dispatch);pass.end();}
      return {texture,metadata:{mode:'prepared',resolution,dimensions:[...plan.dimensions],domain:{lo:[...domain.lo],hi:[...domain.hi]},format:'r32float',filter:'volume-overlap-average',bytes:plan.bytes,preparationSourceReads:pending.encoded?plan.sourceReads:0,sourceGeneration:field.generation,sourceFrame:field.frame,builds:builds+(pending.encoded?1:0),completionAuthority:false}};
    },
    commit(){if(pending){if(pending.encoded)builds++;committed=pending;pending=null;}},
    invalidate(){committed=null;pending=null;},
    destroy(){texture?.destroy();texture=null;group=null;committed=null;pending=null;},
  };
}

export const SHADOW_MEDIUM_WGSL=/* wgsl */`
@group(0) @binding(0) var source:texture_3d<f32>;
@group(0) @binding(1) var output:texture_storage_3d<r32float,write>;
@compute @workgroup_size(4,4,4)
fn prepareMedium(@builtin(global_invocation_id) c:vec3<u32>){
 let dst=textureDimensions(output);if(any(c>=dst)){return;}
 let src=textureDimensions(source);let a=vec3<f32>(c)*vec3<f32>(src)/vec3<f32>(dst);let b=vec3<f32>(c+vec3<u32>(1))*vec3<f32>(src)/vec3<f32>(dst);
 let first=vec3<i32>(floor(a));let last=min(vec3<i32>(ceil(b)),vec3<i32>(src));var sum=0.0;
 for(var z=first.z;z<last.z;z++){for(var y=first.y;y<last.y;y++){for(var x=first.x;x<last.x;x++){
  let cell=vec3<i32>(x,y,z);let w=max(vec3<f32>(0),min(b,vec3<f32>(cell)+vec3<f32>(1))-max(a,vec3<f32>(cell)));
  sum+=max(0.0,textureLoad(source,cell,0).a)*w.x*w.y*w.z;
 }}}
 let span=b-a;textureStore(output,vec3<i32>(c),vec4<f32>(sum/(span.x*span.y*span.z),0,0,0));
}`;
