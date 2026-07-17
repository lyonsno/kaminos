#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PYRO_CONTROL_PATH_FROZEN_CAPTURE_SCHEMA = 'kaminos.pyro-control-path.browser-gpu-frozen-capture-comparison.v0';
export const PYRO_CONTROL_PATH_FROZEN_CAPTURE_MATRIX_SCHEMA = 'kaminos.pyro-control-path.browser-gpu-frozen-capture-matrix.v0';

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

export function buildFrozenCaptureMatrix({ enumerationCount, rows }) {
  if (!Number.isInteger(Number(enumerationCount)) || Number(enumerationCount) < 1) {
    throw new Error('frozen capture matrix requires a positive uncapped enumeration count');
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('frozen capture matrix requires at least one row');
  }
  const seenControls = new Set();
  const classifiedRows = rows.map((row, index) => {
    const comparison = row?.comparison;
    if (comparison?.schema !== PYRO_CONTROL_PATH_FROZEN_CAPTURE_SCHEMA) {
      throw new Error(`frozen capture matrix row ${index} has wrong comparison schema`);
    }
    if (seenControls.has(comparison.control)) {
      throw new Error(`frozen capture matrix has duplicate control ${comparison.control}`);
    }
    seenControls.add(comparison.control);
    const changedCompositions = comparison.captures
      .filter(captureHasMaterialDelta)
      .map(capture => capture.composition);
    const stageEvidence = {
      splatPresentation: changedCompositions.includes('splat-only-v0'),
      smokeHybridPresentation: changedCompositions.includes('smoke-raymarch-under-splats-v0'),
      fullRaymarchDiagnosticPresentation: changedCompositions.includes('full-raymarch-under-splats-diagnostic-v0'),
      splatAdmissionOrGeometryReadback: comparison.deltas.boundarySplatGpuProfile.candidateCopyBytesMeanAbs > 0,
    };
    const claimedStageProved = stageClaimProved(row.claimedStage, stageEvidence);
    const hasRouteSpecificEvidence = changedCompositions.length > 0;
    const classification = comparison.classification !== 'browser-gpu-frozen-capture-positive'
      ? 'falsified-before-stage-classification'
      : claimedStageProved
        ? 'proved-claimed-stage-coupling'
        : hasRouteSpecificEvidence
          ? row.routeSemantics === 'intentional-route-specific'
            ? 'intentional-route-specific-presentation-only'
            : 'negative-claimed-stage-uncoupled-with-route-specific-delta'
          : 'claimed-stage-uncoupled';
    const classified = {
      control: comparison.control,
      family: row.family || 'unclassified',
      claimedStage: row.claimedStage || 'unspecified',
      routeSemantics: row.routeSemantics || 'unclassified',
      classification,
      comparisonClassification: comparison.classification,
      staticClassificationDisposition: staticClassificationDisposition(row.staticEnumeration, classification, row.routeSemantics),
      requested: comparison.requested,
      identity: comparison.identity,
      fallback: comparison.fallback,
      postLoadMutation: comparison.postLoadMutation,
      appliedPasses: comparison.appliedPasses,
      sourceFieldHashes: row.sourceFieldHashes || [],
      sourceEvidence: row.sourceEvidence || [],
      staticEnumeration: row.staticEnumeration || null,
      comparisonArtifact: row.comparisonArtifact || null,
      changedCompositions,
      stageEvidence,
      deltas: comparison.deltas,
    };
    if (!claimedStageProved) {
      classified.falsifier = {
        tripped: true,
        reason: comparison.classification !== 'browser-gpu-frozen-capture-positive'
          ? `comparison stopped at ${comparison.classification}`
          : hasRouteSpecificEvidence
            ? `observed deltas do not reach claimed stage ${classified.claimedStage}`
            : `no downstream delta reaches claimed stage ${classified.claimedStage}`,
      };
    }
    return classified;
  });
  return {
    schema: PYRO_CONTROL_PATH_FROZEN_CAPTURE_MATRIX_SCHEMA,
    generatedAt: new Date().toISOString(),
    enumerationCount: Number(enumerationCount),
    auditedControlCount: classifiedRows.length,
    rows: classifiedRows,
    summary: {
      provedClaimedStageCouplingCount: classifiedRows.filter(row => row.classification === 'proved-claimed-stage-coupling').length,
      intentionalRouteSpecificCount: classifiedRows.filter(row => row.classification === 'intentional-route-specific-presentation-only').length,
      provedIntentionalRouteSpecificControlCount: classifiedRows.filter(row => row.classification === 'proved-claimed-stage-coupling' && row.routeSemantics === 'intentional-route-specific').length,
      negativeClaimedStageCouplingCount: classifiedRows.filter(row => row.classification === 'negative-claimed-stage-uncoupled-with-route-specific-delta').length,
      claimedStageUncoupledCount: classifiedRows.filter(row => row.classification === 'claimed-stage-uncoupled').length,
      preclassificationFalsifierCount: classifiedRows.filter(row => row.classification === 'falsified-before-stage-classification').length,
      falsifiedStaticClassificationHintCount: classifiedRows.filter(row => row.staticClassificationDisposition === 'falsified-static-raymarch-only-hint').length,
      falsifiedStaticRaymarchDownstreamCount: classifiedRows.filter(row => row.staticClassificationDisposition === 'falsified-static-raymarch-downstream-claim').length,
    },
  };
}

function staticClassificationDisposition(staticEnumeration, classification, routeSemantics) {
  if (!staticEnumeration?.classificationHint) return 'no-static-classification-hint';
  if (routeSemantics === 'intentional-route-specific' && staticEnumeration.downstreamStages?.includes('raymarch')) {
    return 'falsified-static-raymarch-downstream-claim';
  }
  if (staticEnumeration.classificationHint === 'raymarch-only-unimplemented') {
    return classification === 'proved-claimed-stage-coupling'
      ? 'falsified-static-raymarch-only-hint'
      : 'confirmed-static-raymarch-only-hint';
  }
  return 'static-classification-hint-not-adjudicated';
}

export function computeRgbPixelDelta(baselinePixels, treatmentPixels, { width, height }) {
  if (!(baselinePixels instanceof Uint8Array) || !(treatmentPixels instanceof Uint8Array)) {
    throw new Error('RGB pixel delta requires Uint8Array inputs');
  }
  if (baselinePixels.byteLength !== treatmentPixels.byteLength) {
    throw new Error('RGB pixel delta inputs have different byte lengths');
  }
  const pixelCount = Number(width) * Number(height);
  if (!Number.isInteger(pixelCount) || pixelCount < 1 || baselinePixels.byteLength !== pixelCount * 3) {
    throw new Error('RGB pixel delta dimensions do not match rgb24 byte length');
  }
  let changedPixelCount = 0;
  let materialChangedPixelCount = 0;
  let absoluteChannelDeltaSum = 0;
  let squaredChannelDeltaSum = 0;
  let maxAbsoluteChannelDelta = 0;
  let baselineNonblackPixelCount = 0;
  let treatmentNonblackPixelCount = 0;
  for (let offset = 0; offset < baselinePixels.byteLength; offset += 3) {
    let changed = false;
    let materialChanged = false;
    let baselineNonblack = false;
    let treatmentNonblack = false;
    for (let channel = 0; channel < 3; channel += 1) {
      const baseline = baselinePixels[offset + channel];
      const treatment = treatmentPixels[offset + channel];
      const delta = Math.abs(treatment - baseline);
      changed ||= delta !== 0;
      materialChanged ||= delta > 1;
      baselineNonblack ||= baseline !== 0;
      treatmentNonblack ||= treatment !== 0;
      absoluteChannelDeltaSum += delta;
      squaredChannelDeltaSum += delta * delta;
      maxAbsoluteChannelDelta = Math.max(maxAbsoluteChannelDelta, delta);
    }
    changedPixelCount += changed ? 1 : 0;
    materialChangedPixelCount += materialChanged ? 1 : 0;
    baselineNonblackPixelCount += baselineNonblack ? 1 : 0;
    treatmentNonblackPixelCount += treatmentNonblack ? 1 : 0;
  }
  const channelCount = baselinePixels.byteLength;
  return {
    identity: 'canvas-png-rgb24-pixel-delta-v0',
    width: Number(width),
    height: Number(height),
    pixelCount,
    changedPixelCount,
    changedPixelRatio: changedPixelCount / pixelCount,
    materialDeltaThreshold: 'at-least-one-channel-differs-by-more-than-one-8-bit-level',
    materialChangedPixelCount,
    materialChangedPixelRatio: materialChangedPixelCount / pixelCount,
    meanAbsoluteChannelDelta: absoluteChannelDeltaSum / channelCount,
    rootMeanSquareChannelDelta: Math.sqrt(squaredChannelDeltaSum / channelCount),
    maxAbsoluteChannelDelta,
    baselineNonblackPixelCount,
    treatmentNonblackPixelCount,
    nonblackPixelCountDelta: treatmentNonblackPixelCount - baselineNonblackPixelCount,
  };
}

function captureHasMaterialDelta(capture) {
  if (capture.deltas.pixel) {
    return Number(capture.deltas.pixel.materialChangedPixelCount) > 0
      || Number(capture.deltas.candidateCopyBytesAbs) > 0;
  }
  return capture.deltas.screenshotHashChanged
    || Number(capture.deltas.screenshotByteLengthAbs) > 0
    || Number(capture.deltas.candidateCopyBytesAbs) > 0;
}

export function hydrateFrozenCapturePixelDeltas(comparison, { ffmpegPath = 'ffmpeg' } = {}) {
  if (comparison?.schema !== PYRO_CONTROL_PATH_FROZEN_CAPTURE_SCHEMA) {
    throw new Error('pixel delta hydration requires a frozen capture comparison');
  }
  const captures = comparison.captures.map(capture => {
    const baseline = decodePngRgb24(capture.baseline.screenshot.path, ffmpegPath);
    const treatment = decodePngRgb24(capture.treatment.screenshot.path, ffmpegPath);
    if (baseline.width !== treatment.width || baseline.height !== treatment.height) {
      throw new Error(`${capture.composition} baseline/treatment screenshot dimensions differ`);
    }
    return {
      ...capture,
      deltas: {
        ...capture.deltas,
        pixel: computeRgbPixelDelta(baseline.pixels, treatment.pixels, baseline),
      },
    };
  });
  const pixelDeltas = captures.map(capture => capture.deltas.pixel);
  const materialChangedCompositionCount = captures.filter(captureHasMaterialDelta).length;
  const classification = comparison.classification === 'browser-gpu-frozen-capture-requested-effective-mismatch'
    || comparison.classification === 'browser-gpu-frozen-capture-source-step-drift'
    ? comparison.classification
    : materialChangedCompositionCount > 0
      ? 'browser-gpu-frozen-capture-positive'
      : 'browser-gpu-frozen-capture-no-delta';
  const hydrated = {
    ...comparison,
    classification,
    deltas: {
      ...comparison.deltas,
      pixel: {
        identity: 'canvas-png-rgb24-pixel-delta-summary-v0',
        decoder: `ffmpeg-rgb24:${ffmpegPath}`,
        materialDeltaThreshold: 'at-least-one-channel-differs-by-more-than-one-8-bit-level',
        materialChangedCompositionCount,
        changedPixelRatioMean: mean(pixelDeltas.map(delta => delta.changedPixelRatio)),
        meanAbsoluteChannelDeltaMean: mean(pixelDeltas.map(delta => delta.meanAbsoluteChannelDelta)),
        rootMeanSquareChannelDeltaMean: mean(pixelDeltas.map(delta => delta.rootMeanSquareChannelDelta)),
        nonblackPixelCountDeltaMean: mean(pixelDeltas.map(delta => delta.nonblackPixelCountDelta)),
      },
    },
    captures,
  };
  if (classification === 'browser-gpu-frozen-capture-no-delta') {
    hydrated.catches = 'requested-effective-match-with-zero-material-browser-gpu-frozen-capture-delta';
    hydrated.falsifier = {
      tripped: true,
      reason: 'requested/effective controls and frozen source identity match, but decoded canvas pixels contain only exact matches or one-level quantization noise',
    };
  }
  return hydrated;
}

function decodePngRgb24(path, ffmpegPath) {
  const encoded = readFileSync(path);
  if (encoded.byteLength < 24 || encoded.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`screenshot is not a PNG: ${path}`);
  }
  const width = encoded.readUInt32BE(16);
  const height = encoded.readUInt32BE(20);
  const decoded = spawnSync(ffmpegPath, [
    '-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
  ], { encoding: null, maxBuffer: 128 * 1024 * 1024 });
  if (decoded.error) throw new Error(`PNG decoder failed for ${path}: ${decoded.error.message}`);
  if (decoded.status !== 0) {
    throw new Error(`PNG decoder failed for ${path}: ${String(decoded.stderr || '').trim()}`);
  }
  const pixels = new Uint8Array(decoded.stdout.buffer, decoded.stdout.byteOffset, decoded.stdout.byteLength);
  if (pixels.byteLength !== width * height * 3) {
    throw new Error(`PNG decoder returned ${pixels.byteLength} bytes for ${width}x${height} rgb24 image ${path}`);
  }
  return { width, height, pixels };
}

function stageClaimProved(claimedStage, stageEvidence) {
  if (claimedStage === 'splat-presentation') return stageEvidence.splatPresentation;
  if (claimedStage === 'smoke-hybrid-presentation') return stageEvidence.smokeHybridPresentation;
  if (claimedStage === 'full-raymarch-diagnostic-presentation') return stageEvidence.fullRaymarchDiagnosticPresentation;
  if (claimedStage === 'splat-admission-or-geometry-readback') return stageEvidence.splatAdmissionOrGeometryReadback;
  return false;
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
  const reportSourceComparable = sourceStatesComparable(baselineReport, treatmentReport);
  const captureSourceComparable = captures.every(item => captureSourceStepComparable(item, baselineReport, treatmentReport));
  const sourceStateComparable = reportSourceComparable && captureSourceComparable;
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
      reportSourceComparable,
      captureSourceComparable,
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

function captureSourceStepComparable(item, baselineReport, treatmentReport) {
  const baselineStep = Number(baselineReport.sameStateSimStep);
  const treatmentStep = Number(treatmentReport.sameStateSimStep);
  return Number(item.baseline.beforeSimStepCount) === baselineStep
    && Number(item.baseline.simStepCount) === baselineStep
    && Number(item.treatment.beforeSimStepCount) === treatmentStep
    && Number(item.treatment.simStepCount) === treatmentStep
    && Number(item.baseline.beforeSimStepCount) === Number(item.treatment.beforeSimStepCount)
    && Number(item.baseline.simStepCount) === Number(item.treatment.simStepCount);
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
  const comparison = hydrateFrozenCapturePixelDeltas(buildFrozenCaptureComparison({
    control: requiredArg(args, '--control'),
    requestedBaseline: requiredArg(args, '--requested-baseline'),
    requestedTreatment: requiredArg(args, '--requested-treatment'),
    baselineReport: await loadFrozenCaptureReport(baselineReportPath),
    treatmentReport: await loadFrozenCaptureReport(treatmentReportPath),
  }));
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
