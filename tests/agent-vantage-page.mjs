// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as vantage from '../agent-vantage.mjs';
import {createVantagePilot, createCommandPump, installAgentVantage} from '../agent-vantage.mjs';
import {poseAxes, poseLookingAt, rayThrough} from '../agent-vantage-core.mjs';
import * as core from '../agent-vantage-core.mjs';
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
    size: {width: 1600, height: 900}, optics: null, duringFrames: null, restoreThrows: false, idPasses: [], idPassThrows: null,
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
    // The page's ID pass: every picture asks for one with the matrices it was composed with.
    drawIds(options) {
      state.idPasses.push({...copy(options), view: copy(state.view)});
      if (state.idPassThrows) throw new Error(state.idPassThrows);
      const {width, height} = options, objects = new Uint16Array(width * height).fill(1), instances = new Uint16Array(width * height);
      objects.fill(2, 0, width);   // the top row shows the side box
      const depths = options.depth ? new Float32Array(width * height).fill(4) : undefined;
      const row = (n, id, label) => ({n, id, label, type: 'procedural-mesh', path: [0], matrixWorld: Array(16).fill(0), root: Array(16).fill(0)});
      return {rows: [row(1, 'centre', 'Centre box'), row(2, 'side', 'Side box'), row(3, 'covered', 'Covered box')],
        context: {clouds: [], fields: [], water: false}, ready: Promise.resolve({width, height, objects, instances, depths})};
    },
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
function installedPage({subs = [], drawnAt = null, water = false} = {}) {
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
  const idPass = fakeIdPass(() => entries, {drawnAt});
  const viewport = element('div'), hostCanvas = element('canvas');
  hostCanvas.width = 1600; hostCanvas.height = 1200;   // the drawing buffer at a device pixel ratio of 2
  const vantage = installAgentVantage({THREE, document, window, edits: {state: () => ({active: null, replaying: false})},
    cameras: {read: () => ({settings: {activeId: null, aspect: [16, 9]}, cameras: copy(records)}), state: () => ({mode: 'user', activeId: null})},
    entries: () => entries, selection: () => [], readView: () => ({position: [0, 1, 6], target: [0, 1, 0], up: [0, 1, 0], fov: 50, near: 0.1, far: 1000}),
    writeView() {}, viewport, hostCanvas, busy: () => null, hold: () => () => {},
    cameraMatrices: () => projection, suspendEditorDrawing: () => () => {}, redraw() {}, frameState: () => ({layers: {}}), link: false,
    idPass, water: () => water});
  const refresh = intervals.find(item => item.ms === 400).fn;
  return {vantage, refresh, painted, entries, idPass, map: viewport.children[0].querySelector('canvas'),
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
const shownChain = object => { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; };

// Stands in for the renderer's ID pass in Node. Each pixel asked about shows
// the nearest visible mesh a ray through its centre meets, unless the test
// says the renderer drew something else there, as it does for a cut-out or a
// vertex shader. Numbers last for the page, as the real pass's do.
function fakeIdPass(entries, {drawnAt = null} = {}) {
  const numbers = new Map(), objects = [], calls = [], caster = new THREE.Raycaster();
  const numberOf = object => { if (!numbers.has(object)) { objects.push(object); numbers.set(object, objects.length); } return numbers.get(object); };
  return {
    calls,
    draw({optics, width, height, hide = [], region = [0, 0, width, height], depth = false}) {
      calls.push({optics, width, height, hide, region, depth});
      const [x0, y0, w, h] = region, ids = new Uint16Array(w * h), instances = new Uint16Array(w * h), depths = new Float32Array(w * h), drawn = new Set();
      const view = new THREE.Matrix4().fromArray(optics.viewInverse);
      const shown = entries().filter(entry => !hide.includes(entry.id)).map(entry => entry.object);
      for (const object of shown) object.updateWorldMatrix(true, true);   // as rendering the scene does
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const at = [(x0 + x + 0.5) / width, (y0 + y + 0.5) / height], ray = rayThrough(optics, at);
          let hit = drawnAt?.(at);
          if (hit === undefined) {
            caster.set(new Vector3(...ray.origin), new Vector3(...ray.direction));
            hit = caster.intersectObjects(shown, true).find(item => item.object.isMesh && shownChain(item.object)) ?? null;
          }
          if (!hit) continue;
          ids[y * w + x] = numberOf(hit.object); instances[y * w + x] = hit.instanceId ?? 0; drawn.add(hit.object);
          depths[y * w + x] = hit.depth ?? (hit.point ? -hit.point.clone().applyMatrix4(view).z : 0);
        }
      }
      return {drawn: [...drawn].map(object => ({n: numberOf(object), object})),
        ready: Promise.resolve({width: w, height: h, objects: ids, instances, ...(depth ? {depths} : {})})};
    },
  };
}

test('pick from the operator view names what the renderer drew there, the point on it and its surface', async () => {
  const page = installedPage();
  // Box 1 is a unit box centred at (2, 0, 0); its front face is at z = 0.5.
  const picked = await page.vantage.run('pick', {from: 'operator', at: pictureFraction(OPERATOR, 1600 / 900, [2, 0.1, 0.5])});
  assert.equal(picked.kind, 'pick');
  assert.equal(picked.from, 'operator');
  assert.equal(picked.referent, 'rendered', 'a live pick asks the renderer what it draws now');
  assert.equal(picked.hit?.id, 'box-1');
  assert.equal(picked.hit.authority, 'exact');
  // The pick names the pixel `at` falls in, through that pixel's centre: within half a pixel of the asked point.
  closeTo(picked.hit.point, [2, 0.1, 0.5], 'world point', 5e-3);
  closeTo(picked.hit.local, [0, 0.1, 0.5], 'the same point in the object\'s own frame', 5e-3);
  closeTo(picked.ray.direction, rayThrough(opticsOf(OPERATOR), picked.pixelCentre).direction, 'the ray through the pixel centre');
  assert.equal(picked.hit.pointBasis, 'depth', 'the point is where the renderer drew it');
  assert.equal(picked.hit.surfaceBasis, 'recast-agrees');
  closeTo(picked.hit.normal, [0, 0, 1], 'the surface faces the camera');
  assert.deepEqual(picked.hit.surface.path, [0], 'the mesh is the first child of the object');
  assert.ok(Number.isInteger(picked.hit.surface.face));
  const call = page.idPass.calls.at(-1);
  assert.deepEqual(call.region.slice(2), [1, 1], 'a live pick reads back only its own pixel');
  assert.deepEqual(call.optics.projection, opticsOf(OPERATOR).projection, 'drawn with the matrices the operator viewport renders with');
  const past = await page.vantage.run('pick', {from: 'operator', at: [0.5, 0.02]});
  assert.equal(past.hit, null, 'a ray past every object hits nothing');
  assert.deepEqual(past.drawn, {kind: 'nothing'});
});

test('a live pick names what the renderer drew at the point, not what a ray meets first', async () => {
  // A cut-out or a vertex shader can leave the nearest triangle undrawn: the renderer drew box 2 behind it.
  const page = installedPage({drawnAt: () => ({object: page.entries[2].object.children[0]})});
  const picked = await page.vantage.run('pick', {from: 'operator', at: pictureFraction(OPERATOR, 1600 / 900, [2, 0.1, 0.5])});
  assert.equal(picked.hit?.id, 'box-2', 'the renderer\'s answer, though a ray meets box 1 first');
  assert.equal(picked.hit.point, null, 'the ray never meets box 2, so there is no point to claim on it');
  assert.equal(picked.hit.pointBasis, 'missed');
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(10, 10)); ground.name = 'ground';
  const onGround = installedPage({drawnAt: () => ({object: ground})});
  const floor = await onGround.vantage.run('pick', {from: 'operator', at: [0.5, 0.9]});
  assert.equal(floor.hit, null);
  assert.deepEqual(floor.drawn, {kind: 'not-a-scene-object', name: 'ground', type: 'Mesh'}, 'drawn, but not by a scene object');
});

test('pick from the sub draws the sub view, and a picture camera without its map is today\'s scene', async () => {
  const page = installedPage({subs: [BEBOP]});
  const subView = cameraViewFromRecord(BEBOP, 800 / 600, 3);
  const fromSub = await page.vantage.run('pick', {at: pictureFraction(subView, 800 / 600, [0, 0.1, 0.5])});
  assert.equal(fromSub.from, 'vantage-bebop');
  assert.equal(fromSub.hit?.id, 'box-0');
  closeTo(fromSub.hit.local, [0, 0.1, 0.5], 'box 0 sits at the origin', 5e-3);
  assert.deepEqual(page.idPass.calls.at(-1).hide, ['vantage-bebop'], 'the sub is not drawn into its own pick');
  const view = {position: [4, 1, 5], target: [4, 0, 0], up: [0, 1, 0], fov: 40, near: 0.1, far: 1000};
  const camera = new PerspectiveCamera(view.fov, 16 / 9, view.near, view.far);
  camera.position.fromArray(view.position); camera.lookAt(new Vector3(...view.target)); camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
  const optics = {projection: camera.projectionMatrix.toArray(), viewInverse: camera.matrixWorldInverse.toArray()};
  const fromCamera = await page.vantage.run('pick', {optics, at: pictureFraction(view, 16 / 9, [4, -0.2, 0.5])});
  assert.equal(fromCamera.from, 'camera', 'without the picture\'s map this is today\'s scene, and says so');
  assert.equal(fromCamera.referent, 'rendered');
  assert.equal(fromCamera.hit?.id, 'box-2');
});

test('while the operator looks through the sub, a sub pick draws the framed view they see', async () => {
  const framed = opticsOf({position: [0, 1, 6], target: [0, 1, 0], up: [0, 1, 0], fov: 30, near: 0.1, far: 1000});
  framed.projection[8] = 0.3;   // a camera-frame offset lives in the projection
  const app = await launched();
  app.state.settings.activeId = 'vantage-bebop'; app.state.mode = 'camera'; app.state.optics = framed;
  let drawnWith = null;
  app.host.drawIds = options => { drawnWith = options.optics; return {rows: [], context: {clouds: [], fields: [], water: false}, ready: Promise.resolve({width: 1, height: 1, objects: Uint16Array.of(0), instances: Uint16Array.of(0)})}; };
  const result = await createVantagePilot(app.host).run('pick', {at: [0.5, 0.5]});
  closeTo(result.ray.direction, rayThrough(framed, result.pixelCentre).direction, 'the framed ray, not the nominal one');
  closeTo(result.pixelCentre, [0.5 + 0.5 / 1600, 0.5 + 0.5 / 900], 'through the centre of the pixel the point falls in');
  assert.deepEqual(drawnWith.projection, framed.projection, 'the pick map is drawn through the same frame');
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

// --- pick maps: what a picture drew ---------------------------------------------

test('every picture carries a pick map drawn with the matrices it was composed with', async () => {
  const {state, pilot} = await launched();
  const shot = await pilot.run('snap', {map: false});
  assert.equal(state.idPasses.length, 1);
  assert.deepEqual(state.idPasses[0].optics, shot.optics, 'the map uses the camera the picture recorded');
  assert.deepEqual(state.idPasses[0].view, state.writes[0], 'and is drawn while the sub view is still borrowed');
  assert.deepEqual([state.idPasses[0].width, state.idPasses[0].height], [shot.image.width, shot.image.height], 'one map pixel per picture pixel');
  assert.deepEqual(state.idPasses[0].hide, ['vantage-bebop'], 'the sub is not in its own map');
  assert.equal(shot.pickMap.schema, core.PICK_MAP_SCHEMA);
  assert.deepEqual(shot.pickMap.objects.map(row => row.id), ['centre', 'side'], 'only what the map shows is kept');
  assert.equal(core.pickRunAt(shot.pickMap, [0.5, 0]).n, 2, 'the top row shows the side box');
  assert.equal(core.pickRunAt(shot.pickMap, [0.5, 0.5]).n, 1);
  assert.equal(shot.scenePose, undefined, 'a picture no longer records objects for rebuilding it later');
  const burst = await pilot.run('burst', {count: 2, map: false});
  assert.equal(state.idPasses.length, 3, 'a burst draws a map for every frame');
  for (const frame of burst.frames) assert.equal(frame.pickMap?.schema, core.PICK_MAP_SCHEMA);
  const peek = await pilot.run('peek', {map: false});
  assert.equal(peek.pickMap?.schema, core.PICK_MAP_SCHEMA, 'the operator\'s own view too');
});

test('a picture whose pick map cannot be drawn is still returned, and says why', async () => {
  const {state, pilot} = await launched();
  state.idPassThrows = 'no GPU';
  const shot = await pilot.run('snap', {map: false});
  assert.equal(shot.pickMap, null);
  assert.match(shot.pickMapError, /no GPU/);
  assert.equal(shot.images.length, 1, 'the picture itself is kept');
});

// What a kept picture's map says about box 1, as the page wrote it down when the map was drawn.
function picturedRow(page, index = 1) {
  const entry = page.entries[index], mesh = entry.object.children[0];
  entry.object.updateWorldMatrix(true, true);
  return {n: 7, instance: 0, id: entry.id, label: entry.label, type: entry.type, path: [0], mesh: null,
    matrixWorld: mesh.matrixWorld.toArray(), root: entry.object.matrixWorld.toArray(), geometry: vantage.geometryIdentity?.(mesh, page.vantage.pageId) ?? null};
}
const PICTURE_VIEW = {position: [2, 1, 6], target: [2, 0, 0], up: [0, 1, 0], fov: 40, near: 0.1, far: 1000};
// The view depth a picture keeps for a world point: its distance along the camera's viewing axis.
const viewDepth = (optics, point) => -new Vector3(...point).applyMatrix4(new THREE.Matrix4().fromArray(optics.viewInverse)).z;
function pictureOptics(view = PICTURE_VIEW) {
  const camera = new PerspectiveCamera(view.fov, 16 / 9, view.near, view.far);
  camera.position.fromArray(view.position); camera.lookAt(new Vector3(...view.target)); camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
  return {projection: camera.projectionMatrix.toArray(), viewInverse: camera.matrixWorldInverse.toArray()};
}

test('a pick on a kept picture names what its map shows there, whatever the scene has done since', async () => {
  const page = installedPage(), optics = pictureOptics(), at = pictureFraction(PICTURE_VIEW, 16 / 9, [2, 0.1, 0.5]);
  const pictured = picturedRow(page), box = page.entries[1], mesh = box.object.children[0];
  // The review's cases: hidden, emptied, deformed, moved. None of them changes what the picture drew.
  mesh.material.visible = false;
  mesh.geometry.setDrawRange(0, 0);
  box.object.position.x += 3;
  const later = await page.vantage.run('pick', {optics, at, pictured});
  assert.equal(later.from, 'picture');
  assert.equal(later.referent, 'pictured');
  assert.equal(later.hit?.id, 'box-1', 'what the picture drew at that pixel');
  assert.equal(later.hit.authority, 'exact', 'the map is the renderer\'s own record; nothing is rebuilt');
  assert.equal(later.hit.now, 'present');
  assert.equal(page.idPass.calls.length, 0, 'a picture pick draws nothing new');
  mesh.geometry.setDrawRange(0, Infinity);
  const placed = await page.vantage.run('pick', {optics, at, pictured});
  closeTo(placed.hit.local, [0, 0.1, 0.5], 'the point is cast on the mesh where the picture drew it');
  assert.equal(placed.hit.pointBasis, 'recast');
  assert.equal(placed.hit.geometry.status, 'same');
  page.entries.splice(1, 1);
  const gone = await page.vantage.run('pick', {optics, at, pictured});
  assert.equal(gone.hit?.id, 'box-1', 'an object the picture drew is still named after it is gone');
  assert.equal(gone.hit.now, 'missing');
  assert.equal(gone.hit.point, null);
});

test('the point on a pictured mesh says how its geometry compares with the picture', async () => {
  const page = installedPage(), optics = pictureOptics(), at = pictureFraction(PICTURE_VIEW, 16 / 9, [2, 0.1, 0.5]);
  const status = async pictured => (await page.vantage.run('pick', {optics, at, pictured})).hit.geometry.status;
  const mesh = page.entries[1].object.children[0];
  let pictured = picturedRow(page);
  mesh.geometry.attributes.position.needsUpdate = true;
  assert.equal(await status(pictured), 'edited');
  pictured = picturedRow(page);
  mesh.geometry = new THREE.BoxGeometry(1, 1, 1);
  assert.equal(await status(pictured), 'replaced', 'another geometry object in the same page session, even with the same counts');
  // An interleaved position attribute keeps its edit count on the shared buffer. With 2,000
  // vertices the content sample reads every third one, so an edit to vertex 1 is seen by count alone.
  const interleaved = new THREE.InterleavedBuffer(new Float32Array(2000 * 6), 6);
  const position = new THREE.InterleavedBufferAttribute(interleaved, 3, 0);
  mesh.geometry = new THREE.BufferGeometry().setAttribute('position', position);
  pictured = picturedRow(page);
  position.setY(1, 0.25); interleaved.needsUpdate = true;
  assert.equal(await status(pictured), 'edited', 'an edit to an interleaved buffer is an edit');
});

test('a sampled fingerprint reads every component of the vertices it samples', () => {
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(1800), 3));
  const mesh = new THREE.Mesh(geometry), before = vantage.geometryIdentity(mesh, null);
  geometry.attributes.position.setY(3, 2.5);
  assert.notEqual(vantage.geometryIdentity(mesh, null).sample, before.sample, 'a Y edit changes the sample after a reload');
});

test('a pictured instance is cast where the picture drew it, and an instance edit is an edit', async () => {
  const page = installedPage(), optics = pictureOptics(), at = pictureFraction(PICTURE_VIEW, 16 / 9, [2, 0.1, 0.5]);
  const rocks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 96);
  for (let i = 0; i < 96; i++) rocks.setMatrixAt(i, new THREE.Matrix4().makeTranslation(50, 0, -i));
  rocks.setMatrixAt(1, new THREE.Matrix4().makeTranslation(2, 0, 0));
  const group = new THREE.Group(); group.add(rocks);
  page.entries.push({id: 'rocks', label: 'Rocks', type: 'glb', object: group});
  group.updateWorldMatrix(true, true);
  const instanceMatrix = new THREE.Matrix4(); rocks.getMatrixAt(1, instanceMatrix);
  const pictured = {n: 9, instance: 1, id: 'rocks', label: 'Rocks', type: 'glb', path: [0], mesh: null, matrixWorld: rocks.matrixWorld.toArray(),
    root: group.matrixWorld.toArray(), instanceMatrix: instanceMatrix.toArray(), geometry: vantage.geometryIdentity?.(rocks, page.vantage.pageId) ?? null};
  rocks.setMatrixAt(1, new THREE.Matrix4().makeTranslation(5, 0, 5)); rocks.instanceMatrix.needsUpdate = true;
  const picked = await page.vantage.run('pick', {optics, at, pictured});
  assert.equal(picked.hit?.id, 'rocks');
  assert.equal(picked.hit.surface.instance, 1);
  closeTo(picked.hit.point, [2, 0.1, 0.5], 'cast on instance 1 where the picture drew it');
  assert.equal(picked.hit.geometry.status, 'edited', 'the instance edit is noticed');
});

test('a pictured normal is the one the picture drew, and nothing in the scene is moved to cast it', async () => {
  const page = installedPage(), optics = pictureOptics(), at = pictureFraction(PICTURE_VIEW, 16 / 9, [2, 0.1, 0.5]);
  const pictured = picturedRow(page), box = page.entries[1];
  box.object.rotation.y = Math.PI / 4; box.object.updateWorldMatrix(true, true);   // today a ray meets a corner face
  box.object.children[0].matrixWorldAutoUpdate = false;
  const before = box.object.children[0].matrixWorld.toArray();
  const picked = await page.vantage.run('pick', {optics, at, pictured});
  closeTo(picked.hit.normal, [0, 0, 1], 'the normal of the surface the picture drew', 1e-9);
  assert.deepEqual(box.object.children[0].matrixWorld.toArray(), before, 'the live mesh keeps its own matrix');
});

test('a pick says when something drawn outside the pick map lies in front of what it names', async () => {
  const page = installedPage(), optics = pictureOptics(), at = pictureFraction(PICTURE_VIEW, 16 / 9, [2, 0.1, 0.5]);
  const pictured = {...picturedRow(page), depth: viewDepth(optics, [2, 0.1, 0.5])};
  const scene = {clouds: [{id: 'plume', label: 'Plume', type: 'splat', bounds: {min: [1, -1, 1], max: [3, 1, 2]}}],
    fields: [{id: 'flame-field', label: 'Fire & smoke', type: 'simulation-domain', bounds: {min: [1, -1, 0.8], max: [3, 1, 3]}},
      {id: 'far-field', label: 'Far field', type: 'simulation-domain', bounds: {min: [1, -5, -9], max: [3, 5, -8]}}],
    water: false};
  const picked = await page.vantage.run('pick', {optics, at, pictured, scene});
  assert.deepEqual(picked.unresolved.map(item => item.id), ['flame-field', 'plume'], 'nearest first; the field behind what the picture drew is not in front');
  assert.equal(picked.hit.authority, 'approximate');
  assert.deepEqual(picked.fields.map(field => field.id), ['flame-field', 'far-field'], 'every field the ray crosses is still listed');
  const undated = await page.vantage.run('pick', {optics, at, pictured: picturedRow(page), scene});
  assert.deepEqual(undated.unresolved.map(item => item.id), ['flame-field', 'plume', 'far-field'], 'without depth, every field the ray crosses may cover the point');
  const wet = await page.vantage.run('pick', {optics, at, pictured, scene: {clouds: [], fields: [], water: true}});
  assert.deepEqual(wet.unresolved.map(item => item.id), ['local-water'], 'water drawn by the local water host is outside the map');
  assert.equal(wet.hit.authority, 'approximate');
  const live = installedPage({water: true});
  const now = await live.vantage.run('pick', {from: 'operator', at: pictureFraction(OPERATOR, 1600 / 900, [2, 0.1, 0.5])});
  assert.deepEqual(now.unresolved.map(item => item.id), ['local-water'], 'a live pick checks the same, as the scene is now');
});

test('the recast point stays inside the picture camera\'s clipping planes', async () => {
  const camera = new PerspectiveCamera(50, 1, 1, 20);
  camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
  const optics = {projection: camera.projectionMatrix.toArray(), viewInverse: camera.matrixWorldInverse.toArray(), near: 1, coordinateSystem: camera.coordinateSystem};
  const page = installedPage(), box = page.entries[0];
  box.object.children[0].material.side = THREE.DoubleSide;   // seen from inside once the near plane cuts it
  box.object.position.set(0, 0, 9.4); box.object.updateWorldMatrix(true, true);   // its front face is before the near plane, its back face after
  const pictured = picturedRow(page, 0);
  const picked = await page.vantage.run('pick', {optics, at: [0.5, 0.5], pictured});
  assert.equal(picked.from, 'picture');
  closeTo(picked.hit.point, [0, 0, 8.9], 'the first surface inside the picture\'s depth range');
});

test('reversed WebGL depth clips the recast point at its own far plane', async () => {
  const camera = new PerspectiveCamera(50, 1, 1, 20);
  camera._reversedDepth = true;   // the renderer sets this; the getter is read-only
  camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
  const optics = {projection: camera.projectionMatrix.toArray(), viewInverse: camera.matrixWorldInverse.toArray(), near: 1,
    coordinateSystem: camera.coordinateSystem, reversedDepth: true};
  const page = installedPage(), box = page.entries[0];
  box.object.position.set(0, 0, -15); box.object.updateWorldMatrix(true, true);
  const picked = await page.vantage.run('pick', {optics, at: [0.5, 0.5], pictured: picturedRow(page, 0)});
  assert.equal(picked.hit.point, null, 'beyond the far plane is not in the picture');
});

test('a pick map hides editor drawing and the named objects for its draw, and puts back exactly what it hid', () => {
  const scene = new THREE.Scene(), [helper, editorOnly, alreadyHidden, kiln, sub, gizmo, box, emitter] = Array.from({length: 8}, () => new THREE.Object3D());
  helper.userData.kaminosEditorHelper = true; editorOnly.userData.kaminosEditorOnly = true;
  alreadyHidden.userData.kaminosEditorHelper = true; alreadyHidden.visible = false;
  scene.add(helper, editorOnly, alreadyHidden, kiln, sub, gizmo, box, emitter);
  const sceneObjects = [{id: 'kiln', type: 'glb', object: kiln}, {id: 'vantage-bebop', type: 'camera', object: sub}, {id: 'flame', type: 'flame-emitter', object: emitter}];
  const hide = fromIndex('hideEditorObjectsForIdPass', {scene, sceneObjects, FLAME_EMITTER_TYPE: 'flame-emitter', LOCAL_LIQUID_EMITTER_TYPE: 'local-liquid-emitter',
    RIM_LIGHT_ID: 'rim-light', transformControls: {getHelper: () => gizmo}, selectionBoxes: new Map([['kiln', box]])});
  const restore = hide({hide: ['vantage-bebop']});
  assert.deepEqual([helper, editorOnly, sub, gizmo, box, emitter].map(object => object.visible), Array(6).fill(false), 'editor drawing, the gizmo, selection boxes, emitters and the named sub');
  assert.equal(kiln.visible, true, 'scene objects are drawn');
  restore();
  assert.deepEqual([helper, editorOnly, sub, gizmo, box, emitter, kiln].map(object => object.visible), Array(7).fill(true));
  assert.equal(alreadyHidden.visible, false, 'what was hidden before stays hidden');
});

test('a live pick draws its map at the size the viewport is drawn at, so its pixel is one the operator sees', async () => {
  const page = installedPage(), at = pictureFraction(OPERATOR, 1600 / 900, [2, 0.1, 0.5]);
  await page.vantage.run('pick', {from: 'operator', at});
  const call = page.idPass.calls.at(-1);
  assert.deepEqual([call.width, call.height], [1600, 1200], 'device pixels, not the 800x600 of the page layout');
  assert.deepEqual(call.region, [Math.floor(at[0] * 1600), Math.floor(at[1] * 1200), 1, 1]);
});

test('a drawing that is not a mesh is named, without a point', async () => {
  const page = installedPage({drawnAt: () => ({object: page.entries[1].object.children[1]})});
  page.entries[1].object.add(new THREE.Sprite(new THREE.SpriteMaterial()));
  const picked = await page.vantage.run('pick', {from: 'operator', at: [0.5, 0.5]});
  assert.equal(picked.hit?.id, 'box-1');
  assert.equal(picked.hit.now, 'present', 'the sprite is there; it is just not a mesh');
  assert.equal(picked.hit.point, null);
  assert.equal(picked.hit.pointBasis, 'not-a-mesh');
});

test('an instance number the pick map cannot hold is not guessed', async () => {
  // Past 65,536 instances the map's 16-bit instance number wraps, so instance 5 could be 5 + k x 65,536.
  const grass = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 70000);
  const page = installedPage({drawnAt: () => ({object: grass, instanceId: 5})});
  const group = new THREE.Group(); group.add(grass);
  page.entries.push({id: 'grass', label: 'Grass', type: 'glb', object: group});
  const picked = await page.vantage.run('pick', {from: 'operator', at: [0.5, 0.5]});
  assert.equal(picked.hit?.id, 'grass', 'the object is still the one the map names');
  assert.equal(picked.hit.surface.instance, null, 'the wrapped instance number is not reported');
  assert.equal(picked.hit.pointBasis, 'instance-unknown', 'and no instance is guessed for the point');
});

// --- depth ------------------------------------------------------------------------


test('an old picture\'s occlusion warnings come from its own depth, so editing the mesh cannot clear them', async () => {
  const camera = new PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
  const optics = {projection: camera.projectionMatrix.toArray(), viewInverse: camera.matrixWorldInverse.toArray(), near: 0.1, far: 100};
  const page = installedPage(), mesh = page.entries[0].object.children[0];
  const scene = {clouds: [{id: 'mist', label: 'Mist', type: 'splat', bounds: {min: [-1, -1, 3], max: [1, 1, 4]}}], fields: [], water: false};
  const withDepth = {...picturedRow(page, 0), depth: 9.5}, withoutDepth = picturedRow(page, 0);
  const before = await page.vantage.run('pick', {optics, at: [0.5, 0.5], pictured: withDepth, scene});
  assert.deepEqual(before.unresolved.map(item => item.id), ['mist']);
  // The reviewer's case: today's surface moves toward the camera, past the recorded cloud.
  mesh.geometry.translate(0, 0, 7); mesh.geometry.attributes.position.needsUpdate = true;
  const after = await page.vantage.run('pick', {optics, at: [0.5, 0.5], pictured: withDepth, scene});
  assert.deepEqual(after.unresolved.map(item => item.id), ['mist'], 'the cloud stood in front of what the picture drew');
  assert.equal(after.hit.authority, 'approximate');
  closeTo(after.hit.point, [0, 0, 0.5], 'the point the picture drew, from its depth');
  assert.equal(after.hit.pointBasis, 'depth');
  assert.equal(after.hit.surfaceBasis, 'recast-differs', 'today\'s mesh no longer passes through that point');
  assert.equal(after.hit.normal, null);
  const without = await page.vantage.run('pick', {optics, at: [0.5, 0.5], pictured: withoutDepth, scene});
  assert.deepEqual(without.unresolved.map(item => item.id), ['mist'], 'without depth, every crossing stays a warning');
  assert.equal(without.hit.authority, 'approximate');
});

test('a picture pick gives the point the picture drew, even after the object moved or was removed', async () => {
  const page = installedPage(), optics = pictureOptics(), at = pictureFraction(PICTURE_VIEW, 16 / 9, [2, 0.1, 0.5]);
  const pictured = {...picturedRow(page), depth: viewDepth(optics, [2, 0.1, 0.5])}, box = page.entries[1];
  box.object.position.x += 3;
  const moved = await page.vantage.run('pick', {optics, at, pictured});
  closeTo(moved.hit.point, [2, 0.1, 0.5], 'where the picture drew it');
  closeTo(moved.hit.local, [0, 0.1, 0.5], 'in the object\'s own frame as it stood');
  assert.equal(moved.hit.pointBasis, 'depth');
  assert.equal(moved.hit.surfaceBasis, 'recast-agrees', 'the mesh placed where it was drawn still passes through that point');
  closeTo(moved.hit.normal, [0, 0, 1], 'so its face and normal are reported');
  page.entries.splice(1, 1);
  const gone = await page.vantage.run('pick', {optics, at, pictured});
  assert.equal(gone.hit.now, 'missing');
  closeTo(gone.hit.point, [2, 0.1, 0.5], 'a removed object keeps the point the picture drew');
});

test('a live pick takes its point from the depth the renderer drew', async () => {
  // A vertex shader drew box 2 where a ray meets nothing: the depth places the point.
  const page = installedPage({drawnAt: () => ({object: page.entries[2].object.children[0], depth: 5.25})});
  const picked = await page.vantage.run('pick', {from: 'operator', at: [0.5, 0.5]});
  assert.equal(picked.hit?.id, 'box-2');
  assert.equal(picked.hit.pointBasis, 'depth');
  assert.equal(picked.hit.surfaceBasis, 'recast-differs');
  closeTo([viewDepth(opticsOf(OPERATOR), picked.hit.point)], [5.25], 'at the depth the renderer drew');
  assert.equal(page.idPass.calls.at(-1).depth, true, 'a live pick reads its pixel\'s depth');
});

test('pictures keep depth with their pick map; a burst keeps it only when asked', async () => {
  const {state, pilot} = await launched();
  const shot = await pilot.run('snap', {map: false});
  assert.equal(state.idPasses.at(-1).depth, true);
  assert.equal(shot.pickMap.depth?.encoding, 'float32le-base64');
  const burst = await pilot.run('burst', {count: 2, map: false});
  assert.equal(state.idPasses.at(-1).depth, false, 'a burst is for motion, so its frames keep no depth unless asked');
  for (const frame of burst.frames) assert.equal(frame.pickMap.depth, undefined);
  const deep = await pilot.run('burst', {count: 2, map: false, depth: true});
  for (const frame of deep.frames) assert.equal(frame.pickMap.depth?.encoding, 'float32le-base64');
});

test('the ID pass draws a material with the ID outputs in place of its own, and with the picture camera\'s far plane', async () => {
  // The page imports TSL through its import map, which points at the same r185 build; under Node the TSL module's
  // bare 'three/webgpu' import would reach another three, so the test takes TSL from the build itself.
  const W = await import('../lib/three.webgpu.js'), TSL = W.TSL;
  const {createIdPass} = await import('../agent-vantage-ids.mjs');
  const ownOutputs = TSL.mrt({output: TSL.vec4(2 / 255, 0, 0, 0)});
  const material = new W.MeshStandardNodeMaterial(); material.mrtNode = ownOutputs;
  const mesh = new W.Mesh(new W.BoxGeometry(), material), scene = new W.Scene(); scene.add(mesh);
  let objectFunction = null, drawnWith = 'not drawn', camera = null;
  const renderer = {coordinateSystem: W.WebGPUCoordinateSystem, reversedDepthBuffer: false, autoClear: false,
    getRenderTarget: () => null, setRenderTarget() {}, getMRT: () => null, setMRT() {}, getClearColor: color => color, getClearAlpha: () => 1, setClearColor() {},
    getRenderObjectFunction: () => objectFunction, setRenderObjectFunction(fn) { objectFunction = fn; },
    renderObject(object, drawScene, drawCamera, geometry, drawnMaterial) { drawnWith = drawnMaterial.mrtNode; },
    render(drawScene, drawCamera) { camera = drawCamera; objectFunction(mesh, drawScene, drawCamera, mesh.geometry, mesh.material, null, null, null, null); },
    async readRenderTargetPixelsAsync(target, x, y, w, h, index = 0) {
      const rows = Math.ceil(w * 4 / 256) * 256 * (h - 1);
      return index ? new Float32Array(rows / 4 + w) : new Uint8Array(rows + w * 4);
    }};
  const source = new W.PerspectiveCamera(50, 1, 0.1, 1000);
  source.coordinateSystem = W.WebGPUCoordinateSystem; source.position.set(0, 0, 5); source.updateMatrixWorld(true); source.updateProjectionMatrix();
  const optics = {projection: source.projectionMatrix.toArray(), viewInverse: source.matrixWorldInverse.toArray(), near: 0.1, far: 1000, coordinateSystem: W.WebGPUCoordinateSystem};
  const drawing = createIdPass({THREE: W, TSL, renderer, scene}).draw({optics, width: 4, height: 4, depth: true});
  assert.ok(drawnWith && drawnWith !== ownOutputs && drawnWith.outputNodes.distance, 'its own outputs would replace the object number, so the ID draw gives it the ID outputs, which still run its own');
  assert.equal(material.mrtNode, ownOutputs, 'and gives them back');
  assert.equal(drawing.drawn[0].custom, undefined, 'its coverage is still its own shader\'s');
  assert.equal(camera.far, 1000, 'shaders that read the camera see the picture camera\'s far plane');
  const ids = await drawing.ready;
  assert.equal(ids.depths?.length, 16, 'and the depth is read back with the numbers');
});

// --- follow-ups: material discards and surface agreement --------------------------------

// Compiles the fragment shader the ID pass would draw each object with, through the real
// r185 node builder, by standing in for the GPU parts of a WebGPURenderer.
async function idPassShaders(material) {
  const W = await import('../lib/three.webgpu.js'), TSL = W.TSL;
  const {createIdPass} = await import('../agent-vantage-ids.mjs');
  const mesh = new W.Mesh(new W.BoxGeometry(), material), scene = new W.Scene(); scene.add(mesh);
  const renderer = new W.WebGPURenderer({canvas: {style: {}, width: 4, height: 4, addEventListener() {}, removeEventListener() {}, getContext: () => null}});
  const shaders = [];
  let objectFunction = null;
  Object.assign(renderer, {
    getRenderObjectFunction: () => objectFunction, setRenderObjectFunction(fn) { objectFunction = fn; },
    renderObject(object, drawScene, drawCamera, geometry, drawnMaterial) {
      const builder = new W.WGSLNodeBuilder(object, renderer);
      Object.assign(builder, {scene: drawScene, camera: drawCamera, material: drawnMaterial});
      builder.build();
      shaders.push(builder.fragmentShader);
    },
    render(drawScene, drawCamera) { objectFunction(mesh, drawScene, drawCamera, mesh.geometry, mesh.material, null, null, null, null); },
    async readRenderTargetPixelsAsync(target, x, y, w, h, index = 0) {
      const rows = Math.ceil(w * 4 / 256) * 256 * (h - 1);
      return index ? new Float32Array(rows / 4 + w) : new Uint8Array(rows + w * 4);
    }});
  const source = new W.PerspectiveCamera(50, 1, 0.1, 100);
  source.position.set(0, 0, 5); source.updateMatrixWorld(true); source.updateProjectionMatrix();
  const optics = {projection: source.projectionMatrix.toArray(), viewInverse: source.matrixWorldInverse.toArray(), near: 0.1, far: 100, coordinateSystem: renderer.coordinateSystem};
  await createIdPass({THREE: W, TSL, renderer, scene}).draw({optics, width: 4, height: 4}).ready;
  return {shaders, TSL};
}

test('a material whose own outputs discard still discards in the pick map, which still writes the object number', async () => {
  const W = await import('../lib/three.webgpu.js'), TSL = W.TSL;
  const plain = (await idPassShaders(new W.MeshBasicNodeMaterial())).shaders[0];
  const material = new W.MeshBasicNodeMaterial();
  material.mrtNode = TSL.mrt({output: TSL.Fn(() => { TSL.Discard(); return TSL.vec4(1, 0, 0, 1); })()});
  const [shader] = (await idPassShaders(material)).shaders;
  const discards = text => text.split('discard;').length - 1;
  assert.equal(discards(shader), discards(plain) + 1, 'the material\'s own discard is kept');
  assert.ok(!shader.includes('vec4<f32>( 1.0, 0.0, 0.0, 1.0 );\n\treturn'), 'its own colour does not become the object number');
  assert.ok(material.mrtNode.outputNodes.output, 'and the material keeps its own outputs');
});

test('the mesh agrees with the drawn point only to float precision, even far from the camera', () => {
  const camera = new PerspectiveCamera(30, 1, 0.1, 2000);
  camera.position.set(0, 0, 1000); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
  const optics = {projection: camera.projectionMatrix.toArray(), viewInverse: camera.matrixWorldInverse.toArray(), near: 0.1, far: 2000};
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial()), root = new THREE.Group(); root.add(plane);
  root.updateWorldMatrix(true, true);
  const entries = [{id: 'sheet', object: root}], ray = rayThrough(optics, [0.5, 0.5]);
  const row = {id: 'sheet', path: [0], matrixWorld: plane.matrixWorld.toArray(), root: root.matrixWorld.toArray()};
  const same = vantage.surfaceOf(THREE, entries, {row, ray, optics, depthPoint: [0, 0, 0]});
  assert.equal(same.surfaceBasis, 'recast-agrees');
  plane.geometry.translate(0, 0, 0.05);
  const apart = vantage.surfaceOf(THREE, entries, {row, ray, optics, depthPoint: [0, 0, 0]});
  assert.equal(apart.surfaceBasis, 'recast-differs', 'five centimetres at a kilometre is not float error');
  assert.equal(apart.normal, null);
  closeTo(apart.point, [0, 0, 0], 'the drawn point stays');
  // At room scale a float32 depth error of a few micrometres still agrees, as the live witness measured.
  const near = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial()), nearRoot = new THREE.Group(); nearRoot.add(near);
  nearRoot.position.z = 7.4326; nearRoot.updateWorldMatrix(true, true);
  const nearRow = {id: 'card', path: [0], matrixWorld: near.matrixWorld.toArray(), root: nearRoot.matrixWorld.toArray()};
  const close = new PerspectiveCamera(30, 1, 0.1, 100); close.position.set(0, 0, 10); close.lookAt(0, 0, 0); close.updateMatrixWorld(true); close.updateProjectionMatrix();
  const closeOptics = {projection: close.projectionMatrix.toArray(), viewInverse: close.matrixWorldInverse.toArray()};
  const measured = vantage.surfaceOf(THREE, [{id: 'card', object: nearRoot}], {row: nearRow, ray: rayThrough(closeOptics, [0.5, 0.5]), optics: closeOptics, depthPoint: [0, 0, 7.4326 + 1.2e-6]});
  assert.equal(measured.surfaceBasis, 'recast-agrees');
  const millimetre = vantage.surfaceOf(THREE, [{id: 'card', object: nearRoot}], {row: nearRow, ray: rayThrough(closeOptics, [0.5, 0.5]), optics: closeOptics, depthPoint: [0, 0, 7.4336]});
  assert.equal(millimetre.surfaceBasis, 'recast-differs', 'a millimetre at room scale is not float error either');
});
