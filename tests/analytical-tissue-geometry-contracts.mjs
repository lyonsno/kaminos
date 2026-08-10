import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  ANALYTICAL_TISSUE_GEOMETRY_ASSAY_SCHEMA,
  analyticalTissueMeshToObj,
  buildAnalyticalTissueMuscleTensionAssay,
  renderAnalyticalTissueAssaySvg,
  writeAnalyticalTissueMuscleTensionArtifacts,
} from '../analytical-tissue-geometry-core.mjs';

const descriptor = JSON.parse(await readFile(
  new URL('../fixtures/analytical-tissue/synthetic-hindquarter-neutral.v0.json', import.meta.url),
  'utf8',
));
const rowPlan = JSON.parse(await readFile(
  new URL('../fixtures/analytical-tissue/factored-row-plan.v0.json', import.meta.url),
  'utf8',
));
const execFileAsync = promisify(execFile);

function build() {
  return buildAnalyticalTissueMuscleTensionAssay({
    descriptor: structuredClone(descriptor),
    rowPlan: structuredClone(rowPlan),
    delta: 0.1,
    stationCount: 65,
    radialSegments: 32,
  });
}

function edgeUseCounts(mesh) {
  const counts = new Map();
  for (const face of mesh.faces) {
    for (let index = 0; index < face.length; index += 1) {
      const a = face[index];
      const b = face[(index + 1) % face.length];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

test('assay compiles the exact four frozen rows under one effective route', () => {
  const assay = build();
  assert.equal(assay.schema, ANALYTICAL_TISSUE_GEOMETRY_ASSAY_SCHEMA);
  assert.equal(assay.status, 'completed');
  assert.deepEqual(assay.rows.map((row) => row.id), rowPlan.rows.map((row) => row.id));
  assert.ok(assay.rows.every((row) => row.effectiveRouteId === assay.effectiveRoute.id));
  assert.ok(assay.rows.every((row) => row.cameraHash === assay.camera.hash));
});

test('every baseline and perturbed row emits a closed nontrivial envelope mesh', () => {
  const assay = build();
  assert.equal(assay.rows.length, rowPlan.rows.length, 'missing rows cannot pass mesh closure');
  for (const row of assay.rows) {
    for (const state of [row.baseline, row.perturbed]) {
      assert.ok(state.mesh.vertices.length > 100, `${row.id} mesh is too small`);
      assert.ok(state.mesh.faces.length > 100, `${row.id} mesh has too few faces`);
      assert.ok(
        [...edgeUseCounts(state.mesh).values()].every((count) => count === 2),
        `${row.id} mesh is not a closed two-manifold`,
      );
    }
  }
});

test('control rows retain observations without becoming positive admission', () => {
  const assay = build();
  for (const rowId of ['scalar-union-negative-control', 'explicit-shell-causal-null']) {
    const row = assay.rows.find((candidate) => candidate.id === rowId);
    assert.equal(row.verdict.passed, false, rowId);
    assert.ok(row.verdict.failures.some((failure) => failure.code === 'assay-row-control-only'));
  }
  const nullRow = assay.rows.find((row) => row.id === 'explicit-shell-causal-null');
  assert.equal(nullRow.response.observables.muscleBulge, 0);
  assert.equal(nullRow.verdict.numeric.passed, false);
});

test('factored hybrid produces the source-warranted signed coupled response', () => {
  const assay = build();
  const hybrid = assay.rows.find((row) => row.id === 'factored-hybrid-leading-hypothesis');
  assert.deepEqual(
    Object.fromEntries(Object.entries(assay.source.response.observables).map(([key, value]) => [
      key,
      Math.sign(value),
    ])),
    { muscleBulge: 1, fatSpan: 1, tetherAnchor: -1, skinSlack: 1 },
  );
  assert.equal(hybrid.verdict.passed, true, JSON.stringify(hybrid.verdict.failures));
  assert.equal(hybrid.verdict.numeric.couplingHeld, true);
});

test('hybrid muscle response is localized, smooth, and attributable', () => {
  const hybrid = build().rows.find((row) => row.id === 'factored-hybrid-leading-hypothesis');
  assert.ok(hybrid.response.localization.ratio >= 4, hybrid.response.localization.ratio);
  assert.ok(hybrid.response.smoothness.maxSecondDifference < 0.08);
  assert.equal(hybrid.response.attribution.dominantComponentId, 'gluteal-carrier');
  assert.ok(hybrid.response.attribution.targetFraction > 0.5);
});

test('geometry and visual serialization are deterministic and identity-bearing', () => {
  const first = build();
  const second = build();
  assert.equal(first.assayHash, second.assayHash);
  const hybrid = first.rows.find((row) => row.id === 'factored-hybrid-leading-hypothesis');
  const obj = analyticalTissueMeshToObj(hybrid.perturbed.mesh, { objectId: hybrid.id });
  assert.match(obj, /^o factored-hybrid-leading-hypothesis/m);
  assert.match(obj, /^v /m);
  assert.match(obj, /^f /m);
  const svg = renderAnalyticalTissueAssaySvg(first);
  assert.match(svg, /<svg/);
  assert.match(svg, /scalar-union-negative-control/);
  assert.match(svg, /factored-hybrid-leading-hypothesis/);
  assert.match(svg, /baseline/);
  assert.match(svg, /perturbed/);
});

test('artifact writer preserves a durable failure report before primary output', async (t) => {
  const outDir = await mkdtemp(join(tmpdir(), 'kaminos-analytical-tissue-failure-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  await assert.rejects(
    writeAnalyticalTissueMuscleTensionArtifacts({ outDir, descriptor: null, rowPlan }),
    /descriptor and rowPlan are required/,
  );
  const report = JSON.parse(await readFile(join(outDir, 'report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'input-validation');
  assert.equal(report.lastTrustworthyEvidence, 'output directory created; no assay artifact emitted');
});

test('artifact writer records effective route and nonblank hashed products', async (t) => {
  const outDir = await mkdtemp(join(tmpdir(), 'kaminos-analytical-tissue-success-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const result = await writeAnalyticalTissueMuscleTensionArtifacts({
    outDir,
    descriptor: structuredClone(descriptor),
    rowPlan: structuredClone(rowPlan),
  });
  assert.equal(result.report.status, 'completed');
  assert.equal(result.report.requestedRouteId, result.report.effectiveRouteId);
  assert.equal(result.report.outputs.length, 10);
  assert.ok(result.report.outputs.every((output) => output.byteLength > 100));
  assert.ok(result.report.outputs.every((output) => /^[0-9a-f]{64}$/.test(output.sha256)));
});

test('headless runner reports input-read failure before any primary artifact', async (t) => {
  const outDir = await mkdtemp(join(tmpdir(), 'kaminos-analytical-tissue-cli-failure-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  await assert.rejects(execFileAsync(process.execPath, [
    new URL('../scripts/run-analytical-tissue-muscle-tension-assay.mjs', import.meta.url).pathname,
    '--out', outDir,
    '--descriptor', join(outDir, 'missing-descriptor.json'),
  ]));
  const report = JSON.parse(await readFile(join(outDir, 'report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'input-read');
  assert.equal(report.outputs.length, 0);
  assert.equal(report.lastTrustworthyEvidence, 'output directory created; no assay artifact emitted');
});
