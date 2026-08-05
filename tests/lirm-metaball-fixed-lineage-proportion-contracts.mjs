import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createMetaballContourEmbellishmentTranche,
  createMetaballFixedLineageProportionTranche,
  writeMetaballFixedLineageProportionSources,
} from '../lirm-metaball-silhouette-authority-core.mjs';

const tranche = createMetaballFixedLineageProportionTranche();
const embellishment = createMetaballContourEmbellishmentTranche();
const lineageAnchor = embellishment.conditions.find(
  condition => condition.id === 'maximum-contour-bound-invention',
);

assert.equal(tranche.schema, 'kaminos.lirm-metaball-fixed-lineage-proportion.v0');
assert.deepEqual(tranche.fixedGenerator.seeds, [80413]);
assert.equal(tranche.fixedGenerator.prompt, lineageAnchor.prompt);
assert.deepEqual(tranche.referenceViewIds, [
  'target-three-quarter',
  'side',
  'target-three-quarter',
]);
assert.deepEqual(tranche.referenceKinds, ['depth', 'depth', 'depth']);
assert.deepEqual(
  tranche.variants.map(variant => variant.id),
  [
    'axial-short',
    'baseline',
    'axial-long',
    'body-shallow',
    'body-deep',
    'supports-short',
    'supports-long',
  ],
);

const byId = new Map(tranche.variants.map(variant => [variant.id, variant]));
assert.ok(byId.get('axial-short').parameters.bodyLength < byId.get('baseline').parameters.bodyLength);
assert.ok(byId.get('axial-long').parameters.bodyLength > byId.get('baseline').parameters.bodyLength);
assert.ok(byId.get('body-shallow').parameters.bodyDepth < byId.get('baseline').parameters.bodyDepth);
assert.ok(byId.get('body-deep').parameters.bodyDepth > byId.get('baseline').parameters.bodyDepth);
assert.ok(byId.get('supports-short').parameters.supportLength < byId.get('baseline').parameters.supportLength);
assert.ok(byId.get('supports-long').parameters.supportLength > byId.get('baseline').parameters.supportLength);

const outDir = await mkdtemp(join(tmpdir(), 'lirm-fixed-lineage-proportion-'));
const { manifest } = await writeMetaballFixedLineageProportionSources({
  outDir,
  pixelWidth: 64,
  pixelHeight: 64,
});

assert.equal(manifest.status, 'sources-complete');
assert.equal(manifest.rows.length, 7);
assert.deepEqual(manifest.effectiveConfig.fixedProjectionEnvelope, {
  screenWidthWorld: 2.65,
  screenHeightWorld: 2.05,
  rayOriginDepth: 1.46,
  maxTravel: 3,
  framingPolicy: 'fixed-world-envelope-no-variant-autofit',
});
for (const row of manifest.rows) {
  assert.equal(row.views.length, 2);
  assert.deepEqual(row.references.map(reference => reference.viewId), [
    'target-three-quarter',
    'side',
    'target-three-quarter',
  ]);
  assert.deepEqual(row.references.map(reference => reference.kind), ['depth', 'depth', 'depth']);
  assert.equal(row.references[0].sha256, row.references[2].sha256);
  for (const view of row.views) {
    assert.equal(view.sourceImage.kind, 'depth');
    assert.match(view.sourceImage.relativePath, /depth-implicit\.png$/);
    const receipt = JSON.parse(await readFile(join(outDir, view.witnessReceiptPath), 'utf8'));
    assert.equal(receipt.status, 'complete');
    assert.equal(receipt.effectiveConfig.pixelWidth, 64);
    assert.equal(receipt.effectiveConfig.pixelHeight, 64);
    assert.equal(receipt.effectiveConfig.cameraYawRadians, view.cameraYawRadians);
  }
}

process.stdout.write('lirm metaball fixed-lineage proportion contracts passed\n');
