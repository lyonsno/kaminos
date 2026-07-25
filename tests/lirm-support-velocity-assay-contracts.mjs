import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  computeWeightedRmsPatchRadius,
  empiricalMidrankPercentiles,
  ordinaryMedian,
  periodicCentralDifference,
  runSupportVelocityAssay,
} from '../lirm-support-velocity-assay-core.mjs';
import { runExactSupportVelocityAssay } from '../lirm-support-velocity-assay.mjs';

const root = resolve(import.meta.dirname, '..');
const reportPath = resolve(
  root,
  'artifacts/lirm-719024-support-velocity-assay-v0/report.json',
);

assert.ok(
  existsSync(reportPath),
  'the frozen exact-cast support-velocity assay report must exist',
);

const report = JSON.parse(await readFile(reportPath, 'utf8'));
assert.equal(report.schema, 'kaminos.lirm-support-velocity-assay.v0');
assert.equal(report.requestedRoute, 'kaminos/lirm-719024/support-velocity-assay-v0');
assert.equal(report.effectiveRoute, report.requestedRoute);
assert.equal(report.status, 'pass');
assert.equal(report.failurePhase, null);
assert.equal(report.effectiveConfig.sampleCount, 48);
assert.equal(report.effectiveConfig.cycleDurationSeconds, 8.1);
assert.equal(report.effectiveConfig.differentiation, 'unsmoothed-periodic-central-difference');
assert.deepEqual(report.effectiveConfig.forwardAxis, [0, 0, -1]);
assert.deepEqual(report.effectiveConfig.exclusions, []);
assert.equal(report.nullFamily.shiftCount, 48);
assert.equal(report.nullFamily.selectedShiftCount, 0);
assert.equal(report.nullFamily.perSupportShiftsAllowed, false);
assert.equal(
  report.requestedConfig.measurementBaselineCommit,
  '6217fff858c0b12e330499baf28127f9122826f7',
);
assert.equal(
  report.inputs.source.sha256,
  'sha256:8fed20d958ef48797c14ad1d3846a50eae05d43e6ae67f8805060b02f1abde8e',
);
assert.equal(
  report.inputs.samples.sha256,
  'sha256:017ef8037447494a4f1c17293b9d3b55f105109ebed16635ffbda15a9c31200a',
);
assert.equal(
  report.inputs.atlas.sha256,
  'sha256:e3007a55f930d709ac8a7bf684ff32ad862e7d55186343220edb3e2ad3635b78',
);
assert.equal(report.supports.length, 4);
assert.equal(report.shifts.length, 48);
assert.ok(['strong', 'weak', 'fail'].includes(report.result.classification));
assert.equal(
  report.result.visualAbEarned,
  report.result.classification === 'strong',
  'only a strong result may earn the scalar root-speed A/B',
);

for (const support of report.supports) {
  assert.ok(support.rmsRadius > 0);
  assert.equal(support.impliedSpeedTrace.length, 48);
  assert.equal(support.activeTrace.length, 48);
}
for (const shift of report.shifts) {
  assert.equal(shift.medianImpliedSpeedTrace.length, 48);
  assert.equal(shift.signedDisagreementTrace.length, 48);
  assert.equal(shift.componentPercentiles.length, 4);
}

assert.equal(ordinaryMedian([1, 3, 2]), 2);
assert.equal(ordinaryMedian([1, 4, 2, 3]), 2.5);
assert.deepEqual(empiricalMidrankPercentiles([7, 7, 7]), [0.5, 0.5, 0.5]);
assert.deepEqual(periodicCentralDifference([0, 1, 0, -1], 1), [1, 0, -1, 0]);
const patch = computeWeightedRmsPatchRadius(
  new Float64Array([-1, 0, 0, 1, 0, 0]),
  [0, 1],
  [0.5, 0.5],
);
assert.deepEqual(patch.centroid, [0, 0, 0]);
assert.equal(patch.rmsRadius, 1);

const phaseZeroTrace = Array.from({ length: 48 }, (_, index) => index < 24 ? 1 : -10);
const phaseZeroAlternate = Array.from({ length: 48 }, (_, index) => index < 24 ? 1 : -12);
const phaseHalfTrace = Array.from({ length: 48 }, (_, index) => index < 24 ? -10 : 1);
const phaseHalfAlternate = Array.from({ length: 48 }, (_, index) => index < 24 ? -12 : 1);
const syntheticSupports = [
  { id: 'front-left', phaseOffset: 0, impliedSpeedTrace: phaseZeroTrace },
  { id: 'front-right', phaseOffset: 0.5, impliedSpeedTrace: phaseHalfTrace },
  { id: 'rear-left', phaseOffset: 0.5, impliedSpeedTrace: phaseHalfAlternate },
  { id: 'rear-right', phaseOffset: 0, impliedSpeedTrace: phaseZeroAlternate },
];
const synthetic = runSupportVelocityAssay({
  supports: syntheticSupports,
  sampleCount: 48,
  dt: 8.1 / 48,
  medianActivePatchRmsRadius: 0.5,
});
assert.equal(synthetic.shifts.length, 48);
assert.ok(synthetic.shifts[0].medianImpliedSpeedTrace.every(value => value === 1));
assert.equal(synthetic.result.classification, 'strong');
assert.equal(synthetic.result.visualAbEarned, true);

const failureRoot = await mkdtemp(resolve(tmpdir(), 'lirm-support-velocity-failure-'));
try {
  await assert.rejects(
    runExactSupportVelocityAssay({
      sourcePath: resolve(failureRoot, 'missing.glb'),
      samplesPath: resolve(root, 'artifacts/lirm-719024-smooth-fitted-phase-exercise-v0/flat-support-probe-samples.json'),
      atlasPath: resolve(root, 'artifacts/lirm-719024-smooth-fitted-phase-exercise-v0/admitted-contact-atlas.json'),
      phaseReportPath: resolve(root, 'artifacts/lirm-719024-smooth-fitted-phase-exercise-v0/report.json'),
      fittedRegistrationPath: resolve(root, 'artifacts/lirm-719024-fitted-proxy-rig-mechanism-witness-v1/registration.json'),
      axialRegistrationPath: resolve(root, 'artifacts/motion-ready-719024/registration.json'),
      outDir: failureRoot,
    }),
    /source does not exist/,
  );
  const failure = JSON.parse(await readFile(resolve(failureRoot, 'report.json'), 'utf8'));
  assert.equal(failure.status, 'fail');
  assert.equal(failure.failurePhase, 'input-admission');
  assert.equal(failure.effectiveRoute, null);
  assert.match(failure.lastTrustworthyEvidence, /invocation recorded/);
  assert.match(failure.lastTrustworthyEvidence, /failed during input-admission/);
} finally {
  await rm(failureRoot, { recursive: true, force: true });
}

console.log('lirm support velocity assay contracts passed');
