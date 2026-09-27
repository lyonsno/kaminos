import {
  AmbientLight, BufferGeometry, Color, DirectionalLight, Float32BufferAttribute,
  GridHelper, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene,
  Uint32BufferAttribute, Vector3, WebGPURenderer,
} from './lib/three.webgpu.js';
import { createSf3dProducer, decodeSf3dPreviewMesh } from './lib/sf3d/sf3d-learn-producer.js';

const $ = id => document.getElementById(id);
const source = $('learn-source');
const input = $('learn-file');
const runButton = $('learn-run');
const unloadButton = $('learn-unload');
const resolutionSelect = $('learn-resolution');
const status = $('learn-status');
const progress = $('learn-progress');
const download = $('learn-download');
const errorBox = $('learn-error');
const viewer = $('learn-viewer');
const stageIds = ['block-0-fuse-out', 'block-1-fuse-out', 'final'];

let producer = null;
let mesh = null;
let inputUrl = null;
let outputUrl = null;
let running = false;
let embeddedActive = true;
let releasePromise = null;
let renderer = null;
let viewerInitialized = false;
let paintPending = null;

function showRenderError(error) {
  errorBox.textContent = `3D viewer unavailable: ${error?.message || error}`;
  errorBox.hidden = false;
}

function requestPaint() {
  if (!viewerInitialized || !embeddedActive) return Promise.resolve();
  if (!paintPending) {
    paintPending = new Promise((resolve, reject) => requestAnimationFrame(async () => {
      try { await renderer.renderAsync(scene, camera); resolve(); }
      catch (error) { reject(error); }
      finally { paintPending = null; }
    }));
  }
  return paintPending;
}

const scene = new Scene();
scene.background = new Color('#e9eeea');
const camera = new PerspectiveCamera(38, 1, 0.1, 50);
camera.up.set(0, 0, 1);
scene.add(new AmbientLight('#ffffff', 1.8));
const key = new DirectionalLight('#fff6e4', 3.2);
key.position.set(2, -3, 5);
scene.add(key);
const fill = new DirectionalLight('#9fc7d5', 1.1);
fill.position.set(-3, 2, 2);
scene.add(fill);
const grid = new GridHelper(4, 12, '#9bb9aa', '#c5d6cb');
grid.rotation.x = Math.PI / 2;
grid.position.z = -0.9;
scene.add(grid);

const target = new Vector3(0, 0, 0);
let yaw = -0.75;
let pitch = 0.32;
let distance = 3.4;
function placeCamera() {
  const cp = Math.cos(pitch);
  camera.position.set(target.x + distance * cp * Math.cos(yaw), target.y + distance * cp * Math.sin(yaw), target.z + distance * Math.sin(pitch));
  camera.lookAt(target);
  void requestPaint().catch(showRenderError);
}
placeCamera();

function resize() {
  if (!renderer) return;
  const width = Math.max(1, viewer.clientWidth);
  const height = Math.max(1, viewer.clientHeight);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  void requestPaint().catch(showRenderError);
}

async function initViewer() {
  renderer = new WebGPURenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  viewer.append(renderer.domElement);
  await renderer.init();
  viewerInitialized = true;
  resize();
  new ResizeObserver(resize).observe(viewer);
  void requestPaint().catch(showRenderError);
}

let drag = null;
viewer.addEventListener('pointerdown', event => {
  drag = { x: event.clientX, y: event.clientY, yaw, pitch };
  viewer.setPointerCapture(event.pointerId);
});
viewer.addEventListener('pointermove', event => {
  if (!drag) return;
  yaw = drag.yaw - (event.clientX - drag.x) * 0.008;
  pitch = Math.max(-1.25, Math.min(1.25, drag.pitch + (event.clientY - drag.y) * 0.008));
  placeCamera();
});
viewer.addEventListener('pointerup', () => { drag = null; });
viewer.addEventListener('pointercancel', () => { drag = null; });
viewer.addEventListener('wheel', event => {
  event.preventDefault();
  distance = Math.max(1.2, Math.min(8, distance * Math.exp(event.deltaY * 0.001)));
  placeCamera();
}, { passive: false });

function replaceGeometry(vertices, faces, label) {
  if (!vertices?.length || !faces?.length || vertices.length % 3 || faces.length % 3) {
    throw new Error(`${label} has no usable mesh`);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(new Uint32BufferAttribute(faces, 1));
  geometry.computeVertexNormals();
  if (mesh) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  mesh = new Mesh(geometry, new MeshStandardMaterial({ color: label === 'Final mesh' ? '#79b998' : '#7c9eb0', metalness: 0.08, roughness: 0.72, side: 2 }));
  scene.add(mesh);
  $('learn-view-empty').hidden = true;
  $('learn-view-label').textContent = label;
  $('learn-mesh-count').textContent = `${vertices.length / 3} vertices / ${faces.length / 3} faces`;
  return requestPaint();
}

function markStage(stageId, state, elapsedMs = null) {
  const row = document.querySelector(`#learn-stages [data-stage="${stageId}"]`);
  row.dataset.state = state;
  row.querySelector('.stage-time').textContent = elapsedMs == null ? (state === 'skipped' ? 'Unavailable' : 'Waiting') : `${(elapsedMs / 1000).toFixed(1)}s`;
  progress.value = document.querySelectorAll('#learn-stages [data-state="done"]').length;
}

function resetStages() {
  for (const id of stageIds) markStage(id, 'waiting');
  progress.value = 0;
  errorBox.hidden = true;
  download.hidden = true;
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = null;
}

function publishRunState() {
  if (window.parent !== window) window.parent.postMessage({ type: 'kaminos-learn-run-state', running }, location.origin);
}

async function releaseModel() {
  if (running || !producer) return;
  const oldProducer = producer;
  producer = null;
  unloadButton.disabled = true;
  releasePromise = oldProducer.dispose().completion;
  try {
    await releasePromise;
    status.textContent = mesh ? 'Mesh retained; model released' : 'Model released';
  } catch (error) {
    errorBox.textContent = `Model release failed: ${error?.message || error}`;
    errorBox.hidden = false;
  } finally {
    releasePromise = null;
  }
}

unloadButton.addEventListener('click', () => { void releaseModel(); });
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== 'kaminos-learn-active') return;
  embeddedActive = event.data.active === true;
  if (embeddedActive) void requestPaint().catch(showRenderError);
  else if (!running) void releaseModel();
});

input.addEventListener('change', async () => {
  const file = input.files?.[0];
  if (!file || running) return;
  const nextUrl = URL.createObjectURL(file);
  const oldUrl = inputUrl;
  source.src = nextUrl;
  try {
    await source.decode();
    inputUrl = nextUrl;
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    $('learn-source-name').textContent = file.name;
    status.textContent = 'Image loaded';
  } catch {
    URL.revokeObjectURL(nextUrl);
    source.src = oldUrl || './fixtures/sf3d-demo-chair.png';
    errorBox.textContent = 'This image could not be opened.';
    errorBox.hidden = false;
  }
});

runButton.addEventListener('click', async () => {
  if (running) return;
  running = true;
  publishRunState();
  runButton.disabled = true;
  unloadButton.disabled = true;
  input.disabled = true;
  resolutionSelect.disabled = true;
  resetStages();
  const started = performance.now();
  const resolution = Number(resolutionSelect.value);
  try {
    const viewerError = await viewerInitialization;
    if (viewerError) throw viewerError;
    if (releasePromise) await releasePromise;
    if (!producer) {
      status.textContent = 'Loading SF3D model';
      producer = await createSf3dProducer({
        weightsUrl: './lib/sf3d/weights.bin',
        onWeightsProgress: (received, total) => {
          status.textContent = total ? `Loading SF3D model ${Math.round(received / total * 100)}%` : 'Loading SF3D model';
        },
      });
    }
    await source.decode();
    status.textContent = 'Inferring shape';
    const result = await producer.run(source, {
      runId: `learn-${Date.now()}`,
      onProgress: message => { status.textContent = String(message); },
      routeOverrides: {
        cooperativeTwoStream: true,
        twoStreamDutyGranularity: 'stage',
        intermediateStageIds: ['block-0-fuse-out', 'block-1-fuse-out'],
        onIntermediatePreviewError: ({ stageId, error }) => {
          markStage(stageId, 'skipped');
          status.textContent = `${stageId} preview unavailable`;
          console.warn('SF3D Learn projection failed', error);
        },
        onIntermediateTriplane: async ({ stageId, triplanesBuf, decoder, decoderWeights }) => {
          try {
            const candidate = await decodeSf3dPreviewMesh(producer.device, triplanesBuf, decoder, decoderWeights, resolution);
            const label = stageId === 'block-0-fuse-out' ? 'First shape' : 'Forming detail';
            await replaceGeometry(candidate.mesh.vertices, candidate.mesh.faces, label);
            markStage(stageId, 'done', performance.now() - started);
            status.textContent = label;
          } catch (previewError) {
            markStage(stageId, 'skipped');
            status.textContent = `${stageId} preview unavailable`;
            console.warn('SF3D Learn preview failed', previewError);
          }
        },
      },
    });
    await replaceGeometry(result.vertices, result.faces, 'Final mesh');
    markStage('final', 'done', performance.now() - started);
    status.textContent = 'Mesh complete';
    outputUrl = URL.createObjectURL(new Blob([result.glb], { type: 'model/gltf-binary' }));
    download.href = outputUrl;
    download.hidden = false;
  } catch (error) {
    errorBox.textContent = error?.message || String(error);
    errorBox.hidden = false;
    status.textContent = 'Generation stopped';
  } finally {
    running = false;
    publishRunState();
    runButton.disabled = false;
    input.disabled = false;
    resolutionSelect.disabled = false;
    if (!embeddedActive) await releaseModel();
    else unloadButton.disabled = !producer;
  }
});

const viewerInitialization = initViewer().then(() => null, error => {
  showRenderError(error);
  return error;
});
