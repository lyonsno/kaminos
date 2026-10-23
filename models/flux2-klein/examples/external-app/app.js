// A small application that uses @kaminos/flux2-klein the way an outside project would: it owns the
// WebGPU device, lends it to Klein, generates, and takes the device back when Klein is destroyed.
// Query: ?weights=<base URL> (default: the hosted weights), &size=256, &steps=1, &missing=<base URL
// with no weights> (to exercise a failing load). The run's record is window.kleinConsumer.
import { createKleinApp } from '@kaminos/flux2-klein';

const q = new URLSearchParams(location.search);
const size = Number(q.get('size') ?? 512), steps = Number(q.get('steps') ?? 4);
const prompt = q.get('prompt') ?? 'a bright blue tank engine with a round grey face on a sunny branch line';
const status = text => { document.getElementById('status').textContent = text; };

window.kleinConsumer = (async () => {
  const record = { size, steps, events: [], gpuErrors: [] };
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter?.features.has('shader-f16')) throw new Error('WebGPU with shader-f16 is required');
  const device = await adapter.requestDevice({ requiredFeatures: ['shader-f16'], requiredLimits: {
    maxBufferSize: adapter.limits.maxBufferSize, maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize } });
  device.addEventListener('uncapturederror', e => record.gpuErrors.push(e.error.message));

  // A load from a base with no weights fails with a message naming the missing file, and the
  // half-built pipeline still releases cleanly.
  if (q.get('missing')) {
    record.failedLoad = await createKleinApp({ device, pipelineOptions: { weightsBase: q.get('missing') } })
      .then(async broken => { await broken.destroy(); return null; }, e => String(e.message ?? e));
  }

  status('Loading weights…');
  let lastLoad = null;
  const klein = await createKleinApp({ device, load: false,
    pipelineOptions: q.get('weights') ? { weightsBase: q.get('weights') } : {},
    onProgress: (part, file, progress) => { lastLoad = { part, ...progress }; } });
  record.app = klein.snapshot();
  // One foreground attachment works before, during and after every generation.
  const activity = document.getElementById('activity');
  const surface = activity.getContext('webgpu');
  surface.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'opaque' });
  let frames = 0, drawing = true, frameId = 0;
  const render = (opportunity, time) => {
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: surface.getCurrentTexture().createView(),
        loadOp: 'clear', storeOp: 'store', clearValue: [0.1, 0.3 + 0.2 * Math.sin(time / 200), 0.7, 1] }] });
      pass.end(); opportunity.submit([encoder.finish()]);
  };
  const draw = time => {
    if (!drawing) return;
    klein.foreground.request({ requestId: `activity:${++frameId}`, run: o => render(o, time) }).completion.then(receipt => {
      if (receipt.status === 'completed') frames++;
      if (drawing) requestAnimationFrame(draw);
    });
  };
  requestAnimationFrame(draw);
  await klein.load();
  record.load = { lastProgress: lastLoad, residentBytes: { ...klein.pipeline.residentBytes } };
  let pauseExercise;

  const generate = async seed => {
    const started = performance.now(), beforeFrames = frames;
    const image = await klein.generate({ prompt, seed, width: size, height: size, steps, textLength: 'fit16',
      onPhase: phase => {
        record.events.push({ seed, phase });
        if (seed === 1 && phase === 'denoise' && !pauseExercise) {
          pauseExercise = (async () => {
            record.paused = await klein.pause();
            record.pausedFrame = await klein.foreground.request({ requestId: 'paused-check', run: o => render(o, performance.now()) }).completion;
            record.resumed = await klein.resume();
          })();
          pauseExercise.catch(() => {});
        }
      },
      onStep: (step, of) => { record.events.push({ seed, step, of }); status(`Step ${step} of ${of}…`); },
      onPreview: preview => record.events.push({ seed, preview: preview.step, width: preview.width }) });
    await pauseExercise;
    record.events.push({ seed, cooperativeDuties: image.duties.length, frames: frames - beforeFrames });
    let sum = 0, sumSq = 0;
    for (let i = 0; i < image.rgba.length; i += 4) { const v = image.rgba[i + 1]; sum += v; sumSq += v * v; }
    const n = image.rgba.length / 4, mean = sum / n;
    return { image, seed, ms: performance.now() - started, greenMean: mean, greenStd: Math.sqrt(sumSq / n - mean * mean) };
  };
  const first = await generate(1);
  const canvas = document.getElementById('image');
  canvas.width = size; canvas.height = size;
  canvas.getContext('2d').putImageData(new ImageData(first.image.rgba, size, size), 0, 0);
  record.first = { ms: first.ms, greenMean: first.greenMean, greenStd: first.greenStd, png: canvas.toDataURL('image/png') };

  // A request Klein cannot serve fails without breaking the pipeline.
  record.invalidRequest = await klein.generate({ prompt, width: 100, height: 100, steps }).then(() => null, e => String(e.message ?? e));
  const second = await generate(2);
  record.second = { ms: second.ms, greenMean: second.greenMean, greenStd: second.greenStd, textCached: Boolean(second.image.timings.textCached) };

  record.afterRuns = klein.snapshot();
  record.routesAfterRuns = klein.session.snapshot().routes.length;
  drawing = false;
  await klein.destroy();
  surface.unconfigure();
  record.afterDestroy = await Promise.resolve().then(() => klein.generate({ prompt })).then(() => null, e => String(e.message ?? e));
  // The device is the application's again: it still creates, fills and reads back a buffer.
  const probe = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(probe, 0, new Uint32Array([1, 2, 3, 4]));
  await probe.mapAsync(GPUMapMode.READ);
  record.deviceAfterDestroy = [...new Uint32Array(probe.getMappedRange().slice(0))];
  probe.unmap(); probe.destroy();
  device.destroy();
  status('Done.');
  return record;
})();
