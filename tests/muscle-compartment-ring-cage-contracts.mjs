import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  createSyntheticFourMuscleCompartment,
  hashMusclePackingCanonicalJson,
} from '../muscle-compartment-packing-core.mjs';
import {
  MUSCLE_COMPARTMENT_RING_CAGE_SCHEMA,
  createMuscleCompartmentRingCages,
  encodeMuscleCompartmentRingCageCanonicalBytes,
  encodeMuscleCompartmentRingCageIdentityDomain,
  ellipseRadiusAtAngle,
  hashMuscleCompartmentRingCageCanonicalJson,
  measureMuscleCompartmentRingCageCurrentGeometry,
  restrictRingCageSectionToEllipse,
  verifyMuscleCompartmentRingCageIdentity,
} from '../muscle-compartment-ring-cage-core.mjs';

const CONFIG = Object.freeze({
  ringVertexCount: 12,
  freedomMode: 'affine-section',
  volumeTolerance: 1e-9,
  sourceVolumeTolerance: 1e-12,
  frameSeedDirection: [0, 0, 1],
});

function carrierVolume(centerline) {
  let volume = 0;
  for (let index = 0; index < centerline.length - 1; index += 1) {
    const start = centerline[index];
    const end = centerline[index + 1];
    const segmentLength = Math.hypot(...start.position.map(
      (value, axis) => end.position[axis] - value,
    ));
    volume += Math.PI * segmentLength / 3 * (
      start.radius ** 2 + start.radius * end.radius + end.radius ** 2
    );
  }
  return volume;
}

function identityDigest(value) {
  const bytes = encodeMuscleCompartmentRingCageIdentityDomain(value);
  return {
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function objectKeysDeep(value, keys = []) {
  if (Array.isArray(value)) {
    for (const item of value) objectKeysDeep(item, keys);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      keys.push(key);
      objectKeysDeep(item, keys);
    }
  }
  return keys;
}

function build(source = createSyntheticFourMuscleCompartment(), config = CONFIG) {
  return createMuscleCompartmentRingCages(source, config);
}

function curvedTaperedParitySource() {
  const profiles = [
    {
      angles: [-0.25, -0.05, 0.35, 0.55, 0.3, 0.05],
      radial: [0.62, 0.48, 0.38, 0.4, 0.5, 0.59],
      y: [-0.9, -0.58, -0.2, 0.2, 0.58, 0.9],
      radii: [0.14, 0.21, 0.24, 0.24, 0.2, 0.14],
    },
    {
      angles: [2.85, 3.05, 3.4, 3.62, 3.36, 3.1],
      radial: [0.54, 0.41, 0.28, 0.32, 0.43, 0.57],
      y: [-0.9, -0.55, -0.17, 0.23, 0.6, 0.9],
      radii: [0.14, 0.23, 0.255, 0.255, 0.22, 0.14],
    },
    {
      angles: [1.25, 1.45, 1.8, 2.05, 1.82, 1.58],
      radial: [0.6, 0.45, 0.34, 0.36, 0.46, 0.56],
      y: [-0.9, -0.6, -0.22, 0.18, 0.56, 0.9],
      radii: [0.14, 0.21, 0.235, 0.235, 0.21, 0.14],
    },
    {
      angles: [4.35, 4.55, 4.9, 5.15, 4.9, 4.68],
      radial: [0.55, 0.4, 0.3, 0.34, 0.44, 0.6],
      y: [-0.9, -0.57, -0.15, 0.25, 0.61, 0.9],
      radii: [0.14, 0.22, 0.25, 0.25, 0.225, 0.14],
    },
  ];
  const source = createSyntheticFourMuscleCompartment();
  source.id = 'synthetic-four-muscle-curved-tapered-parity-v0';
  for (const [index, muscle] of source.muscles.entries()) {
    const profile = profiles[index];
    muscle.centerline = profile.angles.map((angle, knotIndex) => ({
      position: [
        Math.cos(angle) * profile.radial[knotIndex],
        profile.y[knotIndex],
        Math.sin(angle) * profile.radial[knotIndex],
      ],
      radius: profile.radii[knotIndex],
    }));
    muscle.attachments.origin.position = [...muscle.centerline[0].position];
    muscle.attachments.insertion.position = [...muscle.centerline.at(-1).position];
    muscle.targetVolume = carrierVolume(muscle.centerline);
  }
  const { input: _priorInput, ...identityCore } = source;
  const sha256 = hashMusclePackingCanonicalJson(identityCore);
  source.input.requested.id = source.id;
  source.input.effective.id = source.id;
  source.input.requested.sha256 = sha256;
  source.input.effective.sha256 = sha256;
  return source;
}

function referenceGeometry(cage) {
  return cage.sections.map(section => ({
    id: section.id,
    center: section.referenceCenter,
    vertices: section.vertices.map(vertex => ({
      id: vertex.id,
      position: vertex.referencePosition,
    })),
  }));
}

test('ordered source constructions replay to one byte-identical positive-volume cage document', () => {
  const source = createSyntheticFourMuscleCompartment();
  const first = build(source);
  const replay = build(structuredClone(source));
  const firstBytes = encodeMuscleCompartmentRingCageCanonicalBytes(first);
  const replayBytes = encodeMuscleCompartmentRingCageCanonicalBytes(replay);

  assert.equal(first.schema, MUSCLE_COMPARTMENT_RING_CAGE_SCHEMA);
  assert.deepEqual(first.config.requested, CONFIG);
  assert.deepEqual(first.config.effective, CONFIG, 'the cage builder must not fall back');
  assert.deepEqual(replay, first);
  assert.deepEqual(replayBytes, firstBytes);
  assert.equal(Buffer.compare(firstBytes, replayBytes), 0);
  assert.match(first.identity.sha256, /^[0-9a-f]{64}$/);
  const documentIdentity = identityDigest(first);
  assert.equal(first.identity.sha256, documentIdentity.sha256);
  assert.equal(first.identity.canonicalByteLength, documentIdentity.bytes.byteLength);
  assert.deepEqual(verifyMuscleCompartmentRingCageIdentity(first), {
    verified: true,
    domain: 'self-excluding-top-level-identity',
    sha256: documentIdentity.sha256,
    canonicalByteLength: documentIdentity.bytes.byteLength,
  });
  assert.deepEqual(
    first.cages.map(cage => cage.constructionId),
    source.muscles.map(muscle => muscle.identity.constructionId),
    'source order is representation order',
  );

  for (const [cageIndex, cage] of first.cages.entries()) {
    const sourceMuscle = source.muscles[cageIndex];
    assert.equal(cage.id, `${sourceMuscle.identity.constructionId}:cage`);
    assert.match(cage.identity.sha256, /^[0-9a-f]{64}$/);
    assert.match(cage.identity.referenceGeometrySha256, /^[0-9a-f]{64}$/);
    const cageIdentity = identityDigest(cage);
    assert.equal(cage.identity.sha256, cageIdentity.sha256);
    assert.equal(cage.identity.canonicalByteLength, cageIdentity.bytes.byteLength);
    assert.equal(verifyMuscleCompartmentRingCageIdentity(cage).verified, true);
    assert.deepEqual(
      cage.sections.map(section => section.id),
      sourceMuscle.centerline.map((_, sectionIndex) =>
        `${sourceMuscle.identity.constructionId}:section:${String(sectionIndex).padStart(4, '0')}`),
    );
    assert.ok(cage.sections.every(section => section.vertices.length === CONFIG.ringVertexCount));
    assert.deepEqual(
      cage.sections.flatMap(section => section.vertices.map(vertex => vertex.id)),
      cage.sections.flatMap(section => section.vertices.map((_, vertexIndex) =>
        `${section.id}:vertex:${String(vertexIndex).padStart(2, '0')}`)),
    );
    assert.deepEqual(
      cage.cells.map(cell => cell.id),
      [...cage.cells].map(cell => cell.id).sort(),
      'cell ids stay in their canonical segment/sector/tetrahedron order',
    );

    assert.deepEqual(
      cage.attachmentBoundaries.map(boundary => boundary.attachmentId),
      [sourceMuscle.attachments.origin.id, sourceMuscle.attachments.insertion.id],
    );
    for (const boundary of cage.attachmentBoundaries) {
      assert.equal(boundary.fixed, true);
      const section = cage.sections.find(candidate => candidate.id === boundary.sectionId);
      assert.ok(section);
      assert.equal(section.boundary.kind, 'attachment');
      assert.equal(section.boundary.fixed, true);
      assert.deepEqual(boundary.vertexIds, section.vertices.map(vertex => vertex.id));
      assert.deepEqual(section.currentCenter, section.referenceCenter);
      assert.ok(section.vertices.every(vertex =>
        vertex.fixed &&
        JSON.stringify(vertex.currentPosition) === JSON.stringify(vertex.referencePosition)));
    }

    assert.equal(cage.cells.length, (cage.sections.length - 1) * CONFIG.ringVertexCount * 3);
    assert.ok(cage.cells.every(cell =>
      cell.vertexIds.length === 4 &&
      Number.isFinite(cell.metrics.referenceRawSignedVolume) &&
      cell.metrics.referenceRawSignedVolume > 0 &&
      cell.metrics.referenceOrientationParity === 1 &&
      Number.isFinite(cell.metrics.referenceOrientedVolume) &&
      cell.metrics.referenceOrientedVolume > 0));
    assert.equal(cage.metrics.nonFiniteCellCount, 0);
    assert.equal(cage.metrics.nonPositiveReferenceCellCount, 0);
    assert.equal(cage.metrics.nonPositiveCurrentCellCountAtInitialization, 0);
    assert.equal(cage.topology.closed, true);
    assert.equal(cage.topology.watertight, true);
    assert.equal(cage.topology.openBoundaryEdgeCount, 0);
    assert.equal(cage.topology.orientationMismatchEdgeCount, 0);
    assert.ok(cage.topology.triangles.length > 0);
    assert.ok(cage.topology.referenceSignedVolume > 0);
    assert.equal(cage.topology.referenceUnsignedVolume, cage.topology.referenceSignedVolume);
    assert.ok(
      Math.abs(cage.topology.referenceSignedVolume - cage.volumeAccounting.referenceVolume) /
        cage.volumeAccounting.referenceVolume <= 1e-12,
      'closed surface and positive tetrahedral volume accounting must agree',
    );
    assert.equal(cage.volumeAccounting.sourceTargetVolume, sourceMuscle.targetVolume);
    assert.ok(cage.volumeAccounting.referenceVolume > 0);
    assert.ok(cage.volumeAccounting.currentVolumeAtInitialization > 0);
    assert.ok(
      cage.volumeAccounting.referenceRelativeError <= CONFIG.volumeTolerance,
      JSON.stringify(cage.volumeAccounting),
    );
    assert.ok(
      cage.volumeAccounting.currentRelativeErrorAtInitialization <= CONFIG.volumeTolerance,
      JSON.stringify(cage.volumeAccounting),
    );
    assert.equal(cage.sourceEmbedding.sectionEmbeddings.length, sourceMuscle.centerline.length);
    assert.equal(
      cage.sourceEmbedding.vertexEmbeddings.length,
      sourceMuscle.centerline.length * CONFIG.ringVertexCount,
    );
    assert.ok(
      Math.abs(
        cage.volumeAccounting.sourceContinuousCarrierVolume - sourceMuscle.targetVolume,
      ) / sourceMuscle.targetVolume <= CONFIG.sourceVolumeTolerance,
    );
    assert.ok(cage.volumeAccounting.polygonUncorrectedVolume > 0);
    assert.ok(cage.volumeAccounting.polygonDiscretizationRadialScale > 0);
    assert.equal(
      cage.sourceEmbedding.radiusPolicy,
      'regular-polygon-discretization-correction-after-source-volume-validation',
    );

    const generic = cage.genericManifest;
    assert.equal(
      generic.semanticHashes.sourceGeometrySha256,
      hashMuscleCompartmentRingCageCanonicalJson(generic.sourceGeometry),
      'source geometry identity is independently recomputable',
    );
    assert.ok(Array.isArray(generic.nodes) && generic.nodes.length > 0);
    assert.ok(Array.isArray(generic.cells) && generic.cells.length === cage.cells.length);
    assert.ok(Array.isArray(generic.constraints.boundaryMasks));
    assert.ok(Array.isArray(generic.embedding.entries));
    assert.ok(generic.nodes.every(node =>
      Object.hasOwn(node, 'materialRegionId') &&
      Object.hasOwn(node, 'attachmentFrameId') &&
      Object.hasOwn(node, 'forceApplicationHandle')));
    assert.ok(generic.cells.every(cell =>
      Object.hasOwn(cell, 'materialRegionId') &&
      Object.hasOwn(cell, 'attachmentFrameId') &&
      Object.hasOwn(cell, 'forceApplicationHandle') &&
      cell.restRawSignedVolume > 0));
    assert.ok(generic.embedding.entries.every(entry =>
      entry.nodeIds.length === entry.weights.length &&
      Math.abs(entry.weights.reduce((sum, weight) => sum + weight, 0) - 1) <= 1e-12 &&
      entry.sourcePointId !== entry.nodeIds[0] &&
      entry.sourceGeometrySha256 === generic.semanticHashes.sourceGeometrySha256 &&
      Array.isArray(entry.sourcePosition) && entry.sourcePosition.length === 3 &&
      entry.authoredSurfaceCorrespondence === false));
    assert.doesNotMatch(
      objectKeysDeep(generic).join('\n'),
      /ring|section|muscle|contact|compartment/i,
      'generic projection property names must not leak fixture indexing',
    );
    assert.equal(
      generic.semanticHashes.topologySha256,
      hashMuscleCompartmentRingCageCanonicalJson(generic.topology),
      'topology semantic hash is independently recomputable',
    );
    assert.equal(
      generic.semanticHashes.constraintsSha256,
      hashMuscleCompartmentRingCageCanonicalJson(generic.constraints),
    );
    assert.equal(
      generic.semanticHashes.embeddingSha256,
      hashMuscleCompartmentRingCageCanonicalJson(generic.embedding),
    );
  }

  const tampered = structuredClone(first);
  tampered.identity.sha256 = '0'.repeat(64);
  assert.throws(
    () => verifyMuscleCompartmentRingCageIdentity(tampered),
    /identity sha256 mismatch/i,
  );
});

test('ellipse is an affine-section restriction of the same ordered cage representation', () => {
  const cage = build().cages[0];
  const section = cage.sections[1];
  const radii = [1.6, 0.7];
  const restriction = restrictRingCageSectionToEllipse(section, radii);

  assert.equal(cage.freedom.representation, 'ordered-polygonal-ring-cage');
  assert.equal(cage.freedom.sectionRestriction.kind, 'affine-map-on-shared-ring-vertices');
  assert.equal(cage.freedom.sectionRestriction.ellipseRadiusFunction, 'ellipseRadiusAtAngle');
  assert.equal(restriction.kind, 'ellipse-as-section-affine-restriction');
  assert.deepEqual(restriction.requested, restriction.effective);
  assert.equal(restriction.fallbackUsed, false);
  assert.deepEqual(restriction.vertexIds, section.vertices.map(vertex => vertex.id));
  for (const [vertexIndex, vertex] of section.vertices.entries()) {
    const { angleRadians } = vertex.sourceEmbedding;
    const restricted = restriction.vertices[vertexIndex];
    const offset = restricted.currentPosition.map(
      (value, axis) => value - section.referenceCenter[axis],
    );
    const localNormal = offset.reduce(
      (sum, value, axis) => sum + value * section.frame.normal[axis],
      0,
    );
    const localBinormal = offset.reduce(
      (sum, value, axis) => sum + value * section.frame.binormal[axis],
      0,
    );
    const worldPolarAngle = Math.atan2(localBinormal, localNormal);
    const observedRadius = Math.hypot(localNormal, localBinormal);
    const expectedRadius = section.effectiveReferenceRadius *
      ellipseRadiusAtAngle(radii, worldPolarAngle);
    assert.ok(Math.abs(observedRadius - expectedRadius) <= 1e-12);
    assert.ok(
      Math.abs(
        (localNormal / (section.effectiveReferenceRadius * radii[0])) ** 2 +
        (localBinormal / (section.effectiveReferenceRadius * radii[1])) ** 2 - 1,
      ) <= 1e-12,
      'restricted vertices lie on the declared section ellipse',
    );
    assert.equal(vertex.sourceEmbedding.sectionId, section.id);
    assert.equal(vertex.sourceEmbedding.representationVertexId, vertex.id);
    assert.equal(restricted.id, vertex.id);
  }
  assert.deepEqual(
    cage.topology.ringVertexIds[section.index],
    section.vertices.map(vertex => vertex.id),
    'affine/ellipse freedom references the existing ring instead of creating alternate geometry',
  );
});

test('one changed construction changes only its own cage and hash without reordering peers', () => {
  const source = createSyntheticFourMuscleCompartment();
  const baseline = build(source);
  const changedSource = structuredClone(source);
  changedSource.muscles[2].centerline[1].position[0] += 0.03125;
  changedSource.muscles[2].targetVolume = carrierVolume(changedSource.muscles[2].centerline);
  const changed = build(changedSource);

  assert.deepEqual(
    changed.cages.map(cage => cage.constructionId),
    baseline.cages.map(cage => cage.constructionId),
  );
  assert.notEqual(changed.identity.sha256, baseline.identity.sha256);
  for (let index = 0; index < baseline.cages.length; index += 1) {
    if (index === 2) {
      assert.notDeepEqual(changed.cages[index], baseline.cages[index]);
      assert.notEqual(changed.cages[index].identity.sha256, baseline.cages[index].identity.sha256);
      assert.notEqual(
        changed.cages[index].genericManifest.semanticHashes.sourceGeometrySha256,
        baseline.cages[index].genericManifest.semanticHashes.sourceGeometrySha256,
        'source geometry identity changes with source carrier geometry',
      );
      assert.notEqual(
        changed.cages[index].genericManifest.semanticHashes.embeddingSha256,
        baseline.cages[index].genericManifest.semanticHashes.embeddingSha256,
        'embedding identity remains bound to changed source carrier geometry',
      );
    } else {
      assert.deepEqual(changed.cages[index], baseline.cages[index]);
      assert.equal(changed.cages[index].identity.sha256, baseline.cages[index].identity.sha256);
    }
  }
});

test('source target authority cannot rescale inconsistent centerline radii', () => {
  const inconsistent = createSyntheticFourMuscleCompartment();
  inconsistent.muscles[0].targetVolume *= 4;
  assert.throws(
    () => build(inconsistent),
    /source carrier volume.*targetVolume.*sourceVolumeTolerance/i,
  );
  assert.throws(
    () => build(createSyntheticFourMuscleCompartment(), {
      ...CONFIG,
      sourceVolumeTolerance: 0,
    }),
    /sourceVolumeTolerance.*positive.*finite/i,
  );
});

test('curved tapered cages use one boundary diagonal for closed-surface and cell volume parity', () => {
  const document = build(curvedTaperedParitySource());
  for (const cage of document.cages) {
    const surfaceVolume = cage.topology.referenceSignedVolume;
    const cellVolume = cage.volumeAccounting.referenceVolume;
    assert.ok(
      Math.abs(surfaceVolume - cellVolume) / cellVolume <= 1e-12,
      `${cage.constructionId} surface/cell relative disagreement ` +
        `${Math.abs(surfaceVolume - cellVolume) / cellVolume}`,
    );
  }
});

test('current geometry is recomputed from currentPosition and inversion fails loud', () => {
  const cage = build().cages[0];
  const initial = measureMuscleCompartmentRingCageCurrentGeometry(cage);
  assert.equal(initial.nonPositiveCellCount, 0);
  assert.equal(initial.orientationMismatchEdgeCount, 0);
  assert.ok(initial.signedSurfaceVolume > 0);
  assert.ok(initial.unsignedSurfaceVolume > 0);
  assert.ok(Math.abs(initial.cellVolume - cage.volumeAccounting.referenceVolume) <= 1e-12);

  const contracted = structuredClone(cage);
  for (const section of contracted.sections) {
    for (const vertex of section.vertices) {
      vertex.currentPosition = vertex.currentPosition.map(
        (value, axis) => section.currentCenter[axis] +
          0.9 * (value - section.currentCenter[axis]),
      );
    }
  }
  const contractedMetrics = measureMuscleCompartmentRingCageCurrentGeometry(contracted);
  assert.ok(contractedMetrics.cellVolume < initial.cellVolume);
  assert.ok(contractedMetrics.unsignedSurfaceVolume < initial.unsignedSurfaceVolume);

  const inverted = structuredClone(cage);
  const firstCell = inverted.cells[0];
  const vertices = new Map([
    ...inverted.axisVertices.map(vertex => [vertex.id, vertex]),
    ...inverted.sections.flatMap(section => section.vertices.map(vertex => [vertex.id, vertex])),
  ]);
  const left = vertices.get(firstCell.vertexIds[1]);
  const right = vertices.get(firstCell.vertexIds[2]);
  [left.currentPosition, right.currentPosition] = [right.currentPosition, left.currentPosition];
  assert.throws(
    () => measureMuscleCompartmentRingCageCurrentGeometry(inverted),
    /current cell.*inverted|nonpositive current orientation/i,
  );
});

test('freedom mode changes configuration identity but not the shared reference geometry', () => {
  const source = createSyntheticFourMuscleCompartment();
  const affine = build(source, { ...CONFIG, freedomMode: 'affine-section' });
  const free = build(source, { ...CONFIG, freedomMode: 'free-ring' });

  assert.notEqual(affine.identity.sha256, free.identity.sha256);
  assert.deepEqual(affine.config.requested, affine.config.effective);
  assert.deepEqual(free.config.requested, free.config.effective);
  for (const [index, affineCage] of affine.cages.entries()) {
    const freeCage = free.cages[index];
    assert.notEqual(affineCage.identity.sha256, freeCage.identity.sha256);
    assert.equal(
      affineCage.identity.referenceGeometrySha256,
      freeCage.identity.referenceGeometrySha256,
    );
    assert.deepEqual(referenceGeometry(affineCage), referenceGeometry(freeCage));
    assert.equal(affineCage.freedom.representation, 'ordered-polygonal-ring-cage');
    assert.equal(freeCage.freedom.representation, 'ordered-polygonal-ring-cage');
    assert.equal(affineCage.freedom.effectiveMode, 'affine-section');
    assert.equal(freeCage.freedom.effectiveMode, 'free-ring');
  }
});

test('invalid resolution, freedom, tolerance, and source state fail loud', () => {
  const source = createSyntheticFourMuscleCompartment();
  for (const ringVertexCount of [8, 16]) {
    const supported = build(source, { ...CONFIG, ringVertexCount });
    assert.ok(supported.cages.every(cage =>
      cage.sections.every(section => section.vertices.length === ringVertexCount)));
    assert.ok(supported.cages.every(cage => cage.topology.watertight));
  }
  for (const ringVertexCount of [7, 17, 8.5, undefined]) {
    assert.throws(
      () => build(source, { ...CONFIG, ringVertexCount }),
      /ringVertexCount.*integer.*8.*16/i,
    );
  }
  assert.throws(
    () => build(source, { ...CONFIG, freedomMode: 'ellipse-only' }),
    /freedomMode.*affine-section.*free-ring/i,
  );
  assert.throws(
    () => build(source, { ...CONFIG, volumeTolerance: 0 }),
    /volumeTolerance.*positive.*finite/i,
  );
  const firstTangent = source.muscles[0].centerline[1].position.map(
    (value, axis) => value - source.muscles[0].centerline[0].position[axis],
  );
  assert.throws(
    () => build(source, { ...CONFIG, frameSeedDirection: firstTangent }),
    /frameSeedDirection.*parallel.*initial tangent/i,
  );

  const nonFinite = structuredClone(source);
  nonFinite.muscles[0].centerline[1].position[2] = Number.NaN;
  assert.throws(() => build(nonFinite), /finite.*3D point/i);

  const nonPositiveRadius = structuredClone(source);
  nonPositiveRadius.muscles[0].centerline[1].radius = 0;
  assert.throws(() => build(nonPositiveRadius), /radius.*positive/i);

  const detached = structuredClone(source);
  detached.muscles[0].attachments.origin.position[0] += 0.1;
  assert.throws(() => build(detached), /attachment.*centerline endpoint/i);

  const duplicate = structuredClone(source);
  duplicate.muscles[1].identity.constructionId = duplicate.muscles[0].identity.constructionId;
  assert.throws(() => build(duplicate), /constructionId.*unique|duplicate construction/i);

  const noTarget = structuredClone(source);
  noTarget.muscles[0].targetVolume = Number.NaN;
  assert.throws(() => build(noTarget), /targetVolume.*positive.*finite/i);
});
