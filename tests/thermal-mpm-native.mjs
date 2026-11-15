// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {createThermalMpm,PARTICLE_WORDS} from '../experiments/thermal-jointing/mpm-solver.mjs';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
test('surface cooling changes persistent material temperatures with a resolved gradient',async()=>{
 await withKaminosGpu(async({device})=>{
  const solver=await createThermalMpm({device,options:{particlesPerAxis:8,cooling:8,damage:false}});
  try{
   const before=await solver.snapshot();solver.advance(500);const after=await solver.snapshot();
   assert.equal(after.state.fault,null);console.log('cooling-state',after.state);assert.equal(after.particles.length,8**3*PARTICLE_WORDS);
   let cold=1,hot=0,mass=0;
   for(let i=0;i<8**3;i++){const j=i*PARTICLE_WORDS;assert.equal(after.particles[j+3],before.particles[j+3]);assert.equal(after.particles[j+39],1);cold=Math.min(cold,after.particles[j+7]);hot=Math.max(hot,after.particles[j+7]);mass+=after.particles[j+3];}
   assert.equal(mass,64);
   console.log('temperature-range',{cold,hot});assert.ok(cold<.95,'cooling must lower at least one material point by five percent at the selected time');
   assert.ok(hot<=1.00001,'cooling without a heat source must not heat material above its initial temperature');assert.ok(hot-cold>.05,'material must retain a spatial cooling gradient');
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
