import assert from 'node:assert/strict';
import test from 'node:test';

import {
  admitMuscleCompartmentPackingVisualInspection,
  writeMuscleCompartmentPackingWitness,
} from '../muscle-compartment-packing-witness.mjs';
import {
  createSyntheticFourMuscleCompartment,
  createSyntheticMuscleDensityLadder,
} from '../muscle-compartment-packing-core.mjs';

function memoryIo() {
  const files = new Map();
  return {
    files,
    io: {
      async mkdir() {},
      async writeFile(path, body) { files.set(path, body); },
      async readFile(path) {
        assert.ok(files.has(path), `witness input exists: ${path}`);
        return files.get(path);
      },
      async rename(from, to) {
        assert.ok(files.has(from), `temporary witness artifact exists: ${from}`);
        files.set(to, files.get(from));
        files.delete(from);
      },
    },
  };
}

test('witness publishes exact source, result, interactive route, and pending visual gate atomically', async () => {
  const memory = memoryIo();
  const outDir = '/virtual/muscle-compartment-packing';
  const written = await writeMuscleCompartmentPackingWitness({ outDir, io: memory.io });

  assert.equal(written.report.status, 'complete');
  assert.deepEqual(written.report.route, {
    requested: 'muscle-compartment-packing-orbitable-v0',
    effective: 'muscle-compartment-packing-orbitable-v0',
    fallbackUsed: false,
  });
  assert.deepEqual(written.report.input.requested, written.report.input.effective);
  assert.equal(written.result.status, 'converged');
  assert.equal(written.result.muscles.length, 4);
  assert.equal(written.report.visualInspection.status, 'pending-agent-inspection');
  assert.equal(written.report.claims.anatomicalCorrectness, 'unassayed');
  assert.ok(memory.files.has(`${outDir}/source.json`));
  assert.ok(memory.files.has(`${outDir}/packed.json`));
  assert.ok(memory.files.has(`${outDir}/index.html`));
  assert.ok(memory.files.has(`${outDir}/report.json`));
  assert.ok(!memory.files.has(`${outDir}/report.json.tmp`));
  const witnessHtml = String(memory.files.get(`${outDir}/index.html`));
  assert.match(witnessHtml, /Overlapping input/);
  assert.match(witnessHtml, /Collision-resolved result/);
  assert.match(witnessHtml, /physically interpenetrate/);
  assert.match(witnessHtml, /skeletal obstacle/);
  assert.doesNotMatch(witnessHtml, />Before packing</);
  assert.doesNotMatch(witnessHtml, />Packed result</);
  assert.match(String(memory.files.get(`${outDir}/index.html`)), /OrbitControls/);
});

test('eight-carrier density witness exposes every stable muscle identity', async () => {
  const memory = memoryIo();
  const outDir = '/virtual/muscle-compartment-packing-density-eight';
  const source = createSyntheticMuscleDensityLadder(8);
  const written = await writeMuscleCompartmentPackingWitness({
    outDir,
    source,
    config: {
      maxIterations:960,
      relaxationStep:0.35,
      smoothnessStep:0.035,
      sampleCount:25,
      convergenceTolerance:1e-7,
    },
    io:memory.io,
  });
  const witnessHtml = String(memory.files.get(`${outDir}/index.html`));

  assert.equal(written.report.result.muscleCount, 8);
  assert.equal(written.report.claims.authoredSourcePacking, 'not-assayed-by-synthetic-witness');
  for (const muscle of source.muscles) assert.match(witnessHtml, new RegExp(muscle.id));
  assert.match(witnessHtml, /#f4a261/);
});

test('visual admission rejects blank captures and binds admitted pixels to current artifacts', async () => {
  const memory = memoryIo();
  const outDir = '/virtual/muscle-compartment-packing';
  await writeMuscleCompartmentPackingWitness({ outDir, io: memory.io });
  memory.files.set(`${outDir}/before.png`, Buffer.alloc(0));
  memory.files.set(`${outDir}/packed.png`, Buffer.from('packed-pixels'));

  await assert.rejects(
    () => admitMuscleCompartmentPackingVisualInspection({
      outDir,
      inspection: {
        observedAt: '2026-08-03T20:00:00Z',
        images: [
          { path: 'before.png', viewport: [1400, 900], state: 'before' },
          { path: 'packed.png', viewport: [1400, 900], state: 'packed' },
        ],
        verdict: { nonblank: true, orbitable: true, movementLegible: true },
      },
      io: memory.io,
    }),
    /blank|empty/i,
  );

  memory.files.set(`${outDir}/before.png`, Buffer.from('before-pixels'));
  memory.files.set(`${outDir}/packed.png`, Buffer.from('packed-pixels'));
  const commonInspection = {
    observedAt: '2026-08-03T20:00:00Z',
    verdict: {
      nonblank: true,
      orbitable: true,
      movementLegible: true,
      stableMuscleIdentityLegible: true,
      attachmentHandlesLegible: true,
      skeletonAndCompartmentLegible: true,
      metricsLegible: true,
      textContained: true,
    },
  };
  for (const images of [
    [{ path: 'before.png', viewport: [1400, 900], state: 'before' }],
    [{ path: 'packed.png', viewport: [1400, 900], state: 'packed' }],
    [
      { path: 'before.png', viewport: [1400, 900], state: 'before' },
      { path: 'before.png', viewport: [1400, 900], state: 'before' },
    ],
    [
      { path: 'before.png', viewport: [1400, 900], state: 'before' },
      { path: 'before.png', viewport: [1400, 900], state: 'packed' },
    ],
    [
      { path: 'packed.png', viewport: [1400, 900], state: 'before' },
      { path: 'before.png', viewport: [1400, 900], state: 'packed' },
    ],
  ]) {
    await assert.rejects(
      () => admitMuscleCompartmentPackingVisualInspection({
        outDir,
        inspection: { ...commonInspection, images },
        io: memory.io,
      }),
      /before.*packed|packed.*before|exactly one|state at/i,
    );
  }
  memory.files.set(`${outDir}/before.png`, Buffer.from('same-pixels'));
  memory.files.set(`${outDir}/packed.png`, Buffer.from('same-pixels'));
  await assert.rejects(
    () => admitMuscleCompartmentPackingVisualInspection({
      outDir,
      inspection: {
        ...commonInspection,
        images: [
          { path: 'before.png', viewport: [1400, 900], state: 'before' },
          { path: 'packed.png', viewport: [1400, 900], state: 'packed' },
        ],
      },
      io: memory.io,
    }),
    /distinct.*hash|identical.*capture/i,
  );
  memory.files.set(`${outDir}/before.png`, Buffer.from('before-pixels'));
  memory.files.set(`${outDir}/packed.png`, Buffer.from('packed-pixels'));
  const admitted = await admitMuscleCompartmentPackingVisualInspection({
    outDir,
    inspection: {
      observedAt: '2026-08-03T20:00:00Z',
      url: 'http://127.0.0.1:8080/artifacts/muscle-compartment-packing-v0/',
      images: [
        { path: 'before.png', viewport: [1400, 900], state: 'before' },
        { path: 'packed.png', viewport: [1400, 900], state: 'packed' },
      ],
      verdict: commonInspection.verdict,
    },
    io: memory.io,
  });
  assert.equal(admitted.report.visualInspection.status, 'passed-agent-inspection');
  assert.match(admitted.receipt.bindings.indexHtmlSha256, /^[a-f0-9]{64}$/);
  assert.match(admitted.receipt.bindings.sourceJsonSha256, /^[a-f0-9]{64}$/);
  assert.match(admitted.receipt.bindings.packedJsonSha256, /^[a-f0-9]{64}$/);
  assert.match(admitted.receipt.bindings.pendingReportSha256, /^[a-f0-9]{64}$/);
  assert.equal(admitted.receipt.images.length, 2);
  assert.ok(admitted.receipt.images.every(image => /^[a-f0-9]{64}$/.test(image.sha256)));
});

test('pre-artifact solve failure leaves a durable phase-specific report with no effective route', async () => {
  const memory = memoryIo();
  const outDir = '/virtual/invalid-muscle-compartment-packing';
  const invalid = createSyntheticFourMuscleCompartment();
  invalid.muscles[0].targetVolume *= 1.01;

  await assert.rejects(
    () => writeMuscleCompartmentPackingWitness({ outDir, source: invalid, io: memory.io }),
    /synthetic fixture identity mismatch/i,
  );
  const report = JSON.parse(String(memory.files.get(`${outDir}/report.json`)));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'solve');
  assert.equal(report.route.effective, null);
  assert.equal(report.lastTrustworthyEvidence.phase, 'source-received');
});
