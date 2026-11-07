// kaminos-test: node
import assert from 'node:assert/strict';
import {Raycaster,Vector3} from '../lib/three.webgpu.js';
import {packMicrostructure} from '../neural-microstructure-core.mjs';
import {createMicrostructureControl} from '../neural-microstructure.mjs';
const field=packMicrostructure(new Float32Array([0,0,0,0,0,1,.2,.8,.4,0,.8,1]),{radius:.1,cellSize:.5,sourceIds:new Uint32Array([123])});
assert.throws(()=>createMicrostructureControl({...field,sourceIds:undefined}),/source ID/,'Scene picking must retain source identity');
const control=createMicrostructureControl(field);
control.root.position.set(.2,.3,.4);control.root.scale.set(1.5,.8,2);control.root.rotation.set(.3,.4,.1);control.root.updateMatrixWorld(true);
const world=control.root.localToWorld(new Vector3()),origin=control.root.localToWorld(new Vector3(0,0,1)),direction=world.clone().sub(origin).normalize();
const raycaster=new Raycaster(origin,direction),hits=[];control.root.raycast(raycaster,hits);
assert.equal(hits.length,1);assert.equal(hits[0].index,123);assert.ok(hits[0].point.distanceTo(world)<1e-6);
assert.equal(control.root.userData.raycastsAsWhole,true);
for(const mesh of control.root.children)assert.ok(mesh.geometry.boundingBox.containsPoint(new Vector3()));
control.setMode('fine');assert.equal(control.read().mode,'fine');
assert.throws(()=>control.setMode('unknown'),/Mode/);control.dispose();control.dispose();
console.log('microstructure scene: source identity, native transformed picking, bounds and lifecycle passed');
