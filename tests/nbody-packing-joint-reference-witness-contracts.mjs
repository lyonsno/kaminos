import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deflateSync } from 'node:zlib';

import {
  NBODY_PACKING_JOINT_REFERENCE_WITNESS_ROUTE,
  writeNBodyPackingJointReferenceWitness,
} from '../nbody-packing-joint-reference-witness.mjs';

const VISUAL_STATES = [
  'known-feasible',
  'crowded',
  'sequential-counterfeit',
  'joint-reference',
];
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
  jointReferenceLegible:true,
  textContained:true,
};

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const CRC32_TABLE = Array.from({ length:256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function onePixelPng(seed) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const pixel = Buffer.from([0, (seed * 53) % 256, (seed * 97) % 256, (seed * 193) % 256]);
  const idat = deflateSync(pixel);
  return {
    bytes:Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', idat),
      pngChunk('IEND', Buffer.alloc(0)),
    ]),
    png: {
      width:1,
      height:1,
      bitDepth:8,
      colorType:2,
      compression:0,
      filter:0,
      interlace:0,
      chunkCount:3,
      idatBytes:idat.length,
    },
  };
}

async function fakeCapture(root, state, mode) {
  const seed = VISUAL_STATES.indexOf(state) * VISUAL_MODES.length +
    VISUAL_MODES.indexOf(mode) + 1;
  const { bytes, png } = onePixelPng(seed);
  const path = `${state}-${mode}.png`;
  const captureReportPath = `${state}-${mode}-capture-report.json`;
  const url = `http://127.0.0.1:18765/artifacts/nbody-packing-joint-reference-v0/?state=${state}&mode=${mode}`;
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
    domReceipt: {
      status:'complete',
      url,
      dataset: {
        witnessLoaded:'true',
        witnessState:state,
        witnessMode:mode,
        witnessRoute:NBODY_PACKING_JOINT_REFERENCE_WITNESS_ROUTE,
      },
    },
    invocation: { url, viewport:{ width:1, height:1 } },
    primaryOutput: {
      path:`repo://artifacts/nbody-packing-joint-reference-v0/${path}`,
      sizeBytes:bytes.length,
      sha256:digest(bytes),
      png,
    },
  }, null, 2)}\n`);
  return { state, mode, path, captureReportPath };
}

test('joint reference witness binds the four-state A/B/C/reference viewer to exact solver evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kaminos-nbody-joint-witness-'));
  try {
    const written = await writeNBodyPackingJointReferenceWitness({ outDir:root });
    const [fixtureBytes, assayBytes, referenceBytes, htmlBytes, reportBytes] =
      await Promise.all([
        readFile(join(root, 'fixture.json')),
        readFile(join(root, 'assay-result.json')),
        readFile(join(root, 'joint-reference.json')),
        readFile(join(root, 'index.html')),
        readFile(join(root, 'report.json')),
      ]);
    const fixture = JSON.parse(fixtureBytes);
    const assay = JSON.parse(assayBytes);
    const reference = JSON.parse(referenceBytes);
    const report = JSON.parse(reportBytes);
    const html = String(htmlBytes);

    assert.equal(written.report.status, 'complete-pending-visual-inspection');
    assert.deepEqual(report.route, {
      requested:NBODY_PACKING_JOINT_REFERENCE_WITNESS_ROUTE,
      effective:NBODY_PACKING_JOINT_REFERENCE_WITNESS_ROUTE,
      fallbackUsed:false,
    });
    assert.equal(fixture.identity.sha256, reference.fixture.sha256);
    assert.equal(assay.status, 'counterfeit-rejected-global-debt');
    assert.equal(reference.status, 'converged-joint-reference');
    assert.equal(reference.config.fallbackUsed, false);
    assert.equal(reference.invariance.candidateEnumeration, 'passed');
    assert.equal(
      report.jointReference.candidateEnumerationReceipt.mechanism,
      'paired-full-solve-artifact-comparison',
    );
    assert.equal(report.jointReference.candidateEnumerationReceipt.rows.length, 2);
    assert.deepEqual(report.jointReference.candidateEnumerationReceipt.comparison, {
      selectedVectorEqual:true,
      selectedPhysicalStateEqual:true,
      selectedMetricsEqual:true,
      selectedBeltEqual:true,
    });
    assert.ok(reference.selected.maximumPhysicalResidual <= 1e-7);
    assert.ok(reference.stationarity.projectedGradientInfinityNorm <= 5e-5);
    assert.equal(report.claims.boundedJointReference, 'supported-by-kkt-and-continuous-admission');
    assert.equal(report.claims.scalableProductionSolver, 'not-assayed');
    assert.deepEqual(report.visualInspection.requiredStates, [
      'known-feasible',
      'crowded',
      'sequential-counterfeit',
      'joint-reference',
    ]);
    for (const state of report.visualInspection.requiredStates) {
      assert.match(html, new RegExp(`data-state="${state}"`));
    }
    assert.match(html, /Joint reference/);
    assert.match(html, /projected KKT/i);
    assert.match(html, /synthetic bounded reference/i);
    assert.match(html, new RegExp(NBODY_PACKING_JOINT_REFERENCE_WITNESS_ROUTE));
    for (const key of [
      'fixtureJsonSha256',
      'assayResultJsonSha256',
      'jointReferenceJsonSha256',
      'indexHtmlSha256',
    ]) assert.match(report.bindings[key], /^[0-9a-f]{64}$/);

    const witnessModule = await import('../nbody-packing-joint-reference-witness.mjs');
    assert.equal(
      typeof witnessModule.admitNBodyPackingJointReferenceVisualInspection,
      'function',
      'joint-reference witness must expose receipt-bound visual admission',
    );
    const images = [];
    for (const state of VISUAL_STATES) {
      for (const mode of VISUAL_MODES) images.push(await fakeCapture(root, state, mode));
    }
    const inspection = {
      observedAt:'2026-08-09T21:00:00-04:00',
      baseUrl:'http://127.0.0.1:18765/artifacts/nbody-packing-joint-reference-v0/',
      images,
      verdict:VISUAL_VERDICT,
      summary:'All four states are distinct and the bounded joint reference is legible in volume and slice.',
    };
    await assert.rejects(
      () => witnessModule.admitNBodyPackingJointReferenceVisualInspection({
        outDir:root,
        inspection:{ ...inspection, images:images.slice(1) },
      }),
      /every state\/mode combination exactly once/,
    );
    const forgedImage = images[0];
    const forgedBytes = Buffer.from('forged non-PNG pixels with a matching report');
    await writeFile(join(root, forgedImage.path), forgedBytes);
    const forgedReportPath = join(root, forgedImage.captureReportPath);
    const forgedReport = JSON.parse(await readFile(forgedReportPath));
    forgedReport.primaryOutput.sizeBytes = forgedBytes.length;
    forgedReport.primaryOutput.sha256 = digest(forgedBytes);
    await writeFile(forgedReportPath, `${JSON.stringify(forgedReport, null, 2)}\n`);
    await assert.rejects(
      () => witnessModule.admitNBodyPackingJointReferenceVisualInspection({
        outDir:root,
        inspection,
      }),
      /PNG/,
    );
    images[0] = await fakeCapture(root, forgedImage.state, forgedImage.mode);
    const wrongDomImage = images[1];
    const wrongDomReportPath = join(root, wrongDomImage.captureReportPath);
    const wrongDomReport = JSON.parse(await readFile(wrongDomReportPath));
    wrongDomReport.domReceipt.dataset.witnessState = 'crowded';
    await writeFile(wrongDomReportPath, `${JSON.stringify(wrongDomReport, null, 2)}\n`);
    await assert.rejects(
      () => witnessModule.admitNBodyPackingJointReferenceVisualInspection({
        outDir:root,
        inspection,
      }),
      /effective DOM mismatch/,
    );
    images[1] = await fakeCapture(root, wrongDomImage.state, wrongDomImage.mode);
    const admitted = await witnessModule.admitNBodyPackingJointReferenceVisualInspection({
      outDir:root,
      inspection,
    });
    assert.equal(admitted.report.status, 'complete-visual-inspected');
    assert.equal(admitted.receipt.images.length, 8);
    assert.equal(new Set(admitted.receipt.images.map(image => image.sha256)).size, 8);
    assert.ok(admitted.receipt.images.every(
      image => image.capture.browser.installedStableChrome === false,
    ));
  } finally {
    await rm(root, { recursive:true, force:true });
  }
});
