import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const scriptPath = new URL('../scripts/lirm-support-atlas-admission-assay.mjs', import.meta.url);

async function runFailureFixture(manifest) {
  const directory = await mkdtemp(join(tmpdir(), 'kaminos-support-atlas-assay-'));
  const manifestPath = join(directory, 'manifest.json');
  const reportPath = join(directory, 'report.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const run = spawnSync(
    process.execPath,
    [scriptPath.pathname, '--manifest', manifestPath, '--report', reportPath],
    { encoding: 'utf8' },
  );
  return {
    run,
    report: JSON.parse(await readFile(reportPath, 'utf8')),
  };
}

const routeMismatch = await runFailureFixture({
  schema: 'kaminos.support-atlas-admission-manifest.v0',
  assayId: 'route-mismatch-fixture',
  routeIdentity: {
    requested: 'trellis2mlx_fast',
    effective: 'fallback-route',
  },
  casts: [],
});
assert.notEqual(routeMismatch.run.status, 0);
assert.equal(routeMismatch.report.status, 'failed');
assert.equal(routeMismatch.report.failurePhase, 'route-identity');
assert.equal(routeMismatch.report.lastTrustworthyEvidence, 'manifest-loaded');
assert.match(routeMismatch.report.error, /effective route mismatch/);

const missingCast = await runFailureFixture({
  schema: 'kaminos.support-atlas-admission-manifest.v0',
  assayId: 'missing-cast-fixture',
  routeIdentity: {
    requested: 'trellis2mlx_fast',
    effective: 'trellis2mlx_fast',
  },
  casts: [{
    id: 'missing-pressure-cast',
    role: 'pressure',
    glbPath: join(tmpdir(), 'no-such-pressure-cast.glb'),
    registration: {
      mode: 'axis-aligned-crawler-frame-v0',
      localForwardAxis: [0, 0, -1],
      localRightAxis: [1, 0, 0],
      localUpAxis: [0, 1, 0],
    },
  }],
});
assert.notEqual(missingCast.run.status, 0);
assert.equal(missingCast.report.status, 'failed');
assert.equal(missingCast.report.failurePhase, 'load-casts');
assert.equal(missingCast.report.lastTrustworthyEvidence, 'route-identity-verified');
assert.match(missingCast.report.error, /ENOENT/);

console.log('lirm support-atlas admission assay contracts passed');
