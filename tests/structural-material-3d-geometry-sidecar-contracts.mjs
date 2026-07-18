import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import {
  createLayeredStructuralMaterial,
  evaluateLayeredStructuralBondResponse,
} from '../structural-material-3d-core.js';

const geometrySidecar = await import('../structural-material-3d-geometry-sidecar.js').catch(() => ({}));
const pageSource = readFileSync(new URL('../structural-material-3d.html', import.meta.url), 'utf8');
const witnessSource = readFileSync(new URL('../structural-material-3d-geometry-sidecar-witness.mjs', import.meta.url), 'utf8');
const greenroomWrapperUrl = new URL('../structural-material-3d-geometry-greenroom-launch.mjs', import.meta.url);
assert.ok(existsSync(greenroomWrapperUrl), 'Effigy Tile commits its exact Greenroom launch and identity shield');
const greenroomWrapperSource = readFileSync(greenroomWrapperUrl, 'utf8');

assert.equal(
  typeof geometrySidecar.buildEffigyTileGeometrySidecar,
  'function',
  'Effigy Tile exposes a pure structural-state-to-closed-surface projection',
);
assert.equal(
  typeof geometrySidecar.resolveEffigyTileSurfaceContact,
  'function',
  'visible tile faces resolve to stable structural contact identity',
);
assert.equal(
  typeof geometrySidecar.assessEffigyTileGeometryTransition,
  'function',
  'surface transitions expose falsifiable compliance and fracture evidence',
);
assert.match(
  pageSource,
  /buildEffigyTileGeometrySidecar/,
  'the product route consumes the pure geometry sidecar',
);
assert.match(witnessSource, /failurePhase/, 'geometry witness records failure before primary evidence completes');
assert.match(witnessSource, /lastTrustworthyEvidence/, 'geometry witness preserves partial evidence on failure');
assert.match(witnessSource, /effectiveGeometryRoute/, 'geometry witness records effective sidecar route identity');
assert.match(witnessSource, /effectiveExecutionRoute/, 'geometry witness records effective GPU execution identity');
assert.match(witnessSource, /cpuFallbackUsed/, 'geometry witness fails closed on hidden CPU fallback');
assert.match(witnessSource, /complianceKeptConnectivity/, 'geometry witness separates compliance from fracture');
assert.match(witnessSource, /fractureExposedStructuralFaces/, 'geometry witness requires topology-exposed faces');
assert.match(witnessSource, /bindingReducedFractureFaces/, 'geometry witness requires visible connectivity repair');
assert.match(witnessSource, /Network\.setCacheDisabled/, 'geometry witness cannot consume stale browser modules');
assert.match(greenroomWrapperSource, /structural-material-3d-geometry-sidecar-witness\.mjs/);
assert.match(greenroomWrapperSource, /kaminos\.structural-material\.effigy-tile-browser-witness\.v0/);
assert.match(greenroomWrapperSource, /effectiveGeometryRoute/);
assert.match(greenroomWrapperSource, /effectiveExecutionRoute/);
assert.match(greenroomWrapperSource, /effectiveBindingRoute/);
assert.match(greenroomWrapperSource, /cpuFallbackUsed/);
assert.match(greenroomWrapperSource, /failedChecks/);
assert.match(greenroomWrapperSource, /screenshot.*byteLength/is);
assert.match(
  pageSource,
  /effigySurfacePick/,
  'the visible closed surface carries stable structural picking metadata',
);
assert.match(
  pageSource,
  /resolveEffigyTileSurfaceContact/,
  'surface picking resolves through the explicit sidecar contract',
);
assert.match(
  pageSource,
  /fracture-surface/,
  'the renderer distinguishes topology-exposed fracture faces from the exterior shell',
);
assert.match(
  pageSource,
  /geometryTransitionLedger/,
  'the product route records surface motion separately from connectivity change',
);
assert.match(
  pageSource,
  /options\.useCurrentState[\s\S]*?\? material/,
  'the geometry witness can compose compliance, fracture, and binding over one accepted state',
);

const {
  EFFIGY_TILE_GEOMETRY_AUTHORITY,
  EFFIGY_TILE_GEOMETRY_ROUTE,
  buildEffigyTileGeometrySidecar,
  resolveEffigyTileSurfaceContact,
  assessEffigyTileGeometryTransition,
} = geometrySidecar;

const material = createLayeredStructuralMaterial({
  columns: 6,
  rows: 4,
  layers: 3,
  notch: false,
  profile: 'rib-upper-v0',
});
const initial = buildEffigyTileGeometrySidecar(material, { profile: 'rib-upper-v0' });

assert.equal(EFFIGY_TILE_GEOMETRY_ROUTE, 'kaminos.structural-material.effigy-tile.v0');
assert.equal(EFFIGY_TILE_GEOMETRY_AUTHORITY, 'gpu-structural-state-to-dual-cell-surface-v0');
assert.equal(initial.status, 'passed');
assert.equal(initial.cells.length, material.nodes.length, 'every structural node owns one closed dual cell');
assert.ok(initial.faces.some(face => face.visibility === 'outer-surface'), 'the tile has an exterior shell');
assert.ok(initial.faces.some(face => face.visibility === 'hidden-live-adjacency'), 'live interior adjacency is hidden');
assert.equal(initial.faces.some(face => face.visibility === 'fracture-surface'), false, 'an intact control has no fracture face');
assert.equal(initial.validation.errorCount, 0, 'the initial shell is internally coherent');

const upperRibMaterial = createLayeredStructuralMaterial({
  columns: 9,
  rows: 5,
  layers: 4,
  notch: true,
  profile: 'rib-upper-v0',
});
const lowerRibMaterial = createLayeredStructuralMaterial({
  columns: 9,
  rows: 5,
  layers: 4,
  notch: true,
  profile: 'rib-lower-v0',
});
const profileForce = {
  point: { x: 0.72, y: 0.25, z: 0.8 },
  vector: { x: 0.82, y: 0.1, z: -0.56 },
  magnitude: 1.1,
  radius: 0.2,
};
const profileStrains = state => state.bonds.map(bond =>
  evaluateLayeredStructuralBondResponse(bond, profileForce).strain
);
const upperRibStrains = profileStrains(upperRibMaterial);
const lowerRibStrains = profileStrains(lowerRibMaterial);
assert.notDeepEqual(
  upperRibStrains,
  lowerRibStrains,
  'mirroring the visible rib changes the force-equivalent structural strain field',
);
const meanNearbyStrain = (state, strains) => {
  const nearby = state.bonds
    .map((bond, index) => ({ bond, strain: strains[index] }))
    .filter(({ bond }) => Math.hypot(bond.midpoint.x - 0.68, bond.midpoint.y - 0.28) < 0.3);
  return nearby.reduce((sum, entry) => sum + entry.strain, 0) / nearby.length;
};
assert.ok(
  meanNearbyStrain(upperRibMaterial, upperRibStrains) <
    meanNearbyStrain(lowerRibMaterial, lowerRibStrains),
  'the upper structural rib reduces strain near its matching visible thickening',
);

for (const face of initial.faces) {
  assert.equal(face.restVertices.length, 4, `${face.id} has a stable rest quad`);
  assert.equal(face.currentVertices.length, 4, `${face.id} has a current render quad`);
  assert.equal(face.triangles.length, 2, `${face.id} is directly renderable as two triangles`);
  assert.equal(face.structuralNodeId, face.pick.structuralNodeId, `${face.id} preserves owner identity for picking`);
}

const visibleFace = initial.faces.find(face => face.visibility === 'outer-surface' && !face.pinned);
assert.ok(visibleFace, 'fixture exposes an unpinned visible face');
const surfaceContact = resolveEffigyTileSurfaceContact(initial, {
  faceId: visibleFace.id,
  triangleIndex: 1,
  barycentric: { x: 0.2, y: 0.3, z: 0.5 },
});
assert.equal(surfaceContact.authority, 'stable-effigy-surface-to-structural-contact-v0');
assert.equal(surfaceContact.faceId, visibleFace.id);
assert.equal(surfaceContact.structuralContact.kind, 'node');
assert.equal(surfaceContact.structuralContact.id, visibleFace.structuralNodeId);
assert.equal(surfaceContact.profile, 'rib-upper-v0');

const preBreakMaterial = structuredClone(material);
const contactNode = preBreakMaterial.nodes.find(node => node.id === visibleFace.structuralNodeId);
contactNode.displacement = { x: 0.018, y: -0.011, z: 0.006 };
const preBreak = buildEffigyTileGeometrySidecar(preBreakMaterial, { profile: 'rib-upper-v0' });
const compliance = assessEffigyTileGeometryTransition(initial, preBreak, {
  contactNodeId: contactNode.id,
});
assert.equal(compliance.status, 'passed');
assert.equal(compliance.bondLivenessChanged, false, 'pre-fracture compliance precedes connectivity change');
assert.ok(compliance.contactSurfaceDelta > 0.015, 'the contacted visible surface moves before fracture');
assert.equal(compliance.fractureFaceCountAfter, 0, 'pre-fracture movement does not counterfeit a crack');

const hiddenContactMaterial = structuredClone(material);
const hiddenContactNode = hiddenContactMaterial.nodes.find(node => {
  const ownedFaces = initial.faces.filter(face => face.structuralNodeId === node.id);
  return ownedFaces.length === 6 && ownedFaces.every(face => face.visibility === 'hidden-live-adjacency');
});
assert.ok(hiddenContactNode, 'fixture contains a fully internal structural node');
hiddenContactNode.displacement = { x: 0.03, y: 0.01, z: -0.02 };
const hiddenContactSidecar = buildEffigyTileGeometrySidecar(hiddenContactMaterial, { profile: 'rib-upper-v0' });
const hiddenContactTransition = assessEffigyTileGeometryTransition(initial, hiddenContactSidecar, {
  contactNodeId: hiddenContactNode.id,
});
assert.equal(
  hiddenContactTransition.contactSurfaceDelta,
  0,
  'motion of a fully hidden cell cannot impersonate visible contact-surface compliance',
);
assert.equal(hiddenContactTransition.prefractureCompliance, false);

const axisBond = material.bonds.find(bond => {
  const a = material.nodes.find(node => node.id === bond.a);
  const b = material.nodes.find(node => node.id === bond.b);
  const changedAxes = [a.x !== b.x, a.y !== b.y, a.z !== b.z].filter(Boolean).length;
  return changedAxes === 1 && !a.pinned && !b.pinned;
});
assert.ok(axisBond, 'fixture has a render-governing axis bond');

const diagonalBond = material.bonds.find(bond => {
  const a = material.nodes.find(node => node.id === bond.a);
  const b = material.nodes.find(node => node.id === bond.b);
  return [a.x !== b.x, a.y !== b.y, a.z !== b.z].filter(Boolean).length > 1;
});
assert.ok(diagonalBond, 'fixture has a non-surface-governing interior brace');
const deadBraceMaterial = structuredClone(material);
deadBraceMaterial.bonds.find(bond => bond.id === diagonalBond.id).alive = false;
const deadBraceSidecar = buildEffigyTileGeometrySidecar(deadBraceMaterial, { profile: 'rib-upper-v0' });
const deadBraceEvidence = deadBraceSidecar.structuralBondLiveness.find(bond => bond.id === diagonalBond.id);
assert.equal(deadBraceSidecar.status, 'passed');
assert.equal(deadBraceEvidence.surfaceGovernance, 'interior-brace');
assert.equal(deadBraceEvidence.controlledFaceCount, 0);
assert.equal(deadBraceSidecar.summary.deadInteriorBraceCount, 1);
assert.equal(
  deadBraceSidecar.faces.filter(face => face.governingBondId === diagonalBond.id).length,
  0,
  'a dead brace has explicit non-surface governance rather than a counterfeit face',
);

const fracturedMaterial = structuredClone(preBreakMaterial);
fracturedMaterial.bonds.find(bond => bond.id === axisBond.id).alive = false;
const fractured = buildEffigyTileGeometrySidecar(fracturedMaterial, { profile: 'rib-upper-v0' });
const exposedFaces = fractured.faces.filter(face => face.governingBondId === axisBond.id && face.visibility === 'fracture-surface');
assert.equal(exposedFaces.length, 2, 'one dead adjacency exposes both material sides of the crack');
assert.ok(exposedFaces.every(face => face.surfaceRole === 'fracture'), 'dead adjacency is visibly classified as fracture');
assert.ok(exposedFaces.every(face => face.governingBondAlive === false), 'fracture visibility carries dead structural evidence');
assert.equal(fractured.validation.errorCount, 0, 'fracture exposure preserves shell coherence');

const missingAdjacencyMaterial = structuredClone(material);
missingAdjacencyMaterial.bonds = missingAdjacencyMaterial.bonds.filter(bond => bond.id !== axisBond.id);
const missingAdjacency = buildEffigyTileGeometrySidecar(missingAdjacencyMaterial, { profile: 'rib-upper-v0' });
assert.equal(missingAdjacency.status, 'failed', 'an undeclared missing axis bond cannot impersonate an authored opening');
assert.ok(
  missingAdjacency.validation.errors.includes(`undeclared-opening:${axisBond.a}:${axisBond.b}`) ||
    missingAdjacency.validation.errors.includes(`undeclared-opening:${axisBond.b}:${axisBond.a}`),
  'malformed topology names the exact undeclared structural opening',
);

const fractureTransition = assessEffigyTileGeometryTransition(preBreak, fractured, {
  contactNodeId: contactNode.id,
});
assert.equal(fractureTransition.status, 'passed');
assert.equal(fractureTransition.bondLivenessChanged, true);
assert.equal(fractureTransition.newFractureFaceCount, 2);

const forgedTopologySidecar = structuredClone(preBreak);
forgedTopologySidecar.topologyEpoch = 99;
forgedTopologySidecar.connectivityEpoch = 99;
for (const cell of forgedTopologySidecar.cells) {
  if (cell.structuralNodeId === contactNode.id) cell.componentId = 'g999';
}
for (const face of forgedTopologySidecar.faces) {
  if (face.structuralNodeId === contactNode.id) face.componentId = 'g999';
}
const forgedTopologyTransition = assessEffigyTileGeometryTransition(initial, forgedTopologySidecar, {
  contactNodeId: contactNode.id,
});
assert.equal(forgedTopologyTransition.status, 'failed');
assert.equal(forgedTopologyTransition.prefractureCompliance, false);
assert.ok(forgedTopologyTransition.errors.includes('topology-epoch-changed-without-liveness'));
assert.ok(forgedTopologyTransition.errors.includes('connectivity-epoch-changed-without-liveness'));
assert.ok(forgedTopologyTransition.errors.includes('component-identity-changed-without-liveness'));

const prefixOnlySidecar = structuredClone(preBreak);
for (const cell of prefixOnlySidecar.cells) cell.componentId = cell.componentId.replace(/^c/, 'g');
for (const face of prefixOnlySidecar.faces) face.componentId = face.componentId.replace(/^c/, 'g');
const prefixOnlyTransition = assessEffigyTileGeometryTransition(initial, prefixOnlySidecar, {
  contactNodeId: contactNode.id,
});
assert.equal(prefixOnlyTransition.status, 'passed', 'c0 to g0 prefix churn preserves canonical component identity');
assert.equal(prefixOnlyTransition.prefractureCompliance, true);

const reboundMaterial = structuredClone(fracturedMaterial);
reboundMaterial.bonds.find(bond => bond.id === axisBond.id).alive = true;
reboundMaterial.bonds.find(bond => bond.id === axisBond.id).repaired = true;
const rebound = buildEffigyTileGeometrySidecar(reboundMaterial, { profile: 'rib-upper-v0' });
assert.equal(
  rebound.faces.filter(face => face.governingBondId === axisBond.id && face.visibility === 'fracture-surface').length,
  0,
  'binding hides both structurally repaired fracture faces',
);
assert.equal(
  rebound.faces.filter(face => face.governingBondId === axisBond.id && face.visibility === 'hidden-live-adjacency').length,
  2,
  'binding restores hidden live adjacency rather than deleting its evidence identity',
);

console.log('structural-material-3d geometry sidecar contracts passed');
