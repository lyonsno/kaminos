import assert from 'node:assert/strict';

import {
  WEBGPU_COMMAND_DUTY_DESCRIPTOR_SCHEMA,
  WEBGPU_COMMAND_DUTY_OBSERVATION_SCHEMA,
  createWebGpuCommandDutyDescriptor,
  createWebGpuCommandDutyObservation,
} from '../src/index.js';

const identity = {
  routeId: 'sharp.image-to-splat.webgpu-local.v0',
  runId: 'sharp-run-duty-a',
  clockId: 'sharp-worker-clock-a',
};

const spnDuty = createWebGpuCommandDutyDescriptor({
  ...identity,
  dutyId: 'sharp-run-duty-a:spn-fusion:0',
  phase: 'spn-fusion',
  kind: 'compute',
  chunkControl: {
    controlId: 'spnFusionOutputItems',
    unit: 'output-item',
    current: 8,
    bounds: { min: 1, max: 8, stepFactor: 2 },
  },
  metadata: { kernel: 'spn-fusion-output' },
});

assert.equal(spnDuty.schema, WEBGPU_COMMAND_DUTY_DESCRIPTOR_SCHEMA);
assert.equal(spnDuty.routeId, identity.routeId);
assert.equal(spnDuty.runId, identity.runId);
assert.equal(spnDuty.clockId, identity.clockId);
assert.equal(spnDuty.kind, 'compute');
assert.deepEqual(spnDuty.submissionBoundary, {
  interruptible: false,
  canSplitBefore: true,
  canSplitAfter: true,
  authority: 'submitted-command-buffer-non-preemptible',
});
assert.deepEqual(spnDuty.chunkControl, {
  controlId: 'spnFusionOutputItems',
  unit: 'output-item',
  current: 8,
  bounds: { min: 1, max: 8, stepFactor: 2 },
});

const monodepthDuty = createWebGpuCommandDutyDescriptor({
  ...identity,
  dutyId: 'sharp-run-duty-a:monodepth:0',
  phase: 'monodepth',
  kind: 'compute',
  chunkControl: null,
});

const observed = createWebGpuCommandDutyObservation({
  ...identity,
  firingId: 'kiln-firing-duty-a',
  duties: [
    {
      descriptor: spnDuty,
      observedDurationMs: 72,
      foregroundOverlapDurationMs: 64,
    },
    {
      descriptor: monodepthDuty,
      observedDurationMs: 20,
      foregroundOverlapDurationMs: 16,
    },
  ],
});

assert.equal(observed.schema, WEBGPU_COMMAND_DUTY_OBSERVATION_SCHEMA);
assert.equal(observed.status, 'observed');
assert.equal(observed.retention, 'uncapped');
assert.equal(observed.dutyCount, 2);
assert.deepEqual(observed.identity, { ...identity, firingId: 'kiln-firing-duty-a' });
assert.deepEqual(
  observed.duties.map(row => [
    row.descriptor.dutyId,
    row.observedDurationMs,
    row.foregroundOverlapDurationMs,
  ]),
  [
    ['sharp-run-duty-a:spn-fusion:0', 72, 64],
    ['sharp-run-duty-a:monodepth:0', 20, 16],
  ],
);

const sf3dDuty = createWebGpuCommandDutyDescriptor({
  routeId: 'sf3d.image-to-mesh.webgpu-local.v0',
  runId: 'sf3d-run-duty-a',
  clockId: 'sf3d-worker-clock-a',
  dutyId: 'sf3d-run-duty-a:triplane-attention:0',
  phase: 'triplane-attention',
  kind: 'compute',
  chunkControl: {
    controlId: 'attentionTiles',
    unit: 'attention-tile',
    current: 16,
    bounds: { min: 1, max: 64, stepFactor: 2 },
  },
});
assert.equal(sf3dDuty.chunkControl.controlId, 'attentionTiles');
assert.equal(sf3dDuty.submissionBoundary.interruptible, false);

for (const [name, input, pattern] of [
  ['missing route', { ...identity, routeId: '', dutyId: 'duty', phase: 'phase', kind: 'compute' }, /routeId/],
  ['missing run', { ...identity, runId: '', dutyId: 'duty', phase: 'phase', kind: 'compute' }, /runId/],
  ['missing clock', { ...identity, clockId: '', dutyId: 'duty', phase: 'phase', kind: 'compute' }, /clockId/],
  ['bad bounds', { ...identity, dutyId: 'duty', phase: 'phase', kind: 'compute', chunkControl: { controlId: 'items', unit: 'item', current: 8, bounds: { min: 1, max: 8, stepFactor: 1 } } }, /stepFactor/],
  ['outside bounds', { ...identity, dutyId: 'duty', phase: 'phase', kind: 'compute', chunkControl: { controlId: 'items', unit: 'item', current: 16, bounds: { min: 1, max: 8, stepFactor: 2 } } }, /outside.*bounds/],
  ['caller preemption claim', { ...identity, dutyId: 'duty', phase: 'phase', kind: 'compute', interruptible: true }, /non-preemptible/],
]) {
  assert.throws(
    () => createWebGpuCommandDutyDescriptor(input),
    pattern,
    `${name} must not produce a command-duty descriptor`,
  );
}

for (const [name, mutate, pattern] of [
  ['route mismatch', row => { row.descriptor = { ...row.descriptor, routeId: 'stale-route' }; }, /route identity mismatch/],
  ['run mismatch', row => { row.descriptor = { ...row.descriptor, runId: 'stale-run' }; }, /run identity mismatch/],
  ['clock mismatch', row => { row.descriptor = { ...row.descriptor, clockId: 'stale-clock' }; }, /clock identity mismatch/],
  ['overlap exceeds duty', row => { row.foregroundOverlapDurationMs = 73; }, /overlap.*duration/],
]) {
  const row = {
    descriptor: structuredClone(spnDuty),
    observedDurationMs: 72,
    foregroundOverlapDurationMs: 64,
  };
  mutate(row);
  assert.throws(
    () => createWebGpuCommandDutyObservation({
      ...identity,
      firingId: `kiln-${name}`,
      duties: [row],
    }),
    pattern,
  );
}

assert.throws(
  () => createWebGpuCommandDutyObservation({
    ...identity,
    firingId: 'kiln-duplicate-duty',
    duties: [
      { descriptor: spnDuty, observedDurationMs: 72, foregroundOverlapDurationMs: 64 },
      { descriptor: spnDuty, observedDurationMs: 72, foregroundOverlapDurationMs: 64 },
    ],
  }),
  /duplicate dutyId/,
);

assert.throws(
  () => createWebGpuCommandDutyObservation({
    ...identity,
    firingId: 'kiln-capped-duty',
    duties: [],
    maxDuties: 10,
  }),
  /uncapped/,
);

assert.throws(
  () => createWebGpuCommandDutyObservation({
    ...identity,
    firingId: 'kiln-forged-duty',
    duties: [{
      descriptor: {
        ...spnDuty,
        kind: 'imaginary-command-kind',
        submissionBoundary: {
          ...spnDuty.submissionBoundary,
          canSplitBefore: false,
        },
      },
      observedDurationMs: 72,
      foregroundOverlapDurationMs: 64,
    }],
  }),
  /descriptor.*invalid|kind must be one of|submission boundary/i,
  'an observation must revalidate descriptors instead of trusting a schema label',
);

assert.throws(
  () => createWebGpuCommandDutyObservation({
    ...identity,
    firingId: 'kiln-forged-boundary-duty',
    duties: [{
      descriptor: {
        ...spnDuty,
        submissionBoundary: {
          ...spnDuty.submissionBoundary,
          canSplitBefore: false,
        },
      },
      observedDurationMs: 72,
      foregroundOverlapDurationMs: 64,
    }],
  }),
  /submission boundary/i,
  'an observation must reject forged command-boundary authority',
);

console.log('command duty descriptor contracts passed');
