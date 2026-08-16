import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  PROCEDURAL_GROOM_TRUTH_REPORT_SCHEMA,
  PROCEDURAL_GROOM_TRUTH_SCHEMA,
  evaluateProceduralGroomTruth,
  runProceduralGroomTruthPreflight,
} from '../procedural-groom-truth-core.mjs';

const H = digit => digit.repeat(64);
const OBSERVATION_OBJECT_SCALE = 0.40197228574259536;
const OBSERVATION_OBJECT_POSITION = [0, 0.09772014617919922, -0.1836080551147461];
const toBlenderSource = point => {
  const source = point.map((component, axis) => (
    (component - OBSERVATION_OBJECT_POSITION[axis]) / OBSERVATION_OBJECT_SCALE
  ));
  return [source[0], -source[2], source[1]];
};

function glbJson(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF', 'fixture must be a binary glTF');
  const jsonLength = bytes.readUInt32LE(12);
  assert.equal(bytes.toString('ascii', 16, 20), 'JSON', 'first GLB chunk must be JSON');
  return JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength).trim());
}

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
    guide('coat-low-0', 'short-coat-low-puff', { length: 0.14, density: 28, lift: 0.08 }),
    guide('coat-high-0', 'short-coat-high-puff', { length: 0.40, density: 18, lift: 0.95 }),
    guide('ruff-0', 'ruff', { length: 0.78, density: 10, lift: 0.58 }),
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
    observation: {
      mesh: {
        path: 'procedural-groom-observation.glb', sha256: H('6'), byteLength: 1000,
        membershipColorsVisible: false,
      },
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
      { kind: 'neutral-observation-glb', path: 'procedural-groom-observation.glb', sha256: H('6'), byteLength: 1000 },
      { kind: 'sparse-truth-render', path: 'sparse-truth.png', sha256: H('3'), byteLength: 1000 },
      { kind: 'neutral-dense-render', path: 'neutral-dense.png', sha256: H('4'), byteLength: 1000 },
      { kind: 'deformed-dense-render', path: 'deformed-dense.png', sha256: H('5'), byteLength: 1000 },
      ...['front', 'left-three-quarter', 'right-three-quarter'].flatMap((viewId, viewIndex) => [
        'short-coat', 'puffy-coat', 'ruff', 'mystacial-pad-left', 'mystacial-pad-right',
      ].map((regionId, regionIndex) => {
        const cameraPosition = viewId === 'front'
          ? [0, 0.6, 3]
          : [viewId.startsWith('left') ? -2.1 : 2.1, 0.6, 2.1];
        return ({
        kind: 'projected-truth-mask',
        viewId,
        regionId,
        path: `truth-masks/${viewId}/${regionId}.png`,
        sha256: ((viewIndex * 5 + regionIndex + 1) % 10).toString().repeat(64),
        byteLength: 1000,
        cameraPosition,
        cameraTarget: [0, 0, 0],
        blenderCameraPosition: toBlenderSource(cameraPosition),
        blenderCameraTarget: toBlenderSource([0, 0, 0]),
        observationObjectScale: OBSERVATION_OBJECT_SCALE,
        observationObjectPosition: OBSERVATION_OBJECT_POSITION,
        resolution: [1088, 817],
      });})),
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

test('generated truth GLB encodes the declared membership colors in portable material state', async () => {
  const bytes = await readFile(new URL('../artifacts/procedural-groom-truth-v0/generated/procedural-groom-truth.glb', import.meta.url));
  const gltf = glbJson(bytes);
  const expected = new Map([
    ['ShortCoatLowPuff', '#1fa0a1'],
    ['ShortCoatHighPuff', '#ef6b1f'],
    ['Ruff', '#943dd1'],
    ['MystacialWhiskers', '#f2dea0'],
  ]);
  for (const [name, hex] of expected) {
    const encoded = gltf.materials.find(material => material.name === name)
      ?.pbrMetallicRoughness?.baseColorFactor;
    assert.ok(encoded, `${name} must encode a portable PBR base color`);
    const expectedRgb = [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
    expectedRgb.forEach((channel, index) => {
      assert.ok(Math.abs(encoded[index] - channel) < 0.015, `${name} base color channel ${index} drifted from ${hex}`);
    });
  }
  const encodedColors = new Set([...expected.keys()].map(name => JSON.stringify(
    gltf.materials.find(material => material.name === name).pbrMetallicRoughness.baseColorFactor.slice(0, 3),
  )));
  assert.equal(encodedColors.size, expected.size, 'membership materials must remain visibly distinct after GLB export');
});

test('blind observation geometry must be a distinct membership-neutral product', () => {
  const leaked = manifest();
  leaked.observation.mesh.membershipColorsVisible = true;
  assert.equal(evaluateProceduralGroomTruth(leaked).state, 'invalid_observation_product');

  const truthAlias = manifest();
  const truthGlbSha = truthAlias.products.find(product => product.kind === 'glb').sha256;
  truthAlias.observation.mesh.sha256 = truthGlbSha;
  truthAlias.products.find(product => product.kind === 'neutral-observation-glb').sha256 = truthGlbSha;
  assert.equal(evaluateProceduralGroomTruth(truthAlias).state, 'invalid_observation_product');
});

test('short, puffy, and ruff regimes cannot collapse back into adjacent parameter bands', () => {
  const collapsed = manifest();
  Object.assign(collapsed.groom.guides.find(guide => guide.systemId === 'short-coat-high-puff'), {
    length: 0.22,
    lift: 0.45,
  });
  Object.assign(collapsed.groom.guides.find(guide => guide.systemId === 'ruff'), {
    length: 0.34,
    density: 17,
  });

  const report = evaluateProceduralGroomTruth(collapsed);
  assert.equal(report.state, 'insufficient_regime_contrast');
  assert.match(report.failures.join('\n'), /puffy.*short|ruff.*puffy/i);
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

test('projected truth masks must cover every blind camera and comparison region exactly once', () => {
  const missing = manifest();
  missing.products = missing.products.filter(product => !(
    product.kind === 'projected-truth-mask'
      && product.viewId === 'front'
      && product.regionId === 'mystacial-pad-right'
  ));
  const missingReport = evaluateProceduralGroomTruth(missing);
  assert.equal(missingReport.state, 'invalid_products');
  assert.match(missingReport.failures.join('\n'), /missing projected truth mask front:mystacial-pad-right/);

  const duplicate = manifest();
  duplicate.products.push({ ...duplicate.products.find(product => product.kind === 'projected-truth-mask') });
  const duplicateReport = evaluateProceduralGroomTruth(duplicate);
  assert.equal(duplicateReport.state, 'invalid_products');
  assert.match(duplicateReport.failures.join('\n'), /duplicate projected truth mask/);

  const unconverted = manifest();
  const front = unconverted.products.find(product => product.kind === 'projected-truth-mask' && product.viewId === 'front');
  front.blenderCameraPosition = [...front.cameraPosition];
  const unconvertedReport = evaluateProceduralGroomTruth(unconverted);
  assert.equal(unconvertedReport.state, 'invalid_products');
  assert.match(unconvertedReport.failures.join('\n'), /undo the observation transform/);
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
      const productPath = join(root, item.path);
      await mkdir(dirname(productPath), { recursive: true });
      await writeFile(productPath, bytes);
      item.byteLength = bytes.length;
      item.sha256 = createHash('sha256').update(bytes).digest('hex');
    }
    candidate.carrier.mesh.path = candidate.products.find(item => item.kind === 'glb').path;
    candidate.carrier.mesh.byteLength = candidate.products.find(item => item.kind === 'glb').byteLength;
    candidate.carrier.mesh.sha256 = candidate.products.find(item => item.kind === 'glb').sha256;
    const observationProduct = candidate.products.find(item => item.kind === 'neutral-observation-glb');
    candidate.observation.mesh.path = observationProduct.path;
    candidate.observation.mesh.byteLength = observationProduct.byteLength;
    candidate.observation.mesh.sha256 = observationProduct.sha256;

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
