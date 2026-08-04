import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { AUTHORED_MUSCLE_PACKING_INTAKE_RECEIPT_SCHEMA } from
  '../authored-muscle-packing-intake-core.mjs';
import { createSyntheticFourMuscleCompartment } from
  '../muscle-compartment-packing-core.mjs';

const fixturePath = new URL(
  '../fixtures/track-m-routing/m31-m47-routing-fixture.json',
  import.meta.url,
);
const toolPath = new URL('../tools/admit-authored-muscle-packing-intake.mjs', import.meta.url);
const candidateProbePath = new URL(
  '../artifacts/authored-muscle-coordinate-export-v0/m31-m47/packer-authority-probe.json',
  import.meta.url,
);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return typeof value === 'number' && Object.is(value, -0) ? 0 : value;
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function syntheticAdmittedInputs() {
  const source = createSyntheticFourMuscleCompartment();
  const routes = source.muscles.map((muscle, index) => ({
    constructionId: muscle.identity.constructionId,
    lineageId: muscle.identity.lineageId,
    instanceId: muscle.identity.instanceId,
    name: muscle.id,
    components: {
      surfaceInstanceId: `surface-${index}`,
      surfaceGeometrySha256: hashJson(['surface', index]),
      pathInstanceId: `path-${index}`,
      pathGeometrySha256: hashJson(['path', index]),
    },
    origin: {
      assignedHandleInstanceId: muscle.attachments.origin.id,
      sourceAuthority: muscle.attachments.origin.sourceAuthority,
      point: [...muscle.attachments.origin.position],
    },
    insertion: {
      assignedHandleInstanceId: muscle.attachments.insertion.id,
      sourceAuthority: muscle.attachments.insertion.sourceAuthority,
      point: [...muscle.attachments.insertion.position],
    },
  }));
  const fixturePayload = {
    selection: {
      id: 'synthetic-authored-four-route-selection',
      correctConstructionId: routes[0].constructionId,
      crossWireDonorConstructionId: routes[1].constructionId,
      nullConstructionIds: [],
    },
    source: {
      assetSha256: '1'.repeat(64),
      graphSha256: '2'.repeat(64),
      graphFileSha256: '3'.repeat(64),
    },
    conditions: { correct: { routes } },
  };
  const fixture = {
    schema: 'kaminos.track-m-source-routing-fixture.v0',
    fixtureSha256: hashJson(fixturePayload),
    ...fixturePayload,
  };
  const carrier = {
    schema: 'kaminos.authored-muscle-packing-coordinate-carrier.v0',
    id: 'synthetic-authored-four-coordinate-carrier',
    derivation: {
      kind: 'atlas-route-subset',
      atlas: { id: 'synthetic-four-atlas', sha256: '4'.repeat(64) },
      selectedConstructionIds: routes.map(route => route.constructionId),
      selectionAuthority: {
        receipt: { id: 'synthetic-four-authority', sha256: '5'.repeat(64) },
        sharedFields: {
          'coordinateSpace.unit': 'admitted',
          compartment: 'admitted',
          obstacles: 'admitted',
        },
        rows: routes.map(route => ({
          constructionId: route.constructionId,
          state: 'admitted',
          requiredFields: {
            'attachments.origin.position': 'admitted',
            'attachments.insertion.position': 'admitted',
            centerline: 'admitted',
            targetVolume: 'admitted',
            volumeAuthority: 'admitted',
          },
        })),
      },
    },
    source: {
      assetSha256: fixture.source.assetSha256,
      graphSha256: fixture.source.graphSha256,
      graphFileSha256: fixture.source.graphFileSha256,
      routingFixtureSha256: fixture.fixtureSha256,
    },
    coordinateSpace: { kind: 'source-world', dimension: 3, unit: 'synthetic-unit' },
    compartment: structuredClone(source.compartment),
    obstacles: source.obstacles.map(obstacle => ({
      ...structuredClone(obstacle),
      sourceAuthority: 'synthetic-authored-test',
    })),
    muscles: source.muscles.map((muscle, index) => ({
      constructionId: muscle.identity.constructionId,
      lineageId: muscle.identity.lineageId,
      instanceId: muscle.identity.instanceId,
      surfaceInstanceId: routes[index].components.surfaceInstanceId,
      surfaceGeometrySha256: routes[index].components.surfaceGeometrySha256,
      pathInstanceId: routes[index].components.pathInstanceId,
      pathGeometrySha256: routes[index].components.pathGeometrySha256,
      attachments: structuredClone(muscle.attachments),
      centerline: structuredClone(muscle.centerline),
      targetVolume: muscle.targetVolume,
      volumeAuthority: 'synthetic-authored-test',
    })),
  };
  return { fixture, carrier };
}

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

test('candidate probe pipeline preserves exact intake refusal and emits no witness artifacts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kaminos-authored-pipeline-refusal-'));
  const receiptPath = join(directory, 'receipt.json');
  const witnessOut = join(directory, 'witness');
  const result = runTool([
    '--routing-fixture', fixturePath.pathname,
    '--coordinate-carrier', candidateProbePath.pathname,
    '--receipt', receiptPath,
    '--witness-out', witnessOut,
  ]);

  assert.equal(result.status, 3, result.stderr);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(receipt.status, 'authority-incomplete');
  assert.equal(receipt.admitted, false);
  assert.equal(receipt.packingSource, null);
  assert.deepEqual(receipt.acceptedFields, []);
  assert.deepEqual(receipt.execution.witness, {
    requested: witnessOut,
    effective: null,
    route: { requested: 'muscle-compartment-packing-orbitable-v0', effective: null },
    status: 'not-run-intake-refused',
    staleWitnessArtifactCleanup: {
      status: 'cleared',
      paths: ['source.json', 'packed.json', 'index.html', 'report.json'],
    },
  });
  await assert.rejects(stat(witnessOut), /ENOENT/);
});

test('intake refusal clears a prior successful witness route without running the solver', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kaminos-authored-pipeline-reused-refusal-'));
  const fixtureFile = join(directory, 'fixture.json');
  const carrierFile = join(directory, 'carrier.json');
  const receiptPath = join(directory, 'receipt.json');
  const witnessOut = join(directory, 'witness');
  const { fixture, carrier } = syntheticAdmittedInputs();
  await Promise.all([
    writeFile(fixtureFile, `${JSON.stringify(fixture, null, 2)}\n`),
    writeFile(carrierFile, `${JSON.stringify(carrier, null, 2)}\n`),
  ]);
  const success = runTool([
    '--routing-fixture', fixtureFile,
    '--coordinate-carrier', carrierFile,
    '--receipt', receiptPath,
    '--witness-out', witnessOut,
  ]);
  assert.equal(success.status, 0, success.stderr);
  assert.equal(JSON.parse(await readFile(join(witnessOut, 'report.json'))).status, 'complete');

  const refusal = runTool([
    '--routing-fixture', fixturePath.pathname,
    '--coordinate-carrier', candidateProbePath.pathname,
    '--receipt', receiptPath,
    '--witness-out', witnessOut,
  ]);
  assert.equal(refusal.status, 3, refusal.stderr);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(receipt.status, 'authority-incomplete');
  assert.equal(receipt.execution.witness.status, 'not-run-intake-refused');
  assert.equal(receipt.execution.witness.effective, null);
  assert.equal(receipt.execution.witness.route.effective, null);
  assert.deepEqual(receipt.execution.witness.staleWitnessArtifactCleanup, {
    status: 'cleared',
    paths: ['source.json', 'packed.json', 'index.html', 'report.json'],
  });
  for (const artifact of ['source.json', 'packed.json', 'index.html', 'report.json']) {
    await assert.rejects(stat(join(witnessOut, artifact)), /ENOENT/);
  }
});

test('admitted carrier pipeline drives the generic deterministic witness and binds its report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kaminos-authored-pipeline-admitted-'));
  const fixtureFile = join(directory, 'fixture.json');
  const carrierFile = join(directory, 'carrier.json');
  const receiptPath = join(directory, 'receipt.json');
  const witnessOut = join(directory, 'witness');
  const { fixture, carrier } = syntheticAdmittedInputs();
  await Promise.all([
    writeFile(fixtureFile, `${JSON.stringify(fixture, null, 2)}\n`),
    writeFile(carrierFile, `${JSON.stringify(carrier, null, 2)}\n`),
  ]);
  const result = runTool([
    '--routing-fixture', fixtureFile,
    '--coordinate-carrier', carrierFile,
    '--receipt', receiptPath,
    '--witness-out', witnessOut,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(receipt.status, 'admitted');
  assert.equal(receipt.admitted, true);
  assert.deepEqual(receipt.packingSource.formation, {
    centerlineSmoothingReference: 'source-displacement',
  }, 'pipeline source must use the packer-owned source-formation policy');
  assert.equal(receipt.execution.witness.requested, witnessOut);
  assert.equal(receipt.execution.witness.effective, await realpath(witnessOut));
  assert.deepEqual(receipt.execution.witness.route, {
    requested: 'muscle-compartment-packing-orbitable-v0',
    effective: 'muscle-compartment-packing-orbitable-v0',
  });
  assert.equal(receipt.execution.witness.status, 'complete');
  assert.match(receipt.execution.witness.reportFileSha256, /^[0-9a-f]{64}$/);
  const report = JSON.parse(await readFile(join(witnessOut, 'report.json'), 'utf8'));
  assert.equal(report.status, 'complete');
  assert.equal(report.result.status, 'converged');
  assert.match(String(await readFile(join(witnessOut, 'index.html'))), /Collision-resolved result/);

  const repeated = runTool([
    '--routing-fixture', fixtureFile,
    '--coordinate-carrier', carrierFile,
    '--receipt', receiptPath,
    '--witness-out', witnessOut,
  ]);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.deepEqual(
    JSON.parse(await readFile(receiptPath, 'utf8')),
    receipt,
    'the same admitted inputs and output paths must reproduce the same terminal receipt',
  );
});

test('witness output cannot contain or overwrite authenticated pipeline inputs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kaminos-authored-pipeline-alias-'));
  const witnessOut = join(directory, 'witness');
  const fixtureFile = join(witnessOut, 'fixture.json');
  const carrierFile = join(directory, 'carrier.json');
  const receiptPath = join(directory, 'receipt.json');
  const { fixture, carrier } = syntheticAdmittedInputs();
  const fixtureBytes = Buffer.from(`${JSON.stringify(fixture, null, 2)}\n`);
  await mkdir(witnessOut, { recursive: true });
  await Promise.all([
    writeFile(fixtureFile, fixtureBytes),
    writeFile(carrierFile, `${JSON.stringify(carrier, null, 2)}\n`),
  ]);
  const result = runTool([
    '--routing-fixture', fixtureFile,
    '--coordinate-carrier', carrierFile,
    '--receipt', receiptPath,
    '--witness-out', witnessOut,
  ]);

  assert.equal(result.status, 1);
  assert.deepEqual(await readFile(fixtureFile), fixtureBytes);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(receipt.status, 'input-read-failed');
  assert.equal(receipt.execution.phase, 'output-path-validation');
  assert.match(receipt.reason, /witness output directory.*input|contain.*input/i);
});

test('symlinked witness root cannot bypass authenticated input containment', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kaminos-authored-pipeline-symlink-root-'));
  const protectedDirectory = join(directory, 'protected');
  const witnessOut = join(directory, 'witness-link');
  const fixtureFile = join(protectedDirectory, 'fixture.json');
  const carrierFile = join(directory, 'carrier.json');
  const receiptPath = join(directory, 'receipt.json');
  const { fixture, carrier } = syntheticAdmittedInputs();
  const fixtureBytes = Buffer.from(`${JSON.stringify(fixture, null, 2)}\n`);
  await mkdir(protectedDirectory, { recursive: true });
  await Promise.all([
    writeFile(fixtureFile, fixtureBytes),
    writeFile(carrierFile, `${JSON.stringify(carrier, null, 2)}\n`),
  ]);
  await symlink(protectedDirectory, witnessOut, 'dir');

  const result = runTool([
    '--routing-fixture', fixtureFile,
    '--coordinate-carrier', carrierFile,
    '--receipt', receiptPath,
    '--witness-out', witnessOut,
  ]);

  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(await readFile(fixtureFile), fixtureBytes);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(receipt.status, 'input-read-failed');
  assert.equal(receipt.execution.phase, 'output-path-validation');
  assert.match(receipt.reason, /witness output directory.*input|contain.*input/i);
  for (const artifact of ['source.json', 'packed.json', 'index.html', 'report.json']) {
    await assert.rejects(stat(join(protectedDirectory, artifact)), /ENOENT/);
  }
});

test('symlinked witness artifact cannot overwrite an authenticated input outside its root', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kaminos-authored-pipeline-symlink-artifact-'));
  const witnessOut = join(directory, 'witness');
  const fixtureFile = join(directory, 'fixture.json');
  const carrierFile = join(directory, 'carrier.json');
  const receiptPath = join(directory, 'receipt.json');
  const { fixture, carrier } = syntheticAdmittedInputs();
  const fixtureBytes = Buffer.from(`${JSON.stringify(fixture, null, 2)}\n`);
  await mkdir(witnessOut, { recursive: true });
  await Promise.all([
    writeFile(fixtureFile, fixtureBytes),
    writeFile(carrierFile, `${JSON.stringify(carrier, null, 2)}\n`),
  ]);
  await symlink(fixtureFile, join(witnessOut, 'source.json'));

  const result = runTool([
    '--routing-fixture', fixtureFile,
    '--coordinate-carrier', carrierFile,
    '--receipt', receiptPath,
    '--witness-out', witnessOut,
  ]);

  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(await readFile(fixtureFile), fixtureBytes);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(receipt.execution.phase, 'output-path-validation');
  assert.match(receipt.reason, /witness output directory.*input|contain.*input/i);
});
