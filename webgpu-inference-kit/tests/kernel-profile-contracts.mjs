import assert from 'node:assert/strict';

import {
  WEBGPU_INFERENCE_KIT_VERSION,
  createKernelProfileMetadata,
  createRouteKernelProfileMetadata,
  createRouteTimingMetadata,
  validateKernelProfileMetadata,
  validateRouteTimingMetadata,
} from '../src/index.js';

assert.equal(WEBGPU_INFERENCE_KIT_VERSION, '0.1.25');

const kernel = createKernelProfileMetadata({
  profile: 'conv-transpose2d-stride2',
  commit: 'a1bf4d3',
});
assert.deepEqual(kernel, {
  kitVersion: WEBGPU_INFERENCE_KIT_VERSION,
  profile: 'conv-transpose2d-stride2',
  commit: 'a1bf4d3',
});

assert.deepEqual(
  createKernelProfileMetadata({}, { defaultProfile: 'twostage-denoiser-ddim50-fk' }),
  {
    kitVersion: WEBGPU_INFERENCE_KIT_VERSION,
    profile: 'twostage-denoiser-ddim50-fk',
    commit: null,
  },
);

assert.deepEqual(validateKernelProfileMetadata(kernel), { ok: true, errors: [] });
assert.equal(validateKernelProfileMetadata({ kitVersion: '0.0.0', profile: '', commit: null }).ok, false);
assert.equal(
  createKernelProfileMetadata({ kitVersion: 'consumer-override', profile: 'custom-profile' }).kitVersion,
  'consumer-override',
);
assert.throws(
  () => createKernelProfileMetadata({}, { requireProfile: true }),
  /kernel.profile must be a non-empty string/,
);

const requiredStages = ['backbone', 'decoder-heads', 'output-readback'];
const timing = createRouteTimingMetadata({ requiredStages, timingSource: 'queue-submit-wait' });
assert.deepEqual(timing, {
  requiredStages: ['backbone', 'decoder-heads', 'output-readback'],
  timingSource: 'queue-submit-wait',
});
requiredStages.push('mutated-after-call');
assert.deepEqual(timing.requiredStages, ['backbone', 'decoder-heads', 'output-readback']);
assert.deepEqual(validateRouteTimingMetadata(timing), { ok: true, errors: [] });
assert.equal(validateRouteTimingMetadata({ requiredStages: [], timingSource: '' }).ok, false);

const routeMetadata = createRouteKernelProfileMetadata({
  kernel: { profile: 'dinov2-two-stream-triplane-marching-tet-texture-bake' },
}, {
  defaultProfile: 'unused-default',
  requiredStages: ['image-preprocess', 'glb-export'],
  timingSource: 'adapter-phase-wall-clock',
});
assert.deepEqual(routeMetadata, {
  kernel: {
    kitVersion: WEBGPU_INFERENCE_KIT_VERSION,
    profile: 'dinov2-two-stream-triplane-marching-tet-texture-bake',
    commit: null,
  },
  requiredStages: ['image-preprocess', 'glb-export'],
  timingSource: 'adapter-phase-wall-clock',
});

console.log('kernel profile contracts passed');
