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

let selectedSample = SAMPLE_IMAGES[0];
let selectedImage = null;
let activeInvocationId = null;
let positiveMaskFingerprint = null;
let runtimeReady = null;

function setStatus(state, text) {
  statusRoot.dataset.state = state;
  statusText.textContent = text;
}

function setBusy(busy) {
  runButton.disabled = busy;
  negativeButton.disabled = busy || positiveMaskFingerprint === null;
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
  for (let index = 0; index < output.mask.length; index += 1) {
    if (!output.mask[index]) continue;
    const pixel = index * 4;
    pixels.data[pixel] = 45;
    pixels.data[pixel + 1] = 199;
    pixels.data[pixel + 2] = 238;
    pixels.data[pixel + 3] = 168;
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
  for (let index = 0; index < output.mask.length; index += 1) {
    const on = Boolean(output.mask[index]);
    const pixel = index * 4;
    pixels.data[pixel] = on ? 224 : 12;
    pixels.data[pixel + 1] = on ? 247 : 15;
    pixels.data[pixel + 2] = on ? 252 : 17;
    pixels.data[pixel + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  document.getElementById('mask-meta').textContent = `${output.width} × ${output.height}`;
}

function maskFingerprint(output) {
  let hash = 2166136261;
  for (const value of output.mask) {
    hash ^= Number(value);
    hash = Math.imul(hash, 16777619);
  }
  return `${output.width}x${output.height}:${output.foregroundPixelCount}:${hash >>> 0}`;
}

function updateEvidence(output, controlKind) {
  const imageCacheText = output.imageCache?.status ? ` · image ${output.imageCache.status}` : '';
  document.getElementById('effective-route').textContent = output.receiptChain.length
    ? `${output.receiptChain.length} receipts · ${output.effectiveRouteId}${imageCacheText}`
    : `${output.effectiveRouteId}${imageCacheText}`;
  document.getElementById('output-authority').textContent = `${output.outputAuthority} · ${output.verificationState}`;
  document.getElementById('candidate-evidence').textContent = output.selectedCandidateCount === 0
    ? 'No candidate kept'
    : `#${output.selectedMaskIndex} · score ${Number(output.selectedScore).toFixed(4)}`;
  document.getElementById('foreground-evidence').textContent = `${output.foregroundPixelCount.toLocaleString()} / ${(output.width * output.height).toLocaleString()} px`;
  document.getElementById('overlay-meta').textContent = output.selectedCandidateCount === 0
    ? 'Empty selection'
    : `candidate ${output.selectedMaskIndex}`;

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
    runtimeFrame.src = `./sam-mask-island-serving.html?autorun=0&manifest=${encodeURIComponent(manifestUrl)}`;
  });
  return runtimeReady;
}

async function runMask(controlKind = 'positive') {
  const promptText = controlKind === 'negative-control'
    ? 'a purple submarine with zebra stripes'
    : promptInput.value.trim();
  if (!promptText) {
    setStatus('warning', 'Enter a prompt');
    promptInput.focus();
    return;
  }

  const invocationId = crypto.randomUUID();
  activeInvocationId = invocationId;
  setBusy(true);
  setStatus('running', 'Initializing browser route');
  const startedAt = performance.now();
  let phaseTimer = null;
  try {
    const runtime = await waitForRuntime();
    phaseTimer = window.setInterval(() => {
      const runtimeState = runtime.samMaskIslandParitySmokeState?.();
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
    drawMaskOverlay(selectedImage, output);
    drawRawMask(output);
    const evidenceState = updateEvidence(output, controlKind);
    const elapsedSeconds = ((performance.now() - startedAt) / 1000).toFixed(1);
    const resultText = output.selectedCandidateCount === 0
      ? `No candidate kept · ${elapsedSeconds}s`
      : `Mask complete · ${elapsedSeconds}s`;
    setStatus(evidenceState, resultText);
  } catch (error) {
    setStatus('failed', String(error?.message || error));
    console.error(error);
  } finally {
    if (phaseTimer) window.clearInterval(phaseTimer);
    if (activeInvocationId === invocationId) setBusy(false);
  }
}

async function selectSample(sample) {
  selectedSample = sample;
  promptInput.value = sample.prompt;
  for (const button of samplePicker.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.sampleId === sample.id));
  }
  setStatus('running', 'Loading sample');
  selectedImage = await loadImage(sample.file);
  drawSource(selectedImage);
  positiveMaskFingerprint = null;
  setBusy(false);
  document.getElementById('overlay-meta').textContent = 'No output';
  document.getElementById('control-evidence').textContent = 'Not run';
  setStatus('idle', 'Sample loaded');
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

selectSample(selectedSample).catch(error => setStatus('failed', error.message));
waitForRuntime().catch(error => setStatus('failed', error.message));
