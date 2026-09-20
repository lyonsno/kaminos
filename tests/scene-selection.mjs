import test from 'node:test';
import assert from 'node:assert/strict';
import {Mesh,BoxGeometry,MeshBasicMaterial,PerspectiveCamera,Vector3} from '../lib/three.core.js';
import {frameObject} from '../scene-frame-selected.mjs';
test('frame selected encloses all corners in portrait and landscape without changing object pose',()=>{
 for(const aspect of [.5,2]){
 const mesh=new Mesh(new BoxGeometry(4,2,6),new MeshBasicMaterial());mesh.position.set(4,2,1);mesh.rotation.y=.4;
 const camera=new PerspectiveCamera(40,aspect,.1,100);camera.position.set(5,2,8);
 const controls={target:new Vector3(),update(){camera.lookAt(this.target);camera.updateMatrixWorld();}};
 const original=mesh.matrixWorld.clone();assert.equal(frameObject(mesh,camera,controls),true);
 for(const x of [-2,2])for(const y of [-1,1])for(const z of [-3,3]){
 const p=new Vector3(x,y,z).applyMatrix4(mesh.matrixWorld).project(camera);assert.ok(Math.abs(p.x)<1&&Math.abs(p.y)<1&&p.z<1);
 }
 assert.deepEqual(mesh.position.toArray(),[4,2,1]);
 }
});
