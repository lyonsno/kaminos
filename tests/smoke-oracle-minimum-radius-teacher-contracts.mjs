import assert from 'node:assert/strict';

import {
  admitMinimumRadiusTeacherWindow,
  assessMinimumRadiusMaturityCandidate,
  buildMinimumRadiusTeacherContract,
  validateMinimumRadiusEffectiveState,
} from '../smoke-oracle-minimum-radius-teacher.mjs';

const heldManifest = {
  schema: 'kaminos.volume.operator-basin-replay.v0',
  status: 'captured',
  grid: 160,
  source: {
    effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
    backend: 'WebGPU:apple',
  },
  controls: {
    volumeScene: 'tall_plume',
    density: 5.05,
    smoke: 0.1,
    inputRadius: 0.68,
    resolution: 160,
    reactionBoundaryControls: { identity: 'reaction-boundary-live-controls-v0', cut: 0 },
  },
  camera: {
    position: [-4.24, 2.14, 8.18],
    target: [0, 0.02, 0],
    projectionMatrix: Array.from({ length: 16 }, (_, index) => index + 0.25),
    matrixWorldInverse: Array.from({ length: 16 }, (_, index) => index + 10.25),
  },
};

const contract = buildMinimumRadiusTeacherContract({
  heldManifest,
  heldManifestIdentity: 'sha256:' + 'a'.repeat(64),
  requestedRoute: 'http://127.0.0.1:8097/?volume_input_radius=0.08',
});

assert.equal(contract.schema, 'kaminos.smoke-oracle-minimum-radius-teacher-contract.v0');
assert.equal(contract.baseline.inputRadius, 0.68);
assert.equal(contract.corrected.inputRadius, 0.08);
assert.deepEqual(contract.manifestDiff, [
  { path: 'controls.inputRadius', before: 0.68, after: 0.08 },
]);
assert.equal(contract.expectedControls.density, 5.05);
assert.equal(contract.expectedControls.inputRadius, 0.08);
assert.match(contract.cameraIdentity, /^sha256:[a-f0-9]{64}$/);

const effectiveState = {
  effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
  prototypeIdentity: 'kaminos-volume-prototype-v0',
  backend: 'WebGPU:apple',
  controls: structuredClone(contract.expectedControls),
  camera: {
    identity: 'checksum-bound-native-camera-matrices-v0',
    ...structuredClone(contract.expectedCamera),
  },
};
assert.equal(validateMinimumRadiusEffectiveState(contract, effectiveState).ok, true);

const wrongControl = structuredClone(effectiveState);
wrongControl.controls.smoke = 0.2;
assert.throws(
  () => validateMinimumRadiusEffectiveState(contract, wrongControl),
  /controls\.smoke/,
  'a second effective control change must fail the one-variable teacher contract',
);

const wrongCamera = structuredClone(effectiveState);
wrongCamera.camera.projectionMatrix[7] += 0.01;
assert.throws(
  () => validateMinimumRadiusEffectiveState(contract, wrongCamera),
  /camera identity mismatch/,
  'camera matrix drift must fail before teacher admission',
);

const immature = assessMinimumRadiusMaturityCandidate({
  current: {
    simStepCount: 18,
    render: { width: 640, height: 455, litPixels: 0, smokeLikePixels: 0, sha256: 'sha256:' + '1'.repeat(64) },
    support: { liveVoxels: 0, smokeWeight: 0, smokeVisualRiseDisplacement: 0 },
  },
  previous: null,
});
assert.equal(immature.candidate, false);
assert.ok(immature.reasons.includes('blank-render'));

const candidate = assessMinimumRadiusMaturityCandidate({
  previous: {
    simStepCount: 104,
    render: { width: 640, height: 455, litPixels: 22000, smokeLikePixels: 11000, sha256: 'sha256:' + '2'.repeat(64) },
    support: { liveVoxels: 44000, smokeWeight: 12000, smokeVisualRiseDisplacement: 0.48 },
  },
  current: {
    simStepCount: 105,
    render: { width: 640, height: 455, litPixels: 22400, smokeLikePixels: 11400, sha256: 'sha256:' + '3'.repeat(64) },
    support: { liveVoxels: 44800, smokeWeight: 12300, smokeVisualRiseDisplacement: 0.5 },
  },
});
assert.equal(candidate.candidate, true);
assert.equal(candidate.admitted, false, 'machine maturity can nominate but cannot visually admit a teacher');
assert.equal(candidate.requiresVisualDisposition, true);

assert.throws(
  () => admitMinimumRadiusTeacherWindow({ contract, frames: [candidate.previous, candidate.current] }),
  /visual disposition/,
  'candidate metrics alone must not launder a teacher into admission',
);

const admitted = admitMinimumRadiusTeacherWindow({
  contract,
  frames: [candidate.previous, candidate.current],
  visualDisposition: {
    identity: 'agent-original-resolution-inspection-v0',
    verdict: 'mature-articulated-support-evolution',
    inspectedArtifacts: ['step-104.png', 'step-105.png'],
  },
});
assert.equal(admitted.status, 'admitted');
assert.deepEqual(admitted.actualSteps, [104, 105]);
assert.equal(admitted.gaussianVerdict, null);

const nonAdjacent = structuredClone(candidate.current);
nonAdjacent.simStepCount = 107;
assert.throws(
  () => admitMinimumRadiusTeacherWindow({
    contract,
    frames: [candidate.previous, nonAdjacent],
    visualDisposition: {
      identity: 'agent-original-resolution-inspection-v0',
      verdict: 'mature-articulated-support-evolution',
      inspectedArtifacts: ['step-104.png', 'step-107.png'],
    },
  }),
  /adjacent simulator steps/,
);

console.log('minimum-radius r160 smoke teacher contracts passed');
