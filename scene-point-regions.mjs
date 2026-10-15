// Prototype: all source cells contribute to fixed vertical regions. No CPU
// readback, brightest-cell selection, or temporal history in the serving path.
export function pointRegionPlan(dimensions,count) {
  if(!Array.isArray(dimensions)||dimensions.length!==3||dimensions.some(n=>!Number.isInteger(n)||n<1))throw new Error('positive source dimensions required');
  if(!Number.isInteger(count)||count<1||count>dimensions[1])throw new Error('point region count must fit source height');
  return {dimensions:[...dimensions],count};
}
export function reducePointRegionsReference(values,dimensions,count,gain=1,partition='vertical') {
  pointRegionPlan(dimensions,count);
  if(!['vertical','energy'].includes(partition))throw Error('unknown point partition');
  if(values.length!==dimensions.reduce((a,b)=>a*b,4)||!Number.isFinite(gain)||gain<0)throw new Error('source values and gain invalid');
  if(partition==='energy'&&count>1){
    // First moments per height slice, then split its energy fractionally at
    // quantile boundaries. A boundary crossing a voxel never duplicates power.
    const slices=reducePointRegionsReference(values,dimensions,dimensions[1],gain);
    const weights=slices.map(r=>r.energy.reduce((a,b)=>a+b,0)),total=weights.reduce((a,b)=>a+b,0),floor=(2/dimensions[0])**2/4;
    return Array.from({length:count},(_,band)=>{
      const lo=total*band/count,hi=total*(band+1)/count;let prefix=0,weight=0,m2=0;
      const energy=[0,0,0],moment=[0,0,0];
      for(let y=0;y<slices.length;y++){
        const w=weights[y],part=Math.max(0,Math.min(prefix+w,hi)-Math.max(prefix,lo)),r=slices[y];prefix+=w;
        if(!w||!part)continue;
        weight+=part;for(let c=0;c<3;c++){energy[c]+=r.energy[c]*part/w;moment[c]+=r.position[c]*part;}
        m2+=(r.radiusSquared-floor+r.position.reduce((a,b)=>a+b*b,0))*part;
      }
      const position=moment.map(v=>weight?v/weight:0);
      return {position,energy,radiusSquared:Math.max(0,weight?m2/weight-position.reduce((a,b)=>a+b*b,0):0)+floor};
    });
  }
  const pitch=2/dimensions[0],rows=Array.from({length:count},()=>({position:[0,0,0],radiusSquared:0,energy:[0,0,0],weight:0}));
  for(let z=0;z<dimensions[2];z++)for(let y=0;y<dimensions[1];y++)for(let x=0;x<dimensions[0];x++){
    const row=rows[Math.min(count-1,Math.floor(y*count/dimensions[1]))],i=4*(x+dimensions[0]*(y+dimensions[1]*z));
    const rgb=[0,1,2].map(c=>Math.max(0,values[i+c])*gain*pitch**3),w=rgb.reduce((a,b)=>a+b,0),p=[x,y,z].map(v=>-1+(v+.5)*pitch);
    for(let a=0;a<3;a++){row.energy[a]+=rgb[a];row.position[a]+=p[a]*w;}
    row.radiusSquared+=p.reduce((s,v)=>s+v*v,0)*w;row.weight+=w;
  }
  return rows.map(({weight,position,radiusSquared,energy})=>{
    position=position.map(v=>weight?v/weight:0);
    return {position,energy,radiusSquared:Math.max(0,weight?radiusSquared/weight-position.reduce((s,v)=>s+v*v,0):0)+pitch*pitch/4};
  });
}

export const POINT_REGIONS_WGSL=/* wgsl */`
@group(0) @binding(0) var source:texture_3d<f32>;
@group(0) @binding(1) var output:texture_storage_2d<rgba32float,write>;
@group(0) @binding(2) var<uniform> settings:vec4<f32>;
var<workgroup> energy:array<vec4<f32>,64>;
var<workgroup> moment:array<vec4<f32>,64>;
@compute @workgroup_size(64)
fn reduce(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3<u32>){
 let dims=textureDimensions(source);let count=u32(settings.y);let band=group.x;
 // ceil bounds match floor(y * count / height), even for uneven bands.
 let first=(band*dims.y+count-1u)/count;let end=((band+1u)*dims.y+count-1u)/count;
 let height=end-first;let total=dims.x*height*dims.z;let pitch=2.0/f32(dims.x);
 var e=vec4<f32>(0);var m=vec4<f32>(0);
 for(var i=lane;i<total;i+=64u){
  let c=vec3<u32>(i%dims.x,first+(i/dims.x)%height,i/(dims.x*height));
  let rgb=max(textureLoad(source,vec3<i32>(c),0).rgb,vec3<f32>(0))*settings.x*pitch*pitch*pitch;
  let w=rgb.x+rgb.y+rgb.z;let p=-vec3<f32>(1)+(vec3<f32>(c)+vec3<f32>(.5))*pitch;
  e+=vec4<f32>(rgb,w);m+=vec4<f32>(p*w,dot(p,p)*w);
 }
 energy[lane]=e;moment[lane]=m;workgroupBarrier();
 for(var stride=32u;stride>0u;stride/=2u){
  if(lane<stride){energy[lane]+=energy[lane+stride];moment[lane]+=moment[lane+stride];}workgroupBarrier();
 }
 if(lane==0u){
  let w=energy[0].w;let p=moment[0].xyz/max(w,1e-30);
  let radius=max(0.0,moment[0].w/max(w,1e-30)-dot(p,p))+pitch*pitch*.25;
  textureStore(output,vec2<i32>(i32(band),0),vec4<f32>(p,radius));
  textureStore(output,vec2<i32>(i32(band),1),vec4<f32>(energy[0].rgb,w));
 }
}`;

// Same full-cell reduction, one group per y slice. The second tiny dispatch
// integrates equal-energy intervals in the cumulative slice distribution.
// Neither dispatch reads back to the CPU or depends on the emitter envelope.
export const ENERGY_ROWS_WGSL=POINT_REGIONS_WGSL
 .replace('@group(0) @binding(1) var output:texture_storage_2d<rgba32float,write>;', '@group(0) @binding(1) var<storage,read_write> rows:array<vec4<f32>>;')
 .replace('let count=u32(settings.y);','let count=dims.y;')
 .replace('textureStore(output,vec2<i32>(i32(band),0),vec4<f32>(p,radius));','rows[band*2u]=energy[0];')
 .replace('textureStore(output,vec2<i32>(i32(band),1),vec4<f32>(energy[0].rgb,w));','rows[band*2u+1u]=moment[0];');
export const ENERGY_REGIONS_WGSL=/* wgsl */`
@group(0) @binding(0) var<storage,read> rows:array<vec4<f32>>;
@group(0) @binding(1) var output:texture_storage_2d<rgba32float,write>;
@group(0) @binding(2) var<uniform> settings:vec4<f32>;
@compute @workgroup_size(1)
fn reduce(@builtin(workgroup_id) group:vec3<u32>){
 let height=u32(settings.z);let count=settings.y;let band=group.x;
 var total=0.0;for(var y=0u;y<height;y++){total+=rows[y*2u].w;}
 let lo=total*f32(band)/count;let hi=total*f32(band+1u)/count;
 var prefix=0.0;var e=vec4<f32>(0);var m=vec4<f32>(0);
 for(var y=0u;y<height;y++){
  let r=rows[y*2u];let part=max(0.0,min(prefix+r.w,hi)-max(prefix,lo));prefix+=r.w;
  if(r.w>0.0&&part>0.0){let fraction=part/r.w;e+=r*fraction;m+=rows[y*2u+1u]*fraction;}
 }
 let p=m.xyz/max(e.w,1e-30);
 let radius=max(0.0,m.w/max(e.w,1e-30)-dot(p,p))+settings.w*settings.w*.25;
 textureStore(output,vec2<i32>(i32(band),0),vec4<f32>(p,radius));
 textureStore(output,vec2<i32>(i32(band),1),e);
}`;

export function createPointRegions(device,{count=4,partition='vertical'}={}) {
  if(!['vertical','energy'].includes(partition))throw Error('unknown point partition');
  if(!Number.isInteger(count)||count<1||count>device.limits.maxTextureDimension2D||count>device.limits.maxComputeWorkgroupsPerDimension)throw new Error('point count exceeds device capacity');
  const texture=device.createTexture({label:'live hybrid surface point regions',size:[count,2],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
  const params=device.createBuffer({label:'hybrid point reduction parameters',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const adaptive=partition==='energy'&&count>1;
  const pipeline=device.createComputePipeline({label:'all-cell source to surface points',layout:'auto',compute:{module:device.createShaderModule({code:adaptive?ENERGY_ROWS_WGSL:POINT_REGIONS_WGSL}),entryPoint:'reduce'}});
  const finish=adaptive?device.createComputePipeline({label:'equal-energy surface points',layout:'auto',compute:{module:device.createShaderModule({code:ENERGY_REGIONS_WGSL}),entryPoint:'reduce'}}):null;
  let sourceTexture=null,group=null,metadata=null,disposed=false,rows=null,rowHeight=0,finishGroup=null;
  return {texture,count,
    encode(field){
      if(disposed||field.status!=='encoded'||!field.texture)throw new Error('point reduction requires current encoded source');
      pointRegionPlan(field.dimensions,count);
      if(!Number.isFinite(field.gain)||field.gain<0)throw new Error('point reduction requires nonnegative gain');
      if(adaptive&&rowHeight!==field.dimensions[1]){
        rows?.destroy();rowHeight=field.dimensions[1];rows=device.createBuffer({label:'emitting height moments',size:rowHeight*32,usage:GPUBufferUsage.STORAGE});sourceTexture=null;
        finishGroup=device.createBindGroup({layout:finish.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:rows}},{binding:1,resource:texture.createView()},{binding:2,resource:{buffer:params}}]});
      }
      if(sourceTexture!==field.texture){group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:field.texture.createView()},{binding:1,resource:adaptive?{buffer:rows}:texture.createView()},{binding:2,resource:{buffer:params}}]});sourceTexture=field.texture;}
      device.queue.writeBuffer(params,0,new Float32Array([field.gain,count,field.dimensions[1],2/field.dimensions[0]]));
      const encoder=device.createCommandEncoder({label:'hybrid live surface light reduction'}),pass=encoder.beginComputePass();
      pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(adaptive?rowHeight:count);pass.end();
      if(adaptive){const end=encoder.beginComputePass();end.setPipeline(finish);end.setBindGroup(0,finishGroup);end.dispatchWorkgroups(count);end.end();}
      device.queue.submit([encoder.finish()]);
      metadata={identity:adaptive?'all-cell-equal-energy-point-regions-v1':'all-cell-vertical-point-regions-v0',partition,count,generation:field.generation,frame:field.frame,gain:field.gain,sourceCells:field.dimensions.reduce((a,b)=>a*b,1)};
      return {...metadata};
    },
    debugState:()=>metadata?{...metadata}:null,
    async readback(){
      if(disposed||!metadata)throw Error('point reduction requires current encoded source');
      const identity={...metadata},bytesPerRow=Math.ceil(count*16/256)*256;
      const buffer=device.createBuffer({label:'point region diagnostic readback',size:bytesPerRow*2,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      try{
        const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture},{buffer,bytesPerRow},[count,2,1]);device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);const values=new Float32Array(buffer.getMappedRange());
        return {...identity,regions:Array.from({length:count},(_,i)=>({position:Array.from(values.slice(i*4,i*4+3)),radiusSquared:values[i*4+3],energy:Array.from(values.slice(bytesPerRow/4+i*4,bytesPerRow/4+i*4+3))}))};
      }finally{buffer.destroy();}
    },
    destroy(){disposed=true;metadata=null;texture.destroy();params.destroy();rows?.destroy();},
  };
}
