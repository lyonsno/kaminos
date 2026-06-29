import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');

assert.match(core, /LowerSocketKeelAnatomyLaw/, 'composition core must name LowerSocketKeelAnatomyLaw');
assert.match(core, /lowerSocketKeelAnatomyLaw/, 'composition debug state must expose lower socket anatomy law');
assert.match(core, /lowerSocketAnatomyEffectAt/, 'promoted body geometry must route through lower socket anatomy effects');
assert.match(witness, /LowerSocketKeelAnatomyLaw/, 'browser witness report must preserve lower socket anatomy law evidence');

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
assert.equal(lowerSocket.lowerSocketKeelAnatomyLaw?.schema, 'LowerSocketKeelAnatomyLaw', 'lower socket macro carries anatomy law');
assert.equal(lowerSocket.macroPromotedBody?.lowerSocketKeelAnatomyLaw?.schema, 'LowerSocketKeelAnatomyLaw', 'promoted lower socket body carries anatomy law');
assert.equal(lowerSocket.macroPromotedBody?.terminationDecision?.schema, 'LowerSocketTerminationDecision', 'lower socket promoted body carries termination decision');
assert.equal(lowerSocket.macroPromotedBody.terminationDecision.decisionClass, 'cut-before-neighbor-socket-cap', 'lower socket terminates by cutting/capping before neighbor, not by an arbitrary foot');
assert.ok(lowerSocket.macroPromotedBody.lowerSocketKeelAnatomyLaw.forbiddenFailureClasses.includes('chopped-proxy-foot'), 'anatomy law forbids chopped proxy foot');
assert.ok(lowerSocket.macroPromotedBody.lowerSocketKeelAnatomyLaw.forbiddenFailureClasses.includes('multi-slab-side-return'), 'anatomy law forbids multi-slab side return');
assert.ok(lowerSocket.macroPromotedBody.lowerSocketKeelAnatomyLaw.requiredAnatomy.includes('single-lower-socket-body'), 'anatomy law requires one primary lower socket body');
assert.ok(lowerSocket.macroPromotedBody.subordinateAnatomy.includes('side-return-lip-as-subordinate-anatomy'), 'side return becomes subordinate anatomy instead of a competing slab');
assert.equal(lowerSocket.macroPromotedBody.sideSilhouettePolicy.mode, 'lower-socket-tuck-tongue-smooth-side-return-v0', 'lower socket side silhouette policy is specialized by the tuck tongue role law');
assert.equal(lowerSocket.macroPromotedBody.sideSilhouettePolicy.boundaryCutProfileVisible, false, 'lower socket keeps boundary cuts out of the macro silhouette');
assert.ok(lowerSocket.macroPromotedBody.sideSilhouettePolicy.terminalWidthScale <= 0.42, 'lower socket terminal width narrows enough to avoid the rectangular foot failure');
assert.ok(lowerSocket.macroPromotedBody.promotedBodyScale <= 1.08, 'lower socket promoted body scale is constrained by anatomy law');

assert.equal(fiveMacro.lowerSocketKeelAnatomyLaw?.schema, 'LowerSocketKeelAnatomyLaw', 'composition exposes selected lower socket anatomy law');
assert.equal(fiveMacro.lowerSocketKeelAnatomyVerdict, 'procedural-lower-socket-anatomy-law-applied', 'composition records applied lower socket anatomy verdict');
assert.ok(
  fiveMacro.macroContactMap.geometryCoherenceWatch.some(item => (
    item.macroId === 'lower-socket-keel'
    && item.diagnosticPolicy === 'trust-after-lower-socket-family-role-law'
    && item.selectedRole === 'tuck-tongue'
  )),
  'contact-map geometry watch should know lower socket anatomy is now governed by the tuck tongue role law rather than raw proxy geometry',
);

const alternateLowerSocket = alternateFiveMacro.macroAssemblages.find(item => item.id === 'lower-socket-keel');
assert.equal(alternateLowerSocket?.lowerSocketKeelAnatomyLaw?.schema, 'LowerSocketKeelAnatomyLaw', 'lower socket anatomy law applies across selected variants, not just seed 6');

assert.equal(
  baseline.macroAssemblages.some(item => item.id === 'lower-socket-keel'),
  false,
  'baseline keeps lower socket retired',
);
assert.equal(
  baseline.lowerSocketKeelAnatomyLaw,
  null,
  'composition must not expose live lower socket anatomy law when lower socket is retired',
);
