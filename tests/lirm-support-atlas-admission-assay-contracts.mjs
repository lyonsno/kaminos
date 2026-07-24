import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const scriptPath = new URL('../scripts/lirm-support-atlas-admission-assay.mjs', import.meta.url);
const controlGlbPath = new URL('../artifacts/motion-ready-719024/creature.glb', import.meta.url).pathname;
const controlRegistrationPath =
  new URL('../artifacts/motion-ready-719024/registration.json', import.meta.url).pathname;
const acceptedAtlasPath =
  new URL('../artifacts/lirm-719024-smooth-fitted-phase-exercise-v0/admitted-contact-atlas.json', import.meta.url)
    .pathname;
const controlIdentity = {
  castId: 'motion-ready-719024',
  castHash: '8fed20d958ef48797c14ad1d3846a50eae05d43e6ae67f8805060b02f1abde8e',
  registrationHash: 'cb519913ad863441e88555b3d9fbd588ffef03650475de07c29ee1c71f500ff6',
  vertexCount: 148118,
};

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
    directory,
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

const selfAuthenticatedIdentity = await runFailureFixture({
  schema: 'kaminos.support-atlas-admission-manifest.v0',
  assayId: 'self-authenticated-identity-fixture',
  routeIdentity: {
    requested: 'trellis2mlx_fast',
    effective: 'trellis2mlx_fast',
  },
  casts: [{
    id: 'motion-ready-719024',
    role: 'accepted-control',
    glbPath: controlGlbPath,
    registrationPath: controlRegistrationPath,
    acceptedAtlasPath,
    acceptedAtlasSha256: 'e3007a55f930d709ac8a7bf684ff32ad862e7d55186343220edb3e2ad3635b78',
    expectedIdentity: {
      ...controlIdentity,
      castHash: 'substituted-cast-hash',
    },
    outputDir: join(tmpdir(), 'must-not-publish-substituted-cast'),
  }],
});
assert.notEqual(selfAuthenticatedIdentity.run.status, 0);
assert.equal(selfAuthenticatedIdentity.report.status, 'failed');
assert.match(selfAuthenticatedIdentity.report.error, /cast hash mismatch/);

const partialOutputDir = join(tmpdir(), `partial-support-atlas-${Date.now()}`);
const partialPublication = await runFailureFixture({
  schema: 'kaminos.support-atlas-admission-manifest.v0',
  assayId: 'partial-publication-fixture',
  routeIdentity: {
    requested: 'trellis2mlx_fast',
    effective: 'trellis2mlx_fast',
  },
  casts: [
    {
      id: 'motion-ready-719024',
      role: 'accepted-control',
      glbPath: controlGlbPath,
      registrationPath: controlRegistrationPath,
      acceptedAtlasPath,
      acceptedAtlasSha256: 'e3007a55f930d709ac8a7bf684ff32ad862e7d55186343220edb3e2ad3635b78',
      expectedIdentity: controlIdentity,
      outputDir: partialOutputDir,
    },
    {
      id: 'missing-later-cast',
      role: 'pressure',
      glbPath: join(tmpdir(), 'no-such-later-cast.glb'),
      expectedIdentity: {
        castId: 'missing-later-cast',
        castHash: 'missing',
        registrationHash: 'missing',
        vertexCount: 1,
      },
      registration: {
        mode: 'axis-aligned-crawler-frame-v0',
        localForwardAxis: [0, 0, -1],
        localRightAxis: [1, 0, 0],
        localUpAxis: [0, 1, 0],
      },
      outputDir: join(tmpdir(), 'missing-later-cast-output'),
    },
  ],
});
assert.notEqual(partialPublication.run.status, 0);
assert.equal(partialPublication.report.status, 'failed');
await assert.rejects(
  access(join(partialOutputDir, 'assessment.json')),
  /ENOENT/,
  'a failed multi-cast assay must not publish an earlier cast admission',
);

console.log('lirm support-atlas admission assay contracts passed');
