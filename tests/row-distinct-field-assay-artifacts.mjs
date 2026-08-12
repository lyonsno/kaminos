import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  ROW_DISTINCT_ARTIFACT_ROUTE,
  renderRowDistinctAssaySvg,
  writeRowDistinctAssayArtifacts,
} from '../row-distinct-field-assay-artifacts.mjs';
import * as rowDistinctArtifacts from '../row-distinct-field-assay-artifacts.mjs';
import { buildRowDistinctScalarAnisotropicAssay } from '../row-distinct-field-assay-core.mjs';

const assayCard = JSON.parse(await readFile(
  new URL('../fixtures/analytical-tissue/row-distinct-scalar-anisotropic-assay.v0.json', import.meta.url),
  'utf8',
));
const target = JSON.parse(await readFile(
  new URL('../fixtures/analytical-tissue/row-distinct-hindquarter-target.v0.json', import.meta.url),
  'utf8',
));
const fullSurfaceCard = JSON.parse(await readFile(
  new URL('../fixtures/analytical-tissue/target-sdf-full-surface-sweep-assay.v0.json', import.meta.url),
  'utf8',
));
const overlapCard = JSON.parse(await readFile(
  new URL('../fixtures/analytical-tissue/overlapping-anisotropic-tissue-control-assay.v0.json', import.meta.url),
  'utf8',
));
const overlapTarget = JSON.parse(await readFile(
  new URL('../fixtures/analytical-tissue/overlapping-hindquarter-tissue-target.v0.json', import.meta.url),
  'utf8',
));
const overlapDescriptor = JSON.parse(await readFile(
  new URL('../fixtures/analytical-tissue/overlapping-anisotropic-tissue-descriptor.v0.json', import.meta.url),
  'utf8',
));

async function withTemporaryDirectory(run) {
  const path = await mkdtemp(join(tmpdir(), 'row-distinct-assay-'));
  try {
    return await run(path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}

test('artifact writer emits hashed result, fixed-camera contact sheet, and four meshes', async () => {
  await withTemporaryDirectory(async (outDir) => {
    const result = await writeRowDistinctAssayArtifacts({ outDir, assayCard, target });
    assert.equal(result.report.status, 'completed');
    assert.equal(result.report.requestedRouteId, ROW_DISTINCT_ARTIFACT_ROUTE);
    assert.equal(result.report.effectiveRouteId, ROW_DISTINCT_ARTIFACT_ROUTE);
    assert.equal(result.report.cameraId, assayCard.camera.id);
    assert.equal(result.report.admissionPassed, true);
    assert.equal(result.report.outputs.length, 6);
    assert.ok(result.report.outputs.every((output) => /^[0-9a-f]{64}$/.test(output.sha256)));
    assert.ok(result.report.outputs.every((output) => output.byteLength > 100));
    const svg = await readFile(join(outDir, 'contact-sheet.svg'), 'utf8');
    assert.match(svg, /scalar-metaball-control/);
    assert.match(svg, /anisotropic-identity-challenger/);
    assert.match(svg, new RegExp(assayCard.camera.id));
    assert.match(svg, new RegExp(result.assay.assayHash));
  });
});

test('artifact renderer rejects partial or stale-looking assay products', () => {
  assert.throws(
    () => renderRowDistinctAssaySvg({ status: 'partial', rows: [] }),
    /completed row-distinct assay is required/,
  );
});

test('contact sheet cannot present a candidate as admitted when baseline parity fails', () => {
  const breached = structuredClone(assayCard);
  breached.baselineFit.maximumBetweenRowNormalizedRmseGap = 0;
  const assay = buildRowDistinctScalarAnisotropicAssay({ assayCard: breached, target });
  const svg = renderRowDistinctAssaySvg(assay, target);
  assert.doesNotMatch(svg, /candidate admitted/);
  assert.match(svg, /candidate not admitted/);
  assert.match(svg, /between-row-baseline-parity-failed/);
});

test('route substitution fails loud and still leaves a phase-named report', async () => {
  await withTemporaryDirectory(async (outDir) => {
    await assert.rejects(
      writeRowDistinctAssayArtifacts({
        outDir,
        assayCard,
        target,
        requestedRouteId: 'fallback-metaball-route',
      }),
      /requested route fallback-metaball-route is unavailable/,
    );
    const report = JSON.parse(await readFile(join(outDir, 'report.json'), 'utf8'));
    assert.equal(report.status, 'failed');
    assert.equal(report.failurePhase, 'input-validation');
    assert.equal(report.requestedRouteId, 'fallback-metaball-route');
    assert.equal(report.effectiveRouteId, null);
    assert.deepEqual(report.outputs, []);
  });
});

test('full-surface writer emits hashed 3D meshes and mesh-derived 2D diagnostics', async () => {
  assert.equal(
    typeof rowDistinctArtifacts.writeTargetSdfFullSurfaceArtifacts,
    'function',
    'the full-surface assay needs a durable artifact route',
  );
  await withTemporaryDirectory(async (outDir) => {
    const result = await rowDistinctArtifacts.writeTargetSdfFullSurfaceArtifacts({
      outDir,
      sweepCard: structuredClone(fullSurfaceCard),
      assayCard: structuredClone(assayCard),
      target: structuredClone(target),
    });
    assert.equal(result.report.status, 'completed');
    assert.equal(result.report.evidencePrimary, 'full-surface-3d');
    assert.equal(result.report.sectionSource, 'extracted-mesh-triangle-plane-intersections');
    assert.equal(result.report.outputs.filter((output) => output.relativePath.endsWith('.obj')).length, 10);
    assert.ok(result.report.outputs.every((output) => /^[0-9a-f]{64}$/.test(output.sha256)));
    const svg = await readFile(join(outDir, 'contact-sheet.svg'), 'utf8');
    assert.match(svg, /full-surface 3D primary/);
    assert.match(svg, /mesh-derived 2D sections/);
    assert.match(svg, /amplitude 0\.5/);
    assert.match(svg, new RegExp(result.assay.assayHash));
  });
});

test('full-surface route substitution fails before any mesh can look authoritative', async () => {
  await withTemporaryDirectory(async (outDir) => {
    await assert.rejects(
      rowDistinctArtifacts.writeTargetSdfFullSurfaceArtifacts({
        outDir,
        sweepCard: structuredClone(fullSurfaceCard),
        assayCard: structuredClone(assayCard),
        target: structuredClone(target),
        requestedRouteId: 'profile-only-fallback',
      }),
      /requested route profile-only-fallback is unavailable/,
    );
    const report = JSON.parse(await readFile(join(outDir, 'report.json'), 'utf8'));
    assert.equal(report.status, 'failed');
    assert.equal(report.failurePhase, 'input-validation');
    assert.equal(report.effectiveRouteId, null);
    assert.deepEqual(report.outputs, []);
  });
});

test('full-surface renderer rejects partial evidence', () => {
  assert.throws(
    () => rowDistinctArtifacts.renderTargetSdfFullSurfaceSvg({
      schema: 'kaminos.target-sdf-full-surface-sweep-result.v0',
      status: 'partial',
      verdict: { passed: true },
      amplitudes: [{}, {}, {}],
    }),
    /admitted target-SDF full-surface sweep is required/,
  );
});

test('overlapping tissue writer emits hashed 3D products and mesh-derived 2D diagnostics', async () => {
  assert.equal(
    typeof rowDistinctArtifacts.writeOverlappingAnisotropicTissueControlArtifacts,
    'function',
    'the overlap discriminator needs a durable visual evidence route',
  );
  await withTemporaryDirectory(async (outDir) => {
    const result = await rowDistinctArtifacts.writeOverlappingAnisotropicTissueControlArtifacts({
      outDir,
      overlapCard: structuredClone(overlapCard),
      overlapTarget: structuredClone(overlapTarget),
      descriptor: structuredClone(overlapDescriptor),
      frozenSweepCard: structuredClone(fullSurfaceCard),
      frozenAssayCard: structuredClone(assayCard),
      frozenTarget: structuredClone(target),
    });
    assert.equal(result.report.status, 'completed');
    assert.equal(result.report.evidencePrimary, 'full-surface-3d');
    assert.equal(result.report.sectionSource, 'extracted-mesh-triangle-plane-intersections');
    assert.equal(result.report.requestedRouteId, rowDistinctArtifacts.OVERLAPPING_TISSUE_ARTIFACT_ROUTE);
    assert.equal(result.report.effectiveRouteId, rowDistinctArtifacts.OVERLAPPING_TISSUE_ARTIFACT_ROUTE);
    assert.ok(result.report.outputs.filter((output) => output.relativePath.endsWith('.obj')).length >= 13);
    assert.ok(result.report.outputs.every((output) => /^[0-9a-f]{64}$/.test(output.sha256)));
    const serializedAssay = JSON.parse(await readFile(join(outDir, 'assay.json'), 'utf8'));
    const outputPaths = new Set(result.report.outputs.map((output) => output.relativePath));
    assert.equal(serializedAssay.baseline.mesh.outputRef, 'baseline-overlapping-anisotropic.obj');
    assert.equal(serializedAssay.baseline.mesh.vertices, undefined);
    assert.ok(outputPaths.has(serializedAssay.baseline.mesh.outputRef));
    assert.ok(Object.values(serializedAssay.controls).every((control) => (
      control.amplitudes.every((entry) => (
        outputPaths.has(entry.mesh.outputRef) && outputPaths.has(entry.reference.mesh.outputRef)
      ))
    )));
    const svg = await readFile(join(outDir, 'contact-sheet.svg'), 'utf8');
    assert.match(svg, /Overlapping anisotropic tissue control/);
    assert.match(svg, /muscle-tension/);
    assert.match(svg, /fat-distribution/);
    assert.match(svg, /combined/);
    assert.match(svg, /full-surface 3D/);
    assert.match(svg, /mesh-derived sections/);
    assert.match(svg, new RegExp(result.assay.assayHash));
  });
});

test('overlapping tissue route substitution leaves a phase-named failure report', async () => {
  await withTemporaryDirectory(async (outDir) => {
    await assert.rejects(
      rowDistinctArtifacts.writeOverlappingAnisotropicTissueControlArtifacts({
        outDir,
        overlapCard: structuredClone(overlapCard),
        overlapTarget: structuredClone(overlapTarget),
        descriptor: structuredClone(overlapDescriptor),
        frozenSweepCard: structuredClone(fullSurfaceCard),
        frozenAssayCard: structuredClone(assayCard),
        frozenTarget: structuredClone(target),
        requestedRouteId: 'scalar-rescue-fallback',
      }),
      /requested route scalar-rescue-fallback is unavailable/,
    );
    const report = JSON.parse(await readFile(join(outDir, 'report.json'), 'utf8'));
    assert.equal(report.status, 'failed');
    assert.equal(report.failurePhase, 'input-validation');
    assert.equal(report.effectiveRouteId, null);
    assert.deepEqual(report.outputs, []);
  });
});
