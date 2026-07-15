#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as fitter from '../smoke-gaussian-oracle-fitter.mjs';

assert.equal(
  typeof fitter.analyzeSmokeFieldTomography,
  'function',
  'the smoke fitter must expose exact held-field tomography',
);
assert.equal(
  typeof fitter.renderSmokeFieldTomographyPng,
  'function',
  'the tomography contract must produce an inspectable visual witness',
);
assert.equal(
  typeof fitter.writeSmokeFieldTomographyWitness,
  'function',
  'the tomography contract must preserve a durable failure report',
);

const grid = 3;
const channels = 16;
const field = new Float32Array(grid * grid * grid * channels);
const smokeChannel = 4;
const setSmoke = (x, y, z, density) => {
  field[(((z * grid * grid) + (y * grid) + x) * channels) + smokeChannel] = density;
};

setSmoke(0, 0, 0, 0.25);
setSmoke(1, 1, 1, 0.75);
setSmoke(2, 2, 2, 1.25);

const result = fitter.analyzeSmokeFieldTomography({
  field,
  grid,
  worldSpace: {
    bounds: {
      minimum: [-1, -1, -1],
      maximum: [1, 1, 1],
    },
  },
}, {
  thresholds: [0, 0.5, 1],
});

assert.equal(result.identity, 'smoke-held-field-tomography-v0');
assert.deepEqual(result.requestedThresholds, [0, 0.5, 1]);
assert.equal(result.hiddenThresholdCapApplied, false);
assert.equal(result.totalVoxelCount, 27);
assert.equal(result.totalSmokeExtinction, 2.25);

const [allSmoke, mediumSmoke, hotSmoke] = result.thresholdSweep;
assert.equal(allSmoke.occupiedVoxelCount, 3);
assert.equal(allSmoke.retainedSmokeExtinction, 2.25);
assert.deepEqual(allSmoke.gridBounds, {
  minimum: [0, 0, 0],
  maximum: [2, 2, 2],
});
assert.equal(allSmoke.projections.xy.occupiedPixelCount, 3);
assert.equal(allSmoke.projections.xz.occupiedPixelCount, 3);
assert.equal(allSmoke.projections.yz.occupiedPixelCount, 3);

assert.equal(mediumSmoke.occupiedVoxelCount, 2);
assert.equal(mediumSmoke.retainedSmokeExtinction, 2);
assert.deepEqual(mediumSmoke.gridBounds, {
  minimum: [1, 1, 1],
  maximum: [2, 2, 2],
});
assert.equal(hotSmoke.occupiedVoxelCount, 1);
assert.equal(hotSmoke.retainedSmokeExtinction, 1.25);
assert.equal(hotSmoke.projections.xy.occupiedPixelFraction, 1 / 9);

const png = fitter.renderSmokeFieldTomographyPng(result, { cellScale: 2 });
assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
assert.ok(png.byteLength > 64);

assert.throws(
  () => fitter.analyzeSmokeFieldTomography({ field, grid }, { thresholds: [0.5, 0.5] }),
  /strictly increasing/,
);
assert.throws(
  () => fitter.analyzeSmokeFieldTomography({ field: field.subarray(1), grid }, { thresholds: [0] }),
  /field length mismatch/,
);

const failureDir = await mkdtemp(join(tmpdir(), 'kaminos-smoke-tomography-failure-'));
await assert.rejects(
  fitter.writeSmokeFieldTomographyWitness({
    manifestPath: join(failureDir, 'missing-manifest.json'),
    expectedManifestSha256: 'f'.repeat(64),
    outDir: failureDir,
    thresholds: [0, 0.5],
  }),
  /ENOENT/,
);
const failureReport = JSON.parse(await readFile(join(failureDir, 'tomography-report.json'), 'utf8'));
assert.equal(failureReport.status, 'failed');
assert.equal(failureReport.failurePhase, 'load-source');
assert.deepEqual(failureReport.requestedThresholds, [0, 0.5]);
assert.equal(failureReport.hiddenThresholdCapApplied, false);
await rm(failureDir, { recursive: true, force: true });

console.log('smoke held-field tomography contracts passed');
