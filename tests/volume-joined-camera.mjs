// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import * as framing from '../scene-frame-selected.mjs';
assert.equal(typeof framing.frameBox,'function','joined cockpit needs existing box framing callable without a scene object');
const box=new THREE.Box3(new THREE.Vector3(-2,-2,-2),new THREE.Vector3(2,6,2));
const camera=new THREE.PerspectiveCamera(50,.8,.1,100);
camera.position.set(7,5,12);
const controls={target:new THREE.Vector3(),update(){camera.lookAt(this.target);camera.updateMatrixWorld();}};
assert.equal(framing.frameBox(box,camera,controls),true);
assert.deepEqual(controls.target.toArray(),[0,2,0]);
for(const x of [-2,2])for(const y of [-2,6])for(const z of [-2,2]){
 const p=new THREE.Vector3(x,y,z).project(camera);
 assert.ok(Math.abs(p.x)<1&&Math.abs(p.y)<1&&p.z>-1&&p.z<1,'every exterior corner fits the camera');
}
console.log('joined camera framing passed');
