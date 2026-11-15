// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {createThermalMpm,PARTICLE_WORDS} from '../experiments/thermal-jointing/mpm-solver.mjs';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
test('surface cooling changes persistent material temperatures with a resolved gradient',async()=>{
 await withKaminosGpu(async({device})=>{
  const solver=await createThermalMpm({device,options:{particlesPerAxis:8,cooling:8,damage:false}});
  try{
   const before=await solver.snapshot();solver.advance(100);const after=await solver.snapshot();
   assert.equal(after.particles.length,8**3*PARTICLE_WORDS);
   let cold=1,hot=0,mass=0;
   for(let i=0;i<8**3;i++){const j=i*PARTICLE_WORDS;assert.equal(after.particles[j+3],before.particles[j+3]);assert.equal(after.particles[j+39],1);cold=Math.min(cold,after.particles[j+7]);hot=Math.max(hot,after.particles[j+7]);mass+=after.particles[j+3];}
   assert.equal(mass,64);
   assert.ok(cold<.9,'cooling must alter material temperature, not only display color');
   assert.ok(hot-cold>.05,'material must retain a spatial cooling gradient');
  }finally{solver.dispose();}
 });
});
