import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');

assert.match(core, /LowerSocketFamilyRoleLaw/, 'composition core must name LowerSocketFamilyRoleLaw');
assert.match(core, /lowerSocketFamilyRoleLaw/, 'composition debug state must expose lower socket family role law');
assert.match(core, /lowerSocketFamilyRoleEffectAt/, 'geometry sampling must route through lower socket role effects');
assert.match(witness, /LowerSocketFamilyRoleLaw/, 'browser witness report must preserve lower socket family role law evidence');

const { createTargetOrbShellCompositionFixture } = await import('../orb-shell-composition-core.js');

const fiveMacro = createTargetOrbShellCompositionFixture({
  variantId: 'wide-cup',
  variationSeed: 6,
  variationLeafCount: 11,
});
const alternateFiveMacro = createTargetOrbShellCompositionFixture({
  variantId: 'left-heavy-rim',
  variationSeed: 12,
  variationLeafCount: 11,
});
const baseline = createTargetOrbShellCompositionFixture({
  variantId: 'wide-cup',
  variationSeed: 7,
  variationLeafCount: 10,
});

const lowerSocket = fiveMacro.macroAssemblages.find(item => item.id === 'lower-socket-keel');
assert.ok(lowerSocket, 'five-macro stress case includes lower socket keel');

assert.equal(
  fiveMacro.lowerSocketFamilyRoleLaw?.schema,
  'LowerSocketFamilyRoleLaw',
  'five-macro stress case exposes the lower socket family role law',
);
assert.equal(
  fiveMacro.lowerSocketFamilyRoleLaw.selectedRole,
  'tuck-tongue',
  'Tuck Tongue First classifies the stress family as subordinate tuck anatomy',
);
assert.equal(
  fiveMacro.lowerSocketFamilyRoleLaw.visibleAuthority,
  'subordinate-socket-insert',
  'lower socket family must not claim full macro authority while short and subordinate',
);
assert.ok(
  fiveMacro.lowerSocketFamilyRoleLaw.forbiddenFailureClasses.includes('crimped-independent-foot'),
  'role law forbids the observed crimped independent foot failure',
);
assert.ok(
  fiveMacro.lowerSocketFamilyRoleLaw.forbiddenFailureClasses.includes('short-macro-pretender'),
  'role law forbids a short visible family pretending to be a full macro body',
);
assert.ok(
  fiveMacro.lowerSocketFamilyRoleLaw.requiredRelations.includes('lower-socket-tucks-under-equatorial-lip'),
  'tuck tongue role is tied to the lower/equatorial shared seam relation',
);
assert.equal(
  fiveMacro.lowerSocketFamilyRoleLaw.verdict,
  'tuck-tongue-role-law-applied',
  'composition records the applied tuck-tongue role verdict',
);
assert.equal(
  fiveMacro.lowerSocketFamilyRoleLaw.tuckTongueRefinement?.schema,
  'LowerSocketTuckTongueRefinementContract',
  'role law carries the post-smoke tuck tongue refinement contract',
);
assert.ok(
  fiveMacro.lowerSocketFamilyRoleLaw.tuckTongueRefinement.visibleArcLimitT <= 0.52,
  'tuck tongue refinement limits how long the lower socket family may read as independently visible',
);
assert.ok(
  fiveMacro.lowerSocketFamilyRoleLaw.tuckTongueRefinement.visibleArcLimitT <= 0.38,
  'post-smoke tuck tongue refinement keeps the lower socket insert short enough to avoid appendage read',
);
assert.ok(
  fiveMacro.lowerSocketFamilyRoleLaw.tuckTongueRefinement.maxLateralWander <= 0.11,
  'tuck tongue refinement forbids the lower socket insert from wandering into a dangling side limb',
);
assert.equal(
  fiveMacro.lowerSocketFamilyRoleLaw.tuckTongueRefinement.terminalBehavior,
  'persist-terminal-absorption-through-mesh-end',
  'terminal role effect must persist through the mesh end instead of fading out before the tail',
);
assert.equal(
  fiveMacro.lowerSocketFamilyRoleLaw.tuckTongueRefinement.terminalCapAuthority,
  'hidden-under-shared-socket-seam',
  'tuck tongue refinement demotes terminal caps so they do not grant independent macro objecthood',
);
assert.ok(
  fiveMacro.lowerSocketFamilyRoleLaw.geometryEffect.interval.t1 >= 0.98,
  'tuck tongue role effect persists through the terminal mesh rows',
);
assert.ok(
  fiveMacro.lowerSocketFamilyRoleLaw.geometryEffect.terminalAbsorbStartT <= 0.48,
  'tuck tongue absorption starts early enough to avoid a long visible bent appendage',
);
assert.ok(
  fiveMacro.lowerSocketFamilyRoleLaw.geometryEffect.terminalAbsorbStartT <= 0.34,
  'post-smoke tuck tongue absorption starts before the body can become a visible side limb',
);
assert.ok(
  fiveMacro.lowerSocketFamilyRoleLaw.geometryEffect.terminalWidthScale <= 0.08,
  'terminal rows collapse to a seam-bound tongue rather than recovering full width',
);
assert.ok(
  fiveMacro.lowerSocketFamilyRoleLaw.geometryEffect.socketAlignmentPull >= 0.62,
  'tuck tongue geometry declares a strong pull toward the lower/equatorial socket seam',
);
assert.ok(
  fiveMacro.lowerSocketFamilyRoleLaw.geometryEffect.socketAlignmentPull >= 0.82,
  'post-smoke tuck tongue geometry aggressively damps lateral wander into the socket seam',
);

assert.equal(
  lowerSocket.lowerSocketFamilyRoleLaw?.schema,
  'LowerSocketFamilyRoleLaw',
  'lower socket macro carries the family role law',
);
assert.equal(
  lowerSocket.macroPromotedBody?.lowerSocketFamilyRoleLaw?.schema,
  'LowerSocketFamilyRoleLaw',
  'promoted lower socket body carries the family role law',
);
assert.equal(
  lowerSocket.macroPromotedBody?.familyRoleDecision?.role,
  'tuck-tongue',
  'promoted lower socket body carries a tuck tongue role decision',
);
assert.equal(
  lowerSocket.macroPromotedBody?.visibleAuthority,
  'subordinate-socket-insert',
  'promoted lower socket body is demoted from full macro authority',
);
assert.ok(
  lowerSocket.lowerSocketFamilyRoleEffects?.some(effect => (
    effect.role === 'tuck-tongue'
    && effect.geometryContract === 'smooth-single-direction-socket-taper'
  )),
  'lower socket carries geometry effects for a smooth single-direction tuck tongue',
);
assert.ok(
  lowerSocket.macroPromotedBody.promotedBodyScale <= 0.84,
  'tuck tongue role keeps the lower socket narrower than a full macro body',
);
assert.ok(
  lowerSocket.macroPromotedBody.promotedBodyScale <= 0.56,
  'post-smoke tuck tongue role demotes the lower socket below small-macro objecthood',
);
assert.equal(
  lowerSocket.macroPromotedBody.sideSilhouettePolicy.mode,
  'lower-socket-tuck-tongue-smooth-side-return-v0',
  'side silhouette policy names the tuck tongue role instead of only generic lower-socket smoothing',
);
assert.equal(
  lowerSocket.macroPromotedBody.sideSilhouettePolicy.terminalBehavior,
  'persist-terminal-absorption-through-mesh-end',
  'promoted lower socket side silhouette keeps terminal absorption active through the tail rows',
);
assert.ok(
  lowerSocket.macroPromotedBody.sideSilhouettePolicy.visibleArcLimitT <= 0.52,
  'promoted lower socket side silhouette has a bounded visible arc for the subordinate tuck tongue',
);
assert.ok(
  lowerSocket.macroPromotedBody.sideSilhouettePolicy.maxLateralWander <= 0.11,
  'promoted lower socket side silhouette exposes the lateral wander clamp',
);

const lowerSocketTerminalCaps = fiveMacro.liveMacroSideWallPlan.terminalCaps.filter(cap => cap.parentAssemblage === 'lower-socket-keel');
assert.equal(
  lowerSocketTerminalCaps.length,
  2,
  'lower socket still keeps topology cap records even when normal render demotes their authority',
);
assert.ok(
  lowerSocketTerminalCaps.every(cap => cap.normalRenderVisible === false),
  'lower socket tuck terminal caps are hidden in normal render instead of reading as independent object ends',
);
assert.ok(
  lowerSocketTerminalCaps.every(cap => cap.capAuthority === 'hidden-under-shared-socket-seam'),
  'lower socket tuck terminal caps carry the hidden seam authority',
);
assert.deepEqual(
  fiveMacro.liveMacroSideWallPlan.normalRenderHiddenTerminalCapIds.filter(id => id.startsWith('lower-socket-keel-')).sort(),
  lowerSocketTerminalCaps.map(cap => cap.id).sort(),
  'sidewall plan accounts for hidden lower socket terminal caps before rendering',
);

const lowerEquatorialContact = fiveMacro.macroContactMap.contacts.find(item => (
  [item.sourceMacroId, item.targetMacroId].includes('lower-socket-keel')
  && [item.sourceMacroId, item.targetMacroId].includes('equatorial-cupping-whorl')
));
assert.ok(
  lowerEquatorialContact?.diagnosisTags.includes('tuck-tongue-role-law'),
  'contact map tags lower/equatorial pressure as governed by the tuck tongue role law',
);

const alternateLowerSocket = alternateFiveMacro.macroAssemblages.find(item => item.id === 'lower-socket-keel');
assert.equal(
  alternateLowerSocket?.lowerSocketFamilyRoleLaw?.selectedRole,
  'tuck-tongue',
  'role law applies across selected lower-socket variants, not just seed 6',
);

assert.equal(
  baseline.lowerSocketFamilyRoleLaw,
  null,
  'baseline must not expose a stale lower socket role law when lower socket is retired',
);
