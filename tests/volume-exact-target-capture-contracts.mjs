import assert from 'node:assert/strict';
import { captureExactTargetFrame } from '../volume-exact-target-capture.mjs';

function makeHarness(sample) {
  const state = {
    raySteps: 24,
    appearanceMode: 'off',
    smokeMode: 'on',
    cameraPose: null,
  };
  const calls = [];
  const prototype = {
    debugState() {
      return {
        controls: { raySteps: state.raySteps },
        appearanceDecompositionModeRequestedRaw: state.appearanceMode,
        raymarchSmokePresentationModeRequestedRaw: state.smokeMode,
      };
    },
    setControls(controls) {
      calls.push(['setControls', controls]);
      state.raySteps = controls.raySteps;
    },
    setAppearanceDecompositionMode(mode) {
      calls.push(['setAppearanceDecompositionMode', mode]);
      state.appearanceMode = mode;
      return { effectiveMode: mode, targetIdentity: 'target', emissionMask: 'ridge-owned-plus-non-ridge', extinctionMask: 'complete-flame' };
    },
    setRaymarchSmokePresentationMode(mode) {
      calls.push(['setRaymarchSmokePresentationMode', mode]);
      state.smokeMode = mode;
      return { effectiveMode: mode };
    },
    async sampleFrame(options) {
      calls.push(['sampleFrame', options]);
      return sample;
    },
  };
  const basinWindow = {
    kaminosSetCameraDebugPose(pose) {
      calls.push(['kaminosSetCameraDebugPose', pose]);
      state.cameraPose = pose;
    },
    kaminosCameraDebugState() {
      return state.cameraPose;
    },
  };
  const environment = {
    crypto: globalThis.crypto,
    ImageData: class ImageData {
      constructor(data, width, height) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    },
    document: {
      createElement(tag) {
        assert.equal(tag, 'canvas');
        return {
          width: 0,
          height: 0,
          getContext(context) {
            assert.equal(context, '2d');
            return { putImageData() {} };
          },
          toDataURL() {
            return 'data:image/png;base64,exact-target';
          },
        };
      },
    },
  };
  return { state, calls, prototype, basinWindow, environment };
}

async function runCapture(sample) {
  const harness = makeHarness(sample);
  const capture = captureExactTargetFrame({
    prototype: harness.prototype,
    basinWindow: harness.basinWindow,
    fixedCameraPose: { position: [1, 2, 3], target: [0, 0, 0] },
    targetRaySteps: 160,
    targetMode: 'shared-transmittance-contribution-sum',
    stateId: 'coefficient-state-098',
    exactStateTimeMs: 1000,
    baseFrameCount: 44,
    baseSimStepCount: 98,
    environment: harness.environment,
  });
  return { ...harness, capture: await capture };
}

const brightRgba = new Uint8Array(9 * 9 * 4).fill(255);
const success = await runCapture({
  ok: true,
  frameCount: 44,
  simStepCount: 98,
  effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
  backend: 'WebGPU:apple',
  image: { width: 9, height: 9, rgba: brightRgba },
  volumePresentationReceipt: { effectiveRayQuality: { raySteps: 160 } },
});
assert.equal(success.capture.frameCount, 44);
assert.equal(success.capture.simStepCount, 98);
assert.equal(success.capture.effectiveRaySteps, 160);
assert.equal(success.capture.litPixels, 81);
assert.equal(success.state.raySteps, 24);
assert.equal(success.state.appearanceMode, 'off');
assert.equal(success.state.smokeMode, 'on');
const sampleCall = success.calls.find(([name]) => name === 'sampleFrame');
assert.equal(sampleCall[1].advanceSim, false);
assert.equal(sampleCall[1].includeRgba, true);
assert.equal(sampleCall[1].baseFrameCount, 44);
assert.equal(sampleCall[1].baseSimStepCount, 98);

for (const failure of [
  {
    label: 'inactive',
    sample: { ok: false, reason: 'inactive', active: false },
    pattern: /exact-target-sample-failed:inactive/,
  },
  {
    label: 'missing rgba',
    sample: { ok: true, image: { width: 9, height: 9 } },
    pattern: /exact-target-rgba-missing/,
  },
  {
    label: 'blank image',
    sample: { ok: true, image: { width: 9, height: 9, rgba: new Uint8Array(9 * 9 * 4) } },
    pattern: /exact-target-blank-image/,
  },
]) {
  const harness = makeHarness(failure.sample);
  await assert.rejects(
    captureExactTargetFrame({
      prototype: harness.prototype,
      basinWindow: harness.basinWindow,
      fixedCameraPose: { position: [1, 2, 3], target: [0, 0, 0] },
      targetRaySteps: 160,
      targetMode: 'shared-transmittance-contribution-sum',
      stateId: 'coefficient-state-098',
      exactStateTimeMs: 1000,
      baseFrameCount: 44,
      baseSimStepCount: 98,
      environment: harness.environment,
    }),
    failure.pattern,
    failure.label,
  );
  assert.equal(harness.state.raySteps, 24, `${failure.label} restores ray steps`);
  assert.equal(harness.state.appearanceMode, 'off', `${failure.label} restores appearance mode`);
  assert.equal(harness.state.smokeMode, 'on', `${failure.label} restores smoke mode`);
}

console.log('volume exact target capture contracts passed');
