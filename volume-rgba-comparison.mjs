const RGB_CHANNELS = 3;
const BYTE_MAX = 255;

function assertPreview(preview, label) {
  const width = Number(preview?.width);
  const height = Number(preview?.height);
  const rgba = preview?.rgba;
  if (!Number.isInteger(width)
    || !Number.isInteger(height)
    || width <= 0
    || height <= 0
    || !Array.isArray(rgba)
    || rgba.length !== width * height * 4) {
    throw new Error(`rgba-preview-invalid:${label}:${width}:${height}:${rgba?.length ?? 'missing'}`);
  }
  return { width, height, rgba };
}

function luma(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / BYTE_MAX;
}

export function compareRgbaPreviews(candidatePreview, targetPreview) {
  const candidate = assertPreview(candidatePreview, 'candidate');
  const target = assertPreview(targetPreview, 'target');
  if (candidate.width !== target.width || candidate.height !== target.height) {
    throw new Error(`rgba-preview-shape-mismatch:${candidate.width}x${candidate.height}:${target.width}x${target.height}`);
  }
  const targetLuma = [];
  for (let offset = 0; offset < target.rgba.length; offset += 4) {
    const value = luma(target.rgba[offset], target.rgba[offset + 1], target.rgba[offset + 2]);
    if (value > 0) targetLuma.push(value);
  }
  targetLuma.sort((left, right) => left - right);
  const targetPeakThresholdLuma = targetLuma.length > 0
    ? targetLuma[Math.min(targetLuma.length - 1, Math.floor(targetLuma.length * 0.95))]
    : 0;
  let absoluteRgbError = 0;
  let weightedRgbError = 0;
  let weightSum = 0;
  let candidateLumaSum = 0;
  let targetLumaSum = 0;
  let targetPeakPixelCount = 0;
  let candidateOnTargetPeakLuma = 0;
  let targetPeakLuma = 0;
  for (let offset = 0; offset < target.rgba.length; offset += 4) {
    const candidateLuma = luma(candidate.rgba[offset], candidate.rgba[offset + 1], candidate.rgba[offset + 2]);
    const referenceLuma = luma(target.rgba[offset], target.rgba[offset + 1], target.rgba[offset + 2]);
    let pixelError = 0;
    for (let channel = 0; channel < RGB_CHANNELS; channel += 1) {
      pixelError += Math.abs(candidate.rgba[offset + channel] - target.rgba[offset + channel]) / BYTE_MAX;
    }
    const weight = 1 + 4 * referenceLuma * referenceLuma;
    absoluteRgbError += pixelError;
    weightedRgbError += pixelError * weight;
    weightSum += weight;
    candidateLumaSum += candidateLuma;
    targetLumaSum += referenceLuma;
    if (referenceLuma > 0 && referenceLuma >= targetPeakThresholdLuma) {
      targetPeakPixelCount += 1;
      candidateOnTargetPeakLuma += candidateLuma;
      targetPeakLuma += referenceLuma;
    }
  }
  const pixelCount = candidate.width * candidate.height;
  const candidateOnTargetPeakMeanLuma = candidateOnTargetPeakLuma / Math.max(1, targetPeakPixelCount);
  const targetPeakMeanLuma = targetPeakLuma / Math.max(1, targetPeakPixelCount);
  return {
    identity: 'same-state-rgba8-target-relative-footprint-tier-metrics-v0',
    width: candidate.width,
    height: candidate.height,
    pixelCount,
    rgbMaeNormalized: absoluteRgbError / Math.max(1, pixelCount * RGB_CHANNELS),
    targetWeightedRgbMaeNormalized: weightedRgbError / Math.max(1, weightSum * RGB_CHANNELS),
    candidateMeanLuma: candidateLumaSum / Math.max(1, pixelCount),
    targetMeanLuma: targetLumaSum / Math.max(1, pixelCount),
    targetPeakThresholdLuma,
    targetPeakPixelCount,
    candidateOnTargetPeakMeanLuma,
    targetPeakMeanLuma,
    targetPeakLumaRetention: candidateOnTargetPeakMeanLuma / Math.max(Number.EPSILON, targetPeakMeanLuma),
  };
}
