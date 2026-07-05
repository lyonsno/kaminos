import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');
const index = readFileSync(join(root, 'index.html'), 'utf8');

assert.match(core, /LowerSocketRenderInventoryPlan/, 'composition core must name the lower-socket semantic render inventory plan');
assert.match(core, /createLowerSocketRenderInventoryPlan/, 'composition core must build the lower-socket semantic render inventory plan');
assert.match(core, /lowerSocketRenderInventoryPlan/, 'composition debug state must expose the lower-socket semantic render inventory plan');
assert.match(core, /lowerSocketSemanticRenderInventory/, 'composition witness must expose runtime lower-socket semantic render inventory');
assert.match(core, /enableLowerSocketSemanticRenderInventoryWitness/, 'composition witness must expose an isolated lower-socket semantic inventory mode');
assert.match(witness, /lower-socket-semantic-render-inventory/, 'headless witness must know the lower-socket semantic inventory focus');
assert.match(index, /orb_shell_focus/, 'operator route must expose a focus parameter for semantic inventory smokes');
assert.match(index, /enableLowerSocketSemanticRenderInventoryWitness/, 'operator route can enter the lower-socket semantic inventory witness without console work');
assert.match(index, /orb-shell-semantic-legend/, 'semantic inventory route must expose an operator-visible color legend host');
assert.match(index, /colorLegend/, 'semantic inventory route must render the witness color legend instead of leaving colors implicit');

const { createTargetOrbShellCompositionFixture } = await import('../orb-shell-composition-core.js');

const fixture = createTargetOrbShellCompositionFixture({
  variantId: 'wide-cup',
  variationSeed: 6,
  variationLeafCount: 11,
});

const plan = fixture.lowerSocketRenderInventoryPlan;
assert.equal(plan?.schema, 'LowerSocketRenderInventoryPlan', 'fixture exposes a lower-socket semantic render inventory plan');
assert.equal(plan.mode, 'lower-socket-semantic-render-inventory-v0', 'plan records the accepted semantic inventory mode');
assert.equal(plan.targetAssemblage, 'lower-socket-keel', 'inventory is scoped to the lower-socket offender');
assert.equal(plan.runtimeTraversalRequired, true, 'plan distinguishes expected source inventory from runtime-rendered mesh traversal');
assert.equal(
  plan.diagnosticQuestion,
  'which concrete render path produced the visible lower-socket appendage',
  'plan preserves the operator-facing diagnostic question',
);
assert.equal(
  plan.isolationWitnessMode,
  'lower-socket-semantic-render-inventory-isolated-v0',
  'plan names the isolated visual witness mode',
);

const renderClasses = new Set(plan.expectedRecords.map(record => record.renderClass));
for (const renderClass of [
  'MacroPromotedBody',
  'LiveMacroSideWall',
  'LiveMacroTerminalCap',
  'MacroFamilySubstrip',
  'MacroFamilySubstripSideWall',
  'MacroFamilySubstripTerminalCap',
  'BandMember',
  'TerminationSocketGraph',
  'LamellarChannelStripMesh',
  'LamellarPlateLip',
  'LamellarPlateBoundaryMesh',
  'LamellarInnerReturnSidePlaneMesh',
  'MacroRegionSeamGapDescriptor',
]) {
  assert.ok(renderClasses.has(renderClass), `semantic inventory must account for ${renderClass}`);
}

assert.equal(
  plan.classColorLegend.length,
  renderClasses.size,
  'each semantic render class must have one diagnostic color entry',
);
assert.ok(
  plan.expectedRecords.some(record => (
    record.renderClass === 'BandMember'
    && record.parentAssemblage === 'lower-socket-keel'
    && record.normalRenderExpected === false
    && record.suppressionAuthority === 'LiveMacroSideWallPlan.suppressedLegacyRoundBandIds'
  )),
  'inventory must record suppressed lower-socket legacy child bands instead of letting stale anatomy hide',
);
assert.ok(
  plan.expectedRecords.some(record => (
    record.renderClass === 'LamellarChannelStripMesh'
    && (record.parentAssemblage === 'lower-socket-keel' || record.lowerSocketRelevance)
    && typeof record.normalRenderExpected === 'boolean'
  )),
  'inventory must account for lower-socket-relevant channel strips or their absence',
);
assert.ok(
  plan.expectedRecords.some(record => (
    record.renderClass === 'MacroFamilySubstripSideWall'
    && record.parentAssemblage === 'lower-socket-keel'
    && (record.sourceState === 'absent-in-current-plan' || record.meshName.endsWith('-sidewall'))
  )),
  'inventory must account for generated substrip sidewalls or explicitly record their absence',
);
assert.ok(
  plan.expectedRecords.some(record => (
    record.renderClass === 'LiveMacroTerminalCap'
    && record.parentAssemblage === 'lower-socket-keel'
    && record.normalRenderExpected === true
    && record.suppressionAuthority === null
  )),
  'inventory must preserve receiverless socket-tongue terminal caps as named provisional visible evidence',
);
assert.ok(
  plan.failureClassesIfVisible.includes('stale-subordinate-anatomy-visible'),
  'inventory records stale subordinate anatomy as a first-class failure mode',
);
assert.equal(
  plan.inventoryCompletenessVerdict,
  'lower-socket-render-paths-enumerated-before-next-shape-edit',
  'plan forbids another shape tweak before render-path identity is observable',
);
