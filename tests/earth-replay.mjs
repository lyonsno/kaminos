// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as earth from '../earth-specimen.mjs';
import {createEarthDynamicsKernel} from '../earth-dynamics.mjs';

test('one specimen design preserves grit, clod fields, bed depth and matrix mass across physical grids',()=>{
 assert.equal(typeof earth.createEarthDesign,'function','a support-independent specimen description is required');
 const reference=new earth.EarthSpecimen({columns:6,layers:3,grains:3,clodCount:2});
 const design=earth.createEarthDesign(reference.snapshot());reference.dispose();
 const coarse=earth.EarthSpecimen.fromDesign(design,{columns:3,layers:2}),fine=earth.EarthSpecimen.fromDesign(design,{columns:6,layers:4});
 try{const a=coarse.snapshot(),b=fine.snapshot();assert.equal(a.particles.length,18);assert.equal(b.particles.length,144);assert.deepEqual(a.grit,b.grit);assert.deepEqual(a.design,b.design);assert.deepEqual(a.structure.clods.map(c=>[c.id,c.center,c.radii]),b.structure.clods.map(c=>[c.id,c.center,c.radii]));assert.ok(Math.abs(a.particles.reduce((n,p)=>n+p.mass,0)-b.particles.reduce((n,p)=>n+p.mass,0))<1e-10);const restored=earth.EarthSpecimen.fromSnapshot(a);try{assert.deepEqual(restored.snapshot(),a);}finally{restored.dispose();}}
 finally{coarse.dispose();fine.dispose();}
});
test('dynamics worker initialization consumes a common design instead of regenerating ingredients',()=>{
 assert.equal(typeof earth.createEarthDesign,'function');const reference=new earth.EarthSpecimen({columns:3,layers:2,grains:2,clodCount:1});const design=earth.createEarthDesign(reference.snapshot());reference.dispose();const k=createEarthDynamicsKernel();
 try{const a=k.apply({kind:'init',design,config:{columns:4,layers:3}}).snapshot;assert.equal(a.particles.length,48);assert.deepEqual(a.design,design);assert.deepEqual(a.grit,design.grit);}finally{k.dispose();}
});

test('applied replay preserves exact same-grid dynamics, material changes and pause/cancel state',async()=>{
 const {createEarthReplay,EARTH_PROGRAM_SCHEMA}=await import('../earth-replay.mjs');
 const reference=new earth.EarthSpecimen({columns:3,layers:2,grains:0,clodCount:1}),design=earth.createEarthDesign(reference.snapshot());reference.dispose();
 const k=createEarthDynamicsKernel(),quality={columns:3,layers:2},initial=k.apply({kind:'init',design,config:quality});
 const actions=[{kind:'advance',seconds:.01},{kind:'material',values:{friction:.3}},{kind:'sweep',seconds:.01,from:{position:[-.02,.08,0],radius:.06},to:{position:[.02,.04,0],radius:.06}}];let expected=initial;for(const a of actions)expected=k.apply(a);k.dispose();
 const replay=createEarthReplay({schema:EARTH_PROGRAM_SCHEMA,design,actions},quality);const out=await replay.finished;assert.equal(out.status,'complete');assert.equal(out.completed,3);assert.deepEqual(out.snapshot,expected.snapshot);
 let controller;controller=createEarthReplay({schema:EARTH_PROGRAM_SCHEMA,design,actions},quality,{onProgress:s=>{if(s.completed===1&&s.status==='running')controller.pause();}});
 await new Promise(r=>setTimeout(r,20));assert.equal(controller.read().status,'paused');assert.equal(controller.read().completed,1);controller.cancel();assert.equal((await controller.finished).status,'cancelled');assert.equal(controller.read().completed,1);
});
