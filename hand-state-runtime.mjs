import * as THREE from 'three';
import { summarizeLatencySamples } from './hand-state-latency-benchmark.mjs';

const params = new URLSearchParams(window.location.search);
const runtimeUrl = params.get('runtime_url') || 'http://127.0.0.1:8766';
const fixtureMode = params.get('fixture') === '1';
const maxAgeMs = 750;
const captureIntervalMs = 80;

const canvas = document.getElementById('hand-canvas');
const video = document.getElementById('camera');
const captureCanvas = document.getElementById('capture-canvas');
const captureContext = captureCanvas.getContext('2d', { alpha: false });
const toggle = document.getElementById('hand-toggle');
const status = document.getElementById('status');

const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x07090b, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(33, 1, 0.01, 30);
camera.position.set(0, 0.05, 3.8);

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
let stateTimer = null;
let faceSignature = '';
let smoothedPositions = null;
let lastLiveAt = 0;
let frameSequence = 0;
let benchmarkSessionId = '';
let pendingLatencySample = null;
let benchmarkDroppedBeforeRender = 0;
let lastBenchmarkError = null;
const captureMetricsByFrame = new Map();
const latencySamples = [];

function resetLatencyBenchmark() {
  benchmarkSessionId = globalThis.crypto?.randomUUID?.() || `hand-${Date.now()}`;
  pendingLatencySample = null;
  benchmarkDroppedBeforeRender = 0;
  lastBenchmarkError = null;
  captureMetricsByFrame.clear();
  latencySamples.length = 0;
}

function setStatus(message, state = 'idle') {
  status.textContent = message;
  status.dataset.state = state;
}

function parseVertex(vertex) {
  if (Array.isArray(vertex)) return [Number(vertex[0]), Number(vertex[1]), Number(vertex[2])];
  return [Number(vertex?.x), Number(vertex?.y), Number(vertex?.z)];
}

function normalizedPositions(vertices) {
  const points = vertices.map(parseVertex).filter(point => point.every(Number.isFinite));
  if (!points.length) return null;
  const center = [0, 0, 0];
  for (const point of points) {
    center[0] += point[0];
    center[1] += point[1];
    center[2] += point[2];
  }
  center[0] /= points.length;
  center[1] /= points.length;
  center[2] /= points.length;
  let radius = 0;
  for (const point of points) radius = Math.max(radius, Math.hypot(point[0] - center[0], point[1] - center[1], point[2] - center[2]));
  const scale = 1.05 / Math.max(radius, 1e-5);
  const normalized = new Float32Array(points.length * 3);
  points.forEach((point, index) => {
    normalized[index * 3] = -(point[0] - center[0]) * scale;
    normalized[index * 3 + 1] = (point[1] - center[1]) * scale;
    normalized[index * 3 + 2] = (point[2] - center[2]) * scale;
  });
  return normalized;
}

function updateHandSurface(mano) {
  if (!mano?.available || !Array.isArray(mano.vertices) || !Array.isArray(mano.faces)) return false;
  const target = normalizedPositions(mano.vertices);
  if (!target) return false;
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

async function runtimeFetch(path, options = {}) {
  const response = await fetch(`${runtimeUrl}${path}`, { cache: 'no-store', ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `${path} returned ${response.status}`);
  return payload;
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

async function pollState() {
  if (!running) return;
  try {
    const state = await runtimeFetch(`/state?max_age_ms=${maxAgeMs}`);
    const frame = state.frame;
    if (frame?.authority?.sourceAuthority === 'live_simulation' && updateHandSurface(frame.mano)) {
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
      setStatus(`live MANO / ${frame.mano.vertexCount} vertices${Number.isFinite(latency) ? ` / ${latency.toFixed(0)} ms receipt` : ''}`, 'live');
    } else {
      setStatus(`waiting for live MANO / ${frame?.authority?.fallbackReason || 'no frame'}`);
    }
  } catch (error) {
    setStatus(error.message || String(error), 'error');
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
  running = true;
  toggle.textContent = 'Stop Hand';
  toggle.dataset.running = 'true';
  captureTimer = setInterval(captureFrame, captureIntervalMs);
  stateTimer = setInterval(pollState, 40);
  await captureFrame();
  await pollState();
}

async function stop() {
  running = false;
  clearInterval(captureTimer);
  clearInterval(stateTimer);
  captureTimer = null;
  stateTimer = null;
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  video.srcObject = null;
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
  stream?.getTracks().forEach(track => track.stop());
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
  if (handMesh.visible && now - lastLiveAt > 1200 && !fixtureMode) handMaterial.emissiveIntensity = 0;
  handMesh.rotation.y = Math.sin(now * 0.00022) * 0.08;
  const renderPromise = renderer.renderAsync(scene, camera);
  if (pendingLatencySample) {
    const sample = pendingLatencySample;
    pendingLatencySample = null;
    Promise.resolve(renderPromise).then(() => {
      sample.captureToRenderCompleteMs = Math.max(0, Date.now() - sample.captureTimestampMs);
      latencySamples.push(sample);
      runtimeFetch('/viewer-latency-sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sample),
      }).catch(error => { lastBenchmarkError = error.message || String(error); });
    }).catch(error => { lastBenchmarkError = error.message || String(error); });
  }
  requestAnimationFrame(animate);
}

window.__kaminosHandStateLatencyBenchmark = () => ({
  benchmarkSessionId,
  droppedBeforeRender: benchmarkDroppedBeforeRender,
  lastError: lastBenchmarkError,
  report: latencySamples.length ? summarizeLatencySamples(latencySamples) : null,
});

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
