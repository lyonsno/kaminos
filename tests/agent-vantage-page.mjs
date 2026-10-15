// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createVantagePilot, createCommandPump, installAgentVantage} from '../agent-vantage.mjs';
import {poseAxes, poseLookingAt} from '../agent-vantage-core.mjs';
import {createSceneCameras} from '../scene-camera.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {installScenePlacementTools} from '../scene-placement-tools.mjs';
import * as THREE from '../lib/three.core.js';
import {PerspectiveCamera, Vector3} from '../lib/three.core.js';

const HOST = 'kaminos-host-renderer-canvas', VOLUME = 'kaminos-volume-canvas';
// The matrices a camera at `view` renders with on a 1600x900 viewport.
function opticsOf(view) {
  const camera = new PerspectiveCamera(view.fov, 1600 / 900, view.near, view.far);
  camera.position.fromArray(view.position); camera.up.fromArray(view.up); camera.lookAt(new Vector3(...view.target));
  camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
  return {projection: camera.projectionMatrix.toArray(), viewInverse: camera.matrixWorldInverse.toArray(), near: camera.near};
}

const copy = value => structuredClone(value);

// A fake application: one ledger, the scene camera service, a viewport camera
// and a compositor that records which view it pictured.
function fakeApp({mode = 'user', activeId = null, cameras = []} = {}) {
  const state = {
    settings: {schema: 'kaminos.scene-camera.v1', activeId, aspect: [16, 9]},
    cameras: copy(cameras),
    view: {position: [0, 1, 6], target: [0, 1, 0], up: [0, 1, 0], fov: 50, near: 0.1, far: 1000},
    ledger: [], writes: [], composed: [], frames: 0, helpersHidden: 0, helpersRestored: 0,
    busy: null, visible: true, mode, moveDuringFrames: false,
    volume: false, volumeFrames: 100, volumeFreeze: false, extraLayer: false, held: false, holds: 0,
    size: {width: 1600, height: 900}, optics: null, duringFrames: null, restoreThrows: false,
    selection: [],
    objects: [
      {id: 'centre', label: 'Centre box', type: 'procedural-mesh', bounds: {min: [-0.5, 0.5, -0.5], max: [0.5, 1.5, 0.5]}},
      {id: 'side', label: 'Side box', type: 'procedural-mesh', bounds: {min: [4.5, 0.5, -0.5], max: [5.5, 1.5, 0.5]}},
    ],
  };
  const findCamera = id => state.cameras.find(camera => camera.id === id);
  const host = {
    edits: {
      state: () => ({active: null, replaying: false}),
      apply(id, value, label) {
        if (id === '@scene-cameras') { state.settings = copy(value.settings); state.cameras = copy(value.cameras); }
        else { const camera = findCamera(id); assert.ok(camera, `pose edit for unknown object ${id}`); camera.transform = copy(value); }
        state.ledger.push({id, label});
        return value;
      },
    },
    cameras: {
      read: () => ({settings: copy(state.settings), cameras: copy(state.cameras)}),
      state: () => ({mode: state.mode, activeId: state.settings.activeId}),
    },
    objects: () => [...state.objects, ...state.cameras.map(camera => ({id: camera.id, label: camera.label, type: 'camera',
      bounds: {min: camera.transform.position.map(v => v - 0.1), max: camera.transform.position.map(v => v + 0.1)}}))],
    extraTargets: () => [],
    selection: () => state.selection,
    readView: () => copy(state.view),
    writeView(view) { state.view = copy(view); state.writes.push(copy(view)); },
    viewportSize: () => copy(state.size),
    busy: () => state.busy,
    visible: () => state.visible,
    suspendHelpers() {
      state.helpersHidden++;
      return () => { state.helpersRestored++; if (state.restoreThrows) { state.restoreThrows = false; throw new Error('helper restore failed'); } };
    },
    hold() {
      if (state.held) throw new Error('A scene document action is running');
      state.held = true; state.holds++;
      return () => { state.held = false; };
    },
    redraw() {},
    async frames(count) {
      if (!state.freeze) state.frames += count;
      if (state.volume && !state.volumeFreeze) state.volumeFrames += count;
      if (state.moveDuringFrames) state.view = {...state.view, position: state.view.position.map(v => v + 0.5)};
      state.duringFrames?.(state);
    },
    blank: () => state.blank === true,
    async sleep() {},
    compose({maxSize}) {
      state.composed.push(copy(state.view));
      return {canvas: {fake: state.composed.length}, width: Math.min(1600, maxSize), height: 900,
        layers: [HOST, ...(state.volume ? [VOLUME] : []), ...(state.extraLayer ? ['mystery-canvas'] : [])]};
    },
    cameraMatrices: () => state.optics ?? opticsOf(state.view),
    encode: canvas => ({mime: 'image/png', dataUrl: `data:image/png;base64,${Buffer.from(JSON.stringify(canvas)).toString('base64')}`, width: 1280, height: 720}),
    annotate: canvas => ({...canvas, annotated: true}),
    sheet: frames => ({sheet: frames.length}),
    paintMap: layout => ({map: [layout.width, layout.height], cones: layout.cones.map(cone => cone.kind)}),
    frameState: () => ({sceneFrameCount: state.frames, layers: {[HOST]: state.frames, ...(state.volume ? {[VOLUME]: state.volumeFrames} : {})}}),
    now: () => Date.parse('2026-10-14T18:00:00Z'),
  };
  return {state, host};
}

const launched = async (options) => {
  const app = fakeApp(options);
  const pilot = createVantagePilot(app.host);
  await pilot.run('launch', {});
  app.state.ledger.length = 0; app.state.writes.length = 0;
  return {...app, pilot};
};

test('launch adds one camera through the scene camera ledger without taking the active camera', async () => {
  const app = fakeApp({activeId: 'hero', cameras: [{id: 'hero', label: 'Hero', type: 'camera', source: 'kaminos:camera',
    transform: {position: [0, 2, 8], rotation: [0, 0, 0], scale: [1, 1, 1]},
    camera: {projection: 'perspective', lens: 50, sensorWidth: 36, near: 0.1, far: 1000}}]});
  const pilot = createVantagePilot(app.host);
  const result = await pilot.run('launch', {});
  assert.equal(result.created, true);
  assert.deepEqual(app.state.ledger, [{id: '@scene-cameras', label: 'Launch Bebop'}]);
  assert.equal(app.state.settings.activeId, 'hero', 'the operator keeps their active camera');
  const sub = app.state.cameras.find(camera => camera.id === 'vantage-bebop');
  assert.equal(sub.label, 'Bebop');
  assert.equal(sub.camera.lens, 24);
  assert.ok(sub.transform.position[2] > 0 && sub.transform.position[2] < 6, 'starts in front of the operator');
  const forward = poseAxes(sub.transform).forward;
  assert.ok(forward[2] < -0.99, 'looks where the operator looks');
  const again = await pilot.run('launch', {});
  assert.equal(again.created, false);
  assert.equal(app.state.ledger.length, 1, 'a second launch is not another edit');
});

test('each flight command is one labeled pose edit', async () => {
  const {state, pilot} = await launched();
  await pilot.run('goto', {position: [0, 1, 3]});
  await pilot.run('move', {forward: 1});
  await pilot.run('turn', {yaw: 90});
  await pilot.run('look', {target: 'centre box'});
  await pilot.run('orbit', {target: 'side', azimuth: 90, elevation: 0, radius: 2});
  await pilot.run('frame', {target: 'centre'});
  await pilot.run('align', {});
  assert.deepEqual(state.ledger.map(entry => entry.label), [
    'Bebop: go to (0, 1, 3)', 'Bebop: move', 'Bebop: turn', 'Bebop: look at Centre box',
    'Bebop: orbit Side box', 'Bebop: frame Centre box', 'Bebop: align to operator view']);
  assert.ok(state.ledger.every(entry => entry.id === 'vantage-bebop'));
  const sub = state.cameras.find(camera => camera.id === 'vantage-bebop');
  assert.deepEqual(sub.transform.position.map(v => Math.round(v * 1e6) / 1e6), [0, 1, 6], 'align copies the operator eye');
});

test('a look aims the sub at the named object', async () => {
  const {state, pilot} = await launched();
  await pilot.run('goto', {position: [0, 1, 3]});
  await pilot.run('look', {target: 'side'});
  const sub = state.cameras.find(camera => camera.id === 'vantage-bebop');
  const forward = poseAxes(sub.transform).forward, expected = [5, 0, -3];
  const length = Math.hypot(...expected);
  expected.forEach((value, i) => assert.ok(Math.abs(forward[i] - value / length) < 1e-6));
});

test('snap borrows the viewport, pictures the sub view, and restores the operator view', async () => {
  const {state, pilot} = await launched();
  await pilot.run('look', {target: 'side'});
  const operator = copy(state.view);
  const shot = await pilot.run('snap', {annotate: true});
  assert.equal(shot.route, 'viewport-borrow');
  assert.equal(state.composed.length, 1);
  const pictured = state.composed[0];
  assert.notDeepEqual(pictured.position, operator.position, 'the picture was taken from the sub');
  assert.deepEqual(state.view, operator, 'the operator view is restored');
  assert.deepEqual(state.writes.at(-1), operator);
  assert.equal(state.helpersHidden, 1);
  assert.equal(state.helpersRestored, 1);
  assert.deepEqual(shot.images.map(image => image.name), ['snap', 'annotated', 'map']);
  assert.ok(shot.images[0].dataUrl.startsWith('data:image/png;base64,'));
  assert.deepEqual(shot.objects.inView.map(object => object.id), ['side'], 'the sub sees what it looks at, not itself');
  assert.equal(shot.objects.occlusion, 'not-tested');
  assert.deepEqual(shot.layers, ['kaminos-host-renderer-canvas']);
  assert.ok(shot.viewDeviation.position < 1e-9);
  assert.ok(shot.frame.before && shot.frame.after);
});

test('snap refuses instead of picturing the wrong thing', async () => {
  const missing = createVantagePilot(fakeApp().host);
  await assert.rejects(missing.run('snap', {}), error => error.phase === 'no-sub' && /launch/.test(error.message));

  const busy = await launched();
  busy.state.busy = 'The operator is dragging a gizmo';
  await assert.rejects(busy.pilot.run('snap', {}), error => error.phase === 'busy' && /gizmo/.test(error.message));
  assert.equal(busy.state.writes.length, 0, 'a refused snap never touches the viewport');

  const hidden = await launched();
  hidden.state.visible = false;
  await assert.rejects(hidden.pilot.run('snap', {}), error => error.phase === 'page-hidden');

  const throughOther = await launched({mode: 'camera', activeId: 'hero', cameras: [{id: 'hero', label: 'Hero', type: 'camera', source: 'kaminos:camera',
    transform: {position: [0, 2, 8], rotation: [0, 0, 0], scale: [1, 1, 1]}, camera: {projection: 'perspective', lens: 50, sensorWidth: 36, near: 0.1, far: 1000}}]});
  await assert.rejects(throughOther.pilot.run('snap', {}), error => error.phase === 'camera-view' && /Hero/.test(error.message));

  const moved = await launched();
  const operator = copy(moved.state.view);
  moved.state.moveDuringFrames = true;
  await assert.rejects(moved.pilot.run('snap', {}), error => error.phase === 'view-changed');
  assert.deepEqual(moved.state.view, operator, 'the operator view is restored after a refused capture');
  assert.equal(moved.state.helpersRestored, 1);
});

test('a picture Kaminos never drew is refused, not returned', async () => {
  const stale = await launched();
  const operator = copy(stale.state.view);
  stale.state.freeze = true;
  await assert.rejects(stale.pilot.run('snap', {}), error => error.phase === 'stale-frame' && /did not draw/.test(error.message));
  assert.deepEqual(stale.state.view, operator, 'the operator view is restored after a stale frame');
  await assert.rejects(stale.pilot.run('peek', {}), error => error.phase === 'stale-frame');

  const blank = await launched();
  blank.state.blank = true;
  await assert.rejects(blank.pilot.run('snap', {}), error => error.phase === 'blank-frame' && /flat/.test(error.message));
  await assert.rejects(blank.pilot.run('burst', {count: 2}), error => error.phase === 'blank-frame');
});

test('looking through the sub already shows its view, so snap pictures it without borrowing', async () => {
  const {state, pilot} = await launched();
  state.mode = 'camera';
  state.settings.activeId = 'vantage-bebop';
  const shot = await pilot.run('snap', {});
  assert.equal(shot.route, 'operator-camera-view');
  assert.equal(state.writes.length, 0);
});

test('peek pictures the operator view as displayed', async () => {
  const {state, pilot} = await launched();
  const shot = await pilot.run('peek', {});
  assert.equal(shot.route, 'operator-view');
  assert.equal(state.writes.length, 0);
  assert.equal(state.helpersHidden, 0, 'peek shows what the operator sees, helpers included');
  await pilot.run('peek', {clean: true});
  assert.equal(state.helpersHidden, 1);
});

test('burst holds the sub view across frames and returns a contact sheet', async () => {
  const {state, pilot} = await launched();
  const operator = copy(state.view);
  const burst = await pilot.run('burst', {count: 3, interval: 100});
  assert.equal(state.composed.length, 3);
  assert.equal(new Set(state.composed.map(view => JSON.stringify(view))).size, 1, 'every frame comes from the sub');
  assert.deepEqual(state.view, operator);
  assert.equal(burst.frames.length, 3);
  assert.deepEqual(burst.images.map(image => image.name), ['sheet', 'map']);
});

test('remove deletes the sub and clears it as the active camera', async () => {
  const {state, pilot} = await launched();
  state.settings.activeId = 'vantage-bebop';
  const result = await pilot.run('remove', {});
  assert.equal(result.removed, true);
  assert.equal(state.cameras.some(camera => camera.id === 'vantage-bebop'), false);
  assert.equal(state.settings.activeId, null);
});

test('invalid commands fail validation in the page', async () => {
  const pilot = createVantagePilot(fakeApp().host);
  await assert.rejects(pilot.run('teleport-everyone', {}), error => error.phase === 'validate');
});

test('every pictured layer must have drawn from the requested view', async () => {
  const frozenVolume = await launched();
  frozenVolume.state.volume = true; frozenVolume.state.volumeFreeze = true;
  await assert.rejects(frozenVolume.pilot.run('snap', {}), error => error.phase === 'stale-frame' && error.message.includes(VOLUME));
  const frozenScene = await launched();
  frozenScene.state.volume = true; frozenScene.state.freeze = true;
  await assert.rejects(frozenScene.pilot.run('snap', {}), error => error.phase === 'stale-frame' && error.message.includes(HOST));
  const both = await launched();
  both.state.volume = true;
  const shot = await both.pilot.run('snap', {});
  assert.deepEqual(shot.layers, [HOST, VOLUME]);
  assert.deepEqual(shot.unverifiedLayers, []);
  const unknown = await launched();
  unknown.state.extraLayer = true;
  const flagged = await unknown.pilot.run('snap', {});
  assert.deepEqual(flagged.unverifiedLayers, ['mystery-canvas'], 'a canvas without a frame counter is pictured but marked unverified');
});

// The real scene camera and edit services, with camera admission held by the
// same document lock index.html uses, over the fake viewport.
async function withRealCameras() {
  const app = fakeApp();
  let records = [{id: 'hero', label: 'Hero', type: 'camera', source: 'kaminos:camera',
    transform: {position: [0, 2, 8], rotation: [0, 0, 0], scale: [1, 1, 1]},
    camera: {projection: 'perspective', lens: 50, sensorWidth: 36, near: 0.1, far: 1000}}];
  const edits = createSceneEdits({
    read: id => copy(records.find(record => record.id === id)?.transform ?? null),
    write: (id, pose) => { records.find(record => record.id === id).transform = copy(pose); },
  });
  const cameras = createSceneCameras({edits, readObjects: () => copy(records), writeCameras: next => { records = copy(next); },
    readViewport: () => copy(app.state.view), writeViewport: view => { app.state.view = copy(view); },
    size: () => ({width: 1600, height: 900}), capture: async () => ({ok: true}),
    admit: () => { if (app.state.held) throw new Error('Finish the current document or preview action'); }});
  cameras.restore({schema: 'kaminos.scene-camera.v1', activeId: 'hero', aspect: [16, 9]});
  const pilot = createVantagePilot({...app.host, edits, cameras});
  await pilot.run('launch', {});
  return {...app, cameras, pilot};
}

test('the operator cannot enter camera view mid-capture, so their saved view survives', async () => {
  for (const command of ['snap', 'burst']) {
    const {state, cameras, pilot} = await withRealCameras();
    const operator = copy(state.view);
    let refused = null;
    state.duringFrames = () => { if (refused === null) { try { cameras.enter(); refused = 'entered'; } catch (error) { refused = error.message; } } };
    await pilot.run(command, command === 'burst' ? {count: 2} : {});
    assert.match(refused, /Finish the current document/, `${command}: camera view is held during the capture`);
    assert.equal(cameras.state().mode, 'user');
    assert.deepEqual(state.view, operator);
    state.duringFrames = null;
    cameras.enter();
    cameras.leave();
    assert.deepEqual(state.view.position, operator.position, `${command}: leaving camera view later returns to the operator's own view`);
  }
});

test('a failed capture setup leaves the pilot ready for the next picture', async () => {
  const {state, pilot} = await launched();
  const operator = copy(state.view);
  state.size = {width: 0, height: 0};
  await assert.rejects(pilot.run('snap', {}), error => error.phase === 'viewport');
  assert.equal(pilot.isCapturing(), false);
  assert.equal(state.held, false);
  state.size = {width: 1600, height: 900};
  assert.equal((await pilot.run('snap', {})).route, 'viewport-borrow');
  state.restoreThrows = true;
  await assert.rejects(pilot.run('snap', {}), /helper restore failed/);
  assert.equal(pilot.isCapturing(), false, 'cleanup completes even when helper restoration throws');
  assert.equal(state.held, false);
  assert.deepEqual(state.view, operator);
});

test('pictures name what the rendering camera saw, and refuse a roll or lens change', async () => {
  const {state, pilot} = await launched();
  await pilot.run('look', {target: 'side'});
  state.optics = opticsOf({position: [0, 1, 6], target: [0, 1, 0], up: [0, 1, 0], fov: 20, near: 0.1, far: 1000});
  const shot = await pilot.run('snap', {});
  assert.deepEqual(shot.objects.inView.map(object => object.id), ['centre'], 'naming follows the effective camera matrices');
  const rolled = await launched();
  rolled.state.duringFrames = current => { current.view = {...current.view, up: [1, 0, 0]}; };
  await assert.rejects(rolled.pilot.run('snap', {}), error => error.phase === 'view-changed' && /roll/.test(error.message));
  const zoomed = await launched();
  zoomed.state.duringFrames = current => { current.view = {...current.view, fov: 110}; };
  await assert.rejects(zoomed.pilot.run('snap', {}), error => error.phase === 'view-changed' && /lens/.test(error.message));
});

test('a queued command whose deadline passed is not run', async () => {
  const ran = [], replies = [];
  const pump = createCommandPump({run: async command => { ran.push(command); return {done: command}; },
    reply: async message => { replies.push(message); }, now: () => 1000});
  pump.push({id: 'late', command: 'move', args: {forward: 1}, expiresAt: 900});
  pump.push({id: 'fresh', command: 'status', args: {}, expiresAt: 5000});
  await pump.idle();
  assert.deepEqual(ran, ['status']);
  assert.deepEqual(replies.map(reply => [reply.id, reply.ok, reply.phase ?? null]), [['late', false, 'expired'], ['fresh', true, null]]);
});

test('burst names each frame from the scene as it was when that frame was taken', async () => {
  const {state, pilot} = await launched();
  await pilot.run('look', {target: 'centre'});
  let calls = 0;
  state.duringFrames = current => {
    if (++calls === 2) current.objects = current.objects.map(object => object.id === 'centre'
      ? {...object, bounds: {min: [100, 0.5, -0.5], max: [101, 1.5, 0.5]}} : object);
  };
  const burst = await pilot.run('burst', {count: 2, annotate: true});
  assert.ok(burst.objects.inView.some(object => object.id === 'centre'), 'the first picture names what it showed');
  assert.ok(burst.frames[0].objects.inView.some(object => object.id === 'centre'));
  assert.ok(!burst.frames[1].objects.inView.some(object => object.id === 'centre'), 'each frame names its own moment');
});

test('sketch describes the scene without drawing, even when the tab is hidden', async () => {
  const {state, pilot} = await launched();
  state.visible = false;
  const before = state.frames;
  const sketch = await pilot.run('sketch', {});
  assert.equal(sketch.schema, 'kaminos.scene-sketch.v1');
  assert.deepEqual(sketch.objects.map(object => object.id), ['centre', 'side'], 'the sub is a camera in the sketch, not an object');
  assert.deepEqual(sketch.subs.map(sub => [sub.pilot, sub.label]), [['bebop', 'Bebop']]);
  assert.deepEqual(sketch.operator.view.position, [0, 1, 6]);
  assert.equal(state.frames, before, 'no frame was drawn');
  assert.equal(state.writes.length, 0);
});

test('map paints a three-quarter map with both cameras', async () => {
  const {state, pilot} = await launched();
  state.visible = false;
  const map = await pilot.run('map', {size: 320});
  assert.equal(map.kind, 'map');
  assert.deepEqual(map.images.map(image => image.name), ['map']);
  const painted = JSON.parse(Buffer.from(map.images[0].dataUrl.split(',')[1], 'base64').toString());
  assert.deepEqual(painted.map, [320, 240]);
  assert.deepEqual(painted.cones, ['operator', 'sub']);
  assert.ok(map.scaleBar.meters > 0);
});

test('pictures carry the map unless asked not to', async () => {
  const {pilot} = await launched();
  assert.deepEqual((await pilot.run('snap', {})).images.map(image => image.name), ['snap', 'map']);
  assert.deepEqual((await pilot.run('snap', {map: false})).images.map(image => image.name), ['snap']);
  assert.deepEqual((await pilot.run('peek', {})).images.map(image => image.name), ['peek', 'map']);
  assert.deepEqual((await pilot.run('burst', {count: 2})).images.map(image => image.name), ['sheet', 'map']);
});

// --- index.html wiring, read from its source ---------------------------------

const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
// The `const name=` statement in index.html, up to its top-level semicolon.
function definition(name) {
  const start = INDEX.indexOf(`const ${name}=`);
  assert.ok(start >= 0, `index.html defines ${name}`);
  let depth = 0, quote = null;
  for (let i = start; i < INDEX.length; i++) {
    const c = INDEX[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ';' && depth === 0) return INDEX.slice(start, i + 1);
  }
  throw new Error(`${name} has no end`);
}
// Evaluates that statement with stand-ins for the page variables it reads.
const fromIndex = (name, scope) => new Function(...Object.keys(scope), `${definition(name)}\nreturn ${name};`)(...Object.values(scope));

class FakeElement extends EventTarget {
  constructor(tag = 'div') { super(); this.tagName = tag.toUpperCase(); this.style = {}; this.dataset = {}; this.children = []; this.clientWidth = 800; this.clientHeight = 600; this.hidden = false; this.textContent = ''; }
  setAttribute() {} append(...children) { this.children.push(...children); } remove() {} contains() { return true; } closest() { return null; }
  getBoundingClientRect() { return {left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600}; }
  setPointerCapture() {} hasPointerCapture() { return false; } releasePointerCapture() {}
}

// The real placement tools over a fake viewport, as index.html installs them.
function placementFixture() {
  const document = new FakeElement(), window = new FakeElement(), viewport = new FakeElement();
  document.body = new FakeElement(); document.activeElement = document.body;
  document.createElement = tag => new FakeElement(tag); document.createElementNS = () => new FakeElement();
  document.querySelectorAll = () => []; document.getElementById = () => null;
  Object.assign(globalThis, {document, window, ResizeObserver: class { observe() {} }});
  const camera = new PerspectiveCamera(45, 4 / 3, 0.1, 100); camera.position.z = 10;
  const controls = new THREE.EventDispatcher(); controls.enabled = true;
  const helper = {visible: true}, gizmo = new THREE.EventDispatcher();
  Object.assign(gizmo, {enabled: true, dragging: false, getHelper: () => helper});
  let pose = {position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1]};
  const tools = installScenePlacementTools({viewport, camera, controls, gizmo, selected: () => 'kiln',
    read: () => structuredClone(pose), write: (_, next) => { pose = structuredClone(next); },
    object: () => ({userData: {kaminosSceneObject: {label: 'kiln'}}, updateWorldMatrix() {}}), refresh() {}});
  return {tools, controls, gizmo, viewport};
}

test('a transform overlapping a picture leaves navigation as the operator had it', () => {
  const {tools, controls, gizmo} = placementFixture();
  const suspend = fromIndex('suspendEditorDrawingForVantage', {transformControls: gizmo, controls,
    scene: {traverse() {}}, sceneObjects: [], FLAME_EMITTER_TYPE: 'flame-emitter', LOCAL_LIQUID_EMITTER_TYPE: 'local-liquid-emitter',
    RIM_LIGHT_ID: 'rim-light', selectionCaptureSuspended: false, selectionFeedback: null, selectionBoxes: new Map(),
    updateSelectionFeedback() {}, window: {}});
  const orders = {
    'picture ends first': restore => { restore(); tools.finish(true); },
    'transform ends first': restore => { tools.finish(true); restore(); },
    'transform cancelled': restore => { tools.finish(false); restore(); },
  };
  for (const [order, end] of Object.entries(orders)) {
    controls.enabled = true;
    const restore = suspend({all: true});
    assert.ok(tools.start('translate'), `${order}: the transform starts`);
    assert.equal(controls.enabled, false, `${order}: the transform holds navigation`);
    end(restore);
    assert.equal(controls.enabled, true, `${order}: navigation is back once both are done`);
  }
  controls.enabled = true;
  const restore = suspend({all: true});
  tools.start('translate');
  restore();
  assert.equal(controls.enabled, false, 'navigation stays off while the transform is still running');
  tools.finish(true);
  assert.equal(controls.enabled, true);
});

test('while a picture holds the viewport, every gesture on its canvas waits, before page-level handlers see it', () => {
  // Window capture listeners run before the page's document-level handlers
  // (box selection, the lighting probe) and before the viewport's own.
  const window = new FakeElement(), viewportEl = new FakeElement(), button = {disabled: false};
  const hold = fromIndex('holdViewportForVantage', {authoringBusy: false, vantageCaptureHeld: false, viewportEl, window,
    document: {getElementById: id => (id === 'composition-capture' ? button : null)},
    viewportEventIsInsideCanvas: event => event.inside, viewportEventHitsInteractiveOverlay: event => event.overlay});
  const reached = [];
  const press = (type, {inside = true, overlay = false, ignored = false} = {}) => {
    const event = new Event(type, {cancelable: true});
    Object.assign(event, {inside, overlay});
    Object.defineProperty(event, 'target', {value: {tagName: 'DIV', closest: selector => (ignored && selector === '[data-vantage-ignore]' ? {} : null)}});
    window.dispatchEvent(event);
    return event;
  };
  const release = hold();
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick']) window.addEventListener(type, event => reached.push(type), {capture: true});
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick']) {
    assert.equal(press(type).defaultPrevented, true, `a ${type} over the borrowed canvas waits, whatever element it lands on`);
  }
  assert.deepEqual(reached, [], 'no later handler sees a held gesture');
  assert.equal(press('pointerdown', {overlay: true}).defaultPrevented, false, 'toolbars over the viewport keep working');
  assert.equal(press('pointerdown', {ignored: true}).defaultPrevented, false, 'the sub panel keeps working');
  assert.equal(press('pointerdown', {inside: false}).defaultPrevented, false, 'the rest of the page keeps working');
  assert.equal(button.disabled, true);
  release();
  assert.equal(press('pointerdown').defaultPrevented, false, 'the canvas answers again after the picture');
  assert.equal(button.disabled, false);
});

test('a picture waits for a box selection the operator has armed or begun', () => {
  let boxing = false;
  const busy = fromIndex('vantageBusy', {authoringBusy: false, scenePlacementTools: {edits: {state: () => ({active: null, replaying: false})}},
    sceneNavigation: {state: () => ({gesture: null})}, transformGizmoDragging: false, transformControls: {dragging: false}, splatCorrectionMode: null,
    greenroomPreviewIsActive: () => false, window: {kaminosSelection: {boxing: () => boxing}}});
  assert.equal(busy(), null);
  boxing = true;
  assert.equal(busy(), 'A box selection is in progress', 'a box drawn in the operator view must not finish in the sub view');
});

test('the sketch carries the matrices the operator viewport renders with', async () => {
  const {state, pilot} = await launched();
  const optics = opticsOf({position: [0, 1, 6], target: [0, 1, 0], up: [0, 1, 0], fov: 30, near: 0.1, far: 1000});
  optics.projection[8] = 0.2;
  state.optics = optics;
  const sketch = await pilot.run('sketch', {});
  assert.deepEqual(sketch.operator.optics, optics, 'a frame zoom or offset lives in the projection, so the sketch must carry it');
});

test('a default picture of a very large scene still returns its picture and map', async () => {
  const {state, pilot} = await launched();
  state.objects = Array.from({length: 20000}, (_, i) => ({id: `box-${i}`, label: `Box ${i}`, type: 'procedural-mesh',
    bounds: {min: [i % 100, 0, Math.floor(i / 100)], max: [i % 100 + 1, 1, Math.floor(i / 100) + 1]}}));
  const shot = await pilot.run('snap', {});
  assert.deepEqual(shot.images.map(image => image.name), ['snap', 'map']);
});

// installAgentVantage over a fake page: the panel map refresh runs on a timer.
function installedPage({subs = []} = {}) {
  const intervals = [], painted = [];
  const element = tag => {
    const node = new FakeElement(tag), parts = {};
    node.querySelector = selector => (parts[selector] ??= element(selector === 'canvas' ? 'canvas' : 'span'));
    node.classList = {add() {}, remove() {}};
    node.getContext = () => new Proxy({}, {get: (_, key) => (key === 'measureText' ? () => ({width: 0}) : () => {
      if (key === 'drawImage') painted.push(node);
    }), set: () => true});
    return node;
  };
  const document = {visibilityState: 'visible', head: {append() {}}, getElementById: () => null, createElement: element};
  const window = {setInterval: (fn, ms) => intervals.push({fn, ms}), clearInterval() {}, crypto: {randomUUID: () => 'test'}};
  let bounds = 0, projection = opticsOf({position: [0, 1, 6], target: [0, 1, 0], up: [0, 1, 0], fov: 50, near: 0.1, far: 1000});
  const entries = Array.from({length: 3}, (_, i) => {
    const object = new THREE.Group(), update = object.updateWorldMatrix.bind(object);
    object.updateWorldMatrix = (...args) => { bounds++; return update(...args); };
    object.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
    object.position.x = i * 2;
    return {id: `box-${i}`, label: `Box ${i}`, type: 'procedural-mesh', object};
  });
  let records = copy(subs);
  const viewport = element('div');
  const vantage = installAgentVantage({THREE, document, window, edits: {state: () => ({active: null, replaying: false})},
    cameras: {read: () => ({settings: {activeId: null, aspect: [16, 9]}, cameras: copy(records)}), state: () => ({mode: 'user', activeId: null})},
    entries: () => entries, selection: () => [], readView: () => ({position: [0, 1, 6], target: [0, 1, 0], up: [0, 1, 0], fov: 50, near: 0.1, far: 1000}),
    writeView() {}, viewport, hostCanvas: element('canvas'), busy: () => null, hold: () => () => {},
    cameraMatrices: () => projection, suspendEditorDrawing: () => () => {}, redraw() {}, frameState: () => ({layers: {}}), link: false});
  const refresh = intervals.find(item => item.ms === 400).fn;
  return {vantage, refresh, painted, map: viewport.children[0].querySelector('canvas'),
    get bounds() { return bounds; }, set bounds(value) { bounds = value; },
    set records(value) { records = copy(value); }, set projection(value) { projection = value; }};
}
const BEBOP = {id: 'vantage-bebop', label: 'Bebop', type: 'camera', source: 'kaminos:camera',
  transform: {position: [0, 1, 4], rotation: [0, 0, 0], scale: [1, 1, 1]},
  camera: {projection: 'perspective', lens: 24, sensorWidth: 36, near: 0.05, far: 1000}};

test('the panel map measures nothing while there is no sub, and clears when the last one goes', () => {
  const page = installedPage();
  page.bounds = 0;
  page.refresh(); page.refresh();
  assert.equal(page.bounds, 0, 'no sub, so no object bounds are computed');
  page.records = [BEBOP];
  page.refresh();
  assert.ok(page.bounds > 0, 'with a sub the map is built');
  assert.equal(page.map.hidden, false);
  page.records = [];
  page.bounds = 0;
  page.refresh();
  assert.equal(page.bounds, 0, 'removing the last sub clears the map without measuring the scene');
  assert.equal(page.map.hidden, true);
});

test('a change to the operator projection alone repaints the panel map', () => {
  const page = installedPage({subs: [BEBOP]});
  page.refresh();
  const before = page.painted.length;
  page.refresh();
  assert.equal(page.painted.length, before, 'nothing changed, nothing repainted');
  const zoomed = opticsOf({position: [0, 1, 6], target: [0, 1, 0], up: [0, 1, 0], fov: 50, near: 0.1, far: 1000});
  zoomed.projection[0] *= 1.4; zoomed.projection[5] *= 1.4;
  page.projection = zoomed;
  page.refresh();
  assert.equal(page.painted.length, before + 1, 'a frame zoom changes what the operator sees, so the map follows');
});
