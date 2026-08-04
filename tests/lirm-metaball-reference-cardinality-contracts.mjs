#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cardinality = await import('../lirm-metaball-silhouette-authority-core.mjs');

assert.equal(
  typeof cardinality.createMetaballReferenceCardinalityTranche,
  'function',
  'metaball core must expose the reference-cardinality assay contract',
);
assert.equal(
  typeof cardinality.writeMetaballReferenceCardinalitySources,
  'function',
  'metaball core must write the reference-cardinality source contract',
);

const tranche = cardinality.createMetaballReferenceCardinalityTranche();
assert.equal(tranche.schema, 'kaminos.lirm-metaball-reference-cardinality.v0');
assert.deepEqual(
  tranche.conditions.map(condition => [
    condition.id,
    condition.referenceViewIds,
    condition.authoritativeReferenceIndices,
    condition.requestedRoute,
  ]),
  [
    ['target-one', ['target-three-quarter'], [1], 'gpu-greenroom/mflux_flux2_edit_promptfile'],
    ['target-double', ['target-three-quarter', 'target-three-quarter'], [1, 2], 'gpu-greenroom/mflux_flux2_edit_promptfile_2ref'],
    ['target-side', ['target-three-quarter', 'side'], [1], 'gpu-greenroom/mflux_flux2_edit_promptfile_2ref'],
    ['side-target', ['side', 'target-three-quarter'], [2], 'gpu-greenroom/mflux_flux2_edit_promptfile_2ref'],
    ['target-triple-control', ['target-three-quarter', 'target-three-quarter', 'target-three-quarter'], [1, 2, 3], 'gpu-greenroom/mflux_flux2_edit_promptfile_3ref'],
  ],
);
assert.equal(tranche.fixedGenerator.seeds[0], 80401);
assert.equal(tranche.fixedGenerator.provisionalCarrierKind, 'depth');

const fixtureRoot = join(
  process.cwd(),
  'artifacts/lirm-metaball-target-first-multiview-v0',
);
const outDir = await mkdtemp(join(tmpdir(), 'lirm-cardinality-contracts-'));
try {
  const written = await cardinality.writeMetaballReferenceCardinalitySources({
    outDir,
    sourceArtifactRoot: fixtureRoot,
  });
  assert.equal(written.manifest.status, 'sources-complete');
  assert.equal(written.manifest.conditions.length, 5);
  for (const condition of written.manifest.conditions) {
    assert.equal(condition.references.length, condition.referenceViewIds.length);
    assert.match(condition.promptPath, /^prompts\//);
    assert.match(condition.promptSha256, /^sha256:[a-f0-9]{64}$/);
    assert.equal(
      (await readFile(join(outDir, condition.promptPath), 'utf8')).trim(),
      condition.prompt,
    );
    for (const reference of condition.references) {
      assert.match(reference.sha256, /^sha256:[a-f0-9]{64}$/);
      assert.ok(reference.path.endsWith('/depth-implicit.png'));
    }
  }
  const control = written.manifest.conditions.at(-1);
  assert.match(control.reuseOutputPath, /target-all-slots\/seed-80401\/output\.png$/);
  assert.equal(control.reuseJobId, 'b8e9bcbbf918');
} finally {
  await rm(outDir, { recursive: true, force: true });
}

process.stdout.write('LIRM reference cardinality contracts passed\n');
