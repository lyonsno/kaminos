#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  SAME_STATE_TEACHER_CONTRACT,
  selectShortestVisibleTeacherResidual,
  validateSameStateTeacherPair,
  validateSameStateTeacherWitnessIdentity,
} from '../same-state-teacher-contract.mjs';

const [core, witness, supervisor] = await Promise.all([
  readFile(new URL('../volume-core.js', import.meta.url), 'utf8'),
  readFile(new URL('../volume-same-state-teacher-witness.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../volume-boundary-splat-forced-response-greenroom.mjs', import.meta.url), 'utf8'),
]);

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

console.log('volume same-state teacher contracts passed');
