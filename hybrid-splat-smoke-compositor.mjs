export const HYBRID_SPLAT_SMOKE_COMPOSITOR_IDENTITY = 'single-representative-depth-splat-smoke-compositor-v0';
export const HYBRID_SPLAT_LAYER_IDENTITY = 'premultiplied-hdr-splat-radiance-alpha-linear-depth-moments-v0';
export const HYBRID_SMOKE_LAYER_IDENTITY = 'raymarched-smoke-radiance-transmittance-linear-depth-moments-v0';
export const HYBRID_SPLAT_SMOKE_APPROXIMATION = 'single-representative-depth-no-interpenetration-split';
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

function invalid(fallbackReason) {
  return {
    identity: HYBRID_SPLAT_SMOKE_COMPOSITOR_IDENTITY,
    status: 'invalid',
    fallbackReason,
    approximation: HYBRID_SPLAT_SMOKE_APPROXIMATION,
  };
}

export function composeSingleDepthLayers({ splat, smoke } = {}) {
  const normalizedSplat = normalizeLayer(splat, 'splat');
  const normalizedSmoke = normalizeLayer(smoke, 'smoke');
  if (normalizedSplat.opacity > 0 && normalizedSplat.representativeDepth === null) {
    return invalid('splat-representative-depth-missing');
  }
  if (normalizedSmoke.opacity > 0 && normalizedSmoke.representativeDepth === null) {
    return invalid('smoke-representative-depth-missing');
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
    identity: HYBRID_SPLAT_SMOKE_COMPOSITOR_IDENTITY,
    status: 'composed',
    fallbackReason: null,
    approximation: HYBRID_SPLAT_SMOKE_APPROXIMATION,
    frontLayer: splatIsFront ? 'splat' : 'smoke',
    frontOpacityInput: frontInput.opacity,
    frontOpacityApplied,
    premultipliedRadiance: front.premultipliedRadiance.map((value, index) => (
      value + backVisibility * back.premultipliedRadiance[index]
    )),
    opacity: front.opacity + backVisibility * back.opacity,
  };
}
