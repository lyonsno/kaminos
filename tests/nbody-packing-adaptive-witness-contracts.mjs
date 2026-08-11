import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NBODY_PACKING_ADAPTIVE_WITNESS_ROUTE,
  renderNBodyPackingAdaptiveCarrierHtml,
  validateNBodyPackingAdaptiveCaptureBinding,
} from '../nbody-packing-adaptive-witness.mjs';
import {
  captureNBodyPackingAdaptiveState,
} from '../nbody-packing-adaptive-capture.mjs';

function muscle(id, x) {
  return {
    id,
    centerline:[
      { position:[x, -1, 0], radius:0.1 },
      { position:[x, 0, 0], radius:0.2 },
      { position:[x, 1, 0], radius:0.1 },
    ],
  };
}

test('adaptive viewer makes the stalled carrier a failure state and exposes direct four-way comparison', () => {
  const muscles = [muscle('left', -0.2), muscle('right', 0.2)];
  const fixture = {
    crowded:{ muscles, metrics:{ pairwisePenetration:0.2 } },
    knownFeasible:{
      muscles,
      metrics:{ pairwisePenetration:0 },
      compartment:{ minimum:[-1, -1.2, -1], maximum:[1, 1.2, 1] },
      obstacles:[],
    },
    metrics:{
      crowded:{ pairwisePenetration:0.2 },
      knownFeasible:{ pairwisePenetration:0 },
    },
  };
  const twoDofCandidate = {
    status:'stalled-unified-kkt-candidate',
    selected:{ muscles, metrics:{ pairwisePenetration:0.1 }, displacement:{ movedMemberCount:2 } },
  };
  const adaptiveCandidate = {
    status:'converged-unified-kkt-candidate',
    selected:{ muscles, metrics:{ pairwisePenetration:0 }, displacement:{ movedMemberCount:2 } },
  };
  const report = {
    route:{
      requested:NBODY_PACKING_ADAPTIVE_WITNESS_ROUTE,
      effective:NBODY_PACKING_ADAPTIVE_WITNESS_ROUTE,
      fallbackUsed:false,
    },
  };
  const html = renderNBodyPackingAdaptiveCarrierHtml({
    fixture,
    twoDofCandidate,
    adaptiveCandidate,
    report,
  });

  assert.match(html, /data-witness-state="crowded"/);
  assert.match(html, /<button data-state="crowded">Crowded input<\/button>/);
  assert.match(html, /<button data-state="two-dof-stalled">Two-DOF stalled · failed<\/button>/);
  assert.match(html, /<button data-state="adaptive-packed">Adaptive packed<\/button>/);
  assert.match(html, /<button data-state="reference">Manufactured reference<\/button>/);
  assert.match(html, /transparent volume/);
  assert.match(html, /opaque slice/);
  assert.match(html, /Stalled is failure evidence, not a packed result/);
  assert.match(html, /OrbitControls/);
  assert.doesNotMatch(html, /better|best|winner/i);
});

test('adaptive capture refuses invalid states and evidence viewport substitution before browser launch', async () => {
  await assert.rejects(
    captureNBodyPackingAdaptiveState({
      baseUrl:'http://127.0.0.1:18765/example',
      state:'packed',
      mode:'volume',
      outputPath:'/tmp/should-not-exist.png',
      reportPath:'/tmp/should-not-exist.json',
    }),
    /state must be crowded, two-dof-stalled, adaptive-packed, or reference/,
  );
  await assert.rejects(
    captureNBodyPackingAdaptiveState({
      baseUrl:'http://127.0.0.1:18765/example',
      state:'crowded',
      mode:'volume',
      outputPath:'/tmp/should-not-exist.png',
      reportPath:'/tmp/should-not-exist.json',
      viewport:{ width:800, height:600 },
    }),
    /adaptive evidence viewport must be exactly 1400x900/,
  );
});

test('adaptive visual binding rejects a stale primary witness behind a plausible route and state', () => {
  const report = {
    bindings:{
      fixtureJsonSha256:'fixture-current',
      resultsJsonSha256:'results-current',
      indexHtmlSha256:'index-current',
    },
  };
  const captureReport = {
    status:'complete',
    route:{ effective:'independent-headless-screenshot-v0', fallbackUsed:false },
    browser:{ effective:{ installedStableChrome:false, kind:'playwright-chromium-headless-shell' } },
    process:{
      cleanup:{ status:'complete-no-process-group-remains' },
      profileCleanup:{ status:'complete-removed' },
    },
    domReceipt:{ dataset:{
      witnessLoaded:'true',
      witnessState:'crowded',
      witnessMode:'volume',
      witnessRoute:NBODY_PACKING_ADAPTIVE_WITNESS_ROUTE,
      fixtureSha256:'fixture-current',
      resultsSha256:'results-current',
    } },
    sourceDocument:{
      status:'complete',
      url:'http://127.0.0.1:18765/adaptive/index.html?state=crowded&mode=volume',
      sha256:'index-current',
    },
    primaryOutput:{ sha256:'png-current' },
  };

  assert.doesNotThrow(() => validateNBodyPackingAdaptiveCaptureBinding({
    captureReport,
    state:'crowded',
    mode:'volume',
    report,
    pngSha256:'png-current',
  }));
  captureReport.sourceDocument.sha256 = 'index-stale';
  assert.throws(
    () => validateNBodyPackingAdaptiveCaptureBinding({
      captureReport,
      state:'crowded',
      mode:'volume',
      report,
      pngSha256:'png-current',
    }),
    /primary witness identity mismatch/,
  );
});
