import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAnalyticalElbowCP0Bundle } from '../analytical-elbow-positive-volume-c-p0-core.mjs';
import {
  createAnalyticalElbowCP0WitnessDataset,
  writeAnalyticalElbowCP0Witness,
} from '../analytical-elbow-positive-volume-c-p0-witness.mjs';

const dataset = createAnalyticalElbowCP0WitnessDataset();

assert.equal(dataset.schema, 'kaminos.analytical-elbow-positive-volume-c-p0-witness-data.v0');
assert.equal(dataset.status, 'complete');
assert.equal(dataset.requestedRoute, 'analytical-elbow-positive-volume-c-p0-witness');
assert.equal(dataset.effectiveRoute, dataset.requestedRoute);
assert.equal(dataset.fallbackUsed, false);
assert.deepEqual(dataset.cases.map(entry => entry.id), [
  'scalar-control-35-collar-0.72',
  'c-p0-w-derived-35',
]);

for (const entry of dataset.cases) {
  assert.equal(entry.vertices.length, 986);
  assert.equal(entry.triangles.length, 1968);
  assert.ok(entry.vertices.every(vertex =>
    vertex.rest.every(Number.isFinite) &&
    vertex.posed.every(Number.isFinite)
  ));
  assert.ok(entry.triangles.every(triangle =>
    triangle.indices.length === 3 &&
    Number.isFinite(triangle.maximumAbsoluteLogEdgeStrain) &&
    Number.isFinite(triangle.absoluteLogAreaStrain) &&
    typeof triangle.inverted === 'boolean'
  ));
}

assert.equal(dataset.comparison.candidateInitialization, 'w-derived');
assert.equal(dataset.comparison.status, 'NUMERICAL_CANDIDATE');
assert.ok(
  dataset.comparison.candidateQ95AbsoluteLogEdgeStrain <
    dataset.comparison.scalarControlQ95AbsoluteLogEdgeStrain,
);
assert.equal(dataset.visualContract.startsPaused, true);
assert.equal(dataset.visualContract.animationActive, false);
assert.deepEqual(dataset.visualContract.cameraPresets, ['profile', 'three-quarter']);
assert.match(dataset.claimCeiling, /visual consumer candidate/);

const root = await mkdtemp(join(tmpdir(), 'c-p0-witness-'));
const result = await writeAnalyticalElbowCP0Witness({ outDir:join(root, 'complete') });
assert.equal(result.report.status, 'complete');
assert.equal(result.report.route.fallbackUsed, false);
assert.equal(
  result.report.source.candidateArtifactSha256,
  '4facc5ba2d018fce24d749966f46c4041ee95279cd5d31e642024a0ad90f4005',
);
assert.equal(
  result.dataset.source.candidateArtifactSha256,
  result.report.source.candidateArtifactSha256,
);

const html = await readFile(join(root, 'complete', 'index.html'), 'utf8');
assert.match(html, /data-witness-route="analytical-elbow-positive-volume-c-p0-witness"/);
assert.match(html, /__KAMINOS_C_P0_WITNESS__/);
assert.match(
  html,
  /sourceArtifactSha256:data\.source\.candidateArtifactSha256/,
);
assert.match(html, /Scalar 0\.72 control/);
assert.match(html, /W-seeded P0 candidate/);
assert.match(html, /paused:true/);
assert.match(html, /animationActive:false/);
assert.doesNotMatch(html, /setAnimationLoop/);
assert.doesNotMatch(html, /requestAnimationFrame/);

const invalidBundle = createAnalyticalElbowCP0Bundle();
invalidBundle.report.fallbackUsed = true;
const failureRoot = join(root, 'failed');
await assert.rejects(
  writeAnalyticalElbowCP0Witness({ outDir:failureRoot, bundle:invalidBundle }),
  /canonical C\(P0\) route identity/,
);
const failure = JSON.parse(await readFile(join(failureRoot, 'report.json'), 'utf8'));
assert.equal(failure.status, 'failed');
assert.equal(failure.failurePhase, 'create-exact-dataset');
assert.equal(failure.primaryOutput, null);

console.log('analytical elbow C(P0) witness contracts passed');
