#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  ANALYTICAL_FORCED_RESPONSE_IDENTITY,
  FORCED_SPLAT_RESPONSE_SCHEMA,
  MAX_INITIAL_RESIDUAL_SPLINE_KNOTS,
  buildAnalyticalForcedResponseReceipt,
  buildForcedSplatResponseControls,
  buildRigidTransformedHistoryControl,
  measureForcedSplatResponsePath,
  warpBoundarySplatByForcing,
} from './boundary-splat-forced-response.mjs';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith('--')) continue;
  const next = process.argv[index + 1];
  if (!next || next.startsWith('--')) {
    args.set(key, 'true');
  } else {
    args.set(key, next);
    index += 1;
  }
}

function intArg(name, fallback) {
  const value = Number(args.get(name));
  return Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : fallback;
}

function syntheticDescriptor(index) {
  return {
    schema: 'boundary-splat-instance-descriptor-v0',
    historySchema: 'boundary-splat-live-history-ring-v0',
    instanceId: `forced-plume-${index}`,
    sourceAttachment: 0.78 + (index % 5) * 0.035,
    transform: {
      translation: [(index % 10) * 0.055 - 0.25, 0, Math.floor(index / 10) * 0.055 - 0.25],
      yawRadians: index * 0.017,
      scale: 0.9 + (index % 7) * 0.025,
    },
    history: {
      source: 'canonical-live-history-slot',
      schema: 'boundary-splat-live-history-ring-v0',
      slot: index % 16,
      effectiveHistoryOffsetFrames: (index % 16) * 4,
      authority: 'live-gpu-candidate-history-ring',
    },
  };
}

function syntheticSplat(index, count) {
  const t = count <= 1 ? 0 : index / (count - 1);
  return {
    position: [
      0.045 * Math.sin(index * 2.17),
      0.08 + t * 1.24,
      0.045 * Math.cos(index * 1.63),
    ],
    highFrequencyOffset: [
      0.0035 * Math.sin(index * 7.1),
      0.0030 * Math.cos(index * 5.3),
      0.0035 * Math.sin(index * 3.7),
    ],
    shape: [0.014 + (index % 5) * 0.0008, 0.030 + (index % 9) * 0.001, 0.35 + t * 0.3, 0.85],
    colorOpacity: [0.76, 0.38 + t * 0.08, 0.10, 0.022 + t * 0.004],
    age: t,
    height: t,
  };
}

const requestedRoute = String(args.get('--requested-route') || 'forced-response-assay-local-synthetic-v0');
const reportPath = args.get('--report') ? resolve(String(args.get('--report'))) : null;
const splatCount = intArg('--splats', 128);
const maxInstances = intArg('--max-instances', 100);
const iterations = intArg('--iterations', 11);
const descriptors = Array.from({ length: maxInstances }, (_, index) => syntheticDescriptor(index));
const splats = Array.from({ length: splatCount }, (_, index) => syntheticSplat(index, splatCount));
const forcing = {
  dtSeconds: 1 / 30,
  gravityWorld: [0, -9.81, 0],
  windWorld: [0.55, 0.0, -0.28],
  objectLinearVelocityWorld: [0.95, 0.02, 0.12],
  objectLinearAccelerationWorld: [-2.4, 0.0, 0.35],
  objectAngularVelocityWorld: [0.08, 1.45, -0.03],
  recentForcing: [
    { dtSeconds: 1 / 30, linearAccelerationWorld: [-1.6, 0.0, 0.15], windWorld: [0.35, 0, -0.12] },
    { dtSeconds: 1 / 30, linearAccelerationWorld: [-2.1, 0.0, 0.22], windWorld: [0.45, 0, -0.20] },
    { dtSeconds: 1 / 30, linearAccelerationWorld: [-2.4, 0.0, 0.35], windWorld: [0.55, 0, -0.28] },
  ],
};

const controls = buildForcedSplatResponseControls({ descriptor: descriptors[0], ...forcing });
const rigid = buildRigidTransformedHistoryControl(splats[Math.floor(splats.length * 0.62)], descriptors[0]);
const analytical = warpBoundarySplatByForcing(splats[Math.floor(splats.length * 0.62)], descriptors[0], controls);
const cost = measureForcedSplatResponsePath({
  descriptors,
  splats,
  forcing,
  instanceCounts: [1, 16, 100],
  iterations,
});
const receipt = buildAnalyticalForcedResponseReceipt({
  requestedRoute,
  effectiveRoute: ANALYTICAL_FORCED_RESPONSE_IDENTITY,
  descriptor: descriptors[0],
  controls,
  splatCount,
  instanceCount: maxInstances,
  timing: cost,
});

const report = {
  schema: 'kaminos.boundary-splat-forced-response-assay-report.v0',
  status: cost.stopCeilingExceeded ? 'cpu-proxy-over-stop-ceiling-needs-gpu-materialization' : 'cpu-proxy-measured',
  requestedRoute,
  effectiveRoute: ANALYTICAL_FORCED_RESPONSE_IDENTITY,
  receiptSchema: FORCED_SPLAT_RESPONSE_SCHEMA,
  descriptorInventory: {
    currentCheckoutFinding: 'this branch has boundary splat candidates but no landed instance descriptor buffer or live history ring implementation',
    targetDescriptorSchema: 'boundary-splat-instance-descriptor-v0',
    targetHistorySchema: 'boundary-splat-live-history-ring-v0',
    requiredFields: [
      'instanceId',
      'transform.translation',
      'transform.yawRadians',
      'transform.scale',
      'sourceAttachment',
      'history.slot',
      'history.effectiveHistoryOffsetFrames',
      'history.authority',
    ],
  },
  simulatorControlInventory: {
    smallestMatchedTeacherControls: [
      'constant translation',
      'accelerate/stop',
      'lateral swing',
      'rotation relative to gravity',
      'changing wind',
      'combined trajectory',
    ],
    analyticalInputs: [
      'gravityWorld',
      'windWorld',
      'objectLinearVelocityWorld',
      'objectLinearAccelerationWorld',
      'objectAngularVelocityWorld',
      'recentForcing',
      'sourceAttachment',
      'age',
      'height',
    ],
  },
  rails: {
    residualSplineKnotBudget: MAX_INITIAL_RESIDUAL_SPLINE_KNOTS,
    residualHeadAdmission: 'not-admitted-until-visible-analytical-miss',
    latticeAdmission: 'not-admitted-until-visible-spline-spatial-capacity-failure',
    forbidden: ['per-splat neural inference', 'dense full-grid inference', 'long-horizon turbulence prediction'],
  },
  controlSample: controls,
  rigidSample: rigid,
  analyticalSample: analytical,
  receipt,
  cost,
};

if (reportPath) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
