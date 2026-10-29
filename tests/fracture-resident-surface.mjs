// kaminos-test: node
import assert from 'node:assert/strict';import * as surface from '../fracture-coarse-surface.mjs';
assert.equal(typeof surface.packResidentFractureFaces,'function','Resident rendering and picking need shared triangle/cell/bond ownership');
const piece={index:0,center:[10,20,30],arrays:{positions:new Float32Array([10,20,30,11,20,30,10,21,30]),indices:new Uint32Array([0,1,2,0,2,1]),faceMaterial:new Uint8Array([0,1])},faceInterfaces:new Int32Array([0,1]),faceBonds:new Int32Array([-1,0])};
const packed=surface.packResidentFractureFaces({pieces:[piece],bonds:[{}]},[{side:0},{side:2}]);
assert.equal(packed.faces.length,24);assert.deepEqual(Array.from(packed.faces.slice(0,12)),[0,0,0,0,1,0,0,0,0,1,0,0]);assert.equal(packed.faces[19],1,'Cap keeps its exact bond, encoded plus one');assert.equal(packed.faces[23],2,'Picking retains material sidedness');assert.equal(packed.owners[1].cell,0);assert.equal(packed.owners[1].face,1);
assert.throws(()=>surface.packResidentFractureFaces({pieces:[{...piece,faceBonds:new Int32Array([-1,-1])}],bonds:[{}]},[]),/bond/,'Missing cap ownership cannot render as exterior');
console.log('Resident face ownership preserves source positions, cut bond and sidedness');
