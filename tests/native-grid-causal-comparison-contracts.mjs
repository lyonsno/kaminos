import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const script = new URL('../native-grid-causal-comparison.mjs', import.meta.url);
assert.ok(existsSync(script), 'native-grid causal comparison assembler exists');

const root = await mkdtemp(join(tmpdir(), 'native-grid-causal-comparison-'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const writeJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
};

const makeReport = async (grid, name, cohortIdentity) => {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  const cameras = [];
  for (let index = 0; index < 21; index += 1) {
    const prefix = `camera-${String(index).padStart(2, '0')}`;
    for (const suffix of ['shared-transport-target', 'expanded-shared-transport', 'expanded-residual']) {
      await writeFile(join(dir, `${prefix}-${suffix}.png`), png);
    }
    cameras.push({
      cameraIndex: index,
      split: index === 10 ? 'calibration' : 'heldOut',
      expanded: {
        mae: grid / 10000,
        targetTopTailLumaUnderfit: grid / 20000,
        targetWispUnderfit: grid / 30000,
        structuredDotSpectralPower: grid / 40000,
      },
      raster: { projectedFragments: grid * 1000 },
    });
  }
  const manifestPath = join(root, `${name}-oracle-manifest.json`);
  const capturePath = join(root, `${name}-capture.json`);
  await writeJson(manifestPath, { grid, name });
  await writeJson(capturePath, { grid, cohortIdentity });
  const report = {
    schema: 'kaminos.volume.layer-coefficient-render-oracle.v0',
    status: 'complete',
    failurePhase: null,
    requested: { depthBins: 96, footprintMode: 'bilinear', sampleCap: null },
    effective: {
      sourceGrid: grid,
      stateStep: 120,
      rowCount: grid * 100,
      sampleCap: null,
      droppedRowCount: 0,
      footprintMode: 'flow-tangent-five-tap-bilinear-v0',
      pathScale: grid / 10,
      depositionScaleIdentity: 'native-cell-width-from-effective-source-grid-v0',
      coefficientBoundary: 'per-sample-pre-tone-map-emission-extinction-v0',
      sharedTransmittanceIdentity: 'ridge-plus-non-ridge-extinction-one-running-transmittance-v0',
      kernelGeometry: 'base-footprint-plus-flow-kernel-second-moment-tangent-covariance-v0',
      orderApproximation: 'camera-depth-96-bin-one-running-transmittance-v0',
    },
    inputIdentity: {
      manifest: { path: manifestPath, sha256: sha256(await readFile(manifestPath)) },
      captureReport: { path: capturePath, sha256: sha256(await readFile(capturePath)) },
      cameraCohort: {
        identity: cohortIdentity,
        cameraCount: 21,
        cameras: Array.from({ length: 21 }, (_, cameraIndex) => ({ cameraIndex, width: 314, height: 242, cameraPoseHash: `pose-${cameraIndex}` })),
      },
    },
    calibration: { identity: 'camera-10-only-global-optical-path-fit-v0', cameraIndex: 10, calibrationBoundaryHit: false },
    massAccounting: { allNominalKernelMassConserved: true, imageMetricAuthority: 'decision-bearing-exact-frozen-viewport-v0' },
    metrics: { cameras, heldOutMean: { cameraCount: 20 } },
    artifacts: { gallery: join(dir, 'index.html'), cameraCount: 21 },
  };
  const reportPath = join(dir, 'report.json');
  await writeJson(reportPath, report);
  const receiptPath = join(root, `${name}-receipt.json`);
  await writeJson(receiptPath, {
    status: 'done', job_type: 'kaminos_native_grid_bilinear_causal_oracle_0718',
    output_dir: dir, effective_timeout: null, ignored_params: null, failure_phase: null,
    effective_route: `python volume-layer-coefficient-render-oracle.py --footprint-mode bilinear --manifest ${manifestPath}`,
    effective_cwd: dirname(script.pathname), effective_env: { PYTHONPATH: '.' },
  });
  return { dir, reportPath, receiptPath, manifestPath, capturePath };
};

const cohortIdentity = `sha256:${'a'.repeat(64)}`;
const grid96 = await makeReport(96, 'grid96', cohortIdentity);
const grid160 = await makeReport(160, 'grid160', cohortIdentity);
const adapterPath = grid96.manifestPath;
const cockpitPath = join(root, 'grid160-cockpit.json');
await writeJson(cockpitPath, { identity: 'grid160-cockpit' });
const cockpitSha = sha256(await readFile(cockpitPath));
const companionPath = join(root, 'grid96-companion.json');
const companionIdentity = `sha256:${'b'.repeat(64)}`;
await writeJson(companionPath, {
  schema: 'kaminos.volume.grid96-full-support-companion.v0', status: 'complete', identity: companionIdentity,
  components: { comparison: { sha256: cockpitSha } },
});

const args = async out => [
  script.pathname,
  '--grid96-companion', companionPath,
  '--expected-grid96-companion-sha256', sha256(await readFile(companionPath)),
  '--expected-grid96-companion-identity', companionIdentity,
  '--grid96-adapter', adapterPath,
  '--grid96-report', grid96.reportPath,
  '--grid96-receipt', grid96.receiptPath,
  '--grid160-cockpit-manifest', cockpitPath,
  '--grid160-oracle-manifest', grid160.manifestPath,
  '--grid160-report', grid160.reportPath,
  '--grid160-receipt', grid160.receiptPath,
  '--out-dir', out,
  '--report', join(out, 'report.json'),
];

const output = join(root, 'output');
const success = spawnSync(process.execPath, await args(output), { encoding: 'utf8' });
assert.equal(success.status, 0, success.stderr || success.stdout);
const report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'));
assert.equal(report.status, 'complete');
assert.equal(report.identity.grid96.sourceGrid, 96);
assert.equal(report.identity.grid160.sourceGrid, 160);
assert.equal(report.cameraCohort.identity, cohortIdentity);
assert.equal(report.cameraCohort.cameraCount, 21);
assert.equal(report.metrics.grid96.heldOut.cameraCount, 20);
assert.equal(report.metrics.grid160.heldOut.cameraCount, 20);
assert.ok(existsSync(join(output, 'index.html')));
assert.ok(existsSync(join(output, 'images', 'grid96-camera-10-expanded.png')));

const wrongCohort = JSON.parse(await readFile(grid96.reportPath, 'utf8'));
wrongCohort.inputIdentity.cameraCohort.identity = `sha256:${'c'.repeat(64)}`;
await writeJson(grid96.reportPath, wrongCohort);
const failureOut = join(root, 'failure-output');
const failure = spawnSync(process.execPath, await args(failureOut), { encoding: 'utf8' });
assert.notEqual(failure.status, 0, 'camera-cohort mismatch must fail');
const failureReport = JSON.parse(await readFile(join(failureOut, 'report.json'), 'utf8'));
assert.equal(failureReport.status, 'failed');
assert.equal(failureReport.failurePhase, 'cross-grid-identity-validation');
assert.match(failureReport.error, /camera cohort/i);

console.log('native grid causal comparison contracts passed');
