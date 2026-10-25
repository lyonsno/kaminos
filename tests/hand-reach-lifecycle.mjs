// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createHandReachExperiment} from '../experiments/hand-reach.experiment.mjs';
import {createWorkbenchSceneHost, disposeOwnedSceneTree} from '../workbench-scene-host.mjs';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const deferred = () => {let resolve, reject; const promise = new Promise((a, b) => {resolve = a; reject = b;}); return {promise, resolve, reject};};
const settle = () => new Promise(resolve => setImmediate(resolve));
const prediction = (overrides = {}) => ({hasHand: true, handedness: 'right', width: 640, height: 480,
  nativeVertices: new Float32Array(9), nativeUV: new Float32Array(42),
  verticesMeters: new Float32Array([0, 0, 0, .02, 0, 0, 0, .02, 0]), cropBox: [10, 20, 200, 210],
  source: {id: 'retained-fixture', label: 'Synthetic retained fixture'}, ...overrides});

// These doubles exercise caller lifetime, not the parent's numerical registration/contact contract.
function reachState() {
  let state = {tracking: false, contact: false, pinching: false, grabbed: false,
    indexTip: null, thumbTip: null, pinchPoint: null, pinchDistance: null,
    target: {position: [-.04, .28, -.1], radius: .018}, cubePosition: [.05, .23, 0], cubeSize: .045};
  const read = () => structuredClone(state);
  const lose = () => {Object.assign(state, {tracking: false, contact: false, pinching: false, grabbed: false}); return read();};
  return {read, lose, reset: lose,
    update({joints, valid}) {if (!valid) return lose(); Object.assign(state, {tracking: true, contact: true,
      pinching: true, grabbed: true, indexTip: Array.from(joints.slice(24, 27)), thumbTip: Array.from(joints.slice(12, 15)), pinchPoint: [.01, .2, 0]}); return read();},
    setTarget(value) {state.target = structuredClone(value); return read();},
    setCube({position, size}) {state.cubePosition = [...position]; state.cubeSize = size; return read();},
  };
}

async function fixture({infer, acquire, play, createApp, loadRegistration, createState = reachState, inputs = {}, createRetention, captureInput} = {}) {
  let time = 0, frame, nextCallback = 0, appOptions;
  const callbacks = new Map(), tracks = [], rows = new Map(), events = [], placements = [], captures = [], drags = [], recipes = [];
  const video = Object.assign(new EventTarget(), {videoWidth: 640, videoHeight: 480, currentTime: 0, readyState: 4,
    muted: true, style: {}, play: play ?? (async () => {}), pause() {},
    requestVideoFrameCallback(fn) {const id = ++nextCallback; callbacks.set(id, fn); return id;},
    cancelVideoFrameCallback(id) {callbacks.delete(id);}});
  const device = {destroy() {throw Error('borrowed device destroyed');}};
  const scene = new THREE.Scene(), borrowed = new THREE.Group(), camera = new THREE.PerspectiveCamera(40, 1, .01, 100);
  scene.add(borrowed);
  const hostScene = createWorkbenchSceneHost({scene, camera, controls: {target: new THREE.Vector3(), update() {}},
    loadAsset() {throw Error('no external scene asset');},
    registerObject(root, metadata) {const row = {id: root.uuid, root, ...metadata}; rows.set(root, row); return row;},
    findObject: root => rows.get(root),
    removeObject({root}) {scene.remove(root); rows.delete(root); disposeOwnedSceneTree(root, [scene]);},
    redraw() {}, onFrame(fn) {frame = fn; return () => {frame = null;};}});
  let loads = 0, destroyed = 0, appCreates = 0, registrationLoads = 0;
  const app = {faces: new Uint16Array([0, 1, 2]), identity: {routeId: 'test-hand-route'},
    snapshot: () => ({ownership: {device: 'borrowed', session: 'owned'}}),
    async load() {loads++;}, stop() {}, async destroy() {destroyed++;},
    async infer(options) {if (infer) return infer(options); const captured = await options.getFrame(); captures.push(captured); return prediction({input: {width: captured.width, height: captured.height, frameId: captured.frameId}});}};
  const registration = {identity: {id: 'registration-fixture'}, place(result, options) {
    placements.push({result, options});
    return {valid: true, translation: [0, 0, .6], cameraVertices: new Float32Array(result.verticesMeters),
      worldVertices: new Float32Array([-.03, .2, -.1, 0, .2, -.1, 0, .24, -.1]), worldJoints: new Float32Array(63),
      rmsePx: 2, camera: {kind: 'assumed'}, source: {regressor: 'fixture-regressor'}};
  }};
  const acquireDefault = async () => {
    const track = Object.assign(new EventTarget(), {id: `track-${tracks.length}`, readyState: 'live', muted: false, stops: 0,
      stop() {this.stops++; this.readyState = 'ended';}, getSettings: () => ({frameRate: 30, width: 640, height: 480})});
    tracks.push(track);
    return {id: `stream-${tracks.length}`, getTracks: () => [track], getVideoTracks: () => [track]};
  };
  const instance = await createHandReachExperiment({host: {scene: {open: async () => hostScene.open()},
    controls: {document: {createElement: () => video}, installNumberDrag(options) {
      const drag = {...options, disposed: false, dispose() {this.disposed = true;}}; drags.push(drag); return drag;
    }}}, inputs: {retainTrial:false,...inputs}, record: row => events.push(row), updateInputs: recipe => recipes.push(recipe)}, {
    now: () => time, createState, getGpu: async () => ({device}),
    getUserMedia: acquire ?? acquireDefault,
    createApp: async options => {appOptions = options; appCreates++; return createApp ? createApp(options, app) : app;},
    loadRegistration: async (...args) => {registrationLoads++; return loadRegistration ? loadRegistration(...args) : {};},
    createRegistration: () => registration,
    createRetention, captureInput,
  });
  return {instance, video, tracks, scene, borrowed, rows, placements, captures, events, callbacks, app, registration, acquireDefault, drags, recipes,
    get appOptions() {return appOptions;}, counts: () => ({loads, destroyed, appCreates, registrationLoads}),
    async videoFrame(mediaTime = video.currentTime + .033) {
      video.currentTime = mediaTime;
      const pending = [...callbacks]; callbacks.clear();
      for (const [, callback] of pending) callback(time, {mediaTime, presentedFrames: Math.round(mediaTime * 30)});
      frame?.({timestampMs: time, deltaSeconds: .033}); await settle();
    },
    tick(ms) {time += ms; frame?.({timestampMs: time, deltaSeconds: ms / 1000});},
    elapseWithoutHostFrame(ms) {time += ms;},
  };
}

test('recorded trial retains exact inference input, raw result and effective placement before closure', async () => {
  const frames=[], finishes=[], frozen={width:640,height:480}, image=new Blob(['png'],{type:'image/png'});
  let closed=false;
  const f=await fixture({inputs:{retainTrial:true},
    createRetention:async()=>({id:'test-trial',append:async row=>frames.push(row),finish:async summary=>finishes.push(summary),close(){closed=true;}}),
    captureInput:()=>({source:frozen,image:Promise.resolve(image)}),
  });
  await f.instance.operations.start();await f.videoFrame();await f.instance.operations.stop();
  assert.equal(frames.length,1);
  assert.equal(f.captures[0].source,frozen,'model consumes exactly the frozen retained input');
  assert.equal(frames[0].image,image);
  assert.equal(frames[0].prediction.nativeVertices.length,9);
  assert.equal(frames[0].effective.presentation,'live-hand');
  assert.equal(frames[0].inputSource.source.mirrored,false);
  assert.equal(finishes.length,1);
  assert.equal(closed,true);
  await f.instance.dispose();
});

test('trial write failure ends camera visibly and retains the failure status',async()=>{
  const f=await fixture({inputs:{retainTrial:true},
    createRetention:async()=>({id:'failed-trial',append:async()=>{throw Error('storage full');},finish:async()=>{},close(){}}),
    captureInput:()=>({source:{},image:Promise.resolve(new Blob(['png']))}),
  });
  await f.instance.operations.start();await f.videoFrame();
  assert.equal(f.instance.read().running,false);assert.equal(f.instance.read().visible,false);
  assert.equal(f.instance.read().retention.status,'failed');assert.match(f.instance.read().retention.error,/storage full/);
  assert.equal(f.tracks[0].stops,1);await f.instance.dispose();
});

test('stop waits for the captured trial frame and records the superseded result',async()=>{
  const gate=deferred(),frames=[];
  const f=await fixture({inputs:{retainTrial:true},infer:async options=>{await options.getFrame();await gate.promise;return prediction();},
    createRetention:async()=>({id:'stopped-trial',append:async row=>frames.push(row),finish:async()=>{},close(){}}),
    captureInput:()=>({source:{},image:Promise.resolve(new Blob(['png']))}),
  });
  await f.instance.operations.start();await f.videoFrame();const stopping=f.instance.operations.stop();
  gate.resolve();await stopping;
  assert.equal(frames.length,1);assert.match(frames[0].failure,/superseded/);
  assert.equal(f.instance.read().visible,false);await f.instance.dispose();
});

for(const variant of ['storage-abort','config-changed'])test(`active trial stops after ${variant}`,async()=>{
  const pending=deferred(),frames=[];
  const f=await fixture({inputs:{retainTrial:true},
    createRetention:async()=>({id:variant,append:async row=>{frames.push(row);if(frames.length===2)await pending.promise;},finish:async()=>{},close(){}}),
    captureInput:()=>({source:{},image:Promise.resolve(new Blob(['png']))}),
  });
  await f.instance.operations.start();await f.videoFrame();await f.videoFrame();
  if(variant==='config-changed')f.instance.operations.setThreshold(.9);
  pending.reject(new DOMException('Storage failure',variant==='storage-abort'?'AbortError':'QuotaExceededError'));
  await settle();
  assert.equal(f.instance.read().running,false);assert.equal(f.instance.read().visible,false);
  assert.match(f.instance.read().error,/Storage failure/);assert.equal(f.tracks[0].stops,1);
  assert.equal(frames[0].prediction.hasHand,true,'previous recorded row remains available');
  await f.instance.dispose();
});

for(const mutation of ['stop','focal'])test(`PNG delay preserves presented state across ${mutation}`,async()=>{
  const pending=deferred(),frames=[];
  const f=await fixture({inputs:{retainTrial:true},
    createRetention:async()=>({id:mutation,append:async row=>frames.push(row),finish:async()=>{},close(){}}),
    captureInput:()=>({source:{},image:pending.promise}),
  });
  await f.instance.operations.start();await f.videoFrame();const presented=f.instance.read();
  const stopping=mutation==='stop'?f.instance.operations.stop():null;
  if(mutation==='focal')f.instance.operations.setFocalRatio(2);
  pending.resolve(new Blob(['png']));await settle();await stopping;
  assert.equal(frames[0].effective.presentation,presented.presentation);
  assert.equal(frames[0].effective.focalRatio,presented.focalRatio);
  assert.deepEqual(frames[0].effective.state,presented.state);
  assert.equal(frames[0].failure,null);await f.instance.dispose();
});

test('an old trial storage failure cannot stop a restarted camera',async()=>{
  const pending=deferred();let count=0;
  const f=await fixture({inputs:{retainTrial:true},
    createRetention:async()=>{const first=count++===0;return{id:`trial-${count}`,append:async()=>{if(first)await pending.promise;},finish:async()=>{},close(){}};},
    captureInput:()=>({source:{},image:Promise.resolve(new Blob(['png']))}),
  });
  await f.instance.operations.start();await f.videoFrame();
  const stopping=f.instance.operations.stop(),restarting=f.instance.operations.start();
  pending.reject(new DOMException('Old store failed','AbortError'));
  await stopping;await restarting;
  assert.equal(f.instance.read().running,true);assert.equal(f.instance.read().retention.id,'trial-2');
  assert.equal(f.tracks[1].stops,0);await f.instance.dispose();
});

test('scene mounts without loading models; owns registered geometry and uses operator view', async () => {
  const f = await fixture();
  assert.ok(f.rows.size > 0, 'scene mounts before any model loading');
  assert.deepEqual(f.counts(), {loads: 0, destroyed: 0, appCreates: 0, registrationLoads: 0});
  const state = f.instance.read();
  assert.deepEqual(state.view.position, [0, .25, .75]);
  assert.deepEqual(state.view.target, [0, .25, 0]);
  assert.equal(state.visible, false);
  await f.instance.operations.load();
  assert.ok(f.appOptions.device, 'the model app borrows the host device');
  await f.instance.dispose();
});

test('repeated predictions reuse uploaded buffers and closure retires all of them', async () => {
  // Use the bundled renderer's actual lifetime logic, with a counting GPU backend.
  const source = readFileSync(new URL('../lib/three.webgpu.js', import.meta.url), 'utf8');
  const start = source.indexOf('class DataMap {'), end = source.indexOf('\nclass ', source.indexOf('class Info {') + 1);
  assert.ok(start > 0 && end > start);
  const {Attributes, Geometries, Info} = runInNewContext(`${source.slice(start,end)}\n({Attributes,Geometries,Info})`, {...THREE});
  const live = new Set(), info = new Info();
  const backend = {createAttribute: a => live.add(a), createIndexAttribute: a => live.add(a),
    updateAttribute: a => assert.ok(live.has(a)), destroyAttribute: a => live.delete(a)};
  const geometries = new Geometries(new Attributes(backend, info), info);
  const f = await fixture();
  const render = hand => {
    info.render.calls++;
    const geometry = hand.geometry;
    geometries.updateForRender({geometry, material: hand.material, getAttributes: () => Object.values(geometry.attributes)});
  };
  for (let i=0;i<10;i++) {
    await f.instance.operations.presentRetained(prediction({faces:[0,1,2], handedness:i%2?'left':'right'}));
    const hand = f.scene.getObjectByProperty('uuid', f.instance.read().objects.hand.uuid);
    render(hand);
    assert.deepEqual(Array.from(hand.geometry.index.array), i%2?[0,2,1]:[0,1,2]);
    assert.equal(live.size,3,'position, normal and index allocations stay stable');
  }
  const oldPlace=f.registration.place;
  f.registration.place=(...args)=>({...oldPlace(...args),worldVertices:new Float32Array(12)});
  await f.instance.operations.presentRetained(prediction({faces:[0,1,2,0,2,3]}));
  render(f.scene.getObjectByProperty('uuid',f.instance.read().objects.hand.uuid));
  assert.equal(live.size,3,'changed topology retires old geometry before uploading its replacement');
  await f.instance.dispose();
  assert.equal(live.size,0,'closure retires every uploaded hand buffer');
  assert.equal(info.memoryMap.size,0);
});

test('load borrows only the device, while live placement keeps actual 3D coordinates and clears on miss', async () => {
  const f = await fixture();
  await f.instance.operations.start();
  assert.ok(f.appOptions.device);
  assert.equal(f.appOptions.session, undefined);
  assert.equal(f.appOptions.foreground, undefined);
  await f.videoFrame();
  let state = f.instance.read();
  assert.equal(state.inputSource.kind, 'live-camera');
  assert.equal(state.visible, true);
  assert.equal(state.state.grabbed, true);
  assert.equal(state.placement.source.regressor, 'fixture-regressor');
  const hand = f.scene.getObjectByProperty('uuid', state.objects.hand.uuid);
  assert.ok(hand.material.isMeshStandardMaterial);
  assert.deepEqual(hand.position.toArray(), [0, 0, 0]);
  assert.deepEqual(hand.scale.toArray(), [1, 1, 1]);
  assert.deepEqual(Array.from(hand.geometry.attributes.position.array), Array.from(f.registration.place(prediction()).worldVertices));
  f.app.infer = async options => {await options.getFrame(); return {hasHand: false};};
  await f.videoFrame();
  state = f.instance.read();
  assert.equal(state.visible, false);
  assert.equal(state.state.contact, false);
  assert.equal(state.state.pinching, false);
  assert.equal(state.state.grabbed, false);
  await f.instance.dispose();
  assert.deepEqual(f.scene.children, [f.borrowed]);
  assert.equal(f.tracks[0].stops, 1);
  assert.equal(f.counts().destroyed, 1);
});

test('getFrame captures newest frame after admission, without manual fallback', async () => {
  const gate = deferred(); let options, capture;
  const f = await fixture({infer: async value => {options = value; await gate.promise; capture = await value.getFrame(); return prediction();}});
  await f.instance.operations.start(); await f.videoFrame(1);
  await f.videoFrame(2);
  gate.resolve(); await settle();
  assert.equal(capture.frameId, 2);
  assert.equal(capture.source, f.video);
  assert.deepEqual(options.acquisition, {mode: 'detector', threshold: .8, padding: 1.4, onMiss: 'skip'});
  assert.equal(f.instance.read().inputSource.frameId, 2);
  await f.instance.dispose();
});

test('stop releases tracks immediately; restart waits for old inference and rejects its late presentation', async () => {
  const gate = deferred();
  const f = await fixture({infer: async options => {await options.getFrame(); await gate.promise; return prediction();}});
  await f.instance.operations.start(); await f.videoFrame();
  const stopping = f.instance.operations.stop();
  assert.equal(f.tracks[0].stops, 1);
  assert.equal(f.instance.read().visible, false);
  const restarting = f.instance.operations.start(); await settle();
  assert.equal(f.tracks.length, 1);
  gate.resolve(); await stopping; await restarting;
  assert.equal(f.tracks.length, 2);
  assert.equal(f.instance.read().visible, false);
  assert.equal(f.instance.read().running, true);
  await f.instance.dispose();
});

test('cancel during permission and play closes late camera tracks without reviving the stream', async () => {
  const permission = deferred();
  const f = await fixture({acquire: () => permission.promise});
  const starting = f.instance.operations.start(); await settle();
  await f.instance.operations.stop();
  permission.resolve(await f.acquireDefault()); await starting;
  assert.equal(f.tracks[0].stops, 1);
  assert.equal(f.instance.read().running, false);
  const play = deferred(); const g = await fixture({play: () => play.promise});
  const playing = g.instance.operations.start(); await settle();
  await g.instance.operations.stop(); play.resolve(); await playing;
  assert.equal(g.instance.read().running, false);
  assert.equal(g.callbacks.size, 0);
  await f.instance.dispose(); await g.instance.dispose();
});

test('camera stall and muted track clear interaction, including an in-flight result', async () => {
  const f = await fixture(); await f.instance.operations.start(); await f.videoFrame();
  f.tick(f.instance.read().freshness.sourceBudgetMs + 1);
  assert.equal(f.instance.read().visible, false);
  assert.equal(f.instance.read().state.grabbed, false);
  assert.equal(f.instance.read().presentation, 'camera-stalled');
  await f.videoFrame(); assert.equal(f.instance.read().visible, true);
  const gate = deferred();
  f.app.infer = async options => {await options.getFrame(); await gate.promise; return prediction();};
  await f.videoFrame();
  f.tracks[0].muted = true; f.tracks[0].dispatchEvent(new Event('mute'));
  assert.equal(f.instance.read().visible, false);
  gate.resolve(); await settle();
  assert.equal(f.instance.read().visible, false);
  await f.instance.dispose();
});

test('retained predictions require source identity, stay visibly replay, and reverse only left faces', async () => {
  const f = await fixture();
  await assert.rejects(f.instance.operations.presentRetained(prediction({source: null})), /source/i);
  await f.instance.operations.presentRetained(prediction({handedness: 'left'}));
  let state = f.instance.read();
  assert.equal(state.inputSource.kind, 'retained-prediction');
  assert.equal(state.inputSource.source.id, 'retained-fixture');
  assert.equal(state.presentation, 'replay-hand');
  assert.equal(state.running, false);
  const hand = f.scene.getObjectByProperty('uuid', state.objects.hand.uuid);
  assert.deepEqual(Array.from(hand.geometry.index.array), [0, 2, 1]);
  f.tick(100000); assert.equal(f.instance.read().visible, true);
  await f.instance.operations.start();
  state = f.instance.read(); assert.equal(state.visible, false);
  assert.equal(state.inputSource.kind, 'live-camera');
  await f.instance.dispose();
});

test('disposal during model creation waits and destroys the late app, preserving borrowed scene', async () => {
  const gate = deferred();
  const f = await fixture({createApp: async (_options, app) => {await gate.promise; return app;}});
  const loading = f.instance.operations.load().catch(error => error);
  await settle();
  let completed = false; const closing = f.instance.dispose().then(() => {completed = true;});
  await settle(); assert.equal(completed, false);
  gate.resolve(); await loading; await closing;
  assert.equal(f.counts().destroyed, 1);
  assert.equal(f.callbacks.size, 0);
  assert.deepEqual(f.scene.children, [f.borrowed]);
});

test('new live start supersedes a retained operation waiting on old inference', async () => {
  const gate = deferred();
  const f = await fixture({infer: async options => {await options.getFrame(); await gate.promise; return prediction();}});
  await f.instance.operations.start(); await f.videoFrame();
  const replaying = f.instance.operations.presentRetained(prediction());
  const restarting = f.instance.operations.start();
  gate.resolve(); await replaying; await restarting;
  assert.equal(f.instance.read().inputSource.kind, 'live-camera');
  assert.equal(f.instance.read().visible, false);
  await f.instance.dispose();
});

test('source gap invalidates old results even when host rendering was suspended', async () => {
  const gate = deferred();
  const f = await fixture({infer: async options => {await options.getFrame(); await gate.promise; return prediction();}});
  await f.instance.operations.start(); await f.videoFrame();
  f.elapseWithoutHostFrame(f.instance.read().freshness.sourceBudgetMs + 1);
  await f.videoFrame();
  gate.resolve(); await settle();
  assert.equal(f.instance.read().visible, false, 'pre-stall result cannot become a post-stall hand');
  await f.instance.dispose();
});

test('retained source with explicit topology loads no model app and preserves source metadata', async () => {
  const f = await fixture();
  await f.instance.operations.presentRetained(prediction({faces: [0, 1, 2], source: {path: 'observed/hand.json', label: 'Observed fixture', sha256: 'fixture-sha'}}));
  assert.equal(f.counts().appCreates, 0);
  assert.equal(f.instance.read().inputSource.source.sha256, 'fixture-sha');
  assert.equal(f.instance.read().identity, null);
  await f.instance.dispose();
});

test('invalid placement and inference failure hide hand; failure releases camera', async () => {
  const f = await fixture(); await f.instance.operations.start(); await f.videoFrame();
  f.registration.place = () => ({valid: false, reason: 'degenerate_landmarks', source: {id: 'bad-landmarks'}});
  await f.videoFrame();
  assert.equal(f.instance.read().visible, false);
  assert.equal(f.instance.read().placement.reason, 'degenerate_landmarks');
  assert.equal(f.instance.read().running, true);
  f.app.infer = async () => {throw Error('inference failure fixture');};
  await f.videoFrame();
  assert.equal(f.instance.read().running, false);
  assert.match(f.instance.read().error, /inference failure fixture/);
  assert.equal(f.tracks[0].stops, 1);
  assert.equal(f.callbacks.size, 0);
  await f.instance.dispose();
});

test('actual reach-state consumer sees contact and releases its grab on camera loss', async () => {
  const {createHandReachState} = await import('../models/mobrecon/hand-reach-state.js');
  const f = await fixture({createState: createHandReachState});
  const joints = new Float32Array(63);
  const place = f.registration.place;
  f.registration.place = (...args) => ({...place(...args), worldJoints: joints});
  const pose = async (index, thumb) => {joints.set(index, 24); joints.set(thumb, 12); await f.videoFrame();};
  await f.instance.operations.start();
  await pose([-.04, .28, -.1], [-.1, .28, -.1]);
  assert.equal(f.instance.read().state.contact, true);
  await pose([.06, .23, 0], [.04, .23, 0]);
  assert.equal(f.instance.read().state.grabbed, true);
  await pose([.06, .23, -.06], [.04, .23, -.06]);
  assert.ok(f.instance.read().state.cubePosition[2] < -.05);
  await f.instance.operations.stop();
  assert.equal(f.instance.read().state.grabbed, false);
  assert.equal(f.instance.read().state.pinching, false);
  await f.instance.dispose();
});

test('completed load and start return settled status flags', async () => {
  const f = await fixture();
  const loaded = await f.instance.operations.load();
  assert.equal(loaded.loading, false);
  const started = await f.instance.operations.start();
  assert.equal(started.starting, false);
  assert.equal(started.running, true);
  await f.instance.dispose();
});

test('stopping during model load cannot acquire a camera later', async () => {
  const gate = deferred();
  const f = await fixture();
  f.app.load = () => gate.promise;
  const starting = f.instance.operations.start(); await settle();
  await f.instance.operations.stop(); gate.resolve(); await starting;
  assert.equal(f.tracks.length, 0);
  assert.equal(f.instance.read().running, false);
  assert.equal(f.instance.read().starting, false);
  await f.instance.dispose();
});

test('track ended stops the exact stream and retained late callback cannot restart it', async () => {
  const f = await fixture(); await f.instance.operations.start(); await f.videoFrame();
  const lateCallback = [...f.callbacks.values()][0];
  f.tracks[0].readyState = 'ended'; f.tracks[0].dispatchEvent(new Event('ended'));
  assert.equal(f.instance.read().running, false);
  assert.equal(f.instance.read().visible, false);
  assert.equal(f.tracks[0].stops, 1);
  lateCallback(0, {mediaTime: 7}); await settle();
  assert.equal(f.callbacks.size, 0);
  assert.equal(f.instance.read().visible, false);
  await f.instance.dispose();
});

test('load failures clean the owned app without double-destroying on disposal', async () => {
  const f = await fixture();
  f.app.load = async () => {throw Error('missing weights fixture');};
  await assert.rejects(f.instance.operations.load(), /missing weights fixture/);
  assert.equal(f.counts().destroyed, 1);
  assert.equal(f.instance.read().loading, false);
  assert.match(f.instance.read().error, /missing weights/);
  await f.instance.dispose();
  assert.equal(f.counts().destroyed, 1);
});

test('in-flight disposal waits for retirement and removes only its owned registration', async () => {
  const gate = deferred();
  const f = await fixture({infer: async options => {await options.getFrame(); await gate.promise; return prediction();}});
  await f.instance.operations.start(); await f.videoFrame();
  const hand = f.scene.getObjectByProperty('uuid', f.instance.read().objects.hand.uuid);
  let closed = false;
  const closing = f.instance.dispose().then(() => {closed = true;});
  assert.equal(f.tracks[0].stops, 1);
  await settle(); assert.equal(closed, false);
  gate.resolve(); await closing;
  assert.equal(hand.visible, false);
  assert.deepEqual(f.scene.children, [f.borrowed]);
  assert.equal(f.counts().destroyed, 1);
});

test('controls invoke production operations, retain numeric choices, and label live versus replay', async () => {
  const nodes = [];
  const document = {activeElement: null, createElement(tagName) {
    const node = Object.assign(new EventTarget(), {tagName, children: [], dataset: {}, style: {}, attributes: {},
      append(...children) {this.children.push(...children);}, setAttribute(name, value) {this.attributes[name] = value;}});
    nodes.push(node); return node;
  }};
  const f = await fixture();
  f.instance.mount({root: document.createElement('section'), document,
    invoke: async (operation, value) => f.instance.operations[operation](value)});
  assert.equal(f.drags.length, 10, 'every numeric control installs the shared number drag');
  const threshold = nodes.find(node => node.attributes['aria-label'] === 'Threshold');
  threshold.value = '.91'; threshold.dispatchEvent(new Event('input')); await settle();
  assert.equal(f.instance.read().detectorThreshold, .91);
  assert.equal(f.recipes.at(-1).detectorThreshold, .91);
  const hand = nodes.find(node => node.attributes['aria-label'] === 'Hand');
  hand.value = 'left'; hand.dispatchEvent(new Event('change')); await settle();
  assert.equal(f.instance.read().handedness, 'left');
  const status = nodes.find(node => node.attributes.role === 'status');
  const button = nodes.find(node => node.tagName === 'button' && node.textContent === 'Start camera');
  button.dispatchEvent(new Event('click')); await settle(); await f.videoFrame();
  assert.match(status.textContent, /^LIVE CAMERA/);
  assert.equal(button.textContent, 'Stop camera');
  await f.instance.operations.presentRetained(prediction({faces: [0, 1, 2]}));
  assert.match(status.textContent, /^REPLAY: Synthetic retained fixture/);
  assert.equal(button.textContent, 'Start camera');
  await f.instance.dispose(); assert.ok(f.drags.every(drag => drag.disposed));
});
