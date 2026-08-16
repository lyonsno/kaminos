import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  PROCEDURAL_GROOM_TRUTH_REPORT_SCHEMA,
  PROCEDURAL_GROOM_TRUTH_SCHEMA,
  evaluateProceduralGroomTruth,
  runProceduralGroomTruthPreflight,
} from '../procedural-groom-truth-core.mjs';

const H = digit => digit.repeat(64);

function guide(id, systemId, overrides = {}) {
  return {
    id,
    systemId,
    root: {
      triangleIndex: 12,
      barycentric: [0.2, 0.3, 0.5],
      neutralPosition: [0.1, -0.2, 0.3],
      deformedPosition: [0.18, -0.2, 0.3],
    },
    frame: {
      normal: [0, 0, 1],
      tangent: [1, 0, 0],
      bitangent: [0, 1, 0],
    },
    flow: [0.98, 0.2, 0],
    length: 0.12,
    density: 18,
    lift: 0.08,
    puff: systemId === 'short-coat-high-puff' ? 'high' : 'low',
    stiffness: 0.7,
    confidence: 1,
    provenance: 'procedural-authored-truth',
    points: [[0, 0, 0], [0.08, 0.02, 0.01], [0.12, 0.03, 0.02]],
    ...overrides,
  };
}

function manifest(overrides = {}) {
  const guides = [
    guide('coat-low-0', 'short-coat-low-puff'),
    guide('coat-high-0', 'short-coat-high-puff'),
    guide('ruff-0', 'ruff', { length: 0.42, density: 9, lift: 0.34 }),
    guide('whisker-left-0', 'mystacial-whiskers', { length: 0.58, density: 2, lift: 0.02 }),
    guide('whisker-right-0', 'mystacial-whiskers', { length: 0.55, density: 2, lift: 0.02 }),
  ];
  return {
    schema: PROCEDURAL_GROOM_TRUTH_SCHEMA,
    fixtureId: 'procedural-groom-truth-v0',
    source: {
      kind: 'procedural-authored-truth',
      generatorPath: 'tools/generate-procedural-groom-truth.py',
      generatorSha256: H('a'),
      requestedRoute: 'gpu-greenroom:kaminos_blender_cast_cleanup',
      effectiveRoute: 'gpu-greenroom:kaminos_blender_cast_cleanup',
    },
    carrier: {
      mesh: {
        path: 'carrier.glb', sha256: H('b'), byteLength: 4000,
        vertices: 642, triangles: 1280, connectedComponents: 1,
      },
      coordinateSystem: { handedness: 'right', upAxis: 'Z', unit: 'meter' },
      semanticDomains: [
        { id: 'short-coat', triangleCount: 900 },
        { id: 'ruff', triangleCount: 220 },
        { id: 'mystacial-pad-left', triangleCount: 40 },
        { id: 'mystacial-pad-right', triangleCount: 40 },
      ],
    },
    groom: {
      systems: [
        { id: 'short-coat-low-puff', representation: 'guide-field', displayColor: '#1fa0a1', guideIds: ['coat-low-0'] },
        { id: 'short-coat-high-puff', representation: 'guide-field', displayColor: '#ef6b1f', guideIds: ['coat-high-0'] },
        { id: 'ruff', representation: 'explicit-guides', displayColor: '#943dd1', guideIds: ['ruff-0'] },
        { id: 'mystacial-whiskers', representation: 'sparse-preset-curves', displayColor: '#f2dea0', guideIds: ['whisker-left-0', 'whisker-right-0'] },
      ],
      guides,
      whiskerPreset: {
        detectionTarget: 'whisker-presence',
        segmentationTarget: 'mystacial-pad',
        bilateral: true,
        countPerSide: 7,
        lengthToMuzzleWidth: 1.15,
        angularFanDegrees: 52,
        elevationDegrees: 8,
        sag: 0.12,
        taper: 0.82,
        stiffness: 0.91,
        sparseness: 0.78,
        confidence: 0.75,
      },
    },
    deformation: {
      method: 'carrier-bound-bend-v0',
      neutralFrame: 1,
      deformedFrame: 24,
      transportedGuideCount: guides.length,
    },
    products: [
      { kind: 'blend', path: 'procedural-groom-truth.blend', sha256: H('1'), byteLength: 1000 },
      { kind: 'glb', path: 'procedural-groom-truth.glb', sha256: H('2'), byteLength: 1000 },
      { kind: 'sparse-truth-render', path: 'sparse-truth.png', sha256: H('3'), byteLength: 1000 },
      { kind: 'neutral-dense-render', path: 'neutral-dense.png', sha256: H('4'), byteLength: 1000 },
      { kind: 'deformed-dense-render', path: 'deformed-dense.png', sha256: H('5'), byteLength: 1000 },
    ],
    claimCeiling: 'Procedural representation and carrier-bound deformation truth only.',
    visualAdmission: false,
    scientificAdmission: false,
    ...overrides,
  };
}

test('individual-whisker segmentation cannot masquerade as a valid preset source', () => {
  const candidate = manifest();
  candidate.groom.whiskerPreset.segmentationTarget = 'individual-whisker-strands';
  const report = evaluateProceduralGroomTruth(candidate);
  assert.equal(report.schema, PROCEDURAL_GROOM_TRUTH_REPORT_SCHEMA);
  assert.equal(report.state, 'invalid_semantic_contract');
  assert.match(report.failures.join('\n'), /mystacial-pad/);
  assert.equal(report.visualAdmission, false);
  assert.equal(report.scientificAdmission, false);
});

test('a complete procedural carrier and three groom regimes can reach visual review without self-admission', () => {
  const report = evaluateProceduralGroomTruth(manifest());
  assert.equal(report.state, 'representation_ready_for_visual_review');
  assert.deepEqual(report.failures, []);
  assert.equal(report.visualAdmission, false);
  assert.equal(report.scientificAdmission, false);
  assert.equal(report.lastTrustworthyEvidence, 'digest_bound_procedural_representation');
});

test('disconnected or degenerate carrier truth fails before groom interpretation', () => {
  const disconnected = manifest();
  disconnected.carrier.mesh.connectedComponents = 2;
  assert.equal(evaluateProceduralGroomTruth(disconnected).state, 'invalid_carrier');

  const empty = manifest();
  empty.carrier.mesh.triangles = 0;
  assert.equal(evaluateProceduralGroomTruth(empty).state, 'invalid_carrier');
});

test('roots require an in-range triangle and normalized finite barycentrics', () => {
  const badSum = manifest();
  badSum.groom.guides[0].root.barycentric = [0.2, 0.2, 0.2];
  assert.equal(evaluateProceduralGroomTruth(badSum).state, 'invalid_guide_geometry');

  const badTriangle = manifest();
  badTriangle.groom.guides[0].root.triangleIndex = 5000;
  assert.equal(evaluateProceduralGroomTruth(badTriangle).state, 'invalid_guide_geometry');
});

test('carrier transport requires explicit, nonidentical neutral and deformed root positions', () => {
  const missing = manifest();
  delete missing.groom.guides[0].root.deformedPosition;
  assert.equal(evaluateProceduralGroomTruth(missing).state, 'invalid_guide_geometry');

  const unmoved = manifest();
  unmoved.groom.guides[0].root.deformedPosition = [...unmoved.groom.guides[0].root.neutralPosition];
  assert.equal(evaluateProceduralGroomTruth(unmoved).state, 'invalid_guide_geometry');
});

test('low puff, high puff, ruff, and bilateral whiskers are all load-bearing', () => {
  for (const missingId of ['short-coat-low-puff', 'short-coat-high-puff', 'ruff', 'mystacial-whiskers']) {
    const candidate = manifest();
    candidate.groom.systems = candidate.groom.systems.filter(system => system.id !== missingId);
    const report = evaluateProceduralGroomTruth(candidate);
    assert.equal(report.state, 'incomplete_groom_systems');
    assert.match(report.failures.join('\n'), new RegExp(missingId));
  }

  const unilateral = manifest();
  unilateral.groom.whiskerPreset.bilateral = false;
  assert.equal(evaluateProceduralGroomTruth(unilateral).state, 'invalid_semantic_contract');
});

test('canonical guide families require distinct declared membership colors', () => {
  const duplicate = manifest();
  duplicate.groom.systems.find(system => system.id === 'ruff').displayColor = '#ef6b1f';
  const duplicateReport = evaluateProceduralGroomTruth(duplicate);
  assert.equal(duplicateReport.state, 'invalid_groom_presentation');
  assert.match(duplicateReport.failures.join('\n'), /distinct membership color/);

  const missing = manifest();
  delete missing.groom.systems[0].displayColor;
  assert.equal(evaluateProceduralGroomTruth(missing).state, 'invalid_groom_presentation');
});

test('blank, missing, or undigested products fail loud', () => {
  const blank = manifest();
  blank.products[2].byteLength = 0;
  assert.equal(evaluateProceduralGroomTruth(blank).state, 'invalid_products');

  const missing = manifest();
  missing.products = missing.products.slice(0, 4);
  assert.equal(evaluateProceduralGroomTruth(missing).state, 'invalid_products');

  const undigested = manifest();
  undigested.products[0].sha256 = null;
  assert.equal(evaluateProceduralGroomTruth(undigested).state, 'invalid_products');
});

test('a manifest cannot grant itself visual or scientific admission', () => {
  const candidate = manifest({ visualAdmission: true, scientificAdmission: true });
  const report = evaluateProceduralGroomTruth(candidate);
  assert.equal(report.state, 'invalid_admission_claim');
  assert.equal(report.visualAdmission, false);
  assert.equal(report.scientificAdmission, false);
});

test('file-backed preflight rejects digest drift and writes the failure report', async () => {
  const root = await mkdtemp(join(tmpdir(), 'groom-truth-'));
  try {
    const generatorBytes = Buffer.from('generator');
    await writeFile(join(root, 'generator.py'), generatorBytes);
    const candidate = manifest();
    candidate.source.generatorPath = 'generator.py';
    candidate.source.generatorSha256 = createHash('sha256').update(generatorBytes).digest('hex');
    for (const item of candidate.products) {
      const bytes = Buffer.from(`actual:${item.kind}`);
      await writeFile(join(root, item.path), bytes);
      item.byteLength = bytes.length;
      item.sha256 = createHash('sha256').update(bytes).digest('hex');
    }
    candidate.carrier.mesh.path = candidate.products.find(item => item.kind === 'glb').path;
    candidate.carrier.mesh.byteLength = candidate.products.find(item => item.kind === 'glb').byteLength;
    candidate.carrier.mesh.sha256 = candidate.products.find(item => item.kind === 'glb').sha256;

    candidate.products.find(item => item.kind === 'neutral-dense-render').sha256 = H('f');
    const reportPath = join(root, 'preflight.json');
    const report = await runProceduralGroomTruthPreflight({
      manifest: candidate,
      manifestDirectory: root,
      repoRoot: root,
      reportPath,
    });
    assert.equal(report.state, 'invalid_artifact_evidence');
    assert.match(report.failures.join('\n'), /neutral-dense-render.*digest mismatch/);
    assert.equal(JSON.parse(await readFile(reportPath, 'utf8')).state, 'invalid_artifact_evidence');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
