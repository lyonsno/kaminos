import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { setImmediate as settle } from 'node:timers/promises';

const html = readFileSync(new URL('../smokes/sam-semantic-mask-workbench.html', import.meta.url), 'utf8');
const workbench = readFileSync(new URL('../smokes/sam-semantic-mask-workbench.js', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../smokes/sam-mask-island-parity.js', import.meta.url), 'utf8');

for (const id of [
  'sample-picker',
  'prompt-input',
  'run-segmentation',
  'run-negative-control',
  'source-canvas',
  'overlay-canvas',
  'mask-canvas',
  'workbench-status',
  'effective-route',
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `workbench must expose #${id}`);
}
assert.match(html, /sam-mask-runtime-frame/, 'workbench must host the existing SAM runtime composition');
assert.match(html, /aria-live=["']polite["']/, 'workbench status must be observable while the long browser route runs');

assert.match(workbench, /const SAMPLE_IMAGES\s*=\s*\[/, 'workbench must define selectable samples');
for (const sample of ['truck.jpg', 'groceries.jpg', 'test_image.jpg']) {
  assert.match(workbench, new RegExp(sample.replace('.', '\\.')), `workbench must include ${sample}`);
}
assert.match(workbench, /runSam3Invocation\([^,]+,\s*\{[\s\S]*promptText[\s\S]*sourceImage[\s\S]*verificationMode:\s*['"]execution-only['"]/, 'workbench must pass dynamic prompt and image authority into the existing runtime');
assert.match(workbench, /samMaskIslandVisualOutput\(\)/, 'workbench must consume the runtime actual-mask output surface');
assert.match(workbench, /outputAuthority\s*!==\s*['"]actual-webgpu-readback['"]/, 'workbench must reject expected, fixture, cached, or unidentified masks');
assert.match(workbench, /invocationId\s*!==\s*activeInvocationId/, 'workbench must reject stale output from an earlier run');
assert.match(workbench, /drawMaskOverlay/, 'workbench must render the selected GPU mask over the source image');
assert.match(workbench, /drawRawMask/, 'workbench must render the raw selected GPU mask independently');
assert.match(workbench, /negative-control/, 'workbench must offer a deliberately mismatched prompt control');
assert.match(workbench, /negativeButton\.disabled\s*=\s*busy\s*\|\|\s*positiveMaskFingerprint\s*===\s*null/, 'negative control must remain disabled until the current sample has a positive mask fingerprint');
assert.match(workbench, /selectedCandidateCount\s*===\s*0/, 'workbench must expose an honest empty result when selection keeps no candidate');

assert.match(runner, /verificationMode/, 'runtime must distinguish execution-only from reference-parity invocations');
assert.match(runner, /promptText/, 'runtime must accept a dynamic browser prompt');
assert.match(runner, /sourceImage/, 'runtime must accept dynamic source-image authority');
assert.match(runner, /sourceImageUrl\.origin\s*!==\s*window\.location\.origin/, 'dynamic source images must be same-origin');
assert.match(runner, /sourceImageUrl\.pathname\.startsWith\(['"]\/sam3-samples\/['"]\)/, 'dynamic workbench images must remain inside the authenticated sample namespace');
assert.match(runner, /runtimeOwner\s*===\s*['"]browser-workbench['"][\s\S]*manifest\.sourceImage\.file/, 'browser-workbench source inputs must bypass package-root artifact resolution only after same-origin validation');
assert.match(runner, /readArtifactText:\s*file\s*=>\s*fetchTextRaw\(resolveManifestFile\(file\)\)/, 'split package bootstrap JSON must use resolver-owned hash verification before the static cache is configured');
assert.match(runner, /window\.samMaskIslandVisualOutput/, 'runtime must expose actual mask output to a same-origin workbench');
assert.match(runner, /outputAuthority:\s*['"]actual-webgpu-readback['"]/, 'runtime output must identify actual GPU readback authority');
assert.match(runner, /verificationState:\s*['"]not-attached['"]/, 'execution-only dynamic work must not counterfeit parity passage');
assert.match(runner, /selectedCandidateCount\s*===\s*0[\s\S]*new Uint32Array/, 'runtime must not render candidate zero after an empty selection');
assert.match(runner, /if \(verificationAttached\)[\s\S]*WebGPU parity mismatch/, 'reference mismatch gates must remain load-bearing when verification is attached');

// Execute the actual readback-to-visual-output boundary, including non-top instances.
const visualBoundary = runner.slice(runner.indexOf('    const selectionKeep = result.debugReadback.selectionKeep'), runner.indexOf('    if (verificationAttached && hasMaskOutput)'));
const visualContext = {
  result: { debugReadback: {
    selectionKeep: new Uint32Array([1, 0, 1]),
    selectionScores: new Float32Array([0.7, 0.1, 0.9]),
    selectionBoxes: new Float32Array([0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 2, 2]),
  }, receipt: { effectiveRouteId: 'fixture' } },
  sam3TypedView: (Type, values) => values,
  gpuBinary: new Uint32Array([1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1]),
  gpuLogits: null, visualShape: { width: 2, height: 2 }, selectedMaskIndex: 2,
  selectedMaskIndexSource: 'gpu', invocationId: 'current', manifest: {},
  debugReadbackSamples: { selectedScore: [0.9] }, state: {}, window: {}, verificationAttached: false,
};
runInNewContext(`${visualBoundary}\nglobalThis.output = visualOutput;`, visualContext);
assert.deepEqual(Array.from(visualContext.output.instances || [], row => row.index), [0, 2],
  'visual output must preserve every retained candidate, not only the top mask');
assert.deepEqual(Array.from(visualContext.output.instances[0].mask), [1, 0, 0, 0]);
assert.deepEqual(Array.from(visualContext.output.instances[1].mask), [0, 0, 0, 1]);
assert.equal(visualContext.output.instances[0].foregroundPixelCount, 1);
assert.deepEqual(Array.from(visualContext.output.instances[1].box), [1, 1, 2, 2]);
visualContext.result.debugReadback.selectionKeep.fill(0);
runInNewContext(`{ ${visualBoundary}\nglobalThis.emptyOutput = visualOutput; }`, visualContext);
assert.equal(visualContext.emptyOutput.instances.length, 0, 'empty selection must expose no instances');

// Exercise the actual page controller with explicitly deferred image loads.
function controllerFixture() {
  const elements = new Map();
  const pendingImages = [];
  function element() {
    const context = {
      clearCount: 0, clearRect() { this.clearCount += 1; }, drawImage() {},
      createImageData(width, height) { return { data: new Uint8ClampedArray(width * height * 4) }; },
      putImageData(pixels) { this.pixels = pixels; },
    };
    return {
      dataset: {}, children: [], listeners: {}, textContent: '', disabled: false, value: '',
      append(child) { this.children.push(child); },
      replaceChildren(...children) { this.children = children; },
      querySelectorAll() { return this.children; },
      setAttribute() {}, addEventListener(name, callback) { this.listeners[name] = callback; },
      getContext() { return context; },
    };
  }
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    createElement: element,
  };
  const context = {
    document, URLSearchParams,
    window: { location: { search: `?commit=${'a'.repeat(40)}` }, addEventListener() {}, setTimeout() {}, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {} },
    Image: class {
      constructor() { this.naturalWidth = 800; this.naturalHeight = 600; pendingImages.push(this); }
    },
    console: { error() {} }, performance: { now: () => 1 }, crypto: { randomUUID: () => `invocation-${++sequence}` },
  };
  let sequence = 0;
  let output;
  const runtime = {
    failNext: false,
    async runSam3Invocation(url, input) {
      if (this.failNext) throw new Error('intentional rerun failure');
      output = {
        invocationId: input.invocationId, outputAuthority: 'actual-webgpu-readback', verificationState: 'not-attached',
        receiptChain: Array(10).fill({}), effectiveRouteId: 'fixture-route', imageCache: { status: 'miss' },
        width: 2, height: 2, mask: [1, 0, 0, 0], selectedCandidateCount: 2, foregroundPixelCount: 1, selectedMaskIndex: 0, selectedScore: 0.9,
        instances: [
          { index: 0, score: 0.9, box: [0, 0, 1, 1], mask: [1, 0, 0, 0], foregroundPixelCount: 1 },
          { index: 2, score: 0.7, box: [1, 1, 2, 2], mask: [0, 0, 0, 1], foregroundPixelCount: 1 },
        ],
      };
    },
    samMaskIslandVisualOutput: () => output,
  };
  runInNewContext(`${workbench}\nglobalThis.controller = { selectSample, runMask, samples: SAMPLE_IMAGES };`, context);
  return { context, elements, pendingImages, runtime, loadRuntime(value = runtime) {
    const frame = elements.get('sam-mask-runtime-frame');
    frame.contentWindow = value;
    frame.listeners.load();
  } };
}
const { context, elements, pendingImages, loadRuntime } = controllerFixture();
assert.equal(new URL(elements.get('sam-mask-runtime-frame').src, 'http://localhost/').searchParams.get('commit'), 'a'.repeat(40),
  'the serving realm must receive the same commit identity as the registered workbench');
assert.equal(elements.get('run-segmentation').disabled, true, 'run must wait for the selected image to load');
loadRuntime();
pendingImages[0].onload();
await settle();
assert.equal(elements.get('run-segmentation').disabled, false);
for (const id of ['effective-route', 'output-authority', 'candidate-evidence', 'foreground-evidence']) elements.get(id).textContent = 'previous result';
const clearCount = elements.get('mask-canvas').getContext().clearCount;
const firstSelection = context.controller.selectSample(context.controller.samples[1]);
assert.equal(elements.get('run-segmentation').disabled, true);
assert.ok(elements.get('mask-canvas').getContext().clearCount > clearCount, 'changing samples clears the old raw mask');
for (const id of ['effective-route', 'output-authority', 'candidate-evidence', 'foreground-evidence']) {
  assert.notEqual(elements.get(id).textContent, 'previous result', `${id} cannot describe the previous sample`);
}
const secondSelection = context.controller.selectSample(context.controller.samples[2]);
pendingImages[1].onload();
await firstSelection;
assert.equal(elements.get('run-segmentation').disabled, true, 'stale image completion must not enable the newer sample');
pendingImages[2].onload();
await secondSelection;
assert.equal(elements.get('run-segmentation').disabled, false);
assert.equal(elements.get('prompt-input').value, 'person');
const failedSelection = context.controller.selectSample(context.controller.samples[1]);
pendingImages[3].onerror();
await failedSelection;
assert.equal(elements.get('workbench-status').dataset.state, 'failed');
assert.equal(elements.get('run-segmentation').disabled, true, 'failed image load cannot run against the previous image');
assert.ok(elements.get('sample-picker').children.every(button => !button.disabled), 'another sample remains selectable after failure');

const rerun = controllerFixture();
rerun.loadRuntime();
rerun.pendingImages[0].onload();
await settle();
await rerun.context.controller.runMask();
assert.equal(rerun.elements.get('workbench-status').dataset.state, 'complete');
assert.equal(rerun.elements.get('run-negative-control').disabled, false);
assert.equal(rerun.elements.get('mask-canvas').getContext().pixels.data[12], 224,
  'default raw view must include the non-top retained mask');
const instancePicker = rerun.elements.get('instance-picker');
assert.equal(instancePicker.children.length, 3, 'all instances plus each retained candidate must be selectable');
instancePicker.value = '2';
instancePicker.listeners.change();
assert.equal(rerun.elements.get('mask-canvas').getContext().pixels.data[0], 12,
  'selecting an instance must remove other masks from the raw view');
assert.equal(rerun.elements.get('mask-canvas').getContext().pixels.data[12], 224);
const priorClears = rerun.elements.get('mask-canvas').getContext().clearCount;
rerun.runtime.failNext = true;
rerun.elements.get('prompt-input').value = 'different prompt';
await rerun.context.controller.runMask();
assert.equal(rerun.elements.get('workbench-status').dataset.state, 'failed');
assert.equal(rerun.elements.get('run-negative-control').disabled, true, 'failed positive rerun must invalidate the prior positive control');
assert.ok(rerun.elements.get('mask-canvas').getContext().clearCount > priorClears, 'failed rerun cannot retain the previous raw mask');
assert.equal(rerun.elements.get('candidate-evidence').textContent, 'Not run');
assert.equal(rerun.elements.get('control-evidence').textContent, 'Not run');

const failedRuntime = controllerFixture();
failedRuntime.loadRuntime({});
await settle();
assert.equal(failedRuntime.elements.get('workbench-status').dataset.state, 'failed');
failedRuntime.pendingImages[0].onload();
await settle();
assert.equal(failedRuntime.elements.get('workbench-status').dataset.state, 'failed', 'image success must not overwrite runtime failure');
assert.equal(failedRuntime.elements.get('run-segmentation').disabled, true);

await import('./sam-workbench-foreground-contracts.mjs');
console.log('sam semantic mask workbench contracts passed');
