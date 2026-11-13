// Current incoming angular-mean radiance, consumed by native particle rendering.
export const PARTICLE_INCIDENT_WGSL=/* wgsl */`
struct ParticleIncidentConfig {origin:vec4<f32>,extent:vec4<f32>,dims:vec4<u32>,weights:vec4<f32>}
@group(1) @binding(0) var<storage,read> particleIncident:array<vec4<f32>>;
@group(1) @binding(1) var<uniform> particleIncidentConfig:ParticleIncidentConfig;
fn particleIncoming(point:vec3<f32>)->vec3<f32>{
 let q=(point-particleIncidentConfig.origin.xyz)/particleIncidentConfig.extent.xyz;
 if(any(q<vec3<f32>(0))||any(q>vec3<f32>(1))){return vec3<f32>(0);}
 let dims=particleIncidentConfig.dims.xyz;let at=q*vec3<f32>(dims)-.5;let base=vec3<i32>(floor(at));let f=fract(at);var result=vec3<f32>(0);
 for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let corner=vec3<i32>(x,y,z);let p=vec3<u32>(clamp(base+corner,vec3<i32>(0),vec3<i32>(dims)-vec3<i32>(1)));
  let w=select(vec3<f32>(1)-f,f,corner==vec3<i32>(1));result+=particleIncident[p.x+dims.x*(p.y+dims.y*p.z)].xyz*w.x*w.y*w.z;
 }}}return max(result,vec3<f32>(0))*particleIncidentConfig.weights.z;
}
fn particleRenderMaterial(p:Particle,u:Options)->vec4<f32>{
 let original=particleMaterial(p,u);if(particleIncidentConfig.weights.x<.5){return original;}
 let fade=select(select(1.0,particleLifeFade(p.motion.w,u.lifeControl.y),u.lifeControl.x>0),1.0-clamp(p.motion.w,0.0,1.0),u.lighting.z>.5);
 let intrinsic=p.emission.xyz*u.gain.x*p.shape.w*fade;
 let scattered=original.w*particleIncidentConfig.weights.y*particleIncoming(p.anchor.xyz);
 let mode=particleIncidentConfig.weights.w;
 return vec4<f32>(select(vec3<f32>(0),intrinsic,mode!=1.0)+select(vec3<f32>(0),scattered,mode!=0.0),original.w);
}
`;
export function validateParticleIncident(field,limits){
 if(field===null)return null;
 for(const k of ['dims','origin','extent'])if(!Array.isArray(field[k])||field[k].length!==3||field[k].some(v=>!Number.isFinite(v)||!Number.isFinite(Math.fround(v))))throw Error('Invalid incident field '+k);
 if(field.dims.some(v=>!Number.isSafeInteger(v)||v<1||v>0xffffffff)||field.extent.some(v=>v<=0))throw Error('Invalid incident field shape');
 const count=field.dims.reduce((a,b)=>a*b,1),bytes=count*16;
 if(!Number.isSafeInteger(bytes)||bytes>Math.min(limits.maxBufferSize,limits.maxStorageBufferBindingSize))throw Error('Incident field exceeds native device capacity');
 if(!(field.data instanceof Float32Array)||field.data.length!==count*4||!field.data.every(v=>Number.isFinite(v)&&v>=0))throw Error('A complete nonnegative incident field is required');
 if(typeof field.sourceIdentity!=='string'||!Number.isFinite(field.sourceStep)||field.sourceStep<0||!Number.isFinite(field.albedo)||field.albedo<0||field.albedo>1||!Number.isFinite(field.gain)||field.gain<0||![0,1,2].includes(field.mode??2))throw Error('Invalid incident field identity or display');
 return {...field,dims:[...field.dims],origin:[...field.origin],extent:[...field.extent],mode:field.mode??2};
}
export function createParticleIncidentConsumer(device){
 const uniform=device.createBuffer({label:'native particle incident field coordinates',size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 const empty=device.createBuffer({label:'disabled native particle incident field',size:16,usage:GPUBufferUsage.STORAGE});let buffer=empty,field=null,disposed=false,active=false;
 const retire=b=>{if(b!==empty)queueMicrotask(()=>device.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>b.destroy()));};
 function set(next){if(disposed)throw Error('Particle incident consumer is disposed');const accepted=validateParticleIncident(next,device.limits);
  if(!accepted){retire(buffer);buffer=empty;field=null;return;}
  if(buffer===empty||buffer.size!==accepted.data.byteLength){const old=buffer;buffer=device.createBuffer({label:'native particle current incoming radiance',size:accepted.data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});retire(old);}
  device.queue.writeBuffer(buffer,0,accepted.data);const {data,...metadata}=accepted;field=metadata;
 }
 function prepare(identity){active=!!field&&field.sourceIdentity===identity;const bytes=new ArrayBuffer(64),f=new Float32Array(bytes),u=new Uint32Array(bytes);f.set(field?.origin??[0,0,0]);f.set(field?.extent??[1,1,1],4);u.set(field?.dims??[1,1,1],8);f.set([Number(active),field?.albedo??0,field?.gain??0,field?.mode??2],12);device.queue.writeBuffer(uniform,0,bytes);}
 return {set,prepare,group:pipeline=>device.createBindGroup({layout:pipeline.getBindGroupLayout(1),entries:[{binding:0,resource:{buffer}},{binding:1,resource:{buffer:uniform}}]}),read:()=>({effective:active?'live-angular-field':field?'source-mismatch':'captured-light',field:field?{...field}:null,bytes:uniform.size+empty.size+(buffer===empty?0:buffer.size)}),dispose(){if(disposed)return;disposed=true;const resources=[uniform,empty,...(buffer===empty?[]:[buffer])];queueMicrotask(()=>device.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>resources.forEach(r=>r.destroy())));}};
}
