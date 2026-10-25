import {Group, Mesh, BufferGeometry, BufferAttribute, MeshStandardMaterial, SphereGeometry, BoxGeometry} from '../lib/three.core.js';
import {createHandMeshApp} from '../models/mobrecon/hand-mesh-app.js';
import {disposeOwnedSceneTree} from '../workbench-scene-host.mjs';

const positive = (value, name) => {
  if (!Number.isFinite(value) || value <= 0) throw Error(`${name} must be positive`);
  return value;
};
const side = value => {if (!['right', 'left'].includes(value)) throw Error('Hand must be right or left'); return value;};
const thresholdValue = value => {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw Error('Threshold must be between 0 and 1');
  return value;
};
const position = value => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) throw Error('Position requires three finite meters');
  return [...value];
};
const message = error => String(error?.message ?? error);

// Dependencies replace external acquisition in lifecycle tests; geometry, lifecycle,
// controls and presentation below are the same code used by the Workbench.
export async function createHandReachExperiment({host, inputs = {}, record = () => {}, updateInputs = () => {}}, dependencies = {}) {
  let handedness = side(inputs.handedness ?? 'right');
  let detectorThreshold = thresholdValue(inputs.detectorThreshold ?? .8);
  let focalRatio = positive(inputs.focalRatio ?? 1, 'Focal ratio');
  const packages = {mobrecon: inputs.mobreconPackage ?? '/scratch/mobrecon/package/', detector: inputs.detectorPackage ?? '/scratch/hand-detector/package/'};
  const registrationUrl = inputs.registrationUrl ?? '/scratch/hand-registration/registration.json';
  const document = host.controls.document;
  const now = dependencies.now ?? (() => performance.now());
  const getGpu = dependencies.getGpu ?? (() => document.defaultView.kaminosAppGpu?.());
  const getUserMedia = dependencies.getUserMedia ?? (options => document.defaultView.navigator.mediaDevices.getUserMedia(options));
  const createApp = dependencies.createApp ?? createHandMeshApp;
  const loadRegistration = dependencies.loadRegistration ?? (async (...args) => (await import('../models/mobrecon/hand-camera-registration.js')).loadHandRegistration(...args));
  const createRegistration = dependencies.createRegistration ?? (async resource => (await import('../models/mobrecon/hand-camera-registration.js')).createHandRegistration(resource));
  const state = await (dependencies.createState ?? (async () => (await import('../models/mobrecon/hand-reach-state.js')).createHandReachState()))();
  if (inputs.target) state.setTarget({position: position(inputs.target.position), radius: positive(inputs.target.radius, 'Target radius')});
  if (inputs.cube) state.setCube({position: position(inputs.cube.position), size: positive(inputs.cube.size, 'Cube size')});
  const initial = state.read();
  const session = await host.scene.open();
  const root = new Group(); root.name = 'Hand reach';
  const hand = new Mesh(new BufferGeometry(), new MeshStandardMaterial({color: 0xd6a9a0, roughness: .65, metalness: 0}));
  hand.name = 'Registered hand'; hand.visible = false; hand.castShadow = true; hand.receiveShadow = true;
  const target = new Mesh(new SphereGeometry(1, 24, 16), new MeshStandardMaterial({color: 0xe6c448, roughness: .4, transparent: true, opacity: .65}));
  target.name = 'Fingertip target';
  const cube = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({color: 0x40a6c8, roughness: .45}));
  cube.name = 'Pinch cube'; cube.castShadow = true; cube.receiveShadow = true;
  const indexMarker = new Mesh(new SphereGeometry(.004, 16, 12), new MeshStandardMaterial({color: 0x91f0c5, emissive: 0x174c33}));
  indexMarker.name = 'Index tip'; indexMarker.visible = false;
  const pinchMarker = new Mesh(new SphereGeometry(.005, 16, 12), new MeshStandardMaterial({color: 0xf7d16f, emissive: 0x593c0e}));
  pinchMarker.name = 'Pinch midpoint'; pinchMarker.visible = false;
  root.add(hand, target, cube, indexMarker, pinchMarker);
  let asset;
  try {asset = await session.attach(root, {owned: true, metadata: {label: root.name, type: 'experiment', source: {experiment: 'hand-reach', registrationUrl}}});}
  catch (error) {disposeOwnedSceneTree(root, []); await session.dispose(); throw error;}

  const video = document.createElement('video');
  video.muted = true; video.autoplay = true; video.playsInline = true;
  const abort = new AbortController(), destroyedApps = new WeakMap();
  let app = null, registration = null, registrationLoading = null, loading = null, progress = null;
  let stream = null, running = false, starting = false, disposed = false, closing = null;
  let generation = 0, observationEpoch = 0, configRevision = 0, frameCallback, flight = null;
  let sourceFrame = null, sourceAt = null, lastRequestedFrame = null, lastCaptureAt = null;
  let frameIntervalMs = null, inferenceLatencyMs = null, blocked = false;
  let presentation = 'camera-off', error = null, inputSource = null, placement = null, last = null, received = 0;
  let status, cameraButton, fieldDocument;
  const fields = new Map(), scrubs = [], trackListeners = [];
  const assertOpen = () => {if (disposed) throw Error('Hand reach experiment is closed');};
  const current = ticket => !disposed && generation === ticket;
  const destroyApp = value => {
    if (!value) return Promise.resolve();
    if (!destroyedApps.has(value)) destroyedApps.set(value, Promise.resolve().then(() => value.destroy()));
    return destroyedApps.get(value);
  };
  // A one-second startup grace is a display-loss policy, not a camera/inference
  // rate cap. Once measured, allow three source periods or inference latencies.
  // Gaps already classified as loss do not train the source cadence estimator.
  const sourceBudget = () => Math.max(1000, 3 * (frameIntervalMs ?? 0));
  const predictionBudget = () => Math.max(sourceBudget(), 3 * (inferenceLatencyMs ?? 0));
  const track = () => stream?.getVideoTracks()[0];
  const sourceFresh = () => running && !blocked && track()?.readyState === 'live' && !track()?.muted
    && sourceAt !== null && now() - sourceAt <= sourceBudget();
  const read = () => ({
    authority: 'uncalibrated-hand-reach-experiment', interactionAuthority: 'local-target-and-cube-only',
    running, starting, disposed, loading: Boolean(loading), progress, error, presentation, visible: hand.visible,
    handedness, detectorThreshold, focalRatio, packages, registrationUrl,
    inputSource: inputSource ? structuredClone(inputSource) : null,
    identity: app?.identity ?? null, application: app?.snapshot() ?? null, registrationIdentity: registration?.identity ?? null,
    placement: placement ? structuredClone(placement) : null,
    prediction: last ? {identity: last.identity ?? null, source: last.source ?? null, handedness: last.handedness ?? null,
      hasHand: last.hasHand, cropBox: last.cropBox ?? null, acquisition: last.acquisition ?? null, timings: last.timings ?? null} : null,
    freshness: {policy: 'one-second-bootstrap-or-three-observed-periods', frameIntervalMs, inferenceLatencyMs,
      sourceBudgetMs: sourceBudget(), predictionBudgetMs: predictionBudget(),
      sourceAgeMs: sourceAt === null ? null : now() - sourceAt, captureAgeMs: lastCaptureAt === null ? null : now() - lastCaptureAt},
    camera: track() ? {trackId: track().id, readyState: track().readyState, muted: track().muted, settings: track().getSettings()} : null,
    received, state: state.read(), objects: Object.fromEntries(Object.entries({root, hand, target, cube, indexMarker, pinchMarker})
      .map(([key, value]) => [key, {id: asset.id, uuid: value.uuid, name: value.name, visible: value.visible}])),
    view: session.readView(),
  });
  const sync = (force = false) => {
    if (cameraButton) {cameraButton.textContent = starting ? 'Cancel camera' : running ? 'Stop camera' : 'Start camera'; cameraButton.disabled = disposed;}
    const s = state.read();
    if (status) {
      const origin = inputSource?.kind === 'retained-prediction' ? `REPLAY: ${inputSource.label}` : running ? 'LIVE CAMERA' : starting ? 'STARTING CAMERA' : 'CAMERA OFF';
      const condition = s.grabbed ? 'Cube grabbed' : s.contact ? 'Target contact' : s.tracking ? 'Tracking' : presentation.replaceAll('-', ' ');
      status.textContent = `${origin} | ${condition}${loading ? ' | Loading models' : ''}${error ? ` | ${error}` : ''}`;
    }
    const values = {handedness, detectorThreshold, focalRatio, radius: s.target.radius, size: s.cubeSize};
    for (const [i, axis] of ['x', 'y', 'z'].entries()) {values[`target-${axis}`] = s.target.position[i]; values[`cube-${axis}`] = s.cubePosition[i];}
    for (const [key, field] of fields) if (force || fieldDocument.activeElement !== field || field.readOnly) field.value = String(values[key]);
  };
  const drawState = () => {
    const s = state.read();
    target.position.fromArray(s.target.position); target.scale.setScalar(s.target.radius);
    target.material.color.setHex(s.contact ? 0x46d39a : 0xe6c448);
    cube.position.fromArray(s.cubePosition); cube.scale.setScalar(s.cubeSize);
    cube.material.color.setHex(s.grabbed ? 0xf2ba57 : 0x40a6c8);
    indexMarker.visible = hand.visible && s.tracking && Boolean(s.indexTip);
    pinchMarker.visible = hand.visible && s.tracking && Boolean(s.pinchPoint);
    if (indexMarker.visible) indexMarker.position.fromArray(s.indexTip);
    if (pinchMarker.visible) pinchMarker.position.fromArray(s.pinchPoint);
    pinchMarker.material.color.setHex(s.pinching ? 0xffe88c : 0xb4bfcc);
    session.redraw(); sync();
  };
  const lose = reason => {
    if (presentation !== reason || hand.visible) observationEpoch++;
    presentation = reason; hand.visible = false; state.lose(); drawState();
  };
  const applied = kind => {sync(); const effective = read(); record({kind: `hand-reach.${kind}`, phase: 'applied', target: asset.id, effective}); return effective;};
  const remember = () => {const s = state.read(); updateInputs({...inputs, handedness, detectorThreshold, focalRatio,
    target: s.target, cube: {position: s.cubePosition, size: s.cubeSize}});};

  const ensureRegistration = () => {
    assertOpen();
    if (registration) return Promise.resolve(registration);
    return registrationLoading ??= (async () => {
      const resource = await loadRegistration(registrationUrl, {signal: abort.signal});
      assertOpen(); registration = await createRegistration(resource); assertOpen(); return registration;
    })().finally(() => {registrationLoading = null;});
  };
  const load = () => {
    assertOpen();
    if (loading) return loading;
    loading = (async () => {
      try {
        await ensureRegistration();
        if (!app) {
          const gpu = await getGpu(); assertOpen();
          if (!gpu?.device) throw Error('Hand reach requires the Workbench WebGPU device');
          const created = await createApp({device: gpu.device, load: false, adapterName: 'Workbench hand reach borrowed device',
            mobreconPackageUrl: packages.mobrecon, detectorPackageUrl: packages.detector,
            onProgress: value => {progress = value; sync();}});
          if (disposed) {await destroyApp(created); assertOpen();}
          app = created;
        }
        await app.load(); assertOpen(); error = null; loading = null; progress = null;
        return applied('load');
      } catch (cause) {
        error = message(cause); const failed = app; app = null;
        try {await destroyApp(failed);} catch (cleanup) {throw new AggregateError([cause, cleanup], 'Hand model load cleanup failed');}
        throw cause;
      } finally {loading = null; progress = null; sync();}
    })();
    sync(); return loading;
  };
  const releaseCamera = () => {
    if (frameCallback !== undefined) {video.cancelVideoFrameCallback?.(frameCallback); frameCallback = undefined;}
    for (const remove of trackListeners.splice(0)) remove();
    stream?.getTracks().forEach(item => item.stop()); stream = null;
    video.pause(); video.srcObject = null;
  };
  const stop = async () => {
    generation++; running = false; starting = false; blocked = true;
    releaseCamera(); app?.stop('Camera stopped'); lose('camera-off');
    await flight?.catch(() => {}); return applied('stop');
  };
  const failCamera = cause => {
    error = message(cause); generation++; running = false; starting = false; blocked = true;
    releaseCamera(); app?.stop(error); lose('camera-error'); applied('failure');
  };
  const present = (result, origin, faces) => {
    last = result; inputSource = origin;
    if (result.hasHand === false) {placement = null; lose(origin.kind === 'retained-prediction' ? 'replay-no-hand' : 'no-hand'); return;}
    if (result.hasHand !== true) throw Error('Prediction must declare hasHand');
    side(result.handedness);
    const placed = registration.place(result, {width: origin.width, height: origin.height, focalRatio});
    placement = {valid: placed.valid, reason: placed.reason ?? null, translation: placed.translation ? Array.from(placed.translation) : null,
      rmsePx: placed.rmsePx ?? null, camera: placed.camera ?? null, source: placed.source ?? null,
      registrationIdentity: registration.identity, vertexCount: (placed.worldVertices?.length ?? 0) / 3,
      jointCount: (placed.worldJoints?.length ?? 0) / 3};
    if (!placed.valid) {lose(origin.kind === 'retained-prediction' ? 'replay-unplaced' : 'unplaced'); return;}
    const vertices = placed.worldVertices, joints = placed.worldJoints;
    if (!vertices?.length || vertices.length % 3 || !vertices.every(Number.isFinite) || joints?.length !== 63 || !joints.every(Number.isFinite)) throw Error('Registration returned invalid world geometry');
    if (!faces?.length || faces.length % 3 || !Array.from(faces).every(value => Number.isInteger(value) && value >= 0 && value < vertices.length / 3)) throw Error('Prediction requires valid triangle faces');
    // Registration already rotates camera coordinates into operator space. Only
    // the model's left-hand reflection reverses triangle orientation.
    const indices = Array.from(faces);
    if (result.handedness === 'left') for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
    hand.geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
    hand.geometry.setIndex(indices); hand.geometry.computeVertexNormals(); hand.geometry.computeBoundingSphere();
    hand.visible = true; state.update({joints, valid: true}); received++;
    presentation = origin.kind === 'retained-prediction' ? 'replay-hand' : 'live-hand'; drawState();
  };
  const infer = ticket => {
    if (!current(ticket) || !sourceFresh() || flight || !app || sourceFrame === lastRequestedFrame) return;
    const revision = configRevision;
    let capture;
    const task = (async () => {
      const result = await app.infer({handedness, acquisition: {mode: 'detector', threshold: detectorThreshold, padding: 1.4, onMiss: 'skip'},
        getFrame: () => {
          if (!current(ticket) || !sourceFresh() || revision !== configRevision) throw new DOMException('Camera frame superseded', 'AbortError');
          const width = video.videoWidth, height = video.videoHeight;
          if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) throw Error('Camera frame dimensions unavailable');
          lastRequestedFrame = sourceFrame;
          capture = {kind: 'live-camera', label: 'Unmirrored camera', width, height, frameId: video.currentTime,
            capturedAtMs: now(), epoch: observationEpoch,
            source: {streamId: stream.id, trackId: track().id, mirrored: false}};
          return {source: video, width, height, frameId: capture.frameId};
        }});
      if (!current(ticket) || revision !== configRevision || !capture || capture.epoch !== observationEpoch || !sourceFresh()) return;
      const latency = now() - capture.capturedAtMs;
      inferenceLatencyMs = Math.max(inferenceLatencyMs ?? 0, latency);
      lastCaptureAt = capture.capturedAtMs;
      present(result, capture, app.faces);
    })().catch(cause => {
      if (!current(ticket) || revision !== configRevision || cause?.name === 'AbortError') return;
      failCamera(cause);
    }).finally(() => {if (flight === task) flight = null;});
    flight = task;
  };
  const observeFrame = (ticket, mediaTime) => {
    if (!current(ticket) || !running || track()?.muted || track()?.readyState !== 'live' || mediaTime === sourceFrame) return;
    const at = now(), gap = sourceAt === null ? null : at - sourceAt;
    if (gap !== null && gap > sourceBudget()) lose('camera-stalled');
    if (gap !== null && gap > 0 && gap <= sourceBudget()) frameIntervalMs = frameIntervalMs === null ? gap : .9 * frameIntervalMs + .1 * gap;
    sourceFrame = mediaTime; sourceAt = at; blocked = false; infer(ticket);
  };
  const schedule = ticket => {
    if (!current(ticket) || !running || !video.requestVideoFrameCallback) return;
    frameCallback = video.requestVideoFrameCallback((_time, metadata) => {
      frameCallback = undefined;
      observeFrame(ticket, metadata.mediaTime); schedule(ticket);
    });
  };
  const start = async () => {
    assertOpen(); if (running || starting) return read();
    const ticket = ++generation; starting = true; error = null; blocked = true;
    inputSource = {kind: 'live-camera', label: 'Unmirrored camera', source: null};
    lose('starting-camera');
    try {
      await flight?.catch(() => {}); if (!current(ticket)) return read();
      await load(); if (!current(ticket)) return read();
      // No requested resolution/frame-rate caps: use the camera's actual route.
      const acquired = await getUserMedia({video: true, audio: false});
      if (!current(ticket)) {acquired.getTracks().forEach(item => item.stop()); return read();}
      stream = acquired; video.srcObject = stream;
      const cameraTrack = track(); if (!cameraTrack) throw Error('Camera supplied no video track');
      const listen = (target, type, handler) => {target.addEventListener(type, handler); trackListeners.push(() => target.removeEventListener(type, handler));};
      const lost = reason => {if (current(ticket)) {blocked = true; lose(reason);}};
      listen(cameraTrack, 'ended', () => {if (current(ticket)) failCamera(Error('Camera track ended'));});
      listen(cameraTrack, 'mute', () => lost('camera-muted'));
      listen(cameraTrack, 'unmute', () => lost('awaiting-frame'));
      for (const type of ['waiting', 'stalled', 'emptied']) listen(video, type, () => lost('camera-stalled'));
      listen(video, 'error', () => {if (current(ticket)) failCamera(Error('Camera video failed'));});
      await video.play(); if (!current(ticket)) return read();
      sourceFrame = null; sourceAt = now(); lastRequestedFrame = null; lastCaptureAt = null;
      frameIntervalMs = cameraTrack.getSettings().frameRate > 0 ? 1000 / cameraTrack.getSettings().frameRate : null;
      inferenceLatencyMs = null; last = null; placement = null; received = 0;
      running = true; starting = false; blocked = false; lose('awaiting-frame'); schedule(ticket);
      return applied('start');
    } catch (cause) {if (current(ticket)) {failCamera(cause); throw cause;} return read();}
    finally {if (current(ticket)) {starting = false; sync();}}
  };
  const frame = () => {assertOpen(); session.setView({position: [0, .2, .75], target: [0, .2, 0], up: [0, 1, 0], near: .01}); return applied('frame');};
  const unsubscribe = session.onFrame(() => {
    if (disposed) return;
    if (running) {
      if (!video.requestVideoFrameCallback && video.readyState >= 2) observeFrame(generation, video.currentTime);
      if (!blocked && sourceAt !== null && now() - sourceAt > sourceBudget()) {blocked = true; lose('camera-stalled');}
      else if (hand.visible && lastCaptureAt !== null && now() - lastCaptureAt > predictionBudget()) lose('prediction-stale');
      infer(generation);
    }
    sync();
  });
  drawState(); frame();
  const operations = {
    load, start, stop, frame,
    setHandedness(value) {assertOpen(); handedness = side(value); configRevision++; lose('awaiting-frame'); remember(); return applied('hand');},
    setThreshold(value) {assertOpen(); detectorThreshold = thresholdValue(value); configRevision++; lose('awaiting-frame'); remember(); return applied('threshold');},
    setFocalRatio(value) {assertOpen(); focalRatio = positive(value, 'Focal ratio'); configRevision++; lose('awaiting-frame'); remember(); return applied('focal-ratio');},
    setTarget(value) {assertOpen(); const s = state.read(); state.setTarget({position: position(value.position ?? s.target.position), radius: positive(value.radius ?? s.target.radius, 'Target radius')}); drawState(); remember(); return applied('target');},
    setCube(value) {assertOpen(); const s = state.read(); state.setCube({position: position(value.position ?? s.cubePosition), size: positive(value.size ?? s.cubeSize, 'Cube size')}); drawState(); remember(); return applied('cube');},
    reset() {assertOpen(); state.reset(); state.setTarget(initial.target); state.setCube({position: initial.cubePosition, size: initial.cubeSize}); lose('awaiting-frame'); remember(); return applied('reset');},
    async presentRetained(result) {
      assertOpen();
      const source = result?.source;
      if (!(typeof source === 'string' && source.trim()) && !(source && typeof source === 'object' && [source.id, source.url, source.path].some(value => typeof value === 'string' && value.trim()))) throw Error('Retained prediction requires an explicit source identity');
      const width = result.width ?? result.input?.width, height = result.height ?? result.input?.height;
      if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) throw Error('Retained prediction requires width and height');
      const stopping = stop(), ticket = generation;
      await stopping; if (!current(ticket)) return read();
      if (result.faces || result.hasHand === false) await ensureRegistration(); else await load();
      if (!current(ticket)) return read();
      try {
        present(result, {kind: 'retained-prediction', label: typeof source === 'string' ? source : source.label ?? source.id ?? source.url ?? source.path,
          source: structuredClone(source), width, height, frameId: result.input?.frameId ?? result.frameId ?? null}, result.faces ?? app?.faces);
        return applied('retained');
      } catch (cause) {error = message(cause); lose('replay-error'); throw cause;}
    },
  };
  return {
    read, operations,
    mount({root: panel, document: doc, invoke}) {
      fieldDocument = doc;
      const call = (name, value) => invoke(name, value).catch(cause => {error = message(cause); sync(true);});
      const command = (label, name) => {const button = doc.createElement('button'); button.type = 'button'; button.textContent = label; button.addEventListener('click', () => call(name)); return button;};
      const commands = doc.createElement('div'); commands.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
      // A single command changes meaning with camera lifetime, including permission cancellation.
      cameraButton = doc.createElement('button'); cameraButton.type = 'button';
      cameraButton.addEventListener('click', () => call(running || starting ? 'stop' : 'start'));
      commands.append(cameraButton, command('Reset', 'reset'), command('Frame', 'frame'));
      const handLabel = doc.createElement('label'); handLabel.textContent = 'Hand ';
      const select = doc.createElement('select'); select.setAttribute('aria-label', 'Hand');
      for (const value of ['right', 'left']) {const option = doc.createElement('option'); option.value = value; option.textContent = value === 'right' ? 'Right hand' : 'Left hand'; select.append(option);}
      select.addEventListener('change', () => call('setHandedness', select.value)); fields.set('handedness', select); handLabel.append(select);
      status = doc.createElement('div'); status.setAttribute('role', 'status'); status.dataset.handReachStatus = '';
      status.style.cssText = 'font-size:12px;overflow-wrap:anywhere';
      panel.append(commands, handLabel, status);
      const number = (parent, label, key, step, action, min, max) => {
        const row = doc.createElement('label'); row.style.cssText = 'display:flex;align-items:center;gap:6px;min-width:0';
        const grip = doc.createElement('span'); grip.textContent = label; grip.style.flex = '1';
        const input = doc.createElement('input'); input.type = 'number'; input.step = 'any'; input.className = 'transform-input';
        input.style.cssText = 'width:85px;min-width:0'; input.setAttribute('aria-label', label);
        if (min !== undefined) input.min = String(min); if (max !== undefined) input.max = String(max);
        input.addEventListener('input', () => {if (input.value.trim() && Number.isFinite(Number(input.value))) action(Number(input.value));});
        input.addEventListener('blur', () => sync(true));
        row.append(grip, input); parent.append(row); fields.set(key, input);
        scrubs.push(host.controls.installNumberDrag({input, grip, step}));
      };
      number(panel, 'Threshold', 'detectorThreshold', .01, value => call('setThreshold', value), 0, 1);
      number(panel, 'Focal ratio', 'focalRatio', .01, value => call('setFocalRatio', value), .001);
      for (const name of ['target', 'cube']) {
        const group = doc.createElement('details'); group.open = true;
        const title = doc.createElement('summary'); title.textContent = name === 'target' ? 'Fingertip target (m)' : 'Pinch cube (m)'; group.append(title); panel.append(group);
        const operation = name === 'target' ? 'setTarget' : 'setCube';
        for (const [i, axis] of ['x', 'y', 'z'].entries()) number(group, axis.toUpperCase(), `${name}-${axis}`, .005, value => {
          const s = state.read(), next = [...(name === 'target' ? s.target.position : s.cubePosition)]; next[i] = value; call(operation, {position: next});
        });
        const key = name === 'target' ? 'radius' : 'size';
        number(group, name === 'target' ? 'Radius' : 'Size', key, .001, value => call(operation, {[key]: value}), .0001);
      }
      sync(true);
    },
    dispose() {
      if (closing) return closing;
      disposed = true; unsubscribe(); abort.abort('Hand reach closed');
      const stopped = stop();
      closing = (async () => {
        const results = await Promise.allSettled([stopped, destroyApp(app), loading, registrationLoading]);
        for (const scrub of scrubs) scrub?.dispose?.();
        await session.dispose();
        const failures = results.filter(result => result.status === 'rejected' && result.reason?.name !== 'AbortError' && !/experiment is closed/.test(message(result.reason))).map(result => result.reason);
        if (failures.length) throw new AggregateError(failures, 'Hand reach disposal failed');
      })();
      return closing;
    },
  };
}

export default {id: 'hand-reach', title: 'Hand reach', create: createHandReachExperiment};
