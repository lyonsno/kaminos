import {LOG_RESIDUE,LOG_MATERIAL_EPSILON} from './log-consumption.mjs';
import {Vector3} from './lib/three.core.js';

export const BURN_REGION_BODIES_WGSL=`
struct Cell {material:vec4f,burn:vec4f}
struct Params {lo:vec4f,pitch:vec4f,grid:vec4u}
@group(0) @binding(0) var<storage,read> material:array<Cell>;
@group(0) @binding(1) var<storage,read> spans:array<vec2u>;
@group(0) @binding(2) var<storage,read> samples:array<u32>;
@group(0) @binding(3) var<storage,read_write> shape:array<vec4f>;
@group(0) @binding(4) var<storage,read_write> rest:array<vec4f>;
@group(0) @binding(5) var<uniform> p:Params;
@group(0) @binding(6) var<storage,read_write> positions:array<vec4f>;
@group(0) @binding(7) var<storage,read> rotations:array<vec4f>;
@group(0) @binding(8) var<storage,read_write> boxes:array<vec4f>;
@group(0) @binding(9) var<storage,read_write> inertia:array<vec4f>;
@group(0) @binding(10) var<storage,read_write> velocities:array<vec4f>;
@group(0) @binding(11) var<storage,read> angular:array<vec4f>;
@group(0) @binding(12) var<storage,read_write> joints:array<vec4f>;
@group(0) @binding(13) var<storage,read_write> contacts:array<vec4f>;
@group(0) @binding(14) var<storage,read> envelopes:array<vec4f>;
fn rotate(q:vec4f,v:vec3f)->vec3f{return v+2.0*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
@compute @workgroup_size(64) fn reduce(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=arrayLength(&spans)){return;}let span=spans[i];
 if(span.y==0u){
  shape[i*3u]=rest[i];
  shape[i*3u+1u]=vec4f(boxes[i].yzw,1);
  return;
 }
 var lo=vec3f(1e30);var hi=vec3f(-1e30);var fuel=0.0;var alive=0u;
 for(var s=span.x;s<span.x+span.y;s++){
  let cell=samples[s];let retained=material[cell].burn.y;
  if(retained<=${LOG_RESIDUE+LOG_MATERIAL_EPSILON}){continue;}
  let c=vec3u(cell%p.grid.x,(cell/p.grid.x)%p.grid.y,cell/(p.grid.x*p.grid.y));
  let center=p.lo.xyz+(vec3f(c)+.5)*p.pitch.xyz;
  lo=min(lo,center-p.pitch.xyz*.5);hi=max(hi,center+p.pitch.xyz*.5);fuel+=retained;alive++;
 }
 // Voxel occupancy is conservative. It cannot grow the authored piece or
 // introduce a cold overlap with a support that the original surface cleared;
 // while no cell in the region has disintegrated, keep the original envelope.
 if(alive==span.y){lo=envelopes[i*2u].xyz;hi=envelopes[i*2u+1u].xyz;}
 else{lo=max(lo,envelopes[i*2u].xyz);hi=min(hi,envelopes[i*2u+1u].xyz);}
 if(fuel>0.0&&all(hi>lo)){shape[i*3u]=vec4f((lo+hi)*.5,rest[i].w*fuel/f32(span.y));shape[i*3u+1u]=vec4f((hi-lo)*.5,1);}
 else{shape[i*3u]=vec4f(rest[i].xyz,0);shape[i*3u+1u]=vec4f(0);}
}
@compute @workgroup_size(64) fn apply(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=p.grid.w){return;}let current=shape[i*3u];let half=shape[i*3u+1u].xyz;
 let delta=current.xyz-rest[i].xyz;let q=normalize(rotations[i]);let worldDelta=rotate(q,delta);
 let inverse=select(0.0,1.0/max(current.w,1e-30),current.w>0.0);
 let changed=any(delta!=vec3f(0))||any(boxes[i].yzw!=half)||(positions[i].w>0.0)!=(inverse>0.0);
 shape[i*3u+2u]=vec4f(delta,select(0.0,1.0,changed));
 positions[i]=vec4f(positions[i].xyz+worldDelta,inverse);
 velocities[i]=vec4f(velocities[i].xyz+cross(angular[i].xyz,worldDelta),velocities[i].w);
 rest[i]=vec4f(current.xyz,rest[i].w);
 var flags=bitcast<u32>(boxes[i].x);flags=(flags&0x00ffffffu)|select(0u,2u<<24u,current.w>0.0);
 boxes[i]=vec4f(bitcast<f32>(flags),half);
 let diagonal=3.0*inverse/max(vec3f(half.y*half.y+half.z*half.z,half.x*half.x+half.z*half.z,half.x*half.x+half.y*half.y),vec3f(1e-30));
 inertia[i]=vec4f(diagonal,inverse);
}
@compute @workgroup_size(64) fn rebaseJoints(@builtin(global_invocation_id) id:vec3u){
 let b=id.x*11u;if(b+10u>=arrayLength(&joints)){return;}
 var ids=bitcast<vec4u>(joints[b]);if(ids.x>=p.grid.w||ids.y>=p.grid.w){return;}
 joints[b+1u]=vec4f(joints[b+1u].xyz-shape[ids.x*3u+2u].xyz,joints[b+1u].w);
 joints[b+2u]=vec4f(joints[b+2u].xyz-shape[ids.y*3u+2u].xyz,joints[b+2u].w);
 if(shape[ids.x*3u].w==0.0||shape[ids.y*3u].w==0.0){ids.w=0u;joints[b]=bitcast<vec4f>(ids);for(var k=5u;k<11u;k++){joints[b+k]=vec4f(0);}}
}
@compute @workgroup_size(64) fn resetContact(@builtin(global_invocation_id) id:vec3u){
 let b=id.x*9u;if(b+8u>=arrayLength(&contacts)){return;}let c=contacts[b];if(c.z<=0.0){return;}
 var changed=false;if(u32(c.x)<p.grid.w){changed=shape[u32(c.x)*3u+2u].w>0.0;}
 if(u32(c.y)<p.grid.w){changed=changed||shape[u32(c.y)*3u+2u].w>0.0;}
 if(changed){contacts[b+5u]=vec4f(0,0,0,contacts[b+5u].w);contacts[b+6u]=vec4f(0);}
}`;

export async function createBurnRegionBodiesGpu({device,field,mapping,envelopes,rest,positions,rotations,boxes,inertia,velocities,angular,joints,contacts}){
 const {bounds,dimensions}=field.residentState(),n=mapping.counts.length,owned=[],groups=new WeakMap();
 if(envelopes?.length!==n||envelopes.some(b=>!b||!['min','max'].every(k=>Array.isArray(b[k])&&b[k].length===3&&b[k].every(Number.isFinite))||b.min.some((v,k)=>v>=b.max[k])))throw Error('Original positive material envelopes required');
 const allocate=(data,usage=GPUBufferUsage.STORAGE)=>{const b=device.createBuffer({size:Math.max(16,data.byteLength),usage:usage|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});owned.push(b);device.queue.writeBuffer(b,0,data);return b;};
 try{
  const spans=allocate(mapping.spans),samples=allocate(mapping.cells),shape=allocate(new Float32Array(n*12)),originalBounds=allocate(Float32Array.from(envelopes.flatMap(b=>[...b.min,0,...b.max,0])));
  const raw=new ArrayBuffer(48);new Float32Array(raw).set([...bounds.min.toArray(),0,...bounds.getSize(new Vector3()).toArray().map((v,k)=>v/dimensions[k]),0]);new Uint32Array(raw).set([...dimensions,n],8);
  const params=allocate(new Uint8Array(raw),GPUBufferUsage.UNIFORM),module=device.createShaderModule({label:'Live remaining material bodies',code:BURN_REGION_BODIES_WGSL});
  const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>m.message).join('\n'));
  const bindings={1:spans,2:samples,3:shape,4:rest,5:params,6:positions,7:rotations,8:boxes,9:inertia,10:velocities,11:angular,12:joints,13:contacts,14:originalBounds};
  const indices={reduce:[0,1,2,3,4,5,8,14],apply:[3,4,5,6,7,8,9,10,11],rebaseJoints:[3,5,12],resetContact:[3,5,13]},pipelines={};
  for(const name of Object.keys(indices))pipelines[name]=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:name}});
  return {shape,encode(encoder){
   const material=field.residentState().after;let current=groups.get(material);
   if(!current){current={};for(const name of Object.keys(indices))current[name]=device.createBindGroup({layout:pipelines[name].getBindGroupLayout(0),entries:indices[name].map(binding=>({binding,resource:{buffer:binding===0?material:bindings[binding]}}))});groups.set(material,current);}
   for(const name of Object.keys(indices)){const count=name==='rebaseJoints'?joints.size/(11*16):name==='resetContact'?contacts.size/(9*16):n;if(!count)continue;const pass=encoder.beginComputePass({label:'Remaining material '+name});pass.setPipeline(pipelines[name]);pass.setBindGroup(0,current[name]);pass.dispatchWorkgroups(Math.ceil(count/64));pass.end();}
  },dispose(){owned.forEach(b=>b.destroy());}};
 }catch(error){owned.forEach(b=>b.destroy());throw error;}
}
