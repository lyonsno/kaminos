import assert from 'node:assert/strict';

import {
  CARRIER_FAMILIES,
  STANCE_PROGRAMS,
  buildSupportControlCarrierCells,
  validateSupportControlCarrierManifest,
} from '../lirm-support-control-carrier-atlas.mjs';

assert.equal(CARRIER_FAMILIES.length, 6);
assert.equal(STANCE_PROGRAMS.length, 6);
assert.equal(new Set(CARRIER_FAMILIES.map(family => family.id)).size, 6);
assert.equal(new Set(STANCE_PROGRAMS.map(program => program.id)).size, 6);

const cells = buildSupportControlCarrierCells();
assert.equal(cells.length, 36);
assert.equal(new Set(cells.map(cell => cell.cellId)).size, 36);
assert.equal(new Set(cells.map(cell => cell.bauplanId)).size, 1);
assert.equal(new Set(cells.map(cell => cell.cameraId)).size, 1);

const forbiddenRoles = new Set([
  'contact_point',
  'groundContact',
  'limb_bud',
  'radialContactLimb',
]);
for (const cell of cells) {
  assert.equal(cell.generatorFiring, 'not_started');
  assert.ok(['shape_pixels', 'separate_reference', 'shape_plus_reference', 'sidecar_only'].includes(
    cell.authority.generatorAuthority,
  ));
  assert.ok(cell.geometryRoles.every(role => !forbiddenRoles.has(role)));
  assert.equal(cell.contactMarkersEnterBodySdf, false);
}

const bodyOnly = cells.filter(cell => cell.familyId === 'body-only');
assert.ok(bodyOnly.every(cell => cell.geometryRoles.length === 0));
assert.ok(bodyOnly.every(cell => cell.authority.generatorAuthority === 'sidecar_only'));

const fused = cells.filter(cell => cell.familyId === 'fused-carriers');
assert.ok(fused.every(cell => cell.geometryRoles.includes('fusedSupportCarrier')));
assert.ok(fused.every(cell => cell.authority.generatorAuthority === 'shape_pixels'));

const external = cells.filter(cell => cell.familyId === 'external-rig');
assert.ok(external.every(cell => cell.geometryRoles.length === 0));
assert.ok(external.every(cell => cell.authority.generatorAuthority === 'separate_reference'));

const stanceSignatures = STANCE_PROGRAMS.map(program => JSON.stringify(program.supports));
assert.equal(new Set(stanceSignatures).size, STANCE_PROGRAMS.length);

const manifest = {
  schema: 'kaminos.lirm-support-control-carrier-atlas.v0',
  requestedRoute: 'kaminos/lirm-support-control-carrier-atlas/pre-flux-v0',
  effectiveRoute: 'kaminos/lirm-support-control-carrier-atlas/pre-flux-v0',
  status: 'rendered-uninspected',
  generatorFiring: 'not_started',
  cells: cells.map(cell => ({
    ...cell,
    shapeCarrier: {
      path: `cells/${cell.cellId}/shape-carrier.png`,
      byteSize: 128,
      sha256: `sha256:${'a'.repeat(64)}`,
    },
    controlDiagram: {
      path: `cells/${cell.cellId}/control-diagram.png`,
      byteSize: 128,
      sha256: `sha256:${'b'.repeat(64)}`,
    },
  })),
  sheets: CARRIER_FAMILIES.map(family => ({
    familyId: family.id,
    path: `family-${family.id}.png`,
    byteSize: 512,
    sha256: `sha256:${'c'.repeat(64)}`,
  })),
  overview: {
    path: 'overview.png',
    byteSize: 1024,
    sha256: `sha256:${'d'.repeat(64)}`,
  },
};
assert.equal(validateSupportControlCarrierManifest(manifest), true);
assert.throws(
  () => validateSupportControlCarrierManifest({
    ...manifest,
    cells: manifest.cells.slice(1),
  }),
  /exactly 36 cells/,
);
assert.throws(
  () => validateSupportControlCarrierManifest({
    ...manifest,
    generatorFiring: 'completed',
  }),
  /must remain pre-FLUX/,
);

console.log('LIRM support-control carrier atlas contracts passed');
