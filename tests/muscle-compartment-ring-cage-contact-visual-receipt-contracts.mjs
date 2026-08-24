import assert from 'node:assert/strict';
import test from 'node:test';

import {
  captureReportPathsForVisual,
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
  const parsed = new URL(url, 'http://fixture.invalid/');
  const authored = parsed.searchParams.get('bundle') === authoredIdentity.sha256;
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
    domReceipt:authored ? {
      status:'complete',
      dataset: {
        witnessLoaded:'true',
        witnessState:parsed.searchParams.get('state'),
        witnessRouteRequested:authoredRoute.requested,
        witnessRouteEffective:authoredRoute.effective,
        witnessBundle:authoredIdentity.sha256,
        witnessGeneration:authoredIdentity.generation,
        observedCarrier:authoredIdentity.observedCarrierSha256,
        initializedCarrier:authoredIdentity.initializedCarrierSha256,
        packedCarrier:authoredIdentity.packedCarrierSha256,
        residualLedger:authoredIdentity.residualLedgerSha256,
      },
    } : null,
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

const authoredIdentity = {
  schema: 'kaminos.authored-packing-trajectory-visual-bundle.v1',
  route: 'authored-packing-trajectory-orbitable-v1',
  generation: '9'.repeat(64),
  observedCarrierSha256: 'a'.repeat(64),
  initializedCarrierSha256: 'b'.repeat(64),
  packedCarrierSha256: 'c'.repeat(64),
  sourceInputSha256: 'd'.repeat(64),
  residualLedgerSha256: 'e'.repeat(64),
  sha256: 'f'.repeat(64),
};

const authoredRoute = {
  requested: authoredIdentity.route,
  effective: authoredIdentity.route,
  fallbackUsed: false,
};

const authoredViewSpecs = [
  ['observed', null, null],
  ['initialized', null, null],
  ['packed', null, null],
  ['observed', 'side', null],
  ['initialized', 'side', null],
  ['packed', 'side', null],
  ['packed', null, 'wireframe,source-ghost,displacement,contacts'],
  ['observed', 'contact', 'contacts'],
  ['initialized', 'contact', 'contacts'],
  ['packed', 'contact', 'contacts'],
];

const authoredUrls = authoredViewSpecs.map(([state, view, diagnostics]) => {
  const query = new URLSearchParams({
    bundle: authoredIdentity.sha256,
    observed: authoredIdentity.observedCarrierSha256,
    initialized: authoredIdentity.initializedCarrierSha256,
    packed: authoredIdentity.packedCarrierSha256,
    ledger: authoredIdentity.residualLedgerSha256,
    routeRequested: authoredRoute.requested,
    routeEffective: authoredRoute.effective,
    state,
  });
  if (view) query.set('view', view);
  if (diagnostics) query.set('diagnostics', diagnostics);
  return `index.html?${query}`;
});

const authoredRunReport = {
  status: 'completed',
  generation: authoredIdentity.generation,
  outputs: {
    observedCarrier: {
      path: 'observed-carrier.json',
      sha256: '1'.repeat(64),
      identitySha256: authoredIdentity.observedCarrierSha256,
    },
    initializedCarrier: {
      path: 'initialized-carrier.json',
      sha256: '2'.repeat(64),
      identitySha256: authoredIdentity.initializedCarrierSha256,
    },
    packedCarrier: {
      path: 'packed-carrier.json',
      sha256: '3'.repeat(64),
      identitySha256: authoredIdentity.packedCarrierSha256,
    },
    residualLedger: { path: 'residual-ledger.json', sha256: authoredIdentity.residualLedgerSha256 },
  },
  visual: {
    viewer: { path: 'index.html', sha256: '8'.repeat(64) },
    bundleIdentity: authoredIdentity,
    route: authoredRoute,
    captureUrls: authoredUrls,
  },
};

const authoredServedViewer = {
  url: 'http://127.0.0.1:8774/assay/index.html',
  sha256: '8'.repeat(64),
  html: `<p>bundle ${authoredIdentity.sha256}<br>` +
    `generation ${authoredIdentity.generation}<br>` +
    `observed ${authoredIdentity.observedCarrierSha256}<br>` +
    `initialized ${authoredIdentity.initializedCarrierSha256}<br>` +
    `proposal ${authoredIdentity.packedCarrierSha256}<br>` +
    `ledger ${authoredIdentity.residualLedgerSha256}<br>` +
    `route requested ${authoredRoute.requested}<br>` +
    `route effective ${authoredRoute.effective}</p>`,
};

test('visual receipt validation binds served viewer, URLs, browser, and distinct pixels', () => {
  const result = validateMuscleCompartmentRingCageContactVisualReceipts({
    runReport,
    servedViewer,
    captureReports: urls.map((url, index) => report(url, String(index + 1).repeat(64))),
  });
  assert.equal(result.status, 'verified');
  assert.equal(result.schema, 'kaminos.current-k4-ring-cage-contact-visual-receipt-verification.v0');
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

test('authored visual receipt validation binds one generation to all ten declared views', () => {
  assert.deepEqual(captureReportPathsForVisual(authoredRunReport), [
    'observed-front-capture-report.json',
    'initialized-front-capture-report.json',
    'packed-front-capture-report.json',
    'observed-side-capture-report.json',
    'initialized-side-capture-report.json',
    'packed-side-capture-report.json',
    'packed-diagnostic-capture-report.json',
    'observed-contact-capture-report.json',
    'initialized-contact-capture-report.json',
    'packed-contact-capture-report.json',
  ]);
  const result = validateMuscleCompartmentRingCageContactVisualReceipts({
    runReport: authoredRunReport,
    servedViewer: authoredServedViewer,
    captureReports: authoredUrls.map((url, index) =>
      report(url, (index + 10).toString(16).padStart(64, '0'))),
  });
  assert.equal(result.status, 'verified');
  assert.equal(
    result.schema,
    'kaminos.authored-packing-trajectory-visual-receipt-verification.v1',
  );
  assert.equal(result.bundleIdentity.generation, authoredRunReport.generation);
  assert.equal(result.captures.length, 10);
  assert.deepEqual(result.captures.map(row => row.semanticView), [
    'observed-front',
    'initialized-front',
    'packed-front',
    'observed-side',
    'initialized-side',
    'packed-side',
    'packed-diagnostic',
    'observed-contact',
    'initialized-contact',
    'packed-contact',
  ]);
});

test('authored visual receipt validation rejects generation, state, and duplicate-view forgery', () => {
  const valid = authoredUrls.map((url, index) =>
    report(url, (index + 10).toString(16).padStart(64, '0')));

  const staleGeneration = structuredClone(authoredRunReport);
  staleGeneration.generation = '7'.repeat(64);
  assert.throws(() => validateMuscleCompartmentRingCageContactVisualReceipts({
    runReport: staleGeneration,
    servedViewer: authoredServedViewer,
    captureReports: valid,
  }), /generation mismatch/i);

  const missingState = structuredClone(authoredRunReport);
  missingState.visual.captureUrls.splice(1, 1);
  assert.throws(() => validateMuscleCompartmentRingCageContactVisualReceipts({
    runReport: missingState,
    servedViewer: authoredServedViewer,
    captureReports: valid.slice(1),
  }), /ten declared authored views/i);

  const duplicateState = structuredClone(authoredRunReport);
  duplicateState.visual.captureUrls[1] = duplicateState.visual.captureUrls[0];
  const duplicateReports = structuredClone(valid);
  duplicateReports[1].invocation.url = duplicateReports[0].invocation.url;
  assert.throws(() => validateMuscleCompartmentRingCageContactVisualReceipts({
    runReport: duplicateState,
    servedViewer: authoredServedViewer,
    captureReports: duplicateReports,
  }), /duplicate or unexpected authored view/i);
});
