import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

console.log('boundary splat attribute training contracts passed');
