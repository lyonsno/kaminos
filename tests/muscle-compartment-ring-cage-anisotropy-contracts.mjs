import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import * as contactCore from '../muscle-compartment-ring-cage-contact-core.mjs';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const ANISOTROPY_SCHEMA =
  'kaminos.muscle-compartment-ring-cage-section-anisotropy.v0';

function subtract(left, right) {
  return left.map((value, axis) => value - right[axis]);
}

function dot(left, right) {
  return left.reduce((sum, value, axis) => sum + value * right[axis], 0);
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalize(vector) {
  const magnitude = Math.hypot(...vector);
  assert.ok(magnitude > 1e-12);
  return vector.map(value => value / magnitude);
}

function sectionGeometry(carrier, constructionId, sectionId) {
  const cage = carrier.cages.find(row => row.constructionId === constructionId);
  assert.ok(cage, `missing cage ${constructionId}`);
  const axis = cage.manifest.nodes.find(node => node.id === `${sectionId}:axis`);
  const ring = cage.manifest.nodes
    .filter(node => node.id.startsWith(`${sectionId}:vertex:`))
    .sort((left, right) => left.id.localeCompare(right.id));
  assert.ok(axis && ring.length >= 3, `invalid section ${sectionId}`);
  const areaVector = ring.reduce((sum, vertex, index) => {
    const left = subtract(vertex.currentPosition, axis.currentPosition);
    const right = subtract(
      ring[(index + 1) % ring.length].currentPosition,
      axis.currentPosition,
    );
    const term = cross(left, right);
    return sum.map((value, coordinate) => value + term[coordinate]);
  }, [0, 0, 0]);
  const normal = normalize(areaVector);
  const offsets = ring.map(node => subtract(node.currentPosition, axis.currentPosition));
  return {
    axis: axis.currentPosition,
    area: Math.hypot(...areaVector) / 2,
    normal,
    offsets,
  };
}

function projectedWidth(offsets, direction) {
  const values = offsets.map(offset => dot(offset, direction));
  return Math.max(...values) - Math.min(...values);
}

async function fixture() {
  return {
    carrier: JSON.parse(await readFile(path.join(
      REPO_ROOT,
      'artifacts/current-k4-ring-cage-admission-v0/solver-carrier.json',
    ), 'utf8')),
    source: JSON.parse(await readFile(path.join(
      REPO_ROOT,
      'artifacts/current-k4-fixed-contact-assay-v0/contact-admitted-source.json',
    ), 'utf8')),
  };
}

test('constant-area anisotropy compresses along pressure without moving the centerline', async () => {
  assert.equal(
    typeof contactCore.applyConstantAreaRingCageSectionAnisotropy,
    'function',
    'the contact carrier must expose a reversible constant-area anisotropy operator',
  );
  const { carrier, source } = await fixture();
  const constructionId = 'muscle-12';
  const sectionId = 'muscle-12:section:0006';
  const before = sectionGeometry(carrier, constructionId, sectionId);
  const pressureDirection = normalize(before.offsets[0]);
  const orthogonalDirection = normalize(cross(before.normal, pressureDirection));
  const requested = [{
    constructionId,
    sectionId,
    pressureDirection,
    compressionScale: 0.8,
  }];

  const result = contactCore.applyConstantAreaRingCageSectionAnisotropy(
    carrier,
    requested,
  );
  const after = sectionGeometry(result.outputCarrier, constructionId, sectionId);

  assert.equal(result.schema, ANISOTROPY_SCHEMA);
  assert.equal(result.status, 'completed');
  assert.equal(result.sourceCarrierSha256, carrier.identity.sha256);
  assert.equal(result.outputCarrierSha256, result.outputCarrier.identity.sha256);
  assert.deepEqual(result.requested, requested);
  assert.deepEqual(result.effective, requested);
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.centerlineMaximumDrift, 0);
  assert.equal(result.fixedNodeMaximumDrift, 0);
  assert.equal(result.sectionReceipts.length, 1);
  assert.equal(result.sectionReceipts[0].sectionId, sectionId);
  assert.ok(result.sectionReceipts[0].relativeAreaError <= 1e-12);
  assert.ok(Math.abs(after.area / before.area - 1) <= 1e-12);
  assert.ok(Math.abs(
    projectedWidth(after.offsets, pressureDirection) /
      projectedWidth(before.offsets, pressureDirection) - 0.8,
  ) <= 1e-12);
  assert.ok(Math.abs(
    projectedWidth(after.offsets, orthogonalDirection) /
      projectedWidth(before.offsets, orthogonalDirection) - 1.25,
  ) <= 1e-12);
  assert.deepEqual(
    result.outputCarrier.cages.flatMap(cage => cage.manifest.nodes)
      .filter(node => node.id.endsWith(':axis'))
      .map(node => [node.id, node.currentPosition]),
    carrier.cages.flatMap(cage => cage.manifest.nodes)
      .filter(node => node.id.endsWith(':axis'))
      .map(node => [node.id, node.currentPosition]),
  );
  assert.notDeepEqual(result.outputCarrier, carrier);
  assert.deepEqual(
    contactCore.applyConstantAreaRingCageSectionAnisotropy(carrier, requested),
    result,
    'the reversible assay carrier must be deterministic',
  );

  const measurement = contactCore.measureMuscleCompartmentRingCageContactState(
    result.outputCarrier,
    source,
  );
  assert.equal(measurement.cages.reduce(
    (sum, cage) => sum + cage.nonPositiveCellCount,
    0,
  ), 0);
  assert.ok(Math.max(...measurement.cages.map(cage => cage.relativeVolumeError)) < 0.015);
  assert.equal(measurement.compartment.maximumEscape, 0);
});

test('constant-area anisotropy rejects fixed sections and malformed requests', async () => {
  assert.equal(typeof contactCore.applyConstantAreaRingCageSectionAnisotropy, 'function');
  const { carrier } = await fixture();
  assert.throws(
    () => contactCore.applyConstantAreaRingCageSectionAnisotropy(carrier, [{
      constructionId: 'muscle-34',
      sectionId: 'muscle-34:section:0000',
      pressureDirection: [1, 0, 0],
      compressionScale: 0.8,
    }]),
    /fixed section/i,
  );
  assert.throws(
    () => contactCore.applyConstantAreaRingCageSectionAnisotropy(carrier, [{
      constructionId: 'muscle-12',
      sectionId: 'muscle-12:section:0006',
      pressureDirection: [1, 0, 0],
      compressionScale: 1.1,
    }]),
    /compressionScale/i,
  );
});

test('current-K4 pressure ledger deterministically selects the movable M12-to-M45 sections', async () => {
  assert.equal(
    typeof contactCore.derivePressureAlignedRingCageSectionAnisotropy,
    'function',
    'the residual ledger must drive the affine carrier without hand-authored section axes',
  );
  const carrier = JSON.parse(await readFile(path.join(
    REPO_ROOT,
    'artifacts/current-k4-curvature-contact-volume-bound-assay-v0/packed-carrier.json',
  ), 'utf8'));
  const ledger = JSON.parse(await readFile(path.join(
    REPO_ROOT,
    'artifacts/current-k4-curvature-contact-volume-bound-assay-v0/residual-ledger.json',
  ), 'utf8'));
  const config = {
    subjectConstructionId: 'muscle-12',
    obstacleConstructionId: 'muscle-45',
    compressionScale: 0.96,
  };

  const selection = contactCore.derivePressureAlignedRingCageSectionAnisotropy(
    carrier,
    ledger,
    config,
  );
  assert.equal(selection.schema,
    'kaminos.muscle-compartment-ring-cage-pressure-anisotropy-selection.v0');
  assert.equal(selection.status, 'completed');
  assert.equal(selection.sourceCarrierSha256, carrier.identity.sha256);
  assert.deepEqual(selection.requested, config);
  assert.deepEqual(selection.effective, config);
  assert.equal(selection.fallbackUsed, false);
  assert.equal(selection.contactCount, 115);
  assert.equal(selection.totalPenetration, 8.798372900109104);
  assert.deepEqual(
    selection.adjustments.map(row => row.sectionId),
    Array.from({ length: 11 }, (_, index) =>
      `muscle-12:section:${String(index + 1).padStart(4, '0')}`),
  );
  assert.ok(selection.adjustments.every(row =>
    row.constructionId === 'muscle-12' &&
    row.compressionScale === 0.96 &&
    Math.abs(Math.hypot(...row.pressureDirection) - 1) <= 1e-12));
  assert.deepEqual(
    contactCore.derivePressureAlignedRingCageSectionAnisotropy(
      carrier,
      ledger,
      config,
    ),
    selection,
  );

  const mismatched = structuredClone(ledger);
  mismatched.sourceCarrierSha256 = '0'.repeat(64);
  assert.throws(
    () => contactCore.derivePressureAlignedRingCageSectionAnisotropy(
      carrier,
      mismatched,
      config,
    ),
    /source carrier identity mismatch/i,
  );
});
