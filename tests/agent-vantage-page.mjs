// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createVantagePilot, createCommandPump} from '../agent-vantage.mjs';
import {poseAxes, poseLookingAt} from '../agent-vantage-core.mjs';
import {createSceneCameras} from '../scene-camera.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
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
