export const MUSCLE_COMPARTMENT_RING_CAGE_CONTACT_VISUAL_RECEIPT_SCHEMA =
  'kaminos.current-k4-ring-cage-contact-visual-receipt-verification.v0';
export const AUTHORED_PACKING_TRAJECTORY_VISUAL_RECEIPT_SCHEMA =
  'kaminos.authored-packing-trajectory-visual-receipt-verification.v1';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const AUTHORED_VISUAL_BUNDLE_SCHEMA =
  'kaminos.authored-packing-trajectory-visual-bundle.v1';
const AUTHORED_VIEW_ORDER = Object.freeze([
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
const LEGACY_CAPTURE_REPORTS = Object.freeze([
  'source-crowded-capture-report.json',
  'contact-relieved-capture-report.json',
  'source-crowded-side-capture-report.json',
  'contact-relieved-side-capture-report.json',
]);

function require(condition, message) {
  if (!condition) throw new Error(message);
}

function sameCaptureUrl(actualValue, expectedValue) {
  const actual = new URL(actualValue);
  const expected = new URL(expectedValue, actual.origin + actual.pathname.replace(/[^/]+$/, ''));
  if (actual.pathname !== expected.pathname) return false;
  const actualEntries = [...actual.searchParams.entries()].sort(([left], [right]) =>
    left.localeCompare(right));
  const expectedEntries = [...expected.searchParams.entries()].sort(([left], [right]) =>
    left.localeCompare(right));
  return JSON.stringify(actualEntries) === JSON.stringify(expectedEntries);
}

function authoredSemanticView(urlValue) {
  const url = new URL(urlValue, 'http://authored.invalid/');
  const state = url.searchParams.get('state');
  const view = url.searchParams.get('view');
  const diagnostics = url.searchParams.get('diagnostics');
  if (!['observed', 'initialized', 'packed'].includes(state)) return null;
  if (state === 'packed' && view === null &&
      diagnostics === 'wireframe,source-ghost,displacement,contacts') {
    return 'packed-diagnostic';
  }
  if (view === null && diagnostics === null) return `${state}-front`;
  if (view === 'side' && diagnostics === null) return `${state}-side`;
  if (view === 'contact' && diagnostics === 'contacts') return `${state}-contact`;
  return null;
}

export function captureReportPathsForVisual(runReport) {
  const visual = runReport?.visual;
  if (visual?.bundleIdentity?.schema !== AUTHORED_VISUAL_BUNDLE_SCHEMA) {
    return [...LEGACY_CAPTURE_REPORTS];
  }
  require(Array.isArray(visual.captureUrls) && visual.captureUrls.length === 10,
    'exactly ten declared authored views are required');
  const semanticViews = visual.captureUrls.map(authoredSemanticView);
  require(
    semanticViews.every((value, index) => value === AUTHORED_VIEW_ORDER[index]) &&
      new Set(semanticViews).size === AUTHORED_VIEW_ORDER.length,
    'duplicate or unexpected authored view in identity-bound capture URLs',
  );
  return semanticViews.map(view => `${view}-capture-report.json`);
}

export function validateMuscleCompartmentRingCageContactVisualReceipts({
  runReport,
  servedViewer,
  captureReports,
}) {
  require(runReport?.status === 'completed', 'visual receipts require a completed assay run');
  const visual = runReport.visual;
  require(visual?.bundleIdentity?.sha256, 'visual bundle identity is missing');
  require(SHA256_PATTERN.test(visual.bundleIdentity.residualLedgerSha256 || ''),
    'residual ledger identity is missing from the visual bundle');
  require(SHA256_PATTERN.test(runReport.outputs?.residualLedger?.sha256 || ''),
    'residual ledger output receipt is missing');
  require(
    runReport.outputs.residualLedger.sha256 === visual.bundleIdentity.residualLedgerSha256,
    'residual ledger identity mismatch between output receipt and visual bundle',
  );
  const authored = visual.bundleIdentity.schema === AUTHORED_VISUAL_BUNDLE_SCHEMA;
  if (authored) {
    require(SHA256_PATTERN.test(runReport.generation || '') &&
      runReport.generation === visual.bundleIdentity.generation,
    'generation mismatch between authored run report and visual bundle');
    for (const [outputKey, identityKey] of [
      ['observedCarrier', 'observedCarrierSha256'],
      ['initializedCarrier', 'initializedCarrierSha256'],
      ['packedCarrier', 'packedCarrierSha256'],
    ]) {
      require(SHA256_PATTERN.test(visual.bundleIdentity[identityKey] || '') &&
        runReport.outputs?.[outputKey]?.identitySha256 === visual.bundleIdentity[identityKey],
      `${outputKey} identity mismatch between output receipt and authored visual bundle`);
    }
  }
  require(
    typeof visual.route?.requested === 'string' && visual.route.requested.length > 0 &&
      typeof visual.route?.effective === 'string' && visual.route.effective.length > 0 &&
      visual.route.fallbackUsed === false &&
      visual.route.requested === visual.route.effective &&
      visual.route.effective === visual.bundleIdentity.route,
    'witness route mismatch between requested, effective, and bundle identities',
  );
  require(SHA256_PATTERN.test(visual.viewer?.sha256 || ''), 'viewer identity is missing');
  require(
    servedViewer?.sha256 === visual.viewer.sha256,
    `served viewer identity mismatch: expected ${visual.viewer.sha256}, got ` +
      `${servedViewer?.sha256 || 'missing'}`,
  );
  const visibleIdentity = servedViewer?.html || '';
  require(
    visibleIdentity.includes(`ledger ${visual.bundleIdentity.residualLedgerSha256}`) &&
      visibleIdentity.includes(`route requested ${visual.route.requested}`) &&
      visibleIdentity.includes(`route effective ${visual.route.effective}`),
    'served viewer does not visibly expose ledger and requested/effective witness-route identity',
  );
  if (authored) {
    require(
      visibleIdentity.includes(`generation ${visual.bundleIdentity.generation}`) &&
        visibleIdentity.includes(`observed ${visual.bundleIdentity.observedCarrierSha256}`) &&
        visibleIdentity.includes(`initialized ${visual.bundleIdentity.initializedCarrierSha256}`) &&
        visibleIdentity.includes(`proposal ${visual.bundleIdentity.packedCarrierSha256}`),
      'served authored viewer does not visibly expose generation and three-state identity',
    );
    require(Array.isArray(visual.captureUrls) && visual.captureUrls.length === 10,
      'exactly ten declared authored views are required');
    require(
      visual.captureUrls.every((url, index) =>
        authoredSemanticView(url) === AUTHORED_VIEW_ORDER[index]) &&
        new Set(visual.captureUrls.map(authoredSemanticView)).size === AUTHORED_VIEW_ORDER.length,
      'duplicate or unexpected authored view in identity-bound capture URLs',
    );
  } else {
    require(Array.isArray(visual.captureUrls) && visual.captureUrls.length === 4,
      'exactly four identity-bound capture URLs are required');
  }
  require(Array.isArray(captureReports) && captureReports.length === visual.captureUrls.length,
    'capture receipt count is incomplete');

  const captures = captureReports.map((report, index) => {
    require(report?.schema === 'kaminos.receipt-bearing-browser-capture.v0',
      `capture ${index} schema mismatch`);
    require(report.status === 'complete', `capture ${index} is incomplete`);
    require(report.route?.requested === 'independent-headless-screenshot-v0' &&
      report.route?.effective === 'independent-headless-screenshot-v0' &&
      report.route?.fallbackUsed === false, `capture ${index} route mismatch`);
    require(report.browser?.effective?.installedStableChrome === false,
      `capture ${index} used or failed to exclude installed stable Chrome`);
    require(report.process?.cleanup?.status === 'complete-no-process-group-remains',
      `capture ${index} process cleanup is incomplete`);
    require(sameCaptureUrl(report.invocation?.url, visual.captureUrls[index]),
      `capture URL mismatch at index ${index}`);
    const stderr = report.stderr?.tail || '';
    require(!/Uncaught|SyntaxError|identity-bound capture route mismatch/i.test(stderr),
      `browser console failure at capture ${index}`);
    require(SHA256_PATTERN.test(report.primaryOutput?.sha256 || '') &&
      report.primaryOutput?.sizeBytes > 0 &&
      report.primaryOutput?.png?.width > 0 &&
      report.primaryOutput?.png?.height > 0,
    `capture ${index} primary output is missing or blank`);
    if (authored) {
      const dataset = report.domReceipt?.dataset;
      require(report.domReceipt?.status === 'complete' &&
        dataset?.witnessLoaded === 'true' &&
        dataset?.witnessState === new URL(
          visual.captureUrls[index],
          'http://authored.invalid/',
        ).searchParams.get('state') &&
        dataset?.witnessRouteRequested === visual.route.requested &&
        dataset?.witnessRouteEffective === visual.route.effective &&
        dataset?.witnessBundle === visual.bundleIdentity.sha256 &&
        dataset?.witnessGeneration === visual.bundleIdentity.generation &&
        dataset?.observedCarrier === visual.bundleIdentity.observedCarrierSha256 &&
        dataset?.initializedCarrier === visual.bundleIdentity.initializedCarrierSha256 &&
        dataset?.packedCarrier === visual.bundleIdentity.packedCarrierSha256 &&
        dataset?.residualLedger === visual.bundleIdentity.residualLedgerSha256,
      `capture ${index} DOM identity mismatch`);
    }
    return {
      semanticView: authored ? authoredSemanticView(visual.captureUrls[index]) : null,
      requestedUrl: visual.captureUrls[index],
      effectiveUrl: report.invocation.url,
      sha256: report.primaryOutput.sha256,
      sizeBytes: report.primaryOutput.sizeBytes,
      viewport: report.primaryOutput.png,
      installedStableChrome: report.browser.effective.installedStableChrome,
      cleanupStatus: report.process.cleanup.status,
    };
  });
  require(new Set(captures.map(capture => capture.sha256)).size === captures.length,
    `identity-bound assay requires distinct capture pixels for all ${captures.length} declared views`);

  return {
    schema: authored
      ? AUTHORED_PACKING_TRAJECTORY_VISUAL_RECEIPT_SCHEMA
      : MUSCLE_COMPARTMENT_RING_CAGE_CONTACT_VISUAL_RECEIPT_SCHEMA,
    status: 'verified',
    bundleIdentity: visual.bundleIdentity,
    residualLedger: runReport.outputs.residualLedger,
    witnessRoute: visual.route,
    servedViewer: {
      requestedUrl: servedViewer.url,
      effectiveUrl: servedViewer.url,
      sha256: servedViewer.sha256,
      expectedSha256: visual.viewer.sha256,
      fallbackUsed: false,
      observedVisibleIdentity: {
        generation:visual.bundleIdentity.generation || null,
        observedCarrierSha256:visual.bundleIdentity.observedCarrierSha256 || null,
        initializedCarrierSha256:visual.bundleIdentity.initializedCarrierSha256 || null,
        packedCarrierSha256:visual.bundleIdentity.packedCarrierSha256,
        residualLedgerSha256: visual.bundleIdentity.residualLedgerSha256,
        routeRequested: visual.route.requested,
        routeEffective: visual.route.effective,
      },
    },
    captures,
  };
}
