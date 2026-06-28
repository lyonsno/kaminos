import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');

assert.match(core, /MacroInterlockGraph/, 'composition core must name MacroInterlockGraph');
assert.match(core, /macroInterlockGraph/, 'composition debug state must expose macro interlock graph');
assert.match(witness, /MacroInterlockGraph/, 'browser witness report must preserve macro interlock graph evidence');

const { createTargetOrbShellCompositionFixture } = await import('../orb-shell-composition-core.js');

const baseline = createTargetOrbShellCompositionFixture({
  variantId: 'wide-cup',
  variationSeed: 7,
  variationLeafCount: 10,
});
const fiveMacro = createTargetOrbShellCompositionFixture({
  variantId: 'wide-cup',
  variationSeed: 6,
  variationLeafCount: 11,
});
const threeMacro = createTargetOrbShellCompositionFixture({
  variantId: 'wide-cup',
  variationSeed: 10,
  variationLeafCount: 14,
});

assert.equal(fiveMacro.macroInterlockGraph?.schema, 'MacroInterlockGraph', 'five-macro variant exposes interlock graph');
assert.equal(fiveMacro.macroInterlockGraph.activeRelations.length >= 1, true, 'five-macro variant activates at least one interlock relation');
assert.ok(
  fiveMacro.macroInterlockGraph.activeRelations.some(relation => (
    relation.sourceMacroId === 'lower-socket-keel'
    && relation.targetMacroId === 'equatorial-cupping-whorl'
    && relation.relationType === 'socket-tuck-under'
  )),
  'five-macro variant must tuck lower socket support under the equatorial cup',
);

const lowerSocket = fiveMacro.macroAssemblages.find(item => item.id === 'lower-socket-keel');
assert.ok(lowerSocket, 'five-macro variant includes lower socket keel');
assert.ok(lowerSocket.macroInterlockEffects?.some(effect => effect.relationType === 'socket-tuck-under'), 'lower socket keel carries active interlock geometry effects');
const lowerSocketTuck = lowerSocket.macroInterlockEffects.find(effect => effect.relationType === 'socket-tuck-under');
assert.ok(lowerSocketTuck.depthInset >= 0.04, 'lower socket tuck must create a visible radial/depth inset');
assert.ok(lowerSocketTuck.widthScale < 1, 'lower socket tuck must narrow the tucked interval instead of only labeling it');

assert.equal(fiveMacro.macroInterlockGraph.visibleEffectCount, fiveMacro.macroInterlockGraph.activeRelations.length, 'interlock graph accounts for visible effects');
assert.ok(fiveMacro.macroInterlockGraph.interlockAffectedMacroIds.includes('lower-socket-keel'), 'interlock graph names affected lower socket macro');
assert.ok(
  fiveMacro.liveMacroSideWallPlan.interlockAffectedSideWallCount >= 2,
  'live sidewall plan must account for interlock-affected lower socket sidewalls',
);

assert.equal(baseline.macroAssemblages.some(item => item.id === 'lower-socket-keel'), false, 'baseline keeps lower socket retired');
assert.equal(
  baseline.macroInterlockGraph.activeRelations.some(relation => relation.sourceMacroId === 'lower-socket-keel'),
  false,
  'baseline must not carry a live lower socket interlock relation',
);
assert.equal(
  threeMacro.macroInterlockGraph.activeRelations.some(relation => (
    relation.sourceMacroId === 'lower-socket-keel'
    || relation.targetMacroId === 'equatorial-cupping-whorl'
  )),
  false,
  'three-macro sparse variant must not activate relations involving retired lower/equatorial structures',
);
