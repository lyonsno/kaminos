import {SCENE_LIQUID_COLLIDER_WGSL,SCENE_LIQUID_SUPPORT_BINDINGS_WGSL} from './scene-liquid-support.mjs';

// Density is a double transfer: particle mass -> quadratic grid basis ->
// particle. Apply the same transfers to geometric fluid capacity. Dividing by
// that capacity removes solid-side kernel truncation without filling real air.
// The geometric integral uses eight subcell samples and the same quadratic
// basis at their actual offsets. It is a grid-resolution approximation.
export function mlsWallDensityShader({sceneSupport=false,boundaryWalls=false}={}) {
 return (sceneSupport?SCENE_LIQUID_SUPPORT_BINDINGS_WGSL+SCENE_LIQUID_COLLIDER_WGSL:'')+`
@group(0) @binding(0) var<storage,read_write> occupancy:array<u32>;
@group(0) @binding(1) var<storage,read_write> fluidCapacity:array<f32>;
@group(0) @binding(2) var<uniform> extent:vec3f;
@group(0) @binding(3) var<uniform> obstacle:vec4f;
@group(0) @binding(7) var<uniform> domain:vec4f;
fn wallCell(index:u32)->vec3i{let ny=u32(extent.y);let nz=u32(extent.z);return vec3i(i32(index/(ny*nz)),i32((index/nz)%ny),i32(index%nz));}
fn wallIndex(p:vec3i)->u32{return u32((p.x*i32(extent.y)+p.y)*i32(extent.z)+p.z);}
fn wallInvocation(group:vec3u,groups:vec3u,local:u32)->u32{return (group.y*groups.x+group.x)*64u+local;}
fn wallFluid(p:vec3f)->f32{
 ${boundaryWalls?'if(any(p<vec3f(2.))||any(p>extent-vec3f(3.))){return 0.;}':''}
 if(obstacle.w>0.&&distance(p,obstacle.xyz)<obstacle.w){return 0.;}
 ${sceneSupport?'let world=domain.xyz+p*domain.w;for(var i=0u;i<sceneSupportParams.x;i++){if(sceneColliderFrame(world,i).w<0.){return 0.;}}':''}
 return 1.;
}
@compute @workgroup_size(64) fn wallOccupancy(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_index) local:u32){
 let id=wallInvocation(group,groups,local);if(id>=arrayLength(&occupancy)){return;}
 let center=vec3f(wallCell(id))+vec3f(.5);var mask=0u;
 for(var x=0;x<2;x++){for(var y=0;y<2;y++){for(var z=0;z<2;z++){
  if(wallFluid(center+(vec3f(f32(x),f32(y),f32(z))-.5)*.5)>0.){mask|=1u<<u32(x*4+y*2+z);}
 }}}
 occupancy[id]=mask;
}
fn wallBasis(d:vec3f)->vec3f{let a=abs(d);return select(.5*max(vec3f(1.5)-a,vec3f(0))*max(vec3f(1.5)-a,vec3f(0)),vec3f(.75)-a*a,a<=vec3f(.5));}
@compute @workgroup_size(64) fn wallCapacity(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_index) local:u32){
 let id=wallInvocation(group,groups,local);if(id>=arrayLength(&fluidCapacity)){return;}
 let cell=wallCell(id);var available=0.;
 for(var x=-1;x<=1;x++){for(var y=-1;y<=1;y++){for(var z=-1;z<=1;z++){
  let offset=vec3i(x,y,z);let p=cell+offset;
  // Open grid edges are outflow, not solids to be renormalized away.
  var mask=255u;if(all(p>=vec3i(0))&&all(p<vec3i(extent))){mask=occupancy[wallIndex(p)];}
  for(var sample=0u;sample<8u;sample++){
   if((mask&(1u<<sample))==0u){continue;}
   let subcell=(vec3f(f32(sample/4u),f32((sample/2u)%2u),f32(sample%2u))-.5)*.5;
   let w=wallBasis(vec3f(offset)+subcell);available+=w.x*w.y*w.z*.125;
  }
 }}}
 fluidCapacity[id]=available;
}`;
}

export function applyMlsWallDensity(code) {
 const start='        var density: f32 = 0.;',gather='                    density += decodeFixedPoint(cells[cellIndex1D].mass) * weight;',volume='        let volume: f32 = 1.0 / density;';
 if(![start,gather,volume].every(marker=>code.includes(marker)))throw Error('MLS pinned density transfer changed');
 return '@group(0) @binding(14) var<storage,read> wallFluidCapacity:array<f32>;\n'+code
  .replace(start,start+'\n        var availableFluid: f32 = 0.;')
  .replace(gather,gather+'\n                    availableFluid += wallFluidCapacity[cellIndex1D] * weight;')
  .replace(volume,`        // No pressure is inferred from missing solid-side support. Actual air
        // remains in the numerator deficit because capacity depends only on solids.
        if(availableFluid>0.){density/=availableFluid;}
`+volume);
}

export async function createMlsWallDensity({device,config,support,box,obstacle,domain}) {
 if(!support&&!config.boundaryWalls&&!config.obstacle)return null;
 const usage=GPUBufferUsage.STORAGE;
 const occupancy=device.createBuffer({label:'MLS wall occupancy',size:config.gridCells*4,usage});
 const buffer=device.createBuffer({label:'MLS wall fluid capacity',size:config.gridCells*4,usage});
 let dirty=true,generation=0,disposed=false;
 try{
  const module=device.createShaderModule({label:'MLS geometric density support',code:mlsWallDensityShader({sceneSupport:Boolean(support),boundaryWalls:config.boundaryWalls})});
  const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
  if(errors.length)throw Error('MLS wall density: '+errors.map(m=>m.message).join('; '));
  const maskPipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'wallOccupancy'}});
  const capacityPipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'wallCapacity'}});
  let maskGroup;
  const capacityGroup=device.createBindGroup({layout:capacityPipeline.getBindGroupLayout(0),entries:[[0,occupancy],[1,buffer],[2,box]].map(([binding,buffer])=>({binding,resource:{buffer}}))});
  function refresh(){
   const entries=[[0,occupancy],[2,box],[3,obstacle],...(support?[[7,domain]]:[])].map(([binding,buffer])=>({binding,resource:{buffer}}));
   if(support)entries.push({binding:12,resource:support.sampleTextureView},{binding:13,resource:{buffer:support.paramsBuffer}});
   maskGroup=device.createBindGroup({layout:maskPipeline.getBindGroupLayout(0),entries});dirty=true;
  }
  refresh();
  const groups=Math.ceil(config.gridCells/64),limit=device.limits?.maxComputeWorkgroupsPerDimension??65535,x=Math.min(groups,limit),y=Math.ceil(groups/x);
  return {buffer,refresh,encode(encoder){
   if(!dirty)return;
   for(const [pipeline,group] of [[maskPipeline,maskGroup],[capacityPipeline,capacityGroup]]){const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(x,y);pass.end();}
   dirty=false;generation++;
  },read:()=>({route:'solid_geometry_double_transfer_v1',generation,pending:dirty,quadratureSamplesPerCell:8}),dispose(){if(disposed)return;disposed=true;occupancy.destroy();buffer.destroy();}};
 }catch(error){occupancy.destroy();buffer.destroy();throw error;}
}
