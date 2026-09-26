import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The finger-fluid -> Pyro liquid-contact route hands the volume a descriptor
// on the fluid solver's own GPUDevice, and the prototype refuses descriptors
// from any other configured shared device. The host's kiln shared device must
// therefore not be seated on the volume for that route. This evaluates the
// real index.html wiring and the real prototype (stubbed DOM, no GPU).
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const routeStart = html.indexOf('async function initKaminosVolumeRoute()');
const constructAt = html.indexOf('volumePrototype = createKaminosVolumePrototype({', routeStart);
assert.ok(routeStart >= 0 && constructAt > routeStart, 'volume route constructs the prototype');
const contextLine = html.slice(constructAt, html.indexOf('\n  });', constructAt)).match(/sharedGpuContext:\s*([^\n]+?),\n/);
assert.ok(contextLine, 'prototype construction passes a sharedGpuContext expression');
const contextFor = (compositionRequested, sharedGpu) => new Function('fingerFluidPyroCompositionRequested', 'sharedGpu',
  `return (${contextLine[1]});`)(() => compositionRequested, sharedGpu);

const stub = () => new Proxy(function () {}, {
  get(target, prop) {
    if (prop === Symbol.toPrimitive) return () => 0;
    if (prop === 'then') return undefined;
    return target[prop] ?? (target[prop] = stub());
  },
  set(target, prop, value) { target[prop] = value; return true; },
  apply() { return stub(); },
  construct() { return stub(); },
});
globalThis.document = stub();
globalThis.window = globalThis.window || stub();
globalThis.requestAnimationFrame = () => 0;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
const { createKaminosVolumePrototype } = await import('../volume-core.js');
const hostShared = { identity: 'kaminos-three-volume-shared-webgpu-device-v0', device: { queue: { submit() {} } } };
hostShared.queue = hostShared.device.queue;
const solverDevice = { queue: { submit() {} } };
const bindSolverDescriptor = sharedGpuContext => {
  const prototype = createKaminosVolumePrototype({ THREE: stub(), viewport: stub(), camera: stub(), controls: stub(),
    getControls: () => ({}), onStatus: () => {}, sharedGpuContext });
  try {
    prototype.setLiquidFireContactDescriptor({ device: solverDevice, queue: solverDevice.queue });
    return 'admitted';
  } catch (error) {
    return error.message;
  }
};

assert.match(bindSolverDescriptor(hostShared), /conflicts with the configured shared GPUDevice/,
  'control: a volume seated on the host device refuses the solver device');
const compositionResult = bindSolverDescriptor(contextFor(true, hostShared));
// The fake descriptor is not schema-valid, so reaching schema validation is the
// proof that the device check admitted the solver device.
assert.match(compositionResult, /Liquid fire contact descriptor schema mismatch/,
  `liquid-contact composition must reach descriptor validation on the solver device, got: ${compositionResult}`);
assert.equal(contextFor(false, hostShared), hostShared, 'ordinary and kiln routes keep the one host shared device');

// The published fire light-field bounds are computed on every receiver poll.
const lightFieldPrototype = createKaminosVolumePrototype({ THREE: stub(), viewport: stub(), camera: stub(), controls: stub(),
  getControls: () => ({}), onStatus: () => {}, sharedGpuContext: hostShared });
const lightField = lightFieldPrototype.fireIrradianceLightField();
assert.deepEqual(lightField.worldMax, [1, 3, 1]);
assert.deepEqual(lightField.raymarchWorldMax, [1, 3, 1], 'default tall domain reaches world y = 3');
assert.equal(lightField.worldBoundsAuthority, 'full-volume-domain-equal-cell-pitch-v1');
console.log('liquid fire contact shared-device contracts passed');
