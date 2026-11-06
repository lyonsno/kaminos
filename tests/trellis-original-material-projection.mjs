// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {bakeTrellisMaterialTextures} from '../models/trellis2/trellis-material.js';
const input={vertices:new Float32Array([-.25,-.25,-.25,.25,-.25,-.25,-.25,.25,-.25]),triangles:new Uint32Array([0,1,2]),uvs:new Float32Array([0,0,1,0,0,1]),textureSize:2,
 coordinates:new Int32Array([0,0,0,1,1,1]),features:new Float32Array([1,-1,-1,-1,1,1,-1,-1,1,-1,1,1]),resolution:2};
test('texture transfer rejects a partial projected position set',()=>{
 assert.throws(()=>bakeTrellisMaterialTextures({...input,samplePositions:new Float32Array(3)}),/complete.*sample positions/i);
});
test('texture transfer samples supplied original-surface positions',()=>{
 const raw=bakeTrellisMaterialTextures(input),projected=new Float32Array(raw.coveredPixels*3).fill(.25);
 const transferred=bakeTrellisMaterialTextures({...input,samplePositions:projected});
 assert.equal(transferred.baseColor[0],0);assert.equal(transferred.baseColor[2],255);
 assert.notDeepEqual(transferred.baseColor,raw.baseColor);
 assert.equal(transferred.metadata.positionTransfer,'caller-projected original surface');
});
