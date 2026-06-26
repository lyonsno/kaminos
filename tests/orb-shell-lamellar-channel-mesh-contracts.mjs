import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');

assert.match(core, /LamellarChannelMeshPlan/, 'composition module names LamellarChannelMeshPlan records');
assert.match(core, /LamellarChannelStripMesh/, 'composition module names LamellarChannelStripMesh records');
assert.match(core, /flat-lamellar-channel-strip-v0/, 'composition module names flat lamellar channel strip mode');
assert.match(core, /roundDiagnosticRailFinalVisible/, 'mesh plan explicitly reports whether round rails remain final-visible');
assert.match(core, /makeLamellarChannelStripGeometry/, 'composition module renders flat channel strip geometry');
assert.match(witness, /LamellarChannelMeshPlan/, 'composition witness reports lamellar channel mesh plan');
assert.match(witness, /lamellarChannelStripMeshCount/, 'composition witness reports flat strip mesh count');

const { createTargetOrbShellCompositionFixture } = await import('../orb-shell-composition-core.js');

const fixture = createTargetOrbShellCompositionFixture({ variantId: 'wide-cup', variationSeed: 7 });
const plan = fixture.lamellarChannelMeshPlan;

assert.equal(plan?.schema, 'LamellarChannelMeshPlan', 'fixture exposes lamellar channel mesh plan');
assert.equal(plan.mode, 'flat-lamellar-channel-strip-v0', 'mesh plan uses flat lamellar channel strip mode');
assert.ok(plan.stripMeshes.length >= 1, 'mesh plan exposes at least one flat strip mesh');
assert.equal(plan.roundDiagnosticRailFinalVisible, false, 'round diagnostic rails are not final channel geometry');
assert.equal(plan.meshVerdict, 'first-channel-flat-strip-mesh-scaffolded', 'mesh plan reports first flat strip scaffold verdict');

const northEast = plan.stripMeshes.find(strip => strip.sourceDescriptorId === 'north-east-counter-thrust-ne-support-channel-through-line');
assert.equal(northEast?.schema, 'LamellarChannelStripMesh', 'north-east channel is promoted to a strip mesh record');
assert.equal(northEast.mode, 'flat-lamellar-channel-strip-v0', 'north-east strip mesh uses flat mesh mode');
assert.equal(northEast.replacesRoundBandId, 'ne-support', 'north-east strip records the round rail it replaces');
assert.equal(northEast.finalGeometryKind, 'flat-shell-conforming-lamellar-strip', 'north-east strip is not a tube');
assert.equal(northEast.crossSection, 'flat-ribbon-not-round-tube', 'north-east strip records flat cross-section');
assert.equal(northEast.sourceDescriptorId, 'north-east-counter-thrust-ne-support-channel-through-line', 'north-east strip references channel descriptor');
assert.equal(northEast.constantGapVerdict, 'outside-budget', 'north-east strip preserves unsolved source verdict');
assert.equal(northEast.solvedForMeshing, false, 'north-east strip does not claim final solved meshing');
assert.ok(northEast.widthBudget.target > northEast.thicknessBudget.target * 4, 'strip is materially wider than thick');
assert.ok(northEast.edgeSamples.length >= 8, 'strip carries sampled paired edges');
assert.ok(
  northEast.edgeSamples.every(sample => typeof sample.leftEdge?.[0] === 'number' && typeof sample.rightEdge?.[0] === 'number'),
  'strip edge samples preserve numeric paired edges',
);

const sideReveal = plan.unsolvedChannelDescriptors.find(descriptor => descriptor.sourceDescriptorId === 'right-side-rim-reveal-gap-channel-through-line');
assert.equal(sideReveal?.reason, 'no-paired-edge-samples', 'side reveal remains unsolved until generated corridor geometry exists');
