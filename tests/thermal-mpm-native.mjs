// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {createThermalMpm,PARTICLE_WORDS} from '../experiments/thermal-jointing/mpm-solver.mjs';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
test('surface cooling changes persistent material temperatures with a resolved gradient',async()=>{
 await withKaminosGpu(async({device})=>{
  const solver=await createThermalMpm({device,options:{particlesPerAxis:8,cooling:8,damage:false,contraction:0,fixedBase:false}});
  try{
   const before=await solver.snapshot();solver.advance(500);const after=await solver.snapshot();
   assert.equal(after.state.fault,null);console.log('cooling-state',after.state);assert.equal(after.particles.length,8**3*PARTICLE_WORDS);
   let cold=1,hot=0,mass=0;
   for(let i=0;i<8**3;i++){const j=i*PARTICLE_WORDS;assert.equal(after.particles[j+3],before.particles[j+3]);assert.equal(after.particles[j+39],1);cold=Math.min(cold,after.particles[j+7]);hot=Math.max(hot,after.particles[j+7]);mass+=after.particles[j+3];}
   assert.equal(mass,64);
   console.log('temperature-range',{cold,hot});assert.ok(cold<.95,'cooling must lower at least one material point by five percent at the selected time');
   assert.ok(hot<=1.00001,'cooling without a heat source must not heat material above its initial temperature');assert.ok(hot-cold>.05,'material must retain a spatial cooling gradient');
   const rowHeat=new Float64Array(8),rowCount=new Uint32Array(8);
   for(let j=0;j<after.particles.length;j+=PARTICLE_WORDS){const y=Math.round((after.particles[j+37]-3.25)*2);rowHeat[y]+=after.particles[j+7];rowCount[y]++;}
   const means=Array.from(rowHeat,(v,i)=>v/rowCount[i]);console.log('cooling profile',means);
   for(let y=0;y<7;y++)assert.ok(means[y+1]<=means[y]+1e-5,'uniform material cooled only from above must not develop a hotter layer above a cooler one');
  }finally{solver.dispose();}
 });
});

test('uniform hot unstressed material remains stationary and undamaged',async()=>{
 await withKaminosGpu(async({device})=>{
  const solver=await createThermalMpm({device,options:{particlesPerAxis:8,cooling:0,contraction:0,gravity:0,damping:0,fixedBase:false}});
  try{
   const before=await solver.snapshot();solver.advance(10);const after=await solver.snapshot();
   assert.equal(after.state.fault,null);assert.equal(after.state.completedSteps,10);
   for(let i=0;i<8**3;i++){const j=i*PARTICLE_WORDS;for(let axis=0;axis<3;axis++)assert.ok(Math.abs(after.particles[j+axis]-before.particles[j+axis])<1e-6);assert.ok(Math.abs(after.particles[j+7]-1)<1e-6);assert.ok(after.particles[j+32]>.999);}
  }finally{solver.dispose();}
 });
});
test('damage-gradient partition retains outward motion across a prepared damaged band',async()=>{
 await withKaminosGpu(async({device})=>{
  const run=async separationEnabled=>{
   const solver=await createThermalMpm({device,options:{particlesPerAxis:8,preparedSplit:true,separationEnabled,cooling:0,contraction:0,damage:false,fixedBase:false,damping:0}});
   try{solver.advance(1);return await solver.snapshot();}finally{solver.dispose();}
  };
  const split=await run(true),shared=await run(false);
  assert.equal(split.state.fault,null);assert.equal(shared.state.fault,null);
  assert.ok(split.state.splitNodes>0);assert.equal(shared.state.splitNodes,0);
  let splitSpeed=0,sharedSpeed=0,momentum=0;
  for(let i=0;i<512;i++){const j=i*PARTICLE_WORDS;const sign=split.particles[j+36]>5?1:-1;splitSpeed+=sign*split.particles[j+4];sharedSpeed+=sign*shared.particles[j+4];momentum+=split.particles[j+4]*split.particles[j+3];assert.equal(split.particles[j+3],.125);assert.equal(split.particles[j+32],shared.particles[j+32]);}
  console.log('opening fixture',{splitSpeed,sharedSpeed,momentum,nodes:split.state.splitNodes});
  assert.ok(splitSpeed>sharedSpeed+.1);assert.ok(Math.abs(momentum)<1e-4);
 });
});
test('fixed-point accumulation reports aggregate overflow before accepting another material step',async()=>{
 const {THERMAL_MPM_WGSL}=await import('../experiments/thermal-jointing/mpm-kernels.mjs');
 await withKaminosGpu(async({device})=>{
  const U=GPUBufferUsage;
  const a=device.createBuffer({size:4,usage:U.STORAGE|U.COPY_DST|U.COPY_SRC}),d=device.createBuffer({size:32,usage:U.STORAGE|U.COPY_DST|U.COPY_SRC}),out=device.createBuffer({size:32,usage:U.MAP_READ|U.COPY_DST});
  try{
   device.queue.writeBuffer(a,0,new Int32Array([2147483640]));device.queue.writeBuffer(d,0,new Uint32Array(8));
   const module=device.createShaderModule({code:THERMAL_MPM_WGSL+'\n@compute @workgroup_size(1) fn overflowFixture(){add(0u,.00002);}'});
   const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'overflowFixture'}});
   const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:1,resource:{buffer:a}},{binding:13,resource:{buffer:d}}]});
   const e=device.createCommandEncoder(),pass=e.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1);pass.end();e.copyBufferToBuffer(d,0,out,0,32);device.queue.submit([e.finish()]);await out.mapAsync(GPUMapMode.READ);
   assert.equal(new Uint32Array(out.getMappedRange())[2],1,'overflow must fault even when each contribution fits');
  }finally{a.destroy();d.destroy();out.destroy();}
 });
});

test('strength variation edits update the persistent field and initialization-only edits reject truthfully',async()=>{
 await withKaminosGpu(async({device})=>{
  const solver=await createThermalMpm({device,options:{particlesPerAxis:8,variation:.25}});
  try{
   const before=await solver.snapshot();assert.ok(before.particles.some((v,i)=>i%PARTICLE_WORDS===35&&Math.abs(v-1)>.05));
   solver.setOptions({variation:0});const after=await solver.snapshot();
   for(let j=0;j<after.particles.length;j++){if(j%PARTICLE_WORDS===35)assert.equal(after.particles[j],1);else assert.equal(after.particles[j],before.particles[j]);}
   for(const patch of [{prestrain:.01},{preparedSplit:true},{splitVelocity:.5}])assert.throws(()=>solver.setOptions(patch),/initialization|new thermal solver/i);
   assert.equal(solver.read().config.prestrain,0);
  }finally{solver.dispose();}
 });
});
test('material-neighbor conduction conserves heat in an insulated stationary solid',async()=>{
 await withKaminosGpu(async({device})=>{
  const solver=await createThermalMpm({device,options:{particlesPerAxis:8,cooling:0,contraction:0,damage:false,fixedBase:false}});
  try{
   const initial=await solver.snapshot(),p=initial.particles;let energyBefore=0;
   for(let j=0;j<p.length;j+=PARTICLE_WORDS){p[j+7]=p[j+37]<5?0:1;energyBefore+=p[j+3]*p[j+7];}
   device.queue.writeBuffer(solver.particles,0,p);solver.advance(100);const after=await solver.snapshot();let energyAfter=0,cold=1,hot=0;
   for(let j=0;j<p.length;j+=PARTICLE_WORDS){energyAfter+=after.particles[j+3]*after.particles[j+7];cold=Math.min(cold,after.particles[j+7]);hot=Math.max(hot,after.particles[j+7]);}
   assert.equal(after.state.fault,null);assert.ok(Math.abs(energyAfter-energyBefore)<1e-4);assert.ok(cold>0&&hot<1);
  }finally{solver.dispose();}
 });
});
test('raising ambient does not reject existing cooled material when heat exchange is disabled',async()=>{
 await withKaminosGpu(async({device})=>{
  const solver=await createThermalMpm({device,options:{particlesPerAxis:8,cooling:12,contraction:0,damage:false,fixedBase:false}});
  try{
   solver.advance(1);const before=await solver.snapshot();assert.equal(before.state.fault,null);
   solver.setOptions({ambient:1,cooling:0,diffusivity:0});solver.advance(1);const after=await solver.snapshot();
   assert.equal(after.state.fault,null);assert.equal(after.state.completedSteps,2);
   for(let j=0;j<before.particles.length;j+=44)assert.equal(after.particles[j+7],before.particles[j+7]);
  }finally{solver.dispose();}
 });
});
