import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');

assert.match(core, /ChannelThroughLineDescriptor/, 'composition module names ChannelThroughLineDescriptor records');
assert.match(core, /channel-through-line-descriptor-v0/, 'composition module names channel descriptor mode');
assert.match(core, /pairedEdgeSamples/, 'channel descriptors record paired edge samples');
assert.match(core, /constantGapBudget/, 'channel descriptors record a constant-gap budget');
assert.match(core, /surfaceAttachment/, 'channel descriptors record surface attachment');
assert.match(core, /unsolved-hardcoded-seam-hint/, 'hardcoded seam hints are explicitly unsolved');
assert.match(witness, /ChannelThroughLineDescriptor/, 'composition witness records channel through-line descriptors');
assert.match(witness, /channelThroughLineDescriptorCount/, 'composition witness reports channel descriptor count');
assert.match(witness, /channelCorridorVerdict/, 'composition witness reports channel corridor verdict');

const { createTargetOrbShellCompositionFixture } = await import('../orb-shell-composition-core.js');

const fixture = createTargetOrbShellCompositionFixture({ variantId: 'wide-cup', variationSeed: 7 });
const plan = fixture.channelThroughLinePlan;

assert.equal(plan?.schema, 'ChannelThroughLinePlan', 'fixture exposes channel through-line plan');
assert.equal(plan.mode, 'channel-through-line-descriptor-v0', 'fixture records channel descriptor mode');
assert.ok(plan.descriptors.length >= 2, 'plan records solved and unsolved channel descriptors');

const northEast = plan.descriptors.find(descriptor => descriptor.id === 'north-east-counter-thrust-ne-support-channel-through-line');
assert.equal(northEast?.schema, 'ChannelThroughLineDescriptor', 'north-east channel uses descriptor schema');
assert.equal(northEast.sourceCandidateId, 'north-east-counter-thrust-ne-support-visible-rail', 'north-east descriptor references audited candidate');
assert.equal(northEast.parentAssemblage, 'north-east-counter-thrust', 'north-east descriptor belongs to north-east macro');
assert.equal(northEast.generationPath, 'paired-edge-sampled-from-shared-parent-spine', 'north-east descriptor samples paired edges from shared spine');
assert.equal(northEast.surfaceAttachment, 'expanded-region-proxy-surface', 'north-east descriptor attaches to expanded proxy surface');
assert.equal(northEast.constantGapBudget.target, 0.12, 'north-east descriptor records target gap');
assert.equal(northEast.constantGapBudget.tolerance, 0.018, 'north-east descriptor records gap tolerance');
assert.ok(northEast.pairedEdgeSamples.length >= 8, 'north-east descriptor records paired edge samples');
assert.ok(
  northEast.pairedEdgeSamples.every(sample => typeof sample.leftEdge?.[0] === 'number' && typeof sample.rightEdge?.[0] === 'number'),
  'north-east descriptor stores numeric paired edges',
);
assert.equal(typeof northEast.gapDistanceStats.mean, 'number', 'north-east descriptor records measured gap mean');
assert.ok(['within-budget', 'outside-budget'].includes(northEast.constantGapVerdict), 'north-east descriptor records budget verdict');

const sideReveal = plan.descriptors.find(descriptor => descriptor.id === 'right-side-rim-reveal-gap-channel-through-line');
assert.equal(sideReveal?.schema, 'ChannelThroughLineDescriptor', 'side reveal uses descriptor schema');
assert.equal(sideReveal.sourceCandidateId, 'right-side-rim-reveal-gap', 'side reveal references audited seam hint');
assert.equal(sideReveal.generationPath, 'unsolved-hardcoded-seam-hint', 'side reveal remains marked unsolved');
assert.equal(sideReveal.constantGapVerdict, 'not-applicable-hardcoded-hint', 'side reveal does not claim constant-gap status');
assert.equal(sideReveal.solvedForMeshing, false, 'side reveal is not counted as solved for meshing');

assert.ok(
  fixture.channelThroughLineAudit.requiredBeforeMeshing.includes('constant-gap-distance-budget-satisfied-or-explicitly-unsolved'),
  'audit now requires satisfied budget or explicit unsolved status before meshing',
);
