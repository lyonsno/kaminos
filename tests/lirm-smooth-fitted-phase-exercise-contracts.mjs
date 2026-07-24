import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SMOOTH_FITTED_PHASE_ROUTE } from '../lirm-reference-fitted-armature-core.mjs';

const exercise = await import('../lirm-smooth-fitted-phase-exercise.mjs');

assert.equal(typeof exercise.runSmoothFittedPhaseExercise, 'function');
assert.equal(
  exercise.SMOOTH_FITTED_PHASE_EXERCISE_ROUTE,
  'kaminos/fitted-proxy-rig/arbitrary-phase-flat-support-exercise-v0',
);

const outDir = await mkdtemp(join(tmpdir(), 'kaminos-phase-exercise-failure-'));
await assert.rejects(
  () => exercise.runSmoothFittedPhaseExercise({
    sourcePath: join(outDir, 'missing.glb'),
    registrationPath: join(outDir, 'missing-registration.json'),
    contactAtlasPath: join(outDir, 'missing-contact-atlas.json'),
    outDir,
  }),
  /source GLB, fitted registration, and contact atlas must exist/,
);
const reportPath = join(outDir, 'report.json');
assert.ok(existsSync(reportPath), 'pre-output failure must leave a durable report');
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
assert.equal(report.status, 'failed');
assert.equal(report.failurePhase, 'input-admission');
assert.equal(report.requestedRoute, exercise.SMOOTH_FITTED_PHASE_EXERCISE_ROUTE);
assert.equal(report.effectiveRoute, null);
assert.equal(report.outputInventory.probeSamples, undefined);
assert.match(report.lastTrustworthyEvidence, /failed during input-admission/);

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = join(root, 'artifacts', 'lirm-719024-smooth-fitted-phase-exercise-v0');
const admittedReport = JSON.parse(await readFile(join(artifactRoot, 'report.json'), 'utf8'));
assert.equal(admittedReport.status, 'exercise-complete-uninspected');
assert.equal(admittedReport.requestedEvaluatorRoute, SMOOTH_FITTED_PHASE_ROUTE);
assert.equal(admittedReport.effectiveEvaluatorRoute, SMOOTH_FITTED_PHASE_ROUTE);
assert.equal(admittedReport.requestedExerciseRoute, exercise.SMOOTH_FITTED_PHASE_EXERCISE_ROUTE);
assert.equal(admittedReport.effectiveExerciseRoute, exercise.SMOOTH_FITTED_PHASE_EXERCISE_ROUTE);
const samplePath = join(artifactRoot, admittedReport.outputInventory.probeSamples.path);
const sampleBytes = await readFile(samplePath);
assert.equal(
  `sha256:${createHash('sha256').update(sampleBytes).digest('hex')}`,
  admittedReport.outputInventory.probeSamples.sha256,
  'probe sample inventory hash must bind the exact output bytes',
);
assert.equal((await stat(samplePath)).size, admittedReport.outputInventory.probeSamples.bytes);
const samplePacket = JSON.parse(sampleBytes);
assert.equal(samplePacket.effectiveEvaluatorRoute, SMOOTH_FITTED_PHASE_ROUTE);
assert.equal(samplePacket.effectiveExerciseRoute, exercise.SMOOTH_FITTED_PHASE_EXERCISE_ROUTE);
assert.equal(samplePacket.samples.length, admittedReport.results.finiteSampleCount);
for (const sample of samplePacket.samples) {
  assert.equal(sample.effectiveEvaluatorRoute, SMOOTH_FITTED_PHASE_ROUTE);
  assert.equal(sample.effectiveExerciseRoute, exercise.SMOOTH_FITTED_PHASE_EXERCISE_ROUTE);
  assert.equal(sample.source.castSha256, admittedReport.source.sha256);
  assert.equal(sample.source.fittedRegistrationSha256, admittedReport.registration.sha256);
  assert.equal(sample.source.contactAtlasSha256, admittedReport.contactAtlas.sha256);
  for (const probe of sample.probes) {
    for (const field of ['bodyPosition', 'worldPosition', 'bodyNormal', 'worldNormal']) {
      assert.equal(probe[field].length, 3, `${probe.id}.${field} must be a vec3`);
      assert.equal(probe[field].every(Number.isFinite), true, `${probe.id}.${field} must be finite`);
    }
    assert.equal(Number.isFinite(probe.bodyArcCoordinate), true);
    assert.equal(Number.isInteger(probe.vertexCount) && probe.vertexCount > 0, true);
    assert.equal(typeof probe.normalAuthority === 'string' && probe.normalAuthority.length > 0, true);
  }
}

process.stdout.write('lirm smooth fitted phase exercise contracts passed\n');
