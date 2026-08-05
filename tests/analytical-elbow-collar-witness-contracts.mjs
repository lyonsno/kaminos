import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createShapeBearingCollarWitnessDataset } from '../analytical-elbow-collar-assay-core.mjs';
import { writeShapeBearingCollarWitness } from '../analytical-elbow-collar-witness.mjs';
import {
  createAnalyticalElbowConsumerExport,
  createAnalyticalElbowDescriptor,
} from '../analytical-elbow-core.mjs';

const source = createAnalyticalElbowConsumerExport(
  createAnalyticalElbowDescriptor(),
  { flexionDegrees: [0, 35, 80] },
);

const dataset = createShapeBearingCollarWitnessDataset({ source });

assert.equal(dataset.schema, 'kaminos.shape-bearing-collar-witness-data.v0');
assert.equal(dataset.status, 'complete');
assert.equal(dataset.requestedRoute, 'analytical-elbow-collar-failure-witness');
assert.equal(dataset.effectiveRoute, dataset.requestedRoute);
assert.equal(dataset.fallbackUsed, false);
assert.deepEqual(
  dataset.cases.map(entry => [entry.flexionDegrees, entry.collarHalfWidth]),
  [[35, 0], [35, 0.72], [80, 0], [80, 0.72]],
);
assert.equal(dataset.cases[0].vertices.length, 986);
assert.equal(dataset.cases[0].triangles.length, 1968);

for (const entry of dataset.cases) {
  assert.ok(entry.vertices.every(vertex =>
    vertex.rest.every(Number.isFinite) &&
    vertex.posed.every(Number.isFinite) &&
    Number.isFinite(vertex.weight)
  ));
  assert.ok(entry.triangles.every(triangle =>
    triangle.indices.length === 3 &&
    Number.isFinite(triangle.maximumAbsoluteLogEdgeStrain) &&
    Number.isFinite(triangle.absoluteLogAreaStrain) &&
    typeof triangle.inverted === 'boolean'
  ));
  assert.deepEqual(
    entry.metrics,
    dataset.assay.rows.find(row =>
      row.flexionDegrees === entry.flexionDegrees &&
      row.collarHalfWidth === entry.collarHalfWidth
    ).metrics,
  );
}

assert.equal(dataset.visualContract.startsPaused, true);
assert.equal(dataset.visualContract.animationActive, false);
assert.equal(dataset.visualContract.heatThresholdLogStrain, Math.log(1.15));
assert.deepEqual(dataset.visualContract.cameraPresets, ['profile', 'three-quarter']);
assert.match(dataset.claimCeiling, /synthetic sleeve/);

const root = await mkdtemp(join(tmpdir(), 'collar-witness-'));
const result = await writeShapeBearingCollarWitness({
  outDir: join(root, 'complete'),
  source,
});
assert.equal(result.report.status, 'complete');
assert.equal(result.report.cases.length, 4);
assert.equal(result.report.visualContract.startsPaused, true);
assert.equal(result.report.visualContract.animationActive, false);

const html = await readFile(join(root, 'complete', 'index.html'), 'utf8');
assert.match(html, /data-witness-route="analytical-elbow-collar-failure-witness"/);
assert.match(html, /data-witness-loaded="false"/);
assert.match(html, /__KAMINOS_COLLAR_WITNESS__/);
assert.match(html, /paused:true/);
assert.match(html, /animationActive:false/);
assert.match(html, /parent rigid/);
assert.match(html, /collar/);
assert.match(html, /child rigid/);
assert.match(html, /maximumAbsoluteLogEdgeStrain/);
assert.match(html, /new URLSearchParams/);
assert.match(html, /parameters\.get\('camera'\)/);
assert.match(html, /parameters\.get\('wire'\) === '1'/);
assert.match(
  html,
  /\.cell-head \{ grid-template-columns:1fr; gap:4px; \}/,
  'mobile case headers must stack labels and metrics instead of clipping metrics',
);
assert.match(
  html,
  /\.metric \{ justify-self:start; max-width:100%; white-space:normal; text-align:left; overflow-wrap:anywhere; \}/,
  'mobile metrics must remain fully inspectable',
);
assert.doesNotMatch(html, /setAnimationLoop/);
assert.doesNotMatch(html, /requestAnimationFrame/);

const persistedDataset = JSON.parse(
  await readFile(join(root, 'complete', 'dataset.json'), 'utf8'),
);
assert.deepEqual(persistedDataset, result.dataset);
const persistedReport = JSON.parse(
  await readFile(join(root, 'complete', 'report.json'), 'utf8'),
);
assert.deepEqual(persistedReport, result.report);

const invalidSource = structuredClone(source);
invalidSource.fallbackUsed = true;
const failureRoot = join(root, 'failed');
await assert.rejects(
  writeShapeBearingCollarWitness({ outDir:failureRoot, source:invalidSource }),
  /reviewed analytical elbow source identity/,
);
const failure = JSON.parse(await readFile(join(failureRoot, 'report.json'), 'utf8'));
assert.equal(failure.status, 'failed');
assert.equal(failure.failurePhase, 'create-exact-dataset');
assert.equal(failure.route.effective, null);
assert.equal(failure.source.fallbackUsed, true);

console.log('analytical elbow collar witness contracts passed');
