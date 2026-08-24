import { createHash } from 'node:crypto';

export const MUSCLE_COMPARTMENT_RING_CAGE_CONTACT_VISUAL_RECEIPT_SCHEMA =
  'kaminos.current-k4-ring-cage-contact-visual-receipt-verification.v0';
export const AUTHORED_PACKING_TRAJECTORY_VISUAL_RECEIPT_SCHEMA =
  'kaminos.authored-packing-trajectory-visual-receipt-verification.v1';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const AUTHORED_VISUAL_BUNDLE_SCHEMA =
  'kaminos.authored-packing-trajectory-visual-bundle.v1';
const AUTHORED_CAPTURE_BATCH_SCHEMA =
  'kaminos.authored-packing-trajectory-capture-batch.v1';
const AUTHORED_CAPTURE_BATCH_IDENTITY_SCHEMA =
  'kaminos.authored-packing-trajectory-capture-batch-identity.v0';
const SAME_PAGE_CAPTURE_ROUTE = 'independent-headless-same-page-screenshot-v1';
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

function authoredBatchCaptureUrl(actualValue, expectedValue, batchIdentitySha256) {
  const expected = new URL(expectedValue, new URL(actualValue).origin +
    new URL(actualValue).pathname.replace(/[^/]+$/, ''));
  expected.searchParams.set('captureBatch', batchIdentitySha256);
  return sameCaptureUrl(actualValue, expected.href);
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

export function captureArtifactPathsForVisual(runReport) {
  return captureReportPathsForVisual(runReport).map(reportPath => {
    require(reportPath.endsWith('-capture-report.json'),
      `capture report does not have the required semantic suffix: ${reportPath}`);
    return {
      semanticView:reportPath.replace(/-capture-report\.json$/, ''),
      reportPath,
      outputPath:reportPath.replace(/-capture-report\.json$/, '.png'),
    };
  });
}

export function authoredCaptureBatchIdentitySha256(batchIdentity) {
  require(batchIdentity && typeof batchIdentity === 'object',
    'capture batch identity payload is missing');
  const { sha256:ignored, ...payload } = batchIdentity;
  return createHash('sha256')
    .update(`${JSON.stringify(payload, null, 2)}\n`)
    .digest('hex');
}

export function validateMuscleCompartmentRingCageContactVisualReceipts({
  runReport,
  servedViewer,
  captureReports,
  captureBatch = null,
  captureReportSha256s = null,
  currentPngOutputs = null,
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
    require(captureBatch?.report?.schema === AUTHORED_CAPTURE_BATCH_SCHEMA &&
      captureBatch.report.status === 'completed' &&
      SHA256_PATTERN.test(captureBatch.sha256 || ''),
    'authored visual verification requires one completed byte-identified capture batch');
    const batchIdentity = captureBatch.report.batchIdentity;
    require(batchIdentity?.schema === AUTHORED_CAPTURE_BATCH_IDENTITY_SCHEMA &&
      SHA256_PATTERN.test(batchIdentity.sha256 || '') &&
      batchIdentity.generation === runReport.generation &&
      batchIdentity.bundleSha256 === visual.bundleIdentity.sha256 &&
      batchIdentity.routeRequested === visual.route.requested &&
      batchIdentity.routeEffective === visual.route.effective &&
      JSON.stringify(batchIdentity.semanticViews) === JSON.stringify(AUTHORED_VIEW_ORDER),
    'capture batch identity or generation mismatch');
    require(
      authoredCaptureBatchIdentitySha256(batchIdentity) === batchIdentity.sha256,
      'capture batch identity SHA does not match its payload',
    );
    require(captureBatch.report.generation === runReport.generation &&
      captureBatch.report.bundleIdentity?.sha256 === visual.bundleIdentity.sha256 &&
      JSON.stringify(captureBatch.report.route) === JSON.stringify(visual.route),
    'completed capture batch does not bind the current run identity');
    require(Array.isArray(captureBatch.report.plannedCaptures) &&
      captureBatch.report.plannedCaptures.length === AUTHORED_VIEW_ORDER.length &&
      Array.isArray(captureBatch.report.captures) &&
      captureBatch.report.captures.length === AUTHORED_VIEW_ORDER.length,
    'completed capture batch does not contain the ten planned and completed views');
    require(Array.isArray(captureReportSha256s) &&
      captureReportSha256s.length === AUTHORED_VIEW_ORDER.length &&
      Array.isArray(currentPngOutputs) &&
      currentPngOutputs.length === AUTHORED_VIEW_ORDER.length,
    'authored verification must reopen current report and PNG bytes');
  } else {
    require(Array.isArray(visual.captureUrls) && visual.captureUrls.length === 4,
      'exactly four identity-bound capture URLs are required');
  }
  require(Array.isArray(captureReports) && captureReports.length === visual.captureUrls.length,
    'capture receipt count is incomplete');
  const canonicalArtifacts = authored ? captureArtifactPathsForVisual(runReport) : null;

  const captures = captureReports.map((report, index) => {
    require(report?.schema === 'kaminos.receipt-bearing-browser-capture.v0',
      `capture ${index} schema mismatch`);
    require(report.status === 'complete', `capture ${index} is incomplete`);
    const requiredCaptureRoute = authored
      ? SAME_PAGE_CAPTURE_ROUTE
      : 'independent-headless-screenshot-v0';
    require(report.route?.requested === requiredCaptureRoute &&
      report.route?.effective === requiredCaptureRoute &&
      report.route?.fallbackUsed === false, `capture ${index} route mismatch`);
    require(report.browser?.effective?.installedStableChrome === false,
      `capture ${index} used or failed to exclude installed stable Chrome`);
    require(report.process?.cleanup?.status === 'complete-no-process-group-remains',
      `capture ${index} process cleanup is incomplete`);
    const batchIdentity = authored ? captureBatch.report.batchIdentity : null;
    const plannedCapture = authored ? captureBatch.report.plannedCaptures[index] : null;
    const completedCapture = authored ? captureBatch.report.captures[index] : null;
    const canonicalArtifact = authored ? canonicalArtifacts[index] : null;
    if (authored) {
      require(plannedCapture?.semanticView === AUTHORED_VIEW_ORDER[index] &&
        completedCapture?.semanticView === AUTHORED_VIEW_ORDER[index] &&
        plannedCapture.outputPath === canonicalArtifact.outputPath &&
        completedCapture.outputPath === canonicalArtifact.outputPath &&
        plannedCapture.reportPath === canonicalArtifact.reportPath &&
        completedCapture.reportPath === canonicalArtifact.reportPath &&
        plannedCapture.outputPath === completedCapture.outputPath &&
        plannedCapture.reportPath === completedCapture.reportPath &&
        completedCapture.batchIdentitySha256 === batchIdentity.sha256,
      `capture batch row does not use the canonical report and PNG paths at index ${index}`);
      require(authoredBatchCaptureUrl(
        plannedCapture.url,
        visual.captureUrls[index],
        batchIdentity.sha256,
      ) && sameCaptureUrl(report.invocation?.url, plannedCapture.url) &&
        completedCapture.requestedUrl === plannedCapture.url,
      `capture URL or batch identity mismatch at index ${index}`);
      require(report.invocation?.captureBatchIdentity?.sha256 === batchIdentity.sha256 &&
        captureReportSha256s[index] === completedCapture.reportSha256,
      `capture report byte or batch identity mismatch at index ${index}`);
    } else {
      require(sameCaptureUrl(report.invocation?.url, visual.captureUrls[index]),
        `capture URL mismatch at index ${index}`);
    }
    const stderr = report.stderr?.tail || '';
    require(!/Uncaught|SyntaxError|identity-bound capture route mismatch/i.test(stderr),
      `browser console failure at capture ${index}`);
    require(SHA256_PATTERN.test(report.primaryOutput?.sha256 || '') &&
      report.primaryOutput?.sizeBytes > 0 &&
      report.primaryOutput?.png?.width > 0 &&
      report.primaryOutput?.png?.height > 0,
    `capture ${index} primary output is missing or blank`);
    if (authored) {
      const dataset = report.frameReceipt?.dataset;
      const currentPng = currentPngOutputs[index];
      require(report.frameReceipt?.status === 'complete' &&
        report.frameReceipt.route === 'same-cdp-page-frame-v0' &&
        report.frameReceipt.captureBatchIdentitySha256 === batchIdentity.sha256 &&
        dataset?.witnessLoaded === 'true' &&
        dataset?.witnessRenderComplete === 'true' &&
        Number(dataset?.witnessRenderFrame) >= 1 &&
        dataset?.witnessCaptureBatch === batchIdentity.sha256 &&
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
      `capture ${index} same-page frame identity or render completion mismatch`);
      require(currentPng?.path === canonicalArtifact.outputPath &&
        currentPng.path === completedCapture.outputPath &&
        currentPng.sha256 === report.primaryOutput.sha256 &&
        currentPng.sha256 === completedCapture.sha256 &&
        currentPng.sizeBytes === report.primaryOutput.sizeBytes &&
        currentPng.sizeBytes === completedCapture.sizeBytes &&
        currentPng.png?.width === report.primaryOutput.png.width &&
        currentPng.png?.height === report.primaryOutput.png.height,
      `capture ${index} current PNG byte identity mismatch`);
      require(currentPng.visualSignal?.admission === 'nonblank-v0' &&
        currentPng.visualSignal.channelRange >= 8 &&
        currentPng.visualSignal.nonUniformPixels >= 64,
      `capture ${index} current PNG is blank or not visually rendered`);
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
      captureBatchIdentitySha256:batchIdentity?.sha256 || null,
      currentPngSha256:authored ? currentPngOutputs[index].sha256 : null,
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
    captureBatch:authored ? {
      path:captureBatch.path,
      sha256:captureBatch.sha256,
      identity:captureBatch.report.batchIdentity,
    } : null,
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
