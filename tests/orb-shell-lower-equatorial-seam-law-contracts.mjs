import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');

assert.match(core, /LowerSocketEquatorialSocketJointLaw/, 'composition core must name the shared lower/equatorial socket joint law');
assert.match(core, /lowerSocketEquatorialSocketJointLaw/, 'composition debug state must expose the shared socket joint law');
assert.match(core, /sharedSocketSeamEffectAt/, 'geometry sampling must route through shared socket seam effects');
assert.match(witness, /LowerSocketEquatorialSocketJointLaw/, 'browser witness report must preserve shared socket joint law evidence');

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

assert.equal(
  fiveMacro.lowerSocketEquatorialSocketJointLaw?.schema,
  'LowerSocketEquatorialSocketJointLaw',
  'five-macro stress case exposes a shared lower/equatorial socket joint law',
);
assert.equal(
  fiveMacro.lowerSocketEquatorialSocketJointLaw.relationship,
  'lower-socket-tucks-under-equatorial-lip',
  'joint law chooses a concrete tuck/lip ownership relation',
);
assert.equal(
  fiveMacro.lowerSocketEquatorialSocketJointLaw.sourceMacroId,
  'lower-socket-keel',
  'joint law names lower socket as the tucking source',
);
assert.equal(
  fiveMacro.lowerSocketEquatorialSocketJointLaw.targetMacroId,
  'equatorial-cupping-whorl',
  'joint law names equatorial cup as the lip-owning target',
);
assert.ok(
  fiveMacro.lowerSocketEquatorialSocketJointLaw.sharedSeam?.samples?.length >= 7,
  'joint law carries sampled shared seam points, not only a label',
);
assert.ok(
  fiveMacro.lowerSocketEquatorialSocketJointLaw.sourceBehavior?.includes('terminate-into-shared-seam'),
  'lower socket termination must derive from the shared seam',
);
assert.ok(
  fiveMacro.lowerSocketEquatorialSocketJointLaw.targetBehavior?.includes('grow-equatorial-lip-over-seam'),
  'equatorial cup must derive a visible lip/ownership behavior from the shared seam',
);
assert.equal(
  fiveMacro.lowerSocketEquatorialSocketJointLaw.gapPolicy?.mode,
  'constant-ish-seam-clearance',
  'joint law must declare a seam gap/clearance policy',
);

const lowerSocket = fiveMacro.macroAssemblages.find(item => item.id === 'lower-socket-keel');
const equatorial = fiveMacro.macroAssemblages.find(item => item.id === 'equatorial-cupping-whorl');
assert.ok(lowerSocket?.sharedSocketSeamEffects?.some(effect => (
  effect.role === 'tucking-source'
  && effect.jointLawId === fiveMacro.lowerSocketEquatorialSocketJointLaw.id
)), 'lower socket carries source-side shared seam effects');
assert.ok(equatorial?.sharedSocketSeamEffects?.some(effect => (
  effect.role === 'lip-owning-target'
  && effect.jointLawId === fiveMacro.lowerSocketEquatorialSocketJointLaw.id
)), 'equatorial cup carries target-side shared seam effects');

const contact = fiveMacro.macroContactMap.contacts.find(item => (
  [item.sourceMacroId, item.targetMacroId].includes('lower-socket-keel')
  && [item.sourceMacroId, item.targetMacroId].includes('equatorial-cupping-whorl')
));
assert.equal(
  contact?.sharedSocketJointLawId,
  fiveMacro.lowerSocketEquatorialSocketJointLaw.id,
  'contact sample links the measured lower/equatorial pressure back to the shared seam law',
);
assert.ok(
  contact?.diagnosisTags.includes('shared-socket-seam-law'),
  'contact sample tags shared socket seam law evidence instead of only a one-sided interlock',
);

assert.equal(
  baseline.lowerSocketEquatorialSocketJointLaw,
  null,
  'baseline must not expose a live lower/equatorial seam when lower socket is retired',
);
assert.equal(
  threeMacro.lowerSocketEquatorialSocketJointLaw,
  null,
  'sparse variant must not expose a live lower/equatorial seam when lower/equatorial macros are retired',
);
