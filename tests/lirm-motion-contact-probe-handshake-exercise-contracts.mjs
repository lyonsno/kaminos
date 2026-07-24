import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  MOTION_CONTACT_PROBE_ADAPTER_ROUTE,
  runMotionContactProbeHandshakeExercise,
} from '../lirm-motion-contact-probe-handshake-exercise.mjs';

const root = resolve(import.meta.dirname, '..');
const sourcePath = resolve(root, 'artifacts/motion-ready-719024/creature.glb');
const registrationPath = resolve(
  root,
  'artifacts/lirm-719024-fitted-proxy-rig-mechanism-witness-v1/registration.json',
);
const contactAtlasPath = resolve(
  root,
  'artifacts/lirm-719024-smooth-fitted-phase-exercise-v0/admitted-contact-atlas.json',
);
const inputPath = resolve(
  root,
  'artifacts/lirm-719024-motion-contact-probe-handshake-v0/stationary-hill-request.json',
);
const work = await mkdtemp(resolve(tmpdir(), 'kaminos-motion-contact-probe-'));

try {
  const missingRoot = resolve(work, 'missing');
  const missing = await runMotionContactProbeHandshakeExercise({
    sourcePath: resolve(work, 'missing.glb'),
    registrationPath,
    contactAtlasPath,
    inputPath,
    outDir: missingRoot,
  });
  assert.equal(missing.status, 'fail');
  assert.equal(missing.failurePhase, 'input-admission');
  assert.equal(missing.effectiveRoute, null);
  assert.deepEqual(missing.outputInventory, {});
  assert.match(missing.error.message, /requires existing source/);
  assert.deepEqual(
    JSON.parse(await readFile(resolve(missingRoot, 'report.json'), 'utf8')),
    missing,
    'failure before the primary fixture must still leave a durable report',
  );

  const firstRoot = resolve(work, 'first');
  const first = await runMotionContactProbeHandshakeExercise({
    sourcePath,
    registrationPath,
    contactAtlasPath,
    inputPath,
    outDir: firstRoot,
  });
  assert.equal(first.status, 'pass');
  assert.equal(first.failurePhase, null);
  assert.equal(first.requestedRoute, MOTION_CONTACT_PROBE_ADAPTER_ROUTE);
  assert.equal(first.effectiveRoute, MOTION_CONTACT_PROBE_ADAPTER_ROUTE);
  const firstBytes = await readFile(resolve(firstRoot, first.outputInventory.fixture.path));
  assert.equal(
    `sha256:${createHash('sha256').update(firstBytes).digest('hex')}`,
    first.outputInventory.fixture.sha256,
  );
  const firstFixture = JSON.parse(firstBytes);
  assert.equal(firstFixture.effectiveRoute, MOTION_CONTACT_PROBE_ADAPTER_ROUTE);
  assert.equal(firstFixture.request.id, firstFixture.response.requestId);
  assert.equal(firstFixture.prepass.id, firstFixture.response.prepassId);
  assert.deepEqual(firstFixture.request.supportSurface, firstFixture.response.supportSurface);
  assert.deepEqual(firstFixture.request.body, firstFixture.response.body);
  assert.deepEqual(firstFixture.request.contactAtlas, firstFixture.response.contactAtlas);
  assert.equal(firstFixture.request.poseId, firstFixture.response.poseId);
  assert.equal(firstFixture.request.phase, firstFixture.response.phase);
  assert.deepEqual(
    firstFixture.response.patches.map(patch => patch.id),
    firstFixture.request.patches.map(patch => patch.id),
  );
  assert.ok(firstFixture.response.patches.every(patch => (
    patch.worldPosition.length === 3 && patch.worldPosition.every(Number.isFinite)
  )));

  const secondRoot = resolve(work, 'second');
  const second = await runMotionContactProbeHandshakeExercise({
    sourcePath,
    registrationPath,
    contactAtlasPath,
    inputPath,
    outDir: secondRoot,
  });
  assert.equal(second.status, 'pass');
  assert.equal(
    second.outputInventory.fixture.sha256,
    first.outputInventory.fixture.sha256,
    'the same admitted request must produce byte-identical fixture output',
  );

  const staleInput = JSON.parse(await readFile(inputPath, 'utf8'));
  staleInput.request.supportSurface.revision = 'stale-revision';
  const stalePath = resolve(work, 'stale-request.json');
  await writeFile(stalePath, `${JSON.stringify(staleInput, null, 2)}\n`);
  const staleRoot = resolve(work, 'stale');
  const stale = await runMotionContactProbeHandshakeExercise({
    sourcePath,
    registrationPath,
    contactAtlasPath,
    inputPath: stalePath,
    outDir: staleRoot,
  });
  assert.equal(stale.status, 'fail');
  assert.equal(stale.failurePhase, 'probe-evaluation');
  assert.equal(stale.effectiveRoute, null);
  assert.deepEqual(stale.outputInventory, {});
  assert.match(stale.error.message, /support surface identity mismatch/);
  assert.deepEqual(
    JSON.parse(await readFile(resolve(staleRoot, 'report.json'), 'utf8')),
    stale,
  );
} finally {
  await rm(work, { recursive: true, force: true });
}

process.stdout.write('lirm motion-contact probe handshake exercise contracts passed\n');
