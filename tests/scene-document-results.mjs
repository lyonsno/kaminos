import {readOwnerExperimentAddress} from '../owner-experiment-entry.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as authoring from '../scene-authoring.mjs';
const {compositionRestoreUrl}=authoring;
import {checkedCameraView,cameraViewsMatch} from '../scene-camera-views.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const section = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
function mounted() {
  let status = '';
  const context = vm.createContext({
    window: {}, authoringWorkspace:null,readOwnerExperimentAddress, authoringBusy: false, vantageCaptureHeld: false, currentSceneFile: 'input.kaminos.json',
    document: { getElementById: () => ({ value: 'Comparison', disabled: false }) },
    compositionStatus: text => { status = text; }, setInfo: text => { status = text; },
    grBrowseScenes() {}, compositionRestoreUrl,savedSceneLocation:authoring.savedSceneLocation,URL,URLSearchParams,location: { origin: 'http://localhost:9000',href:'http://localhost:9000/?mesh_root=generated-meshes#authoring=1&scene=input.kaminos.json' },history:{replaceState(_state,_title,url){context.location.href=url;}},
    sceneSaveIsBlocked: () => false, sceneIsEmpty: () => false,
    collectSceneComposition: async () => () => {},
    buildSceneData: capture => ({ label: 'Comparison', composition: null,
      objects: [{ id: 'actual-object', transform: { position: [1, 2, 3] } }], capture: capture || null }),
    fetch: async () => ({ ok: true, json: async () => ({ saved: 'accepted.kaminos.json' }) }),
    selectionCaptureSuspended:false,selectionFeedback:null,selectionBoxes:new Map(),updateSelectionFeedback(){},
    sceneObjects: [], volumePrototype: null, activeSceneComposition: null,sceneCameras:null,
    scene:{traverse(){}},controls:{enabled:true},FLAME_EMITTER_TYPE:'flame-emitter',LOCAL_LIQUID_EMITTER_TYPE:'local-liquid-emitter',
    checkedCameraView,cameraViewsMatch,readAuthoredCameraView:()=>({position:[0,0,3],target:[0,0,0],up:[0,1,0],fov:40,near:.01,far:100}),
    transformControls: null, renderer: { domElement: {} }, FLAME_EMITTER_ID: 'flame',
    requestAnimationFrame: callback => callback(),
    captureComposedCanvases: () => ({ image: 'data:image/png;base64,YQ==', width: 1, height: 1 }),
  });
  vm.runInContext(section('async function withAuthoringAction(', 'async function changeCompositionBasin('), context);
  vm.runInContext(section('async function saveToServer(', 'function sceneIsEmpty()'), context);
  vm.runInContext(section('// Save: overwrite current scene file', 'function getMaterialState()'), context);
  vm.runInContext(section('window.captureComposition =', "document.getElementById('composition-capture').onclick"), context);
  return { context, run: code => vm.runInContext(code, context), status: () => status };
}

test('save returns the exact document and restore URL for this invocation', async () => {
  const { run } = mounted();
  const result = await run('window.saveSceneAs({result:true})');
  assert.equal(result.filename, 'accepted.kaminos.json', 'detailed save must expose the created document filename');
  assert.equal(result.ok, true);
  assert.equal(result.document.objects[0].id, 'actual-object');
  assert.equal(new URL(result.url).hash, '#authoring=1&scene=accepted.kaminos.json');
  assert.equal(await run('window.saveScene()'), true, 'ordinary caller keeps its boolean');
});

test('capture returns pixels and the scene saved with those pixels', async () => {
  const { run } = mounted();
  const result = await run('window.captureComposition({result:true})');
  assert.equal(result.filename, 'accepted.kaminos.json');
  assert.equal(result.document.capture.width, 1);
  assert.equal(await run('window.captureComposition()'), true);
});

test('failed or malformed server response cannot reuse an earlier success', async () => {
  const { context, run } = mounted();
  await run('window.saveSceneAs({result:true})');
  for (const response of [
    { ok: false, status: 503, json: async () => ({ saved: 'misleading.kaminos.json' }) },
    { ok: true, json: async () => ({}) },
    { ok: true, json: async () => ({ saved: '../wrong.kaminos.json' }) },
  ]) {
    context.fetch = async () => response;
    const result = await run('window.saveSceneAs({result:true})');
    assert.equal(result.ok, false);
    assert.equal(result.filename, undefined);
    assert.equal(result.url, undefined);
    assert.ok(result.error);
    assert.equal(run('currentSceneFile'), 'accepted.kaminos.json');
  }
});

test('busy and blocked actions return their own refusal', async () => {
  const { context, run } = mounted();
  context.authoringBusy = true;
  let result = await run('window.saveSceneAs({result:true})');
  assert.equal(result.ok, false);
  assert.match(result.error, /busy/i);
  context.authoringBusy = false;
  context.vantageCaptureHeld = true;
  result = await run('window.saveSceneAs({result:true})');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'The agent sub is taking a picture', 'a vantage picture holds Save As with its own reason');
  context.vantageCaptureHeld = false;
  context.sceneSaveIsBlocked = () => true;
  result = await run('window.saveSceneAs({result:true})');
  assert.equal(result.ok, false);
  assert.equal(result.filename, undefined);
  assert.equal(await run('window.saveScene()'), false);
});

test('overlapping invocation cannot claim the first save result', async () => {
  const { context, run } = mounted();
  let release;
  context.fetch = () => new Promise(resolve => { release = resolve; });
  const first = run('window.saveSceneAs({result:true})');
  await new Promise(resolve => setImmediate(resolve));
  const second = await run('window.saveSceneAs({result:true})');
  assert.equal(second.ok, false);
  assert.equal(second.filename, undefined);
  release({ ok: true, json: async () => ({ saved: 'first.kaminos.json' }) });
  assert.equal((await first).filename, 'first.kaminos.json');
});

test('result retains the submitted scene while later edits continue independently', async () => {
  const { context, run } = mounted();
  const scene = { objects: [{ id: 'object', transform: { position: [1, 2, 3] } }], composition: null };
  context.buildSceneData = () => scene;
  const result = await run('window.saveSceneAs({result:true})');
  scene.objects[0].transform.position[0] = 9;
  assert.equal(result.document.objects[0].transform.position[0], 1);
});

test('a successful Save As binds the current address to the new document; failed Save keeps it',async()=>{
 const {context,run}=mounted();const before=new URL(context.location.href);const result=await run('window.saveSceneAs({result:true})');const after=new URL(context.location.href);assert.equal(new URLSearchParams(after.hash.slice(1)).get('scene'),result.filename,'reload must address the current saved document');assert.equal(after.search,before.search,'saving does not replace the live renderer route');const accepted=context.location.href;context.fetch=async()=>({ok:false,status:503,json:async()=>({error:'Unavailable'})});await run('window.saveScene({result:true})');assert.equal(context.location.href,accepted,'failed Save cannot claim another address');
});
