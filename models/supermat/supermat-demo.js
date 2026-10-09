// SuperMat demo: one resident route on a kit session; choose or drop an image,
// or pass ?image_root=&image_path= (Kaminos /api/read) or ?image=<url>.
// Weights default to /scratch/supermat-weights/f32/ (override with ?weights=).
import { createWebGpuInferenceSession } from '../../webgpu-inference-kit/src/core.js';
import { createSuperMatAdapter, SUPERMAT_ROUTE_ID } from './supermat-route.js';
import { decodeImageRgba } from './supermat-image.js';
import { compositeOnGray, resizeRgbaBilinear } from './supermat-preprocess.js';

const params = new URLSearchParams(location.search);
const weightsUrl = params.get('weights') ?? '/scratch/supermat-weights/f32/';
const imageUrl = params.get('image_root') && params.get('image_path')
  ? `/api/read?${new URLSearchParams({ root: params.get('image_root'), path: params.get('image_path') })}`
  : params.get('image');
const state = window.__supermatDemo = { status: 'loading', error: null, runs: [], identity: null, imageSource: null };
const $ = id => document.getElementById(id);
let adapter, device, current = null, lastResult = null;

function setStatus(text, isError = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', isError);
}

function fail(error) {
  state.status = 'error';
  state.error = `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`;
  setStatus(state.error, true);
  $('run').disabled = !current;
}

function draw(id, map, alpha) {
  const canvas = $(id);
  canvas.width = map.width;
  canvas.height = map.height;
  const data = new Uint8ClampedArray(map.data);
  if (alpha) for (let i = 0; i < alpha.length; i++) data[i * 4 + 3] = alpha[i];
  canvas.getContext('2d').putImageData(new ImageData(data, map.width, map.height), 0, 0);
}

function drawModelInput(image) {
  const resized = resizeRgbaBilinear(image, 512, 512);
  const planes = compositeOnGray(resized), plane = 512 * 512;
  const data = new Uint8ClampedArray(plane * 4);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(planes[c * plane + i] * 255);
    data[i * 4 + 3] = 255;
  }
  draw('input', { width: 512, height: 512, data });
}

async function setDownload(id, map) {
  const canvas = new OffscreenCanvas(map.width, map.height);
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(map.data), map.width, map.height), 0, 0);
  const link = $(`${id}-link`);
  if (link.href) URL.revokeObjectURL(link.href);
  link.href = URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }));
  link.hidden = false;
}

function render() {
  if (!lastResult) return;
  const alpha = $('mask').checked ? lastResult.alpha : null;
  for (const name of ['albedo', 'roughness', 'metallic']) draw(name, lastResult.maps[name], alpha);
}

async function load(blob, label) {
  try {
    current = await decodeImageRgba(blob, device);
    state.imageSource = label;
    drawModelInput(current);
    await infer();
  } catch (error) { fail(error); }
}

async function infer() {
  if (!current || !adapter) return;
  $('run').disabled = true;
  state.status = 'running';
  setStatus(`Inferring materials (${current.width}×${current.height} → 512×512)…`);
  try {
    const started = performance.now();
    lastResult = await adapter.run({ image: current });
    const wallMs = performance.now() - started;
    state.runs.push({ wallMs, timings: lastResult.timings, run: lastResult.run });
    render();
    await Promise.all(['albedo', 'roughness', 'metallic'].map(name => setDownload(name, lastResult.maps[name])));
    const t = lastResult.timings;
    $('timings').textContent = [`run ${lastResult.run}: ${wallMs.toFixed(0)} ms wall`,
      `preprocess ${t.preprocessMs.toFixed(0)} ms · encode ${t.encodeMs.toFixed(0)} ms · unet ${t.unetMs.toFixed(0)} ms`
        + ` · decode albedo ${t.decodeAlbedoMs.toFixed(0)} ms · decode orm ${t.decodeOrmMs.toFixed(0)} ms`,
      `route ${adapter.identity.routeId} · backend ${adapter.identity.backend} · weights ${adapter.identity.weightDtype}`
        + ` · ${adapter.identity.revision}`].join('\n');
    state.status = 'done';
    setStatus(`Done in ${(wallMs / 1000).toFixed(2)} s. Drop another image or choose a file.`);
  } catch (error) { fail(error); }
  $('run').disabled = false;
}

$('file').addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (file) load(file, `file:${file.name}`);
});
$('run').addEventListener('click', infer);
$('mask').addEventListener('change', render);
const drop = $('drop');
drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', event => {
  event.preventDefault();
  drop.classList.remove('over');
  const file = event.dataTransfer.files?.[0];
  if (file) load(file, `drop:${file.name}`);
});

try {
  if (!navigator.gpu) throw new Error('WebGPU is not available in this browser');
  const session = await createWebGpuInferenceSession({ sessionId: crypto.randomUUID(), gpu: navigator.gpu,
    adapterName: 'supermat-demo' });
  const route = await session.registerRoute({ routeId: SUPERMAT_ROUTE_ID });
  device = route.runtime.device;
  adapter = await createSuperMatAdapter({ route, weightsUrl, onProgress(event) {
    if (event.phase === 'weights') {
      const mb = value => (value / 1e6).toFixed(0);
      setStatus(`Loading weights ${event.resourceIndex + 1}/${event.resourceCount} (${event.resourceId}`
        + `${event.totalBytes ? `, ${mb(event.loadedBytes)}/${mb(event.totalBytes)} MB` : ''})…`);
    }
  } });
  state.identity = adapter.identity;
  state.weightLoadMs = adapter.weightLoadMs;
  state.status = 'ready';
  setStatus(`Model resident (${(adapter.weightLoadMs / 1000).toFixed(1)} s load). Choose or drop an image.`);
  if (imageUrl) {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`image ${imageUrl}: HTTP ${response.status}`);
    await load(await response.blob(), imageUrl);
  }
} catch (error) { fail(error); }
