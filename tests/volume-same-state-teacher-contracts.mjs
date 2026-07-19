#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  SAME_STATE_TEACHER_CONTRACT,
  selectShortestVisibleTeacherResidual,
  validateSameStateTeacherPair,
  validateSameStateTeacherWitnessIdentity,
} from '../same-state-teacher-contract.mjs';
import {
  evaluateAnalyticalTeacherBaseline,
  validateAnalyticalCandidateReadback,
} from '../boundary-splat-forced-response.mjs';

const [core, witness, supervisor] = await Promise.all([
  readFile(new URL('../volume-core.js', import.meta.url), 'utf8'),
  readFile(new URL('../volume-same-state-teacher-witness.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../volume-boundary-splat-forced-response-greenroom.mjs', import.meta.url), 'utf8'),
]);
const analyticalControl = await readFile(new URL('../boundary-splat-forced-response.mjs', import.meta.url), 'utf8');

assert.match(
  core,
  /exact-same-state-forced-response-teacher-fork-v0/,
  'runtime admits an exact same-state forced-response teacher import authority',
);
assert.match(
  core,
  /advanceDebugForcedTeacherSequence/,
  'runtime exposes an atomic frame-current emitter and wind teacher sequence',
);
assert.match(
  core,
  /stale-emitter-frame/,
  'teacher stepping rejects emitter frames that do not match the imported simulation step',
);
assert.match(
  core,
  /same-state-teacher-initial-field-v0/,
  'teacher receipts preserve the exact imported initial-field identity',
);
assert.match(core, /flowRate:[\s\S]*Number\(controls\.flowRate\)/, 'teacher sequence can suppress the built-in source without disabling external emitters');
assert.match(witness, /initial fluid checksum drift/, 'witness rejects an unmatched initial fluid field');
assert.match(witness, /initial front checksum drift/, 'witness rejects an unmatched initial front field');
assert.match(witness, /render output is partial/, 'witness rejects partial render output');
assert.match(witness, /render output is blank/, 'witness rejects decoded blank render output');
assert.match(witness, /witness-mounted-same-state-teacher-canvas-v0/, 'witness mounts and receipts the actual renderer canvas before capture');
assert.match(witness, /source-centroid-aligned-rigid-displacement-subtraction-v0|SAME_STATE_TEACHER_CONTRACT\.subtractionIdentity/, 'witness records rigid source displacement subtraction');
assert.match(witness, /no-visible-named-teacher-residual-within-requested-horizons/, 'witness fails when no named teacher residual is visible');
assert.match(supervisor, /same-state-teacher-contracts/, 'Greenroom supervisor runs the teacher contracts before GPU capture');
assert.match(supervisor, /modelIdentity !== null/, 'Greenroom supervisor rejects model admission in the teacher-only assay');
assert.match(supervisor, /SAME_STATE_TEACHER_CONTRACT\.residualName/, 'Greenroom supervisor consumes the canonical residual identity');
assert.match(supervisor, /selectedRow\.residual\.residualName/, 'Greenroom supervisor rejects disagreement between the selected row and summary residual identity');
assert.match(
  analyticalControl,
  /ANALYTICAL_TEACHER_CALIBRATION_SCHEMA\s*=\s*'kaminos\.boundary-splat\.analytical-teacher-calibration\.v0'/,
  'analytical control names the teacher-calibration report contract',
);
assert.match(
  analyticalControl,
  /evaluateAnalyticalTeacherBaseline[\s\S]*source-relative-upper-plume-inertial-lag-v0[\s\S]*baseline-untuned-analytical-control-v0/,
  'untouched analytical response is measured against the named teacher residual before calibration',
);
assert.match(
  analyticalControl,
  /candidateAuthority[\s\S]*ANALYTICAL_CANDIDATE_AUTHORITY[\s\S]*modelIdentity:\s*null[\s\S]*splineAdmitted:\s*false/,
  'teacher calibration requires actual canonical candidate readback and forbids model or spline admission',
);
assert.match(
  witness,
  /validateAnalyticalCandidateReadback\(\{[\s\S]*candidateValues[\s\S]*draw[\s\S]*sourceAuthority[\s\S]*rendererIdentity/,
  'analytical witness gates the live candidate source, renderer, and overflow receipt before evaluation',
);
assert.match(
  analyticalControl,
  /validateAnalyticalCandidateReadback[\s\S]*descriptor\.floatCount[\s\S]*values\.length[\s\S]*draw\.instanceCount/,
  'analytical witness rejects descriptor, readback, and draw-count disagreement',
);
assert.match(
  witness,
  /effectiveUrl[\s\S]*config\.route[\s\S]*analytical calibration route control disagreement/,
  'analytical witness validates the effective browser route controls against the requested fixture',
);
assert.match(
  supervisor,
  /candidateExport[\s\S]*sourceAuthority[\s\S]*live-baked-sidecar-plus-fluid-material-v0[\s\S]*rendererIdentity[\s\S]*live-boundary-sidecar-analytic-splats-v0[\s\S]*overflowCount/,
  'Greenroom supervisor independently gates the live analytical candidate receipt',
);

const hash = character => character.repeat(64);
const sequence = (arm, steps, fluidSha256 = hash('a')) => ({
  arm,
  initialField: {
    identity: 'same-state-teacher-initial-field-v0',
    grid: 64,
    simStepCount: 24,
    fluidSha256,
    frontSha256: hash('b'),
  },
  requestedSteps: steps,
  completedSteps: steps,
  requestedRigidDisplacement: arm === 'stationary-source-control' ? [0, 0, 0] : [0.1, 0, 0],
  measuredRigidDisplacement: arm === 'stationary-source-control' ? [0, 0, 0] : [0.1, 0, 0],
  rigidDisplacementSubtraction: 'required-before-teacher-residual-v0',
  effectiveFrames: Array.from({ length: steps }, (_, frameId) => ({ frameId, emitterCount: 1 })),
});
const render = sha256 => ({ ok: true, complete: true, nonblank: true, sha256 });
const pair = (steps, changedPixelFraction, upperPlumeLagPx) => ({
  horizonMs: steps * (1000 / 60),
  control: { sequence: sequence('stationary-source-control', steps), render: render(hash('c')) },
  teacher: { sequence: sequence('moving-source-wind-teacher', steps), render: render(hash('d')) },
  residual: {
    identity: 'rigid-subtracted-low-frequency-field-projection-v0',
    residualName: 'source-relative-upper-plume-inertial-lag-v0',
    path: `/tmp/residual-${steps}.png`,
    sha256: hash('f'),
    rigidDisplacementSubtraction: {
      identity: 'source-centroid-aligned-rigid-displacement-subtraction-v0',
      applied: true,
      worldDisplacement: [0.1, 0, 0],
      imageDisplacementPx: [3, 0],
    },
    changedPixelFraction,
    upperPlumeLagPx,
  },
});

assert.equal(validateSameStateTeacherPair(pair(2, 0.02, 3)).requestedSteps, 2);
assert.throws(
  () => validateSameStateTeacherPair({
    ...pair(2, 0.02, 3),
    teacher: { ...pair(2, 0.02, 3).teacher, sequence: sequence('moving-source-wind-teacher', 2, hash('e')) },
  }),
  /unmatched-initial-fields/,
);
assert.throws(
  () => {
    const sample = pair(2, 0.02, 3);
    validateSameStateTeacherPair({
      ...sample,
      residual: { ...sample.residual, rigidDisplacementSubtraction: null },
    });
  },
  /missing-rigid-displacement-subtraction/,
);
assert.throws(
  () => validateSameStateTeacherPair({
    ...pair(2, 0.02, 3),
    teacher: { ...pair(2, 0.02, 3).teacher, render: { ok: true, complete: false, nonblank: true, sha256: hash('d') } },
  }),
  /partial-teacher-render/,
);
assert.throws(
  () => validateSameStateTeacherPair({
    ...pair(2, 0.02, 3),
    teacher: { ...pair(2, 0.02, 3).teacher, render: { ok: true, complete: true, nonblank: false, sha256: hash('d') } },
  }),
  /blank-teacher-render/,
);

const shortest = selectShortestVisibleTeacherResidual([
  pair(1, 0.005, 1.8),
  pair(2, 0.012, 2.4),
  pair(4, 0.04, 6.1),
]);
assert.equal(shortest.requestedSteps, 2);
assert.equal(shortest.residualName, SAME_STATE_TEACHER_CONTRACT.residualName);

const witnessReport = {
  shortestVisibleResidual: shortest,
  horizons: [pair(1, 0.005, 1.8), pair(2, 0.012, 2.4)],
};
assert.equal(validateSameStateTeacherWitnessIdentity(witnessReport).control.sequence.requestedSteps, 2);
assert.throws(
  () => validateSameStateTeacherWitnessIdentity({
    ...witnessReport,
    shortestVisibleResidual: { ...shortest, residualName: 'stale-residual-name-v0' },
  }),
  /wrong-summary-teacher-residual-name/,
);
assert.throws(
  () => validateSameStateTeacherWitnessIdentity({
    ...witnessReport,
    horizons: witnessReport.horizons.map(row => row.control.sequence.requestedSteps === 2
      ? { ...row, residual: { ...row.residual, residualName: 'stale-residual-name-v0' } }
      : row),
  }),
  /wrong-selected-row-teacher-residual-name/,
);

const calibrationCandidates = new Float32Array([
  0.02, 0.25, 0, 1, 1, 0.5, 0.1, 0.03, 0.02, 0.04, 0.5, 1,
  -0.03, 0.75, 0, 0.8, 1, 0.5, 0.1, 0.025, 0.02, 0.04, 0.5, 1,
]);
const candidateDescriptor = {
  kind: 'boundarySplat',
  dtype: 'float32',
  floatCount: calibrationCandidates.length,
  byteLength: calibrationCandidates.byteLength,
  shape: [2, 12],
};
const candidateDraw = { instanceCount: 2, candidateCount: 2, overflowCount: 0 };
const candidateReadback = validateAnalyticalCandidateReadback({
  candidateValues: calibrationCandidates,
  descriptor: candidateDescriptor,
  draw: candidateDraw,
  sourceAuthority: 'live-baked-sidecar-plus-fluid-material-v0',
  rendererIdentity: 'live-boundary-sidecar-analytic-splats-v0',
});
assert.equal(candidateReadback.authority, 'debug-full-field-boundary-splat-effective-output-readback-v0');
for (const mutation of [
  { sourceAuthority: 'fallback-candidate-source-v0', expected: /source-authority-disagreement/ },
  { rendererIdentity: 'learned-boundary-splat-renderer-v0', expected: /renderer-identity-disagreement/ },
  { draw: { ...candidateDraw, overflowCount: 1 }, expected: /candidate-overflow/ },
  { descriptor: { ...candidateDescriptor, floatCount: 12 }, expected: /float-count-disagreement/ },
]) {
  assert.throws(
    () => validateAnalyticalCandidateReadback({
      candidateValues: calibrationCandidates,
      descriptor: mutation.descriptor || candidateDescriptor,
      draw: mutation.draw || candidateDraw,
      sourceAuthority: mutation.sourceAuthority || 'live-baked-sidecar-plus-fluid-material-v0',
      rendererIdentity: mutation.rendererIdentity || 'live-boundary-sidecar-analytic-splats-v0',
    }),
    mutation.expected,
  );
}
const calibrationTeacher = {
  residualName: SAME_STATE_TEACHER_CONTRACT.residualName,
  upperPlumeLagWorld: -0.14000125975996786,
  rigidDisplacementSubtraction: { applied: true },
};
const baseline = evaluateAnalyticalTeacherBaseline({
  teacherResidual: calibrationTeacher,
  candidateValues: calibrationCandidates,
  candidateAuthority: 'debug-full-field-boundary-splat-effective-output-readback-v0',
  response: {
    calibrationIdentity: 'baseline-untuned-analytical-control-v0',
    relativeWindLocal: [-1.2, 0, 1],
    accelerationLagLocal: [-1.2, -0.22, 0],
    sourceAttachment: 0.9,
    dtSeconds: 1 / 60,
    historyAgeFrames: 7,
  },
});
assert.equal(baseline.status, 'named-analytical-miss');
assert.equal(baseline.parameterCalibrationAdmitted, false, 'a named analytical miss does not authorize calibration in this slice');
assert.equal(baseline.modelIdentity, null);
assert.equal(baseline.splineAdmitted, false);
assert.throws(
  () => evaluateAnalyticalTeacherBaseline({
    teacherResidual: calibrationTeacher,
    candidateValues: calibrationCandidates,
    candidateAuthority: 'fallback-candidate-source-v0',
    response: { calibrationIdentity: 'baseline-untuned-analytical-control-v0' },
  }),
  /candidate-authority-disagreement/,
);
assert.throws(
  () => evaluateAnalyticalTeacherBaseline({
    teacherResidual: calibrationTeacher,
    candidateValues: calibrationCandidates,
    candidateAuthority: 'debug-full-field-boundary-splat-effective-output-readback-v0',
    response: { calibrationIdentity: 'baseline-untuned-analytical-control-v0', windGain: 0.2 },
  }),
  /baseline-analytical-gain-mutated/,
);
const missingUpperSupport = evaluateAnalyticalTeacherBaseline({
  teacherResidual: calibrationTeacher,
  candidateValues: new Float32Array([
    0.02, -0.75, 0, 1, 1, 0.5, 0.1, 0.03, 0.02, 0.04, 0.5, 1,
    -0.03, -0.25, 0, 0.8, 1, 0.5, 0.1, 0.025, 0.02, 0.04, 0.5, 1,
  ]),
  candidateAuthority: 'debug-full-field-boundary-splat-effective-output-readback-v0',
  response: {
    calibrationIdentity: 'baseline-untuned-analytical-control-v0',
    relativeWindLocal: [-1.2, 0, 1],
    accelerationLagLocal: [-1.2, -0.22, 0],
    sourceAttachment: 0.9,
    dtSeconds: 1 / 60,
    historyAgeFrames: 7,
  },
});
assert.equal(missingUpperSupport.status, 'candidate-support-miss');
assert.equal(missingUpperSupport.parameterCalibrationAdmitted, false);
assert.equal(missingUpperSupport.candidateSupport.upperCandidateCount, 0);

console.log('volume same-state teacher contracts passed');
