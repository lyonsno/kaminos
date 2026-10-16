// A small application that uses @kaminos/flux2-klein the way an outside project would: it owns the
// WebGPU device, lends it to Klein, generates, and takes the device back when Klein is destroyed.
// Query: ?weights=<base URL> (default: the hosted weights), &size=256, &steps=1, &missing=<base URL
// with no weights> (to exercise a failing load). The run's record is window.kleinConsumer.
import { KleinPipeline } from '@kaminos/flux2-klein';

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
    const broken = new KleinPipeline(device, { weightsBase: q.get('missing') });
    record.failedLoad = await broken.load().then(() => null, e => String(e.message ?? e));
    await broken.destroy();
  }

  status('Loading weights…');
  const klein = new KleinPipeline(device, q.get('weights') ? { weightsBase: q.get('weights') } : {});
  let lastLoad = null;
  await klein.load((part, file, progress) => { lastLoad = { part, ...progress }; });
  record.load = { lastProgress: lastLoad, residentBytes: { ...klein.residentBytes } };

  const generate = async seed => {
    const started = performance.now();
    const image = await klein.generate({ prompt, seed, width: size, height: size, steps, textLength: 'fit16',
      onPhase: phase => record.events.push({ seed, phase }),
      onStep: (step, of) => { record.events.push({ seed, step, of }); status(`Step ${step} of ${of}…`); },
      onPreview: preview => record.events.push({ seed, preview: preview.step, width: preview.width }) });
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

  await klein.destroy();
  record.afterDestroy = await klein.generate({ prompt }).then(() => null, e => String(e.message ?? e));
  // The device is the application's again: it still creates, fills and reads back a buffer.
  const probe = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(probe, 0, new Uint32Array([1, 2, 3, 4]));
  await probe.mapAsync(GPUMapMode.READ);
  record.deviceAfterDestroy = [...new Uint32Array(probe.getMappedRange().slice(0))];
  probe.unmap(); probe.destroy();
  status('Done.');
  return record;
})();
