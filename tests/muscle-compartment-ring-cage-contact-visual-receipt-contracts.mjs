import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateMuscleCompartmentRingCageContactVisualReceipts,
} from '../muscle-compartment-ring-cage-contact-visual-receipts.mjs';

const identity = {
  schema: 'kaminos.current-k4-ring-cage-contact-visual-bundle.v0',
  route: 'current-k4-ring-cage-contact-orbitable-v0',
  sourceCarrierSha256: 'a'.repeat(64),
  packedCarrierSha256: 'b'.repeat(64),
  sourceInputSha256: 'c'.repeat(64),
  sha256: 'd'.repeat(64),
};

const urls = [
  `index.html?bundle=${identity.sha256}&source=${identity.sourceCarrierSha256}&packed=${identity.packedCarrierSha256}&state=before`,
  `index.html?bundle=${identity.sha256}&source=${identity.sourceCarrierSha256}&packed=${identity.packedCarrierSha256}&state=packed`,
  `index.html?bundle=${identity.sha256}&source=${identity.sourceCarrierSha256}&packed=${identity.packedCarrierSha256}&state=before&view=side`,
  `index.html?bundle=${identity.sha256}&source=${identity.sourceCarrierSha256}&packed=${identity.packedCarrierSha256}&state=packed&view=side`,
];

function report(url, hash) {
  return {
    schema: 'kaminos.receipt-bearing-browser-capture.v0',
    status: 'complete',
    route: {
      requested: 'independent-headless-screenshot-v0',
      effective: 'independent-headless-screenshot-v0',
      fallbackUsed: false,
    },
    browser: { effective: { installedStableChrome: false } },
    invocation: { url: `http://127.0.0.1:8774/assay/${url}` },
    process: { cleanup: { status: 'complete-no-process-group-remains' } },
    stderr: { tail: 'GPU stall due to ReadPixels' },
    primaryOutput: { sha256: hash, sizeBytes: 190000, png: { width: 1400, height: 900 } },
  };
}

const runReport = {
  status: 'completed',
  visual: {
    viewer: { path: 'index.html', sha256: 'e'.repeat(64) },
    bundleIdentity: identity,
    captureUrls: urls,
  },
};

test('visual receipt validation binds served viewer, URLs, browser, and distinct pixels', () => {
  const result = validateMuscleCompartmentRingCageContactVisualReceipts({
    runReport,
    servedViewer: {
      url: 'http://127.0.0.1:8774/assay/index.html',
      sha256: 'e'.repeat(64),
    },
    captureReports: urls.map((url, index) => report(url, String(index + 1).repeat(64))),
  });
  assert.equal(result.status, 'verified');
  assert.deepEqual(result.bundleIdentity, identity);
  assert.equal(result.captures.length, 4);
});

test('visual receipt validation rejects the plausible false-closure paths', () => {
  const valid = urls.map((url, index) => report(url, String(index + 1).repeat(64)));
  assert.throws(() => validateMuscleCompartmentRingCageContactVisualReceipts({
    runReport,
    servedViewer: { url: 'http://127.0.0.1:8774/assay/index.html', sha256: 'f'.repeat(64) },
    captureReports: valid,
  }), /served viewer identity/i);

  const staleRoute = structuredClone(valid);
  staleRoute[0].invocation.url = staleRoute[0].invocation.url.replace(identity.sha256, '0'.repeat(64));
  assert.throws(() => validateMuscleCompartmentRingCageContactVisualReceipts({
    runReport,
    servedViewer: { url: 'http://127.0.0.1:8774/assay/index.html', sha256: 'e'.repeat(64) },
    captureReports: staleRoute,
  }), /capture URL mismatch/i);

  const browserError = structuredClone(valid);
  browserError[1].stderr.tail = 'Uncaught SyntaxError: Invalid or unexpected token';
  assert.throws(() => validateMuscleCompartmentRingCageContactVisualReceipts({
    runReport,
    servedViewer: { url: 'http://127.0.0.1:8774/assay/index.html', sha256: 'e'.repeat(64) },
    captureReports: browserError,
  }), /browser console failure/i);

  const identical = structuredClone(valid);
  identical[1].primaryOutput.sha256 = identical[0].primaryOutput.sha256;
  assert.throws(() => validateMuscleCompartmentRingCageContactVisualReceipts({
    runReport,
    servedViewer: { url: 'http://127.0.0.1:8774/assay/index.html', sha256: 'e'.repeat(64) },
    captureReports: identical,
  }), /distinct capture pixels/i);
});
