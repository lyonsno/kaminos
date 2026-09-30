import { createCooperativeYield, createWebGpuInferenceSession, requestBrowserWebGpuDevice }
  from '@kaminos/webgpu-inference-kit/core';
import { createSam3BrowserImageRuntime, createSam3SourceMask }
  from '@kaminos/webgpu-inference-kit/sam';

export async function sha256Bytes(bytes, crypto = globalThis.crypto) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `sha256:${Array.from(digest, value => value.toString(16).padStart(2, '0')).join('')}`;
}

async function decodeSource(file) {
  if (!(file instanceof Blob) || file.size === 0) throw new Error('a non-empty image file is required');
  const sha256 = await sha256Bytes(await file.arrayBuffer());
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height) throw new Error('decoded source image is empty');
    const scratch = document.createElement('canvas');
    scratch.width = width; scratch.height = height;
    const context = scratch.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('source image pixel context unavailable');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, width, height).data;
    return { image, pixels, width, height, sha256, url, artifactId: `image:${sha256.slice(7)}`,
      name: file.name || 'image', release() { URL.revokeObjectURL(url); } };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

export function createSamImagePixels(source, output, indices, view) {
  if (!['mask', 'cutout', 'overlay'].includes(view)) throw new Error(`unknown image view ${view}`);
  if (source.pixels?.length !== source.width * source.height * 4) throw new Error('source RGBA dimensions mismatch');
  const mask = createSam3SourceMask(output, indices, source.width, source.height);
  const pixels = view === 'mask' ? new Uint8ClampedArray(source.pixels.length) : source.pixels.slice();
  for (let i = 0; i < mask.length; i += 1) {
    const offset = i * 4;
    if (view === 'mask') {
      pixels.fill(mask[i] ? 255 : 0, offset, offset + 3);
      pixels[offset + 3] = 255;
    } else if (view === 'cutout') {
      if (!mask[i]) pixels[offset + 3] = 0;
    } else if (mask[i]) {
      pixels[offset] = Math.round(pixels[offset] * 0.55 + 35 * 0.45);
      pixels[offset + 1] = Math.round(pixels[offset + 1] * 0.55 + 210 * 0.45);
      pixels[offset + 2] = Math.round(pixels[offset + 2] * 0.55 + 145 * 0.45);
    }
  }
  return pixels;
}

const SOURCE_SHADER = `
struct Motion { time: f32, canvasAspect: f32, sourceAspect: f32, pad: f32 };
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var<uniform> motion: Motion;
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vertex(@builtin(vertex_index) i: u32) -> Vertex {
  let p = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3))[i];
  return Vertex(vec4f(p, 0, 1), vec2f((p.x + 1) * 0.5, (1 - p.y) * 0.5));
}
@fragment fn fragment(v: Vertex) -> @location(0) vec4f {
  let angle = sin(motion.time * 0.7) * 0.025;
  let p = (v.uv - vec2f(0.5)) * vec2f(motion.canvasAspect, 1.0);
  let shifted = p - vec2f(sin(motion.time * 0.9) * 0.025, cos(motion.time * 0.6) * 0.015);
  let rotated = vec2f(cos(angle) * shifted.x - sin(angle) * shifted.y,
    sin(angle) * shifted.x + cos(angle) * shifted.y);
  let fitHeight = min(1.0, motion.canvasAspect / motion.sourceAspect) * 0.86;
  let uv = rotated / vec2f(fitHeight * motion.sourceAspect, fitHeight) + vec2f(0.5);
  if (any(uv < vec2f(0)) || any(uv > vec2f(1))) { return vec4f(0.08, 0.09, 0.09, 1); }
  let color = textureSampleLevel(source, linearSampler, uv, 0);
  return vec4f(mix(vec3f(0.15), color.rgb, color.a), 1);
}`;

// Example-local renderer: the kit yield services source work at existing SAM boundaries.
async function createSourceForeground({ device, canvas, gpu, onError, onSubmission }) {
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('source canvas WebGPU context unavailable');
  const format = gpu.getPreferredCanvasFormat();
  let uniform, texture, bindings, pipeline, frame = null, source = null, closed = false, failure = null;
  let submissions = 0, yields = 0;
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  function close() {
    closed = true;
    if (frame !== null) cancelAnimationFrame(frame);
    texture?.destroy(); uniform?.destroy(); context.unconfigure();
  }
  try {
    context.configure({ device, format, alphaMode: 'opaque' });
    const module = device.createShaderModule({ code: SOURCE_SHADER });
    pipeline = await device.createRenderPipelineAsync({ layout: 'auto',
      vertex: { module, entryPoint: 'vertex' },
      fragment: { module, entryPoint: 'fragment', targets: [{ format }] },
      primitive: { topology: 'triangle-list' } });
    uniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  } catch (error) { close(); throw error; }

  function draw(time) {
    if (closed || failure) return;
    try {
      const width = Math.max(1, Math.round(canvas.clientWidth * (globalThis.devicePixelRatio || 1)));
      const height = Math.max(1, Math.round(canvas.clientHeight * (globalThis.devicePixelRatio || 1)));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      if (source) device.queue.writeBuffer(uniform, 0, new Float32Array([time / 1000, canvas.width / canvas.height,
        source.width / source.height, 0]));
      const encoder = device.createCommandEncoder({ label: 'sam-image-source-motion' });
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(),
        loadOp: 'clear', storeOp: 'store', clearValue: [0.08, 0.09, 0.09, 1] }] });
      if (source) { pass.setPipeline(pipeline); pass.setBindGroup(0, bindings); pass.draw(3); }
      pass.end();
      device.queue.submit([encoder.finish()]);
      submissions += 1;
      onSubmission();
    } catch (error) { failure = error; onError(error); }
  }
  function tick(time) {
    frame = null;
    draw(time);
    if (!closed && !failure && source) frame = requestAnimationFrame(tick);
  }
  function setSource(next) {
    if (closed) throw new Error('source foreground is closed');
    if (!next) {
      source = null; texture?.destroy(); texture = null;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null; draw(performance.now()); return;
    }
    const nextTexture = device.createTexture({ size: [next.width, next.height], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    try {
      device.queue.copyExternalImageToTexture({ source: next.image }, { texture: nextTexture }, [next.width, next.height]);
      const nextBindings = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: nextTexture.createView() }, { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: uniform } },
      ] });
      texture?.destroy(); texture = nextTexture; bindings = nextBindings; source = next;
      if (frame === null) frame = requestAnimationFrame(tick);
    } catch (error) { nextTexture.destroy(); throw error; }
  }
  const cooperativeYield = createCooperativeYield({ queue: device.queue, waitForSubmittedWorkDone: true,
    yieldMs: 0, sleep: async ms => {
      if (failure) throw failure;
      if (closed) throw new Error('source foreground is closed');
      draw(performance.now());
      if (failure) throw failure;
      await new Promise(resolve => setTimeout(resolve, ms));
    } });
  return { setSource, close, async yield(metadata) { yields += 1; return cooperativeYield(metadata); },
    evidence() { return { submissions, yields, error: failure?.message || null }; } };
}

async function validateOutput(output, request) {
  if (!output || output.invocationId !== request.invocationId) throw new Error('SAM output invocation mismatch');
  if (output.outputAuthority !== 'actual-webgpu-readback' || output.verificationState !== 'not-attached') {
    throw new Error('SAM output authority mismatch');
  }
  if (output.promptText !== request.promptText
      || output.promptSha256 !== await sha256Bytes(new TextEncoder().encode(request.promptText))) {
    throw new Error('SAM output prompt provenance mismatch');
  }
  const source = output.sourceImage;
  if (source?.sha256 !== request.sourceImage.sha256 || source?.artifactId !== request.sourceImage.artifactId
      || JSON.stringify(source?.encodedResolution) !== JSON.stringify(request.sourceImage.encodedResolution)) {
    throw new Error('SAM output source provenance mismatch');
  }
  if (!output.requestedRouteId || !output.effectiveRouteId || !Array.isArray(output.instances)) {
    throw new Error('SAM output route or instances missing');
  }
  if (![output.width, output.height].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new Error('SAM output dimensions must be positive integers');
  }
  const indices = new Set();
  for (const instance of output.instances) {
    if (!Number.isSafeInteger(instance.index) || instance.index < 0 || indices.has(instance.index)) {
      throw new Error('SAM output duplicate or invalid instance index');
    }
    indices.add(instance.index);
    if (!Number.isFinite(instance.score) || !Array.isArray(instance.box) || instance.box.length !== 4
        || instance.box.some(value => !Number.isFinite(value))) throw new Error('SAM output invalid score or box');
  }
}

export async function createSamImageExample({ canvas, onState = () => {},
  baseUrl = globalThis.location?.href, gpu = globalThis.navigator?.gpu, services = {} } = {}) {
  const requestDevice = services.requestDevice || (options => requestBrowserWebGpuDevice(gpu, options));
  const createSession = services.createSession || createWebGpuInferenceSession;
  const createRuntime = services.createRuntime || createSam3BrowserImageRuntime;
  const createForeground = services.createForeground || createSourceForeground;
  const readSource = services.decodeSource || decodeSource;
  const state = { status: 'idle', phase: 'No image', error: null, observerError: null, source: null,
    output: null, selectedIndices: [], backend: null, modelUrl: null, busy: false };
  let source = null, output = null, context = null, session = null, foreground = null, sam = null;
  let active = null, disposal = null, closing = false, fatal = null, runtimeEvidence = null, requested = null;
  const snapshot = () => structuredClone({ ...state, foreground: foregroundEvidence() });
  function foregroundEvidence() {
    return { ...foreground?.evidence(), authority: 'queue-submissions-not-presented-frames', coexistence: 'unverified' };
  }
  function publish() {
    try { onState(snapshot()); } catch (error) { state.observerError = String(error.message || error); }
  }
  function clearOutput() { output = null; state.output = null; state.selectedIndices = []; }
  function assertOpen() {
    if (closing) throw new Error('example is closed or closing');
    if (fatal) throw fatal;
    if (active) throw new Error('example is busy');
  }
  function reportFatal(error) {
    if (closing) return;
    fatal = error; clearOutput(); state.status = 'failed'; state.error = String(error.message || error); publish();
  }
  const onGpuError = event => reportFatal(new Error(`WebGPU error: ${event.error.message}`));
  async function initialize() {
    if (context) return;
    const acquired = await requestDevice({ label: 'sam-image-example', adapterOptions: { powerPreference: 'high-performance' } });
    acquired.device.addEventListener?.('uncapturederror', onGpuError);
    try {
      session = await createSession({ sessionId: `sam-image:${globalThis.crypto.randomUUID()}`,
        device: acquired.device, adapter: acquired.adapter, backendIdentity: acquired.backendIdentity });
      foreground = await createForeground({ device: acquired.device, canvas, gpu, onError: reportFatal,
        onSubmission: publish });
      context = acquired; state.backend = acquired.backendIdentity;
      acquired.device.lost.then(info => reportFatal(new Error(`WebGPU device lost: ${info.reason}: ${info.message}`)));
    } catch (error) {
      session?.close(); session = null;
      acquired.device.removeEventListener?.('uncapturederror', onGpuError);
      acquired.device.destroy(); throw error;
    }
  }
  function operate(status, operation) {
    assertOpen(); state.busy = true; state.status = status; state.error = null;
    active = Promise.resolve().then(operation).catch(error => {
      clearOutput(); state.error = String(error.message || error);
      if (!closing) state.status = 'failed';
      throw error;
    }).finally(() => { active = null; state.busy = false; publish(); });
    publish(); return active;
  }
  async function loadImage(file) {
    return operate('loading-image', async () => {
      clearOutput(); source?.release(); source = null; state.source = null;
      foreground?.setSource(null); state.phase = 'Decode and authenticate image'; publish();
      const next = await readSource(file);
      try { await initialize(); if (fatal) throw fatal; foreground.setSource(next); }
      catch (error) { next.release(); throw error; }
      source = next;
      state.source = { width: next.width, height: next.height, sha256: next.sha256,
        artifactId: next.artifactId, name: next.name || 'image' };
      if (!closing) state.status = 'idle'; state.phase = 'Image loaded';
    });
  }
  async function run({ manifestUrl, promptText } = {}) {
    assertOpen();
    if (!source) throw new Error('upload a source image first');
    const prompt = String(promptText || '').trim();
    if (!prompt) throw new Error('a text prompt is required');
    if (!manifestUrl?.trim()) throw new Error('model manifest URL is required');
    const model = new URL(manifestUrl, baseUrl);
    if (model.origin !== new URL(baseUrl).origin || !['http:', 'https:'].includes(model.protocol)) {
      throw new Error('model manifest must be a same-origin HTTP URL');
    }
    if (sam && model.href !== state.modelUrl) throw new Error('unload the current model before changing manifest');
    clearOutput();
    return operate('running', async () => {
      if (!sam) {
        sam = createRuntime({ baseUrl, inferenceSession: session, yield: foreground.yield,
          foregroundEvidence, onStatus(update) { state.phase = update.message; publish(); } });
        state.modelUrl = model.href;
      }
      const request = { invocationId: globalThis.crypto.randomUUID(), promptText: prompt,
        verificationMode: 'execution-only', sourceImage: { url: source.url, sha256: source.sha256,
          artifactId: source.artifactId, encodedResolution: [source.width, source.height] } };
      requested = { ...request, manifestUrl: model.href }; runtimeEvidence = null;
      try {
        const result = await sam.run(model.href, request);
        if (fatal) throw fatal;
        await validateOutput(result, request);
        const indices = result.instances.map(instance => instance.index);
        createSam3SourceMask(result, indices, source.width, source.height);
        output = result; state.selectedIndices = indices;
        state.output = { invocationId: result.invocationId, promptText: result.promptText,
          promptSha256: result.promptSha256, sourceImage: result.sourceImage,
          requestedRouteId: result.requestedRouteId, effectiveRouteId: result.effectiveRouteId,
          outputAuthority: result.outputAuthority, verificationState: result.verificationState,
          width: result.width, height: result.height, imageCache: result.imageCache,
          instances: result.instances.map(({ index, score, box }) => ({ index, score, box })) };
        if (!closing) state.status = 'succeeded';
        state.phase = indices.length ? 'Masks returned' : 'No instances retained';
        return result;
      } finally { runtimeEvidence = sam.evidence(); }
    });
  }
  function select(indices) {
    assertOpen();
    if (!output) throw new Error('no current output');
    const unique = [...new Set(indices)];
    createSam3SourceMask(output, unique, source.width, source.height);
    state.selectedIndices = unique; publish();
  }
  function pixels(view) {
    if (!output || closing || fatal) throw new Error('no current output');
    return createSamImagePixels(source, output, state.selectedIndices, view);
  }
  async function unloadModel() {
    return operate('unloading', async () => {
      clearOutput(); state.phase = 'Release model resources';
      await sam?.close(); sam = null; state.modelUrl = null; runtimeEvidence = null;
      if (!closing) state.status = 'idle'; state.phase = source ? 'Image loaded' : 'No image';
    });
  }
  function dispose() {
    if (disposal) return disposal;
    closing = true; state.status = 'closing'; state.phase = active ? 'Waiting for active work' : 'Release resources'; publish();
    disposal = (async () => {
      try { await active; } catch { /* The operation retains its own failure. */ }
      const errors = [];
      for (const cleanup of [() => sam?.close(), () => foreground?.close(), () => session?.drain(),
        () => session?.close(), () => source?.release(),
        () => context?.device.removeEventListener?.('uncapturederror', onGpuError), () => context?.device.destroy()]) {
        try { await cleanup(); } catch (error) { errors.push(error); }
      }
      clearOutput(); source = null; state.source = null; state.modelUrl = null;
      state.status = 'closed'; state.phase = 'Closed'; publish();
      if (errors.length) throw new AggregateError(errors, 'example cleanup failed');
    })();
    return disposal;
  }
  publish();
  return Object.freeze({ loadImage, run, select, pixels, unloadModel, dispose, snapshot,
    provenance: () => structuredClone({ source: state.source, request: requested, output: state.output,
      selectedIndices: state.selectedIndices, backend: state.backend, runtimeEvidence,
      foreground: foregroundEvidence(), status: state.status, error: state.error }) });
}

export async function mountSamImagePage(document) {
  const byId = id => document.getElementById(id);
  let renderedOutput = null, renderedSelection = '', view = 'overlay';
  const preview = byId('result'), ctx = preview.getContext('2d');
  const example = await createSamImageExample({ canvas: byId('source'), onState(state) {
    byId('status').textContent = state.error || `${state.status}: ${state.phase}`;
    byId('status').dataset.error = state.error ? 'true' : 'false';
    byId('submissions').textContent = `${state.foreground.submissions || 0} source queue submissions; coexistence unverified`;
    const closed = ['closing', 'closed'].includes(state.status);
    for (const id of ['image', 'prompt', 'run', 'unload', 'manifest']) byId(id).disabled = state.busy || closed;
    byId('run').disabled ||= !state.source;
    byId('manifest').disabled ||= !!state.modelUrl;
    byId('unload').disabled ||= !state.modelUrl;
    for (const id of ['instances', 'save-mask', 'save-cutout', 'save-provenance']) byId(id).disabled = !state.output || state.busy || closed;
    byId('source-name').textContent = state.source ? `${state.source.name} | ${state.source.width} x ${state.source.height}` : 'Source image';
    if (!state.output) {
      ctx.clearRect(0, 0, preview.width, preview.height);
      byId('result-name').textContent = 'Selection';
      byId('instances').replaceChildren(); renderedOutput = null; renderedSelection = ''; return;
    }
    const selection = state.selectedIndices.join(',');
    if (renderedOutput !== state.output.invocationId) {
      const all = document.createElement('option'); all.value = 'all'; all.textContent = `All (${state.output.instances.length})`;
      byId('instances').replaceChildren(all, ...state.output.instances.map(instance => {
        const option = document.createElement('option'); option.value = instance.index;
        option.textContent = `Instance ${instance.index} | score ${instance.score.toFixed(3)}`; return option;
      }));
    }
    if (renderedOutput !== state.output.invocationId || renderedSelection !== selection) {
      renderedOutput = state.output.invocationId; renderedSelection = selection;
      preview.width = state.source.width; preview.height = state.source.height;
      ctx.putImageData(new ImageData(example.pixels(view), preview.width, preview.height), 0, 0);
      byId('result-name').textContent = `${state.output.promptText} | ${state.output.instances.length} retained`;
    }
  } });
  const handle = operation => Promise.resolve().then(operation).catch(error => {
    byId('status').textContent = String(error.message || error); byId('status').dataset.error = 'true';
  });
  byId('manifest').value = new URLSearchParams(location.search).get('manifest') || '/sam3-packet/tensor-manifest.json';
  byId('image').addEventListener('change', event => {
    const file = event.target.files[0]; if (file) handle(() => example.loadImage(file)); event.target.value = '';
  });
  byId('run').addEventListener('click', () => handle(() => example.run({
    manifestUrl: byId('manifest').value, promptText: byId('prompt').value,
  })));
  byId('unload').addEventListener('click', () => handle(() => example.unloadModel()));
  byId('instances').addEventListener('change', event => handle(() => example.select(event.target.value === 'all'
    ? example.snapshot().output.instances.map(instance => instance.index) : [Number(event.target.value)])));
  for (const radio of document.querySelectorAll('input[name="view"]')) radio.addEventListener('change', () => {
    view = radio.value;
    if (example.snapshot().output) handle(() => {
      ctx.putImageData(new ImageData(example.pixels(view), preview.width, preview.height), 0, 0);
    });
  });
  function download(blob, filename) {
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  for (const kind of ['mask', 'cutout']) byId(`save-${kind}`).addEventListener('click', () => handle(async () => {
    const state = example.snapshot(), exportCanvas = document.createElement('canvas');
    exportCanvas.width = state.source.width; exportCanvas.height = state.source.height;
    exportCanvas.getContext('2d').putImageData(new ImageData(example.pixels(kind), exportCanvas.width, exportCanvas.height), 0, 0);
    const blob = await new Promise((resolve, reject) => exportCanvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG encoding failed')), 'image/png'));
    download(blob, `sam-${state.output.invocationId}-${kind}.png`);
  }));
  byId('save-provenance').addEventListener('click', () => handle(() => download(
    new Blob([JSON.stringify(example.provenance(), null, 2)], { type: 'application/json' }),
    `sam-${example.snapshot().output.invocationId}-provenance.json`)));
  globalThis.addEventListener('pagehide', () => { example.dispose().catch(console.error); }, { once: true });
  return example;
}
