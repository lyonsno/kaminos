import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
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
const execFileAsync = promisify(execFile);
const interactionRunnerPath = fileURLToPath(new URL(
  '../scripts/run-overlapping-anisotropic-tissue-interaction-assay.mjs',
  import.meta.url,
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
const overlapInteractionCard = JSON.parse(await readFile(
  new URL('../fixtures/analytical-tissue/overlapping-anisotropic-interaction-law-assay.v0.json', import.meta.url),
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

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalHash(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
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
    assert.equal(result.report.requestedCompilerId, overlapCard.compilerId);
    assert.equal(result.report.effectiveCompilerId, overlapCard.compilerId);
    assert.equal(result.report.requestedTargetRef, overlapCard.targetRef);
    assert.equal(result.report.effectiveTargetHash, overlapCard.targetIdentity.sha256);
    assert.equal(result.report.requestedDescriptorRef, overlapCard.descriptorRef);
    assert.equal(result.report.effectiveDescriptorHash, overlapCard.descriptorIdentity.sha256);
    assert.equal(result.report.requestedOverlapCardPath, null);
    assert.equal(result.report.requestedTargetPath, null);
    assert.equal(result.report.requestedDescriptorPath, null);
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

test('overlapping tissue compiler relabel cannot produce an authoritative report', async () => {
  await withTemporaryDirectory(async (outDir) => {
    const relabeled = structuredClone(overlapCard);
    relabeled.compilerId = 'scalar-metaball-sdf-v0';
    await assert.rejects(
      rowDistinctArtifacts.writeOverlappingAnisotropicTissueControlArtifacts({
        outDir,
        overlapCard: relabeled,
        overlapTarget: structuredClone(overlapTarget),
        descriptor: structuredClone(overlapDescriptor),
        frozenSweepCard: structuredClone(fullSurfaceCard),
        frozenAssayCard: structuredClone(assayCard),
        frozenTarget: structuredClone(target),
      }),
      /overlap assay card identity does not match authoritative route/,
    );
    const report = JSON.parse(await readFile(join(outDir, 'report.json'), 'utf8'));
    assert.equal(report.status, 'failed');
    assert.equal(report.failurePhase, 'input-validation');
    assert.equal(report.requestedCompilerId, 'scalar-metaball-sdf-v0');
    assert.equal(report.effectiveCompilerId, null);
    assert.deepEqual(report.outputs, []);
  });
});

test('coordinated overlap card and payload substitution fails before geometry', async () => {
  await withTemporaryDirectory(async (outDir) => {
    const coordinatedCard = structuredClone(overlapCard);
    const coordinatedTarget = structuredClone(overlapTarget);
    const coordinatedDescriptor = structuredClone(overlapDescriptor);
    coordinatedTarget.id = 'substituted-target';
    coordinatedDescriptor.tissues[0].strength += 0.01;
    coordinatedCard.targetIdentity = {
      id: coordinatedTarget.id,
      sha256: canonicalHash(coordinatedTarget),
    };
    coordinatedCard.descriptorIdentity = {
      id: coordinatedDescriptor.id,
      sha256: canonicalHash(coordinatedDescriptor),
    };

    await assert.rejects(
      rowDistinctArtifacts.writeOverlappingAnisotropicTissueControlArtifacts({
        outDir,
        overlapCard: coordinatedCard,
        overlapTarget: coordinatedTarget,
        descriptor: coordinatedDescriptor,
        frozenSweepCard: structuredClone(fullSurfaceCard),
        frozenAssayCard: structuredClone(assayCard),
        frozenTarget: structuredClone(target),
      }),
      /overlap assay card identity does not match authoritative route/,
    );
    const report = JSON.parse(await readFile(join(outDir, 'report.json'), 'utf8'));
    assert.equal(report.status, 'failed');
    assert.equal(report.failurePhase, 'input-validation');
    assert.equal(report.effectiveCompilerId, null);
    assert.deepEqual(report.outputs, []);
  });
});

test('interaction writer emits every signed candidate as hashed 3D and 2D evidence', async () => {
  assert.equal(
    typeof rowDistinctArtifacts.writeOverlappingAnisotropicTissueInteractionArtifacts,
    'function',
    'the interaction discriminator needs a candidate-complete artifact route',
  );
  await withTemporaryDirectory(async (outDir) => {
    const result = await rowDistinctArtifacts.writeOverlappingAnisotropicTissueInteractionArtifacts({
      outDir,
      interactionCard: structuredClone(overlapInteractionCard),
      overlapCard: structuredClone(overlapCard),
      overlapTarget: structuredClone(overlapTarget),
      descriptor: structuredClone(overlapDescriptor),
      frozenSweepCard: structuredClone(fullSurfaceCard),
      frozenAssayCard: structuredClone(assayCard),
      frozenTarget: structuredClone(target),
    });
    assert.equal(result.report.status, 'completed');
    assert.match(result.report.generationId, /^[0-9a-f-]{36}$/);
    assert.equal(result.report.evidencePassed, true);
    assert.equal(result.report.evidenceAuthority, 'narrowed');
    assert.equal(result.report.completeReferenceSet, false);
    assert.deepEqual(result.report.referenceLimitations, [{
      code: 'combined-reference-grid-uncontained',
      amplitudes: [0.5],
    }]);
    assert.equal(result.report.hypothesisPassed, false);
    assert.equal(result.report.conclusive, true);
    assert.equal(result.report.bestCandidateId, 'normalized-product-additive-32');
    assert.equal(result.report.outputs.filter(
      (output) => output.relativePath.endsWith('.obj'),
    ).length, 54);
    assert.ok(result.report.outputs.every((output) => /^[0-9a-f]{64}$/.test(output.sha256)));
    const serialized = JSON.parse(await readFile(join(outDir, 'assay.json'), 'utf8'));
    assert.equal(serialized.generationId, result.report.generationId);
    assert.equal(serialized.candidates.length, overlapInteractionCard.candidates.length);
    assert.ok(serialized.candidates.every((candidate) => candidate.amplitudes.every(
      (entry) => entry.mesh.vertices === undefined && entry.mesh.outputRef,
    )));
    const svg = await readFile(join(outDir, 'contact-sheet.svg'), 'utf8');
    assert.match(svg, /Signed overlap interaction law/);
    assert.match(svg, /additive field sum/);
    assert.match(svg, /normalized-product-subtractive-0\.5/);
    assert.match(svg, /normalized-product-additive-32/);
    assert.match(svg, /fit-only \/ quality fail/);
    assert.match(svg, /NARROWED AUTHORITY/);
    assert.match(svg, /amplitude 0\.5 reference grid-clipped\/open/);
    assert.match(svg, /RMSE remains analytic-field evidence/);
    assert.match(svg, new RegExp(result.report.generationId));
    assert.doesNotMatch(svg, /normalized-product-additive-32[\s\S]{0,200}· PASS/);
    assert.match(svg, new RegExp(result.assay.assayHash));
  });
});

test('interaction card substitution fails before construction and leaves an honest report', async () => {
  await withTemporaryDirectory(async (outDir) => {
    const counterfeit = structuredClone(overlapInteractionCard);
    counterfeit.candidates.at(-1).coefficient = 31;
    await assert.rejects(
      rowDistinctArtifacts.writeOverlappingAnisotropicTissueInteractionArtifacts({
        outDir,
        interactionCard: counterfeit,
        overlapCard: structuredClone(overlapCard),
        overlapTarget: structuredClone(overlapTarget),
        descriptor: structuredClone(overlapDescriptor),
        frozenSweepCard: structuredClone(fullSurfaceCard),
        frozenAssayCard: structuredClone(assayCard),
        frozenTarget: structuredClone(target),
      }),
      /overlap interaction card identity does not match authoritative assay/,
    );
    const report = JSON.parse(await readFile(join(outDir, 'report.json'), 'utf8'));
    assert.equal(report.status, 'failed');
    assert.equal(report.failurePhase, 'input-validation');
    assert.equal(report.effectiveRouteId, rowDistinctArtifacts.OVERLAPPING_INTERACTION_ARTIFACT_ROUTE);
    assert.deepEqual(report.outputs, []);
  });
});

test('failed interaction reruns replace stale success presentation with generation-matched tombstones', async () => {
  await withTemporaryDirectory(async (outDir) => {
    const argumentsFor = (overrides = {}) => ({
      outDir,
      interactionCard: structuredClone(overlapInteractionCard),
      overlapCard: structuredClone(overlapCard),
      overlapTarget: structuredClone(overlapTarget),
      descriptor: structuredClone(overlapDescriptor),
      frozenSweepCard: structuredClone(fullSurfaceCard),
      frozenAssayCard: structuredClone(assayCard),
      frozenTarget: structuredClone(target),
      ...overrides,
    });
    const successful = await rowDistinctArtifacts
      .writeOverlappingAnisotropicTissueInteractionArtifacts(argumentsFor());

    await assert.rejects(
      rowDistinctArtifacts.writeOverlappingAnisotropicTissueInteractionArtifacts(
        argumentsFor({ requestedRouteId: 'counterfeit-route' }),
      ),
      /requested route counterfeit-route is unavailable/,
    );
    const routeReport = JSON.parse(await readFile(join(outDir, 'report.json'), 'utf8'));
    const routeAssay = JSON.parse(await readFile(join(outDir, 'assay.json'), 'utf8'));
    const routeSvg = await readFile(join(outDir, 'contact-sheet.svg'), 'utf8');
    assert.equal(routeReport.status, 'failed');
    assert.notEqual(routeReport.generationId, successful.report.generationId);
    assert.equal(routeAssay.status, 'failed');
    assert.equal(routeAssay.generationId, routeReport.generationId);
    assert.match(routeSvg, /INTERACTION ASSAY FAILED/);
    assert.match(routeSvg, new RegExp(routeReport.generationId));
    assert.doesNotMatch(routeSvg, /normalized-product-additive-32/);

    const counterfeit = structuredClone(overlapInteractionCard);
    counterfeit.candidates.at(-1).coefficient = 31;
    await assert.rejects(
      rowDistinctArtifacts.writeOverlappingAnisotropicTissueInteractionArtifacts(
        argumentsFor({ interactionCard: counterfeit }),
      ),
      /overlap interaction card identity does not match authoritative assay/,
    );
    const cardReport = JSON.parse(await readFile(join(outDir, 'report.json'), 'utf8'));
    const cardAssay = JSON.parse(await readFile(join(outDir, 'assay.json'), 'utf8'));
    const cardSvg = await readFile(join(outDir, 'contact-sheet.svg'), 'utf8');
    assert.equal(cardReport.status, 'failed');
    assert.notEqual(cardReport.generationId, routeReport.generationId);
    assert.equal(cardAssay.generationId, cardReport.generationId);
    assert.match(cardSvg, new RegExp(cardReport.generationId));
    assert.doesNotMatch(cardSvg, /normalized-product-additive-32/);

    await assert.rejects(
      execFileAsync(process.execPath, [
        interactionRunnerPath,
        '--out', outDir,
        '--interaction-card', join(outDir, 'missing-interaction-card.json'),
      ]),
      /ENOENT/,
    );
    const inputReport = JSON.parse(await readFile(join(outDir, 'report.json'), 'utf8'));
    const inputAssay = JSON.parse(await readFile(join(outDir, 'assay.json'), 'utf8'));
    const inputSvg = await readFile(join(outDir, 'contact-sheet.svg'), 'utf8');
    assert.equal(inputReport.status, 'failed');
    assert.equal(inputReport.failurePhase, 'input-read');
    assert.notEqual(inputReport.generationId, cardReport.generationId);
    assert.equal(inputAssay.generationId, inputReport.generationId);
    assert.match(inputSvg, /ENOENT/);
    assert.match(inputSvg, new RegExp(inputReport.generationId));
    assert.doesNotMatch(inputSvg, /normalized-product-additive-32/);

    const restored = await rowDistinctArtifacts
      .writeOverlappingAnisotropicTissueInteractionArtifacts(argumentsFor());
    const restoredAssay = JSON.parse(await readFile(join(outDir, 'assay.json'), 'utf8'));
    const restoredSvg = await readFile(join(outDir, 'contact-sheet.svg'), 'utf8');
    assert.equal(restored.report.status, 'completed');
    assert.equal(restoredAssay.generationId, restored.report.generationId);
    assert.match(restoredSvg, new RegExp(restored.report.generationId));
    assert.match(restoredSvg, /normalized-product-additive-32/);
  });
});
