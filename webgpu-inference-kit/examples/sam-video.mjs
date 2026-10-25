import { createWebGpuInferenceSession, createWebGpuForegroundService, requestBrowserWebGpuDevice }
  from '@kaminos/webgpu-inference-kit/core';
import { createSam31VideoTracker, createSam31LiveLoop } from '@kaminos/webgpu-inference-kit/sam';
import { createSamVideoPreview } from './sam-video-preview.mjs';

export function createSamVideoPixels(source, result, view = 'overlay') {
  if (!['overlay', 'cutout', 'mask'].includes(view)) throw new Error('unknown video mask view');
  if (!Number.isInteger(result.objectSlot) || result.objectSlot < 0 || result.objectSlot >= 16) throw new Error('invalid object slot');
  if (source.rgba.length !== source.width * source.height * 4 || result.timestamp !== source.timestamp
      || result.maskLogits.length !== 16 * result.maskWidth * result.maskHeight) throw new Error('video source/mask geometry or timestamp mismatch');
  const pixels = new Uint8ClampedArray(source.rgba);
  const offset = result.objectSlot * result.maskWidth * result.maskHeight;
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    const m = offset + Math.floor(y * result.maskHeight / source.height) * result.maskWidth + Math.floor(x * result.maskWidth / source.width);
    const inside = result.maskLogits[m] > 0, i = (y * source.width + x) * 4;
    if (view === 'mask') { pixels.fill(inside ? 255 : 0, i, i + 3); pixels[i + 3] = 255; }
    else if (view === 'cutout') { if (!inside) pixels[i + 3] = 0; }
    else if (inside) { pixels[i] *= 0.45; pixels[i + 1] = pixels[i + 1] * 0.45 + 120; pixels[i + 2] = pixels[i + 2] * 0.45 + 120; }
  }
  return pixels;
}

export async function mountSamVideoPage(document) {
  const byId = id => document.getElementById(id), video = byId('video');
  const seedCanvas = byId('seed'), seedContext = seedCanvas.getContext('2d', { willReadFrequently: true });
  const paint = document.createElement('canvas'), brush = paint.getContext('2d', { willReadFrequently: true });
  const resultCanvas = byId('result'), resultContext = resultCanvas.getContext('2d');
  let device, session, foreground, preview, tracker, loop, running, seed, last, stream, objectUrl, drawing = false;
  let loading = false, closed = false, captureSequence = 0, view = 'overlay';
  const status = message => { byId('status').textContent = message; };
  function controls() {
    const busy = loading || !!running;
    for (const id of ['camera', 'file', 'load', 'model']) byId(id).disabled = busy;
    byId('capture').disabled = busy || !tracker || !video.videoWidth;
    byId('clear').disabled = busy || !seed;
    byId('start').disabled = busy || !seed;
    byId('pause').disabled = !running;
    byId('stop').disabled = !running;
    byId('unload').disabled = loading || !tracker;
    byId('save').disabled = !last;
  }
  async function initialize() {
    if (device) return;
    const acquired = await requestBrowserWebGpuDevice(navigator.gpu, { label: 'sam-video-example' });
    device = acquired.device;
    try {
      session = await createWebGpuInferenceSession({ sessionId: `sam-video:${crypto.randomUUID()}`,
        device, adapter: acquired.adapter, backendIdentity: acquired.backendIdentity });
      foreground = createWebGpuForegroundService({ device, routeId: 'sam-video-example' });
      preview = await createSamVideoPreview({ canvas: byId('source'), device, foreground,
        onError(error) { loop?.stop(error.message); status(`Failed: ${error.message}`); } });
      device.lost.then(info => { if (!closed) { loop?.stop('device lost'); status(`Device lost: ${info.message}`); } });
    } catch (error) { await foreground?.dispose(); session?.close(); device.destroy(); device = null; throw error; }
  }
  function releaseMedia() {
    stream?.getTracks().forEach(track => track.stop()); stream = null;
    video.pause(); video.srcObject = null; video.removeAttribute('src'); video.load();
    if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null;
    preview?.setSource(null); seed = null; last = null;
    seedContext.clearRect(0, 0, seedCanvas.width, seedCanvas.height);
    resultContext.clearRect(0, 0, resultCanvas.width, resultCanvas.height);
  }
  async function useMedia(file) {
    await initialize(); releaseMedia();
    if (file) { objectUrl = URL.createObjectURL(file); video.src = objectUrl; }
    else { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); video.srcObject = stream; }
    await video.play(); preview.setSource(video); status(file ? file.name : 'Camera live'); controls();
  }
  function capture() {
    if (!tracker || !video.videoWidth) throw new Error('load the tracker and a video source first');
    const scratch = document.createElement('canvas'); scratch.width = tracker.imageWidth; scratch.height = tracker.imageHeight;
    scratch.getContext('2d').drawImage(video, 0, 0, scratch.width, scratch.height);
    return { rgba: new Uint8Array(scratch.getContext('2d').getImageData(0, 0, scratch.width, scratch.height).data),
      timestamp: ++captureSequence, width: scratch.width, height: scratch.height, mediaTime: video.currentTime };
  }
  function redrawSeed() {
    seedContext.putImageData(new ImageData(new Uint8ClampedArray(seed.rgba), seed.width, seed.height), 0, 0);
    seedContext.drawImage(paint, 0, 0);
  }
  function drawResult() {
    if (!last) return;
    resultCanvas.width = last.source.width; resultCanvas.height = last.source.height;
    resultContext.putImageData(new ImageData(createSamVideoPixels(last.source, last.result, view), resultCanvas.width, resultCanvas.height), 0, 0);
  }
  async function stop() { loop?.stop(); await running; }
  const handle = work => Promise.resolve().then(work).catch(error => status(`Failed: ${error.message}`)).finally(controls);
  byId('camera').onclick = () => handle(() => useMedia());
  byId('file').onchange = event => { const file = event.target.files[0]; if (file) handle(() => useMedia(file)); event.target.value = ''; };
  byId('load').onclick = () => handle(async () => {
    loading = true; controls();
    try {
      await initialize(); await tracker?.close(); tracker = null;
      const root = new URL(byId('model').value, location.href);
      if (root.origin !== location.origin) throw new Error('model root must be same-origin');
      tracker = await createSam31VideoTracker({ modelPackageRoot: root.href, inferenceSession: session, foregroundService: foreground,
        memoryAttentionKernel: 'flash', onProgress: status });
      status(`Model loaded: ${tracker.imageWidth} x ${tracker.imageHeight}`);
      byId('identity').textContent = tracker.packageId;
    } finally { loading = false; }
  });
  byId('capture').onclick = () => handle(async () => {
    if (tracker.snapshot().status === 'tracking') tracker.reset();
    seed = capture(); paint.width = seedCanvas.width = seed.width; paint.height = seedCanvas.height = seed.height;
    redrawSeed(); last = null; byId('frame').textContent = 'Authored seed mask'; status('Seed captured');
  });
  byId('clear').onclick = () => { brush.clearRect(0, 0, paint.width, paint.height); redrawSeed(); };
  function dab(event) {
    if (!seed || running) return;
    const rect = seedCanvas.getBoundingClientRect(), x = (event.clientX - rect.left) * paint.width / rect.width,
      y = (event.clientY - rect.top) * paint.height / rect.height;
    brush.fillStyle = 'rgba(40,210,210,0.65)'; brush.beginPath(); brush.arc(x, y, Number(byId('brush').value), 0, Math.PI * 2); brush.fill(); redrawSeed();
  }
  seedCanvas.onpointerdown = event => { if (!seed || running) return; drawing = true; seedCanvas.setPointerCapture(event.pointerId); dab(event); };
  seedCanvas.onpointermove = event => { if (drawing) dab(event); };
  seedCanvas.onpointerup = seedCanvas.onpointercancel = () => { drawing = false; };
  byId('start').onclick = () => handle(async () => {
    const painted = brush.getImageData(0, 0, paint.width, paint.height).data;
    const mask = Uint8Array.from({ length: paint.width * paint.height }, (_, i) => painted[i * 4 + 3] ? 1 : 0);
    if (!mask.some(Boolean)) throw new Error('initial object mask is empty');
    if (tracker.snapshot().status === 'tracking') tracker.reset();
    loop = createSam31LiveLoop({ tracker, getFrame: async () => {
      if (video.ended) throw new Error('Video ended');
      return capture();
    }, onFrame(frame) {
      last = { ...frame, packageId: tracker.packageId }; drawResult();
      byId('frame').textContent = `Captured frame ${frame.result.frameIndex} | score ${frame.result.objectScores[frame.result.objectSlot].toFixed(3)}`;
      byId('source-id').textContent = frame.result.sourceImageSha256;
      status(`Tracking | ${Math.round(frame.result.timing.frameMs)} ms model wall | ${preview.snapshot().submissions} preview submissions`);
    } });
    running = loop.start({ ...seed, mask }); controls();
    try { await running; } finally { running = null; byId('pause').textContent = 'Pause'; status(loop.snapshot().error || 'Stopped'); controls(); }
  });
  byId('pause').onclick = () => handle(async () => {
    if (loop.snapshot().status === 'paused') { await loop.resume(); byId('pause').textContent = 'Pause'; }
    else { await loop.pause(); byId('pause').textContent = 'Resume'; status('Paused'); }
  });
  byId('stop').onclick = () => handle(stop);
  byId('unload').onclick = () => handle(async () => {
    try { await stop(); } finally { await tracker.close(); tracker = null; seed = null; }
    status('Model unloaded');
  });
  for (const radio of document.querySelectorAll('input[name=view]')) radio.onchange = () => { view = radio.value; drawResult(); };
  byId('save').onclick = () => {
    const data = { schema: 'kaminos.sam31-video-capture.v1', packageId: last.packageId,
      source: { ...last.source, rgba: [...last.source.rgba] }, result: { ...last.result,
        maskLogits: [...last.result.maskLogits], objectScores: [...last.result.objectScores] }, seedAuthority: 'human-painted-binary-mask' };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `sam-video-frame-${last.result.frameIndex}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  async function close() {
    closed = true;
    const errors = [];
    for (const work of [stop, releaseMedia, () => tracker?.close(), () => preview?.close(), () => foreground?.dispose(),
      () => session?.drain(), () => session?.close(), () => device?.destroy()]) {
      try { await work(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'SAM video cleanup failed');
  }
  globalThis.addEventListener('pagehide', () => { close().catch(console.error); }, { once: true });
  byId('model').value = new URLSearchParams(location.search).get('model') || '/model/tracker-model-root.json';
  controls();
  return { close, capture, get tracker() { return tracker; }, get preview() { return preview; }, get foreground() { return foreground; } };
}
