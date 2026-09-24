export const COUPLED_OPTICAL_TRANSFER_IDENTITY = 'same-ray-shared-emission-extinction-exact-homogeneous-step-v0';

function nonNegativeFinite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and non-negative`);
  }
  return value;
}

function positiveFinite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be finite and positive`);
  }
  return value;
}

function computedFinite(value, label) {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  return value;
}

function radianceVector(value, label) {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length !== 3) {
    throw new TypeError(`${label} must contain three finite non-negative values`);
  }
  return Array.from(value, channel => nonNegativeFinite(channel, `${label} channel`));
}

function attenuatedSource(source, stepLength, sourceFraction, opticalDepthBefore, label) {
  if (source === 0 || sourceFraction === 0) return 0;
  const logContribution = Math.log(source)
    + Math.log(stepLength)
    + Math.log(sourceFraction)
    - opticalDepthBefore;
  return computedFinite(Math.exp(logContribution), label);
}

function requireSegment(segment, index) {
  if (!segment || typeof segment !== 'object' || Array.isArray(segment)) {
    throw new TypeError(`segment ${index} must be an object`);
  }
  if (!Object.hasOwn(segment, 'stepLength')) throw new TypeError(`segment ${index} is missing stepLength`);
  if (!Object.hasOwn(segment, 'smokeExtinction')) throw new TypeError(`segment ${index} is missing smokeExtinction`);
  if (!Object.hasOwn(segment, 'flameExtinction')) throw new TypeError(`segment ${index} is missing flameExtinction`);
  if (!Object.hasOwn(segment, 'smokeSource')) throw new TypeError(`segment ${index} is missing smokeSource`);
  if (!Object.hasOwn(segment, 'flameEmission')) throw new TypeError(`segment ${index} is missing flameEmission`);

  return {
    stepLength: positiveFinite(segment.stepLength, `segment ${index} stepLength`),
    smokeExtinction: nonNegativeFinite(segment.smokeExtinction, `segment ${index} smokeExtinction`),
    flameExtinction: nonNegativeFinite(segment.flameExtinction, `segment ${index} flameExtinction`),
    smokeSource: radianceVector(segment.smokeSource, `segment ${index} smokeSource`),
    flameEmission: radianceVector(segment.flameEmission, `segment ${index} flameEmission`),
  };
}

/**
 * Integrate ordered, front-to-back homogeneous ray segments. Extinction values
 * are inverse scene units; source values are linear radiance per scene unit.
 * smokeSource carries caller-supplied smoke emission/in-scattering values.
 * Flame and smoke extinction attenuate both sources together. This function
 * does not sample a field or calibrate its optical coefficients.
 */
export function integrateCoupledOpticalRay(segments, { backgroundRadiance = [0, 0, 0] } = {}) {
  if (!Array.isArray(segments)) throw new TypeError('segments must be an array ordered front-to-back');
  const background = radianceVector(backgroundRadiance, 'backgroundRadiance');
  const radiance = [0, 0, 0];
  const steps = [];
  let opticalDepth = 0;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = requireSegment(segments[index], index);
    const extinction = computedFinite(
      segment.smokeExtinction + segment.flameExtinction,
      `segment ${index} total extinction`,
    );
    const tau = computedFinite(extinction * segment.stepLength, `segment ${index} optical depth`);
    const sourceFraction = tau === 0 ? 1 : -Math.expm1(-tau) / tau;
    computedFinite(sourceFraction, `segment ${index} integrated source fraction`);
    const transmittanceBefore = Math.exp(-opticalDepth);
    const smokeRadianceAdded = segment.smokeSource.map(channel => attenuatedSource(
      channel,
      segment.stepLength,
      sourceFraction,
      opticalDepth,
      `segment ${index} smoke radiance contribution`,
    ));
    const flameRadianceAdded = segment.flameEmission.map(channel => attenuatedSource(
      channel,
      segment.stepLength,
      sourceFraction,
      opticalDepth,
      `segment ${index} flame radiance contribution`,
    ));
    const radianceAdded = smokeRadianceAdded.map((smoke, lane) => computedFinite(
      smoke + flameRadianceAdded[lane],
      `segment ${index} radiance contribution`,
    ));
    for (let lane = 0; lane < 3; lane += 1) {
      radiance[lane] = computedFinite(radiance[lane] + radianceAdded[lane], `radiance channel ${lane}`);
    }
    opticalDepth = computedFinite(opticalDepth + tau, `segment ${index} accumulated optical depth`);
    steps.push({
      index,
      stepLength: segment.stepLength,
      smokeExtinction: segment.smokeExtinction,
      flameExtinction: segment.flameExtinction,
      totalExtinction: extinction,
      opticalDepth: tau,
      transmittanceBefore,
      transmittanceAfter: Math.exp(-opticalDepth),
      smokeSource: segment.smokeSource,
      flameEmission: segment.flameEmission,
      smokeRadianceAdded,
      flameRadianceAdded,
      radianceAdded,
    });
  }

  const transmittance = Math.exp(-opticalDepth);
  const backgroundContribution = background.map(channel => attenuatedSource(
    channel,
    1,
    1,
    opticalDepth,
    'background radiance contribution',
  ));
  for (let lane = 0; lane < 3; lane += 1) {
    radiance[lane] = computedFinite(
      radiance[lane] + backgroundContribution[lane],
      `final radiance channel ${lane}`,
    );
  }

  return {
    identity: COUPLED_OPTICAL_TRANSFER_IDENTITY,
    ordering: 'front-to-back',
    radiance,
    transmittance,
    opticalDepth,
    backgroundRadiance: background,
    backgroundContribution,
    steps,
  };
}
