import * as THREE from './lib/three.webgpu.js';

export const MATERIAL_MOTION_WGSL=`
struct Params {dims:vec4<u32>,domain:vec4<f32>,previousFromCurrent:mat4x4<f32>,units:vec4<f32>}
@group(0) @binding(0) var<storage,read_write> fluid:array<vec4<f32>>;
@group(0) @binding(1) var gas:texture_3d<f32>;
@group(0) @binding(2) var<uniform> p:Params;
@compute @workgroup_size(4,4,4)
fn carryGas(@builtin(global_invocation_id) c:vec3<u32>){
 if(any(c>=p.dims.xyz)){return;}let supply=max(0.0,textureLoad(gas,vec3<i32>(c),0).x);
 if(supply<=0.0){return;}
 let world=(vec3<f32>(c)+.5)/f32(p.dims.x)*2.0*p.domain.w-vec3<f32>(p.domain.w)+p.domain.xyz;
 let previous=(p.previousFromCurrent*vec4<f32>(world,1.0)).xyz;
 let velocity=(world-previous)*p.units.x;
 let weight=1.0-exp(-supply*p.units.y);
 let i=(c.x+p.dims.x*(c.y+p.dims.y*c.z))*4u;
 fluid[i]=vec4<f32>(mix(fluid[i].xyz,velocity,weight),fluid[i].w);
}`;

export async function createMaterialMotionGpu({renderer,object}) {
 const device=renderer.backend.device;
 const module=device.createShaderModule({label:'material gas inherits rigid motion',code:MATERIAL_MOTION_WGSL});
 const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>m.message).join('; '));
 const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'carryGas'}});
 const uniform=device.createBuffer({label:'material rigid motion',size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 object.updateWorldMatrix(true,true);let previous=object.matrixWorld.clone(),steps=0,lastMotion=0;
 const inverse=new THREE.Matrix4(),mapping=new THREE.Matrix4();
 return {encode(encoder,frame,source){
   object.updateWorldMatrix(true,true);if(Math.abs(object.matrixWorld.determinant())<1e-12)throw Error('Material motion requires nonsingular transform');
   inverse.copy(object.matrixWorld).invert();mapping.copy(previous).multiply(inverse);
   lastMotion=Math.max(...mapping.elements.map((v,i)=>Math.abs(v-(i%5===0?1:0))));
   const bytes=new ArrayBuffer(112),floats=new Float32Array(bytes);new Uint32Array(bytes).set([...frame.dimensions,0]);
   floats.set([...frame.transform.translate,frame.transform.scale],4);floats.set(mapping.elements,8);
   floats.set([frame.dimensions[0]/(2*frame.transform.scale*frame.backtraceScale),frame.dt*60,0,0],24);
   device.queue.writeBuffer(uniform,0,bytes);
   const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:frame.fluid}},{binding:1,resource:source.descriptor.texture.createView()},{binding:2,resource:{buffer:uniform}}]});
   const pass=encoder.beginComputePass({label:'moving material gas momentum'});pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(...frame.dimensions.map(n=>Math.ceil(n/4)));pass.end();
   previous.copy(object.matrixWorld);steps++;
 },reset(){object.updateWorldMatrix(true,true);previous.copy(object.matrixWorld);lastMotion=0;},
 read:()=>({identity:'material-emitted-gas-rigid-motion-v1',steps,lastMotion,runtimeReadbacks:0,coupling:'emitted-gas-momentum',movingWallPressure:false}),dispose(){uniform.destroy();}};
}
