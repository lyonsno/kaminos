#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PYRO_CONTROL_PATH_FROZEN_CAPTURE_SCHEMA = 'kaminos.pyro-control-path.browser-gpu-frozen-capture-comparison.v0';

const REQUIRED_COMPOSITIONS = Object.freeze([
  'splat-only-v0',
  'smoke-raymarch-under-splats-v0',
  'full-raymarch-under-splats-diagnostic-v0',
]);

const EXPECTED_ROUTE = 'exact-basin-selective-head-live-v0';
const EXPECTED_SAME_STATE_AUTHORITY = 'same-state-selective-render-composition-v0';
const EXPECTED_WITNESS_SCHEMA = 'kaminos.volume.selective-head-composition-witness.v0';

export function buildFrozenCaptureWitnessUrl(baseUrl, params = {}) {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export async function loadFrozenCaptureReport(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function writeFrozenCaptureComparison(path, comparison) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(comparison, null, 2)}\n`);
}

export function buildFrozenCaptureComparison({
  control,
  requestedBaseline,
  requestedTreatment,
  baselineReport,
  treatmentReport,
}) {
  assertCapturedReport(baselineReport, 'baseline');
  assertCapturedReport(treatmentReport, 'treatment');
  if (!control) throw new Error('frozen capture comparison requires a control');
  const baselineControlValue = reportControlValue(baselineReport, control, 'baseline');
  const treatmentControlValue = reportControlValue(treatmentReport, control, 'treatment');
  const baselineEffectiveValue = reportEffectiveControlValue(baselineReport, control, 'baseline');
  const treatmentEffectiveValue = reportEffectiveControlValue(treatmentReport, control, 'treatment');
  const effectiveEqualsRequested = baselineControlValue === String(requestedBaseline)
    && treatmentControlValue === String(requestedTreatment);
  const effectiveControlsMatchRequested = controlValuesEqual(baselineEffectiveValue, requestedBaseline)
    && controlValuesEqual(treatmentEffectiveValue, requestedTreatment);
  const baselineByComposition = capturesByComposition(baselineReport);
  const treatmentByComposition = capturesByComposition(treatmentReport);
  const captures = REQUIRED_COMPOSITIONS.map(composition => {
    const baseline = requiredCapture(baselineByComposition, composition, 'baseline');
    const treatment = requiredCapture(treatmentByComposition, composition, 'treatment');
    return {
      composition,
      baseline: captureEvidence(baseline),
      treatment: captureEvidence(treatment),
      passReceipt: {
        baseline: baseline.passReceipt,
        treatment: treatment.passReceipt,
      },
      deltas: {
        screenshotHashChanged: baseline.screenshot.sha256 !== treatment.screenshot.sha256,
        screenshotByteLengthAbs: Math.abs(Number(treatment.screenshot.byteLength || 0) - Number(baseline.screenshot.byteLength || 0)),
        candidateCopyBytesAbs: Math.abs(
          Number(treatment.boundarySplatGpuProfile?.candidateCopyBytes || 0)
          - Number(baseline.boundarySplatGpuProfile?.candidateCopyBytes || 0),
        ),
      },
    };
  });
  const screenshotHashChangedCount = captures.filter(item => item.deltas.screenshotHashChanged).length;
  const screenshotByteLengthMeanAbs = mean(captures.map(item => item.deltas.screenshotByteLengthAbs));
  const candidateCopyBytesMeanAbs = mean(captures.map(item => item.deltas.candidateCopyBytesAbs));
  const hasDownstreamDelta = screenshotHashChangedCount > 0
    || screenshotByteLengthMeanAbs > 0
    || candidateCopyBytesMeanAbs > 0;
  const sourceStateComparable = sourceStatesComparable(baselineReport, treatmentReport);
  const passReceipts = captures.flatMap(item => [item.passReceipt.baseline, item.passReceipt.treatment]);
  const appliedPasses = {
    splatApplied: passReceipts.some(receipt => receipt?.splatApplied === true),
    raymarchApplied: passReceipts.some(receipt => receipt?.raymarchApplied === true),
  };
  const classification = !effectiveEqualsRequested || !effectiveControlsMatchRequested
    ? 'browser-gpu-frozen-capture-requested-effective-mismatch'
    : !sourceStateComparable
    ? 'browser-gpu-frozen-capture-source-step-drift'
    : hasDownstreamDelta
      ? 'browser-gpu-frozen-capture-positive'
      : 'browser-gpu-frozen-capture-no-delta';
  const comparison = {
    schema: PYRO_CONTROL_PATH_FROZEN_CAPTURE_SCHEMA,
    generatedAt: new Date().toISOString(),
    control,
    classification,
    requested: {
      baseline: requestedBaseline,
      treatment: requestedTreatment,
      baselineUrlValue: baselineControlValue,
      treatmentUrlValue: treatmentControlValue,
      baselineEffectiveValue,
      treatmentEffectiveValue,
      effectiveEqualsRequested: effectiveEqualsRequested && effectiveControlsMatchRequested,
    },
    identity: {
      witnessSchema: baselineReport.schema,
      baselineUrl: baselineReport.requestedUrl,
      treatmentUrl: treatmentReport.requestedUrl,
      effectiveRoute: baselineReport.effectiveRoute,
      modelIdentity: baselineReport.modelIdentity,
      sameStateAuthority: baselineReport.sameStateAuthority,
      baselineSimStep: baselineReport.sameStateSimStep,
      treatmentSimStep: treatmentReport.sameStateSimStep,
      sourceStateComparable,
      sourceStateIdentity: baselineReport.sourceStateIdentity,
    },
    fallback: fallbackReceipt(baselineReport, treatmentReport),
    postLoadMutation: postLoadMutationReceipt(baselineReport, treatmentReport),
    appliedPasses,
    deltas: {
      screenshotHashChangedCount,
      screenshotByteLengthMeanAbs,
      boundarySplatGpuProfile: {
        candidateCopyBytesMeanAbs,
      },
    },
    captures,
  };
  if (!effectiveEqualsRequested || !effectiveControlsMatchRequested) {
    comparison.catches = 'browser-gpu-frozen-capture-requested-effective-mismatch';
    comparison.falsifier = {
      tripped: true,
      reason: 'captured witness URL values or effective basin controls do not match the requested baseline/treatment perturbation',
    };
  } else if (!sourceStateComparable) {
    comparison.catches = 'browser-gpu-frozen-capture-source-step-drift';
    comparison.falsifier = {
      tripped: true,
      reason: 'baseline and treatment reports captured different source sim steps, so pixel deltas cannot prove a single frozen-state control perturbation',
    };
  } else if (!hasDownstreamDelta) {
    comparison.catches = 'requested-effective-match-with-zero-browser-gpu-frozen-capture-delta';
    comparison.falsifier = {
      tripped: true,
      reason: 'baseline and treatment witness reports preserve requested/effective route identity but produce no screenshot or boundary splat GPU profile delta',
    };
  }
  return comparison;
}

function assertCapturedReport(report, label) {
  if (!report || typeof report !== 'object') throw new Error(`${label} report is missing`);
  if (report.schema !== EXPECTED_WITNESS_SCHEMA) throw new Error(`${label} report has wrong schema: ${report.schema}`);
  if (report.status !== 'captured') throw new Error(`${label} report is not captured: ${report.status}`);
  if (report.failurePhase != null) throw new Error(`${label} report carries failure phase: ${report.failurePhase}`);
  if (report.effectiveRoute !== EXPECTED_ROUTE) throw new Error(`${label} report has wrong effective route: ${report.effectiveRoute}`);
  if (report.sameStateAuthority !== EXPECTED_SAME_STATE_AUTHORITY) throw new Error(`${label} report has wrong same-state authority: ${report.sameStateAuthority}`);
  if (Number.isFinite(Number(report.sameStateSimStep)) !== true) throw new Error(`${label} report sameStateSimStep is missing`);
  if (report.sourceStateIdentity?.identity !== 'selective-head-live-frozen-source-state-v0') throw new Error(`${label} report source state identity is missing`);
  if (report.sourceStateIdentity?.capturePaused !== true) throw new Error(`${label} report did not capture from a paused source state`);
  if (report.sourceStateIdentity?.warmupReceipt?.authority !== 'checksum-bound-exact-basin-step96-field-anchor-v0') throw new Error(`${label} report warmup receipt is missing checksum-bound authority`);
  if (report.effectiveControls?.identity !== 'selective-head-live-effective-basin-controls-v0') throw new Error(`${label} report effective controls are missing`);
  if (!Array.isArray(report.captures)) throw new Error(`${label} report captures are missing`);
  for (const composition of REQUIRED_COMPOSITIONS) {
    requiredCapture(capturesByComposition(report), composition, label);
  }
}

function capturesByComposition(report) {
  return new Map((report.captures || []).map(capture => [capture.composition, capture]));
}

function reportControlValue(report, control, label) {
  let url;
  try {
    url = new URL(report.requestedUrl);
  } catch (error) {
    throw new Error(`${label} report requestedUrl is not parseable: ${error.message}`);
  }
  const value = url.searchParams.get(control);
  if (value == null) throw new Error(`${label} report requestedUrl is missing ${control}`);
  return value;
}

function requiredCapture(captures, composition, label) {
  const capture = captures.get(composition);
  if (!capture) throw new Error(`${label} report missing ${composition} capture`);
  if (capture.effectiveComposition !== composition) throw new Error(`${label} ${composition} effective composition drifted`);
  if (!capture.screenshot?.sha256) throw new Error(`${label} ${composition} screenshot hash is missing`);
  if (capture.screenshot?.captureScope !== 'canvas-only') throw new Error(`${label} ${composition} screenshot is not canvas-only`);
  if (!capture.screenshot?.clip) throw new Error(`${label} ${composition} screenshot clip is missing`);
  if (!capture.passReceipt) throw new Error(`${label} ${composition} pass receipt is missing`);
  return capture;
}

function captureEvidence(capture) {
  return {
    requestedComposition: capture.requestedComposition,
    effectiveComposition: capture.effectiveComposition,
    compositionAuthority: capture.compositionAuthority,
    role: capture.role,
    roleAuthority: capture.roleAuthority,
    simStepCount: capture.simStepCount,
    beforeSimStepCount: capture.beforeSimStepCount,
    frameCount: capture.frameCount,
    renderElapsedMs: capture.renderElapsedMs,
    boundarySplatGpuProfile: capture.boundarySplatGpuProfile || null,
    screenshot: capture.screenshot,
    sha256: capture.screenshot.sha256,
  };
}

function mean(values) {
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / Math.max(1, values.length);
}

function reportEffectiveControlValue(report, control, label) {
  const value = report.effectiveControls?.[control];
  if (value == null) throw new Error(`${label} report effective controls are missing ${control}`);
  return value;
}

function controlValuesEqual(actual, expected) {
  const actualNumber = Number(actual);
  const expectedNumber = Number(expected);
  if (Number.isFinite(actualNumber) && Number.isFinite(expectedNumber)) {
    return Math.abs(actualNumber - expectedNumber) <= 1e-6;
  }
  return String(actual) === String(expected);
}

function sourceStatesComparable(baselineReport, treatmentReport) {
  if (Number(baselineReport.sameStateSimStep) !== Number(treatmentReport.sameStateSimStep)) return false;
  return stableJson(baselineReport.sourceStateIdentity) === stableJson(treatmentReport.sourceStateIdentity);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fallbackReceipt(baselineReport, treatmentReport) {
  const baseline = baselineReport.fallback || null;
  const treatment = treatmentReport.fallback || null;
  return baseline || treatment ? { baseline, treatment } : null;
}

function postLoadMutationReceipt(baselineReport, treatmentReport) {
  const baseline = baselineReport.postLoadMutation || null;
  const treatment = treatmentReport.postLoadMutation || null;
  return baseline || treatment ? { baseline, treatment } : null;
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) values.set(key, true);
    else { values.set(key, next); index += 1; }
  }
  return values;
}

function requiredArg(args, name) {
  const value = args.get(name);
  if (!value || value === true) throw new Error(`missing ${name}`);
  return String(value);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baselineReportPath = requiredArg(args, '--baseline-report');
  const treatmentReportPath = requiredArg(args, '--treatment-report');
  const outPath = resolve(requiredArg(args, '--out'));
  const comparison = buildFrozenCaptureComparison({
    control: requiredArg(args, '--control'),
    requestedBaseline: requiredArg(args, '--requested-baseline'),
    requestedTreatment: requiredArg(args, '--requested-treatment'),
    baselineReport: await loadFrozenCaptureReport(baselineReportPath),
    treatmentReport: await loadFrozenCaptureReport(treatmentReportPath),
  });
  await writeFrozenCaptureComparison(outPath, comparison);
  console.log(JSON.stringify({
    schema: 'kaminos.pyro-control-path.frozen-capture-cli.v0',
    outPath,
    comparisonSchema: comparison.schema,
    control: comparison.control,
    classification: comparison.classification,
    screenshotHashChangedCount: comparison.deltas.screenshotHashChangedCount,
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
