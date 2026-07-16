export function measureReceiverLightDelta(onImage, mutedImage, region = {}, receiverMaskImage = null) {
  if (
    onImage?.width !== mutedImage?.width ||
    onImage?.height !== mutedImage?.height ||
    onImage?.channels !== mutedImage?.channels
  ) {
    throw new Error('receiver-light paired captures require matching dimensions and channels');
  }
  if (receiverMaskImage && (
    receiverMaskImage.width !== onImage.width ||
    receiverMaskImage.height !== onImage.height ||
    receiverMaskImage.channels !== onImage.channels
  )) {
    throw new Error('receiver-light coverage mask must match paired capture dimensions and channels');
  }

  const width = Number(onImage.width);
  const height = Number(onImage.height);
  const channels = Number(onImage.channels);
  const xStart = Math.max(0, Math.floor(width * (region.xMin ?? 0)));
  const xEnd = Math.min(width, Math.ceil(width * (region.xMax ?? 1)));
  const yStart = Math.max(0, Math.floor(height * (region.yMin ?? 0)));
  const yEnd = Math.min(height, Math.ceil(height * (region.yMax ?? 1)));
  let changedPixels = 0;
  let positiveLumaPixels = 0;
  let warmPositivePixels = 0;
  let surfacePositivePixels = 0;
  let detachedPositivePixels = 0;
  let positiveLumaTotal = 0;
  let maxPositiveLumaDelta = 0;

  for (let y = yStart; y < yEnd; y += 1) {
    const onRow = onImage.rows[y];
    const mutedRow = mutedImage.rows[y];
    const receiverMaskRow = receiverMaskImage?.rows?.[y] || null;
    for (let x = xStart; x < xEnd; x += 1) {
      const index = x * channels;
      const dr = onRow[index] - mutedRow[index];
      const dg = onRow[index + 1] - mutedRow[index + 1];
      const db = onRow[index + 2] - mutedRow[index + 2];
      const lumaDelta = 0.2126 * dr + 0.7152 * dg + 0.0722 * db;
      if (Math.abs(lumaDelta) >= 2) changedPixels += 1;
      if (lumaDelta >= 2) {
        positiveLumaPixels += 1;
        positiveLumaTotal += lumaDelta;
        maxPositiveLumaDelta = Math.max(maxPositiveLumaDelta, lumaDelta);
        if (dr > db + 1 && dg > db) {
          warmPositivePixels += 1;
          const receiverSurfacePresent = receiverMaskRow
            ? Math.max(receiverMaskRow[index], receiverMaskRow[index + 1], receiverMaskRow[index + 2]) >= 128
            : (mutedRow[index] > 0 || mutedRow[index + 1] > 0 || mutedRow[index + 2] > 0);
          if (receiverSurfacePresent) surfacePositivePixels += 1;
          else detachedPositivePixels += 1;
        }
      }
    }
  }

  return {
    identity: 'receiver-light-paired-delta-v0',
    width,
    height,
    region: { xStart, xEnd, yStart, yEnd },
    sampledPixels: Math.max(0, xEnd - xStart) * Math.max(0, yEnd - yStart),
    changedPixels,
    positiveLumaPixels,
    warmPositivePixels,
    surfacePositivePixels,
    detachedPositivePixels,
    surfacePositiveRatio: surfacePositivePixels / Math.max(1, warmPositivePixels),
    meanPositiveLumaDelta: positiveLumaTotal / Math.max(1, positiveLumaPixels),
    maxPositiveLumaDelta,
  };
}

export function measureReceiverLightSignal(image, region = {}) {
  const width = Number(image?.width);
  const height = Number(image?.height);
  const channels = Number(image?.channels);
  if (!(width > 0 && height > 0 && channels >= 3 && Array.isArray(image?.rows))) {
    throw new Error('receiver-light absolute signal requires a valid RGB image');
  }

  const xStart = Math.max(0, Math.floor(width * (region.xMin ?? 0)));
  const xEnd = Math.min(width, Math.ceil(width * (region.xMax ?? 1)));
  const yStart = Math.max(0, Math.floor(height * (region.yMin ?? 0)));
  const yEnd = Math.min(height, Math.ceil(height * (region.yMax ?? 1)));
  const sampledPixels = Math.max(0, xEnd - xStart) * Math.max(0, yEnd - yStart);
  let litPixels = 0;
  let warmPixels = 0;
  let lumaTotal = 0;
  let maxLuma = 0;

  for (let y = yStart; y < yEnd; y += 1) {
    const row = image.rows[y];
    for (let x = xStart; x < xEnd; x += 1) {
      const index = x * channels;
      const r = row[index];
      const g = row[index + 1];
      const b = row[index + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lumaTotal += luma;
      maxLuma = Math.max(maxLuma, luma);
      if (luma >= 2) litPixels += 1;
      if (luma >= 2 && r > b + 1 && g > b) warmPixels += 1;
    }
  }

  return {
    identity: 'receiver-light-absolute-signal-v0',
    width,
    height,
    region: { xStart, xEnd, yStart, yEnd },
    sampledPixels,
    litPixels,
    warmPixels,
    meanLuma: lumaTotal / Math.max(1, sampledPixels),
    maxLuma,
  };
}

export function evaluateReceiverLightAssay(onImage, mutedImage, options = {}) {
  const region = options.region || {};
  const backgroundRegion = options.backgroundRegion || null;
  const receiverMaskImage = options.receiverMaskImage || null;
  const onSignal = measureReceiverLightSignal(onImage, region);
  const mutedSignal = measureReceiverLightSignal(mutedImage, region);
  const receiverMaskSignal = receiverMaskImage
    ? measureReceiverLightSignal(receiverMaskImage, region)
    : null;
  const delta = measureReceiverLightDelta(onImage, mutedImage, region, receiverMaskImage);
  const backgroundDelta = backgroundRegion
    ? measureReceiverLightDelta(onImage, mutedImage, backgroundRegion, receiverMaskImage)
    : null;
  const minimumSignalPixels = Math.max(100, Math.ceil(onSignal.sampledPixels * 0.002));
  const minimumReceiverMaskPixels = Math.max(100, Math.ceil(onSignal.sampledPixels * 0.002));
  const maximumDetachedPositivePixels = 0;
  const maximumBackgroundDeltaPixels = backgroundDelta
    ? Math.max(4, Math.floor(backgroundDelta.sampledPixels * 0.0001))
    : null;
  const failures = [];

  if (onSignal.litPixels < minimumSignalPixels || onSignal.warmPixels < minimumSignalPixels) {
    failures.push('receiver-signal-too-sparse');
  }
  if (!receiverMaskSignal) {
    failures.push('receiver-coverage-mask-missing');
  } else if (receiverMaskSignal.litPixels < minimumReceiverMaskPixels) {
    failures.push('receiver-coverage-mask-too-sparse');
  }
  if (delta.warmPositivePixels < minimumSignalPixels || delta.meanPositiveLumaDelta < 4) {
    failures.push('receiver-delta-too-weak');
  }
  if (delta.detachedPositivePixels > maximumDetachedPositivePixels) {
    failures.push('receiver-delta-escaped-surface-mask');
  }
  if (backgroundDelta && backgroundDelta.changedPixels > maximumBackgroundDeltaPixels) {
    failures.push('empty-background-receiver-spill');
  }

  return {
    identity: 'receiver-light-surface-contact-assay-v1',
    accepted: failures.length === 0,
    failures,
    thresholds: {
      minimumSignalPixels,
      minimumReceiverMaskPixels,
      maximumDetachedPositivePixels,
      maximumBackgroundDeltaPixels,
      minimumMeanPositiveLumaDelta: 4,
    },
    onSignal,
    mutedSignal,
    receiverMaskSignal,
    delta,
    backgroundDelta,
  };
}
