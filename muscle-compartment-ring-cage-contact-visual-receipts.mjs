export const MUSCLE_COMPARTMENT_RING_CAGE_CONTACT_VISUAL_RECEIPT_SCHEMA =
  'kaminos.current-k4-ring-cage-contact-visual-receipt-verification.v0';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

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
  require(Array.isArray(visual.captureUrls) && visual.captureUrls.length === 4,
    'exactly four identity-bound capture URLs are required');
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
    return {
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
    'identity-bound assay requires distinct capture pixels for all four source/proposal views');

  return {
    schema: MUSCLE_COMPARTMENT_RING_CAGE_CONTACT_VISUAL_RECEIPT_SCHEMA,
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
        residualLedgerSha256: visual.bundleIdentity.residualLedgerSha256,
        routeRequested: visual.route.requested,
        routeEffective: visual.route.effective,
      },
    },
    captures,
  };
}
