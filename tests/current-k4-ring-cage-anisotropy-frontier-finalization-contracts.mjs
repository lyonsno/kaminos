import assert from 'node:assert/strict';
import test from 'node:test';

import {
  finalizeCurrentK4RingCageAnisotropyFrontierVisual,
} from '../tools/finalize-current-k4-ring-cage-anisotropy-frontier-visual.mjs';

function fixture() {
  const baseUrl = 'http://127.0.0.1:8780/artifacts/assay/visual/';
  const manifest = {
    schema: 'kaminos.current-k4-ring-cage-anisotropy-frontier-visual-manifest.v0',
    status: 'prepared-pending-capture',
    identity: { sha256: 'a'.repeat(64) },
    inputs: { sweep: { sha256: 'b'.repeat(64) } },
    selectedReference: {
      captureUrls: {
        primary: 'selected-reference/index.html?state=packed',
        side: 'selected-reference/index.html?state=packed&view=side',
      },
    },
    candidateIds: ['candidate-a'],
    candidates: [{
      id: 'candidate-a',
      captureUrls: {
        primary: 'candidates/candidate-a/index.html?state=packed',
        side: 'candidates/candidate-a/index.html?state=packed&view=side',
      },
    }],
  };
  const expected = [
    ['selected-reference:primary', manifest.selectedReference.captureUrls.primary],
    ['selected-reference:side', manifest.selectedReference.captureUrls.side],
    ['candidate-a:primary', manifest.candidates[0].captureUrls.primary],
    ['candidate-a:side', manifest.candidates[0].captureUrls.side],
    ['contact-sheet:primary', 'contact-sheet.html'],
    ['contact-sheet:side', 'contact-sheet-side.html'],
  ];
  const captureEvidence = expected.map(([key, relative], index) => ({
    key,
    url: new URL(relative, baseUrl).href,
    sha256: String(index + 1).repeat(64).slice(0, 64),
    report: {
      status: 'complete',
      invocation: { url: new URL(relative, baseUrl).href },
      route: { fallbackUsed: false },
      browser: {
        effective: {
          kind: 'playwright-chromium-headless-shell',
          installedStableChrome: false,
        },
      },
      process: { cleanup: { status: 'complete-no-process-group-remains' } },
      primaryOutput: { sha256: String(index + 1).repeat(64).slice(0, 64) },
    },
  }));
  return {
    sweep: {
      schema: 'kaminos.current-k4-ring-cage-anisotropy-sweep-result.v0',
      status: 'completed',
      nondominatedCandidateIds: ['candidate-a'],
    },
    runReport: {
      schema: 'kaminos.current-k4-ring-cage-anisotropy-sweep-run-report.v0',
      status: 'completed',
      outputs: { sweepResult: { sha256: 'b'.repeat(64) } },
      visual: {
        status: 'pending-agent-inspection',
        route: {
          requested: 'current-k4-ring-cage-anisotropy-frontier-contact-sheet-v0',
          effective: null,
          fallbackUsed: null,
        },
      },
    },
    manifest,
    captureEvidence,
    inspection: {
      preparedManifestIdentitySha256: 'a'.repeat(64),
      status: 'agent-inspected-rejected-no-admissible-frontier-opening',
      visualDisposition: 'reject-constant-area-anisotropy-for-current-k4',
      visibleDeltaAgainstAcceptedDirection: 'No candidate opened a clean lane.',
      nextMechanism: 'longitudinally-redistributed-total-volume-accommodation',
    },
    baseUrl,
  };
}

test('frontier finalization makes the visual rejection visible to run-report consumers', () => {
  const input = fixture();
  const result = finalizeCurrentK4RingCageAnisotropyFrontierVisual(input);
  assert.equal(result.verification.status, 'verified');
  assert.equal(result.verification.captures.length, 6);
  assert.equal(result.manifest.status,
    'agent-inspected-rejected-no-admissible-frontier-opening');
  assert.equal(result.runReport.visual.status, result.manifest.status);
  assert.equal(result.runReport.resultStatus,
    'reject-constant-area-anisotropy-for-current-k4');
  assert.deepEqual(result.runReport.visual.route, {
    requested: 'current-k4-ring-cage-anisotropy-frontier-contact-sheet-v0',
    effective: 'current-k4-ring-cage-anisotropy-frontier-contact-sheet-v0',
    fallbackUsed: false,
  });
  assert.equal(result.inspection.nextMechanism,
    'longitudinally-redistributed-total-volume-accommodation');
  const repeated = finalizeCurrentK4RingCageAnisotropyFrontierVisual({
    ...input,
    manifest: result.manifest,
    runReport: result.runReport,
  });
  assert.deepEqual(repeated, result,
    'visual finalization must be idempotent after the first admitted rejection');
});

test('frontier finalization rejects stable Chrome, stale URLs, and missing captures', () => {
  const stable = fixture();
  stable.captureEvidence[0].report.browser.effective.installedStableChrome = true;
  assert.throws(
    () => finalizeCurrentK4RingCageAnisotropyFrontierVisual(stable),
    /stable Chrome/i,
  );
  const stale = fixture();
  stale.captureEvidence[1].report.invocation.url = 'http://127.0.0.1/stale';
  assert.throws(
    () => finalizeCurrentK4RingCageAnisotropyFrontierVisual(stale),
    /capture URL mismatch/i,
  );
  const partial = fixture();
  partial.captureEvidence.pop();
  assert.throws(
    () => finalizeCurrentK4RingCageAnisotropyFrontierVisual(partial),
    /capture key mismatch/i,
  );
});
