import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createSyntheticFourMuscleCompartment } from '../muscle-compartment-packing-core.mjs';
import {
  createMuscleCompartmentRingCages,
} from '../muscle-compartment-ring-cage-core.mjs';
import {
  admitMuscleCompartmentRingCageDocument,
} from '../muscle-compartment-ring-cage-intake.mjs';
import * as contactCore from '../muscle-compartment-ring-cage-contact-core.mjs';

const CONFIG = Object.freeze({
  ringVertexCount: 12,
  freedomMode: 'affine-section',
  volumeTolerance: 1e-9,
  sourceVolumeTolerance: 1e-12,
  frameSeedDirection: [0, 0, 1],
});
const SCHEMA =
  'kaminos.muscle-compartment-ring-cage-longitudinal-volume-redistribution.v0';
const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);

function buildFixture() {
  const source = createSyntheticFourMuscleCompartment();
  const document = createMuscleCompartmentRingCages(source, CONFIG);
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

test('longitudinal redistribution moves crowded-middle volume into low-pressure shoulders', () => {
  assert.equal(
    typeof contactCore.applyLongitudinalRingCageSectionVolumeRedistribution,
    'function',
    'the ring-cage carrier must expose longitudinal total-volume accommodation',
  );
  const { source, carrier } = buildFixture();
  const sourceCarrierSnapshot = structuredClone(carrier);
  const constructionId = 'synthetic-construction-muscle-01';
  const sectionId = index => `${constructionId}:section:${String(index).padStart(4, '0')}`;
  const requested = {
    constructionId,
    compressionAreaScale: 0.85,
    compressionSectionIds: [sectionId(2), sectionId(3)],
    repaymentSectionIds: [sectionId(1), sectionId(4)],
    maximumRepaymentAreaScale: 1.5,
    maximumAdjacentAreaScaleDelta: 0.4,
    volumeRelativeTolerance: 1e-10,
  };
  const beforeMeasurement =
    contactCore.measureMuscleCompartmentRingCageContactState(carrier, source);
  const beforeCage = cageFor(carrier, constructionId);
  const beforeVolume = beforeMeasurement.cages.find(
    row => row.constructionId === constructionId,
  ).currentVolume;

  const result = contactCore.applyLongitudinalRingCageSectionVolumeRedistribution(
    carrier,
    requested,
  );
  const afterCage = cageFor(result.outputCarrier, constructionId);
  const afterMeasurement = contactCore.measureMuscleCompartmentRingCageContactState(
    result.outputCarrier,
    source,
  );
  const afterRow = afterMeasurement.cages.find(
    row => row.constructionId === constructionId,
  );

  assert.equal(result.schema, SCHEMA);
  assert.equal(result.status, 'completed');
  assert.equal(result.sourceCarrierSha256, carrier.identity.sha256);
  assert.equal(result.outputCarrierSha256, result.outputCarrier.identity.sha256);
  assert.deepEqual(result.requested, requested);
  assert.equal(result.effective.constructionId, constructionId);
  assert.deepEqual(result.effective.compressionSectionIds, requested.compressionSectionIds);
  assert.deepEqual(result.effective.repaymentSectionIds, requested.repaymentSectionIds);
  assert.equal(result.fallbackUsed, false);
  assert.deepEqual(carrier, sourceCarrierSnapshot, 'the source carrier must remain immutable');
  assert.deepEqual(
    result.outputCarrier.cages.filter(cage => cage.constructionId !== constructionId),
    carrier.cages.filter(cage => cage.constructionId !== constructionId),
    'redistribution must not mutate neighboring constructions',
  );
  assert.equal(result.fixedNodeMaximumDrift, 0);
  assert.equal(result.centerlineMaximumDrift, 0);
  assert.ok(result.effective.repaymentAreaScale > 1);
  assert.ok(result.effective.repaymentAreaScale <= requested.maximumRepaymentAreaScale);
  assert.ok(result.maximumAdjacentAreaScaleDelta <=
    requested.maximumAdjacentAreaScaleDelta + 1e-12);
  assert.ok(result.displacedVolume > 0);
  assert.ok(result.repaidVolume > 0);
  assert.ok(result.finalVolumeRelativeError <= requested.volumeRelativeTolerance);
  assert.ok(Math.abs(afterRow.currentVolume - beforeVolume) / beforeVolume <=
    requested.volumeRelativeTolerance);
  assert.equal(afterRow.nonPositiveCellCount, 0);

  for (const id of requested.compressionSectionIds) {
    assert.ok(Math.abs(
      sectionArea(afterCage, id) / sectionArea(beforeCage, id) -
        requested.compressionAreaScale,
    ) <= 1e-12);
  }
  for (const id of requested.repaymentSectionIds) {
    assert.ok(Math.abs(
      sectionArea(afterCage, id) / sectionArea(beforeCage, id) -
        result.effective.repaymentAreaScale,
    ) <= 1e-12);
  }
  for (const id of [sectionId(0), sectionId(5)]) {
    assert.equal(sectionArea(afterCage, id), sectionArea(beforeCage, id));
  }
  assert.deepEqual(
    result.outputCarrier.cages.flatMap(cage => cage.manifest.nodes)
      .filter(node => node.id.endsWith(':axis'))
      .map(node => [node.id, node.currentPosition]),
    carrier.cages.flatMap(cage => cage.manifest.nodes)
      .filter(node => node.id.endsWith(':axis'))
      .map(node => [node.id, node.currentPosition]),
  );
  assert.deepEqual(
    contactCore.applyLongitudinalRingCageSectionVolumeRedistribution(
      carrier,
      requested,
    ),
    result,
    'the longitudinal accommodation must be deterministic',
  );
});

test('longitudinal redistribution refuses fixed, overlapping, and underpowered repayment sets', () => {
  assert.equal(
    typeof contactCore.applyLongitudinalRingCageSectionVolumeRedistribution,
    'function',
  );
  const { carrier } = buildFixture();
  const constructionId = 'synthetic-construction-muscle-01';
  const sectionId = index => `${constructionId}:section:${String(index).padStart(4, '0')}`;
  const base = {
    constructionId,
    compressionAreaScale: 0.8,
    compressionSectionIds: [sectionId(2)],
    repaymentSectionIds: [sectionId(3)],
    maximumRepaymentAreaScale: 1.01,
    maximumAdjacentAreaScaleDelta: 0.4,
    volumeRelativeTolerance: 1e-10,
  };
  assert.throws(
    () => contactCore.applyLongitudinalRingCageSectionVolumeRedistribution(
      carrier,
      { ...base, compressionSectionIds: [sectionId(0)] },
    ),
    /fixed section/i,
  );
  assert.throws(
    () => contactCore.applyLongitudinalRingCageSectionVolumeRedistribution(
      carrier,
      { ...base, repaymentSectionIds: [sectionId(2)] },
    ),
    /overlap/i,
  );
  assert.throws(
    () => contactCore.applyLongitudinalRingCageSectionVolumeRedistribution(
      carrier,
      base,
    ),
    /cannot repay/i,
  );
});

test('current-K4 pressure selection targets the global movable maximum and adjacent quiet run', async () => {
  assert.equal(
    typeof contactCore.derivePressureDirectedLongitudinalRingCageVolumeRedistribution,
    'function',
    'the current-K4 assay must derive longitudinal allocation from the residual ledger',
  );
  const carrier = JSON.parse(await readFile(path.join(
    REPO_ROOT,
    'artifacts/current-k4-curvature-contact-volume-bound-assay-v0/packed-carrier.json',
  ), 'utf8'));
  const residualLedger = JSON.parse(await readFile(path.join(
    REPO_ROOT,
    'artifacts/current-k4-curvature-contact-volume-bound-assay-v0/residual-ledger.json',
  ), 'utf8'));
  const source = JSON.parse(await readFile(path.join(
    REPO_ROOT,
    'artifacts/current-k4-fixed-contact-assay-v0/contact-admitted-source.json',
  ), 'utf8'));
  const requested = {
    subjectConstructionId: 'muscle-45',
    obstacleConstructionId: 'muscle-34',
    compressionAreaScale: 0.96,
    repaymentSectionCount: 4,
    maximumRepaymentPressureRatio: 0.1,
    maximumRepaymentAreaScale: 1.2,
    maximumAdjacentAreaScaleDelta: 0.1,
    volumeRelativeTolerance: 1e-10,
  };
  const selection =
    contactCore.derivePressureDirectedLongitudinalRingCageVolumeRedistribution(
      carrier,
      residualLedger,
      requested,
    );

  assert.equal(
    selection.schema,
    'kaminos.muscle-compartment-ring-cage-pressure-volume-redistribution-selection.v0',
  );
  assert.equal(selection.status, 'completed');
  assert.equal(selection.sourceCarrierSha256, carrier.identity.sha256);
  assert.deepEqual(selection.requested, requested);
  assert.equal(selection.fallbackUsed, false);
  assert.equal(selection.targetContactCount, 3);
  assert.equal(selection.targetTotalPenetration, 0.46509551066969257);
  assert.equal(selection.targetMaximumPenetration, 0.3420731982757239);
  assert.deepEqual(selection.compressionSectionIds, [
    'muscle-45:section:0011',
  ]);
  assert.deepEqual(selection.repaymentSectionIds, [
    'muscle-45:section:0010',
    'muscle-45:section:0009',
    'muscle-45:section:0008',
    'muscle-45:section:0007',
  ]);
  assert.deepEqual(selection.operatorRequest, {
    constructionId: 'muscle-45',
    compressionAreaScale: 0.96,
    compressionSectionIds: selection.compressionSectionIds,
    repaymentSectionIds: selection.repaymentSectionIds,
    maximumRepaymentAreaScale: 1.2,
    maximumAdjacentAreaScaleDelta: 0.1,
    volumeRelativeTolerance: 1e-10,
  });
  assert.ok(selection.repaymentSections.every(
    row => row.pressureRatio <= requested.maximumRepaymentPressureRatio,
  ));
  assert.deepEqual(
    contactCore.derivePressureDirectedLongitudinalRingCageVolumeRedistribution(
      carrier,
      residualLedger,
      requested,
    ),
    selection,
  );

  const before = contactCore.measureMuscleCompartmentRingCageContactState(
    carrier,
    source,
  );
  const transfer = contactCore.applyLongitudinalRingCageSectionVolumeRedistribution(
    carrier,
    selection.operatorRequest,
  );
  const after = contactCore.measureMuscleCompartmentRingCageContactState(
    transfer.outputCarrier,
    source,
  );
  assert.equal(transfer.effective.repaymentAreaScale, 1.0038672659546135);
  assert.equal(transfer.finalVolumeRelativeError, 4.592657864275e-11);
  assert.equal(transfer.nonPositiveCellCount, 0);
  assert.equal(after.pairwise.movableMaximumPenetration, 0.3265856567325679);
  assert.ok(after.pairwise.movableMaximumPenetration <
    before.pairwise.movableMaximumPenetration);
  assert.equal(after.pairwise.movableTotalPenetration, 10.212581724883897);
  assert.ok(
    after.pairwise.movableTotalPenetration >
      before.pairwise.movableTotalPenetration,
    'the first point must preserve its aggregate-movable trade rather than claim a scalar win',
  );
  assert.ok(after.pairwise.fixedTotalPenetration <
    before.pairwise.fixedTotalPenetration);
  assert.equal(after.skeletal.totalPenetration, before.skeletal.totalPenetration);
  assert.equal(after.compartment.maximumEscape, 0);
  assert.ok(after.cages.every(row => row.nonPositiveCellCount === 0));
});
