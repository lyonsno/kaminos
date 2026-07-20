import * as THREE from 'three';
import { summarizeLatencySamples } from './hand-state-latency-benchmark.mjs';
import {
  createLiveFingerJuiceEmitterPacket,
  LIVE_FLUID_CAMERA,
  LIVE_HAND_CAMERA,
  MANO_DISPLAY_ORIENTATION_CONTRACT,
  normalizeManoSurface,
  projectDisplayPointToFingerJuiceWorld,
} from './hand-state-finger-juice.mjs';
import { createWebGPUFingerFluidSolver } from './finger-fluid-webgpu-core.js';

const params = new URLSearchParams(window.location.search);
const runtimeUrl = params.get('runtime_url') || 'http://127.0.0.1:8766';
const fixtureMode = params.get('fixture') === '1';
const maxAgeMs = 750;
const captureIntervalMs = 80;

const canvas = document.getElementById('hand-canvas');
const fingerJuiceCanvas = document.getElementById('finger-juice-canvas');
const video = document.getElementById('camera');
const captureCanvas = document.getElementById('capture-canvas');
const captureContext = captureCanvas.getContext('2d', { alpha: false });
const toggle = document.getElementById('hand-toggle');
const status = document.getElementById('status');

const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x07090b, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(LIVE_HAND_CAMERA.fovDegrees, 1, 0.01, 30);
camera.position.set(...LIVE_HAND_CAMERA.position);

const keyLight = new THREE.DirectionalLight(0x8ce7ff, 4.2);
keyLight.position.set(-2.4, 2.8, 3.5);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xffba74, 2.6);
fillLight.position.set(2.6, -1.1, 2.1);
scene.add(fillLight);
const rimLight = new THREE.DirectionalLight(0x88ffc4, 3.1);
rimLight.position.set(0.4, 1.2, -3.2);
scene.add(rimLight);

const handMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x5a91b8,
  roughness: 0.42,
  metalness: 0.08,
  clearcoat: 0.4,
  clearcoatRoughness: 0.5,
  side: THREE.DoubleSide,
});
const handGeometry = new THREE.BufferGeometry();
const handMesh = new THREE.Mesh(handGeometry, handMaterial);
handMesh.visible = false;
scene.add(handMesh);

let stream = null;
let running = false;
let captureInFlight = false;
let captureTimer = null;
let stateAbortController = null;
let lastStateSequence = 0;
let faceSignature = '';
let smoothedPositions = null;
let currentManoTransform = null;
let lastLiveAt = 0;
let frameSequence = 0;
let benchmarkSessionId = '';
let pendingLatencySample = null;
let benchmarkDroppedBeforeRender = 0;
let lastBenchmarkError = null;
let latencyFlushTimer = null;
const captureMetricsByFrame = new Map();
const latencySamples = [];
const unflushedLatencySamples = [];
let fingerJuiceSolver = null;
let fingerJuiceRenderer = null;
let fingerJuiceInitPromise = null;
let fingerJuiceStepPromise = null;
let fingerJuiceWarmupTimer = null;
let fingerJuiceLastStepAt = 0;
let fingerJuicePacket = createLiveFingerJuiceEmitterPacket(null);
let previousFingerTips = null;
let previousFingerTimestampMs = null;
let fingerJuiceError = null;
let animationFrameCount = 0;
let handRenderFrameCount = 0;
let fingerJuiceRenderAttemptCount = 0;

const MANO_FINGERTIP_VERTICES = Object.freeze([
  ['thumb', 745, 'splash'],
  ['index', 317, 'knockback'],
  ['middle', 444, 'pooling'],
  ['ring', 556, 'weird'],
  ['pinky', 673, 'weird'],
]);

function resetLatencyBenchmark() {
  benchmarkSessionId = globalThis.crypto?.randomUUID?.() || `hand-${Date.now()}`;
  pendingLatencySample = null;
  benchmarkDroppedBeforeRender = 0;
  lastBenchmarkError = null;
  clearTimeout(latencyFlushTimer);
  latencyFlushTimer = null;
  captureMetricsByFrame.clear();
  latencySamples.length = 0;
  unflushedLatencySamples.length = 0;
}

function setStatus(message, state = 'idle') {
  status.textContent = message;
  status.dataset.state = state;
}

function updateHandSurface(mano) {
  if (!mano?.available || !Array.isArray(mano.vertices) || !Array.isArray(mano.faces)) return false;
  const surface = normalizeManoSurface(mano.vertices);
  if (!surface) return false;
  const target = surface.positions;
  currentManoTransform = surface.transform;
  if (!smoothedPositions || smoothedPositions.length !== target.length) smoothedPositions = target.slice();
  else for (let index = 0; index < target.length; index += 1) smoothedPositions[index] += (target[index] - smoothedPositions[index]) * 0.62;

  const position = handGeometry.getAttribute('position');
  if (!position || position.array.length !== smoothedPositions.length) {
    handGeometry.setAttribute('position', new THREE.BufferAttribute(smoothedPositions.slice(), 3));
  } else {
    position.array.set(smoothedPositions);
    position.needsUpdate = true;
  }

  const nextFaceSignature = `${mano.faces.length}:${mano.faces[0]?.join(',') || ''}:${mano.faces.at(-1)?.join(',') || ''}`;
  if (faceSignature !== nextFaceSignature) {
    const index = mano.faces.flatMap(face => face.slice(0, 3).map(Number));
    handGeometry.setIndex(index);
    faceSignature = nextFaceSignature;
  }
  handGeometry.computeVertexNormals();
  handGeometry.computeBoundingSphere();
  handMesh.visible = true;
  lastLiveAt = performance.now();
  return true;
}

async function ensureFingerJuice() {
  if (fingerJuiceSolver && fingerJuiceRenderer) return fingerJuiceSolver;
  if (fingerJuiceInitPromise) return fingerJuiceInitPromise;
  fingerJuiceInitPromise = createWebGPUFingerFluidSolver({
    canvas: fingerJuiceCanvas,
    particleCount: 18_000,
    densityIterations: 2,
    truthScene: 'live_hand_inlets',
    rendererMode: 'screen_space_refraction',
    runtimeProfile: 'live_play',
    transparentBackground: true,
    liveInletPacket: fingerJuicePacket,
  }).then(async solver => {
    if (solver.solver_backend !== 'webgpu_compute') throw new Error(solver.reason || 'finger fluid WebGPU solver unavailable');
    const route = solver.getDebugState();
    if (route.effectiveRenderer !== 'webgpu-screen-space-liquid-refraction-v0') {
      throw new Error(`continuous finger fluid renderer mismatch: ${route.effectiveRenderer || 'missing'}`);
    }
    fingerJuiceSolver = solver;
    fingerJuiceRenderer = solver;
    fingerJuiceSolver.setLiveInletPacket(fingerJuicePacket);
    fingerJuiceError = null;
    return solver;
  }).catch(error => {
    fingerJuiceError = error.message || String(error);
    fingerJuiceInitPromise = null;
    throw error;
  });
  return fingerJuiceInitPromise;
}

function scheduleFingerJuiceWarmup() {
  if (fixtureMode || !running || !handMesh.visible || fingerJuiceSolver || fingerJuiceInitPromise || fingerJuiceWarmupTimer) return;
  fingerJuiceWarmupTimer = setTimeout(() => {
    fingerJuiceWarmupTimer = null;
    if (!running || !handMesh.visible) return;
    void ensureFingerJuice().catch(error => setStatus(error.message || String(error), 'error'));
  }, 1200);
}

async function probeFingerJuice(emitterPacket, steps = 24) {
  const solver = await ensureFingerJuice();
  const growth = solver.setLiveInletPacket(emitterPacket);
  fingerJuicePacket = {
    ...emitterPacket,
    active_emitter_count: emitterPacket.emitters?.filter(emitter => emitter.active).length || 0,
  };
  fingerJuiceCanvas.style.visibility = 'visible';
  await solver.step(1, 1 / 60);
  const respawn = solver.getDebugState();
  for (let index = 1; index < Math.max(1, Number(steps) || 1); index += 1) {
    await solver.step(1, 1 / 60);
    fingerJuiceRenderer.render({
      width: window.innerWidth,
      height: window.innerHeight,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 1) * 0.72,
      yaw: LIVE_FLUID_CAMERA.yaw,
      pitch: LIVE_FLUID_CAMERA.pitch,
      distance: LIVE_FLUID_CAMERA.distance,
      target: LIVE_FLUID_CAMERA.target,
      rendererMode: 'screen_space_refraction',
    });
  }
  return { growth, respawn };
}

function fixtureEmitterPacket() {
  const positions = handGeometry.getAttribute('position')?.array;
  if (!positions || positions.length < 778 * 3) throw new Error('recorded MANO surface is unavailable for the emitter witness');
  const emitters = MANO_FINGERTIP_VERTICES.map(([id, vertexIndex, chemistry]) => {
    const offset = vertexIndex * 3;
    const display = [positions[offset], positions[offset + 1], positions[offset + 2]];
    return {
      id,
      active: true,
      emission_state: 'jet',
      chemistry,
      origin_world: projectDisplayPointToFingerJuiceWorld(display, { width: window.innerWidth, height: window.innerHeight }),
      aim_world: [display[0] * 0.18, 0.32, 0.93],
      motion_world: [0, 0, 0],
      radius: id === 'middle' ? 0.052 : 0.044,
      strength: 1.15,
    };
  });
  return {
    packet_id: 'fixture-emitter-capacity-probe',
    route_identity: 'recorded-mano-fingertip-vertices-v0',
    emitters,
  };
}

function updateFingerJuice(state) {
  fingerJuicePacket = createLiveFingerJuiceEmitterPacket(state, {
    manoTransform: currentManoTransform,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    previousTips: previousFingerTips,
    previousTimestampMs: previousFingerTimestampMs,
    nowMs: Date.now(),
  });
  if (fingerJuicePacket.adapter) {
    previousFingerTips = fingerJuicePacket.adapter.tips;
    previousFingerTimestampMs = fingerJuicePacket.adapter.timestampMs;
  }
  if (fingerJuiceSolver) fingerJuiceSolver.setLiveInletPacket(fingerJuicePacket);
}

async function runtimeFetch(path, options = {}) {
  const response = await fetch(`${runtimeUrl}${path}`, { cache: 'no-store', ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `${path} returned ${response.status}`);
  return payload;
}

async function flushLatencySamples() {
  clearTimeout(latencyFlushTimer);
  latencyFlushTimer = null;
  if (!unflushedLatencySamples.length) return;
  const batch = unflushedLatencySamples.splice(0);
  try {
    await runtimeFetch('/viewer-latency-samples', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schema: 'hand-state.viewer-latency-batch.v0',
        samples: batch,
      }),
    });
  } catch (error) {
    unflushedLatencySamples.unshift(...batch);
    lastBenchmarkError = error.message || String(error);
    if (running && !latencyFlushTimer) latencyFlushTimer = setTimeout(flushLatencySamples, 1000);
  }
}

function scheduleLatencyFlush() {
  if (!latencyFlushTimer) latencyFlushTimer = setTimeout(flushLatencySamples, 1000);
}

async function captureFrame() {
  if (!running || captureInFlight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
  captureInFlight = true;
  try {
    const width = Math.min(video.videoWidth || 640, 640);
    const height = Math.round(width * (video.videoHeight || 480) / Math.max(video.videoWidth || 640, 1));
    const capturedAt = Date.now();
    const captureId = `${capturedAt}-${frameSequence += 1}`;
    const encodeStartedAt = performance.now();
    if (captureCanvas.width !== width || captureCanvas.height !== height) {
      captureCanvas.width = width;
      captureCanvas.height = height;
    }
    captureContext.save();
    captureContext.translate(width, 0);
    captureContext.scale(-1, 1);
    captureContext.drawImage(video, 0, 0, width, height);
    captureContext.restore();
    const blob = await new Promise(resolve => captureCanvas.toBlob(resolve, 'image/jpeg', 0.78));
    if (!blob) throw new Error('camera frame encoding failed');
    const clientEncodeMs = performance.now() - encodeStartedAt;
    const postStartedAt = performance.now();
    await runtimeFetch('/native-frame', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        'X-Capture-Id': captureId,
        'X-Capture-Epoch-Ms': String(capturedAt),
        'X-Frame-Width': String(width),
        'X-Frame-Height': String(height),
      },
      body: blob,
    });
    captureMetricsByFrame.set(captureId, {
      capturedAtEpochMs: capturedAt,
      clientEncodeMs,
      nativePostMs: performance.now() - postStartedAt,
    });
    for (const [frameId, metrics] of captureMetricsByFrame) {
      if (capturedAt - metrics.capturedAtEpochMs > 10_000) captureMetricsByFrame.delete(frameId);
    }
  } catch (error) {
    setStatus(error.message || String(error), 'error');
  } finally {
    captureInFlight = false;
  }
}

function applyState(state) {
  const frame = state.frame;
  if (frame?.authority?.sourceAuthority === 'live_simulation' && updateHandSurface(frame.mano)) {
    scheduleFingerJuiceWarmup();
    updateFingerJuice(state);
    const frameId = frame.frame?.frameId;
    const captureMetrics = captureMetricsByFrame.get(frameId);
    if (frameId && captureMetrics && !latencySamples.some(sample => sample.frameId === frameId) && pendingLatencySample?.frameId !== frameId) {
      const captureToViewerReceiveMs = Date.now() - frame.frame.captureTimestampMs;
      const captureToSidecarPublishMs = frame.timing?.cameraFrameAgeMs;
      const modelLatencyMs = frame.timing?.modelLatencyMs;
      if ([captureToViewerReceiveMs, captureToSidecarPublishMs, modelLatencyMs].every(Number.isFinite)) {
        if (pendingLatencySample) benchmarkDroppedBeforeRender += 1;
        pendingLatencySample = {
          schema: 'hand-state.viewer-latency-sample.v0',
          benchmarkSessionId,
          frameId,
          runtimeOwner: state.runtimeOwner,
          sourceAuthority: frame.authority.sourceAuthority,
          requestedRoute: frame.source.requestedRoute,
          effectiveRoute: frame.source.effectiveRoute,
          model: frame.source.model,
          deviceRoute: frame.source.deviceRoute,
          dtypeRoute: frame.source.dtypeRoute,
          manoVertexCount: frame.mano.vertexCount,
          manoFaceCount: frame.mano.faceCount,
          captureTimestampMs: frame.frame.captureTimestampMs,
          viewerReceiveTimestampMs: Date.now(),
          clientEncodeMs: captureMetrics.clientEncodeMs,
          nativePostMs: captureMetrics.nativePostMs,
          modelLatencyMs,
          captureToSidecarPublishMs,
          publishToViewerReceiveMs: Math.max(0, captureToViewerReceiveMs - captureToSidecarPublishMs),
          captureToViewerReceiveMs,
          captureToRenderCompleteMs: null,
        };
        captureMetricsByFrame.delete(frameId);
      } else {
        lastBenchmarkError = `incomplete live timing for ${frameId}`;
      }
    }
    const latency = pendingLatencySample?.captureToViewerReceiveMs || latencySamples.at(-1)?.captureToViewerReceiveMs;
    setStatus(`live MANO / ${frame.mano.vertexCount} vertices / ${fingerJuicePacket.active_emitter_count} jets${Number.isFinite(latency) ? ` / ${latency.toFixed(0)} ms receipt` : ''}`, 'live');
  } else {
    updateFingerJuice(state);
    setStatus(`waiting for live MANO / ${frame?.authority?.fallbackReason || 'no frame'}`);
  }
}

async function streamState() {
  while (running) {
    const controller = new AbortController();
    stateAbortController = controller;
    try {
      const state = await runtimeFetch(
        `/state/next?after_sequence=${lastStateSequence}&timeout_ms=1000&max_age_ms=${maxAgeMs}`,
        { signal: controller.signal },
      );
      if (!running) return;
      if (Number.isFinite(state.eventSequence)) lastStateSequence = state.eventSequence;
      applyState(state);
    } catch (error) {
      if (!running || error?.name === 'AbortError') return;
      setStatus(error.message || String(error), 'error');
      await new Promise(resolve => setTimeout(resolve, 100));
    } finally {
      if (stateAbortController === controller) stateAbortController = null;
    }
  }
}

async function start() {
  if (running) return;
  setStatus('opening camera');
  stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
  video.srcObject = stream;
  await video.play();
  await runtimeFetch('/sidecar/start', { method: 'POST' });
  resetLatencyBenchmark();
  lastStateSequence = 0;
  running = true;
  fingerJuiceCanvas.style.visibility = 'visible';
  toggle.textContent = 'Stop Hand';
  toggle.dataset.running = 'true';
  captureTimer = setInterval(captureFrame, captureIntervalMs);
  void streamState();
  await captureFrame();
}

async function stop() {
  running = false;
  clearInterval(captureTimer);
  captureTimer = null;
  clearTimeout(fingerJuiceWarmupTimer);
  fingerJuiceWarmupTimer = null;
  stateAbortController?.abort();
  stateAbortController = null;
  fingerJuicePacket = createLiveFingerJuiceEmitterPacket(null);
  fingerJuiceSolver?.setLiveInletPacket(fingerJuicePacket);
  previousFingerTips = null;
  previousFingerTimestampMs = null;
  fingerJuiceCanvas.style.visibility = 'hidden';
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  video.srcObject = null;
  await flushLatencySamples();
  try { await runtimeFetch('/sidecar/stop', { method: 'POST' }); } catch (error) { setStatus(error.message || String(error), 'error'); return; }
  toggle.textContent = 'Start Hand';
  toggle.dataset.running = 'false';
  setStatus('runtime stopped');
}

toggle.addEventListener('click', async () => {
  toggle.disabled = true;
  try { if (running) await stop(); else await start(); }
  catch (error) { setStatus(error.message || String(error), 'error'); }
  finally { toggle.disabled = false; }
});

window.addEventListener('beforeunload', () => {
  clearTimeout(fingerJuiceWarmupTimer);
  stateAbortController?.abort();
  stream?.getTracks().forEach(track => track.stop());
  if (unflushedLatencySamples.length) {
    navigator.sendBeacon?.(`${runtimeUrl}/viewer-latency-samples`, new Blob([JSON.stringify({
      schema: 'hand-state.viewer-latency-batch.v0',
      samples: unflushedLatencySamples,
    })], { type: 'application/json' }));
  }
  if (running) navigator.sendBeacon?.(`${runtimeUrl}/sidecar/stop`, new Blob([], { type: 'application/octet-stream' }));
});

function resize() {
  const width = Math.max(window.innerWidth, 1);
  const height = Math.max(window.innerHeight, 1);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animate(now) {
  requestAnimationFrame(animate);
  animationFrameCount += 1;
  if (handMesh.visible && now - lastLiveAt > 1200 && !fixtureMode) handMaterial.emissiveIntensity = 0;
  handMesh.rotation.y = Math.sin(now * 0.00022) * 0.08;
  let renderPromise = null;
  try {
    renderPromise = renderer.renderAsync(scene, camera);
    handRenderFrameCount += 1;
  } catch (error) {
    lastBenchmarkError = error.message || String(error);
  }
  if (running && fingerJuiceSolver && fingerJuiceRenderer) {
    const dt = fingerJuiceLastStepAt ? Math.min(1 / 30, Math.max(1 / 120, (now - fingerJuiceLastStepAt) / 1000)) : 1 / 60;
    fingerJuiceLastStepAt = now;
    if (!fingerJuiceStepPromise) {
      try {
        fingerJuiceStepPromise = Promise.resolve(fingerJuiceSolver.step(1, dt))
          .catch(error => { fingerJuiceError = error.message || String(error); })
          .finally(() => { fingerJuiceStepPromise = null; });
      } catch (error) {
        fingerJuiceError = error.message || String(error);
        fingerJuiceStepPromise = null;
      }
    }
    try {
      fingerJuiceRenderAttemptCount += 1;
      fingerJuiceRenderer.render({
        width: window.innerWidth,
        height: window.innerHeight,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 1) * 0.72,
        yaw: LIVE_FLUID_CAMERA.yaw,
        pitch: LIVE_FLUID_CAMERA.pitch,
        distance: LIVE_FLUID_CAMERA.distance,
        target: LIVE_FLUID_CAMERA.target,
        rendererMode: 'screen_space_refraction',
      });
    } catch (error) {
      fingerJuiceError = error.message || String(error);
    }
  }
  if (pendingLatencySample) {
    const sample = pendingLatencySample;
    pendingLatencySample = null;
    Promise.resolve(renderPromise).then(() => {
      sample.captureToRenderCompleteMs = Math.max(0, Date.now() - sample.captureTimestampMs);
      latencySamples.push(sample);
      unflushedLatencySamples.push(sample);
      scheduleLatencyFlush();
    }).catch(error => { lastBenchmarkError = error.message || String(error); });
  }
}

window.__kaminosHandStateLatencyBenchmark = () => ({
  benchmarkSessionId,
  droppedBeforeRender: benchmarkDroppedBeforeRender,
  lastError: lastBenchmarkError,
  report: latencySamples.length ? summarizeLatencySamples(latencySamples) : null,
});

window.__kaminosHandStateInitFingerJuice = ensureFingerJuice;
window.__kaminosHandStateProbeFingerJuice = probeFingerJuice;
window.__kaminosHandStateFixtureEmitterPacket = fixtureEmitterPacket;

function fingerJuiceDebugState() {
  const fluid = fingerJuiceSolver?.getDebugState?.() || null;
  return {
    solverBackend: fingerJuiceSolver?.solver_backend || (fingerJuiceInitPromise ? 'initializing' : 'stopped'),
    renderBackend: fingerJuiceSolver?.render_backend || null,
    solverRoute: fluid?.solverRoute || null,
    runtimeProfile: fluid?.runtimeProfile || null,
    runtimeCapabilities: fluid?.runtimeCapabilities || null,
    initialization: fluid?.initialization || null,
    requestedRenderer: fluid?.requestedRenderer || null,
    effectiveRenderer: fluid?.effectiveRenderer || null,
    truthScene: fluid?.truthScene || null,
    directRenderFrameCount: fluid?.directRenderFrameCount || 0,
    screenSpaceRefractionRenderFrameCount: fluid?.screenSpaceRefractionRenderFrameCount || 0,
    screenSpaceSurfaceAccumulationPassCount: fluid?.screenSpaceSurfaceAccumulationPassCount || 0,
    screenSpaceRefractionCompositePassCount: fluid?.screenSpaceRefractionCompositePassCount || 0,
    liveInletContract: fluid?.liveInletContract || null,
    liveInlets: fluid?.liveInlets || null,
    activeEmitterCount: fingerJuicePacket.active_emitter_count || 0,
    adapterContract: fingerJuicePacket.route_identity || null,
    emissionStates: fingerJuicePacket.emitters?.map(emitter => ({ id: emitter.id, state: emitter.emission_state, extension: emitter.extension })) || [],
    error: fingerJuiceError,
  };
}

window.__kaminosHandStateDebugState = () => ({
  schema: 'kaminos.hand-state-runtime-viewer.v0',
  runtimeOwner: 'hand-state-runtime',
  runtimeUrl,
  fixtureMode,
  running,
  meshVisible: handMesh.visible,
  vertexCount: handGeometry.getAttribute('position')?.count || 0,
  faceCount: handGeometry.index ? handGeometry.index.count / 3 : 0,
  status: status.textContent,
  benchmarkSessionId,
  benchmarkSampleCount: latencySamples.length,
  benchmarkDroppedBeforeRender,
  benchmarkError: lastBenchmarkError,
  eventSequence: lastStateSequence,
  stateDeliveryMode: 'long_poll',
  manoOrientationContract: MANO_DISPLAY_ORIENTATION_CONTRACT,
  animationFrameCount,
  handRenderFrameCount,
  fingerJuiceRenderAttemptCount,
  fingerJuice: fingerJuiceDebugState(),
});

resize();
resetLatencyBenchmark();
window.addEventListener('resize', resize);
if (fixtureMode) {
  fetch('./tests/fixtures/wilor-mano-surface.json', { cache: 'no-store' })
    .then(response => {
      if (!response.ok) throw new Error(`recorded WiLoR MANO fixture returned ${response.status}`);
      return response.json();
    })
    .then(fixture => {
      if (fixture.schema !== 'hand-state.wilor-mano-surface-fixture.v0' || !updateHandSurface(fixture.mano)) {
        throw new Error('recorded WiLoR MANO fixture is invalid');
      }
      setStatus('recorded WiLoR MANO surface / visual witness only');
    })
    .catch(error => setStatus(error.message || String(error), 'error'));
}
requestAnimationFrame(animate);
