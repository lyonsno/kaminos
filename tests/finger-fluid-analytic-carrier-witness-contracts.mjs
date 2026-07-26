import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  validateFingerFluidAnalyticCarrierWitnessReport,
} from '../finger-fluid-analytic-carrier-witness-contract.js';

const witnessSource = await readFile(
  new URL('../finger-fluid-analytic-carrier-witness.mjs', import.meta.url),
  'utf8',
);
assert.match(
  witnessSource,
  /finger_fluid_witness_start_step=64[\s\S]*finger_fluid_witness_target_step=72/,
  'the witness must route separate deterministic start and final boundaries',
);
assert.match(
  witnessSource,
  /stepCount === dynamicStartTargetStep[\s\S]*witnessStartAutoPaused === true/,
  'the dynamic start capture must require the exact routed auto-pause instead of polling across a frame window',
);
assert.doesNotMatch(
  witnessSource,
  /stepCount >= dynamicStartTargetStep[\s\S]{0,160}stepCount < targetStep/,
  'the dynamic start witness must not depend on catching a narrow browser animation interval',
);
assert.match(
  witnessSource,
  /analyticOnlyVisualDelta = measurePngDelta[\s\S]*primaryOutputWritten = true/,
  'primary output completion must follow the complete same-state comparison set',
);

const sourceIdentity = {
  packetId: 'outfoxed-analytic-carrier-smoke-source-v1',
  sourceRoute: 'kaminos/finger-fluid-bench/analytic-carrier-smoke-source-v1',
  artifactSha256: '76b920f0af55234c2d64b8ec1807029409af3873b0d25ef702ec580f44da73f3',
  generation: 1,
  sourceMechanicsRevision: '3db86bc203c954fb76d301e21b0ba7126d5c36be',
  ageContract: 'gpu-material-tracer-release-age-v0',
};
const camera = {
  yaw: -0.62,
  pitch: 0.52,
  distance: 6.2,
  target: [0, -0.48, 0.2],
};
const baseReport = {
  schema: 'kaminos.finger-fluid.analytic-carrier-visual-witness.v2',
  ok: true,
  failure_phase: null,
  primary_output_written: true,
  outputFiles: [
    '/tmp/witness/dynamic-hybrid-start.png',
    '/tmp/witness/dynamic-hybrid-end.png',
    '/tmp/witness/hybrid-analytic-carrier.png',
    '/tmp/witness/analytic-carrier-only.png',
    '/tmp/witness/particle-only.png',
  ],
  requestedUrl: 'http://127.0.0.1:48220/index.html?kaminos_finger_fluid_bench=1',
  effectiveUrl: 'http://127.0.0.1:48220/index.html?kaminos_finger_fluid_bench=1',
  servedSourceIdentity: {
    'index.html': { exactLocalMatch: true },
    'finger-fluid-webgpu-core.js': { exactLocalMatch: true },
  },
  backend: {
    solver: 'webgpu_compute',
    renderer: 'webgpu_direct_render',
    solverRoute: 'webgpu-pbf-linked-cell-fluid-v0',
    rendererRoute: 'webgpu-screen-space-liquid-refraction-v0',
  },
  sourceIdentity,
  sameState: {
    exact: true,
    stepCount: 72,
    camera,
  },
  captures: {
    hybrid_analytic_carrier: {
      requestedMode: 'hybrid_analytic_carrier',
      effectiveMode: 'hybrid_analytic_carrier',
      requestedRoute: 'kaminos.finger-fluid.source-derived-tangent-capsule-quadrature.v0',
      effectiveRoute: 'kaminos.finger-fluid.source-derived-tangent-capsule-quadrature.v0',
      fallbackRoute: null,
      sourceIdentity,
      admittedCarrierSourceIdentity: sourceIdentity,
      particleSuppressionContract: 'matching-source-pre-impact-age-exclusive-visibility-v0',
      canonicalParticleVisibility: 'matching_pre_impact_suppressed',
      stepCount: 72,
      camera,
      sampleCount: 24,
      carrierDrawCount: 1,
      accumulationDrawCount: 4,
      primaryOutputWritten: true,
      visual: {
        pixelCount: 600_000,
        activePixels: 310_000,
        activeRatio: 0.516667,
        partial: false,
      },
    },
    analytic_carrier_only: {
      requestedMode: 'analytic_carrier_only',
      effectiveMode: 'analytic_carrier_only',
      requestedRoute: 'kaminos.finger-fluid.source-derived-tangent-capsule-quadrature.v0',
      effectiveRoute: 'kaminos.finger-fluid.source-derived-tangent-capsule-quadrature.v0',
      fallbackRoute: null,
      sourceIdentity,
      admittedCarrierSourceIdentity: sourceIdentity,
      particleSuppressionContract: null,
      canonicalParticleVisibility: 'hidden',
      stepCount: 72,
      camera,
      sampleCount: 24,
      carrierDrawCount: 1,
      accumulationDrawCount: 5,
      primaryOutputWritten: true,
      visual: {
        pixelCount: 600_000,
        activePixels: 250_000,
        activeRatio: 0.416667,
        partial: false,
      },
    },
    particle_only: {
      requestedMode: 'particle_only',
      effectiveMode: 'particle_only',
      requestedRoute: 'particle_only',
      effectiveRoute: 'particle_only',
      fallbackRoute: null,
      sourceIdentity,
      stepCount: 72,
      camera,
      sampleCount: 0,
      carrierDrawCount: 0,
      accumulationDrawCount: 4,
      admittedCarrierSourceIdentity: null,
      particleSuppressionContract: null,
      canonicalParticleVisibility: 'all',
      primaryOutputWritten: true,
      visual: {
        pixelCount: 600_000,
        activePixels: 300_000,
        activeRatio: 0.5,
        partial: false,
      },
    },
  },
  visualDelta: {
    changedPixels: 10_000,
    changedRatio: 0.016667,
    meanAbsoluteChannelDelta: 1.8,
  },
  analyticOnlyVisualDelta: {
    changedPixels: 34_000,
    changedRatio: 0.056667,
    meanAbsoluteChannelDelta: 4.2,
  },
  dynamicOutput: {
    requestedMode: 'hybrid_analytic_carrier',
    effectiveMode: 'hybrid_analytic_carrier',
    requestedRoute: 'kaminos.finger-fluid.source-derived-tangent-capsule-quadrature.v0',
    effectiveRoute: 'kaminos.finger-fluid.source-derived-tangent-capsule-quadrature.v0',
    fallbackRoute: null,
    startStep: 64,
    endStep: 72,
    camera,
    startVisual: {
      pixelCount: 600_000,
      activePixels: 295_000,
      activeRatio: 0.491667,
      partial: false,
    },
    endVisual: {
      pixelCount: 600_000,
      activePixels: 310_000,
      activeRatio: 0.516667,
      partial: false,
    },
    visualDelta: {
      changedPixels: 42_000,
      changedRatio: 0.07,
      meanAbsoluteChannelDelta: 3.1,
    },
  },
};

assert.equal(validateFingerFluidAnalyticCarrierWitnessReport(baseReport).ok, true);

assert.throws(
  () => validateFingerFluidAnalyticCarrierWitnessReport({
    ...baseReport,
    captures: {
      ...baseReport.captures,
      hybrid_analytic_carrier: {
        ...baseReport.captures.hybrid_analytic_carrier,
        effectiveRoute: 'fallback-sphere-splats',
        fallbackRoute: 'fallback-sphere-splats',
      },
    },
  }),
  /fallback|route/i,
  'a fallback carrier backend must fail evidence validation',
);

assert.throws(
  () => validateFingerFluidAnalyticCarrierWitnessReport({
    ...baseReport,
    captures: {
      ...baseReport.captures,
      hybrid_analytic_carrier: {
        ...baseReport.captures.hybrid_analytic_carrier,
        requestedMode: 'not_requested',
      },
    },
  }),
  /requested mode|stale|default/i,
  'a stale or default mode must not impersonate the requested hybrid route',
);

assert.throws(
  () => validateFingerFluidAnalyticCarrierWitnessReport({
    ...baseReport,
    captures: {
      ...baseReport.captures,
      particle_only: {
        ...baseReport.captures.particle_only,
        visual: {
          ...baseReport.captures.particle_only.visual,
          activePixels: 0,
          activeRatio: 0,
          partial: true,
        },
      },
    },
  }),
  /blank|partial/i,
  'blank or partial output must fail instead of becoming a comparison frame',
);

assert.throws(
  () => validateFingerFluidAnalyticCarrierWitnessReport({
    ...baseReport,
    ok: false,
    failure_phase: 'capture-hybrid',
    primary_output_written: false,
    captures: {},
  }),
  /primary output|pre-output/i,
  'failure before primary output must remain a failed witness with a named phase',
);

const failureWitnessDir = await mkdtemp(join(tmpdir(), 'kaminos-analytic-carrier-failure-'));
try {
  const failureReportPath = join(failureWitnessDir, 'report.json');
  const failureRun = spawnSync(process.execPath, [
    new URL('../finger-fluid-analytic-carrier-witness.mjs', import.meta.url).pathname,
    '--url',
    'http://127.0.0.1:48220/index.html?kaminos_finger_fluid_bench=1'
      + '&finger_fluid_truth_scene=live_hand_inlets'
      + '&finger_fluid_renderer=screen_space_refraction'
      + '&finger_fluid_analytic_carrier=hybrid_analytic_carrier'
      + '&finger_fluid_witness_target_step=72',
    '--out-dir',
    failureWitnessDir,
    '--report',
    failureReportPath,
  ], {
    encoding: 'utf8',
  });
  assert.notEqual(failureRun.status, 0, 'the stale pre-browser witness route must fail');
  const failureReport = JSON.parse(await readFile(failureReportPath, 'utf8'));
  assert.equal(failureReport.ok, false);
  assert.equal(failureReport.failure_phase, 'validate-config');
  assert.equal(failureReport.primary_output_written, false);
  assert.ok(
    failureReport.lastTrustworthyEvidence
      && typeof failureReport.lastTrustworthyEvidence === 'object'
      && typeof failureReport.lastTrustworthyEvidence.phase === 'string'
      && failureReport.lastTrustworthyEvidence.phase.length > 0,
    'a pre-primary terminal report must preserve explicit last trustworthy evidence',
  );
} finally {
  await rm(failureWitnessDir, { recursive: true, force: true });
}

const malformedUrlWitnessDir = await mkdtemp(
  join(tmpdir(), 'kaminos-analytic-carrier-malformed-url-'),
);
try {
  const malformedUrlReportPath = join(malformedUrlWitnessDir, 'report.json');
  const malformedUrlRun = spawnSync(process.execPath, [
    new URL('../finger-fluid-analytic-carrier-witness.mjs', import.meta.url).pathname,
    '--url',
    'not-a-url',
    '--out-dir',
    malformedUrlWitnessDir,
    '--report',
    malformedUrlReportPath,
  ], {
    encoding: 'utf8',
  });
  assert.notEqual(malformedUrlRun.status, 0, 'a malformed witness URL must fail');
  const malformedUrlReport = JSON.parse(
    await readFile(malformedUrlReportPath, 'utf8'),
  );
  assert.equal(malformedUrlReport.ok, false);
  assert.equal(malformedUrlReport.failure_phase, 'validate-config');
  assert.equal(malformedUrlReport.primary_output_written, false);
  assert.ok(
    malformedUrlReport.lastTrustworthyEvidence
      && typeof malformedUrlReport.lastTrustworthyEvidence === 'object'
      && typeof malformedUrlReport.lastTrustworthyEvidence.phase === 'string'
      && malformedUrlReport.lastTrustworthyEvidence.phase.length > 0,
    'a malformed pre-browser URL must preserve the last trustworthy argument evidence',
  );
} finally {
  await rm(malformedUrlWitnessDir, { recursive: true, force: true });
}

assert.throws(
  () => validateFingerFluidAnalyticCarrierWitnessReport({
    ...baseReport,
    outputFiles: ['/tmp/witness/dynamic-hybrid-start.png'],
    captures: {},
    visualDelta: null,
    analyticOnlyVisualDelta: null,
    dynamicOutput: null,
  }),
  /primary output set|output set/i,
  'a partial dynamic-start screenshot must not impersonate the complete primary witness output set',
);

assert.throws(
  () => validateFingerFluidAnalyticCarrierWitnessReport({
    ...baseReport,
    captures: {
      ...baseReport.captures,
      particle_only: {
        ...baseReport.captures.particle_only,
        stepCount: 73,
      },
    },
  }),
  /same simulation state|step/i,
  'the A/B cannot advance the simulation between carrier modes',
);

assert.throws(
  () => validateFingerFluidAnalyticCarrierWitnessReport({
    ...baseReport,
    captures: {
      ...baseReport.captures,
      hybrid_analytic_carrier: {
        ...baseReport.captures.hybrid_analytic_carrier,
        admittedCarrierSourceIdentity: {
          ...sourceIdentity,
          artifactSha256: 'stale-carrier-artifact',
        },
        particleSuppressionContract: null,
      },
    },
  }),
  /admitted carrier source identity|suppression contract/i,
  'a live inlet packet cannot substitute for exact admitted-carrier and exclusivity evidence',
);

for (const [label, contamination] of [
  ['analytic samples', { sampleCount: 1 }],
  ['an analytic carrier draw', { carrierDrawCount: 1 }],
  ['an admitted carrier identity', { admittedCarrierSourceIdentity: sourceIdentity }],
  ['a particle suppression contract', {
    particleSuppressionContract: 'matching-source-pre-impact-age-exclusive-visibility-v0',
  }],
]) {
  assert.throws(
    () => validateFingerFluidAnalyticCarrierWitnessReport({
      ...baseReport,
      captures: {
        ...baseReport.captures,
        particle_only: {
          ...baseReport.captures.particle_only,
          ...contamination,
        },
      },
    }),
    /particle-only control|analytic carrier contamination|exclusive/i,
    `particle-only evidence contaminated by ${label} must fail`,
  );
}

for (const [label, identityMutation, expectedError] of [
  ['stale mechanics revision', {
    sourceMechanicsRevision: '6b55c522e69f1896208511eae03abd7abfda7f52',
  }, /source mechanics revision/i],
  ['missing mechanics revision', {
    sourceMechanicsRevision: undefined,
  }, /source mechanics revision/i],
  ['wrong stable-age contract', {
    ageContract: 'particle-position-w-live-age-v0',
  }, /age contract/i],
  ['missing stable-age contract', {
    ageContract: undefined,
  }, /age contract/i],
]) {
  const mutatedIdentity = {
    ...sourceIdentity,
    ...identityMutation,
  };
  assert.throws(
    () => validateFingerFluidAnalyticCarrierWitnessReport({
      ...baseReport,
      sourceIdentity: mutatedIdentity,
      captures: {
        ...baseReport.captures,
        hybrid_analytic_carrier: {
          ...baseReport.captures.hybrid_analytic_carrier,
          sourceIdentity: mutatedIdentity,
          admittedCarrierSourceIdentity: mutatedIdentity,
        },
        particle_only: {
          ...baseReport.captures.particle_only,
          sourceIdentity: mutatedIdentity,
        },
        analytic_carrier_only: {
          ...baseReport.captures.analytic_carrier_only,
          sourceIdentity: mutatedIdentity,
          admittedCarrierSourceIdentity: mutatedIdentity,
        },
      },
    }),
    expectedError,
    `${label} must fail even when every self-reported identity agrees`,
  );
}

console.log('finger fluid analytic carrier witness contracts passed');
