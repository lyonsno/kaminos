// kaminos-test: node
// Port of Handy's explicit-domain regression, Kaminos 75d80a46c.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import * as THREE from '../lib/three.core.js';
import * as framing from '../scene-frame-selected.mjs';

for (const visible of [true, false]) test(`selected fire frames its world bounds, outline visible=${visible}`,()=>{
  const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const functionSource=source.slice(source.indexOf('function frameAuthoredSelection() {'),source.indexOf('function groupEditState('));
  const box=new THREE.Box3(new THREE.Vector3(1,-1,-2),new THREE.Vector3(3,3,0));
  const guide=new THREE.Box3Helper(box);guide.userData.kaminosEditorHelper=true;
  const camera=new THREE.PerspectiveCamera(40,1.3,.01,100);camera.position.set(0,.6,3);
  const controls={target:new THREE.Vector3(),update(){camera.lookAt(this.target);camera.updateMatrixWorld();}};
  controls.update();const before=camera.position.toArray();
  assert.equal(framing.frameObjects([guide],camera,controls),false,'ordinary framing still excludes helper content');
  assert.deepEqual(camera.position.toArray(),before);
  guide.visible=visible;
  assert.equal(runInNewContext(functionSource+'\nframeAuthoredSelection()',{
    activeSceneFieldId:'flame-field',flameDomainGuide:guide,camera,controls,...framing,
  }),true,'explicit fire selection frames the domain');
  assert.notDeepEqual(camera.position.toArray(),before);
  assert.deepEqual(controls.target.toArray(),box.getCenter(new THREE.Vector3()).toArray());
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
    const projected=new THREE.Vector3(x,y,z).project(camera);
    assert.ok(Math.abs(projected.x)<=1&&Math.abs(projected.y)<=1&&Math.abs(projected.z)<=1,'every domain corner fits');
  }
});
