// kaminos-test: node
import assert from 'node:assert/strict';
import * as surface from '../burn-fracture-replay.mjs';
assert.equal(typeof surface.packBurnFractureSurface,'function','Moving material needs original surface coordinates and per-face connection ownership');
const arrays={positions:Float32Array.of(0,0,0,1,0,0,0,1,0,1,1,0),normals:new Float32Array(12).fill(1),uvs:new Float32Array(8),indices:Uint32Array.of(0,1,2,1,3,2),faceMaterial:Uint8Array.of(0,1)};
const result=surface.packBurnFractureSurface({pieces:[{index:0,arrays,faceInterfaces:Uint32Array.of(0,4),faceBonds:Int32Array.of(-1,2)}]});
assert.deepEqual([...result.caps],[0,0,0,3,3,3],'Exterior and closed internal faces must remain distinguishable');
assert.deepEqual([...result.arrays.positions],[0,0,0,1,0,0,0,1,0,1,0,0,1,1,0,0,1,0]);
assert.deepEqual([...result.owners],[0,0,0,0,0,0]);
assert.deepEqual([...result.arrays.faceMaterial],[0,1]);
