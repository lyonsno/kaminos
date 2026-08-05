#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const assay = await import('../lirm-metaball-silhouette-authority-core.mjs');

assert.equal(typeof assay.createMetaballContourEmbellishmentTranche, 'function');
assert.equal(typeof assay.writeMetaballContourEmbellishmentSources, 'function');

const tranche = assay.createMetaballContourEmbellishmentTranche();
assert.equal(tranche.schema, 'kaminos.lirm-metaball-contour-embellishment.v0');
assert.deepEqual(
  tranche.conditions.map(condition => condition.id),
  ['restrained-completion', 'organismal-elaboration', 'maximum-contour-bound-invention'],
);
assert.deepEqual(tranche.fixedGenerator.seeds, [80411, 80412, 80413]);
assert.equal(tranche.conditions.length * tranche.fixedGenerator.seeds.length, 9);
assert.equal(new Set(tranche.conditions.map(condition => condition.prompt)).size, 3);
for (const condition of tranche.conditions) {
  assert.deepEqual(condition.referenceKinds, ['depth', 'depth', 'depth']);
  assert.deepEqual(condition.referenceViewIds, [
    'target-three-quarter',
    'side',
    'target-three-quarter',
  ]);
  assert.match(condition.prompt, /outer silhouette/i);
  assert.match(condition.prompt, /support/i);
}

const outDir = await mkdtemp(join(tmpdir(), 'lirm-contour-embellishment-'));
try {
  const written = await assay.writeMetaballContourEmbellishmentSources({ outDir });
  assert.equal(written.manifest.conditions.length, 3);
  assert.equal(written.manifest.baseline.reuseJobId, '6917deba1f78');
  assert.match(written.manifest.baseline.outputPath, /side-middle\/seed-80401\/output\.png$/);
  for (const condition of written.manifest.conditions) {
    assert.equal(condition.references.length, 3);
    assert.deepEqual(condition.references.map(reference => reference.kind), ['depth', 'depth', 'depth']);
    assert.match(condition.promptSha256, /^sha256:[a-f0-9]{64}$/);
    assert.equal(
      (await readFile(join(outDir, condition.promptPath), 'utf8')).trim(),
      condition.prompt,
    );
  }
} finally {
  await rm(outDir, { recursive: true, force: true });
}

process.stdout.write('LIRM contour embellishment contracts passed\n');
