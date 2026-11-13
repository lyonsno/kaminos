// Spatial part of the released StandardWeb training configuration, pinned at
// straintensor/NeuMIP c1e2f2aa3488b7460cbf19f5bf6d1c4343926178.
// The objective and target generator are selected separately by callers.
export const AUTHOR_SPATIAL_RECIPE='author-web-spatial-v1';
export const LEGACY_SPATIAL_RECIPE='legacy-unsmoothed-v1';
export function checkedNeumipTrainingRecipe(recipe=LEGACY_SPATIAL_RECIPE){
 if(![AUTHOR_SPATIAL_RECIPE,LEGACY_SPATIAL_RECIPE].includes(recipe))throw Error('Unknown NeuMIP training recipe: '+recipe);
 return recipe;
}
export function neumipSpatialTrainingState(recipe,step){
 checkedNeumipTrainingRecipe(recipe);if(!Number.isSafeInteger(step)||step<0)throw Error('Invalid NeuMIP spatial step');
 if(recipe===LEGACY_SPATIAL_RECIPE)return {recipe,step,appearanceSigma:0,offsetSigma:0,trainOffsetField:true,dampAppearance:false};
 const appearanceSigma=Math.max(.1,8*2**(-step/(10000/3)));
 return {recipe,step,appearanceSigma,offsetSigma:Math.max(1,appearanceSigma),trainOffsetField:step<=10000,dampAppearance:step<3000&&step%100===0};
}

export function buildNeumipSpatialFilterWGSL(layout){
 const fields=layout.fields;
 return `
struct Spatial { offsetSigma:f32,appearanceSigma:f32,constantSigma:f32,pad1:u32 }
@group(0) @binding(0) var<storage,read> source:array<f32>;
@group(0) @binding(1) var<storage,read_write> destination:array<f32>;
@group(0) @binding(2) var<uniform> state:Spatial;
const WIDTH:array<u32,${fields.length}>=array<u32,${fields.length}>(${fields.map(f=>f.width+'u').join(',')});
const HEIGHT:array<u32,${fields.length}>=array<u32,${fields.length}>(${fields.map(f=>f.height+'u').join(',')});
const CHANNELS:array<u32,${fields.length}>=array<u32,${fields.length}>(${fields.map(f=>f.channels+'u').join(',')});
const FIELD:array<u32,${fields.length}>=array<u32,${fields.length}>(${fields.map(f=>f.offset+'u').join(',')});
fn filtered(index:u32,horizontal:bool)->f32{
 if(index<${layout.weightCount}u){return source[index];}
 var f=0u;
 for(var j=1u;j<${fields.length}u;j++){if(index>=FIELD[j]){f=j;}}
 var sigma=state.offsetSigma;
 if(f>0u){sigma=state.appearanceSigma/pow(2.0,f32(f-1u));}
 if(state.constantSigma>0.0){sigma=select(state.constantSigma,0.0,f==0u);}
 // Matches utils.tensor.blur1d: small sigmas are an exact identity.
 if(sigma<0.2){return source[index];}
 let radius=i32(ceil(3.0*sigma));let c=(index-FIELD[f])%CHANNELS[f];let pixel=(index-FIELD[f])/CHANNELS[f];
 let x=i32(pixel%WIDTH[f]);let y=i32(pixel/WIDTH[f]);let w=i32(WIDTH[f]);let h=i32(HEIGHT[f]);var total=0.0;var norm=0.0;
 for(var k=-radius;k<=radius;k++){
  let weight=exp(-f32(k*k)/(2.0*sigma*sigma));
  let xx=((x+select(0,k,horizontal))%w+w)%w;let yy=((y+select(k,0,horizontal))%h+h)%h;
  total+=weight*source[FIELD[f]+(u32(yy)*WIDTH[f]+u32(xx))*CHANNELS[f]+c];norm+=weight;
 }
 return total/norm;
}
@compute @workgroup_size(64) fn vertical(@builtin(global_invocation_id) id:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){
 let i=id.x+id.y*groups.x*64u;if(i<${layout.count}u){destination[i]=filtered(i,false);}
}
@compute @workgroup_size(64) fn horizontal(@builtin(global_invocation_id) id:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){
 let i=id.x+id.y*groups.x*64u;if(i<${layout.count}u){destination[i]=filtered(i,true);}
}
@compute @workgroup_size(64) fn damp_blend(@builtin(global_invocation_id) id:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){
 let i=id.x+id.y*groups.x*64u;
 if(i>=${fields[1].offset}u&&i<${layout.count}u){destination[i]=0.9*destination[i]+0.1*source[i];}
}`;
}

export async function createNeumipSpatialFilter(device,layout,{parameters,gradients,storage,buffers}){
 const bytes=layout.count*4,filtered=storage('neumip filtered parameters',bytes),scratch=storage('neumip spatial scratch',bytes),rawGradient=storage('neumip raw parameter gradient',bytes);
 const config=device.createBuffer({label:'neumip spatial sigma',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});buffers.push(config);
 const dampConfig=device.createBuffer({label:'neumip fixed raw damping sigma',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});buffers.push(dampConfig);device.queue.writeBuffer(dampConfig,0,new Float32Array([0,0,1.03,0]));
 const bindings=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}}]});
 const code=buildNeumipSpatialFilterWGSL(layout),module=device.createShaderModule({label:'NeuMIP periodic spatial filter and adjoint',code}),info=await module.getCompilationInfo();
 if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.filter(m=>m.type==='error').map(m=>m.message).join('\n'));
 const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[bindings]}),pipelines={};
 for(const entryPoint of ['vertical','horizontal','damp_blend'])pipelines[entryPoint]=await device.createComputePipelineAsync({label:'NeuMIP spatial '+entryPoint,layout:pipelineLayout,compute:{module,entryPoint}});
 const group=(source,target,uniform=config)=>device.createBindGroup({layout:bindings,entries:[{binding:0,resource:{buffer:source}},{binding:1,resource:{buffer:target}},{binding:2,resource:{buffer:uniform}}]});
 const forward=[group(parameters,scratch),group(scratch,filtered)],adjoint=[group(gradients,scratch),group(scratch,rawGradient)];
 const damping=[group(parameters,scratch,dampConfig),group(scratch,filtered,dampConfig),group(filtered,parameters,dampConfig)];
 const maxGroups=device.limits?.maxComputeWorkgroupsPerDimension??65535,total=Math.ceil(layout.count/64),rows=Math.ceil(total/maxGroups),columns=Math.ceil(total/rows);
 if(rows>maxGroups)throw Error('NeuMIP spatial filter exceeds active device dispatch capacity');
 const configure=step=>{const s=neumipSpatialTrainingState(AUTHOR_SPATIAL_RECIPE,step);device.queue.writeBuffer(config,0,new Float32Array([s.offsetSigma,s.appearanceSigma,0,0]));};
 const encode=(encoder,groups,names)=>{for(let i=0;i<names.length;i++){const pass=encoder.beginComputePass({label:'NeuMIP spatial '+names[i]});pass.setPipeline(pipelines[names[i]]);pass.setBindGroup(0,groups[i]);pass.dispatchWorkgroups(columns,rows);pass.end();}};
 return {parameters:filtered,rawGradient,code,
  // Author fuse_blur is a no-grad raw appearance mutation before the training
  // forward. A separate fixed uniform preserves ordering in the same encoder.
  damp(encoder){encode(encoder,damping,['vertical','horizontal','damp_blend']);},
  forward(encoder,step){configure(step);encode(encoder,forward,['vertical','horizontal']);},
  // A circular symmetric Gaussian is self-adjoint. Reverse the separable
  // composition to return gradients to the independently optimized fields.
  adjoint(encoder){encode(encoder,adjoint,['horizontal','vertical']);}};
}
