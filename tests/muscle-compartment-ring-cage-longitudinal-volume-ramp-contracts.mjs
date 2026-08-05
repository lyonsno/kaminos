import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createSyntheticFourMuscleCompartment } from '../muscle-compartment-packing-core.mjs';
import { createMuscleCompartmentRingCages } from '../muscle-compartment-ring-cage-core.mjs';
import { admitMuscleCompartmentRingCageDocument } from '../muscle-compartment-ring-cage-intake.mjs';
import * as contactCore from '../muscle-compartment-ring-cage-contact-core.mjs';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const SYNTHETIC_CONFIG = Object.freeze({
  ringVertexCount: 12,
  freedomMode: 'affine-section',
  volumeTolerance: 1e-9,
  sourceVolumeTolerance: 1e-12,
  frameSeedDirection: [0, 0, 1],
});
const SCHEMA =
  'kaminos.muscle-compartment-ring-cage-longitudinal-volume-ramp.v0';

function buildSyntheticCarrier() {
  const source = createSyntheticFourMuscleCompartment();
  const document = createMuscleCompartmentRingCages(source, SYNTHETIC_CONFIG);
  const admission = admitMuscleCompartmentRingCageDocument(document);
  assert.equal(admission.status, 'admitted');
  return { source, carrier: admission.solverCarrier };
}

function cageFor(carrier, constructionId) {
  const cage = carrier.cages.find(row => row.constructionId === constructionId);
  assert.ok(cage, `missing cage ${constructionId}`);
  return cage;
}

function sectionArea(cage, sectionId) {
  const axis = cage.manifest.nodes.find(node => node.id === `${sectionId}:axis`);
  const ring = cage.manifest.nodes
    .filter(node => node.id.startsWith(`${sectionId}:vertex:`))
    .sort((left, right) => left.id.localeCompare(right.id));
  assert.ok(axis && ring.length >= 3);
  const subtract = (left, right) => left.map((value, index) => value - right[index]);
  const cross = (left, right) => [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
  const doubled = ring.reduce((sum, node, index) => {
    const term = cross(
      subtract(node.currentPosition, axis.currentPosition),
      subtract(ring[(index + 1) % ring.length].currentPosition, axis.currentPosition),
    );
    return sum.map((value, coordinate) => value + term[coordinate]);
  }, [0, 0, 0]);
  return Math.hypot(...doubled) / 2;
}

test('a smooth longitudinal ramp applies explicit per-section compression without moving its carrier', () => {
  assert.equal(
    typeof contactCore.applyLongitudinalRingCageSectionVolumeRamp,
    'function',
    'the carrier must expose an explicit per-section longitudinal ramp',
  );
  const { carrier } = buildSyntheticCarrier();
  const sourceSnapshot = structuredClone(carrier);
  const constructionId = 'synthetic-construction-muscle-01';
  const sectionId = index => `${constructionId}:section:${String(index).padStart(4, '0')}`;
  const requested = {
    constructionId,
    compressionSections: [
      { sectionId: sectionId(2), areaScale: 0.92 },
      { sectionId: sectionId(3), areaScale: 0.84 },
      { sectionId: sectionId(4), areaScale: 0.92 },
    ],
    repaymentSectionIds: [sectionId(1)],
    maximumRepaymentAreaScale: 2,
    maximumAdjacentAreaScaleDelta: 0.6,
    volumeRelativeTolerance: 1e-10,
  };
  const beforeCage = cageFor(carrier, constructionId);
  const result = contactCore.applyLongitudinalRingCageSectionVolumeRamp(
    carrier,
    requested,
  );
  const afterCage = cageFor(result.outputCarrier, constructionId);

  assert.equal(result.schema, SCHEMA);
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.requested, requested);
  assert.equal(result.fallbackUsed, false);
  assert.deepEqual(carrier, sourceSnapshot);
  assert.equal(result.fixedNodeMaximumDrift, 0);
  assert.equal(result.centerlineMaximumDrift, 0);
  assert.equal(result.nonPositiveCellCount, 0);
  assert.ok(result.finalVolumeRelativeError <= requested.volumeRelativeTolerance);
  assert.ok(result.maximumAdjacentAreaScaleDelta <=
    requested.maximumAdjacentAreaScaleDelta + 1e-12);
  for (const row of requested.compressionSections) {
    assert.ok(Math.abs(
      sectionArea(afterCage, row.sectionId) / sectionArea(beforeCage, row.sectionId) -
        row.areaScale,
    ) <= 1e-12);
  }
  assert.deepEqual(
    contactCore.applyLongitudinalRingCageSectionVolumeRamp(carrier, requested),
    result,
  );
});

test('the first current-K4 ramp saturates but does not cross the fixed-attachment smoothness guard', async () => {
  assert.equal(
    typeof contactCore.applyLongitudinalRingCageSectionVolumeRamp,
    'function',
  );
  const [carrier, source] = await Promise.all([
    readFile(path.join(
      REPO_ROOT,
      'artifacts/current-k4-curvature-contact-volume-bound-assay-v0/packed-carrier.json',
    ), 'utf8').then(JSON.parse),
    readFile(path.join(
      REPO_ROOT,
      'artifacts/current-k4-fixed-contact-assay-v0/contact-admitted-source.json',
    ), 'utf8').then(JSON.parse),
  ]);
  const requested = {
    constructionId: 'muscle-45',
    compressionSections: [
      { sectionId: 'muscle-45:section:0010', areaScale: 0.94 },
      { sectionId: 'muscle-45:section:0011', areaScale: 0.90 },
    ],
    repaymentSectionIds: [
      'muscle-45:section:0006',
      'muscle-45:section:0007',
      'muscle-45:section:0008',
      'muscle-45:section:0009',
    ],
    maximumRepaymentAreaScale: 1.2,
    maximumAdjacentAreaScaleDelta: 0.1,
    volumeRelativeTolerance: 1e-10,
  };
  const before = contactCore.measureMuscleCompartmentRingCageContactState(carrier, source);
  const result = contactCore.applyLongitudinalRingCageSectionVolumeRamp(
    carrier,
    requested,
  );
  const after = contactCore.measureMuscleCompartmentRingCageContactState(
    result.outputCarrier,
    source,
  );

  assert.ok(Math.abs(result.maximumAdjacentAreaScaleDelta - 0.1) <= 1e-12);
  assert.equal(result.fixedNodeMaximumDrift, 0);
  assert.equal(result.centerlineMaximumDrift, 0);
  assert.equal(result.nonPositiveCellCount, 0);
  assert.ok(result.finalVolumeRelativeError <= requested.volumeRelativeTolerance);
  assert.ok(after.pairwise.movableMaximumPenetration <
    before.pairwise.movableMaximumPenetration);
  assert.ok(after.pairwise.movableTotalPenetration <
    before.pairwise.movableTotalPenetration);
  assert.equal(after.skeletal.totalPenetration, before.skeletal.totalPenetration);
  assert.equal(after.compartment.maximumEscape, 0);
  assert.ok(after.cages.every(row => row.nonPositiveCellCount === 0));
});

test('a smooth longitudinal ramp refuses duplicate, overlapping, fixed, and jagged requests', () => {
  assert.equal(
    typeof contactCore.applyLongitudinalRingCageSectionVolumeRamp,
    'function',
  );
  const { carrier } = buildSyntheticCarrier();
  const constructionId = 'synthetic-construction-muscle-01';
  const sectionId = index => `${constructionId}:section:${String(index).padStart(4, '0')}`;
  const base = {
    constructionId,
    compressionSections: [
      { sectionId: sectionId(2), areaScale: 0.9 },
      { sectionId: sectionId(3), areaScale: 0.8 },
    ],
    repaymentSectionIds: [sectionId(1), sectionId(4)],
    maximumRepaymentAreaScale: 2,
    maximumAdjacentAreaScaleDelta: 0.6,
    volumeRelativeTolerance: 1e-10,
  };
  assert.throws(
    () => contactCore.applyLongitudinalRingCageSectionVolumeRamp(carrier, {
      ...base,
      compressionSections: [
        ...base.compressionSections,
        { sectionId: sectionId(2), areaScale: 0.7 },
      ],
    }),
    /unique compression section ids/i,
  );
  assert.throws(
    () => contactCore.applyLongitudinalRingCageSectionVolumeRamp(carrier, {
      ...base,
      repaymentSectionIds: [sectionId(2)],
    }),
    /overlap/i,
  );
  assert.throws(
    () => contactCore.applyLongitudinalRingCageSectionVolumeRamp(carrier, {
      ...base,
      compressionSections: [{ sectionId: sectionId(0), areaScale: 0.9 }],
    }),
    /fixed section/i,
  );
  assert.throws(
    () => contactCore.applyLongitudinalRingCageSectionVolumeRamp(carrier, {
      ...base,
      maximumAdjacentAreaScaleDelta: 0.05,
    }),
    /maximumAdjacentAreaScaleDelta/i,
  );
});
