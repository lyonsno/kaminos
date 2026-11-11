// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {createCorrosionState,advanceCorrosion,serializeCorrosion,restoreCorrosion}from'../coating-corrosion.mjs';
test('finite shell retains a three-dimensional deformation and its mechanical route',()=>{
 const s=createCorrosionState({resolution:4,mechanics:'finite-shell',defects:[],corrosionRate:0,precipitationRate:0});
 assert.equal(s.filmDisplacement.length,4*4*3);const b=restoreCorrosion(serializeCorrosion(s));assert.deepEqual(b.filmDisplacement,s.filmDisplacement);assert.equal(b.config.mechanics,'finite-shell');
 const legacy=serializeCorrosion(createCorrosionState({resolution:4}));delete legacy.config.mechanics;assert.equal(restoreCorrosion(legacy).config.mechanics,'small-slope');
});
test('oxide drives a finite shell while preserving irreversible adhesion and retained continuation',()=>{
 const s=createCorrosionState({resolution:4,mechanics:'finite-shell',defects:[],corrosionRate:0,precipitationRate:0,adhesionEnergy:1e-7});s.rustIron[5]=.4;
 advanceCorrosion(s,.01);assert.ok(s.filmHeight[5]>.001);assert.ok(s.bond.some(b=>b===0));assert.ok(s.filmDisplacement.every(Number.isFinite));
 const a=serializeCorrosion(s),b=restoreCorrosion(a);advanceCorrosion(s,.01);advanceCorrosion(b,.01);assert.deepEqual(serializeCorrosion(s),serializeCorrosion(b));
});

test('finite membrane and hinge energies preserve rigid rotation and match numerical gradients',async()=>{
 const {periodicSheetTopology,sheetElasticEnergy}=await import('../coating-finite-sheet.mjs');const open=new Float64Array(16).fill(1);open[0]=0;const topology=periodicSheetTopology(4,open),u=new Float64Array(48),parameters={stretching:.2184,bending:.0002};
 u[3*5+1]=.08;u[3*1]=.01;const value=sheetElasticEnergy(topology,u,parameters);assert.ok(value.energy>0);
 for(let i=0;i<u.length;i++){const h=1e-6,a=u.slice(),b=u.slice();a[i]+=h;b[i]-=h;const numeric=(sheetElasticEnergy(topology,a,parameters).energy-sheetElasticEnergy(topology,b,parameters).energy)/(2*h);assert.ok(Math.abs(numeric-value.gradient[i])<1e-8,`gradient ${i}: ${numeric} / ${value.gradient[i]}`);}
 const rotate=p=>[p[0]+.3,Math.cos(1.1)*p[1]-Math.sin(1.1)*p[2]-.1,Math.sin(1.1)*p[1]+Math.cos(1.1)*p[2]+.7],turned=new Float64Array(48),flat=new Float64Array(48);
 for(let z=0;z<4;z++)for(let x=0;x<4;x++){const i=(z*4+x)*3,r=[x/4,0,z/4],p=r.map((v,j)=>v+u[i+j]);turned.set(rotate(p).map((v,j)=>v-r[j]),i);flat.set(rotate(r).map((v,j)=>v-r[j]),i);}
 assert.ok(Math.abs(sheetElasticEnergy(topology,turned,parameters).energy-value.energy)<1e-12);assert.ok(sheetElasticEnergy(topology,flat,parameters).energy<1e-24);
});
test('visible finite sheet consumes lateral vertex displacement instead of a height-only average',async()=>{
 const {createCorrosionSource}=await import('../corrosion-source.mjs'),s=createCorrosionState({resolution:4,mechanics:'finite-shell',defects:[]});s.filmDisplacement[0]=.02;s.filmDisplacement[1]=.1;
 const source=createCorrosionSource(serializeCorrosion(s),{width:2});const face=source.triangles.find(t=>t.identity==='paint-top:0:0:0');assert.ok(Math.abs(face.a[0]-(-1+.04))<1e-12);assert.ok(Math.abs(face.a[1]-.202)<1e-12);assert.match(source.geometryModel,/finite/);
});
