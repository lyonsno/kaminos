import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createNBodyRosetteFixture } from '../nbody-packing-assay-core.mjs';
import {
  NBODY_PACKING_ASSAY_WITNESS_ROUTE,
  admitNBodyPackingAssayVisualInspection,
  renderNBodyPackingAssayHtml,
  writeNBodyPackingAssayWitness,
} from '../nbody-packing-assay-witness.mjs';

const VISUAL_STATES = ['known-feasible', 'crowded', 'sequential-counterfeit'];
const VISUAL_MODES = ['volume', 'slice'];
const VISUAL_VERDICT = {
  nonblank:true,
  orbitable:true,
  statesLegible:true,
  opaqueOverlapTruthLegible:true,
  stableIdentityLegible:true,
  attachmentsBoneCompartmentLegible:true,
  metricsMatchMarkers:true,
  packingSemanticsNotInverted:true,
  textContained:true,
};

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fakeCapture(root, state, mode, bytes = Buffer.from(`image:${state}:${mode}`)) {
  const path = `${state}-${mode}.png`;
  const captureReportPath = `${state}-${mode}-capture-report.json`;
  const url = `http://127.0.0.1:18765/artifacts/nbody-packing-rosette-assay-v0/?state=${state}&mode=${mode}`;
  await writeFile(join(root, path), bytes);
  await writeFile(join(root, captureReportPath), `${JSON.stringify({
    schema:'kaminos.receipt-bearing-browser-capture.v0',
    status:'complete',
    route: {
      requested:'independent-headless-screenshot-v0',
      effective:'independent-headless-screenshot-v0',
      fallbackUsed:false,
    },
    browser: {
      effective: {
        kind:'playwright-chromium-headless-shell',
        installedStableChrome:false,
      },
      fallbackPolicy:'independent-artifact-or-fail-no-stable-chrome',
    },
    invocation: {
      url,
      outputPath:`repo://artifacts/nbody-packing-rosette-assay-v0/${path}`,
      viewport:{ width:1400, height:900 },
    },
    primaryOutput: {
      path:`repo://artifacts/nbody-packing-rosette-assay-v0/${path}`,
      sizeBytes:bytes.length,
      sha256:digest(bytes),
      png:{ width:1400, height:900 },
    },
  }, null, 2)}\n`);
  return { state, mode, path, captureReportPath };
}

test('orbitable N-body witness exposes the known witness, crowded input, and rejected counterfeit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kaminos-nbody-witness-'));
  try {
    const written = await writeNBodyPackingAssayWitness({ outDir:root });
    const [fixtureBytes, resultBytes, htmlBytes, reportBytes] = await Promise.all([
      readFile(join(root, 'fixture.json')),
      readFile(join(root, 'result.json')),
      readFile(join(root, 'index.html')),
      readFile(join(root, 'report.json')),
    ]);
    const fixture = JSON.parse(fixtureBytes);
    const result = JSON.parse(resultBytes);
    const report = JSON.parse(reportBytes);
    const html = String(htmlBytes);

    assert.equal(written.report.status, 'complete-pending-visual-inspection');
    assert.equal(report.schema, 'kaminos.nbody-packing-assay-witness-report.v0');
    assert.deepEqual(report.route, {
      requested:NBODY_PACKING_ASSAY_WITNESS_ROUTE,
      effective:NBODY_PACKING_ASSAY_WITNESS_ROUTE,
      fallbackUsed:false,
    });
    assert.equal(report.result.status, 'counterfeit-rejected-global-debt');
    assert.equal(report.claims.knownFeasibility, 'supported-by-manufactured-witness');
    assert.equal(report.claims.globalSolverCorrectness, 'not-assayed');
    assert.equal(report.visualInspection.status, 'pending-agent-inspection');
    assert.match(report.bindings.fixtureJsonSha256, /^[0-9a-f]{64}$/);
    assert.match(report.bindings.resultJsonSha256, /^[0-9a-f]{64}$/);
    assert.match(report.bindings.indexHtmlSha256, /^[0-9a-f]{64}$/);

    assert.equal(fixture.id, result.fixtureId);
    assert.equal(result.status, 'counterfeit-rejected-global-debt');
    assert.match(html, /data-state="known-feasible"/);
    assert.match(html, /data-state="crowded"/);
    assert.match(html, /data-state="sequential-counterfeit"/);
    assert.match(html, /data-mode="volume"/);
    assert.match(html, /data-mode="slice"/);
    assert.match(html, /Opaque overlap truth/);
    assert.match(html, /counterfeit-rejected-global-debt/);
    assert.match(html, /distal pressure debt/i);
    assert.match(html, /witnessLoaded/);
    assert.match(html, /witnessState/);
    assert.match(html, /witnessMode/);
    assert.match(html, new RegExp(NBODY_PACKING_ASSAY_WITNESS_ROUTE));

    assert.equal(
      renderNBodyPackingAssayHtml({ fixture, result, report }),
      html,
      'stored viewer must equal deterministic rendering of its bound payload',
    );
  } finally {
    await rm(root, { recursive:true, force:true });
  }
});

test('witness failure clears stale primaries and preserves the failure phase', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kaminos-nbody-witness-failure-'));
  try {
    await Promise.all([
      writeFile(join(root, 'fixture.json'), 'stale fixture'),
      writeFile(join(root, 'result.json'), 'stale result'),
      writeFile(join(root, 'index.html'), 'stale viewer'),
    ]);
    const fixture = createNBodyRosetteFixture();
    fixture.identity.sha256 = '0'.repeat(64);
    await assert.rejects(
      () => writeNBodyPackingAssayWitness({ outDir:root, fixture }),
      /fixture identity mismatch/,
    );
    const report = JSON.parse(await readFile(join(root, 'report.json')));
    assert.equal(report.status, 'failed');
    assert.equal(report.failurePhase, 'build-assay');
    assert.equal(report.lastTrustworthyEvidence.phase, 'fixture-received');
    assert.equal(report.stalePrimaryCleanup.status, 'cleared');
    assert.deepEqual(report.stalePrimaryCleanup.paths, [
      'fixture.json',
      'result.json',
      'index.html',
    ]);
    await assert.rejects(() => readFile(join(root, 'fixture.json')), /ENOENT/);
    await assert.rejects(() => readFile(join(root, 'result.json')), /ENOENT/);
    await assert.rejects(() => readFile(join(root, 'index.html')), /ENOENT/);
  } finally {
    await rm(root, { recursive:true, force:true });
  }
});

test('visual admission binds six independently receipted state/mode captures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kaminos-nbody-visual-admission-'));
  try {
    await writeNBodyPackingAssayWitness({ outDir:root });
    const images = [];
    for (const state of VISUAL_STATES) {
      for (const mode of VISUAL_MODES) images.push(await fakeCapture(root, state, mode));
    }
    const admitted = await admitNBodyPackingAssayVisualInspection({
      outDir:root,
      inspection: {
        observedAt:'2026-08-09T15:40:00-04:00',
        baseUrl:'http://127.0.0.1:18765/artifacts/nbody-packing-rosette-assay-v0/',
        images,
        verdict:VISUAL_VERDICT,
        summary:'Known witness is separated; crowded and counterfeit debts are distinct in slice mode.',
      },
    });
    assert.equal(admitted.report.status, 'complete-visual-inspected');
    assert.equal(admitted.report.visualInspection.status, 'passed-agent-inspection');
    assert.equal(admitted.receipt.images.length, 6);
    assert.equal(new Set(admitted.receipt.images.map(image => image.sha256)).size, 6);
    assert.ok(admitted.receipt.images.every(
      image => image.capture.route.effective === 'independent-headless-screenshot-v0',
    ));
    assert.ok(admitted.receipt.images.every(
      image => image.capture.browser.installedStableChrome === false,
    ));
    assert.match(admitted.report.visualInspection.receiptSha256, /^[0-9a-f]{64}$/);
  } finally {
    await rm(root, { recursive:true, force:true });
  }
});

test('visual admission rejects cached duplicates and wrong state routes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kaminos-nbody-visual-false-closure-'));
  try {
    await writeNBodyPackingAssayWitness({ outDir:root });
    const images = [];
    for (const state of VISUAL_STATES) {
      for (const mode of VISUAL_MODES) images.push(await fakeCapture(root, state, mode));
    }
    const duplicated = Buffer.from('same cached pixels');
    await writeFile(join(root, images[0].path), duplicated);
    await writeFile(join(root, images[1].path), duplicated);
    await assert.rejects(
      () => admitNBodyPackingAssayVisualInspection({
        outDir:root,
        inspection: {
          observedAt:'2026-08-09T15:40:00-04:00',
          baseUrl:'http://127.0.0.1:18765/artifacts/nbody-packing-rosette-assay-v0/',
          images,
          verdict:VISUAL_VERDICT,
          summary:'invalid duplicate evidence',
        },
      }),
      /capture primary hash mismatch|distinct pixels/,
    );
    await fakeCapture(root, images[0].state, images[0].mode);
    await fakeCapture(root, images[1].state, images[1].mode);
    const wrongReportPath = join(root, images[2].captureReportPath);
    const wrongReport = JSON.parse(await readFile(wrongReportPath));
    wrongReport.invocation.url = wrongReport.invocation.url.replace(
      'state=crowded',
      'state=known-feasible',
    );
    await writeFile(wrongReportPath, `${JSON.stringify(wrongReport, null, 2)}\n`);
    await assert.rejects(
      () => admitNBodyPackingAssayVisualInspection({
        outDir:root,
        inspection: {
          observedAt:'2026-08-09T15:40:00-04:00',
          baseUrl:'http://127.0.0.1:18765/artifacts/nbody-packing-rosette-assay-v0/',
          images,
          verdict:VISUAL_VERDICT,
          summary:'invalid routed evidence',
        },
      }),
      /capture route mismatch/,
    );
  } finally {
    await rm(root, { recursive:true, force:true });
  }
});
