// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createVantagePilot, createCommandPump, installAgentVantage, raycastEntries, poseOfEntries} from '../agent-vantage.mjs';
import {poseAxes, poseLookingAt, rayThrough} from '../agent-vantage-core.mjs';
import {createSceneCameras, cameraViewFromRecord} from '../scene-camera.mjs';
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
    pose: () => state.objectPose ?? null,
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
// A `function name(` declaration in index.html, up to its closing brace.
function declaration(name) {
  const start = INDEX.indexOf(`\nfunction ${name}(`) + 1;
  assert.ok(start > 0, `index.html declares ${name}`);
  let depth = 0, quote = null, opened = false;
  for (let i = start; i < INDEX.length; i++) {
    const c = INDEX[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '{') { depth++; opened = true; }
    else if (c === '}' && --depth === 0 && opened) return INDEX.slice(start, i + 1);
  }
  throw new Error(`${name} has no end`);
}
// Evaluates a definition against a live scope: the test can flip a page
// variable between calls. Names the scope lacks and the global object lacks
// resolve to inert stand-ins, so a test supplies only what it observes.
function fromIndexLive(name, scope) {
  const inert = new Proxy(function () {}, {get: (_, key) => (key === Symbol.toPrimitive ? () => 0 : inert), apply: () => inert});
  const live = new Proxy(scope, {has: (target, key) => key in target || !(key in globalThis),
    get: (target, key) => (key === Symbol.unscopables ? undefined : key in target ? target[key] : inert),
    set: (target, key, value) => { target[key] = value; return true; }});
  const source = INDEX.includes(`const ${name}=`) ? definition(name) : declaration(name);
  return new Function('scope', `with (scope) { ${source}\nreturn ${name}; }`)(live);
}

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

const HELD_TYPES = ['pointerdown', 'mousedown', 'click', 'dblclick'];
test('while a picture holds the viewport, presses on its canvases wait before page-level handlers see them', () => {
  // Window capture listeners run before the page's document-level handlers
  // (box selection, the lighting probe) and before the viewport's own.
  const window = new FakeElement(), viewportEl = new FakeElement(), button = {disabled: false};
  viewportEl.contains = node => node?.inViewport === true;
  const hold = fromIndex('holdViewportForVantage', {authoringBusy: false, vantageCaptureHeld: false, viewportEl, window,
    document: {getElementById: id => (id === 'composition-capture' ? button : null)},
    viewportEventIsInsideCanvas: () => true, viewportEventHitsInteractiveOverlay: () => false});
  const node = ({tagName = 'CANVAS', inViewport = true, ignored = false} = {}) =>
    ({tagName, inViewport, closest: selector => (ignored && selector === '[data-vantage-ignore]' ? {} : null)});
  const press = (type, target) => {
    const event = new Event(type, {cancelable: true});
    Object.defineProperty(event, 'target', {value: target});
    window.dispatchEvent(event);
    return event;
  };
  const release = hold();
  const reached = [];
  for (const type of HELD_TYPES) window.addEventListener(type, () => reached.push(type), {capture: true});
  for (const type of HELD_TYPES) assert.equal(press(type, node()).defaultPrevented, true, `a ${type} on the borrowed canvas waits`);
  assert.deepEqual(reached, [], 'no later handler sees a held press');
  for (const type of ['pointerup', 'mouseup']) assert.equal(press(type, node()).defaultPrevented, false, `a ${type} still ends its gesture`);
  assert.equal(press('click', node({tagName: 'BUTTON'})).defaultPrevented, false, 'a dialog button over the canvas keeps working');
  assert.equal(press('pointerdown', node({ignored: true})).defaultPrevented, false, 'the sub panel keeps working');
  assert.equal(press('pointerdown', node({inViewport: false})).defaultPrevented, false, 'canvases elsewhere on the page keep working');
  assert.equal(button.disabled, true);
  release();
  assert.equal(press('pointerdown', node()).defaultPrevented, false, 'the canvas answers again after the picture');
  assert.equal(button.disabled, false);
});

test('a picture waits for a box selection the operator has armed or begun', () => {
  let boxing = false;
  const busy = fromIndex('vantageBusy', {authoringBusy: false, scenePlacementTools: {edits: {state: () => ({active: null, replaying: false})}},
    sceneNavigation: {state: () => ({gesture: null})}, transformGizmoDragging: false, transformControls: {dragging: false}, splatCorrectionMode: null,
    greenroomPreviewIsActive: () => false, window: {kaminosSelection: {boxing: () => boxing}}, controls: {state: -1}});
  assert.equal(busy(), null);
  boxing = true;
  assert.equal(busy(), 'A box selection is in progress', 'a box drawn in the operator view must not finish in the sub view');
});

test('box selection cannot begin during a picture, and never from the sub panel', () => {
  const document = new FakeElement(), viewport = new FakeElement();
  document.createElement = tag => new FakeElement(tag);
  document.getElementById = id => (id === 'viewport' ? viewport : null);
  let selection = [];
  const scope = {document, window: {kaminosSelection: {}, addEventListener() {}}, vantageCaptureHeld: true, controls: {enabled: true},
    scenePlacementTools: {edits: {state: () => ({active: null})}, state: () => ({modal: null})}, viewPie: null,
    greenroomPreviewIsActive: () => false, viewportEventHitsInteractiveOverlay: () => false, viewportEventIsInsideCanvas: () => true,
    objectsInScreenBox: () => ['picked'], sceneSelection: {ids: []}, setSceneSelection: ids => { selection = ids; },
    renderer: {domElement: {getBoundingClientRect: () => ({left: 0, top: 0, width: 800, height: 600})}}};
  fromIndexLive('installSelectionInput', scope)();
  const fire = (type, values = {}) => {
    const event = new Event(type, {cancelable: true});
    Object.defineProperty(event, 'target', {value: values.target ?? {closest: () => null}});
    for (const [key, value] of Object.entries(values)) if (key !== 'target') Object.defineProperty(event, key, {value});
    document.dispatchEvent(event);
  };
  fire('keydown', {key: 'b'});
  assert.equal(scope.window.kaminosSelection.boxing(), false, 'B during a picture arms nothing');
  scope.vantageCaptureHeld = false;
  fire('keydown', {key: 'b'});
  assert.equal(scope.window.kaminosSelection.boxing(), true);
  const panel = {closest: selector => (selector === '[data-vantage-ignore]' ? {} : null)};
  fire('pointerdown', {target: panel, button: 0, clientX: 10, clientY: 10});
  fire('pointerup', {target: panel, button: 0, clientX: 90, clientY: 90});
  assert.deepEqual(selection, [], 'a drag on the sub panel never box-selects the scene');
  fire('pointerdown', {button: 0, clientX: 10, clientY: 10});
  fire('pointerup', {button: 0, clientX: 90, clientY: 90});
  assert.deepEqual(selection, ['picked'], 'the same drag on the canvas selects');
});

test('click selection waits while a picture holds the viewport', () => {
  const calls = [];
  const scope = {vantageCaptureHeld: true, viewportEventHitsInteractiveOverlay: () => false, viewportEventIsInsideCanvas: () => true,
    viewportSuppressedClick: null, viewportPointerDown: null, greenroomPreviewIsActive: () => false, transformGizmoDragging: false, transformControls: null,
    pickFlameDomainFromViewportPointer: () => { calls.push('field'); return false; },
    pickSceneObjectFromViewportPointer: () => { calls.push('object'); return null; },
    clearActiveSceneObjectSelection: () => calls.push('clear'), selectedSplatRecord: () => null, window: {}};
  const event = type => ({type, button: 0, clientX: 40, clientY: 40, pointerId: 1, target: {closest: () => null}});
  fromIndexLive('handleViewportPointerDown', scope)(event('pointerdown'));
  fromIndexLive('handleViewportSelectionClick', scope)(event('click'));
  fromIndexLive('handleViewportDoubleClick', scope)(event('dblclick'));
  assert.deepEqual(calls, [], 'nothing is picked through the borrowed camera');
  scope.vantageCaptureHeld = false;
  fromIndexLive('handleViewportSelectionClick', scope)(event('click'));
  assert.ok(calls.includes('object'), 'the same click picks once the picture is done');
});

test('a picture waits for a touch gesture already moving the view', () => {
  const scope = {authoringBusy: false, scenePlacementTools: {edits: {state: () => ({active: null, replaying: false})}},
    sceneNavigation: {state: () => ({gesture: null})}, transformGizmoDragging: false, transformControls: {dragging: false}, splatCorrectionMode: null,
    greenroomPreviewIsActive: () => false, window: {kaminosSelection: {boxing: () => false}}, controls: {state: -1}};
  const busy = fromIndexLive('vantageBusy', scope);
  assert.equal(busy(), null);
  scope.controls.state = 3;
  assert.equal(busy(), 'A touch gesture is moving the view', 'a touch begun in the operator view must not move the borrowed camera');
});

test('tool framing buttons wait while a picture holds the viewport', () => {
  for (const name of ['frameForgeHostCamera', 'frameMotionAgencyCamera', 'frameVolumeCamera']) {
    const writes = [];
    const vector = label => ({set: (...value) => writes.push([label, value]), copy: () => writes.push([label]), fromArray: () => writes.push([label])});
    const scope = {vantageCaptureHeld: true, camera: {position: vector('position'), up: vector('up'), lookAt: () => writes.push(['lookAt'])},
      controls: {target: vector('target'), update() {}}};
    fromIndexLive(name, scope)();
    assert.deepEqual(writes, [], `${name} leaves the borrowed camera alone`);
    scope.vantageCaptureHeld = false;
    fromIndexLive(name, scope)();
    assert.ok(writes.length > 0, `${name} frames once the picture is done`);
  }
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
  return {vantage, refresh, painted, entries, map: viewport.children[0].querySelector('canvas'),
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

// --- gestures spanning a picture -------------------------------------------

// The page's OrbitControls (three 0.171.0, as pinned) on a fake canvas, with
// events delivered in DOM order: the window capture listener first, then the
// canvas unless the window stopped them.
async function orbitFixture() {
  const {OrbitControls} = await import('three/examples/jsm/controls/OrbitControls.js');
  const NPM = await import('three');
  const root = new FakeElement(), canvas = new FakeElement('canvas'), window = new FakeElement(), viewportEl = new FakeElement();
  Object.assign(canvas, {ownerDocument: root, getRootNode: () => root, clientWidth: 800, clientHeight: 600, closest: () => null});
  viewportEl.contains = node => node === canvas;
  const controls = new OrbitControls(new NPM.PerspectiveCamera(50, 4 / 3, 0.1, 1000), canvas);
  controls.mouseButtons = {LEFT: null, MIDDLE: null, RIGHT: null};
  controls.touches = {ONE: NPM.TOUCH.ROTATE, TWO: NPM.TOUCH.DOLLY_PAN};
  const deliver = (type, values) => {
    const make = () => { const event = new Event(type, {cancelable: true}); Object.defineProperty(event, 'target', {value: canvas}); Object.assign(event, values); return event; };
    const first = make();
    window.dispatchEvent(first);
    if (!first.cancelBubble) canvas.dispatchEvent(make());
  };
  const touch = (type, id, x = 400) => deliver(type, {pointerId: id, pointerType: 'touch', button: 0, clientX: x, clientY: 300, pageX: x, pageY: 300});
  const button = {disabled: false};
  const hold = fromIndex('holdViewportForVantage', {authoringBusy: false, vantageCaptureHeld: false, viewportEl, window,
    document: {getElementById: id => (id === 'composition-capture' ? button : null)}});
  const busy = fromIndexLive('vantageBusy', {authoringBusy: false, scenePlacementTools: {edits: {state: () => ({active: null, replaying: false})}},
    sceneNavigation: {state: () => ({gesture: null})}, transformGizmoDragging: false, transformControls: {dragging: false}, splatCorrectionMode: null,
    greenroomPreviewIsActive: () => false, window: {kaminosSelection: {boxing: () => false}}, controls});
  return {controls, deliver, touch, hold, busy};
}

test('a gesture that began before a picture still ends, so navigation is whole afterwards', async () => {
  const left = await orbitFixture();
  left.deliver('pointerdown', {pointerId: 1, pointerType: 'mouse', button: 0, clientX: 400, clientY: 300});
  assert.equal(left.busy(), null, 'a plain left press does not move the view');
  let release = left.hold();
  left.deliver('pointerup', {pointerId: 1, pointerType: 'mouse', button: 0, clientX: 400, clientY: 300});
  release();
  assert.deepEqual(left.controls._pointers, [], 'the press ended even though it ended during the picture');
  left.touch('pointerdown', 2);
  assert.equal(left.controls.state, 3, 'the next touch rotates as usual');

  const three = await orbitFixture();
  three.touch('pointerdown', 41, 400);
  three.touch('pointerdown', 42, 420);
  assert.equal(three.busy(), 'A touch gesture is moving the view');
  three.touch('pointerdown', 43, 440);
  release = three.hold();
  for (const id of [41, 42, 43]) three.touch('pointerup', id);
  release();
  assert.deepEqual(three.controls._pointers, [], 'every touch lifted during the picture is let go');
  three.touch('pointerdown', 44);
  assert.equal(three.controls.state, 3);
});

test('the lighting probe never picks through the sub panel or a borrowed camera', async () => {
  const {mountLightingDebugView} = await import('../scene-light-debug-view.mjs');
  const document = new FakeElement(), elements = new Map();
  document.getElementById = id => {
    if (!elements.has(id)) elements.set(id, Object.assign(new FakeElement(), {id, checked: false, value: '', textContent: '', replaceChildren() {}}));
    return elements.get(id);
  };
  document.createElement = tag => Object.assign(new FakeElement(tag), {replaceChildren() {}, getContext: () => new Proxy({}, {get: () => () => {}, set: () => true})});
  const viewport = new FakeElement();
  viewport.contains = node => node?.inViewport === true;
  const camera = new PerspectiveCamera(50, 4 / 3, 0.1, 1000); camera.position.z = 5; camera.updateMatrixWorld(true);
  const renderer = {domElement: {parentElement: viewport, width: 800, height: 600, getBoundingClientRect: () => ({left: 0, top: 0, width: 800, height: 600})}};
  let held = true;
  // The probe warns before unload through the global object, which Node lacks.
  globalThis.addEventListener ??= () => {};
  globalThis.location ??= {href: 'http://127.0.0.1/index.html'};
  mountLightingDebugView({document, renderer, camera, held: () => held, drawFrame() {}, beginSceneInspection: () => () => {},
    getLighting: () => ({inspectSurface: async () => ({}), inspectionMeshes: () => [], debugState: () => ({})}),
    getPrototype: () => ({debugState: () => ({}), setSelectiveHeadLiveCapturePaused() {}})});
  document.getElementById('rendering-light-debug-pick').onclick();
  const status = () => document.getElementById('rendering-light-debug-status').textContent;
  const armedText = status();
  const press = target => {
    const event = new Event('pointerdown', {cancelable: true});
    Object.defineProperty(event, 'target', {value: target});
    Object.assign(event, {clientX: 400, clientY: 300});
    document.dispatchEvent(event);
  };
  const scene = {inViewport: true, closest: () => null};
  const panel = {inViewport: true, closest: selector => (selector.includes('[data-vantage-ignore]') ? {} : null)};
  held = false;
  press(panel);
  assert.equal(status(), armedText, 'a click on the sub panel is not a surface');
  held = true;
  press(scene);
  assert.equal(status(), armedText, 'during a picture the probe waits rather than read the borrowed camera');
  held = false;
  press(scene);
  assert.notEqual(status(), armedText, 'afterwards the same click inspects');
  await new Promise(resolve => setTimeout(resolve, 20)); // let the inspection settle inside the test
});

// --- pick -------------------------------------------------------------------

const closeTo = (actual, expected, message, epsilon = 1e-6) => {
  assert.equal(actual?.length, expected.length, message);
  actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) <= epsilon, `${message}: [${i}] ${value} != ${expected[i]}`));
};
// Where a world point lands in a picture taken from `view`, as fractions from the top left.
function pictureFraction(view, aspect, point) {
  const camera = new PerspectiveCamera(view.fov, aspect, view.near, view.far);
  camera.position.fromArray(view.position); camera.up.fromArray(view.up); camera.lookAt(new Vector3(...view.target));
  camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
  const ndc = new Vector3(...point).project(camera);
  return [(ndc.x + 1) / 2, (1 - ndc.y) / 2];
}
const OPERATOR = {position: [0, 1, 6], target: [0, 1, 0], up: [0, 1, 0], fov: 50, near: 0.1, far: 1000};

test('pick from the operator view names the object, the point on it and its surface', async () => {
  const page = installedPage();
  // Box 1 is a unit box centred at (2, 0, 0); its front face is at z = 0.5.
  const picked = await page.vantage.run('pick', {from: 'operator', at: pictureFraction(OPERATOR, 1600 / 900, [2, 0.1, 0.5])});
  assert.equal(picked.kind, 'pick');
  assert.equal(picked.from, 'operator');
  assert.equal(picked.hit?.id, 'box-1');
  closeTo(picked.hit.point, [2, 0.1, 0.5], 'world point');
  closeTo(picked.hit.local, [0, 0.1, 0.5], 'the same point in the object\'s own frame');
  closeTo(picked.hit.normal, [0, 0, 1], 'the surface faces the camera');
  assert.deepEqual(picked.hit.surface.path, [0], 'the mesh is the first child of the object');
  assert.ok(Number.isInteger(picked.hit.surface.face));
  assert.equal(picked.hit.geometry.vertices, 24);
  const past = await page.vantage.run('pick', {from: 'operator', at: [0.5, 0.02]});
  assert.equal(past.hit, null, 'a ray past every object hits nothing');
});

test('pick from the sub uses the sub camera, and a picture camera names what that picture showed', async () => {
  const page = installedPage({subs: [BEBOP]});
  const subView = cameraViewFromRecord(BEBOP, 800 / 600, 3);
  const fromSub = await page.vantage.run('pick', {at: pictureFraction(subView, 800 / 600, [0, 0.1, 0.5])});
  assert.equal(fromSub.from, 'vantage-bebop');
  assert.equal(fromSub.hit?.id, 'box-0');
  closeTo(fromSub.hit.local, [0, 0.1, 0.5], 'box 0 sits at the origin');
  // A camera given without its picture's objects is cast into the scene as it is now.
  const view = {position: [4, 1, 5], target: [4, 0, 0], up: [0, 1, 0], fov: 40, near: 0.1, far: 1000};
  const camera = new PerspectiveCamera(view.fov, 16 / 9, view.near, view.far);
  camera.position.fromArray(view.position); camera.lookAt(new Vector3(...view.target)); camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
  const optics = {projection: camera.projectionMatrix.toArray(), viewInverse: camera.matrixWorldInverse.toArray()};
  const fromPicture = await page.vantage.run('pick', {optics, at: pictureFraction(view, 16 / 9, [4, -0.2, 0.5])});
  assert.equal(fromPicture.from, 'camera', 'without the picture\'s objects this is today\'s scene, and says so');
  assert.equal(fromPicture.hit?.id, 'box-2');
  closeTo(fromPicture.hit.local, [0, -0.2, 0.5], 'box 2 sits at x = 4');
});

test('pictures carry the matrices they were rendered with, so a pixel can be picked later', async () => {
  const {state, pilot} = await launched();
  const shot = await pilot.run('snap', {map: false});
  assert.deepEqual(shot.optics, opticsOf(state.writes[0]), 'the snap records the sub camera it rendered with');
  const burst = await pilot.run('burst', {count: 2, map: false});
  assert.equal(burst.frames.length, 2);
  for (const frame of burst.frames) assert.equal(frame.optics?.projection?.length, 16, 'every burst frame records its camera');
});

test('a pick from the operator view waits while a picture has borrowed the camera', async () => {
  const {state, pilot} = await launched();
  let during = null;
  state.duringFrames = () => {
    if (during === null) during = pilot.run('pick', {from: 'operator', at: [0.5, 0.5]}).then(() => 'picked', error => error.phase);
  };
  await pilot.run('snap', {map: false});
  assert.equal(await during, 'busy', 'mid-picture the viewport camera is the sub\'s, not the operator\'s');
});

test('a page reader can ask whether a picture holds the camera, and wait for it to finish', async () => {
  const {state, pilot} = await launched();
  assert.equal(pilot.isCapturing(), false);
  await pilot.idle();
  let seen = null, waited = null;
  state.duringFrames = () => {
    if (seen !== null) return;
    seen = pilot.isCapturing();
    waited = pilot.idle().then(() => pilot.isCapturing());
  };
  await pilot.run('snap', {map: false});
  assert.equal(seen, true, 'mid-picture the page reports the hold');
  assert.equal(await waited, false, 'idle settles once the picture is done');
});

// --- picks on kept pictures --------------------------------------------------

// How a picture records an object it showed: where each mesh stood, and how to
// tell later whether the geometry under it is the same.
function poseRecord(entry) {
  entry.object.updateWorldMatrix(true, true);
  const meshes = [];
  entry.object.traverse(node => {
    if (!node.isMesh) return;
    const path = [];
    for (let at = node; at && at !== entry.object; at = at.parent) path.unshift(at.parent.children.indexOf(at));
    meshes.push({path, matrixWorld: node.matrixWorld.toArray(), geometry: {uuid: node.geometry.uuid,
      version: node.geometry.attributes.position.version, vertices: node.geometry.attributes.position.count, indices: node.geometry.index?.count ?? null}});
  });
  return {id: entry.id, root: entry.object.matrixWorld.toArray(), meshes};
}

test('a pick on a kept picture finds what the picture showed, and says what has changed since', async () => {
  const page = installedPage();
  const view = {position: [2, 1, 6], target: [2, 0, 0], up: [0, 1, 0], fov: 40, near: 0.1, far: 1000};
  const camera = new PerspectiveCamera(view.fov, 16 / 9, view.near, view.far);
  camera.position.fromArray(view.position); camera.lookAt(new Vector3(...view.target)); camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
  const optics = {projection: camera.projectionMatrix.toArray(), viewInverse: camera.matrixWorldInverse.toArray()};
  const at = pictureFraction(view, 16 / 9, [2, 0.1, 0.5]);
  const box = page.entries[1];
  const pose = poseOfEntries([box], {session: page.vantage.pageId, THREE});
  box.object.position.x += 3;   // the box moves away after the picture
  const later = await page.vantage.run('pick', {optics, at, pose});
  assert.equal(later.hit?.id, 'box-1', 'the box the picture showed, where it stood then');
  closeTo(later.hit.local, [0, 0.1, 0.5], 'the same spot on the box');
  assert.equal(later.hit.pictured, true);
  assert.equal(later.hit.moved, true, 'and it says the box has moved since');
  assert.equal(later.hit.geometry.status, 'same');
  const now = await page.vantage.run('pick', {optics, at});
  assert.notEqual(now.hit?.id, 'box-1', 'without the picture\'s record the ray meets today\'s scene');
  const mesh = box.object.children[0];
  mesh.geometry.attributes.position.needsUpdate = true;
  assert.equal((await page.vantage.run('pick', {optics, at, pose})).hit.geometry.status, 'edited');
  mesh.geometry = new THREE.BoxGeometry(1, 1, 1);
  assert.equal((await page.vantage.run('pick', {optics, at, pose})).hit.geometry.status, 'replaced',
    'another geometry object in the same page session, even with the same counts');
  mesh.geometry = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2);
  assert.equal((await page.vantage.run('pick', {optics, at, pose})).hit.geometry.status, 'replaced');
  page.entries.splice(1, 1);
  const gone = await page.vantage.run('pick', {optics, at, pose});
  assert.deepEqual(gone.missing, ['box-1'], 'an object the picture showed that is gone is named as missing');
});

test('pictures record where the objects they show stood', async () => {
  const {state, pilot} = await launched();
  state.objectPose = [{id: 'centre', root: Array(16).fill(1), meshes: []}, {id: 'side', root: Array(16).fill(2), meshes: []}];
  const shot = await pilot.run('snap', {map: false});
  assert.deepEqual(shot.scenePose.map(entry => entry.id), shot.objects.inView.map(object => object.id),
    'only what the picture shows is recorded');
  const burst = await pilot.run('burst', {count: 2, map: false});
  for (const frame of burst.frames) assert.ok(Array.isArray(frame.scenePose), 'every burst frame records its objects');
});

// --- what a pick may and may not name -----------------------------------------

const boxEntry = (id, position, {material} = {}) => {
  const object = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material ?? new THREE.MeshBasicMaterial());
  object.position.fromArray(position);
  return {id, label: id, type: 'procedural-mesh', object};
};
const towardMinusZ = {origin: [0, 0, 10], direction: [0, 0, -1]};

test('while the operator looks through the sub, a sub pick uses the framed view they see', async () => {
  const framed = opticsOf({position: [0, 1, 6], target: [0, 1, 0], up: [0, 1, 0], fov: 30, near: 0.1, far: 1000});
  framed.projection[8] = 0.3;   // a camera-frame offset lives in the projection
  let cast = null;
  const app = await launched();
  app.state.settings.activeId = 'vantage-bebop'; app.state.mode = 'camera'; app.state.optics = framed;
  app.host.raycast = ray => { cast = ray; return {hits: [], missing: []}; };
  const viaHost = createVantagePilot(app.host);
  const result = await viaHost.run('pick', {at: [0.5, 0.5]});
  closeTo(result.ray.direction, rayThrough(framed, [0.5, 0.5]).direction, 'the framed centre ray, not the nominal one');
  closeTo(cast.direction, result.ray.direction, 'the page casts the same ray');
});

test('geometry replaced in the same page session is called replaced, even with the same counts', () => {
  const entry = boxEntry('kiln', [0, 0, 0]);
  const pose = poseOfEntries([entry], {session: 'page-a', THREE});
  entry.object.geometry = new THREE.BoxGeometry(2, 1, 1);
  const same = raycastEntries(THREE, [entry], towardMinusZ, {pose, session: 'page-a'});
  assert.equal(same.hits[0]?.geometry.status, 'replaced', 'a new geometry object in the same session is a replacement');
  const later = raycastEntries(THREE, [entry], towardMinusZ, {pose, session: 'page-b'});
  assert.equal(later.hits[0]?.geometry.status, 'replaced', 'after a reload, a sampled content check still tells them apart');
  const untouched = boxEntry('kiln', [0, 0, 0]);
  const reloaded = raycastEntries(THREE, [untouched], towardMinusZ, {pose: poseOfEntries([untouched], {session: 'page-a', THREE}), session: 'page-b'});
  assert.equal(reloaded.hits[0]?.geometry.status, 'likely-same', 'the same content after a reload matches by sample, not by identity');
});

test('invisible surfaces are not what lies under the point', () => {
  for (const hide of [material => { material.visible = false; }, material => { material.transparent = true; material.opacity = 0; }]) {
    const material = new THREE.MeshBasicMaterial();
    hide(material);
    const result = raycastEntries(THREE, [boxEntry('ghost', [0, 0, 5], {material}), boxEntry('wall', [0, 0, 0])], towardMinusZ);
    assert.equal(result.hits[0]?.id, 'wall');
  }
});

test('a pick respects the camera clipping planes', () => {
  const camera = new PerspectiveCamera(50, 1, 1, 20);
  camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
  const optics = {projection: camera.projectionMatrix.toArray(), viewInverse: camera.matrixWorldInverse.toArray(), near: 1, coordinateSystem: camera.coordinateSystem};
  const tiny = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial()); tiny.position.set(0, 0, 9.5);
  const entries = [{id: 'before-near', label: 'tiny', type: 'procedural-mesh', object: tiny}, boxEntry('seen', [0, 0, 0]), boxEntry('past-far', [0, 0, -15])];
  const result = raycastEntries(THREE, entries, rayThrough(optics, [0.5, 0.5]), {optics});
  assert.equal(result.hits[0]?.id, 'seen', 'nothing before the near plane intercepts the pick');
  assert.ok(!result.hits.some(hit => hit.id === 'past-far'), 'nothing past the far plane is named');
});

test('an instanced surface keeps its instance and its true normal', () => {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 2);
  mesh.setMatrixAt(0, new THREE.Matrix4().makeRotationY(Math.PI / 4));
  mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(10, 0, 0));
  const result = raycastEntries(THREE, [{id: 'rocks', label: 'rocks', type: 'glb', object: mesh}],
    {origin: [-3, 0, 3], direction: [1, 0, -1]});
  assert.equal(result.hits[0]?.surface.instance, 0);
  closeTo(result.hits[0].normal, [-Math.SQRT1_2, 0, Math.SQRT1_2], 'the face normal turned with its instance', 1e-9);
});

test('a splat along the ray is reported, not silently looked through', () => {
  const positions = new Float32Array([0, 0, 5, 0.1, 0, 5, -0.1, 0.05, 5]);
  const cloud = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3)), new THREE.PointsMaterial());
  const splat = new THREE.Group(); splat.add(cloud);
  const result = raycastEntries(THREE, [{id: 'plume', label: 'Plume', type: 'splat', object: splat}, boxEntry('wall', [0, 0, 0])], towardMinusZ);
  assert.deepEqual(result.unresolved.map(item => item.id), ['plume'], 'the splat in front is named as something the pick cannot resolve');
  assert.equal(result.hits[0]?.id, 'wall');
});

// --- how much a picture pick can vouch for --------------------------------------

const pictureOf = entries => ({pose: poseOfEntries(entries, {session: 'page-a', THREE}), session: 'page-a'});
const castPicture = (entries, record, ray = towardMinusZ, extra = {}) =>
  raycastEntries(THREE, entries, ray, {pose: record.pose, session: record.session, ...extra});

test('a picture pick vouches for what it finds only when nothing it could have shown has changed', () => {
  const front = boxEntry('front', [0, 0, 5]), back = boxEntry('back', [0, 0, 0]);
  const record = pictureOf([front, back]);
  const exact = castPicture([front, back], record);
  assert.equal(exact.hits[0].id, 'front');
  assert.equal(exact.reconstruction.status, 'exact');
  front.object.geometry = new THREE.BoxGeometry(1, 1, 1).translate(5, 0, 0);   // the front surface leaves the ray
  const after = castPicture([front, back], record);
  assert.equal(after.reconstruction.status, 'approximate', 'the picture may have shown the front box here');
  assert.deepEqual(after.reconstruction.changed.map(item => [item.id, item.what]), [['front', 'geometry']]);
  assert.equal(after.hits[0]?.authority, 'approximate', 'the back box is offered, but not as what the picture showed');
});

test('moved instances, hidden meshes and point clouds are judged as the picture saw them', () => {
  const rocks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 2);
  rocks.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0, 5));
  rocks.setMatrixAt(1, new THREE.Matrix4().makeTranslation(0, 0, 0));
  const rockEntry = {id: 'rocks', label: 'rocks', type: 'glb', object: rocks};
  const record = pictureOf([rockEntry]);
  rocks.setMatrixAt(0, new THREE.Matrix4().makeTranslation(4, 0, 5)); rocks.instanceMatrix.needsUpdate = true;
  const moved = castPicture([rockEntry], record);
  assert.deepEqual(moved.reconstruction.changed.map(item => [item.id, item.what]), [['rocks', 'instances']]);

  const group = new THREE.Group();
  const hidden = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()); hidden.position.z = 5; hidden.visible = false;
  const shownMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  group.add(hidden, shownMesh);
  const grouped = {id: 'kiln', label: 'kiln', type: 'glb', object: group};
  const grouping = castPicture([grouped], pictureOf([grouped]));
  assert.deepEqual(grouping.hits[0]?.surface.path, [1], 'a mesh hidden when the picture was taken is not what it showed');

  const positions = new Float32Array([0, 0, 5, 0.1, 0, 5]);
  const cloud = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3)), new THREE.PointsMaterial());
  const scan = {id: 'scan', label: 'scan', type: 'ply', object: cloud}, wall = boxEntry('wall', [0, 0, 0]);
  const clouded = castPicture([scan, wall], pictureOf([scan, wall]));
  assert.deepEqual(clouded.unresolved.map(item => item.id), ['scan'], 'a point cloud the picture showed in front is reported');
  assert.equal(clouded.reconstruction.status, 'approximate');
});

test('a picture pick reports normals in the pictured pose and restores exactly what it moved', () => {
  const box = boxEntry('box', [0, 0, 0]);
  const record = pictureOf([box]);
  box.object.rotation.y = Math.PI / 2;
  const turned = castPicture([box], record);
  closeTo(turned.hits[0].normal, [0, 0, 1], 'the normal of the surface the picture showed', 1e-9);
  const manual = boxEntry('manual', [0, 0, 0]);
  const manualRecord = pictureOf([manual]);
  manual.object.matrixWorldAutoUpdate = false;
  manual.object.matrixWorld.makeTranslation(5, 0, 0);
  castPicture([manual], manualRecord);
  assert.equal(manual.object.matrixWorld.elements[12], 5, 'a hand-managed world matrix is put back as it was');
});

test('geometry edits that keep the same object are not called same', () => {
  const box = boxEntry('box', [0, 0, 0]);
  const record = pictureOf([box]);
  box.object.geometry.setAttribute('position', new THREE.BoxGeometry(2, 1, 1).attributes.position);
  assert.equal(castPicture([box], record).hits[0]?.geometry.status, 'edited', 'a replaced position attribute is an edit');
  const other = boxEntry('other', [0, 0, 0]);
  const otherRecord = pictureOf([other]);
  other.object.geometry.index.array[0] = other.object.geometry.index.array[1]; other.object.geometry.index.needsUpdate = true;
  assert.equal(castPicture([other], otherRecord).hits[0]?.geometry.status, 'edited', 'a topology edit is an edit');
});

test('reversed WebGL depth clips at its own far plane', () => {
  const camera = new PerspectiveCamera(50, 1, 1, 20);
  camera._reversedDepth = true;   // the renderer sets this; the getter is read-only
  camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
  const optics = {projection: camera.projectionMatrix.toArray(), viewInverse: camera.matrixWorldInverse.toArray(), near: 1,
    coordinateSystem: camera.coordinateSystem, reversedDepth: true};
  const result = raycastEntries(THREE, [boxEntry('past-far', [0, 0, -15])], rayThrough(optics, [0.5, 0.5]), {optics});
  assert.equal(result.hits.length, 0, 'beyond the far plane is not in the picture');
});
