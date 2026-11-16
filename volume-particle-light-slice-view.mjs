export const PARTICLE_LIGHT_SLICE_VIEW_WGSL=/* wgsl */`
struct SliceView {start:vec4<f32>, along:vec4<f32>, across:vec4<f32>, up:vec4<f32>}
@group(0) @binding(12) var<storage,read> sliceLight:array<vec4<f32>>;
@group(0) @binding(13) var<uniform> sliceView:SliceView;
fn sliceIncident(position:vec3<f32>)->vec3<f32>{
 let p=position-sliceView.start.xyz;
 let z=dot(p,sliceView.along.xyz)/sliceView.along.w;
 let x=dot(p,sliceView.across.xyz)/(2.0*sliceView.start.w)+.5;
 let y=.5-dot(p,sliceView.up.xyz)/(2.0*sliceView.start.w);
 let q=vec3<f32>(x,y,z);
 if(any(q<vec3<f32>(0))||any(q>=vec3<f32>(1))){return vec3<f32>(0);}
 let width=u32(sliceView.across.w);let sections=u32(sliceView.up.w);
 let i=vec3<u32>(q*vec3<f32>(f32(width),f32(width),f32(sections)));
 return sliceLight[(i.y*width+i.x)*sections+i.z].xyz;
}
`;

export function createParticleLightSliceView(device,retire){
 let field=null,parameters=null,epoch=null;
 const usage=()=>GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST;
 return {
  set(next){
   if(next===null){epoch=null;return;}
   const {identity,axis,values}=next;
   if(!Number.isSafeInteger(identity?.epoch)||!(axis instanceof Float32Array)||axis.length!==16||!axis.every(Number.isFinite)||
      ![axis[11],axis[15]].every(n=>Number.isSafeInteger(n)&&n>0)||
      !(axis[3]>0&&axis[7]>0)||!(values instanceof Float32Array)||
      values.length!==axis[11]*axis[11]*axis[15]*4||!values.every(v=>Number.isFinite(v)&&v>=0))throw Error('Invalid selected beam view');
   if(values.byteLength>Math.min(device.limits.maxBufferSize,device.limits.maxStorageBufferBindingSize))throw Error('Selected beam view exceeds device capacity');
   if(!field||field.size!==values.byteLength){
    if(field)retire([field]);
    field=device.createBuffer({label:'diagnostic beam radiance volume',size:values.byteLength,usage:usage()});
   }
   parameters??=device.createBuffer({label:'diagnostic beam geometry',size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
   device.queue.writeBuffer(parameters,0,axis);
   device.queue.writeBuffer(field,0,values);
   epoch=identity.epoch;
  },
  entries(currentEpoch){return epoch!==null&&currentEpoch===epoch?[{binding:12,resource:{buffer:field}},{binding:13,resource:{buffer:parameters}}]:[];},
  dispose(){retire([field,parameters].filter(Boolean));field=parameters=epoch=null;},
 };
}
