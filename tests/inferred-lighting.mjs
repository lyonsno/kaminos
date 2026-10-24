// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateLightingReport, makeDiffuseEvaluator} from '../lib/inferred-lighting.js';
import * as THREE from '../lib/three.core.js';
import definition from '../experiments/inferred-lighting.experiment.mjs';
import * as lighting from '../lib/inferred-lighting.js';
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
  const white = makeDiffuseEvaluator(constant(), 1);
  assert.ok(Math.abs(white([0,0,1])[0]-1)<1e-5, 'material albedo must not be multiplied by the gray probe reflectance');
});

test('suite refuses failed, duplicate or incomplete cases rather than silently selecting a substitute', () => {
  assert.equal(typeof lighting.validateLightingSuite,'function');
  const suite={schema:'kaminos.inferred-lighting-suite.v1',status:'complete',cases:[{id:'studio',label:'Studio',status:'complete',reportUrl:'studio/lighting.json',environmentSha256:'fixture'}]};
  assert.equal(lighting.validateLightingSuite(suite),suite);
  assert.throws(()=>lighting.validateLightingSuite({...suite,status:'failed'}),/complete/);
  assert.throws(()=>lighting.validateLightingSuite({...suite,cases:[...suite.cases,...suite.cases]}),/unique/);
  assert.throws(()=>lighting.validateLightingSuite({...suite,cases:[{...suite.cases[0],status:'failed'}]}),/complete/);
});

test('failed case selection preserves the visible source, and manual input supersedes an in-flight selection', async t => {
  const suite={schema:'kaminos.inferred-lighting-suite.v1',status:'complete',cases:
    ['a','b'].map(id=>({id,label:id,status:'complete',reportUrl:`${id}.json`,environmentSha256:id}))};
  let resolveB;
  t.mock.method(globalThis,'fetch',async url=>({ok:true,json:async()=>{
    if(String(url).endsWith('suite.json'))return suite;
    if(String(url).endsWith('b.json'))return new Promise(resolve=>{resolveB=resolve;});
    return {...report(),environmentSha256:'a'};
  }}));
  const session={attach:async root=>({id:'fixture',root}),readView:()=>({}),setView:()=>({}),redraw(){},onFrame:()=>()=>{},dispose:async()=>{}};
  const instance=await definition.create({host:{scene:{open:async()=>session}},inputs:{suiteUrl:'https://fixture.test/suite.json'},record(){}});
  assert.equal(instance.read().caseId,'a');
  await assert.rejects(instance.operations.selectCase('missing'),/Unknown/);
  const mismatch=instance.operations.selectCase('b');await new Promise(resolve=>setImmediate(resolve));
  resolveB({...report(),environmentSha256:'wrong'});
  await assert.rejects(mismatch,/hash mismatch/);assert.equal(instance.read().caseId,'a');
  const pending=instance.operations.selectCase('b');await new Promise(resolve=>setImmediate(resolve));
  instance.operations.loadReport({...report(),environmentSha256:'manual'});
  resolveB({...report(),environmentSha256:'b'});await pending;
  assert.equal(instance.read().environmentSha256,'manual');assert.equal(instance.read().caseId,null);
  await instance.dispose();
});

test('shared-scene comparison starts unverified, loads three probes, and releases only its objects', async () => {
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
  assert.deepEqual(root.children.map(mesh=>mesh.name),['Uniform neutral', 'Reference HDR', 'Estimated light']);
  assert.equal(root.children.length,3);
  const before=root.children[0].geometry.attributes.color.getX(100);
  instance.operations.setExposure(1);
  assert.ok(Math.abs(root.children[0].geometry.attributes.color.getX(100)-2*before)<1e-5);
  assert.throws(()=>instance.operations.setYaw(Infinity), /finite/);
  assert.equal(events.at(-1).effective.exposure,1);
  await instance.dispose();
  assert.deepEqual(scene.children,[borrowed]); assert.equal(callbacks.size,0);
});
