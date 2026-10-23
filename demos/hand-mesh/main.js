import { WebGPURenderer, Scene, PerspectiveCamera, Mesh, BufferGeometry, BufferAttribute, MeshNormalMaterial, DoubleSide } from '../../lib/three.webgpu.js';
import { createWebGpuInferenceSession } from '../../webgpu-inference-kit/src/core.js';
import { createBrowserHandMeshRoute } from '../../models/mobrecon/hand-mesh-route.js';
import { readLocalModels, createModelStore } from './model-files.js';

const $ = id => document.getElementById(id);
const video = $('camera'), view = $('viewer'), store = createModelStore(indexedDB);
let renderer, scene, camera, mesh, route, session;
let stream = null, running = false, starting = false, loading = false, ticket = 0, callback, flight = null, disposed = false;
let received = 0, misses = 0, last = null, error = null, source = null, presentation = 'camera-off';
const status = text => { $('status').textContent = text; };
const draw = () => { if (renderer && !disposed) renderer.render(scene, camera); };
function empty(text, state = 'camera-off') {
  if (mesh) mesh.visible = false;
  $('empty').hidden = false; $('empty-text').textContent = text;
  presentation = state;
  $('presence').textContent = state === 'no-hand' ? 'NO HAND DETECTED' : 'CAMERA OFF';
  $('presence').dataset.active = 'false'; draw();
}
function buttons() {
  $('start').disabled = !route || loading || disposed;
  $('start').textContent = running ? 'Stop camera' : starting ? 'Cancel camera' : 'Start camera';
  $('choose').disabled = loading || disposed;
}
function frame() { camera.position.set(0, 0, 3.8); camera.lookAt(0, 0, 0); draw(); }
function present(result) {
  const vertices = result.verticesMeters, n = vertices.length / 3, center = [0, 0, 0];
  for (let i = 0; i < vertices.length; i++) center[i % 3] += vertices[i] / n;
  const positions = mesh.geometry.attributes.position.array;
  for (let i = 0; i < vertices.length; i++) positions[i] = (vertices[i] - center[i % 3]) * (i % 3 === 1 ? -1 : 1);
  mesh.geometry.attributes.position.needsUpdate = true;
  mesh.geometry.computeVertexNormals(); mesh.geometry.computeBoundingSphere(); mesh.visible = true;
  $('empty').hidden = true; $('presence').textContent = 'HAND DETECTED'; $('presence').dataset.active = 'true';
  presentation = 'hand'; draw();
}
async function stop() {
  const current = ++ticket;
  running = false; starting = false;
  if (callback !== undefined) video.cancelVideoFrameCallback(callback);
  stream?.getTracks().forEach(track => track.stop()); stream = null; video.srcObject = null;
  empty('Your hand will appear here.'); buttons();
  if (flight) await flight.catch(() => {});
  if (current === ticket) status(route ? 'Camera stopped. Models stay loaded for next time.' : 'Choose your model folder to begin.');
}
function schedule(current) {
  if (!running || current !== ticket || disposed) return;
  callback = video.requestVideoFrameCallback(() => {
    if (!running || current !== ticket || disposed) return;
    flight = (async () => {
      const result = await route.infer({ source: video, width: video.videoWidth, height: video.videoHeight, handedness: $('hand').value,
        acquisition: { mode: 'detector', threshold: Number($('threshold').value), padding: 1.4, onMiss: 'skip' } });
      if (!running || current !== ticket || disposed) return;
      last = result;
      if (!result.hasHand) { misses++; empty('No hand detected. Bring your hand into view.', 'no-hand'); status('Looking for your hand…'); }
      else { received++; present(result); status('Move your fingers, then turn your hand.'); }
    })().catch(cause => {
      if (current !== ticket || disposed) return;
      error = String(cause?.message ?? cause);
      running = false; starting = false; ticket++;
      stream?.getTracks().forEach(track => track.stop()); stream = null; video.srcObject = null;
      empty('Camera stopped. Try again.'); status(error); buttons();
    }).finally(() => { flight = null; schedule(current); });
  });
}
async function start() {
  if (!route || running || starting || loading || disposed) return;
  const current = ++ticket;
  starting = true; error = null; buttons(); status('Waiting for camera permission…');
  try {
    const acquired = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    if (current !== ticket || disposed) { acquired.getTracks().forEach(track => track.stop()); return; }
    stream = acquired; video.srcObject = stream; await video.play();
    if (current !== ticket || disposed) return;
    running = true; received = 0; misses = 0; last = null;
    empty('Looking for your hand…', 'no-hand'); status('Looking for your hand…'); schedule(current);
  } catch (cause) {
    if (current === ticket && !disposed) {
      error = String(cause?.message ?? cause);
      stream?.getTracks().forEach(track => track.stop()); stream = null; video.srcObject = null;
      status(`Camera unavailable: ${error}`);
    }
  } finally { if (current === ticket) { starting = false; buttons(); } }
}
async function install(models, origin) {
  loading = true; buttons(); await stop();
  let nextSession, nextRoute;
  try {
    status('Loading models onto your GPU…');
    nextSession = await createWebGpuInferenceSession({ sessionId: crypto.randomUUID(), device: renderer.backend.device, adapter: renderer.backend.adapter, adapterName: renderer.backend.adapter?.info?.description || 'Kaminos hand viewer WebGPU device', deviceOwnership: 'borrowed' });
    nextRoute = await createBrowserHandMeshRoute({ session: nextSession, mobreconPackageSource: models.mobrecon, detectorPackageSource: models.detector,
      onProgress: event => status(`Loading ${event.model === 'mobrecon' ? 'hand reconstruction' : 'hand detection'}…`) });
    if (disposed) { nextRoute.release(); await nextSession.close(); return; }
    route?.release(); await session?.close();
    route = nextRoute; session = nextSession; source = origin; nextRoute = null; nextSession = null;
    mesh.geometry.setIndex(Array.from(route.faces)); mesh.geometry.computeBoundingSphere();
    $('frame').disabled = false;
    $('setup-title').textContent = 'Your models are loaded.';
    status('Models loaded. Start the camera when you’re set.');
    $('models-status').textContent = origin === 'browser-storage' ? 'Restored from this browser. Nothing downloaded.' : 'Loaded from your files. Nothing uploaded.';
    error = null;
  } catch (cause) {
    nextRoute?.release(); await nextSession?.close();
    error = String(cause?.message ?? cause); status(`Model load failed: ${error}`);
    throw cause;
  } finally { loading = false; buttons(); }
}
async function initialize() {
  if (!navigator.gpu) throw Error('This demo needs a WebGPU-capable browser. Try a recent Chrome or Edge.');
  renderer = new WebGPURenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio); await renderer.init();
  if (!renderer.backend.isWebGPUBackend || !renderer.backend.device) throw Error('A WebGPU device is required; the demo cannot use the fallback renderer.');
  scene = new Scene(); camera = new PerspectiveCamera(35, 1, 0.01, 100);
  const geometry = new BufferGeometry(); geometry.setAttribute('position', new BufferAttribute(new Float32Array(778 * 3), 3));
  mesh = new Mesh(geometry, new MeshNormalMaterial({ side: DoubleSide })); mesh.scale.setScalar(5); mesh.visible = false; scene.add(mesh);
  view.append(renderer.domElement);
  const resize = () => { const { width, height } = view.getBoundingClientRect(); renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); draw(); };
  const observer = new ResizeObserver(resize); observer.observe(view); frame(); resize();
  $('frame').onclick = frame;
  $('start').onclick = () => { (running || starting ? stop() : start()).catch(cause => status(String(cause))); };
  $('threshold').oninput = () => { $('threshold-value').value = Number($('threshold').value).toFixed(2); };
  $('choose').onclick = () => $('files').click();
  $('files').onchange = async () => {
    try {
      const models = await readLocalModels($('files').files);
      await install(models, 'local-files');
      try { await store.put(models); $('models-status').textContent = 'Saved in this browser for next time. Nothing uploaded.'; }
      catch { $('models-status').textContent = 'Models loaded for this visit. Browser storage is unavailable; choose files again next time.'; }
    } catch (cause) { $('models-status').textContent = String(cause?.message ?? cause); }
    finally { $('files').value = ''; }
  };
  window.handMeshDemo = { read: () => ({ running, starting, loading, received, misses, presentation, error, source, visible: mesh.visible,
    threshold: Number($('threshold').value), handedness: $('hand').value, identity: route?.identity ?? null, viewerBackend: renderer.backend.isWebGPUBackend ? 'webgpu' : 'fallback',
    lastAcquisition: last?.acquisition ?? null, lastTimings: last?.timings ?? null, cameraState: stream?.getVideoTracks()[0]?.readyState ?? 'off' }) };
  addEventListener('pagehide', () => {
    disposed = true; ticket++; running = false;
    stream?.getTracks().forEach(track => track.stop()); stream = null;
    if (callback !== undefined) video.cancelVideoFrameCallback(callback);
    observer.disconnect();
    Promise.resolve(flight).catch(() => {}).finally(async () => { route?.release(); await session?.close(); mesh.geometry.dispose(); mesh.material.dispose(); renderer.dispose(); });
  }, { once: true });
  try { const cached = await store.get(); if (cached) await install(cached, 'browser-storage'); else status('Choose your model folder to begin.'); }
  catch (cause) { status('Choose your model folder to begin.'); $('models-status').textContent = `Stored models unavailable: ${cause.message}`; }
}
initialize().catch(cause => { error = String(cause?.message ?? cause); status(error); $('choose').disabled = true; });
