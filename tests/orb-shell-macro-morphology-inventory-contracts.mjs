import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');
const index = readFileSync(join(root, 'index.html'), 'utf8');

assert.match(core, /OrbShellMorphologyInventory/, 'composition core must name the macro morphology inventory');
assert.match(core, /MacroSphereCurveDecomposition/, 'composition core must preserve early sphere curve decompositions');
assert.match(core, /createMacroMorphologyInventory/, 'composition core must build the morphology inventory');
assert.match(core, /macroMorphologyInventory/, 'composition debug state must expose the morphology inventory');
assert.match(core, /enableMacroMorphologyInventoryWitness/, 'browser witness must expose an isolated morphology inventory mode');
assert.match(witness, /macro-morphology-inventory/, 'headless witness must know the macro morphology inventory focus');
assert.match(index, /macro-morphology-inventory/, 'operator route must expose the curve decomposition focus mode');

const { createTargetOrbShellCompositionFixture } = await import('../orb-shell-composition-core.js');

const fixture = createTargetOrbShellCompositionFixture({
  variantId: 'wide-cup',
  variationSeed: 6,
  variationLeafCount: 11,
});

const inventory = fixture.macroMorphologyInventory;
assert.equal(inventory?.schema, 'OrbShellMorphologyInventory', 'fixture exposes macro morphology inventory');
assert.equal(
  inventory.mode,
  'macro-curve-vs-promoted-body-diagnostic-v0',
  'inventory records the accepted diagnostic mode',
);
assert.equal(
  inventory.recordCount,
  fixture.macroAssemblages.length,
  'inventory records one morphology entry per live macro assemblage',
);
assert.equal(
  inventory.visualDecompositionMode,
  'early-macro-curves-as-lines-on-reference-sphere',
  'inventory names the stripped sphere-line decomposition view',
);
assert.ok(
  inventory.failurePressure.includes('do-not-spot-fix-lower-socket-before-source-curve-inventory'),
  'inventory preserves the current no-spot-fix diagnostic pressure',
);

for (const record of inventory.records) {
  assert.equal(record.schema, 'MacroMorphologyInventoryRecord', 'records carry a stable schema');
  assert.ok(record.parentAssemblage, 'records preserve parent macro identity');
  assert.equal(
    record.earlySphereCurve?.schema,
    'MacroSphereCurveDecomposition',
    'records expose early sphere curve decomposition',
  );
  assert.equal(
    record.earlySphereCurve.generationStage,
    'post-variation-pre-promotion-sphere-line',
    'early curve is sampled before mesh promotion and lower-socket repair effects',
  );
  assert.ok(record.earlySphereCurve.sampleCount >= 32, 'early curve carries enough samples for visual reasoning');
  assert.equal(record.earlySphereCurve.samples.length, record.earlySphereCurve.sampleCount, 'sample count matches samples');
  assert.ok(
    record.earlySphereCurve.samples.every(sample => (
      Array.isArray(sample.point)
      && sample.point.length === 3
      && sample.point.every(Number.isFinite)
      && Number.isFinite(sample.radiusError)
    )),
    'early curve samples carry finite point coordinates and sphere-fit error',
  );
  assert.ok(record.earlySphereCurve.maxAbsRadiusError < 0.02, 'early decomposition stays on the reference sphere');
  assert.ok(record.earlySphereCurve.visualOverlayId?.endsWith('-early-sphere-curve-line'), 'early curve has a named visual overlay id');
  assert.equal(record.promotedCenterline?.schema, 'MacroPromotedCenterlineDecomposition', 'records expose promoted body centerline evidence');
  assert.ok(record.promotedCenterline.sampleCount >= 24, 'promoted centerline carries dense samples');
  assert.equal(record.sourceCurveMetrics?.schema, 'MacroCurveMorphologyMetrics', 'records expose source curve metrics');
  assert.equal(record.promotedCenterlineMetrics?.schema, 'MacroCurveMorphologyMetrics', 'records expose promoted centerline metrics');
  assert.ok(Array.isArray(record.pathologyClasses), 'records expose pathology classes');
  assert.ok(Array.isArray(record.diagnosticQuestion), 'records preserve local diagnostic questions');
  assert.ok(
    ['direct-wide-promoted-body', 'parent-owned-substrip-family', 'retired-or-support-body'].includes(record.renderClassComparison),
    'records classify parent render strategy',
  );
}

const lowerSocket = inventory.records.find(record => record.parentAssemblage === 'lower-socket-keel');
assert.ok(lowerSocket, 'inventory must include lower-socket offender when selected');
assert.ok(
  lowerSocket.pathologyClasses.includes('wandering-s-hook-visible-offender')
    || lowerSocket.pathologyClasses.includes('wide-body-squiggle-risk'),
  'lower socket record must name the currently visible squiggle/tendril failure class',
);
assert.ok(
  lowerSocket.diagnosticQuestion.includes('is the lower-socket squiggle born in the source curve or promoted later'),
  'lower socket record must preserve the operator question that blocks another spot fix',
);

assert.ok(
  inventory.records.some(record => (
    record.renderClassComparison === 'parent-owned-substrip-family'
    && record.pathologyClasses.includes('strip-family-visually-forgiving')
  )),
  'inventory must explain why decomposed multi-strip families can pass while wide bodies reveal failures',
);
assert.ok(
  inventory.records.some(record => (
    record.sideWallMetrics?.maxTurnAngle > record.sourceCurveMetrics?.maxTurnAngle
    || record.promotedCenterlineMetrics?.lateralChordRatio > record.sourceCurveMetrics?.lateralChordRatio
  )),
  'inventory must compare source curves against promoted or sidewall distortion',
);
assert.equal(
  inventory.pathologyClassCounts['wandering-s-hook-visible-offender'] >= 1
    || inventory.pathologyClassCounts['wide-body-squiggle-risk'] >= 1,
  true,
  'inventory summarizes visible squiggle pressure',
);
assert.ok(
  inventory.curveDecompositions.every(curve => curve.schema === 'MacroSphereCurveDecomposition'),
  'inventory exposes curve decompositions as first-class debug records',
);
