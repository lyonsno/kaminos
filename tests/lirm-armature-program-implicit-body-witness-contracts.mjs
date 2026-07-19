import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  writeLirmArmatureProgramImplicitBodyWitness,
} from '../lirm-speciation-armature-core.js';
import {
  BULBOUS_RADIAL_UPRIGHT_ARMATURE_PROGRAM,
  BULBOUS_RADIAL_UPRIGHT_PARAMETER_SPECS,
} from '../lirm-bulbous-radial-upright-armature-program.mjs';

const parameters = Object.fromEntries(
  BULBOUS_RADIAL_UPRIGHT_PARAMETER_SPECS.map(spec => [spec.id, spec.initial]),
);
const outDir = await mkdtemp(join(tmpdir(), 'kaminos-armature-program-implicit-witness-'));
const result = await writeLirmArmatureProgramImplicitBodyWitness({
  outDir,
  armatureProgram: BULBOUS_RADIAL_UPRIGHT_ARMATURE_PROGRAM,
  parameters,
  candidateId: 'bulbous-radial-upright-contract',
  pixelWidth: 48,
  pixelHeight: 36,
});
assert.equal(result.schema, 'kaminos.lirm-armature-program-implicit-body-write-result.v0');
assert.equal(result.route, 'kaminos/lirm-armature-program/implicit-body-v0');
assert.ok(existsSync(result.receiptPath));

const receipt = JSON.parse(await readFile(result.receiptPath, 'utf8'));
assert.equal(receipt.status, 'complete');
assert.equal(receipt.phase, 'witness_written');
assert.equal(receipt.requestedRoute, receipt.effectiveRoute);
assert.equal(receipt.effectiveRoute, 'kaminos/lirm-armature-program/implicit-body-v0');
assert.equal(receipt.armatureProgram.id, BULBOUS_RADIAL_UPRIGHT_ARMATURE_PROGRAM.id);
assert.deepEqual(receipt.effectiveConfig, {
  pixelWidth: 48,
  pixelHeight: 36,
  projection: 'orthographic',
  view: 'front-three-quarter',
  raySource: 'software-sdf-raymarch',
});
assert.equal(receipt.outputInventory.maps.length, 5);
assert.equal(receipt.outputInventory.trellisSource.kind, 'trellis-clay');
assert.ok(receipt.outputEvidence.length >= 13);
for (const evidence of receipt.outputEvidence) {
  const path = join(outDir, evidence.path);
  assert.ok(existsSync(path), `missing output evidence: ${evidence.path}`);
  assert.equal(statSync(path).size, evidence.byteSize);
  assert.equal(`sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`, evidence.sha256);
}
for (const item of [...receipt.outputInventory.maps, receipt.outputInventory.trellisSource]) {
  assert.ok(statSync(join(outDir, item.rasterPath)).size > 100, `${item.rasterPath} must be nonempty`);
}
for (const map of receipt.outputInventory.maps) {
  const svg = readFileSync(join(outDir, map.path), 'utf8');
  assert.match(
    svg,
    /<rect x="0" y="0" width="48" height="36" fill=/,
    `${map.kind} background must cover the exact viewBox instead of relying on renderer-dependent percentages`,
  );
}

const failedOutDir = await mkdtemp(join(tmpdir(), 'kaminos-armature-program-implicit-failure-'));
await assert.rejects(
  writeLirmArmatureProgramImplicitBodyWitness({
    outDir: failedOutDir,
    armatureProgram: {
      ...BULBOUS_RADIAL_UPRIGHT_ARMATURE_PROGRAM,
      createPrimitives: undefined,
    },
    parameters,
    candidateId: 'invalid-program-contract',
    pixelWidth: 48,
    pixelHeight: 36,
  }),
  /primitive factory/,
);
const failureReceipt = JSON.parse(await readFile(join(failedOutDir, 'receipt.json'), 'utf8'));
assert.equal(failureReceipt.status, 'failed');
assert.equal(failureReceipt.failurePhase, 'bundle-creation-or-write');
assert.equal(failureReceipt.lastTrustworthyEvidence, 'invocation recorded; no bundle accepted');
assert.match(failureReceipt.errorMessage, /primitive factory/);

console.log('LIRM armature program implicit body witness contracts passed');
