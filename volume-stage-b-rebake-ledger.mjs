#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  MANDATORY_STAGE_B_CONTROLS,
  PRODUCTION_STAGE_B_FIXED,
  defaultStageBControls,
} from './volume-stage-b-analytical-rebake.mjs';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const route = option('--route', 'http://127.0.0.1:18791/api/rebake');
const outputPath = resolve(option('--out', 'artifacts/pyro-control-path-parity-audit/stage-b-control-coupling-ledger.json'));
const expectedFixedProductionControlsIdentity = createHash('sha256')
  .update(JSON.stringify(PRODUCTION_STAGE_B_FIXED))
  .digest('hex');
const alternatives = Object.freeze({
  volume_reaction_boundary_fire_tip: 0,
  volume_reaction_boundary_topology: 2.5,
  volume_reaction_boundary_fire_erosion: 1,
  volume_reaction_boundary_cut: 0.08,
  volume_reaction_boundary_softness: 0.4,
  volume_reaction_boundary_core_reject: 0.2,
  volume_reaction_boundary_support_thermal: 2,
  volume_reaction_boundary_support_reaction: 2,
  volume_reaction_boundary_support_front: 2,
  volume_reaction_boundary_support_interface: 2,
  volume_reaction_boundary_fire_ridge: 0.25,
  volume_reaction_boundary_fire_ridge_cut: 0.45,
  volume_reaction_boundary_curl: 2,
  volume_reaction_boundary_divergence: 1,
});

async function persist(value) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`);
}

async function requestRebake(controls) {
  const response = await fetch(route, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ controls }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `stage-b-ledger-http-${response.status}`);
  if (response.url !== new URL(route).href) throw new Error(`stage-b-ledger-route-mismatch:${route}:${response.url}`);
  if (result.receipt?.status !== 'effective') throw new Error('stage-b-ledger-receipt-not-effective');
  if (result.receipt.fallback !== null) throw new Error(`stage-b-ledger-fallback:${result.receipt.fallback}`);
  if (JSON.stringify(result.receipt.fixedProductionControls) !== JSON.stringify(PRODUCTION_STAGE_B_FIXED)) {
    throw new Error('fixed-production-controls-drift:values');
  }
  if (result.receipt.fixedProductionControlsIdentity !== expectedFixedProductionControlsIdentity) {
    throw new Error('fixed-production-controls-drift:identity');
  }
  return { ...result, effectiveRoute: response.url };
}

function meanAbsoluteChannelDelta(leftBase64, rightBase64) {
  const left = Buffer.from(leftBase64, 'base64');
  const right = Buffer.from(rightBase64, 'base64');
  if (left.byteLength !== right.byteLength) throw new Error('stage-b-ledger-pixel-byte-length-drift');
  let delta = 0;
  let channels = 0;
  for (let index = 0; index < left.byteLength; index += 4) {
    delta += Math.abs(left[index] - right[index]);
    delta += Math.abs(left[index + 1] - right[index + 1]);
    delta += Math.abs(left[index + 2] - right[index + 2]);
    channels += 3;
  }
  return delta / channels;
}

function compactReceipt(receipt) {
  return {
    requestedControls: receipt.requestedControls,
    effectiveControls: receipt.effectiveControls,
    controlsIdentity: receipt.controlsIdentity,
    fixedProductionControls: receipt.fixedProductionControls,
    fixedProductionControlsIdentity: receipt.fixedProductionControlsIdentity,
    sourceStateIdentity: receipt.sourceStateIdentity,
    stageBIdentity: receipt.stageBIdentity,
    candidateIdentity: receipt.candidateIdentity,
    coefficientIdentity: receipt.coefficientIdentity,
    covarianceIdentity: receipt.covarianceIdentity,
    depositionIdentity: receipt.depositionIdentity,
    pixelIdentity: receipt.pixelIdentity,
    candidateCount: receipt.candidateCount,
    depositCount: receipt.depositCount,
    coefficientSummary: receipt.coefficientSummary,
    covarianceSummary: receipt.covarianceSummary,
    geometrySummary: receipt.geometrySummary,
    opticalLayers: receipt.opticalLayers,
    appliedPasses: receipt.appliedPasses,
    fallback: receipt.fallback,
    postLoadMutation: receipt.postLoadMutation,
    simulatorAdvanced: receipt.simulatorAdvanced,
    elapsedMs: receipt.elapsedMs,
  };
}

let failurePhase = 'baseline-rebake';
let lastTrustworthyEvidence = { route };
try {
  const baselineControls = defaultStageBControls();
  const baselineResult = await requestRebake(baselineControls);
  const baseline = compactReceipt(baselineResult.receipt);
  lastTrustworthyEvidence = baseline;
  const rows = [];
  failurePhase = 'per-control-perturbation';
  for (const control of MANDATORY_STAGE_B_CONTROLS) {
    const requestedControls = { ...baselineControls, [control]: alternatives[control] };
    const treatmentResult = await requestRebake(requestedControls);
    const treatment = compactReceipt(treatmentResult.receipt);
    if (treatment.sourceStateIdentity !== baseline.sourceStateIdentity) throw new Error(`source-state-drift:${control}`);
    if (treatmentResult.effectiveRoute !== baselineResult.effectiveRoute) throw new Error(`effective-route-drift:${control}`);
    if (treatment.fixedProductionControlsIdentity !== baseline.fixedProductionControlsIdentity) throw new Error(`fixed-production-controls-drift:${control}`);
    if (treatment.requestedControls[control] !== requestedControls[control]) throw new Error(`requested-control-drift:${control}`);
    if (treatment.effectiveControls[control] !== requestedControls[control]) throw new Error(`effective-control-drift:${control}`);
    const deltas = {
      stageBIdentityChanged: treatment.stageBIdentity !== baseline.stageBIdentity,
      candidateIdentityChanged: treatment.candidateIdentity !== baseline.candidateIdentity,
      candidateCount: treatment.candidateCount - baseline.candidateCount,
      coefficientIdentityChanged: treatment.coefficientIdentity !== baseline.coefficientIdentity,
      coefficientSum: treatment.coefficientSummary.coefficientSum - baseline.coefficientSummary.coefficientSum,
      covarianceIdentityChanged: treatment.covarianceIdentity !== baseline.covarianceIdentity,
      depositionIdentityChanged: treatment.depositionIdentity !== baseline.depositionIdentity,
      depositCount: treatment.depositCount - baseline.depositCount,
      pixelIdentityChanged: treatment.pixelIdentity !== baseline.pixelIdentity,
      meanAbsoluteChannelDelta: meanAbsoluteChannelDelta(baselineResult.pixelsBase64, treatmentResult.pixelsBase64),
    };
    const status = deltas.stageBIdentityChanged
      && deltas.coefficientIdentityChanged
      && deltas.depositionIdentityChanged
      && deltas.pixelIdentityChanged
      && deltas.meanAbsoluteChannelDelta > 0
      ? 'rebake-coupled'
      : 'missing';
    const row = {
      control,
      status,
      requested: requestedControls[control],
      effective: treatment.effectiveControls[control],
      sourceStateIdentity: treatment.sourceStateIdentity,
      deltas,
      treatment,
    };
    rows.push(row);
    lastTrustworthyEvidence = row;
  }
  const missingInputs = rows.filter(row => row.status === 'missing').map(row => row.control);
  const ledger = {
    schema: 'kaminos.volume.stage-b-control-coupling-ledger.v0',
    status: missingInputs.length ? 'failed' : 'completed',
    failurePhase: missingInputs.length ? 'control-coupling-classification' : null,
    requestedRoute: route,
    effectiveRoute: baselineResult.effectiveRoute,
    fixedProductionControls: baseline.fixedProductionControls,
    fixedProductionControlsIdentity: baseline.fixedProductionControlsIdentity,
    sourceStateIdentity: baseline.sourceStateIdentity,
    mandatoryControlCount: MANDATORY_STAGE_B_CONTROLS.length,
    baseline,
    rows,
    statusCounts: {
      'rebake-coupled': rows.filter(row => row.status === 'rebake-coupled').length,
      missing: missingInputs.length,
    },
    missingInputs,
  };
  await persist(ledger);
  if (missingInputs.length) throw new Error(`stage-b-control-coupling-missing:${missingInputs.join(',')}`);
  console.log(JSON.stringify({
    status: ledger.status,
    outputPath,
    sourceStateIdentity: ledger.sourceStateIdentity,
    mandatoryControlCount: ledger.mandatoryControlCount,
    statusCounts: ledger.statusCounts,
  }));
} catch (error) {
  if (!String(error?.message || '').startsWith('stage-b-control-coupling-missing:')) {
    await persist({
      schema: 'kaminos.volume.stage-b-control-coupling-ledger.v0',
      status: 'failed',
      failurePhase,
      requestedRoute: route,
      effectiveRoute: null,
      error: error?.message || String(error),
      lastTrustworthyEvidence,
    });
  }
  console.error(error?.stack || error);
  process.exitCode = 1;
}
