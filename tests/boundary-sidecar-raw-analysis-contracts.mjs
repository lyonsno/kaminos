import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = new URL('..', import.meta.url).pathname;
const analyzerPath = join(repoRoot, 'boundary-sidecar-raw-analyze.mjs');
const tempRoot = mkdtempSync(join(tmpdir(), 'kaminos-sidecar-raw-analysis-'));

function writeFloatFile(path, values) {
  const data = new Float32Array(values);
  writeFileSync(path, Buffer.from(data.buffer));
}

function runAnalyzer(inputDir, outputDir) {
  return spawnSync(process.execPath, [analyzerPath, '--input-dir', inputDir, '--output-dir', outputDir], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

try {
  const inputDir = join(tempRoot, 'valid-input');
  const outputDir = join(tempRoot, 'valid-output');
  mkdirSync(inputDir, { recursive: true });
  const structure = [
    0, 0, 0, 0,
    1, 0.5, 0.25, 0.125,
    0.2, 0.4, 0.6, 0.8,
    0, 0, 0, 0,
    0.1, 0.2, 0.3, 0.4,
    0.9, 0.8, 0.7, 0.6,
    0, 0.1, 0, 0.1,
    0.5, 0.5, 0.5, 0.5,
  ];
  const meta = [
    0, 0, 0, 0,
    0.2, 1, 0, 0,
    0.4, 0, 1, 0,
    0.6, 0, 0, 1,
    0.8, -1, 0, 0,
    1, 0, -1, 0,
    0.3, 0, 0, -1,
    0.7, 0.577, 0.577, 0.577,
  ];
  writeFloatFile(join(inputDir, 'structure.f32'), structure);
  writeFloatFile(join(inputDir, 'meta.f32'), meta);
  writeFileSync(join(inputDir, 'metadata.json'), JSON.stringify({
    job_type: 'kaminos_boundary_sidecar_raw_export',
    job_id: 'fixture-job',
    output_files: ['structure.f32', 'meta.f32', 'report.json'],
  }));
  writeFileSync(join(inputDir, 'report.json'), JSON.stringify({
    schema: 'boundary-sidecar-raw-export-report-v0',
    ok: true,
    effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
    backend: 'WebGPU:fixture',
    fallbackReason: null,
    capture: {
      identity: 'boundary-sidecar-raw-two-buffer-export-v0',
      captureId: 'fixture-capture',
      grid: [2, 2, 2],
      fields: {
        structure: { bytes: structure.length * 4 },
        meta: { bytes: meta.length * 4 },
      },
    },
  }));

  const valid = runAnalyzer(inputDir, outputDir);
  assert.equal(valid.status, 0, `valid analysis failed: ${valid.stderr || valid.stdout}`);
  const report = JSON.parse(readFileSync(join(outputDir, 'analysis-report.json'), 'utf8'));
  assert.equal(report.schema, 'boundary-sidecar-raw-analysis-report-v0');
  assert.equal(report.ok, true);
  assert.equal(report.failurePhase, 'complete');
  assert.equal(report.captureId, 'fixture-capture');
  assert.equal(report.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0');
  assert.equal(report.backend, 'WebGPU:fixture');
  assert.equal(report.fallbackReason, null);
  assert.deepEqual(report.grid, [2, 2, 2]);
  assert.equal(report.cellCount, 8);
  assert.equal(report.files.structure.byteLength, structure.length * 4);
  assert.match(report.files.structure.sha256, /^[0-9a-f]{64}$/);
  assert.equal(report.files.meta.nonFiniteCount, 0);
  assert.equal(report.channels.support.nonZeroCount, 5);
  assert.equal(report.channels.normalMagnitude.nonZeroCount, 7);
  assert.equal(report.channels.normalMagnitude.max <= 1.001, true);
  assert.equal(report.channels.supportWeightedFootprint.nonZeroCount, 5);
  assert.equal(report.projectionAuthority, 'axis-z-max-projection-v0');
  assert.equal(report.depthIntegratedProjectionAuthority, 'axis-z-sum-projection-v0');
  for (const name of ['support', 'coverage', 'ridge', 'footprint', 'proximity', 'normal-magnitude']) {
    const image = readFileSync(join(outputDir, `${name}-max-z.png`));
    assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(image.readUInt32BE(16), 2);
    assert.equal(image.readUInt32BE(20), 2);
    assert.ok(image.length > 60, `${name} projection is not a credible PNG`);
    assert.equal(report.projections[name === 'normal-magnitude' ? 'normalMagnitude' : name].sourceMax > 0, true);
  }
  for (const name of ['support', 'coverage', 'ridge', 'proximity', 'normal-magnitude', 'support-weighted-footprint']) {
    const image = readFileSync(join(outputDir, `${name}-sum-z.png`));
    assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(image.readUInt32BE(16), 2);
    assert.equal(image.readUInt32BE(20), 2);
    assert.ok(image.length > 60, `${name} depth-integrated projection is not a credible PNG`);
  }

  const corruptInput = join(tempRoot, 'corrupt-input');
  const corruptOutput = join(tempRoot, 'corrupt-output');
  mkdirSync(corruptInput, { recursive: true });
  writeFloatFile(join(corruptInput, 'structure.f32'), structure.slice(0, 4));
  writeFloatFile(join(corruptInput, 'meta.f32'), meta);
  writeFileSync(join(corruptInput, 'metadata.json'), JSON.stringify({
    job_type: 'kaminos_boundary_sidecar_raw_export',
    job_id: 'corrupt-fixture-job',
  }));
  writeFileSync(join(corruptInput, 'report.json'), JSON.stringify({
    schema: 'boundary-sidecar-raw-export-report-v0',
    ok: true,
    effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
    backend: 'WebGPU:fixture',
    fallbackReason: null,
    capture: {
      identity: 'boundary-sidecar-raw-two-buffer-export-v0',
      captureId: 'corrupt-fixture-capture',
      grid: [2, 2, 2],
      fields: {
        structure: { bytes: structure.length * 4 },
        meta: { bytes: meta.length * 4 },
      },
    },
  }));
  const corrupt = runAnalyzer(corruptInput, corruptOutput);
  assert.notEqual(corrupt.status, 0, 'truncated structure payload was accepted');
  const failure = JSON.parse(readFileSync(join(corruptOutput, 'analysis-report.json'), 'utf8'));
  assert.equal(failure.ok, false);
  assert.equal(failure.failurePhase, 'validate-inputs');
  assert.match(failure.error, /structure\.f32 byte length/);

  for (const rejected of [
    { name: 'wrong-route', effectiveRoute: 'fallback-volume-route-v0', fallbackReason: null, error: /effective route/ },
    { name: 'fallback', effectiveRoute: 'native-3d-compute-fluid-raymarch-v0', fallbackReason: 'test-fallback', error: /fallback reason/ },
  ]) {
    const rejectedInput = join(tempRoot, `${rejected.name}-input`);
    const rejectedOutput = join(tempRoot, `${rejected.name}-output`);
    mkdirSync(rejectedInput, { recursive: true });
    writeFloatFile(join(rejectedInput, 'structure.f32'), structure);
    writeFloatFile(join(rejectedInput, 'meta.f32'), meta);
    writeFileSync(join(rejectedInput, 'metadata.json'), JSON.stringify({
      job_type: 'kaminos_boundary_sidecar_raw_export',
      job_id: `${rejected.name}-fixture-job`,
    }));
    writeFileSync(join(rejectedInput, 'report.json'), JSON.stringify({
      schema: 'boundary-sidecar-raw-export-report-v0',
      ok: true,
      effectiveRoute: rejected.effectiveRoute,
      backend: 'WebGPU:fixture',
      fallbackReason: rejected.fallbackReason,
      capture: {
        identity: 'boundary-sidecar-raw-two-buffer-export-v0',
        captureId: `${rejected.name}-fixture-capture`,
        grid: [2, 2, 2],
        fields: {
          structure: { bytes: structure.length * 4 },
          meta: { bytes: meta.length * 4 },
        },
      },
    }));
    const result = runAnalyzer(rejectedInput, rejectedOutput);
    assert.notEqual(result.status, 0, `${rejected.name} export was accepted`);
    const rejectedReport = JSON.parse(readFileSync(join(rejectedOutput, 'analysis-report.json'), 'utf8'));
    assert.equal(rejectedReport.ok, false);
    assert.equal(rejectedReport.failurePhase, 'validate-source-authority');
    assert.match(rejectedReport.error, rejected.error);
  }

  console.log('boundary sidecar raw analysis contracts passed');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
