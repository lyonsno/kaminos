#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const topology = await import('../lirm-metaball-silhouette-authority-core.mjs');

assert.equal(typeof topology.createMetaballMultiviewTopologyTranche, 'function');
assert.equal(typeof topology.writeMetaballMultiviewTopologySources, 'function');

const tranche = topology.createMetaballMultiviewTopologyTranche();
assert.equal(tranche.schema, 'kaminos.lirm-metaball-multiview-topology.v0');
assert.deepEqual(
  tranche.conditions.map(condition => [condition.id, condition.referenceKinds]),
  [
    ['depth-control', ['depth', 'depth', 'depth']],
    ['clay-target', ['clay', 'depth', 'depth']],
    ['normal-target', ['normal', 'depth', 'depth']],
    ['clay-normal-target', ['clay', 'depth', 'normal']],
  ],
);
for (const condition of tranche.conditions) {
  assert.deepEqual(condition.referenceViewIds, [
    'target-three-quarter',
    'side',
    'target-three-quarter',
  ]);
  assert.equal(condition.promptSourceConditionId, 'side-middle');
}

const outDir = await mkdtemp(join(tmpdir(), 'lirm-topology-contracts-'));
try {
  const written = await topology.writeMetaballMultiviewTopologySources({ outDir });
  assert.equal(written.manifest.conditions.length, 4);
  assert.equal(written.manifest.conditions[0].reuseJobId, '6917deba1f78');
  assert.match(written.manifest.conditions[0].reuseOutputPath, /side-middle\/seed-80401\/output\.png$/);
  for (const condition of written.manifest.conditions) {
    assert.equal(condition.references.length, 3);
    assert.equal(condition.promptSha256, 'sha256:886c82a32581168f2ff9c1c8fbd79e9b36705cbed55fb7867a6f4b8e64851805');
    assert.deepEqual(condition.references.map(reference => reference.kind), condition.referenceKinds);
  }
} finally {
  await rm(outDir, { recursive: true, force: true });
}

process.stdout.write('LIRM multiview topology contracts passed\n');
