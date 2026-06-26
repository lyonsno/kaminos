import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');

assert.match(core, /ChannelThroughLineAudit/, 'composition module names ChannelThroughLineAudit descriptors');
assert.match(core, /channel-through-line-audit-v0/, 'composition module names channel through-line audit mode');
assert.match(core, /gapSamples/, 'composition records channel gap samples');
assert.match(core, /constantGapVerdict/, 'composition records constant-gap verdict');
assert.match(core, /sharedParentSpine/, 'composition distinguishes shared parent spine channels');
assert.match(core, /hardcoded-seam-hint/, 'composition distinguishes hardcoded seam hints');
assert.match(witness, /ChannelThroughLineAudit/, 'composition witness records channel through-line audit');
assert.match(witness, /channelAuditVerdict/, 'composition witness reports channel audit verdict');

const { createTargetOrbShellCompositionFixture } = await import('../orb-shell-composition-core.js');

const fixture = createTargetOrbShellCompositionFixture({ variantId: 'wide-cup', variationSeed: 7 });
const audit = fixture.channelThroughLineAudit;

assert.equal(audit?.schema, 'ChannelThroughLineAudit', 'fixture exposes channel through-line audit');
assert.equal(audit.mode, 'channel-through-line-audit-v0', 'fixture records channel audit mode');
assert.equal(audit.constantGapVerdict, 'not-yet-proven', 'current fixture must not claim solved constant-gap channels');
assert.ok(audit.channelCandidates.length >= 2, 'audit records at least two visible channel candidates');

const northEastRail = audit.channelCandidates.find(candidate => candidate.id === 'north-east-counter-thrust-ne-support-visible-rail');
assert.equal(northEastRail?.sourceKind, 'BandMember', 'north-east visible rail is a BandMember channel candidate');
assert.equal(northEastRail.parentAssemblage, 'north-east-counter-thrust', 'north-east rail belongs to the north-east macro');
assert.equal(northEastRail.sharedParentSpine, true, 'north-east rail shares the parent macro spine');
assert.ok(northEastRail.gapSamples.length >= 5, 'north-east rail records gap samples against the body');
assert.equal(typeof northEastRail.gapDistanceStats.mean, 'number', 'north-east rail records mean gap distance');
assert.equal(typeof northEastRail.gapDistanceStats.variation, 'number', 'north-east rail records gap variation');

const sideRimReveal = audit.channelCandidates.find(candidate => candidate.id === 'right-side-rim-reveal-gap');
assert.equal(sideRimReveal?.sourceKind, 'MacroRegionSeamGapDescriptor', 'right-side reveal is a seam/gap channel candidate');
assert.equal(sideRimReveal.generationPath, 'hardcoded-seam-hint', 'right-side reveal is currently hardcoded seam hint geometry');
assert.equal(sideRimReveal.sharedParentSpine, false, 'right-side reveal is not proven to share the parent macro spine');

assert.ok(
  audit.requiredBeforeMeshing.includes('ChannelThroughLineDescriptor'),
  'audit says a real channel descriptor is required before meshing treats channels as solved',
);
