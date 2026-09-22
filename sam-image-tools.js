import { createSam3BrowserImageRuntime, createSam3SourceMask } from './webgpu-inference-kit/src/sam.js';
import { createSamWorkbenchForeground } from './webgpu-inference-kit/smokes/sam-workbench-foreground.js';

const COLORS = [[50, 203, 222], [233, 184, 78], [208, 115, 185], [129, 217, 137]];

export function createSamImageTools({ inferenceSession, rendererDevice, config, onAsset, onScene }) {
  const el = id => document.getElementById(`sam-image-${id}`);
  const canvas = el('canvas');
  const picker = el('instances');
  let source = null, image = null, output = null, runtime = null, foreground = null;
  let busy = false, loadVersion = 0, active = false, elapsed = 0;
  let failure = null, view = 'overlay';
  let executionDevice = null;
  let operation = null;
  let invocation = null;
  const display = document.createElement('canvas');

  function status(text, failed = false) {
    el('status').textContent = text;
    el('status').dataset.failed = String(failed);
  }
  function controls() {
    el('run').disabled = busy || !image || !config?.mounted || Boolean(failure);
    el('file').disabled = busy;
    el('open').disabled = busy;
    el('unload').disabled = busy || !runtime;
    picker.disabled = busy || !output?.instances.length;
    for (const id of ['save-mask', 'save-cutout', 'add-cutout']) el(id).disabled = busy || !output?.instances.length;
  }
  function fail(error) {
    status(error.message || String(error), true);
    console.error(error);
  }
  function selectedIndices() {
    return picker.value === 'all' ? output.instances.map(row => row.index) : [Number(picker.value)];
  }
  function selectedInstances() {
    const indices = selectedIndices();
    return output.instances.filter(row => indices.includes(row.index));
  }
  function redraw() {
    if (!image) return;
    const width = image.naturalWidth, height = image.naturalHeight;
    display.width = width; display.height = height;
    const ctx = display.getContext('2d');
    if (view !== 'mask') ctx.drawImage(image, 0, 0);
    else { ctx.fillStyle = '#101313'; ctx.fillRect(0, 0, width, height); }
    if (output && view !== 'source') {
      const layer = ctx.createImageData(width, height);
      for (const instance of selectedInstances()) {
        const mask = createSam3SourceMask(output, [instance.index], width, height);
        const color = view === 'mask' ? [236, 247, 246] : COLORS[instance.index % COLORS.length];
        for (let i = 0; i < mask.length; i += 1) if (mask[i]) {
          layer.data[i * 4] = color[0]; layer.data[i * 4 + 1] = color[1]; layer.data[i * 4 + 2] = color[2];
          layer.data[i * 4 + 3] = view === 'mask' ? 255 : 150;
        }
      }
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = width; maskCanvas.height = height;
      maskCanvas.getContext('2d').putImageData(layer, 0, 0);
      ctx.drawImage(maskCanvas, 0, 0);
    }
    foreground?.setImage(display, { resetView: false });
  }
  async function ingest(blob, name) {
    const response = await fetch(`/api/ingest-image?${new URLSearchParams({ name })}`, { method: 'POST', body: blob });
    const result = await response.json();
    if (!response.ok || !result.entry) throw new Error(result.error || `Image save failed: ${response.status}`);
    onAsset?.(result.entry);
    return result.entry;
  }
  async function open(input, metadata = {}) {
    if (busy) throw new Error('An image operation is in progress');
    const version = ++loadVersion;
    busy = true; output = null; image = null; source = null;
    picker.replaceChildren();
    el('name').textContent = 'Loading image';
    el('result').textContent = '';
    el('empty').hidden = false;
    canvas.hidden = true;
    controls(); status('Loading image');
    try {
      const entry = input instanceof Blob
        ? await ingest(input, input.name || 'pasted-image.png')
        : { source: input, name: metadata.fileName || metadata.label || 'Image', ...metadata };
      const response = await fetch(entry.source);
      if (!response.ok) throw new Error(`Image load failed: ${response.status}`);
      const blob = await response.blob();
      const bytes = await blob.arrayBuffer();
      const sha256 = `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('')}`;
      const url = URL.createObjectURL(blob);
      let decoded;
      try {
        decoded = new Image(); decoded.src = url; await decoded.decode();
      } finally { URL.revokeObjectURL(url); }
      if (version !== loadVersion) return;
      image = decoded;
      source = { ...entry, sha256, encodedResolution: [image.naturalWidth, image.naturalHeight], artifactId: `image:${sha256}` };
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      canvas.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
      if (!foreground) {
        foreground = await createSamWorkbenchForeground({ device: inferenceSession.device, canvas, image,
          onError(error) { failure = error; status(error.message, true); controls(); },
        });
      } else foreground.setImage(image);
      el('empty').hidden = true;
      canvas.hidden = false;
      el('name').textContent = entry.name || 'Image';
      el('dimensions').textContent = `${canvas.width} x ${canvas.height}`;
      status(config?.mounted ? 'Image loaded' : 'SAM model not mounted');
      el('prompt').focus();
    } catch (error) { fail(error); throw error; }
    finally { busy = false; controls(); }
  }
  function createRuntime() {
    return createSam3BrowserImageRuntime({
      baseUrl: window.location.href, inferenceSession,
      onExecutionContext({ device }) { executionDevice = device; },
      yield: metadata => foreground.yield(metadata),
      foregroundEvidence: () => foreground.evidence(),
      onStatus({ status: phase }) { if (!failure) status(phase.replaceAll('-', ' ')); },
    });
  }
  async function run() {
    if (busy || !image || !config?.mounted) return;
    const promptText = el('prompt').value.trim();
    if (!promptText) { el('prompt').focus(); return; }
    busy = true; output = null; picker.replaceChildren(); controls(); redraw();
    const invocationId = crypto.randomUUID();
    const start = performance.now();
    invocation = { invocationId, startedAtMs: start, completedAtMs: null };
    el('result').textContent = '';
    try {
      runtime ||= createRuntime();
      operation = runtime.run(config.manifestUrl, { invocationId, promptText, verificationMode: 'execution-only',
        sourceImage: { url: source.source, sha256: source.sha256, artifactId: source.artifactId, encodedResolution: source.encodedResolution },
      });
      const result = await operation;
      if (failure) throw failure;
      if (result?.invocationId !== invocationId || result.outputAuthority !== 'actual-webgpu-readback' || result.verificationState !== 'not-attached') {
        throw new Error('SAM output does not belong to this live invocation');
      }
      for (const instance of result.instances) {
        if (instance.logits?.length !== result.width * result.height) throw new Error('Incomplete instance logits');
      }
      output = result; elapsed = performance.now() - start;
      picker.append(new Option(`All instances (${output.instances.length})`, 'all'));
      for (const instance of output.instances) picker.append(new Option(`#${instance.index} - ${(instance.score * 100).toFixed(1)}%`, String(instance.index)));
      picker.value = 'all';
      redraw();
      status(output.instances.length ? `${output.instances.length} instances - ${(elapsed / 1000).toFixed(1)}s` : `No matching instances - ${(elapsed / 1000).toFixed(1)}s`);
      el('result').textContent = `${promptText} | WebGPU | image cache ${output.imageCache.status}`;
    } catch (error) { fail(error); }
    finally { invocation.completedAtMs = performance.now(); operation = null; busy = false; controls(); }
    return output;
  }
  async function save(kind, addToScene = false) {
    if (busy || !output?.instances.length) return;
    const indices = selectedIndices();
    busy = true; controls();
    try {
      const width = image.naturalWidth, height = image.naturalHeight;
      const mask = createSam3SourceMask(output, indices, width, height);
      const exported = document.createElement('canvas'); exported.width = width; exported.height = height;
      const context = exported.getContext('2d');
      if (kind === 'cutout') context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, width, height);
      for (let i = 0; i < mask.length; i += 1) {
        if (kind === 'mask') {
          pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = mask[i] * 255;
          pixels.data[i * 4 + 3] = 255;
        } else pixels.data[i * 4 + 3] *= mask[i];
      }
      context.putImageData(pixels, 0, 0);
      const blob = await new Promise((resolve, reject) => exported.toBlob(value => value ? resolve(value) : reject(new Error('PNG export failed')), 'image/png'));
      const stem = (source.name || 'image').replace(/\.[^.]+$/, '');
      const prompt = output.promptText.replace(/[^A-Za-z0-9_-]+/g, '-');
      const name = `${stem}-${prompt}-${picker.value}-${kind}.png`;
      const entry = await ingest(blob, name);
      if (addToScene) await onScene?.(entry, { sourceImage: source.source, promptText: output.promptText, invocationId: output.invocationId, indices });
      else {
        const link = document.createElement('a'); link.href = entry.source; link.download = name; link.click();
      }
      status(`Saved ${kind} - ${width} x ${height}`);
      return entry;
    } catch (error) { fail(error); throw error; }
    finally { busy = false; controls(); }
  }
  el('open').onclick = () => el('file').click();
  el('file').onchange = () => { const file = el('file').files[0]; if (file) void open(file).catch(() => {}); el('file').value = ''; };
  el('form').onsubmit = event => { event.preventDefault(); void run(); };
  picker.onchange = redraw;
  for (const button of document.querySelectorAll('[data-sam-image-view]')) button.onclick = () => {
    view = button.dataset.samImageView;
    for (const option of document.querySelectorAll('[data-sam-image-view]')) option.setAttribute('aria-pressed', String(option === button));
    redraw();
  };
  for (const kind of ['mask', 'cutout']) el(`save-${kind}`).onclick = () => void save(kind).catch(() => {});
  el('add-cutout').onclick = () => void save('cutout', true).catch(() => {});
  el('unload').onclick = async () => { const previous = runtime; runtime = null; controls(); await previous?.close(); status('Model unloaded'); };
  const drop = event => {
    if (!active) return;
    event.preventDefault(); event.stopPropagation();
    const file = [...event.dataTransfer.files].find(file => file.type.startsWith('image/'));
    if (file) void open(file).catch(() => {});
  };
  el('viewport').addEventListener('dragover', event => { if (active) event.preventDefault(); });
  el('viewport').addEventListener('drop', drop);
  const paste = event => {
    if (!active) return;
    const item = [...(event.clipboardData?.items || [])].find(item => item.kind === 'file' && item.type.startsWith('image/'));
    if (item) { event.preventDefault(); void open(item.getAsFile()).catch(() => {}); }
  };
  window.addEventListener('paste', paste);
  controls();
  status(config?.mounted ? 'No image selected' : 'SAM model not mounted');
  return {
    open, run, save,
    setActive(value) { active = value; if (active && foreground) foreground.drawNow(); },
    output: () => output,
    evidence: () => ({ source, elapsedMs: elapsed, busy, invocation: invocation && { ...invocation }, error: failure?.message || null,
      runtime: runtime?.evidence() || null, foreground: foreground?.evidence() || null,
      sameDevice: executionDevice ? executionDevice === inferenceSession.device : null,
      sameRendererDevice: rendererDevice === inferenceSession.device,
    }),
    async close() { window.removeEventListener('paste', paste); await runtime?.close(); foreground?.close(); },
  };
}
