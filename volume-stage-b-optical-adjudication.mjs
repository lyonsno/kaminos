export const STAGE_B_OPTICAL_ADJUDICATION_SCHEMA = 'kaminos.pyro.stage-b-optical-adjudication.v0';

const MODE = 'matched-optical-recurrence-v0';
const ACCUMULATION_FORMAT = 'rgba16float-array';
const LAYER_FORMAT = 'rgba16float';
const OUTPUT_FORMAT = 'rgba8unorm';
const DEPTH_BINS = 16;
const SHA256 = /^[0-9a-f]{64}$/i;

export function validateStageBOpticalAuthority(authority = {}) {
  requireValue(authority.sameStateCaptureId, 'same-state-capture-id-missing');
  for (const field of [
    'sourceManifestSha256',
    'manifestSha256',
    'fluidSha256',
    'frontSha256',
    'supportSha256',
    'coefficientSha256',
    'covarianceSha256',
    'candidatePayloadSha256',
    'controlsSha256',
  ]) {
    if (!SHA256.test(String(authority[field] || ''))) throw new Error(`authority-hash-missing-or-invalid:${field}`);
  }
  for (const [requested, effective] of [
    ['supportSha256', 'effectiveSupportSha256'],
    ['coefficientSha256', 'effectiveCoefficientSha256'],
    ['covarianceSha256', 'effectiveCovarianceSha256'],
    ['candidatePayloadSha256', 'effectiveCandidatePayloadSha256'],
    ['controlsSha256', 'effectiveControlsSha256'],
  ]) {
    if (authority[effective] && authority[effective] !== authority[requested]) {
      throw new Error(`authority-hash-substitution:${requested}`);
    }
  }
  if (authority.requestedMode !== MODE || authority.effectiveMode !== MODE) throw new Error('optical-mode-substitution');
  if (authority.requestedTargetFormat !== ACCUMULATION_FORMAT || authority.effectiveTargetFormat !== ACCUMULATION_FORMAT) {
    throw new Error('optical-target-format-substitution');
  }
  if (authority.layerFormat !== LAYER_FORMAT) throw new Error('optical-layer-format-substitution');
  if (authority.outputAttachmentFormat !== OUTPUT_FORMAT) throw new Error('presentation-attachment-format-substitution');
  if (authority.depthBins !== DEPTH_BINS) throw new Error('optical-depth-bin-substitution');
  if (!Number.isInteger(authority.candidateCount) || authority.candidateCount <= 0) throw new Error('candidate-count-invalid');
  if (!Number.isInteger(authority.capacity) || authority.capacity < authority.candidateCount) throw new Error('candidate-capacity-invalid');
  if (authority.overflowCount !== 0) throw new Error('candidate-overflow');
  if (authority.fallbackUsed !== false) throw new Error('fallback-used');
  if (authority.rendererRequested !== true || authority.rendererEncoded !== true || authority.rendererApplied !== true) {
    throw new Error('renderer-pass-incomplete');
  }
  return true;
}

export function adjudicateStageBOpticalLayers({
  width,
  height,
  layers = null,
  readPixel = null,
  gpuRgba,
  outputToleranceBytes = 2,
  includeAnalyticalRgba = null,
  authority,
} = {}) {
  validateStageBOpticalAuthority(authority);
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) throw new Error('invalid-optical-extent');
  const depthBins = authority.depthBins;
  if (layers) {
    if (!Array.isArray(layers) || layers.length !== depthBins) throw new Error('partial-optical-layers');
    const expectedLength = width * height * 4;
    if (layers.some(layer => !layer || layer.length !== expectedLength)) throw new Error('partial-optical-layer-payload');
  }
  if (!layers && typeof readPixel !== 'function') throw new Error('optical-layer-reader-missing');
  const expectedOutputBytes = width * height * 4;
  if (!(gpuRgba instanceof Uint8Array) || gpuRgba.length !== expectedOutputBytes) throw new Error('gpu-output-payload-incomplete');
  if (!Number.isInteger(outputToleranceBytes) || outputToleranceBytes < 0) throw new Error('invalid-output-tolerance');

  const layerRanges = Array.from({ length: depthBins }, (_, binIndex) => ({
    binIndex,
    emission: range3(),
    opticalDepth: range1(),
    positiveEmissionPixels: 0,
    positiveOpticalDepthPixels: 0,
  }));
  const preLuma = new Float32Array(width * height);
  const analyticalPostLuma = new Float32Array(width * height);
  const gpuPostLuma = new Float32Array(width * height);
  const analyticalRgba = new Uint8Array(expectedOutputBytes);
  const pixel = [0, 0, 0, 0];
  let maxAbsByteError = 0;
  let sumAbsByteError = 0;
  let mismatchChannelCount = 0;
  let comparedChannelCount = 0;

  for (let outputY = 0; outputY < height; outputY += 1) {
    const layerY = height - 1 - outputY;
    for (let x = 0; x < width; x += 1) {
      let colorR = 0;
      let colorG = 0;
      let colorB = 0;
      for (let binIndex = depthBins - 1; binIndex >= 0; binIndex -= 1) {
        if (layers) {
          const offset = (layerY * width + x) * 4;
          pixel[0] = layers[binIndex][offset];
          pixel[1] = layers[binIndex][offset + 1];
          pixel[2] = layers[binIndex][offset + 2];
          pixel[3] = layers[binIndex][offset + 3];
        } else {
          const value = readPixel(binIndex, x, layerY, pixel) || pixel;
          if (value !== pixel) {
            pixel[0] = value[0];
            pixel[1] = value[1];
            pixel[2] = value[2];
            pixel[3] = value[3];
          }
        }
        if (!pixel.every(Number.isFinite)) throw new Error(`non-finite-optical-layer-value:bin=${binIndex}:x=${x}:y=${layerY}`);
        const emissionR = Math.max(0, pixel[0]);
        const emissionG = Math.max(0, pixel[1]);
        const emissionB = Math.max(0, pixel[2]);
        const opticalDepth = Math.max(0, pixel[3]);
        const range = layerRanges[binIndex];
        updateRange3(range.emission, emissionR, emissionG, emissionB);
        updateRange1(range.opticalDepth, opticalDepth);
        if (emissionR > 0 || emissionG > 0 || emissionB > 0) range.positiveEmissionPixels += 1;
        if (opticalDepth > 0) range.positiveOpticalDepthPixels += 1;
        const transmittance = Math.exp(-opticalDepth);
        const alpha = 1 - transmittance;
        const inverseTau = opticalDepth > 1e-6 ? 1 / opticalDepth : 0;
        colorR = emissionR * inverseTau * alpha + colorR * transmittance;
        colorG = emissionG * inverseTau * alpha + colorG * transmittance;
        colorB = emissionB * inverseTau * alpha + colorB * transmittance;
      }
      const pixelIndex = outputY * width + x;
      preLuma[pixelIndex] = luma(colorR, colorG, colorB);
      const uvX = (x + 0.5) / width;
      const uvY = (outputY + 0.5) / height;
      const vignette = 1 - smoothstep(0.28, 1.48, Math.hypot(uvX * 2 - 1, uvY * 2 - 1));
      const grade = 0.80 + 0.18 * vignette;
      const postR = Math.pow(Math.max(0, (1 - Math.exp(-colorR * 0.96)) * grade), 0.84);
      const postG = Math.pow(Math.max(0, (1 - Math.exp(-colorG * 0.96)) * grade), 0.84);
      const postB = Math.pow(Math.max(0, (1 - Math.exp(-colorB * 0.96)) * grade), 0.84);
      analyticalPostLuma[pixelIndex] = luma(postR, postG, postB);
      const outputOffset = pixelIndex * 4;
      analyticalRgba[outputOffset] = toUnorm8(postR);
      analyticalRgba[outputOffset + 1] = toUnorm8(postG);
      analyticalRgba[outputOffset + 2] = toUnorm8(postB);
      analyticalRgba[outputOffset + 3] = 255;
      gpuPostLuma[pixelIndex] = luma(
        gpuRgba[outputOffset] / 255,
        gpuRgba[outputOffset + 1] / 255,
        gpuRgba[outputOffset + 2] / 255,
      );
      for (let channel = 0; channel < 4; channel += 1) {
        const error = Math.abs(analyticalRgba[outputOffset + channel] - gpuRgba[outputOffset + channel]);
        maxAbsByteError = Math.max(maxAbsByteError, error);
        sumAbsByteError += error;
        comparedChannelCount += 1;
        if (error > outputToleranceBytes) mismatchChannelCount += 1;
      }
    }
  }

  layerRanges.forEach(finalizeLayerRange);
  const keepAnalyticalRgba = includeAnalyticalRgba ?? expectedOutputBytes <= 16384;
  return {
    schema: STAGE_B_OPTICAL_ADJUDICATION_SCHEMA,
    status: 'completed',
    authority: structuredClone(authority),
    extent: { width, height, depthBins },
    formats: {
      accumulationAttachment: ACCUMULATION_FORMAT,
      layerAttachment: LAYER_FORMAT,
      presentationAttachment: OUTPUT_FORMAT,
    },
    semantics: {
      layerRgb: 'summed-emission-coefficient-times-deposition-weight-v0',
      layerAlpha: 'summed-optical-depth-coefficient-times-deposition-weight-v0',
      premultiplication: 'integrated-emission-not-alpha-premultiplied-v0',
      recurrence: 'far-to-near-emission-over-optical-depth-exponential-transmittance-v0',
      presentation: 'single-global-exponential-power-grade-v0',
    },
    layers: layerRanges,
    preTonemap: { luminance: summarize(preLuma) },
    postTonemap: {
      analyticalLuminance: summarize(analyticalPostLuma),
      gpuLuminance: summarize(gpuPostLuma),
      analyticalRgba: keepAnalyticalRgba ? Array.from(analyticalRgba) : null,
    },
    comparison: {
      outputToleranceBytes,
      maxAbsByteError,
      meanAbsByteError: sumAbsByteError / Math.max(1, comparedChannelCount),
      mismatchChannelCount,
      comparedChannelCount,
      exactWithinTolerance: mismatchChannelCount === 0,
    },
  };
}

function range1() {
  return { min: Number.POSITIVE_INFINITY, minPositive: Number.POSITIVE_INFINITY, max: 0 };
}

function range3() {
  return {
    min: Number.POSITIVE_INFINITY,
    minPositive: Number.POSITIVE_INFINITY,
    max: 0,
    channelMin: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    channelMax: [0, 0, 0],
  };
}

function updateRange1(range, value) {
  range.min = Math.min(range.min, value);
  range.max = Math.max(range.max, value);
  if (value > 0) range.minPositive = Math.min(range.minPositive, value);
}

function updateRange3(range, r, g, b) {
  const values = [r, g, b];
  for (let channel = 0; channel < 3; channel += 1) {
    const value = values[channel];
    range.min = Math.min(range.min, value);
    range.max = Math.max(range.max, value);
    range.channelMin[channel] = Math.min(range.channelMin[channel], value);
    range.channelMax[channel] = Math.max(range.channelMax[channel], value);
    if (value > 0) range.minPositive = Math.min(range.minPositive, value);
  }
}

function finalizeLayerRange(range) {
  for (const target of [range.emission, range.opticalDepth]) {
    if (!Number.isFinite(target.min)) target.min = 0;
    if (!Number.isFinite(target.minPositive)) target.minPositive = null;
  }
  range.emission.channelMin = range.emission.channelMin.map(value => Number.isFinite(value) ? value : 0);
}

function summarize(values) {
  const sorted = Float32Array.from(values);
  sorted.sort();
  let sum = 0;
  let nonzero = 0;
  for (const value of sorted) {
    sum += value;
    if (value > 0) nonzero += 1;
  }
  const at = quantile => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * quantile)))] || 0;
  return {
    min: sorted[0] || 0,
    max: sorted[sorted.length - 1] || 0,
    mean: sum / Math.max(1, sorted.length),
    nonzeroCount: nonzero,
    quantiles: { p000: at(0), p001: at(0.001), p010: at(0.01), p050: at(0.5), p090: at(0.9), p099: at(0.99), p999: at(0.999), p100: at(1) },
  };
}

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function smoothstep(edge0, edge1, value) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function toUnorm8(value) {
  return Math.min(255, Math.max(0, Math.round(value * 255)));
}

function requireValue(value, reason) {
  if (value === null || value === undefined || value === '') throw new Error(reason);
}
