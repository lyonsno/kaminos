import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');

assert.match(core, /MacroPromotedBody/, 'composition module names MacroPromotedBody descriptors');
assert.match(core, /macro-body-promotion-closure-v0/, 'composition module names the macro-body promotion mode');
assert.match(core, /MacroBodyPromotionPlan/, 'composition records a macro body promotion plan');
assert.match(core, /lower-cup-socket-contiguous/, 'composition records lower-cup socket continuity');
assert.match(core, /forbid-accidental-triangle-bottom-gap/, 'composition rejects the accidental triangular bottom gap');
assert.match(core, /crossing-tuck-macro-body/, 'composition records crossing-tuck macro body integration');
assert.match(core, /subordinate-ridge-not-lone-wand/, 'composition demotes the crossing rail from standalone objecthood');
assert.match(core, /makeMacroPromotedBodyGeometry/, 'composition renders promoted macro body geometry');
assert.match(core, /LiveMacroSideWallPlan/, 'composition names live macro sidewall plan records');
assert.match(core, /makeMacroPromotedBodySideWallGeometry/, 'composition renders live macro sidewall polygon geometry');
assert.match(core, /liveRenderMaterialPolicy/, 'composition records live render material policy');
assert.match(core, /territoryProxyUnderlayVisible: false/, 'live sidewall witness suppresses overlapping territory proxy underlay');
assert.match(core, /makeLowerCupClosureGeometry/, 'composition renders lower cup closure geometry');
assert.match(core, /makeCrossingTuckBodyGeometry/, 'composition renders crossing tuck body geometry');
assert.match(core, /promotedBodyCount/, 'debug state records promoted macro body count');
assert.match(core, /lowerCupClosure/, 'debug state records lower cup closure');
assert.match(core, /crossingTuckIntegration/, 'debug state records crossing tuck integration');
assert.match(witness, /MacroPromotedBody/, 'composition witness records promoted macro bodies');
assert.match(witness, /promotedBodyCount/, 'composition witness reports promoted body count');
assert.match(witness, /lowerCupClosure/, 'composition witness reports lower cup closure');
assert.match(witness, /crossingTuckIntegration/, 'composition witness reports crossing tuck integration');
assert.match(witness, /LiveMacroSideWall/, 'composition witness reports live macro sidewall records');
assert.match(witness, /liveMacroSideWallVisibilityVerdict/, 'composition witness reports live macro sidewall visibility verdict');
assert.match(witness, /live-macro-sidewall/, 'composition witness has a focused live sidewall smoke mode');
assert.match(core, /frameLiveMacroSideWall/, 'composition module can frame the live macro sidewall target');

const { createTargetOrbShellCompositionFixture } = await import('../orb-shell-composition-core.js');

const fixture = createTargetOrbShellCompositionFixture({ variantId: 'wide-cup', variationSeed: 7 });
const plan = fixture.macroBodyPromotion;

assert.equal(plan?.schema, 'MacroBodyPromotionPlan', 'fixture exposes a macro body promotion plan');
assert.equal(plan.mode, 'macro-body-promotion-closure-v0', 'fixture records promotion mode');
assert.equal(plan.promotedBodies.length, fixture.macroAssemblages.length, 'one promoted body per macro assemblage');
assert.ok(plan.promotedBodies.every(body => body.schema === 'MacroPromotedBody'), 'all promoted bodies use MacroPromotedBody schema');
assert.ok(plan.promotedBodies.every(body => body.objecthood === 'macro-assemblage-body-not-final-band'), 'promoted bodies own macro objecthood');
assert.ok(plan.promotedBodies.every(body => body.subordinateAnatomy.includes('internal-rail-ridge')), 'promoted bodies carry subordinate rail anatomy');

assert.equal(fixture.liveMacroSideWallPlan?.schema, 'LiveMacroSideWallPlan', 'fixture exposes live macro sidewall plan');
assert.equal(fixture.liveMacroSideWallPlan.mode, 'live-promoted-body-sidewall-v0', 'live sidewall plan uses promoted body sidewall mode');
assert.equal(fixture.liveMacroSideWallPlan.liveMacroSideWallVisibilityVerdict, 'visible-promoted-body-edge-sidewalls-rendered', 'live sidewall plan records rendered visible edge sidewalls');
assert.equal(fixture.liveMacroSideWallPlan.liveRenderMaterialPolicy.materialMode, 'flat-low-shader-topology', 'live sidewall plan requires flat low-shader material mode');
assert.equal(fixture.liveMacroSideWallPlan.liveRenderMaterialPolicy.metalShaderVisible, false, 'live sidewall plan disables fancy metal shader for topology smoke');
assert.equal(fixture.liveMacroSideWallPlan.liveRenderMaterialPolicy.surfaceDetailMode, 'disabled', 'live sidewall plan disables surface detail for topology smoke');
assert.equal(fixture.liveMacroSideWallPlan.liveRenderMaterialPolicy.territoryProxyUnderlayVisible, false, 'live sidewall plan suppresses territory proxy underlay');

const liveSideWall = fixture.liveMacroSideWallPlan.sideWalls.find(wall => wall.parentAssemblage === 'north-west-dominant-thrust' && wall.targetEdge === 'left-promoted-body-edge');
assert.equal(liveSideWall?.schema, 'LiveMacroSideWall', 'north-west promoted body has a live sidewall record');
assert.equal(liveSideWall.targetEdge, 'left-promoted-body-edge', 'live sidewall targets the visible left promoted body edge');
assert.equal(liveSideWall.materialMode, 'flat-low-shader-readable-thickness', 'live sidewall uses low-shader readable material');
assert.equal(liveSideWall.surfaceDetailMode, 'disabled', 'live sidewall disables surface detail');
assert.ok(liveSideWall.outerSurfaceEdge.length >= 24, 'live sidewall carries outer surface edge samples');
assert.ok(liveSideWall.innerThicknessEdge.length >= 24, 'live sidewall carries inner thickness edge samples');
assert.ok(liveSideWall.sideWallThicknessStats.mean >= 0.035, 'live sidewall has visible thickness');
assert.ok(liveSideWall.sideWallThicknessStats.relativeVariation <= 0.08, 'live sidewall thickness stays stable enough to read');
assert.ok(liveSideWall.polygonFaceCount >= 40, 'live sidewall records real polygon side faces');
assert.equal(liveSideWall.couplingContract.outerEdgeShared, true, 'live sidewall shares the promoted body outer edge');
assert.equal(liveSideWall.couplingContract.innerEdgeGenerated, true, 'live sidewall generates an inner thickness edge');

const oppositeLiveSideWall = fixture.liveMacroSideWallPlan.sideWalls.find(wall => wall.parentAssemblage === 'north-west-dominant-thrust' && wall.targetEdge === 'right-promoted-body-edge');
assert.equal(oppositeLiveSideWall?.schema, 'LiveMacroSideWall', 'north-west promoted body has an opposite live sidewall record');
assert.equal(oppositeLiveSideWall.materialMode, 'flat-low-shader-readable-thickness', 'opposite live sidewall uses low-shader readable material');
assert.ok(oppositeLiveSideWall.polygonFaceCount >= 40, 'opposite live sidewall records real polygon side faces');

const equator = plan.promotedBodies.find(body => body.parentAssemblage === 'equatorial-cupping-whorl');
const crossing = plan.promotedBodies.find(body => body.parentAssemblage === 'north-east-counter-thrust');

assert.equal(equator?.lowerCupClosure?.mode, 'lower-cup-socket-contiguous', 'equatorial cup records contiguous lower closure');
assert.equal(equator.lowerCupClosure.bottomGapPolicy, 'forbid-accidental-triangle-bottom-gap', 'equatorial cup forbids the triangular bottom gap');
assert.ok(equator.lowerCupClosure.joins.includes('lower-socket-anchor'), 'lower cup joins lower socket anchor');
assert.ok(equator.closureContracts.some(contract => contract.kind === 'lower-socket-join'), 'equatorial cup records lower socket join contract');

assert.equal(crossing?.crossingTuckIntegration?.mode, 'crossing-tuck-macro-body', 'crossing owner belongs to a macro body');
assert.equal(crossing.crossingTuckIntegration.railRole, 'subordinate-ridge-not-lone-wand', 'crossing rail is subordinate anatomy');
assert.ok(crossing.crossingTuckIntegration.ownerRole === 'crossing-tuck-owner', 'crossing integration names the front aperture owner role');

assert.equal(fixture.frontApertureOwnership.lowerCupClosure.mode, 'lower-cup-socket-contiguous', 'front frame exposes lower cup closure');
assert.equal(fixture.frontApertureOwnership.crossingTuckIntegration.mode, 'crossing-tuck-macro-body', 'front frame exposes crossing tuck integration');
