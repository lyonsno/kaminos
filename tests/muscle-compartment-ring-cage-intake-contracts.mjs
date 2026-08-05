import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { createSyntheticFourMuscleCompartment } from '../muscle-compartment-packing-core.mjs';
import {
  admitMuscleCompartmentRingCageDocument,
} from '../muscle-compartment-ring-cage-intake.mjs';
import {
  createMuscleCompartmentRingCages,
  encodeMuscleCompartmentRingCageIdentityDomain,
  hashMuscleCompartmentRingCageCanonicalJson,
} from '../muscle-compartment-ring-cage-core.mjs';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const TOOL = path.join(REPO_ROOT, 'tools/admit-muscle-compartment-ring-cage.mjs');
const CONFIG = Object.freeze({
  ringVertexCount: 12,
  freedomMode: 'affine-section',
  volumeTolerance: 1e-9,
  sourceVolumeTolerance: 1e-12,
  frameSeedDirection: [0, 0, 1],
});

function carrierVolume(centerline) {
  let volume = 0;
  for (let index = 0; index < centerline.length - 1; index += 1) {
    const left = centerline[index];
    const right = centerline[index + 1];
    const length = Math.hypot(...left.position.map(
      (value, axis) => right.position[axis] - value,
    ));
    volume += Math.PI * length / 3 * (
      left.radius ** 2 + left.radius * right.radius + right.radius ** 2
    );
  }
  return volume;
}

function straightSource() {
  const source = createSyntheticFourMuscleCompartment();
  for (const muscle of source.muscles) {
    const start = [...muscle.centerline[0].position];
    const end = [...muscle.centerline.at(-1).position];
    const denominator = muscle.centerline.length - 1;
    for (const [index, knot] of muscle.centerline.entries()) {
      const fraction = index / denominator;
      knot.position = start.map(
        (value, axis) => value + (end[axis] - value) * fraction,
      );
    }
    muscle.attachments.origin.position = [...muscle.centerline[0].position];
    muscle.attachments.insertion.position = [...muscle.centerline.at(-1).position];
    muscle.targetVolume = carrierVolume(muscle.centerline);
  }
  return source;
}

function documentFor(source = createSyntheticFourMuscleCompartment()) {
  return createMuscleCompartmentRingCages(source, CONFIG);
}

function runTool(input, output, expectedDocumentSha256) {
  return spawnSync(process.execPath, [
    TOOL,
    '--input', input,
    '--output', output,
    '--expected-document-sha256', expectedDocumentSha256,
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
}

function reidentify(value) {
  const bytes = encodeMuscleCompartmentRingCageIdentityDomain(value);
  value.identity = {
    ...value.identity,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    canonicalByteLength: bytes.byteLength,
  };
}

test('curved tapered cages fail loud on surface/cell disagreement before solver projection', () => {
  const admission = admitMuscleCompartmentRingCageDocument(documentFor());
  assert.equal(admission.status, 'refused');
  assert.equal(admission.phase, 'carrier-admission');
  assert.equal(admission.route.requested, admission.route.effective);
  assert.equal(admission.route.fallbackUsed, false);
  assert.equal(admission.solverCarrier, null);
  const referenceBlockers = admission.blockingMechanisms.filter(
    item => item.kind === 'reference-surface-cell-volume-mismatch',
  );
  const currentBlockers = admission.blockingMechanisms.filter(
    item => item.kind === 'current-surface-cell-volume-mismatch',
  );
  assert.equal(referenceBlockers.length, 4);
  assert.equal(currentBlockers.length, 4);
  assert.ok(referenceBlockers.every(item => item.relativeDisagreement > 2e-4));
  assert.deepEqual(
    referenceBlockers.map(item => item.constructionId),
    createSyntheticFourMuscleCompartment().muscles.map(
      muscle => muscle.identity.constructionId,
    ),
  );
});

test('one straight replay admits byte-identical generic manifests with fixed masks intact', () => {
  const document = documentFor(straightSource());
  const first = admitMuscleCompartmentRingCageDocument(document);
  const replay = admitMuscleCompartmentRingCageDocument(structuredClone(document));
  assert.deepEqual(replay, first);
  assert.equal(first.status, 'admitted');
  assert.equal(first.phase, 'carrier-admission-complete');
  assert.equal(first.input.requestedSha256, document.identity.sha256);
  assert.equal(first.input.effectiveSha256, document.identity.sha256);
  assert.deepEqual(
    first.solverCarrier.orderedConstructionIds,
    document.source.orderedConstructionIds,
  );
  assert.deepEqual(
    first.solverCarrier.cages.map(row => row.manifest),
    document.cages.map(cage => cage.genericManifest),
  );
  for (const row of first.solverCarrier.cages) {
    const fixed = row.manifest.constraints.boundaryMasks.filter(mask => mask.fixed);
    assert.equal(fixed.length, 26);
    assert.ok(fixed.every(mask => mask.attachmentFrameId));
  }
});

test('the exact fixed-contact current K4 source passes the same carrier admission gate', async () => {
  const source = JSON.parse(await readFile(path.join(
    REPO_ROOT,
    'artifacts/current-k4-fixed-contact-assay-v0/contact-admitted-source.json',
  ), 'utf8'));
  const document = documentFor(source);
  const admission = admitMuscleCompartmentRingCageDocument(document);
  assert.equal(admission.status, 'admitted');
  assert.equal(admission.phase, 'carrier-admission-complete');
  assert.deepEqual(admission.blockingMechanisms, []);
  assert.deepEqual(
    admission.solverCarrier.orderedConstructionIds,
    ['muscle-34', 'muscle-13', 'muscle-12', 'muscle-45'],
  );
  assert.equal(admission.solverCarrier.cages.length, 4);
  assert.ok(admission.solverCarrier.cages.every(row =>
    row.manifest.constraints.boundaryMasks.filter(mask => mask.fixed).length === 26));
});

test('missing, tampered, substituted, and invalid config inputs refuse or fail explicitly', () => {
  const incomplete = admitMuscleCompartmentRingCageDocument({});
  assert.equal(incomplete.status, 'refused');
  assert.equal(incomplete.phase, 'document-structure');
  assert.equal(incomplete.solverCarrier, null);

  const tampered = documentFor(straightSource());
  tampered.cages[0].genericManifest.constraints.boundaryMasks[0].fixed = false;
  tampered.cages[0].genericManifest.semanticHashes.constraintsSha256 =
    hashMuscleCompartmentRingCageCanonicalJson(
      tampered.cages[0].genericManifest.constraints,
    );
  reidentify(tampered.cages[0]);
  reidentify(tampered);
  const fixedMaskRefusal = admitMuscleCompartmentRingCageDocument(tampered);
  assert.equal(fixedMaskRefusal.phase, 'carrier-admission');
  assert.equal(fixedMaskRefusal.solverCarrier, null);
  assert.ok(fixedMaskRefusal.blockingMechanisms.some(
    item => item.kind === 'generic-manifest-fixed-boundary-mismatch',
  ));

  const substituted = documentFor(straightSource());
  substituted.config.effective.freedomMode = 'free-ring';
  substituted.config.fallbackUsed = true;
  reidentify(substituted);
  const substitutionRefusal = admitMuscleCompartmentRingCageDocument(substituted);
  assert.equal(substitutionRefusal.phase, 'carrier-admission');
  assert.equal(substitutionRefusal.solverCarrier, null);
  assert.ok(substitutionRefusal.blockingMechanisms.some(
    item => item.kind === 'carrier-config-fallback-or-substitution',
  ));

  const partial = documentFor(straightSource());
  delete partial.config.effective;
  reidentify(partial);
  const partialRefusal = admitMuscleCompartmentRingCageDocument(partial);
  assert.equal(partialRefusal.status, 'refused');
  assert.equal(partialRefusal.phase, 'carrier-admission');
  assert.equal(partialRefusal.solverCarrier, null);

  assert.throws(
    () => admitMuscleCompartmentRingCageDocument(documentFor(straightSource()), {
      surfaceCellRelativeTolerance: 0,
    }),
    /surfaceCellRelativeTolerance must be positive/i,
  );
  assert.throws(
    () => admitMuscleCompartmentRingCageDocument(documentFor(straightSource()), {
      hiddenCap: 8,
    }),
    /unsupported field/i,
  );

  const requestMismatch = admitMuscleCompartmentRingCageDocument(
    documentFor(straightSource()),
    { expectedDocumentSha256: '0'.repeat(64) },
  );
  assert.equal(requestMismatch.status, 'refused');
  assert.ok(requestMismatch.blockingMechanisms.some(
    item => item.kind === 'carrier-document-request-mismatch',
  ));
});

test('a re-signed unsupported document schema refuses before solver projection', () => {
  const wrongSchema = documentFor(straightSource());
  wrongSchema.schema = 'not-the-ring-cage-schema';
  reidentify(wrongSchema);
  const admission = admitMuscleCompartmentRingCageDocument(wrongSchema);
  assert.equal(admission.status, 'refused');
  assert.equal(admission.phase, 'document-schema');
  assert.equal(admission.solverCarrier, null);
  assert.deepEqual(
    admission.blockingMechanisms.map(item => item.kind),
    ['ring-cage-document-schema-mismatch'],
  );
});

test('CLI missing input clears stale primary and writes a pre-read failure report', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kaminos-ring-cage-intake-missing-'));
  const input = path.join(root, 'missing-cage-document.json');
  const output = path.join(root, 'output');
  await mkdir(output);
  await writeFile(path.join(output, 'solver-carrier.json'), '{"stale":true}\n');
  const result = runTool(input, output, '0'.repeat(64));
  assert.notEqual(result.status, 0);
  await assert.rejects(readFile(path.join(output, 'solver-carrier.json')), /ENOENT/);
  const report = JSON.parse(await readFile(path.join(output, 'run-report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'resolve-input');
  assert.equal(report.requestedInputPath, input);
  assert.equal(report.effectiveInputPath, null);
  assert.equal(report.primaryOutput, null);
  assert.equal(report.inputArtifact, null);
  assert.match(report.error, /ENOENT/);
});

test('CLI missing input parent still clears stale primary and writes a pre-read failure report', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kaminos-ring-cage-intake-missing-parent-'));
  const input = path.join(root, 'missing-parent', 'missing-cage-document.json');
  const output = path.join(root, 'output');
  await mkdir(output);
  await writeFile(path.join(output, 'solver-carrier.json'), '{"stale":true}\n');
  const result = runTool(input, output, '0'.repeat(64));
  assert.notEqual(result.status, 0);
  await assert.rejects(readFile(path.join(output, 'solver-carrier.json')), /ENOENT/);
  const report = JSON.parse(await readFile(path.join(output, 'run-report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'resolve-input');
  assert.equal(report.requestedInputPath, input);
  assert.equal(report.effectiveInputPath, null);
  assert.equal(report.primaryOutput, null);
  assert.equal(report.inputArtifact, null);
  assert.match(report.error, /ENOENT/);
});

test('CLI rejects every output-file alias without deleting or overwriting input bytes', async () => {
  const document = documentFor(straightSource());
  const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`);
  for (const outputName of [
    'run-report.json',
    'solver-carrier.json',
    'input-cage-document.json',
  ]) {
    const root = await mkdtemp(path.join(tmpdir(), 'kaminos-ring-cage-intake-alias-'));
    const output = path.join(root, 'output');
    await mkdir(output);
    const input = path.join(output, outputName);
    await writeFile(input, bytes);
    const result = runTool(input, output, document.identity.sha256);
    assert.notEqual(result.status, 0, `${outputName} unexpectedly admitted`);
    const preserved = await readFile(input);
    assert.equal(
      preserved.byteLength,
      bytes.byteLength,
      `${outputName} input byte length changed`,
    );
    assert.equal(
      createHash('sha256').update(preserved).digest('hex'),
      createHash('sha256').update(bytes).digest('hex'),
      `${outputName} input SHA-256 changed`,
    );
  }
});

test('CLI clears stale primary output and writes the curved-carrier refusal receipt', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kaminos-ring-cage-intake-refusal-'));
  const input = path.join(root, 'cage-document.json');
  const output = path.join(root, 'output');
  const document = documentFor();
  await writeFile(input, `${JSON.stringify(document, null, 2)}\n`);
  await mkdir(output);
  await writeFile(path.join(output, 'solver-carrier.json'), '{"stale":true}\n');
  const result = runTool(input, output, document.identity.sha256);
  assert.notEqual(result.status, 0);
  const report = JSON.parse(await readFile(path.join(output, 'run-report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'carrier-admission');
  assert.match(report.inputFileSha256, /^[0-9a-f]{64}$/);
  assert.equal(report.route.effective, 'generic-ring-cage-contact-containment-intake.v0');
  assert.equal(report.admission.status, 'refused');
  assert.equal(report.admission.solverCarrier, null);
  assert.deepEqual(
    await readFile(path.join(output, 'input-cage-document.json')),
    await readFile(input),
  );
  await assert.rejects(readFile(path.join(output, 'solver-carrier.json')), /ENOENT/);
});

test('CLI publishes a hash-bound solver carrier only after straight admission', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kaminos-ring-cage-intake-pass-'));
  const input = path.join(root, 'cage-document.json');
  const output = path.join(root, 'output');
  const document = documentFor(straightSource());
  await writeFile(input, `${JSON.stringify(document, null, 2)}\n`);
  const result = runTool(input, output, document.identity.sha256);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(path.join(output, 'run-report.json'), 'utf8'));
  const primary = JSON.parse(await readFile(path.join(output, 'solver-carrier.json'), 'utf8'));
  assert.equal(report.status, 'completed');
  assert.equal(report.failurePhase, null);
  assert.equal(report.admission.status, 'admitted');
  assert.equal(primary.schema, 'kaminos.muscle-compartment-ring-cage-solver-carrier.v0');
  assert.equal(primary.identity.sha256, report.admission.solverCarrier.identity.sha256);
  assert.match(report.primaryOutput.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    await readFile(path.join(output, 'input-cage-document.json')),
    await readFile(input),
  );
});
