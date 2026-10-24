// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateLightingReport, makeDiffuseEvaluator} from '../lib/inferred-lighting.js';
import * as THREE from '../lib/three.core.js';
import definition from '../experiments/inferred-lighting.experiment.mjs';
import {createWorkbenchSceneHost} from '../workbench-scene-host.mjs';

const constant = () => [[Math.sqrt(4*Math.PI), Math.sqrt(4*Math.PI), Math.sqrt(4*Math.PI)], ...Array.from({length:8}, () => [0,0,0])];
const report = () => ({schema:'kaminos.inferred-lighting.v1',status:'complete',checkpointSha256:'test-only',
  sourceRevision:'test-only',effectiveDevice:'fixture',environmentSha256:'test-only',input:{image:'data:image/png;base64,fixture'},
  lights:{estimated:{sh:constant()},reference:{sh:constant()}}});

test('incomplete and nonfinite data cannot masquerade as estimated lighting', () => {
  assert.equal(validateLightingReport(report()).status, 'complete');
  assert.throws(() => validateLightingReport({...report(), status:'failed'}), /complete/);
  assert.throws(() => validateLightingReport({...report(), effectiveDevice:null}), /identity/);
  const bad = report(); bad.lights.estimated.sh[2][1] = NaN;
  assert.throws(() => validateLightingReport(bad), /finite/);
});
test('constant radiance produces neutral Lambertian gray independent of normal', () => {
  const evaluate = makeDiffuseEvaluator(constant());
  for (const normal of [[1,0,0],[0,1,0],[0,0,-1]]) {
    for (const value of evaluate(normal)) assert.ok(Math.abs(value-.5)<1e-5);
    for (const value of evaluate(normal, 1)) assert.ok(Math.abs(value-1)<1e-5);
  }
});

test('shared-scene comparison starts unverified, loads both probes, and releases only its objects', async () => {
  const scene=new THREE.Scene(), borrowed=new THREE.Group(); scene.add(borrowed);
  const rows=new Map(), events=[], callbacks=new Set();
  const host=createWorkbenchSceneHost({scene,camera:new THREE.PerspectiveCamera(),
    controls:{target:new THREE.Vector3(),update(){}},
    loadAsset(){throw Error('No extra asset loader');},
    registerObject(root, metadata){const row={id:root.uuid,root,...metadata};rows.set(root,row);return row;},
    findObject:root=>rows.get(root),removeObject({root}){scene.remove(root);rows.delete(root);},
    redraw(){},onFrame(callback){callbacks.add(callback);return ()=>callbacks.delete(callback);},
  });
  const instance=await definition.create({host:{scene:{open:async()=>host.open()}},inputs:{},record:v=>events.push(v)});
  const [{root}]=rows.values();
  assert.equal(instance.read().status,'awaiting-report'); assert.equal(root.visible,false);
  assert.throws(()=>instance.operations.loadReport({...report(), status:'failed'}), /complete/);
  assert.equal(root.visible,false);
  instance.operations.loadReport(report()); assert.equal(root.visible,true);
  assert.equal(instance.read().effectiveDevice,'fixture');
  assert.equal(root.children.length,2);
  const before=root.children[0].geometry.attributes.color.getX(100);
  instance.operations.setExposure(1);
  assert.ok(Math.abs(root.children[0].geometry.attributes.color.getX(100)-2*before)<1e-5);
  assert.throws(()=>instance.operations.setYaw(Infinity), /finite/);
  assert.equal(events.at(-1).effective.exposure,1);
  await instance.dispose();
  assert.deepEqual(scene.children,[borrowed]); assert.equal(callbacks.size,0);
});
