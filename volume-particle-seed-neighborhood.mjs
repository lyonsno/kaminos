// Inspection only. The two passes run after births and transport on the held
// pool. Buckets are unbounded linked lists of seed slots. Hash collisions cost
// extra distance checks but cannot add or remove a neighbor.
export function createSeedNeighborhood(device, declarations, retire) {
 const module=device.createShaderModule({label:'Held carrier neighborhoods',code:declarations+`
 @group(0) @binding(0) var<storage,read> pool:array<Particle>;
 @group(0) @binding(1) var<storage,read> generations:array<u32>;
 @group(0) @binding(2) var<uniform> options:Options;
 @group(0) @binding(3) var<uniform> radius:f32;
 @group(0) @binding(4) var<storage,read_write> heads:array<atomic<u32>>;
 @group(0) @binding(5) var<storage,read_write> links:array<u32>;
 @group(0) @binding(6) var<storage,read_write> members:array<u32>;

 fn bucket(cell:vec3<i32>)->u32 {
  let q=bitcast<vec3<u32>>(cell);
  return hash32(q.x^(q.y*747796405u)^(q.z*2891336453u))%arrayLength(&heads);
 }
 @compute @workgroup_size(64) fn indexSeeds(@builtin(global_invocation_id) gid:vec3<u32>) {
  let i=gid.x;
  if(i>=arrayLength(&pool)){return;}
  let p=pool[i];
  if(p.anchor.w<=0 || !particleSelected(i,generations[i],options.viewRaster.w) || !particleMatchesPhase(p,options)){return;}
  let cell=vec3<i32>(floor(p.anchor.xyz/radius));
  links[i]=atomicExchange(&heads[bucket(cell)],i+1u);
 }
 @compute @workgroup_size(64) fn gatherMembers(@builtin(global_invocation_id) gid:vec3<u32>) {
  let i=gid.x;
  if(i>=arrayLength(&pool)){return;}
  members[i]=0u;
  let p=pool[i];if(p.anchor.w<=0){return;}
  let cell=vec3<i32>(floor(p.anchor.xyz/radius));
  for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
   var link=atomicLoad(&heads[bucket(cell+vec3<i32>(x,y,z))]);
   while(link!=0u){
    let seed=link-1u;
    let delta=p.anchor.xyz-pool[seed].anchor.xyz;
    if(dot(delta,delta)<=radius*radius){members[i]=1u;return;}
    link=links[seed];
   }
  }}}
 }`});
 const pipeline=entryPoint=>device.createComputePipeline({label:entryPoint,layout:'auto',compute:{module,entryPoint}});
 const index=pipeline('indexSeeds'), gather=pipeline('gatherMembers');
 let arena, cachedKey;
 function dispose(){if(arena){retire(Object.values(arena));arena=null;}cachedKey=null;}
 function encode(encoder,{particles,generations,options,slots,radius,key}){
  if(!arena||arena.members.size!==slots*4){
   dispose();
   const storage=label=>device.createBuffer({label,size:slots*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
   arena={heads:storage('seed bucket heads'),links:storage('next seed'),members:storage('held neighborhood membership'),
    radius:device.createBuffer({label:'held gather radius',size:4,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})};
  }
  if(key===cachedKey)return arena.members;
  device.queue.writeBuffer(arena.radius,0,new Float32Array([radius]));
  encoder.clearBuffer(arena.heads);
  const buffers=[particles,generations,options,arena.radius,arena.heads,arena.links,arena.members];
  function run(pipeline,bindings,label){
   const pass=encoder.beginComputePass({label});pass.setPipeline(pipeline);
   pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:bindings.map(binding=>({binding,resource:{buffer:buffers[binding]}}))}));
   pass.dispatchWorkgroups(Math.ceil(slots/64));pass.end();
  }
  run(index,[0,1,2,3,4,5],'index held sparse seed centers');
  run(gather,[0,3,4,5,6],'gather dense neighbors once per carrier');
  cachedKey=key;return arena.members;
 }
 return {encode,dispose,get bytes(){return arena?arena.heads.size+arena.links.size+arena.members.size+arena.radius.size:0;}};
}
