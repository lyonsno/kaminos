import {
  AmbientLight, BufferGeometry, Color, DirectionalLight, Float32BufferAttribute,
  GridHelper, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene,
  Uint32BufferAttribute, Vector3, WebGPURenderer,
} from './lib/three.webgpu.js';
import { createSf3dProducer, decodeSf3dPreviewMesh } from './lib/sf3d/sf3d-learn-producer.js';
import { featurePixels, similarityColor } from './sf3d-learn-features.mjs';

const $ = id => document.getElementById(id);
const source = $('learn-source');
const input = $('learn-file');
const runButton = $('learn-run');
const unloadButton = $('learn-unload');
const reloadButton = $('learn-reload');
const resolutionSelect = $('learn-resolution');
const status = $('learn-status');
const progress = $('learn-progress');
const download = $('learn-download');
const errorBox = $('learn-error');
const viewer = $('learn-viewer');
const stageIds = ['encoder', 'block-0-fuse-out', 'block-1-fuse-out', 'final', 'export'];
const featurePanel = $('learn-features');
const featureCanvas = $('learn-feature-map');
const featureContext = featureCanvas.getContext('2d');
const scalePixels = new Uint8ClampedArray(256 * 4);
for (let i = 0; i < 256; i++) scalePixels.set([...similarityColor(i / 255), 255], i * 4);
$('learn-feature-scale').getContext('2d').putImageData(new ImageData(scalePixels, 256, 1), 0, 0);

function setStatus(message) {
  status.textContent = message;
  if (!mesh) $('learn-view-empty').textContent = message;
}

let producer = null;
let mesh = null;
let inputUrl = null;
let outputUrl = null;
let running = false;
let embeddedActive = true;
let releasePromise = null;
let releaseFailure = null;
let selectionToken = 0;
let selectionPending = false;
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
const constructionPlane = new GridHelper(1.74, 8, '#367e8c', '#7ab6be');
constructionPlane.rotation.x = Math.PI / 2;
constructionPlane.visible = false;
scene.add(constructionPlane);

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
  featurePanel.hidden = true;
  $('learn-view-empty').hidden = true;
  $('learn-view-label').textContent = label;
  $('learn-mesh-count').textContent = `${vertices.length / 3} vertices / ${faces.length / 3} faces`;
  return requestPaint();
}

function clearGeometry() {
  constructionPlane.visible = false;
  if (mesh) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    mesh = null;
  }
  $('learn-view-empty').hidden = false;
  $('learn-view-label').textContent = 'Awaiting first shape';
  $('learn-mesh-count').textContent = 'No geometry yet';
  void requestPaint().catch(showRenderError);
}

function markStage(stageId, state, elapsedMs = null) {
  const row = document.querySelector(`#learn-stages [data-stage="${stageId}"]`);
  row.dataset.state = state;
  row.querySelector('.stage-time').textContent = elapsedMs == null ? (state === 'skipped' ? 'Unavailable' : 'Waiting') : `${(elapsedMs / 1000).toFixed(1)}s`;
  progress.value = document.querySelectorAll('#learn-stages [data-state="done"]').length;
}

function resetStages() {
  clearGeometry();
  featurePanel.hidden = true;
  featureCanvas.dataset.block = '';
  featureContext.clearRect(0, 0, featureCanvas.width, featureCanvas.height);
  $('learn-feature-source').src = source.src;
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
  if (running || !producer || releasePromise || releaseFailure) return;
  const oldProducer = producer;
  unloadButton.disabled = true;
  runButton.disabled = true;
  try {
    releasePromise = oldProducer.dispose().completion;
    await releasePromise;
    producer = null;
    setStatus(mesh ? 'Mesh retained; model released' : 'Model released');
  } catch (error) {
    releaseFailure = error;
    errorBox.textContent = `Model release failed: ${error?.message || error}. Reload this page before generating again.`;
    errorBox.hidden = false;
    setStatus('Model release failed');
    reloadButton.hidden = false;
  } finally {
    releasePromise = null;
    runButton.disabled = !!releaseFailure || running || selectionPending;
  }
}

unloadButton.addEventListener('click', () => { void releaseModel(); });
reloadButton.addEventListener('click', () => location.reload());
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== 'kaminos-learn-active') return;
  embeddedActive = event.data.active === true;
  if (embeddedActive) void requestPaint().catch(showRenderError);
  else if (!running) void releaseModel();
});

input.addEventListener('change', async () => {
  const file = input.files?.[0];
  if (!file || running) return;
  selectionToken += 1;
  const thisSelection = selectionToken;
  selectionPending = true;
  input.disabled = true;
  runButton.disabled = true;
  const nextUrl = URL.createObjectURL(file);
  const probe = new Image();
  probe.src = nextUrl;
  try {
    await probe.decode();
    if (thisSelection !== selectionToken) { URL.revokeObjectURL(nextUrl); return; }
    const oldUrl = inputUrl;
    source.src = nextUrl;
    await source.decode();
    if (thisSelection !== selectionToken) { URL.revokeObjectURL(nextUrl); return; }
    inputUrl = nextUrl;
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    $('learn-source-name').textContent = file.name;
    setStatus('Image loaded');
    errorBox.hidden = true;
  } catch {
    URL.revokeObjectURL(nextUrl);
    if (thisSelection !== selectionToken) return;
    source.src = inputUrl || './fixtures/sf3d-demo-chair.png';
    errorBox.textContent = 'This image could not be opened.';
    errorBox.hidden = false;
  } finally {
    if (thisSelection === selectionToken) {
      selectionPending = false;
      input.disabled = false;
      runButton.disabled = !!releaseFailure || !!releasePromise || running;
    }
  }
});

runButton.addEventListener('click', async () => {
  if (running || releaseFailure || selectionPending || releasePromise) return;
  running = true;
  publishRunState();
  runButton.disabled = true;
  unloadButton.disabled = true;
  input.disabled = true;
  resolutionSelect.disabled = true;
  resetStages();
  if (matchMedia('(max-width: 760px)').matches) viewer.scrollIntoView({ behavior: 'instant', block: 'start' });
  const started = performance.now();
  const resolution = Number(resolutionSelect.value);
  try {
    const viewerError = await viewerInitialization;
    if (viewerError) throw viewerError;
    if (releasePromise) await releasePromise;
    if (!producer) {
      setStatus('Loading SF3D model');
      producer = await createSf3dProducer({
        weightsUrl: './lib/sf3d/weights.bin',
        onWeightsProgress: (received, total) => {
          setStatus(total ? `Loading SF3D model ${Math.round(received / total * 100)}%` : 'Loading SF3D model');
        },
      });
    }
    await source.decode();
    setStatus('Inferring shape');
    const result = await producer.run(source, {
      runId: `learn-${Date.now()}`,
      onProgress: message => { setStatus(String(message)); },
      routeOverrides: {
        cooperativeDino: true,
        dinoChunkBlocks: 1,
        onEncoderFeatures: async sample => {
          const { pixels, min } = featurePixels(sample.values, sample.width, sample.height);
          featureCanvas.width = sample.width;
          featureCanvas.height = sample.height;
          featureContext.putImageData(new ImageData(pixels, sample.width, sample.height), 0, 0);
          featureCanvas.dataset.block = String(sample.completedBlocks);
          $('learn-feature-step').textContent = `Block ${sample.completedBlocks} / ${sample.totalBlocks}`;
          $('learn-feature-min').textContent = min.toFixed(2);
          $('learn-feature-time').textContent = `${((performance.now() - started) / 1000).toFixed(1)}s`;
          featurePanel.hidden = false;
          $('learn-view-empty').hidden = true;
          const encoded = sample.completedBlocks === sample.totalBlocks;
          $('learn-view-label').textContent = encoded ? 'Image encoded; forming geometry' : 'Encoding image';
          if (encoded) markStage('encoder', 'done', performance.now() - started);
          else {
            const row = document.querySelector('[data-stage="encoder"]');
            row.dataset.state = 'active';
            row.querySelector('.stage-time').textContent = `${sample.completedBlocks}/${sample.totalBlocks}`;
            progress.value = sample.completedBlocks / sample.totalBlocks;
          }
          window.dispatchEvent(new CustomEvent('sf3d-learn-observation', { detail: {
            kind: 'encoder', ...sample, values: Array.from(sample.values), atMs: performance.now() - started,
          } }));
        },
        onMeshExtracted: async ({ vertices, faces }) => {
          await replaceGeometry(vertices, faces, 'Final mesh');
          markStage('final', 'done', performance.now() - started);
          setStatus('Shape complete; finishing materials and texture');
          window.dispatchEvent(new CustomEvent('sf3d-learn-observation', { detail: {
            kind: 'mesh', numVertices: vertices.length / 3, numFaces: faces.length / 3, atMs: performance.now() - started,
          } }));
        },
        onObservationError: ({ stageId, error }) => {
          if (stageId.startsWith('dino-')) markStage('encoder', 'skipped');
          console.warn('SF3D Learn observation unavailable', stageId, error);
        },
        cooperativeTwoStream: true,
        twoStreamDutyGranularity: 'stage',
        intermediateStageIds: ['block-0-fuse-out', 'block-1-fuse-out'],
        intermediateSpatialRows: 16,
        onIntermediatePreviewError: ({ stageId, error }) => {
          markStage(stageId, 'skipped');
          setStatus(`${stageId} preview unavailable`);
          console.warn('SF3D Learn projection failed', error);
        },
        onIntermediateTriplane: async ({ stageId, triplanesBuf, decoder, decoderWeights, produceRegions }) => {
          const label = stageId === 'block-0-fuse-out' ? 'First shape' : 'Forming detail';
          let revealed = false;
          const retainedLabel = !featurePanel.hidden ? 'Showing image features' : mesh ? 'Showing preceding shape' : null;
          try {
            constructionPlane.visible = false;
            if (retainedLabel) $('learn-view-label').textContent = `${retainedLabel}; preparing next surface`;
            await requestPaint();
            const candidate = await decodeSf3dPreviewMesh(producer.device, triplanesBuf, decoder, decoderWeights, resolution, 384, {
              produceRegions,
              onSlab: async sample => {
                const retaining = !revealed && !!retainedLabel && !sample.mesh.numFaces;
                constructionPlane.visible = !retaining;
                constructionPlane.position.z = sample.maxZ;
                const fraction = sample.completedSamples / sample.totalSamples;
                const row = document.querySelector(`[data-stage="${stageId}"]`);
                row.dataset.state = 'active';
                row.querySelector('.stage-time').textContent = `${Math.round(fraction * 100)}%`;
                progress.value = document.querySelectorAll('#learn-stages [data-state="done"]').length + fraction;
                setStatus(`${label}: decoding spatial layer ${sample.completedLayers} / ${sample.totalLayers}`);
                if (sample.mesh.numFaces) {
                  revealed = true;
                  await replaceGeometry(sample.mesh.vertices, sample.mesh.faces, `${label}: building surface`);
                }
                else if (retaining) await requestPaint();
                else {
                  $('learn-view-label').textContent = `${label}: sampling space`;
                  $('learn-view-empty').hidden = true;
                  await requestPaint();
                }
                window.dispatchEvent(new CustomEvent('sf3d-learn-observation', { detail: {
                  kind: 'construction', stageId, completedLayers: sample.completedLayers, totalLayers: sample.totalLayers,
                  completedSamples: sample.completedSamples, totalSamples: sample.totalSamples, maxZ: sample.maxZ,
                  numVertices: sample.mesh.numVertices, numFaces: sample.mesh.numFaces, atMs: performance.now() - started,
                  vertices: Array.from(sample.mesh.vertices), faces: Array.from(sample.mesh.faces),
                } }));
              },
            });
            constructionPlane.visible = false;
            await replaceGeometry(candidate.mesh.vertices, candidate.mesh.faces, label);
            markStage(stageId, 'done', performance.now() - started);
            window.dispatchEvent(new CustomEvent('sf3d-learn-observation', { detail: {
              kind: 'construction-complete', stageId, metrics: candidate.metrics, atMs: performance.now() - started,
            } }));
            setStatus(label);
          } catch (previewError) {
            constructionPlane.visible = false;
            $('learn-view-label').textContent = !revealed && retainedLabel
              ? `${retainedLabel}; next preview unavailable` : `${label}: preview incomplete`;
            void requestPaint().catch(showRenderError);
            markStage(stageId, 'skipped');
            setStatus(`${stageId} preview unavailable`);
            console.warn('SF3D Learn preview failed', previewError);
          }
        },
      },
    });
    if (document.querySelector('[data-stage="final"]').dataset.state !== 'done') {
      await replaceGeometry(result.vertices, result.faces, 'Final mesh');
      markStage('final', 'done', performance.now() - started);
    }
    markStage('export', 'done', performance.now() - started);
    setStatus('Textured mesh complete');
    outputUrl = URL.createObjectURL(new Blob([result.glb], { type: 'model/gltf-binary' }));
    download.href = outputUrl;
    download.hidden = false;
  } catch (error) {
    errorBox.textContent = error?.message || String(error);
    errorBox.hidden = false;
    setStatus('Generation stopped');
  } finally {
    running = false;
    publishRunState();
    runButton.disabled = !!releaseFailure || !!releasePromise || selectionPending;
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
