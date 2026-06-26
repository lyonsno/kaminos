import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');

assert.match(core, /LamellarInnerReturnSidePlaneMesh/, 'composition module names inner-return side-plane mesh records');
assert.match(core, /right-side-rim-reveal-gap/, 'side-plane slice targets the right-side rim reveal gap');
assert.match(core, /inner-return-side-plane-v0/, 'composition module names inner-return side-plane mode');
assert.match(core, /makeLamellarInnerReturnSidePlaneGeometry/, 'composition module renders inner-return side-plane geometry');
assert.match(core, /makeLamellarInnerReturnSideWallGeometry/, 'composition module renders a separately legible sidewall surface');
assert.match(witness, /LamellarInnerReturnSidePlaneMesh/, 'composition witness reports inner-return side-plane meshes');
assert.match(witness, /innerReturnSidePlaneTopologyVerdict/, 'composition witness reports side-plane topology verdict');
assert.match(witness, /innerReturnSideWallVisibilityVerdict/, 'composition witness reports sidewall visibility verdict');
assert.match(witness, /sideWallVisibilityProbe/, 'composition witness measures projected sidewall visibility');
assert.match(core, /sideWallVisibilityProbe/, 'composition module exposes a sidewall projection probe');
assert.match(witness, /frameSideRimReturn/, 'composition witness can focus the side-rim return target');

const { createTargetOrbShellCompositionFixture } = await import('../orb-shell-composition-core.js');

const fixture = createTargetOrbShellCompositionFixture({ variantId: 'wide-cup', variationSeed: 7 });
const plan = fixture.lamellarInnerReturnPlan;

assert.equal(plan?.schema, 'LamellarInnerReturnPlan', 'fixture exposes inner-return plan');
assert.equal(plan.mode, 'inner-return-side-plane-v0', 'inner-return plan uses side-plane mode');
assert.equal(plan.sidePlaneMeshCount, 1, 'slice should target one visible side-rim return');
assert.equal(plan.innerReturnSidePlaneTopologyVerdict, 'one-visible-side-rim-return-side-plane-meshed', 'plan reports one side-plane topology mesh');
assert.equal(plan.declaredSecondLayer, false, 'inner return is not declared as full second shell layer');

const sidePlane = plan.sidePlaneMeshes.find(mesh => mesh.targetBoundaryId === 'right-side-rim-reveal-gap');
assert.equal(sidePlane?.schema, 'LamellarInnerReturnSidePlaneMesh', 'right side rim has side-plane mesh record');
assert.equal(sidePlane.mode, 'inner-return-side-plane-v0', 'side-plane mesh uses inner-return mode');
assert.equal(sidePlane.finalGeometryKind, 'outer-edge-to-inner-return-side-wall', 'side-plane records final geometry kind');
assert.equal(sidePlane.boundaryRole, 'visible-side-rim-inner-return-candidate', 'side-plane records bounded role');
assert.ok(sidePlane.outerPlateEdge.length >= 9, 'side-plane carries outer plate edge samples');
assert.ok(sidePlane.innerReturnEdge.length >= 9, 'side-plane carries inner return edge samples');
assert.ok(sidePlane.sideWallFaces.includes('outer-chamfer-return'), 'side-plane includes outer chamfer return');
assert.ok(sidePlane.sideWallFaces.includes('inner-return-wall'), 'side-plane includes inner return wall');
assert.ok(sidePlane.sideWallFaces.includes('inner-return-chamfer'), 'side-plane includes inner chamfer return');
assert.ok(sidePlane.sideWallRenderableSurfaces?.includes('visible-return-sidewall-band'), 'side-plane exposes a separately renderable visible sidewall band');
assert.equal(sidePlane.sideWallVisibilityContract?.status, 'operator-visible', 'sidewall visibility contract must require operator-visible geometry');
assert.ok(sidePlane.sideWallVisibilityContract?.minimumScreenContrast >= 0.18, 'sidewall visibility contract requires measurable screen contrast');
assert.ok(sidePlane.sideWallVisibilityContract?.minimumProjectedWidthPx >= 10, 'sidewall visibility contract requires visible projected width');
assert.ok(sidePlane.returnThicknessStats.relativeVariation <= 0.05, 'return thickness is held close enough to constant');
assert.ok(sidePlane.endpointContinuityStats.maxEndpointThicknessDelta <= 0.004, 'return endpoints preserve thickness continuity');
assert.equal(sidePlane.proxyRailFinalVisible, false, 'side-plane must not rely on proxy rails');
assert.ok(sidePlane.suppressedProxyHintIds.includes('right-side-rim-reveal-gap-future-mesh-boundary-input'), 'old right-side seam hint is suppressed for target');
