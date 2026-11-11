// kaminos-test: node
import assert from 'node:assert/strict';
import {uniformRusinkiewicz,publishedPowerLogLoss,cosineLearningRate} from '../neural-appearance-training-recipe.mjs';
const near=(a,b)=>{assert.equal(a.length,b.length);for(let i=0;i<a.length;i++)assert(Math.abs(a[i]-b[i])<1e-12,`${a} != ${b}`);};
// Canonical source equations: theta_h=u.x*pi/2, theta_d=u.y*pi/2,
// rotate_y then rotate_z; wo reflects wi about the half vector.
let q=uniformRusinkiewicz([0,0,0,0]);near(q.wi,[0,0,1]);near(q.wo,[0,0,1]);assert(q.valid);
q=uniformRusinkiewicz([0,.5,0,0]);near(q.wi,[Math.SQRT1_2,0,Math.SQRT1_2]);near(q.wo,[-Math.SQRT1_2,0,Math.SQRT1_2]);
q=uniformRusinkiewicz([.5,0,.25,0]);near(q.wi,[0,Math.SQRT1_2,Math.SQRT1_2]);near(q.wo,q.wi);
assert.equal(uniformRusinkiewicz([.75,.75,0,0]).valid,false);
for(const u of [[0,0,0],[0,0,0,NaN],[0,0,0,1]])assert.throws(()=>uniformRusinkiewicz(u),/uniform/);
assert.equal(publishedPowerLogLoss([1,8,27],[0,1,8]),3);assert.equal(publishedPowerLogLoss([0,1],[0,1]),0);
for(const [a,b] of [[[1],[1,2]],[[-1],[0]],[[NaN],[0]]])assert.throws(()=>publishedPowerLogLoss(a,b),/response/);
assert.equal(cosineLearningRate(0,100000),.001);assert(Math.abs(cosineLearningRate(50000,100000)-.000505)<1e-15);assert.equal(cosineLearningRate(100000,100000),.00001);assert.equal(cosineLearningRate(100001,100000),.00001);
console.log('Published directional equations, response loss and cosine schedule passed');
const {publishedQueryBatch}=await import('../neural-appearance-training-recipe.mjs');
const {validateAppearanceDirections}=await import('../neural-appearance-direction-capture.mjs');
let seed=41;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return(seed+.5)/4294967296;};
const batch=publishedQueryBatch(2048,random,{batchSize:1024});assert.equal(batch.length,2048*8);validateAppearanceDirections(batch);
for(let i=0;i<2048;i++){const x=batch[i*8],y=batch[i*8+1],cell=i%1024;assert.equal(Math.floor(x*32),cell%32);assert.equal(Math.floor(y*32),Math.floor(cell/32));}
assert.throws(()=>publishedQueryBatch(3,random),/square/);assert.throws(()=>publishedQueryBatch(1024,()=>NaN),/Uniform/);
assert.throws(()=>validateAppearanceDirections(new Float32Array([.5,.5,0,0,2,0,0,1])),/Unit/);
