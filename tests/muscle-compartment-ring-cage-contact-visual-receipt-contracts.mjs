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
  if (authored) parsed.searchParams.set('captureBatch', authoredBatchIdentity.sha256);
  return {
    schema: 'kaminos.receipt-bearing-browser-capture.v0',
    status: 'complete',
    route: {
      requested: authored
        ? 'independent-headless-same-page-screenshot-v1'
        : 'independent-headless-screenshot-v0',
      effective: authored
        ? 'independent-headless-same-page-screenshot-v1'
        : 'independent-headless-screenshot-v0',
      fallbackUsed: false,
    },
    browser: { effective: { installedStableChrome: false } },
    invocation: {
      url:authored ? parsed.href : `http://127.0.0.1:8774/assay/${url}`,
      captureBatchIdentity:authored ? structuredClone(authoredBatchIdentity) : null,
    },
    process: { cleanup: { status: 'complete-no-process-group-remains' } },
    stderr: { tail: 'GPU stall due to ReadPixels' },
    primaryOutput: { sha256: hash, sizeBytes: 190000, png: { width: 1400, height: 900 } },
    frameReceipt:authored ? {
      status:'complete',
      route:'same-cdp-page-frame-v0',
      captureBatchIdentitySha256:authoredBatchIdentity.sha256,
      dataset: {
        witnessLoaded:'true',
        witnessRenderComplete:'true',
        witnessRenderFrame:'3',
        witnessCaptureBatch:authoredBatchIdentity.sha256,
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
    domReceipt:null,
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

const authoredBatchIdentity = {
  schema:'kaminos.authored-packing-trajectory-capture-batch-identity.v0',
  id:'fixture-batch',
  generation:authoredIdentity.generation,
  bundleSha256:authoredIdentity.sha256,
  routeRequested:authoredRoute.requested,
  routeEffective:authoredRoute.effective,
  semanticViews:[],
  viewport:{ width:1400, height:900 },
  sha256:'6'.repeat(64),
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
authoredBatchIdentity.semanticViews = authoredViewSpecs.map(([state, view, diagnostics]) => {
  if (state === 'packed' && !view && diagnostics) return 'packed-diagnostic';
  return `${state}-${view || 'front'}`;
});

function authoredEvidence() {
  const reports = authoredUrls.map((url, index) =>
    report(url, (index + 10).toString(16).padStart(64, '0')));
  const reportSha256s = reports.map((_, index) =>
    (index + 20).toString(16).padStart(64, '0'));
  const semanticViews = authoredBatchIdentity.semanticViews;
  const plannedCaptures = reports.map((entry, index) => ({
    semanticView:semanticViews[index],
    url:entry.invocation.url,
    outputPath:`${semanticViews[index]}.png`,
    reportPath:`${semanticViews[index]}-capture-report.json`,
  }));
  const currentPngOutputs = reports.map((entry, index) => ({
    path:plannedCaptures[index].outputPath,
    sha256:entry.primaryOutput.sha256,
    sizeBytes:entry.primaryOutput.sizeBytes,
    png:entry.primaryOutput.png,
    visualSignal:{
      admission:'nonblank-v0',
      channelRange:255,
      nonUniformPixels:1000,
    },
  }));
  return {
    reports,
    reportSha256s,
    currentPngOutputs,
    batch:{
      path:'capture-batch-report.json',
      sha256:'7'.repeat(64),
      report:{
        schema:'kaminos.authored-packing-trajectory-capture-batch.v1',
        status:'completed',
        batchIdentity:authoredBatchIdentity,
        generation:authoredIdentity.generation,
        bundleIdentity:authoredIdentity,
        route:authoredRoute,
        viewport:{ width:1400, height:900 },
        plannedCaptures,
        captures:plannedCaptures.map((capture, index) => ({
          ...capture,
          requestedUrl:capture.url,
          batchIdentitySha256:authoredBatchIdentity.sha256,
          reportSha256:reportSha256s[index],
          sha256:reports[index].primaryOutput.sha256,
          sizeBytes:reports[index].primaryOutput.sizeBytes,
        })),
      },
    },
  };
}

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
  const evidence = authoredEvidence();
  const result = validateMuscleCompartmentRingCageContactVisualReceipts({
    runReport: authoredRunReport,
    servedViewer: authoredServedViewer,
    captureReports:evidence.reports,
    captureBatch:evidence.batch,
    captureReportSha256s:evidence.reportSha256s,
    currentPngOutputs:evidence.currentPngOutputs,
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
  const evidence = authoredEvidence();
  const valid = evidence.reports;

  const staleGeneration = structuredClone(authoredRunReport);
  staleGeneration.generation = '7'.repeat(64);
  assert.throws(() => validateMuscleCompartmentRingCageContactVisualReceipts({
    runReport: staleGeneration,
    servedViewer: authoredServedViewer,
    captureReports: valid,
    captureBatch:evidence.batch,
    captureReportSha256s:evidence.reportSha256s,
    currentPngOutputs:evidence.currentPngOutputs,
  }), /generation mismatch/i);

  const missingState = structuredClone(authoredRunReport);
  missingState.visual.captureUrls.splice(1, 1);
  assert.throws(() => validateMuscleCompartmentRingCageContactVisualReceipts({
    runReport: missingState,
    servedViewer: authoredServedViewer,
    captureReports: valid.slice(1),
    captureBatch:evidence.batch,
    captureReportSha256s:evidence.reportSha256s.slice(1),
    currentPngOutputs:evidence.currentPngOutputs.slice(1),
  }), /ten declared authored views/i);

  const duplicateState = structuredClone(authoredRunReport);
  duplicateState.visual.captureUrls[1] = duplicateState.visual.captureUrls[0];
  const duplicateReports = structuredClone(valid);
  duplicateReports[1].invocation.url = duplicateReports[0].invocation.url;
  assert.throws(() => validateMuscleCompartmentRingCageContactVisualReceipts({
    runReport: duplicateState,
    servedViewer: authoredServedViewer,
    captureReports: duplicateReports,
    captureBatch:evidence.batch,
    captureReportSha256s:evidence.reportSha256s,
    currentPngOutputs:evidence.currentPngOutputs,
  }), /duplicate or unexpected authored view/i);
});

test('authored visual verification rejects a foreign batch even when capture reports still look valid', () => {
  const evidence = authoredEvidence();
  const valid = evidence.reports;
  assert.throws(() => validateMuscleCompartmentRingCageContactVisualReceipts({
    runReport: authoredRunReport,
    servedViewer: authoredServedViewer,
    captureReports: valid,
    captureBatch: {
      path:'capture-batch-report.json',
      sha256:'6'.repeat(64),
      report: {
        schema:'kaminos.authored-packing-trajectory-capture-batch.v1',
        status:'completed',
        generation:'7'.repeat(64),
        captures:[],
      },
    },
    captureReportSha256s:evidence.reportSha256s,
    currentPngOutputs:evidence.currentPngOutputs,
  }), /batch|generation/i);
});

test('authored verification rejects current-byte, mixed-batch, render-completion, and blank-frame forgeries', () => {
  const scenarios = [
    {
      name:'replaced current PNG',
      mutate:evidence => { evidence.currentPngOutputs[2].sha256 = '0'.repeat(64); },
      error:/current PNG byte identity/i,
    },
    {
      name:'mixed same-generation capture batch',
      mutate:evidence => {
        evidence.reports[4].invocation.captureBatchIdentity.sha256 = '1'.repeat(64);
      },
      error:/capture report byte or batch identity/i,
    },
    {
      name:'stale capture report bytes',
      mutate:evidence => { evidence.reportSha256s[6] = '2'.repeat(64); },
      error:/capture report byte or batch identity/i,
    },
    {
      name:'not-render-complete frame',
      mutate:evidence => {
        evidence.reports[7].frameReceipt.dataset.witnessRenderComplete = 'false';
      },
      error:/render completion/i,
    },
    {
      name:'structurally valid blank frame',
      mutate:evidence => {
        evidence.currentPngOutputs[9].visualSignal = {
          admission:'blank-or-near-uniform-v0',
          channelRange:0,
          nonUniformPixels:0,
        };
      },
      error:/blank|visually rendered/i,
    },
    {
      name:'partial in-progress batch beside old-looking receipts',
      mutate:evidence => { evidence.batch.report.status = 'in-progress'; },
      error:/completed.*capture batch/i,
    },
  ];
  for (const scenario of scenarios) {
    const evidence = authoredEvidence();
    scenario.mutate(evidence);
    assert.throws(() => validateMuscleCompartmentRingCageContactVisualReceipts({
      runReport:authoredRunReport,
      servedViewer:authoredServedViewer,
      captureReports:evidence.reports,
      captureBatch:evidence.batch,
      captureReportSha256s:evidence.reportSha256s,
      currentPngOutputs:evidence.currentPngOutputs,
    }), scenario.error, scenario.name);
  }
});
