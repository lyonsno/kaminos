import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');

assert.match(core, /LamellarPlateLip/, 'composition module names LamellarPlateLip records');
assert.match(core, /flat-beveled-lip-not-round-rod/, 'plate lips explicitly reject round rod geometry');
assert.match(core, /makeLamellarPlateLipGeometry/, 'composition module renders flat plate lip geometry');
assert.match(core, /plateLipVisualLegibilityVerdict/, 'composition module reports plate lip visual legibility');
assert.match(witness, /lamellarPlateLipCount/, 'composition witness reports plate lip count');
assert.match(witness, /plateLipVisualLegibilityVerdict/, 'composition witness reports plate lip visual verdict');

const { createTargetOrbShellCompositionFixture } = await import('../orb-shell-composition-core.js');

const fixture = createTargetOrbShellCompositionFixture({ variantId: 'wide-cup', variationSeed: 7 });
const plan = fixture.lamellarChannelMeshPlan;
const northEast = plan.stripMeshes.find(strip => strip.sourceDescriptorId === 'north-east-counter-thrust-ne-support-channel-through-line');

assert.equal(plan?.schema, 'LamellarChannelMeshPlan', 'fixture exposes lamellar channel mesh plan');
assert.ok(plan.plateLipCount >= 2, 'mesh plan exposes paired plate lips');
assert.equal(plan.plateLipVisualLegibilityVerdict, 'raised-flat-lips-visible-plate-language', 'mesh plan reports visible plate lip verdict');
assert.equal(plan.roundDiagnosticRailFinalVisible, false, 'round diagnostic rail remains non-final');
assert.equal(northEast?.schema, 'LamellarChannelStripMesh', 'north-east flat strip exists');
assert.ok(northEast.plateLips.length >= 2, 'north-east strip carries paired plate lips');
assert.ok(northEast.visualWidthScale > 1, 'strip has a deliberate visual width scale for legibility');

for (const lip of northEast.plateLips) {
  assert.equal(lip.schema, 'LamellarPlateLip', 'plate lip uses schema');
  assert.equal(lip.geometryKind, 'flat-beveled-lip-not-round-rod', 'plate lip is not round rod geometry');
  assert.equal(lip.sourceStripMeshId, northEast.id, 'plate lip references owning strip');
  assert.ok(['left-shoulder', 'right-shoulder'].includes(lip.edgeRole), 'plate lip records edge role');
  assert.ok(lip.lipWidth > lip.lipHeight, 'plate lip is wider than tall');
  assert.ok(lip.highlightMaterialRole.includes('edge-shoulder'), 'plate lip carries edge shoulder material role');
  assert.ok(lip.edgeSamples.length >= 8, 'plate lip carries sampled edge path');
}
