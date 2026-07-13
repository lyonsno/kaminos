export const HYBRID_SPLAT_SMOKE_COMPOSITOR_IDENTITY = 'splat-depth-conditioned-front-back-smoke-compositor-v1';
export const HYBRID_SPLAT_LAYER_IDENTITY = 'premultiplied-hdr-splat-radiance-alpha-linear-depth-moments-v0';
export const HYBRID_SMOKE_LAYER_IDENTITY = 'raymarched-smoke-front-back-radiance-transmittance-linear-depth-intervals-v1';
export const HYBRID_SPLAT_SMOKE_APPROXIMATION = 'splat-depth-conditioned-raymarched-front-back-smoke-intervals';
export const LEGACY_SINGLE_DEPTH_COMPOSITOR_IDENTITY = 'single-representative-depth-splat-smoke-compositor-v0';
export const LEGACY_SINGLE_DEPTH_APPROXIMATION = 'single-representative-depth-no-interpenetration-split';
export const HYBRID_SMOKE_FRONT_OPACITY_CEILING = 0.18;

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

function normalizeLayer(layer, name) {
  const source = layer && typeof layer === 'object' ? layer : {};
  const radiance = Array.isArray(source.premultipliedRadiance) ? source.premultipliedRadiance : [];
  if (radiance.length !== 3) throw new Error(`${name}.premultipliedRadiance must contain three finite channels`);
  const opacity = Math.max(0, Math.min(1, finite(source.opacity, `${name}.opacity`)));
  const representativeDepth = source.representativeDepth === null || source.representativeDepth === undefined
    ? null
    : finite(source.representativeDepth, `${name}.representativeDepth`);
  return {
    premultipliedRadiance: radiance.map((value, index) => finite(value, `${name}.premultipliedRadiance[${index}]`)),
    opacity,
    representativeDepth,
  };
}

function invalid(fallbackReason, identity = HYBRID_SPLAT_SMOKE_COMPOSITOR_IDENTITY, approximation = HYBRID_SPLAT_SMOKE_APPROXIMATION) {
  return {
    identity,
    status: 'invalid',
    fallbackReason,
    approximation,
  };
}

function legacyInvalid(fallbackReason) {
  return invalid(fallbackReason, LEGACY_SINGLE_DEPTH_COMPOSITOR_IDENTITY, LEGACY_SINGLE_DEPTH_APPROXIMATION);
}

function normalizeIntervalLayer(layer, name) {
  const normalized = normalizeLayer(layer, name);
  const source = layer && typeof layer === 'object' ? layer : {};
  return {
    ...normalized,
    intervalNearDepth: source.intervalNearDepth === null || source.intervalNearDepth === undefined
      ? null
      : finite(source.intervalNearDepth, `${name}.intervalNearDepth`),
    intervalFarDepth: source.intervalFarDepth === null || source.intervalFarDepth === undefined
      ? null
      : finite(source.intervalFarDepth, `${name}.intervalFarDepth`),
  };
}

function over(front, back) {
  const backVisibility = 1 - front.opacity;
  return {
    premultipliedRadiance: front.premultipliedRadiance.map((value, index) => (
      value + backVisibility * back.premultipliedRadiance[index]
    )),
    opacity: front.opacity + backVisibility * back.opacity,
  };
}

function intervalFailure(layer, name) {
  if (layer.opacity <= 0) return null;
  if (layer.intervalNearDepth === null || layer.intervalFarDepth === null) {
    return `${name}-depth-interval-missing`;
  }
  if (layer.intervalNearDepth > layer.intervalFarDepth) return `${name}-depth-interval-inverted`;
  return null;
}

export function composeDepthIntervalLayers({ splat, smokeFront, smokeBack } = {}) {
  const normalizedSplat = normalizeLayer(splat, 'splat');
  const normalizedFront = normalizeIntervalLayer(smokeFront, 'smoke-front');
  const normalizedBack = normalizeIntervalLayer(smokeBack, 'smoke-back');
  if (normalizedSplat.opacity > 0 && normalizedSplat.representativeDepth === null) {
    return invalid('splat-representative-depth-missing');
  }
  const frontFailure = intervalFailure(normalizedFront, 'smoke-front');
  if (frontFailure) return invalid(frontFailure);
  const backFailure = intervalFailure(normalizedBack, 'smoke-back');
  if (backFailure) return invalid(backFailure);
  if (
    normalizedSplat.opacity > 0
    && normalizedFront.opacity > 0
    && normalizedFront.intervalFarDepth > normalizedSplat.representativeDepth + 1e-6
  ) {
    return invalid('smoke-front-interval-crosses-splat-depth');
  }
  if (
    normalizedSplat.opacity > 0
    && normalizedBack.opacity > 0
    && normalizedBack.intervalNearDepth < normalizedSplat.representativeDepth - 1e-6
  ) {
    return invalid('smoke-back-interval-crosses-splat-depth');
  }

  const splatOverBack = over(normalizedSplat, normalizedBack);
  const composed = over(normalizedFront, splatOverBack);
  return {
    identity: HYBRID_SPLAT_SMOKE_COMPOSITOR_IDENTITY,
    status: 'composed',
    fallbackReason: null,
    approximation: HYBRID_SPLAT_SMOKE_APPROXIMATION,
    layerOrder: 'smoke-front>splat>smoke-back',
    smokeFrontOpacityApplied: normalizedFront.opacity,
    premultipliedRadiance: composed.premultipliedRadiance,
    opacity: composed.opacity,
  };
}

export function composeSingleDepthLayers({ splat, smoke } = {}) {
  const normalizedSplat = normalizeLayer(splat, 'splat');
  const normalizedSmoke = normalizeLayer(smoke, 'smoke');
  if (normalizedSplat.opacity > 0 && normalizedSplat.representativeDepth === null) {
    return legacyInvalid('splat-representative-depth-missing');
  }
  if (normalizedSmoke.opacity > 0 && normalizedSmoke.representativeDepth === null) {
    return legacyInvalid('smoke-representative-depth-missing');
  }

  const splatIsFront = normalizedSmoke.opacity <= 0 || (
    normalizedSplat.opacity > 0
    && normalizedSplat.representativeDepth <= normalizedSmoke.representativeDepth
  );
  const frontInput = splatIsFront ? normalizedSplat : normalizedSmoke;
  const back = splatIsFront ? normalizedSmoke : normalizedSplat;
  const frontOpacityApplied = !splatIsFront && normalizedSplat.opacity > 0
    ? Math.min(frontInput.opacity, HYBRID_SMOKE_FRONT_OPACITY_CEILING)
    : frontInput.opacity;
  const frontRadianceScale = frontInput.opacity > 0 ? frontOpacityApplied / frontInput.opacity : 1;
  const front = {
    ...frontInput,
    opacity: frontOpacityApplied,
    premultipliedRadiance: frontInput.premultipliedRadiance.map(value => value * frontRadianceScale),
  };
  const backVisibility = 1 - front.opacity;
  return {
    identity: LEGACY_SINGLE_DEPTH_COMPOSITOR_IDENTITY,
    status: 'composed',
    fallbackReason: null,
    approximation: LEGACY_SINGLE_DEPTH_APPROXIMATION,
    frontLayer: splatIsFront ? 'splat' : 'smoke',
    frontOpacityInput: frontInput.opacity,
    frontOpacityApplied,
    premultipliedRadiance: front.premultipliedRadiance.map((value, index) => (
      value + backVisibility * back.premultipliedRadiance[index]
    )),
    opacity: front.opacity + backVisibility * back.opacity,
  };
}
