import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { AUTHORED_MUSCLE_PACKING_INTAKE_RECEIPT_SCHEMA } from
  '../authored-muscle-packing-intake-core.mjs';

const fixturePath = new URL(
  '../fixtures/track-m-routing/m31-m47-routing-fixture.json',
  import.meta.url,
);
const toolPath = new URL('../tools/admit-authored-muscle-packing-intake.mjs', import.meta.url);

function runTool(args) {
  return spawnSync(process.execPath, [toolPath.pathname, ...args], {
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '', NO_COLOR: '1' },
  });
}

test('identity-only authored intake writes a loud deterministic terminal receipt', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kaminos-authored-intake-'));
  const receiptPath = join(directory, 'receipt.json');
  const result = runTool([
    '--routing-fixture', fixturePath.pathname,
    '--receipt', receiptPath,
  ]);

  assert.equal(result.status, 2, result.stderr);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(receipt.schema, AUTHORED_MUSCLE_PACKING_INTAKE_RECEIPT_SCHEMA);
  assert.equal(receipt.status, 'identity-coherent_geometry-unavailable');
  assert.equal(receipt.admitted, false);
  assert.equal(receipt.packingSource, null);
  assert.equal(receipt.execution.phase, 'admission-complete');
  assert.equal(receipt.execution.requested.routingFixture, fixturePath.pathname);
  assert.equal(receipt.execution.effective.routingFixture, fixturePath.pathname);
  assert.match(receipt.execution.effective.routingFixtureFileSha256, /^[0-9a-f]{64}$/);
  assert.match(result.stdout, /identity-coherent_geometry-unavailable/);

  const repeated = runTool([
    '--routing-fixture', fixturePath.pathname,
    '--receipt', receiptPath,
  ]);
  assert.equal(repeated.status, 2, repeated.stderr);
  assert.deepEqual(
    JSON.parse(await readFile(receiptPath, 'utf8')),
    receipt,
    'repeating the exact intake must overwrite stale state with the same receipt',
  );
});

test('parse failure still writes a receipt naming the failure phase and last trustworthy evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kaminos-authored-intake-bad-'));
  const badFixturePath = join(directory, 'blank.json');
  const receiptPath = join(directory, 'receipt.json');
  await writeFile(badFixturePath, '');
  const result = runTool([
    '--routing-fixture', badFixturePath,
    '--receipt', receiptPath,
  ]);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(receipt.schema, AUTHORED_MUSCLE_PACKING_INTAKE_RECEIPT_SCHEMA);
  assert.equal(receipt.status, 'input-read-failed');
  assert.equal(receipt.admitted, false);
  assert.equal(receipt.execution.phase, 'parse-routing-fixture');
  assert.equal(receipt.execution.lastTrustworthyEvidence, 'routing-fixture-bytes-read');
  assert.equal(receipt.execution.effective.routingFixture, badFixturePath);
  assert.match(receipt.execution.effective.routingFixtureFileSha256, /^[0-9a-f]{64}$/);
  assert.match(receipt.reason, /JSON|end of input/i);
});

test('receipt aliasing cannot overwrite an authenticated input and redirects failure durably', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kaminos-authored-intake-alias-'));
  const protectedFixturePath = join(directory, 'fixture.json');
  const fixtureBytes = await readFile(fixturePath);
  await writeFile(protectedFixturePath, fixtureBytes);
  const result = runTool([
    '--routing-fixture', protectedFixturePath,
    '--receipt', protectedFixturePath,
  ]);

  assert.equal(result.status, 1);
  assert.deepEqual(await readFile(protectedFixturePath), fixtureBytes);
  const redirectedPath = `${protectedFixturePath}.authored-muscle-packing-intake-failure.json`;
  const receipt = JSON.parse(await readFile(redirectedPath, 'utf8'));
  assert.equal(receipt.status, 'input-read-failed');
  assert.equal(receipt.execution.phase, 'output-path-validation');
  assert.equal(receipt.execution.requested.receipt, protectedFixturePath);
  assert.equal(receipt.execution.effective.receipt, redirectedPath);
  assert.match(receipt.reason, /receipt path must not alias an input/i);
});
