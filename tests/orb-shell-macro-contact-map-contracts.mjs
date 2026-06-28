import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');

assert.match(core, /MacroContactMap/, 'composition core must name MacroContactMap');
assert.match(core, /macroContactMap/, 'composition debug state must expose macro contact map');
assert.match(witness, /MacroContactMap/, 'browser witness report must preserve macro contact map evidence');
assert.match(witness, /macro-contact-map/, 'browser witness must expose a macro contact-map focus');
assert.match(witness, /MacroContactMapWitnessState/, 'browser witness must report macro contact-map overlay activation');

const { createTargetOrbShellCompositionFixture } = await import('../orb-shell-composition-core.js');

const fiveMacro = createTargetOrbShellCompositionFixture({
  variantId: 'wide-cup',
  variationSeed: 6,
  variationLeafCount: 11,
});
const baseline = createTargetOrbShellCompositionFixture({
  variantId: 'wide-cup',
  variationSeed: 7,
  variationLeafCount: 10,
});
const threeMacro = createTargetOrbShellCompositionFixture({
  variantId: 'wide-cup',
  variationSeed: 10,
  variationLeafCount: 14,
});

assert.equal(fiveMacro.macroContactMap?.schema, 'MacroContactMap', 'five-macro variant exposes contact map');
assert.equal(fiveMacro.macroContactMap?.sourceMacroAssemblageCount, fiveMacro.macroAssemblages.length, 'contact map records live macro count');
assert.ok(fiveMacro.macroContactMap?.contacts?.length >= 10, 'five-macro variant records every unordered macro pair');
assert.ok(fiveMacro.macroContactMap?.rankedContacts?.length >= 4, 'contact map ranks closest macro pairs for diagnosis');
assert.ok(
  fiveMacro.macroContactMap.contacts.every(contact => (
    contact.schema === 'MacroContactSample'
    && contact.sourceMacroId
    && contact.targetMacroId
    && Number.isFinite(contact.closestApproach?.distance)
    && Number.isFinite(contact.closestApproach?.sourceT)
    && Number.isFinite(contact.closestApproach?.targetT)
    && Array.isArray(contact.closestApproach?.sourcePoint)
    && Array.isArray(contact.closestApproach?.targetPoint)
    && ['clear', 'near', 'intersecting', 'unproven'].includes(contact.clearanceVerdict)
  )),
  'each macro contact sample must carry closest points, parameter locations, and a clearance verdict',
);

const lowerEquatorialContact = fiveMacro.macroContactMap.contacts.find(contact => (
  [contact.sourceMacroId, contact.targetMacroId].includes('lower-socket-keel')
  && [contact.sourceMacroId, contact.targetMacroId].includes('equatorial-cupping-whorl')
));
assert.ok(lowerEquatorialContact, 'five-macro contact map must measure lower socket versus equatorial cup');
assert.equal(lowerEquatorialContact.intendedPrecedenceRelationId, 'lower-socket-keel-under-equatorial-cupping-whorl', 'known interlock relation must be linked to its contact sample');
assert.ok(lowerEquatorialContact.clearanceRadius > 0, 'known contact must declare a clearance radius');
assert.ok(lowerEquatorialContact.diagnosisTags.includes('known-interlock-relation'), 'known contact must be tagged as an interlock relation');

assert.ok(
  fiveMacro.macroContactMap.contacts.some(contact => (
    [contact.sourceMacroId, contact.targetMacroId].includes('north-east-counter-thrust')
    && contact.diagnosisTags.includes('upper-stack-watch')
  )),
  'contact map must flag upper/right stack candidates instead of only the lower socket relation',
);

assert.ok(
  fiveMacro.macroContactMap.geometryCoherenceWatch.length >= 1,
  'contact map must preserve malformed-plate/coherence watch items when diagnostic trust is limited',
);
assert.ok(
  fiveMacro.macroContactMap.failurePressure.includes('pretty-overlap-without-measured-clearance'),
  'contact map must name overlap-without-clearance as a failure pressure',
);

assert.equal(
  baseline.macroContactMap.contacts.some(contact => (
    contact.sourceMacroId === 'lower-socket-keel'
    || contact.targetMacroId === 'lower-socket-keel'
  )),
  false,
  'baseline contact map must not include retired lower socket geometry',
);
assert.equal(
  threeMacro.macroContactMap.contacts.some(contact => (
    [contact.sourceMacroId, contact.targetMacroId].includes('equatorial-cupping-whorl')
    || [contact.sourceMacroId, contact.targetMacroId].includes('lower-socket-keel')
  )),
  false,
  'three-macro sparse contact map must not include retired equatorial/lower macro structures',
);
