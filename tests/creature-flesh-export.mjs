// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {registerExportGeometrySnapshot} from '../scene-export-geometry.mjs';
import {exportCloneInWorld} from '../scene-export.mjs';
const original=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()),posed=original.geometry.clone();
posed.translate(3,0,0);let calls=0;registerExportGeometrySnapshot(original,()=>{calls++;return posed;});
const copy=exportCloneInWorld(original);
assert.equal(calls,1,'ordinary export requests the current physical skin, not stale storage arrays');
assert.notEqual(copy.geometry,posed,'export owns its copy');
assert.deepEqual(copy.geometry.attributes.position.array,posed.attributes.position.array);
console.log('ordinary export consumes current physical geometry without taking producer ownership');
