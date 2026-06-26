import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');

assert.match(core, /LamellarPlateBoundaryMesh/, 'composition module names real plate boundary mesh records');
assert.match(core, /intentional-gap/, 'boundary mesh supports intentional gap mode');
assert.match(core, /gapRadiusStats/, 'boundary mesh records gap radius stats');
assert.match(core, /suppressedDecorativeHintIds/, 'boundary mesh records suppressed decorative hints');
assert.match(core, /makeLamellarPlateBoundaryGeometry/, 'composition module renders real boundary geometry');
assert.match(witness, /LamellarPlateBoundaryMesh/, 'composition witness reports plate boundary meshes');
assert.match(witness, /plateBoundaryTopologyVerdict/, 'composition witness reports topology verdict');

const { createTargetOrbShellCompositionFixture } = await import('../orb-shell-composition-core.js');

const fixture = createTargetOrbShellCompositionFixture({ variantId: 'wide-cup', variationSeed: 7 });
const plan = fixture.lamellarPlateBoundaryPlan;

assert.equal(plan?.schema, 'LamellarPlateBoundaryPlan', 'fixture exposes plate boundary plan');
assert.equal(plan.mode, 'plate-boundary-topology-v0', 'plate boundary plan uses topology mode');
assert.equal(plan.boundaryMeshCount, 1, 'slice should target one bounded boundary mesh');
assert.equal(plan.plateBoundaryTopologyVerdict, 'one-intentional-gap-boundary-meshed', 'plan reports one real boundary topology mesh');
assert.equal(plan.decorativeSeamHintsFinalVisible, false, 'old seam-hint tubes are not final-visible during topology correction');
assert.equal(plan.proxyPlateLipsFinalVisible, false, 'prior plate-lip proxy details are not final-visible during topology correction');
assert.ok(
  plan.suppressedProxyFeatureIds.some(id => id.endsWith('-plate-lip')),
  'topology correction suppresses prior plate-lip proxy features',
);

const boundary = plan.boundaryMeshes.find(mesh => mesh.targetBoundaryId === 'lower-cup-socket-join-gap');
assert.equal(boundary?.schema, 'LamellarPlateBoundaryMesh', 'lower cup gap has real boundary mesh record');
assert.equal(boundary.boundaryMode, 'intentional-gap', 'lower cup boundary is an intentional gap, not a decorative rail');
assert.equal(boundary.finalGeometryKind, 'constant-gap-chamfered-plate-boundary', 'boundary records final geometry kind');
assert.ok(boundary.sharedBoundarySamples.length >= 9, 'boundary carries shared boundary samples');
assert.ok(boundary.pairedBoundaryEdges.length >= 9, 'boundary carries paired boundary edges');
assert.ok(boundary.topologyFaces.includes('recessed-gap-floor'), 'boundary includes recessed gap floor');
assert.ok(boundary.topologyFaces.includes('left-chamfer-face'), 'boundary includes left chamfer face');
assert.ok(boundary.topologyFaces.includes('right-chamfer-face'), 'boundary includes right chamfer face');
assert.ok(boundary.topologyFaces.includes('left-side-wall'), 'boundary includes side-wall semantics');
assert.ok(boundary.topologyFaces.includes('right-side-wall'), 'boundary includes side-wall semantics');
assert.ok(boundary.suppressedDecorativeHintIds.includes('lower-cup-socket-join-gap-future-mesh-boundary-input'), 'old seam-hint tube is suppressed for target boundary');
assert.ok(boundary.gapRadiusStats.relativeVariation <= 0.04, 'gap radius is held close enough to constant');
assert.ok(boundary.endpointContinuityStats.maxEndpointGapDelta <= 0.004, 'boundary endpoints preserve gap continuity');
assert.equal(boundary.decorativeRailFinalVisible, false, 'boundary must not rely on a decorative round rail');
