import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { compositionRestoreUrl } from '../scene-authoring.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const section = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
function mounted() {
  let status = '';
  const context = vm.createContext({
    window: {}, authoringBusy: false, currentSceneFile: 'input.kaminos.json',
    document: { getElementById: () => ({ value: 'Comparison', disabled: false }) },
    compositionStatus: text => { status = text; }, setInfo: text => { status = text; },
    grBrowseScenes() {}, compositionRestoreUrl, location: { origin: 'http://localhost:9000' },
    showSceneLightingRestoreWarnings() {},
    sceneSaveIsBlocked: () => false, sceneIsEmpty: () => false,
    collectSceneComposition: async () => () => {},
    buildSceneData: capture => ({ label: 'Comparison', composition: null,
      objects: [{ id: 'actual-object', transform: { position: [1, 2, 3] } }], capture: capture || null }),
    fetch: async () => ({ ok: true, json: async () => ({ saved: 'accepted.kaminos.json' }) }),
    sceneObjects: [], volumePrototype: null, activeSceneComposition: null,
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
