// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {EarthSpecimen} from '../earth-specimen.mjs';
import {createEarthField,createEarthTeacherSource} from '../earth-surface.mjs';

test('clod ancestry creates a stronger interior, weaker interfaces and fine matrix',()=>{
 const earth=new EarthSpecimen({columns:6,layers:3,grains:3,clodCount:3});
 try{const s=earth.snapshot();assert.equal(s.structure?.schema,'kaminos.earth-structure.v1');assert.ok(s.particles.some(p=>p.clodId===0),'fine matrix remains');assert.ok(new Set(s.particles.map(p=>p.clodId).filter(Boolean)).size>=2,'multiple coherent aggregates');
 const inside=earth.bonds.find(b=>b.kind==='clod'),outside=earth.bonds.find(b=>b.kind==='interface');assert.ok(inside&&outside);assert.ok(inside.constraint.equations[0].maxForce>outside.constraint.equations[0].maxForce);assert.ok(s.embeddings.length>0,'grit is coupled to actual surrounding material');
 const loaded=EarthSpecimen.fromSnapshot(s);try{assert.deepEqual(loaded.snapshot(),s);}finally{loaded.dispose();}
 }finally{earth.dispose();}
});

test('physical separation opens weaker boundaries without deleting support mass',()=>{
 const earth=new EarthSpecimen({columns:6,layers:3,grains:0,clodCount:3});
 try{const before=earth.snapshot(),bond=earth.bonds.find(b=>b.kind==='interface');assert.ok(bond);earth.particles[bond.b].body.position.x+=.1;earth.advance(earth.config.dt);
 const s=earth.snapshot();assert.ok(s.bonds.some(b=>b.kind==='interface'&&!b.active));assert.equal(s.particles.reduce((n,p)=>n+p.mass,0),before.particles.reduce((n,p)=>n+p.mass,0));
 }finally{earth.dispose();}
});

test('surface carries aggregate identity and uses the same frozen physical state',()=>{
 const earth=new EarthSpecimen({columns:6,layers:3,grains:2,clodCount:3});
 try{const snapshot=earth.snapshot(),source=createEarthTeacherSource({snapshot,resolution:20});assert.ok(source.triangles.some(t=>t.region==='clod'));assert.ok(source.triangles.some(t=>t.region==='matrix'));assert.equal(source.triangles.filter(t=>t.kind==='grit').length,40);assert.deepEqual(source.config.snapshot,snapshot);assert.ok(createEarthField(snapshot).sample(...snapshot.particles[0].position).fragmentId!==undefined);
 }finally{earth.dispose();}
});

test('grit releases through broken retained links rather than losing the grain',()=>{
 const earth=new EarthSpecimen({columns:4,layers:2,grains:1,clodCount:1});
 try{const mass=earth.grit[0].mass;earth.grit[0].body.position.y+=1;earth.advance(earth.config.dt);const s=earth.snapshot();assert.equal(s.embeddings.filter(e=>e.active).length,0);assert.equal(s.embeddings.length,4);assert.equal(s.grit.length,1);assert.equal(s.grit[0].mass,mass);const loaded=EarthSpecimen.fromSnapshot(s);try{assert.ok(loaded.embeddings.every(e=>!e.active));}finally{loaded.dispose();}}finally{earth.dispose();}
});

test('broken local paths open geometry without moving or deleting support samples',()=>{
 const earth=new EarthSpecimen({columns:4,layers:2,grains:0,clodCount:1});
 try{const intact=earth.snapshot(),broken=structuredClone(intact);for(const b of broken.bonds)if((broken.particles[b.a].position[0]<0)!==(broken.particles[b.b].position[0]<0))b.active=false;
 const a=createEarthField(intact),b=createEarthField(broken);let opened=false;for(let y=.015;y<.2;y+=.01)for(let z=-.15;z<.15;z+=.01)if(a.value(0,y,z)>0&&b.value(0,y,z)<0)opened=true;
 assert.ok(opened,'disconnected local support must allow a visible fissure');assert.deepEqual(broken.particles,intact.particles);
 }finally{earth.dispose();}
});

test('observed pre-clod snapshot preserves its homogeneous physical continuation',async()=>{
 const {readFile}=await import('node:fs/promises'),fixture=JSON.parse(await readFile(new URL('./fixtures/earth-legacy32.json',import.meta.url),'utf8'));
 const earth=EarthSpecimen.fromSnapshot(fixture.snapshot);
 try{const restored=earth.snapshot();assert.deepEqual(restored.particles,fixture.snapshot.particles);assert.deepEqual(restored.bonds,fixture.snapshot.bonds);assert.deepEqual(restored.grit,fixture.snapshot.grit);assert.equal(restored.structure,undefined);assert.equal(earth.state().structure.clods,0);assert.ok(earth.bonds.every(b=>b.constraint.equations[0].maxForce===fixture.snapshot.config.cohesion));}finally{earth.dispose();}
});


test('intact aggregates contribute geometric relief without removing the supporting fine bed',()=>{
 const earth=new EarthSpecimen({columns:6,layers:3,grains:0,clodCount:3});
 try{const s=earth.snapshot(),plain=structuredClone(s);plain.config.clodCount=0;plain.structure.clods=[];for(const p of plain.particles)p.clodId=0;for(const b of plain.bonds)b.kind='matrix';
 const a=createEarthField(s),b=createEarthField(plain),spacing=a.spacing;let relief=0;
 for(let z=-.16;z<=.16;z+=.02)for(let x=-.16;x<=.16;x+=.02){const top=f=>{let low=.01,high=f.bounds.max[1];for(let i=0;i<24;i++){const y=(low+high)/2;if(f.value(x,y,z)>0)low=y;else high=y;}return(low+high)/2;};const lifted=top(a)-top(b);assert.ok(lifted>=-1e-6,'intact clods must not punch holes in the fine support');relief=Math.max(relief,lifted);}
 assert.ok(relief>spacing*.08,'clod ancestry must change geometry, not only material labels');assert.deepEqual(s.particles.map(p=>p.position),plain.particles.map(p=>p.position));
 }finally{earth.dispose();}
});
