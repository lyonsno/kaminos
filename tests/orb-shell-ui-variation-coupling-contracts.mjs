import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const index = readFileSync(join(root, 'index.html'), 'utf8');
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');

assert.match(index, /function readOrbShellCompositionControls\(\)/, 'index must expose a composition-specific control reader');
assert.match(index, /orb-shell-ui-seed-leaves-coupled-to-composition-variation/, 'composition control reader must stamp a stable UI coupling source');
assert.match(index, /orbShellCompositionWitness\.setVariation\(readOrbShellCompositionControls\(\)\)/, 'UI seed/leaves changes must update composition variation');
assert.match(index, /params\.has\('orb_shell_variation_seed'\)[\s\S]+orb-shell-seed/, 'variation seed URL param must hydrate the visible seed control');
assert.match(index, /orb-shell-composition-variant[\s\S]+variationLeafCount/, 'visible composition readout must expose seed plus leaf pressure');

assert.match(core, /variationLeafCount/, 'composition core must carry variation leaf count through the descriptor');
assert.match(core, /uiControlSource/, 'composition core must preserve UI control source identity');
assert.match(witness, /--ui-seed/, 'browser witness must support mutating the visible UI seed control');
assert.match(witness, /--ui-leaf-count/, 'browser witness must support mutating the visible UI leaf control');
assert.match(witness, /requestedUiControls/, 'browser witness report must preserve requested UI control identity');
assert.match(witness, /appliedUiControls/, 'browser witness report must preserve applied UI control identity');

const {
  createControlledOrbShellVariationDescriptor,
  createTargetOrbShellCompositionFixture,
} = await import('../orb-shell-composition-core.js');

const leafLight = createControlledOrbShellVariationDescriptor({
  variantId: 'wide-cup',
  variationSeed: 7,
  variationLeafCount: 8,
});
const leafDense = createControlledOrbShellVariationDescriptor({
  variantId: 'wide-cup',
  variationSeed: 7,
  variationLeafCount: 14,
});

assert.equal(leafLight.variationLeafCount, 8, 'descriptor records the lower UI leaf pressure');
assert.equal(leafDense.variationLeafCount, 14, 'descriptor records the upper UI leaf pressure');
assert.notDeepEqual(
  leafLight.effectiveParameters.macroAssemblages,
  leafDense.effectiveParameters.macroAssemblages,
  'changing UI leaves must change bounded macro variation parameters',
);

const lightFixture = createTargetOrbShellCompositionFixture({
  variantId: 'wide-cup',
  variationSeed: 7,
  variationLeafCount: 8,
  uiControlSource: 'test-ui',
});
const denseFixture = createTargetOrbShellCompositionFixture({
  variantId: 'wide-cup',
  variationSeed: 7,
  variationLeafCount: 14,
  uiControlSource: 'test-ui',
});
const lightNorthWest = lightFixture.macroAssemblages.find(item => item.id === 'north-west-dominant-thrust');
const denseNorthWest = denseFixture.macroAssemblages.find(item => item.id === 'north-west-dominant-thrust');

assert.equal(lightFixture.effectiveVariation.uiControlSource, 'test-ui', 'fixture preserves the UI control source');
assert.equal(denseFixture.effectiveVariation.variationLeafCount, 14, 'fixture exposes effective UI leaf pressure');
assert.equal(
  denseFixture.macroAssemblages.length,
  lightFixture.macroAssemblages.length,
  'UI leaf pressure must preserve macro family count',
);
assert.notEqual(
  denseNorthWest.sphericalTerritory.centerPhase,
  lightNorthWest.sphericalTerritory.centerPhase,
  'UI leaf pressure must produce a visible geometry-driving parameter change',
);
