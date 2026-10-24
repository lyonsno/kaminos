// kaminos-test: node
import assert from 'node:assert/strict';
import * as torso from '../experiments/creature-flesh/torso.mjs';
assert.equal(typeof torso.prepareMovementSupports,'function','Movement support must cover the axial body separately from its yielding flesh');
const channels=['fixed','pelvis','neck','head'],rest=[],weights=[],bones=channels.slice(1).map((name,i)=>({name,parent:i?channels[i]:null,restMatrix:[[1,0,0,0],[0,1,0,0],[0,0,1,i*2],[0,0,0,1]],tail:[0,0,i*2+1]}));
for(let part=0;part<3;part++)for(const x of [-.5,.5])for(const y of [-.75,.75])for(const z of [part*2,part*2+1]){rest.push(x,y,z);weights.push(...channels.map((_,j)=>Number(j===part+1)));}
const support=torso.prepareMovementSupports({manifest:{channels,bones,vertices:rest.length/3},rest:new Float32Array(rest),weights:new Float32Array(weights)});
assert.ok(support.positions.length>3);assert.equal(support.weights.length,support.positions.length*channels.length);
assert.deepEqual(support.profile.map(p=>p.part),['pelvis','neck','head']);
assert.ok(support.profile.every(p=>p.vertices===8),'Every dominant axial vertex contributes to its support bounds');
assert.ok(support.radii.every(r=>Math.abs(r-.4)<1e-12),'A measured .5-wide body keeps a .1 yielding layer outside its movement support');
assert.ok(Math.min(...support.positions.map(p=>p[2]))<.5&&Math.max(...support.positions.map(p=>p[2]))>4.5,'Front and rear supports cannot collapse to the middle torso');
for(let i=0;i<support.positions.length;i++){const sum=support.weights.slice(i*channels.length,(i+1)*channels.length).reduce((a,b)=>a+b,0);assert.ok(Math.abs(sum-1)<1e-6);}
