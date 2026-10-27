// kaminos-test: node
import assert from 'node:assert/strict';
import {coarseRestFrame} from '../fracture-coarse-rest-frame.mjs';
// Observed arm r6, material:10, cells22/23 (renumbered), original asset d5d6ecec.
const fixture={floorY:-.52,cells:[
 {index:0,position:[-.20434437692165375,-.3946271538734436,.07909003645181656],halfExtents:[.0272,.00762,.02912],mass:.000007459057449101019},
 {index:1,position:[-.20314427465200424,-.3860437721014023,.08016062900424004],halfExtents:[.01582,.00851,.01643],mass:.00000775532156941578}],bonds:[
 {id:'material:10',a:0,b:1,anchorA:[-.006565067559128418,.003402611722754467,.0049591690083949785],anchorB:[-.007765169828777924,-.005180770049286854,.0038885764559715014],area:.00028192929143501565,linearStiffness:3228415029.8558187}]};
const f=Math.fround,gap=(p,b)=>[0,1,2].map(k=>f(f(p.cells[b.a].position[k])+f(b.anchorA[k]))-f(f(p.cells[b.b].position[k])+f(b.anchorB[k])));
assert.ok(Math.hypot(...gap(fixture,fixture.bonds[0]))>0,'The observed pre-fix GPU packing must retain its specific rest gap');
const before=structuredClone(fixture),packed=coarseRestFrame(fixture);
assert.deepEqual(gap(packed,packed.bonds[0]),[0,0,0],'Unloaded joint anchors must coincide after GPU float packing');
assert.deepEqual(fixture,before,'Encoding must preserve the original surface/material fixture');
for(let i=0;i<fixture.cells.length;i++){assert.equal(packed.cells[i].mass,fixture.cells[i].mass);assert.deepEqual(packed.cells[i].halfExtents,fixture.cells[i].halfExtents);for(let k=0;k<3;k++)assert.ok(Math.abs(packed.cells[i].position[k]+packed.origin[k]-fixture.cells[i].position[k])<=packed.quantum);}
const shifted=structuredClone(fixture);for(const c of shifted.cells)c.position=c.position.map((v,k)=>v+[12345,-23456,34567][k]);shifted.floorY-=23456;const translated=coarseRestFrame(shifted);
assert.deepEqual(gap(translated,translated.bonds[0]),[0,0,0]);assert.ok(Math.abs(translated.quantum-packed.quantum)<1e-15,'Source translation must not coarsen local material precision');
