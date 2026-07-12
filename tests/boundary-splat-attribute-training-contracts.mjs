import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const scriptUrl = new URL('../boundary-splat-attribute-mlx.py', import.meta.url);
const source = await readFile(scriptUrl, 'utf8').catch(() => '');
assert.match(source, /SCHEMA\s*=\s*["']kaminos\.boundary-splat-attribute-training\.v0/, 'training script declares a durable report schema');
assert.match(source, /compile-boundary-splat-attribute-model\.mjs/, 'successful training automatically compiles browser-consumable WGSL and packed weights');
assert.match(source, /parity-samples\.json/, 'training preserves MLX predictions for compiler-side export parity');

const outputDir = await mkdtemp(join(tmpdir(), 'kaminos-splat-attribute-probe-'));
try {
  const result = spawnSync('/private/tmp/kaminos-mlx-residual-venv/bin/python', [
    scriptUrl.pathname,
    '--out-dir', outputDir,
    '--probe-only',
    '--seed', '712',
    '--sample-count', '4096',
    '--hidden-size', '8',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, `training probe must pass: ${result.stderr || result.stdout}`);

  const report = JSON.parse(await readFile(join(outputDir, 'training-report.json'), 'utf8'));
  assert.equal(report.schema, 'kaminos.boundary-splat-attribute-training.v0');
  assert.equal(report.status, 'probe-only');
  assert.equal(report.routeIdentity, 'analytic-boundary-splat-teacher-parity-v0');
  assert.equal(report.jobInput, null, 'direct probes expose that no Greenroom manifest was supplied');
  assert.equal(report.backend, 'mlx');
  assert.match(report.device, /^Device\(gpu,\s*0\)$/);
  assert.deepEqual(report.features, [
    'sidecar.support', 'sidecar.coverage', 'sidecar.ridge', 'sidecar.footprint',
    'material.density', 'material.heat', 'material.fuel', 'material.detail',
    'fire.energy', 'fire.temperature', 'fire.emission', 'fire.detail',
    'micro.x', 'micro.y', 'micro.z', 'micro.w',
  ]);
  assert.deepEqual(report.outputs, ['color.r', 'color.g', 'color.b', 'opacity', 'radius.x', 'radius.y']);
  assert.equal(report.requestedSampleCount, 4096);
  assert.ok(report.selectedSampleCount > 256, 'probe retains a material selected-candidate population');
  assert.ok(report.selectedSampleCount < report.requestedSampleCount, 'probe exercises the analytic candidate gate');
  assert.equal(report.teacher.outputRanges.length, 6);
  for (const [minimum, maximum] of report.teacher.observedRanges) {
    assert.ok(Number.isFinite(minimum) && Number.isFinite(maximum) && minimum <= maximum, 'teacher ranges are finite and ordered');
  }
  assert.equal(report.modelArtifact, null, 'probe-only mode cannot pretend a model was trained');
} finally {
  await rm(outputDir, { recursive: true, force: true });
}

const liveOutputDir = await mkdtemp(join(tmpdir(), 'kaminos-splat-attribute-live-probe-'));
const liveFeaturePath = join(liveOutputDir, 'selected-candidates.f32');
const liveJobPath = join(liveOutputDir, 'job.json');
try {
  const featureRows = new Float32Array([
    0.8, 1.2, 1.0, 1.1, 0.1, 0.4, 0.05, 0.15, 0.2, 0.1, 0.18, 0.02, 0.08, 0.12, 0.15, 0.02,
    0.6, 1.3, 0.9, 1.2, 0.2, 0.5, 0.08, 0.18, 0.3, 0.2, 0.25, 0.04, 0.09, 0.16, 0.2, 0.03,
  ]);
  await writeFile(liveFeaturePath, new Uint8Array(featureRows.buffer));
  await writeFile(liveJobPath, JSON.stringify({
    routeIdentity: 'test-live-support-analytic-teacher-v0',
    featureInput: { path: 'selected-candidates.f32' },
  }));
  const result = spawnSync('/private/tmp/kaminos-mlx-residual-venv/bin/python', [
    scriptUrl.pathname,
    '--out-dir', liveOutputDir,
    '--probe-only',
    '--job-input', liveJobPath,
    '--hidden-size', '8',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, `live-support probe must pass: ${result.stderr || result.stdout}`);
  const report = JSON.parse(await readFile(join(liveOutputDir, 'training-report.json'), 'utf8'));
  assert.equal(report.routeIdentity, 'test-live-support-analytic-teacher-v0');
  assert.equal(report.featureSource.authority, 'captured-live-selected-candidates-v0');
  assert.equal(report.featureSource.path, await realpath(liveFeaturePath));
  assert.equal(report.featureSource.rowCount, 2);
  assert.equal(report.featureSource.strideFloats, 16);
  assert.match(report.featureSource.sha256, /^[0-9a-f]{64}$/);
  assert.equal(report.requestedSampleCount, 2);
  assert.equal(report.selectedSampleCount, 2);
  assert.equal(report.teacher.selection, 'preselected-live-candidates');
  assert.equal(report.teacher.observedRanges.length, 6);
} finally {
  await rm(liveOutputDir, { recursive: true, force: true });
}

const malformedOutputDir = await mkdtemp(join(tmpdir(), 'kaminos-splat-attribute-malformed-live-probe-'));
const malformedFeaturePath = join(malformedOutputDir, 'malformed.f32');
try {
  await writeFile(malformedFeaturePath, new Uint8Array(new Float32Array(15).buffer));
  const result = spawnSync('/private/tmp/kaminos-mlx-residual-venv/bin/python', [
    scriptUrl.pathname,
    '--out-dir', malformedOutputDir,
    '--probe-only',
    '--feature-input', malformedFeaturePath,
  ], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'malformed live feature stride must fail');
  const report = JSON.parse(await readFile(join(malformedOutputDir, 'training-report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'feature-input');
  assert.match(report.error, /multiple of 16 float32 values/);
} finally {
  await rm(malformedOutputDir, { recursive: true, force: true });
}

console.log('boundary splat attribute training contracts passed');
