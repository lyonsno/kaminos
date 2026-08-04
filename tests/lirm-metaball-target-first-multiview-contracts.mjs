#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const multiview = await import('../lirm-metaball-silhouette-authority-core.mjs');

assert.equal(
  typeof multiview.createMetaballTargetFirstMultiviewTranche,
  'function',
  'metaball core must expose the target-first multiview assay contract',
);

const tranche = multiview.createMetaballTargetFirstMultiviewTranche();

assert.equal(tranche.schema, 'kaminos.lirm-metaball-target-first-multiview.v0');
assert.equal(tranche.status, 'source-contract-frozen');
assert.deepEqual(
  tranche.views.map(view => [view.id, view.cameraYawRadians]),
  [
    ['target-three-quarter', 0.42],
    ['front', 0],
    ['side', 1.3],
    ['rear-three-quarter', 2.2],
  ],
);
assert.deepEqual(
  tranche.conditions.map(condition => [
    condition.id,
    condition.referenceViewIds,
    condition.authoritativeReferenceIndices,
  ]),
  [
    [
      'target-all-slots',
      ['target-three-quarter', 'target-three-quarter', 'target-three-quarter'],
      [1, 2, 3],
    ],
    [
      'side-last',
      ['target-three-quarter', 'target-three-quarter', 'side'],
      [1, 2],
    ],
    [
      'side-middle',
      ['target-three-quarter', 'side', 'target-three-quarter'],
      [1, 3],
    ],
    [
      'side-first',
      ['side', 'target-three-quarter', 'target-three-quarter'],
      [2, 3],
    ],
    [
      'front-target-rear',
      ['front', 'target-three-quarter', 'rear-three-quarter'],
      [2],
    ],
  ],
);

for (const condition of tranche.conditions) {
  assert.equal(condition.referenceViewIds.length, 3);
  assert.match(condition.prompt, /authoritative target view/i);
  for (const index of condition.authoritativeReferenceIndices) {
    assert.equal(condition.referenceViewIds[index - 1], 'target-three-quarter');
  }
}

assert.equal(tranche.fixedGenerator.guidance, 1);
assert.deepEqual(tranche.fixedGenerator.seeds, [80401]);
assert.equal(tranche.fixedGenerator.provisionalCarrierKind, 'depth');
assert.equal(
  tranche.fixedGenerator.carrierDisposition,
  'projection-sentinel-depth-selected',
);
assert.match(tranche.claimCeiling, /experimental/i);

const outDir = await mkdtemp(join(tmpdir(), 'lirm-multiview-contracts-'));
try {
  await assert.rejects(
    multiview.writeMetaballTargetFirstMultiviewSources({
      outDir,
      pixelWidth: 64,
      pixelHeight: 48,
    }),
    /square source rasters/i,
  );
  const written = await multiview.writeMetaballTargetFirstMultiviewSources({
    outDir,
    pixelWidth: 64,
    pixelHeight: 64,
  });
  assert.equal(written.manifest.effectiveConfig.sourceRasterPolicy, 'generator-native-square');
  assert.equal(written.manifest.effectiveConfig.pixelWidth, written.manifest.effectiveConfig.pixelHeight);
  assert.equal(written.manifest.conditions.length, 5);
  for (const condition of written.manifest.conditions) {
    assert.match(condition.promptPath, /^prompts\//);
    assert.match(condition.promptSha256, /^sha256:[a-f0-9]{64}$/);
    assert.equal(
      (await readFile(join(outDir, condition.promptPath), 'utf8')).trim(),
      condition.prompt,
    );
  }
} finally {
  await rm(outDir, { recursive: true, force: true });
}

process.stdout.write('LIRM target-first multiview contracts passed\n');
