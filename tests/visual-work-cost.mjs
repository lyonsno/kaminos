// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import * as work from '../visual-work.mjs';

test('cheap execution makes a separate preview scene before opening authored content', () => {
  assert.equal(typeof work.prepareVisualWorkScene, 'function', 'visual work needs pre-load cost admission');
  const source = {objects: [{id:'mesh',type:'glb',source:'/a.glb'}], editorDisplay:{quality:'full'},
    postprocessing:{ao:{enabled:true,intensity:2},sceneGI:{mode:'combined',slices:8,steps:16}}, capture:{image:'retained-original'}};
  const original = structuredClone(source);
  const {document, policy} = work.prepareVisualWorkScene(source);
  assert.deepEqual(source, original);
  assert.deepEqual(document.objects, source.objects);
  assert.equal(document.editorDisplay.quality, 'preview');
  assert.equal(document.postprocessing.ao.enabled, false);
  assert.equal(document.postprocessing.sceneGI.mode, 'gtao');
  assert.equal(document.capture, null);
  assert.equal(policy.mode, 'cheap');
});

test('simulation admission precedes loading and never silently changes physics', () => {
  assert.equal(typeof work.prepareVisualWorkScene, 'function', 'visual work needs pre-load cost admission');
  for (const scene of [{composition:{flame:{presetId:'saved'}}}, {localLiquid:{particleCount:49152}},
    {objects:[{type:'simulation-domain',simulation:{settings:{resolution:128}}}]}]) {
    assert.throws(() => work.prepareVisualWorkScene(scene), /simulation.*reason/i);
    const result = work.prepareVisualWorkScene(scene, {reason:'Compare the actual authored simulation'});
    assert.deepEqual(result.document, scene);
    assert.equal(result.policy.mode, 'explicit');
  }
});

test('larger output or full quality requires a reason and keeps its actual extent', () => {
  assert.equal(typeof work.visualWorkOutput, 'function', 'visual work needs output cost admission');
  assert.deepEqual(work.visualWorkOutput().pixels, {width:640,height:480});
  for (const output of [{width:1920,height:1080,quality:'preview'}, {quality:'full'}, {percentage:200}]) {
    assert.throws(() => work.visualWorkOutput({output}), /reason/i);
  }
  const requested = {width:1920,height:1080,quality:'full'};
  const accepted = work.visualWorkOutput({output:requested,reason:'Inspect fine material detail'});
  assert.deepEqual(accepted.pixels, {width:1920,height:1080});
  assert.equal(accepted.settings.quality, 'full');
  assert.throws(() => work.visualWorkOutput({output:requested,reason:'  '}), /reason/i);
});
