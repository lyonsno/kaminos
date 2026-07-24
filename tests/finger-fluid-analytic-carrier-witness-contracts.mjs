import assert from 'node:assert/strict';

import {
  validateFingerFluidAnalyticCarrierWitnessReport,
} from '../finger-fluid-analytic-carrier-witness-contract.js';

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
  schema: 'kaminos.finger-fluid.analytic-carrier-visual-witness.v1',
  ok: true,
  failure_phase: null,
  primary_output_written: true,
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
      requestedRoute: 'kaminos.finger-fluid.source-derived-swept-volume-quadrature.v0',
      effectiveRoute: 'kaminos.finger-fluid.source-derived-swept-volume-quadrature.v0',
      fallbackRoute: null,
      sourceIdentity,
      admittedCarrierSourceIdentity: sourceIdentity,
      particleSuppressionContract: 'matching-source-pre-impact-age-exclusive-visibility-v0',
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
      },
    }),
    expectedError,
    `${label} must fail even when every self-reported identity agrees`,
  );
}

console.log('finger fluid analytic carrier witness contracts passed');
