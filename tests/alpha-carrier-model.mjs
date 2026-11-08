// kaminos-test: node
import assert from 'node:assert/strict';
import {decodeAlpha,alphaAtlas,validateAlphaModel} from '../alpha-carrier-model.mjs';
const parameters=new Float32Array(121);parameters[0]=1;parameters[40]=1;parameters[112]=2;parameters[120]=-.5;
assert.ok(Math.abs(decodeAlpha([1,0,0,0],parameters)-1/(1+Math.exp(-1.5)))<1e-7);
assert.ok(Math.abs(decodeAlpha([-1,0,0,0],parameters)-1/(1+Math.exp(.5)))<1e-7);
const atlas=alphaAtlas(new Float32Array([1,2,3,4,10,20,30,40]),2,2,1);
assert.equal(atlas.width,8);assert.equal(atlas.height,4);
assert.equal(atlas.data[0],1);assert.equal(atlas.data[3],2);assert.equal(atlas.data[4],10);assert.equal(atlas.data[7],20);
assert.equal(atlas.data[3*8],3);assert.equal(atlas.data[3*8+7],40);
assert.throws(()=>alphaAtlas(new Float32Array(3),1,2,1),/shape/);
const m={schema:'kaminos.alpha-model.v1',layers:[4,8,8,1],gridSize:4,carrierCount:2,sourceSHA256:'source',patchesSHA256:'patch'};
validateAlphaModel(m,{count:2,sourceSHA256:'source',patchesSHA256:'patch'});
assert.throws(()=>validateAlphaModel({...m,carrierCount:1},{count:2,sourceSHA256:'source',patchesSHA256:'patch'}),/identity/);
assert.throws(()=>validateAlphaModel({...m,layers:[4,32,32,1]},{count:2,sourceSHA256:'source',patchesSHA256:'patch'}),/layout/);
console.log('Alpha decoder, separate tile gutters and level/source identity pass');
