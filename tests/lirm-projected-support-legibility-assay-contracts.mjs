import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  buildProjectedSupportAssayCells,
  validateProjectedSupportAssayReceipt,
} from '../lirm-projected-support-legibility-assay.mjs';

const cells = buildProjectedSupportAssayCells();
const hash = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
assert.equal(cells.length, 16, 'mass, emission, contact, and view must form sixteen controls');
assert.equal(new Set(cells.map(cell => cell.cellId)).size, 16, 'control cell ids must be unique');
assert.deepEqual(
  new Set(cells.map(cell => cell.mass)),
  new Set(['bauplan-only', 'bauplan-heavy']),
);
assert.deepEqual(
  new Set(cells.map(cell => cell.controlFactors.limbEmission)),
  new Set(['centerline', 'bilateral-sidecar']),
);
assert.deepEqual(
  new Set(cells.map(cell => cell.controlFactors.contactGeometry)),
  new Set(['body-sdf', 'semantic-only']),
);
assert.deepEqual(
  new Set(cells.map(cell => cell.controlFactors.projection)),
  new Set(['legacy-yaw-0.42', 'pairing-legible-yaw-pi-over-4']),
);

function projectionEvidenceFor(cell) {
  const supportOccupancy = cell.controlFactors.limbEmission === 'bilateral-sidecar' ? 0 : 64;
  const contactOccupancy = cell.controlFactors.contactGeometry === 'semantic-only' ? 0 : 32;
  const primitiveVisibility = [
    {
      id: 'trunk-0',
      index: 0,
      role: 'axial_segment',
      visiblePixelCount: 4096,
      projectedCentroid: { x: 128, y: 96, depth01: 0.5 },
    },
  ];
  if (supportOccupancy > 0) {
    primitiveVisibility.push({
      id: 'limb-0',
      index: 1,
      role: 'limb_bud',
      visiblePixelCount: supportOccupancy,
      projectedCentroid: { x: 112, y: 128, depth01: 0.6 },
    });
  }
  if (contactOccupancy > 0) {
    primitiveVisibility.push({
      id: 'contact-0',
      index: 2,
      role: 'contact_point',
      visiblePixelCount: contactOccupancy,
      projectedCentroid: { x: 112, y: 136, depth01: 0.65 },
    });
  }
  return {
    schema: 'kaminos.projected-support-identity-evidence.v0',
    pixelGrid: { width: 256, height: 192 },
    cameraYawRadians: cell.controlFactors.projection === 'legacy-yaw-0.42'
      ? 0.42
      : Math.PI / 4,
    organismalMaskPixelCount: primitiveVisibility
      .reduce((sum, primitive) => sum + primitive.visiblePixelCount, 0),
    projectedSupportGeometryOccupancy: supportOccupancy,
    projectedContactMarkerOccupancy: contactOccupancy,
    primitiveVisibility,
  };
}

const validReceipt = {
  schema: 'kaminos.lirm-projected-support-legibility-preflight.v0',
  status: 'controls-complete-uninspected',
  requestedRoute: 'kaminos/lirm-projected-support-legibility/preflight-v0',
  effectiveRoute: 'kaminos/lirm-projected-support-legibility/preflight-v0',
  sourceCommit: '0123456789abcdef0123456789abcdef01234567',
  cells: cells.map(cell => ({
    ...cell,
    requestedControlFactors: cell.controlFactors,
    effectiveControlFactors: {
      ...cell.controlFactors,
      cameraYawRadians: cell.controlFactors.projection === 'legacy-yaw-0.42'
        ? 0.42
        : Math.PI / 4,
    },
    projectionEvidence: projectionEvidenceFor(cell),
    bundleSha256: hash(`${cell.cellId}-bundle`),
    maps: Object.fromEntries(['clay', 'depth', 'normal', 'mask', 'semantic'].map(kind => [
      kind,
      {
        path: `${cell.cellId}/${kind}.png`,
        byteSize: 128,
        sha256: hash(`${cell.cellId}-${kind}`),
        svgEvidence: {
          byteSize: 256,
          sha256: hash(`${cell.cellId}-${kind}-svg`),
        },
      },
    ])),
  })),
  controlSheet: {
    path: 'control-sheet.png',
    byteSize: 256,
    sha256: hash('sheet'),
  },
  repairedSheet: {
    path: 'repaired-sheet.png',
    byteSize: 256,
    sha256: hash('repaired-sheet'),
  },
  sourceState: {
    commit: '0123456789abcdef0123456789abcdef01234567',
    dirty: false,
    statusLines: [],
    sourceFiles: [
      {
        path: 'lirm-speciation-armature-core.js',
        byteSize: 128,
        sha256: hash('core-source'),
      },
      {
        path: 'lirm-projected-support-legibility-assay.mjs',
        byteSize: 128,
        sha256: hash('assay-source'),
      },
    ],
  },
};
assert.equal(validateProjectedSupportAssayReceipt(validReceipt), true);

const missingCell = structuredClone(validReceipt);
missingCell.cells.pop();
assert.throws(
  () => validateProjectedSupportAssayReceipt(missingCell),
  /exactly sixteen cells/,
);

const routeFallback = structuredClone(validReceipt);
routeFallback.effectiveRoute = 'fallback/unknown';
assert.throws(
  () => validateProjectedSupportAssayReceipt(routeFallback),
  /requested and effective route identity/,
);

const missingMap = structuredClone(validReceipt);
delete missingMap.cells[0].maps.normal;
assert.throws(
  () => validateProjectedSupportAssayReceipt(missingMap),
  /missing normal evidence/,
);

const staleFactors = structuredClone(validReceipt);
staleFactors.cells[0].effectiveControlFactors.limbEmission = 'bilateral';
assert.throws(
  () => validateProjectedSupportAssayReceipt(staleFactors),
  /requested and effective factor identity/,
);

const staleYaw = structuredClone(validReceipt);
staleYaw.cells[0].effectiveControlFactors.cameraYawRadians = Math.PI / 4;
assert.throws(
  () => validateProjectedSupportAssayReceipt(staleYaw),
  /camera identity drift/,
);

const missingProjectionEvidence = structuredClone(validReceipt);
delete missingProjectionEvidence.cells[0].projectionEvidence;
assert.throws(
  () => validateProjectedSupportAssayReceipt(missingProjectionEvidence),
  /missing projection evidence/,
);

const malformedProjectionEvidence = structuredClone(validReceipt);
malformedProjectionEvidence.cells[0].projectionEvidence = {};
assert.throws(
  () => validateProjectedSupportAssayReceipt(malformedProjectionEvidence),
  /malformed projection evidence/,
);

const missingSvgEvidence = structuredClone(validReceipt);
delete missingSvgEvidence.cells[0].maps.clay.svgEvidence;
assert.throws(
  () => validateProjectedSupportAssayReceipt(missingSvgEvidence),
  /clay SVG/,
);

const projectedRepairedSupport = structuredClone(validReceipt);
const repairedCell = projectedRepairedSupport.cells.find(
  cell => cell.controlFactors.limbEmission === 'bilateral-sidecar',
);
repairedCell.projectionEvidence.projectedSupportGeometryOccupancy = 1;
repairedCell.projectionEvidence.organismalMaskPixelCount += 1;
repairedCell.projectionEvidence.primitiveVisibility.push({
  id: 'unexpected-limb-0',
  index: 99,
  role: 'limb_bud',
  visiblePixelCount: 1,
  projectedCentroid: { x: 100, y: 120, depth01: 0.7 },
});
assert.throws(
  () => validateProjectedSupportAssayReceipt(projectedRepairedSupport),
  /projected repeated support geometry/,
);

const missingRepairedSheet = structuredClone(validReceipt);
delete missingRepairedSheet.repairedSheet;
assert.throws(
  () => validateProjectedSupportAssayReceipt(missingRepairedSheet),
  /repaired sheet/,
);

const driftedCellIdentity = structuredClone(validReceipt);
driftedCellIdentity.cells[0].mass = 'bauplan-heavy';
assert.throws(
  () => validateProjectedSupportAssayReceipt(driftedCellIdentity),
  /cell identity drift/,
);

const missingSourceState = structuredClone(validReceipt);
delete missingSourceState.sourceState;
assert.throws(
  () => validateProjectedSupportAssayReceipt(missingSourceState),
  /source state/,
);

const driftedSourceCommit = structuredClone(validReceipt);
driftedSourceCommit.sourceCommit = 'abcdef0123456789abcdef0123456789abcdef01';
assert.throws(
  () => validateProjectedSupportAssayReceipt(driftedSourceCommit),
  /source commit drift/,
);

const unaccountedDirtySource = structuredClone(validReceipt);
unaccountedDirtySource.sourceState.dirty = true;
assert.throws(
  () => validateProjectedSupportAssayReceipt(unaccountedDirtySource),
  /dirty source state lacks status lines/,
);

console.log('LIRM projected support legibility assay contracts passed');
