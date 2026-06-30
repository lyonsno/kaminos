import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');

assert.match(core, /CurvatureWidthCapLaw/, 'composition core must name the curvature width cap law');
assert.match(core, /minimumCurvatureRadius/, 'curve morphology metrics must expose minimum curvature radius');
assert.match(core, /curvatureRadiusWidthRatio/, 'width cap must declare its curvature-radius ratio');
assert.match(core, /curvature-width-cap-applied/, 'morphology inventory must report applied curvature width caps');

const { createTargetOrbShellCompositionFixture } = await import('../orb-shell-composition-core.js');

const fixture = createTargetOrbShellCompositionFixture({
  variantId: 'wide-cup',
  variationSeed: 6,
  variationLeafCount: 11,
});

assert.equal(fixture.macroAssemblages.length, 5, 'stress fixture preserves the five-macro case');

for (const assemblage of fixture.macroAssemblages) {
  const law = assemblage.macroPromotedBody?.curvatureWidthCapLaw;
  assert.equal(law?.schema, 'CurvatureWidthCapLaw', `${assemblage.id} has a curvature width cap law`);
  assert.equal(law.sourceStage, 'post-variation-pre-promotion-sphere-line', `${assemblage.id} cap is sourced from the early sphere curve`);
  assert.ok(Number.isFinite(law.minimumCurvatureRadius), `${assemblage.id} records finite minimum curvature radius`);
  assert.ok(law.minimumCurvatureRadius > 0, `${assemblage.id} minimum curvature radius is positive`);
  assert.ok(law.curvatureRadiusWidthRatio > 0 && law.curvatureRadiusWidthRatio < 1, `${assemblage.id} cap ratio is a conservative fraction of curve radius`);
  assert.ok(law.uncappedPeakSideWidth >= law.maxSideWidth, `${assemblage.id} cap never increases promoted body width`);
  assert.ok(
    law.maxSideWidth <= law.minimumCurvatureRadius * law.curvatureRadiusWidthRatio + 1e-6,
    `${assemblage.id} max side width is bounded by minimum curvature radius`,
  );
}

const lowerSocket = fixture.macroAssemblages.find(assemblage => assemblage.id === 'lower-socket-keel');
assert.ok(lowerSocket, 'stress fixture includes lower-socket offender');
const lowerLaw = lowerSocket.macroPromotedBody.curvatureWidthCapLaw;
assert.equal(lowerLaw.capApplied, true, 'lower-socket offender must have an applied curvature width cap');
assert.ok(lowerLaw.widthScale < 1, 'lower-socket cap reduces promoted side width instead of letting it crimp');
assert.ok(
  lowerLaw.maxSideWidth < lowerLaw.uncappedPeakSideWidth,
  'lower-socket max side width is lower than its uncapped promoted width',
);

const lowerRecord = fixture.macroMorphologyInventory.records.find(record => record.parentAssemblage === 'lower-socket-keel');
assert.ok(lowerRecord, 'morphology inventory includes lower socket');
assert.equal(lowerRecord.curvatureWidthCapLaw?.schema, 'CurvatureWidthCapLaw', 'morphology inventory exposes the lower-socket cap law');
assert.ok(
  lowerRecord.pathologyClasses.includes('curvature-width-cap-applied'),
  'morphology inventory reports the applied cap as active diagnostic pressure',
);
