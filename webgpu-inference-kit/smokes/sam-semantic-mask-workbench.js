const SAMPLE_IMAGES = [
  {
    id: 'truck',
    label: 'Pickup truck',
    file: '/sam3-samples/truck.jpg',
    prompt: 'truck',
    sha256: 'sha256:941715e721c8864324a1425b445ea4dde0498b995c45ddce0141a58971c6ff99',
    encodedResolution: [1800, 1200],
  },
  {
    id: 'groceries',
    label: 'Grocery bags',
    file: '/sam3-samples/groceries.jpg',
    prompt: 'paper bag',
    sha256: 'sha256:7073dfecb5a3ecafb6152124113163a0ea1c1c70f92999ec892b519eca63e3d3',
    encodedResolution: [800, 534],
  },
  {
    id: 'people',
    label: 'Basketball players',
    file: '/sam3-samples/test_image.jpg',
    prompt: 'person',
    sha256: 'sha256:979f120edcb0050a12d5b4a1f1eaf6bc888b89f675524e7ffcf6ae5b77aa6bc4',
    encodedResolution: [1280, 720],
  },
];

const params = new URLSearchParams(window.location.search);
const manifestUrl = params.get('manifest') || '/workbench-packet/tensor-manifest.json';
const runtimeFrame = document.getElementById('sam-mask-runtime-frame');
const samplePicker = document.getElementById('sample-picker');
const promptForm = document.getElementById('prompt-form');
const promptInput = document.getElementById('prompt-input');
const runButton = document.getElementById('run-segmentation');
const negativeButton = document.getElementById('run-negative-control');
const statusRoot = document.getElementById('workbench-status');
const statusText = document.getElementById('status-text');
const sourceCanvas = document.getElementById('source-canvas');
const overlayCanvas = document.getElementById('overlay-canvas');
const maskCanvas = document.getElementById('mask-canvas');
const instancePicker = document.getElementById('instance-picker');

let selectedSample = SAMPLE_IMAGES[0];
let selectedImage = null;
let activeInvocationId = null;
let positiveMaskFingerprint = null;
let runtimeReady = null;
let runtimeAvailable = false;
let runtimeFailure = null;
let sampleLoadVersion = 0;
let currentOutput = null;

function visibleInstances(output) {
  return instancePicker.value === 'all'
    ? output.instances
    : output.instances.filter(instance => String(instance.index) === instancePicker.value);
}

function visibleMask(output) {
  const mask = new Uint32Array(output.width * output.height);
  for (const instance of visibleInstances(output)) {
    for (let index = 0; index < mask.length; index += 1) mask[index] |= instance.mask[index];
  }
  return mask;
}

function clearInstances() {
  currentOutput = null;
  instancePicker.replaceChildren();
  instancePicker.disabled = true;
}

function showInstances(output) {
  currentOutput = output;
  instancePicker.replaceChildren();
  const all = document.createElement('option');
  all.value = 'all';
  all.textContent = `All instances (${output.instances.length})`;
  instancePicker.append(all);
  for (const instance of output.instances) {
    const option = document.createElement('option');
    option.value = String(instance.index);
    option.textContent = `#${instance.index} - ${instance.score.toFixed(4)}`;
    instancePicker.append(option);
  }
  instancePicker.value = 'all';
  instancePicker.disabled = output.instances.length === 0;
}

function setStatus(state, text) {
  statusRoot.dataset.state = state;
  statusText.textContent = text;
}

function setBusy(busy) {
  runButton.disabled = busy || !selectedImage || !runtimeAvailable || runtimeFailure !== null;
  negativeButton.disabled = busy || positiveMaskFingerprint === null || runButton.disabled;
  promptInput.disabled = busy;
  for (const button of samplePicker.querySelectorAll('button')) button.disabled = busy;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`sample image failed to load: ${url}`));
    image.src = url;
  });
}

function setSourceCanvasSize(image) {
  const maxWidth = 960;
  const width = Math.min(maxWidth, image.naturalWidth);
  const height = Math.round(width * image.naturalHeight / image.naturalWidth);
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  overlayCanvas.width = width;
  overlayCanvas.height = height;
  document.getElementById('source-meta').textContent = `${image.naturalWidth} × ${image.naturalHeight}`;
}

function drawSource(image) {
  setSourceCanvasSize(image);
  const context = sourceCanvas.getContext('2d');
  context.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
  context.drawImage(image, 0, 0, sourceCanvas.width, sourceCanvas.height);
  const overlayContext = overlayCanvas.getContext('2d');
  overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  overlayContext.drawImage(image, 0, 0, overlayCanvas.width, overlayCanvas.height);
}

function drawMaskOverlay(image, output) {
  const context = overlayCanvas.getContext('2d');
  context.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  context.drawImage(image, 0, 0, overlayCanvas.width, overlayCanvas.height);

  const maskLayer = document.createElement('canvas');
  maskLayer.width = output.width;
  maskLayer.height = output.height;
  const maskContext = maskLayer.getContext('2d');
  const pixels = maskContext.createImageData(output.width, output.height);
  const palette = [[45, 199, 238], [245, 176, 65], [218, 113, 190], [116, 216, 133]];
  for (const instance of visibleInstances(output)) {
    const color = palette[instance.index % palette.length];
    for (let index = 0; index < instance.mask.length; index += 1) {
      if (!instance.mask[index]) continue;
      const pixel = index * 4;
      pixels.data[pixel] = color[0];
      pixels.data[pixel + 1] = color[1];
      pixels.data[pixel + 2] = color[2];
      pixels.data[pixel + 3] = 168;
    }
  }
  maskContext.putImageData(pixels, 0, 0);
  context.imageSmoothingEnabled = false;
  context.drawImage(maskLayer, 0, 0, overlayCanvas.width, overlayCanvas.height);
  context.imageSmoothingEnabled = true;
}

function drawRawMask(output) {
  maskCanvas.width = output.width;
  maskCanvas.height = output.height;
  const context = maskCanvas.getContext('2d');
  const pixels = context.createImageData(output.width, output.height);
  const mask = visibleMask(output);
  for (let index = 0; index < mask.length; index += 1) {
    const on = Boolean(mask[index]);
    const pixel = index * 4;
    pixels.data[pixel] = on ? 224 : 12;
    pixels.data[pixel + 1] = on ? 247 : 15;
    pixels.data[pixel + 2] = on ? 252 : 17;
    pixels.data[pixel + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  document.getElementById('mask-meta').textContent = `${output.width} × ${output.height}`;
  const foreground = mask.reduce((count, value) => count + (value ? 1 : 0), 0);
  document.getElementById('foreground-evidence').textContent = `${foreground.toLocaleString()} / ${mask.length.toLocaleString()} px`;
  document.getElementById('overlay-meta').textContent = instancePicker.value === 'all'
    ? `${output.instances.length} instances` : `candidate ${instancePicker.value}`;
}

function maskFingerprint(output) {
  let hash = 2166136261;
  for (const instance of output.instances) {
    hash = Math.imul(hash ^ instance.index, 16777619);
    for (const value of instance.mask) {
      hash ^= Number(value);
      hash = Math.imul(hash, 16777619);
    }
  }
  return `${output.width}x${output.height}:${output.instances.length}:${hash >>> 0}`;
}

function updateEvidence(output, controlKind) {
  const imageCacheText = output.imageCache?.status ? ` · image ${output.imageCache.status}` : '';
  document.getElementById('effective-route').textContent = output.receiptChain.length
    ? `${output.receiptChain.length} receipts · ${output.effectiveRouteId}${imageCacheText}`
    : `${output.effectiveRouteId}${imageCacheText}`;
  document.getElementById('output-authority').textContent = `${output.outputAuthority} · ${output.verificationState}`;
  document.getElementById('candidate-evidence').textContent = output.selectedCandidateCount === 0
    ? 'No candidate kept'
    : `${output.instances.length} kept · top #${output.selectedMaskIndex} · ${Number(output.selectedScore).toFixed(4)}`;

  const fingerprint = maskFingerprint(output);
  if (controlKind === 'negative-control') {
    const controlText = output.selectedCandidateCount === 0
      ? 'Empty as expected'
      : positiveMaskFingerprint === fingerprint
        ? 'Failed: identical to positive'
        : 'Different from positive';
    document.getElementById('control-evidence').textContent = controlText;
    return controlText.startsWith('Failed') ? 'warning' : 'complete';
  }
  positiveMaskFingerprint = fingerprint;
  document.getElementById('control-evidence').textContent = 'Positive captured';
  return output.selectedCandidateCount === 0 ? 'warning' : 'complete';
}

function validateRuntimeOutput(output, invocationId) {
  if (!output) throw new Error('SAM3 runtime returned no visual output');
  if (output.outputAuthority !== 'actual-webgpu-readback') throw new Error(`untrusted mask authority: ${output.outputAuthority || 'missing'}`);
  if (output.verificationState !== 'not-attached') throw new Error(`dynamic invocation verification state is ${output.verificationState || 'missing'}`);
  if (output.invocationId !== activeInvocationId || output.invocationId !== invocationId) throw new Error('stale SAM3 invocation output rejected');
  if (!Number.isInteger(output.width) || !Number.isInteger(output.height) || output.width <= 0 || output.height <= 0) throw new Error('invalid mask dimensions');
  if (!output.mask || output.mask.length !== output.width * output.height) throw new Error('partial or blank mask payload');
  if (!Array.isArray(output.instances) || output.instances.length !== output.selectedCandidateCount) throw new Error('partial instance payload');
  const indices = new Set();
  for (const instance of output.instances) {
    if (!Number.isInteger(instance.index) || instance.index < 0 || indices.has(instance.index)) throw new Error('invalid or duplicate instance index');
    indices.add(instance.index);
    if (!Number.isFinite(instance.score) || instance.score < 0 || instance.score > 1) throw new Error('invalid instance score');
    if (!instance.mask || instance.mask.length !== output.width * output.height) throw new Error('partial instance mask');
    let foreground = 0;
    for (const value of instance.mask) {
      if (value !== 0 && value !== 1) throw new Error('invalid binary instance mask');
      foreground += value;
    }
    if (foreground !== instance.foregroundPixelCount) throw new Error('instance foreground count mismatch');
  }
  if (!Array.isArray(output.receiptChain) || output.receiptChain.length < 10) throw new Error('incomplete SAM3 composition receipt chain');
  if (!['miss', 'hit'].includes(output.imageCache?.status)) throw new Error(`invalid image-cache route: ${output.imageCache?.status || 'missing'}`);
  if (output.selectedCandidateCount === 0 && output.foregroundPixelCount !== 0) throw new Error('empty selection exposed a non-empty candidate mask');
}

function waitForRuntime() {
  if (runtimeReady) return runtimeReady;
  runtimeReady = new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('SAM3 runtime frame did not initialize')), 30_000);
    runtimeFrame.addEventListener('load', () => {
      window.clearTimeout(timeout);
      const runtime = runtimeFrame.contentWindow;
      if (typeof runtime?.runSam3Invocation !== 'function' || typeof runtime?.samMaskIslandVisualOutput !== 'function') {
        reject(new Error('SAM3 runtime frame is missing invocation APIs'));
        return;
      }
      resolve(runtime);
    }, { once: true });
    const runtimeParams = new URLSearchParams({ autorun: '0', manifest: manifestUrl });
    if (params.has('commit')) runtimeParams.set('commit', params.get('commit'));
    runtimeFrame.src = `./sam-mask-island-serving.html?${runtimeParams}`;
  }).then(runtime => {
    runtimeAvailable = true;
    if (selectedImage) {
      setBusy(false);
      setStatus('idle', 'Sample loaded');
    }
    return runtime;
  }, error => {
    runtimeFailure = error;
    setBusy(false);
    setStatus('failed', error.message);
    throw error;
  });
  return runtimeReady;
}

async function runMask(controlKind = 'positive') {
  if (!selectedImage || runButton.disabled) return;
  const promptText = controlKind === 'negative-control'
    ? 'a purple submarine with zebra stripes'
    : promptInput.value.trim();
  if (!promptText) {
    setStatus('warning', 'Enter a prompt');
    promptInput.focus();
    return;
  }

  const invocationId = crypto.randomUUID();
  clearInstances();
  if (controlKind === 'positive') positiveMaskFingerprint = null;
  drawSource(selectedImage);
  maskCanvas.getContext('2d').clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  for (const id of ['effective-route', 'output-authority', 'candidate-evidence', 'foreground-evidence', 'control-evidence', 'mask-meta']) {
    document.getElementById(id).textContent = 'Not run';
  }
  document.getElementById('overlay-meta').textContent = 'No output';
  activeInvocationId = invocationId;
  setBusy(true);
  setStatus('running', 'Initializing browser route');
  const startedAt = performance.now();
  let phaseTimer = null;
  try {
    const runtime = await waitForRuntime();
    phaseTimer = window.setInterval(() => {
      const runtimeState = runtime.samMaskIslandProgress?.();
      if (runtimeState?.status && activeInvocationId === invocationId) {
        setStatus('running', runtimeState.status.replaceAll('-', ' '));
      }
    }, 250);

    await runtime.runSam3Invocation(manifestUrl, {
      invocationId,
      promptText,
      sourceImage: {
        url: selectedSample.file,
        sha256: selectedSample.sha256,
        artifactId: `image:sam3-workbench:${selectedSample.id}`,
        encodedResolution: selectedSample.encodedResolution,
      },
      verificationMode: 'execution-only',
    });
    const output = runtime.samMaskIslandVisualOutput();
    validateRuntimeOutput(output, invocationId);
    showInstances(output);
    drawMaskOverlay(selectedImage, output);
    drawRawMask(output);
    const evidenceState = updateEvidence(output, controlKind);
    const elapsedSeconds = ((performance.now() - startedAt) / 1000).toFixed(1);
    const resultText = output.selectedCandidateCount === 0
      ? `No candidate kept · ${elapsedSeconds}s`
      : `Mask complete · ${elapsedSeconds}s`;
    setStatus(evidenceState, resultText);
  } catch (error) {
    positiveMaskFingerprint = null;
    setStatus('failed', String(error?.message || error));
    console.error(error);
  } finally {
    if (phaseTimer) window.clearInterval(phaseTimer);
    if (activeInvocationId === invocationId) setBusy(false);
  }
}

async function selectSample(sample) {
  const loadVersion = ++sampleLoadVersion;
  selectedSample = sample;
  selectedImage = null;
  clearInstances();
  positiveMaskFingerprint = null;
  setBusy(true);
  promptInput.value = sample.prompt;
  for (const button of samplePicker.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.sampleId === sample.id));
  }
  setStatus(runtimeFailure ? 'failed' : 'running', runtimeFailure?.message || 'Loading sample');
  for (const canvas of [sourceCanvas, overlayCanvas, maskCanvas]) {
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  }
  for (const id of ['effective-route', 'output-authority', 'candidate-evidence', 'foreground-evidence', 'source-meta', 'mask-meta']) {
    document.getElementById(id).textContent = 'Not run';
  }
  document.getElementById('overlay-meta').textContent = 'No output';
  document.getElementById('control-evidence').textContent = 'Not run';
  try {
    const image = await loadImage(sample.file);
    if (loadVersion !== sampleLoadVersion) return;
    selectedImage = image;
    drawSource(image);
    setBusy(false);
    setStatus(runtimeFailure ? 'failed' : runtimeAvailable ? 'idle' : 'running',
      runtimeFailure?.message || (runtimeAvailable ? 'Sample loaded' : 'Initializing browser route'));
  } catch (error) {
    if (loadVersion !== sampleLoadVersion) return;
    for (const button of samplePicker.querySelectorAll('button')) button.disabled = false;
    setStatus('failed', runtimeFailure?.message || error.message);
  }
}

for (const sample of SAMPLE_IMAGES) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sample-button';
  button.dataset.sampleId = sample.id;
  button.textContent = sample.label;
  button.setAttribute('aria-pressed', String(sample === selectedSample));
  button.addEventListener('click', () => selectSample(sample).catch(error => setStatus('failed', error.message)));
  samplePicker.append(button);
}

promptForm.addEventListener('submit', event => {
  event.preventDefault();
  runMask('positive');
});
negativeButton.addEventListener('click', () => runMask('negative-control'));
instancePicker.addEventListener('change', () => {
  if (!currentOutput || !selectedImage) return;
  drawMaskOverlay(selectedImage, currentOutput);
  drawRawMask(currentOutput);
});

selectSample(selectedSample).catch(error => setStatus('failed', error.message));
waitForRuntime().catch(error => setStatus('failed', error.message));
