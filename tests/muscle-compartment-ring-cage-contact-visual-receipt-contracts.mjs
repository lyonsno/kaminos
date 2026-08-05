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
  residualLedgerSha256: 'f'.repeat(64),
  sha256: 'd'.repeat(64),
};

const witnessRoute = {
  requested: 'current-k4-ring-cage-contact-orbitable-v0',
  effective: 'current-k4-ring-cage-contact-orbitable-v0',
  fallbackUsed: false,
};

const urls = [
  `index.html?bundle=${identity.sha256}&source=${identity.sourceCarrierSha256}&packed=${identity.packedCarrierSha256}&ledger=${identity.residualLedgerSha256}&routeRequested=${witnessRoute.requested}&routeEffective=${witnessRoute.effective}&state=before`,
  `index.html?bundle=${identity.sha256}&source=${identity.sourceCarrierSha256}&packed=${identity.packedCarrierSha256}&ledger=${identity.residualLedgerSha256}&routeRequested=${witnessRoute.requested}&routeEffective=${witnessRoute.effective}&state=packed`,
  `index.html?bundle=${identity.sha256}&source=${identity.sourceCarrierSha256}&packed=${identity.packedCarrierSha256}&ledger=${identity.residualLedgerSha256}&routeRequested=${witnessRoute.requested}&routeEffective=${witnessRoute.effective}&state=before&view=side`,
  `index.html?bundle=${identity.sha256}&source=${identity.sourceCarrierSha256}&packed=${identity.packedCarrierSha256}&ledger=${identity.residualLedgerSha256}&routeRequested=${witnessRoute.requested}&routeEffective=${witnessRoute.effective}&state=packed&view=side`,
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
  outputs: {
    residualLedger: { path: 'residual-ledger.json', sha256: identity.residualLedgerSha256 },
  },
  visual: {
    viewer: { path: 'index.html', sha256: 'e'.repeat(64) },
    bundleIdentity: identity,
    route: witnessRoute,
    captureUrls: urls,
  },
};

const servedViewer = {
  url: 'http://127.0.0.1:8774/assay/index.html',
  sha256: 'e'.repeat(64),
  html: `<p>ledger ${identity.residualLedgerSha256}<br>` +
    `route requested ${witnessRoute.requested}<br>` +
    `route effective ${witnessRoute.effective}</p>`,
};

test('visual receipt validation binds served viewer, URLs, browser, and distinct pixels', () => {
  const result = validateMuscleCompartmentRingCageContactVisualReceipts({
    runReport,
    servedViewer,
    captureReports: urls.map((url, index) => report(url, String(index + 1).repeat(64))),
  });
  assert.equal(result.status, 'verified');
  assert.deepEqual(result.bundleIdentity, identity);
  assert.deepEqual(result.witnessRoute, witnessRoute);
  assert.deepEqual(result.residualLedger, runReport.outputs.residualLedger);
  assert.equal(result.captures.length, 4);
});

test('visual receipt validation rejects missing or mismatched ledger and witness-route identity', () => {
  const valid = urls.map((url, index) => report(url, String(index + 1).repeat(64)));
  const missingLedger = structuredClone(runReport);
  delete missingLedger.visual.bundleIdentity.residualLedgerSha256;
  assert.throws(() => validateMuscleCompartmentRingCageContactVisualReceipts({
    runReport: missingLedger,
    servedViewer,
    captureReports: valid,
  }), /residual ledger identity is missing/i);

  const mismatchedLedger = structuredClone(runReport);
  mismatchedLedger.outputs.residualLedger.sha256 = '0'.repeat(64);
  assert.throws(() => validateMuscleCompartmentRingCageContactVisualReceipts({
    runReport: mismatchedLedger,
    servedViewer,
    captureReports: valid,
  }), /residual ledger identity mismatch/i);

  const mismatchedRoute = structuredClone(runReport);
  mismatchedRoute.visual.route.effective = 'fallback-witness-route-v0';
  assert.throws(() => validateMuscleCompartmentRingCageContactVisualReceipts({
    runReport: mismatchedRoute,
    servedViewer,
    captureReports: valid,
  }), /witness route mismatch/i);
});

test('visual receipt validation rejects the plausible false-closure paths', () => {
  const valid = urls.map((url, index) => report(url, String(index + 1).repeat(64)));
  assert.throws(() => validateMuscleCompartmentRingCageContactVisualReceipts({
    runReport,
    servedViewer: { ...servedViewer, sha256: 'f'.repeat(64) },
    captureReports: valid,
  }), /served viewer identity/i);

  const staleRoute = structuredClone(valid);
  staleRoute[0].invocation.url = staleRoute[0].invocation.url.replace(identity.sha256, '0'.repeat(64));
  assert.throws(() => validateMuscleCompartmentRingCageContactVisualReceipts({
    runReport,
    servedViewer,
    captureReports: staleRoute,
  }), /capture URL mismatch/i);

  const browserError = structuredClone(valid);
  browserError[1].stderr.tail = 'Uncaught SyntaxError: Invalid or unexpected token';
  assert.throws(() => validateMuscleCompartmentRingCageContactVisualReceipts({
    runReport,
    servedViewer,
    captureReports: browserError,
  }), /browser console failure/i);

  const identical = structuredClone(valid);
  identical[1].primaryOutput.sha256 = identical[0].primaryOutput.sha256;
  assert.throws(() => validateMuscleCompartmentRingCageContactVisualReceipts({
    runReport,
    servedViewer,
    captureReports: identical,
  }), /distinct capture pixels/i);
});
