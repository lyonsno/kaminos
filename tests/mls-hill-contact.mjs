// kaminos-test: node
import assert from 'node:assert/strict';
import {mlsConfig} from '../mls-juice-contract.mjs';

const terrain={schema:'kaminos.frozen-hill.v1',source:{repo:'lerms',commit:'observed-revision',phase:'frozen',sampleChecksum:'fixture'},
  grid:{x:2,z:2,min:[-.5,-.5],step:[1,1]},heights:[.2,.4,.6,1],colors:Array(12).fill(.4),
  transform:{scale:1,translation:[0,0,0]}};
const config=mlsConfig({terrain});
assert(config.terrain,'explicit Hill terrain must be consumed, never silently replaced by the tray');
const {sampleFrozenHill,buildFrozenHillGeometry}=await import('../mls-hill-terrain.mjs');
const geometry=buildFrozenHillGeometry(config.terrain);
assert.deepEqual([...geometry.indices],[0,2,1,1,2,3]);
assert.deepEqual([...geometry.positions].map(v=>+v.toFixed(3)),[-.5,.2,-.5,.5,.4,-.5,-.5,.6,.5,.5,1,.5]);
const near=sampleFrozenHill(config.terrain,-.25,-.25),far=sampleFrozenHill(config.terrain,.25,.25);
assert(Math.abs(near.height-.35)<1e-6,'first triangle must use its actual plane');
assert(Math.abs(far.height-.75)<1e-6,'second triangle must match the render diagonal, not bilinear smoothing');
assert.equal(sampleFrozenHill(config.terrain,3,0),null,'terrain must not silently extend beyond its source');
assert(Math.abs(sampleFrozenHill(config.terrain,.5,.5).height-1)<1e-6);
assert.throws(()=>mlsConfig({terrain:{...terrain,heights:[.2,.4]}}),/height/);
assert.throws(()=>mlsConfig({terrain:{...terrain,heights:[.2,.4,NaN,1]}}),/height/);
assert.throws(()=>mlsConfig({terrain:{...terrain,source:null}}),/source/);
assert.throws(()=>mlsConfig({terrain:{...terrain,heights:[.2,.4,.6,50]}}),/domain/);
assert.throws(()=>mlsConfig({terrain:{...terrain,grid:{...terrain.grid,step:[0,1]}}}),/grid/);
assert.equal(mlsConfig().terrain,null,'existing tray remains the default without a Hill request');
console.log('Frozen Hill admission, exact triangle contact and visible geometry agree');
