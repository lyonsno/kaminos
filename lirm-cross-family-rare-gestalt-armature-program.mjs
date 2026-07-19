const point = (x, y, z) => ({ x, y, z });
const ellipsoid = (role, center, radius) => ({ kind: 'ellipsoid', role, center, radius });
const capsule = (role, a, b, radius) => ({ kind: 'capsule', role, a, b, radius });
const freezeSpecs = specs => Object.freeze(specs.map(Object.freeze));

export const ANNULAR_CANOPY_HYBRID_PARAMETER_SPECS = freezeSpecs([
  { id: 'apertureWidth', semanticRole: 'loadBearingAperture', initial: 0.92, min: 0.54, max: 1.46, step: 0.12 },
  { id: 'apertureHeight', semanticRole: 'loadBearingAperture', initial: 0.82, min: 0.48, max: 1.42, step: 0.11 },
  { id: 'ringThickness', semanticRole: 'annularBody', initial: 0.14, min: 0.085, max: 0.26, step: 0.03 },
  { id: 'ringDepth', semanticRole: 'annularBody', initial: 0.2, min: 0.11, max: 0.38, step: 0.045 },
  { id: 'ringRise', semanticRole: 'annularElevation', initial: 0.98, min: 0.68, max: 1.34, step: 0.09 },
  { id: 'ringTwist', semanticRole: 'controlledDepthAsymmetry', initial: 0.08, min: -0.3, max: 0.3, step: 0.065 },
  { id: 'ringSkew', semanticRole: 'controlledLateralAsymmetry', initial: 0.08, min: -0.28, max: 0.28, step: 0.06 },
  { id: 'canopySpan', semanticRole: 'dorsalCanopy', initial: 1.72, min: 1.04, max: 2.42, step: 0.17 },
  { id: 'canopyHeight', semanticRole: 'dorsalCanopy', initial: 0.28, min: 0.16, max: 0.52, step: 0.055 },
  { id: 'canopyDepth', semanticRole: 'dorsalCanopy', initial: 0.76, min: 0.4, max: 1.28, step: 0.11 },
  { id: 'canopyArch', semanticRole: 'dorsalCanopyArch', initial: 0.2, min: -0.08, max: 0.48, step: 0.07 },
  { id: 'canopyLift', semanticRole: 'dorsalCanopyElevation', initial: 0.08, min: -0.08, max: 0.34, step: 0.055 },
  { id: 'canopyOffset', semanticRole: 'canopyPlacement', initial: -0.04, min: -0.42, max: 0.42, step: 0.08 },
  { id: 'canopyAsymmetry', semanticRole: 'controlledAsymmetry', initial: 0.1, min: -0.38, max: 0.38, step: 0.075 },
  { id: 'pendantWidth', semanticRole: 'suspendedSensoryMass', initial: 0.3, min: 0.16, max: 0.54, step: 0.055 },
  { id: 'pendantHeight', semanticRole: 'suspendedSensoryMass', initial: 0.36, min: 0.2, max: 0.64, step: 0.065 },
  { id: 'pendantDepth', semanticRole: 'suspendedSensoryMass', initial: 0.3, min: 0.16, max: 0.58, step: 0.06 },
  { id: 'pendantDrop', semanticRole: 'sensorySuspension', initial: 0.42, min: 0.24, max: 0.78, step: 0.075 },
  { id: 'pendantLateral', semanticRole: 'sensorySuspension', initial: 0.24, min: -0.46, max: 0.46, step: 0.085 },
  { id: 'pendantForward', semanticRole: 'sensorySuspension', initial: 0.22, min: -0.12, max: 0.54, step: 0.075 },
  { id: 'suspensorSpread', semanticRole: 'sensorySuspensor', initial: 0.18, min: 0.08, max: 0.34, step: 0.045 },
  { id: 'supportSpread', semanticRole: 'tripodSupportField', initial: 0.76, min: 0.44, max: 1.14, step: 0.09 },
  { id: 'supportForeAft', semanticRole: 'tripodSupportField', initial: 0.38, min: 0.18, max: 0.68, step: 0.07 },
  { id: 'supportThickness', semanticRole: 'tripodSupport', initial: 0.075, min: 0.045, max: 0.15, step: 0.02 },
  { id: 'footWidth', semanticRole: 'groundContact', initial: 0.15, min: 0.08, max: 0.28, step: 0.035 },
  { id: 'footDepth', semanticRole: 'groundContact', initial: 0.22, min: 0.11, max: 0.38, step: 0.045 },
  { id: 'groundHeight', semanticRole: 'groundContact', initial: -0.9, min: -1.08, max: -0.5, step: 0.06 },
]);

export function createAnnularCanopyHybridPrimitives(p) {
  const primitives = [];
  const ringCenterY = p.groundHeight + p.ringRise;
  const radiusX = p.apertureWidth * 0.5 + p.ringThickness;
  const radiusY = p.apertureHeight * 0.5 + p.ringThickness;
  const segmentCount = 18;
  const ringPoints = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const angle = (index / segmentCount) * Math.PI * 2;
    ringPoints.push(point(
      Math.cos(angle) * radiusX + Math.sin(angle) * p.ringSkew,
      ringCenterY + Math.sin(angle) * radiusY,
      Math.sin(angle * 2) * p.ringTwist,
    ));
  }
  for (let index = 0; index < segmentCount; index += 1) {
    primitives.push(capsule(
      'annularBody',
      ringPoints[index],
      ringPoints[(index + 1) % segmentCount],
      p.ringThickness,
    ));
    if (index % 2 === 0) {
      primitives.push(ellipsoid(
        'annularBody',
        ringPoints[index],
        point(p.ringThickness * 1.04, p.ringThickness * 1.1, p.ringDepth),
      ));
    }
  }

  const ringCrownY = ringCenterY + radiusY;
  const canopyY = ringCrownY + p.canopyLift;
  const canopyStations = [-0.82, -0.42, 0, 0.42, 0.82];
  for (const [index, station] of canopyStations.entries()) {
    const edgeTaper = 1 - Math.abs(station) * 0.32;
    primitives.push(ellipsoid(
      'dorsalCanopy',
      point(
        p.canopyOffset + station * p.canopySpan * 0.5,
        canopyY + Math.cos(station * Math.PI * 0.92) * p.canopyArch,
        Math.sin(station * Math.PI) * p.canopyAsymmetry * 0.52,
      ),
      point(
        p.canopySpan * 0.2 * edgeTaper,
        p.canopyHeight * 0.5 * edgeTaper,
        p.canopyDepth * 0.5 * (0.86 + edgeTaper * 0.14),
      ),
    ));
  }
  primitives.push(capsule(
    'dorsalCanopy',
    point(p.canopyOffset - p.canopySpan * 0.38, canopyY, 0),
    point(p.canopyOffset + p.canopySpan * 0.38, canopyY + p.canopyAsymmetry * 0.12, 0),
    p.canopyHeight * 0.3,
  ));

  const pendantCenter = point(
    p.pendantLateral,
    canopyY - p.pendantDrop,
    p.pendantForward,
  );
  const suspensorRoots = [
    point(p.pendantLateral - p.suspensorSpread, ringCrownY - p.ringThickness * 0.25, p.ringTwist * 0.2),
    point(p.pendantLateral + p.suspensorSpread, ringCrownY - p.ringThickness * 0.25, -p.ringTwist * 0.2),
  ];
  for (const root of suspensorRoots) {
    primitives.push(capsule('sensorySuspensor', root, pendantCenter, p.supportThickness * 0.42));
  }
  primitives.push(ellipsoid(
    'suspendedSensoryMass',
    pendantCenter,
    point(p.pendantWidth * 0.5, p.pendantHeight * 0.5, p.pendantDepth * 0.5),
  ));

  const supportRoots = [
    point(-radiusX * 0.7, ringCenterY - radiusY * 0.63, -p.ringDepth * 0.12),
    point(radiusX * 0.7, ringCenterY - radiusY * 0.63, -p.ringDepth * 0.12),
    point(p.ringSkew * 0.3, ringCenterY - radiusY * 0.88, p.ringDepth * 0.58),
  ];
  const supportTargets = [
    point(-p.supportSpread, p.groundHeight, -p.supportForeAft),
    point(p.supportSpread, p.groundHeight, -p.supportForeAft),
    point(p.ringSkew * 0.32, p.groundHeight, p.supportForeAft),
  ];
  for (let index = 0; index < supportRoots.length; index += 1) {
    primitives.push(capsule('tripodSupport', supportRoots[index], supportTargets[index], p.supportThickness));
    primitives.push(ellipsoid(
      'groundContact',
      supportTargets[index],
      point(p.footWidth, p.supportThickness * 0.68, p.footDepth),
    ));
  }
  return primitives;
}

export const ANNULAR_CANOPY_HYBRID_ARMATURE_PROGRAM = Object.freeze({
  id: 'kaminos.lirm-armature-program.annular-canopy-hybrid.v0',
  parameterVocabulary: `kaminos.rare-gestalt-armature.annular-canopy-hybrid-${ANNULAR_CANOPY_HYBRID_PARAMETER_SPECS.length}.v0`,
  parameterSpecs: ANNULAR_CANOPY_HYBRID_PARAMETER_SPECS,
  createPrimitives: createAnnularCanopyHybridPrimitives,
});

const initialParameters = () => Object.fromEntries(
  ANNULAR_CANOPY_HYBRID_PARAMETER_SPECS.map(spec => [spec.id, spec.initial]),
);
const candidate = (id, overrides, lineagePressure) => Object.freeze({
  id,
  program: ANNULAR_CANOPY_HYBRID_ARMATURE_PROGRAM,
  parameters: Object.freeze({ ...initialParameters(), ...overrides }),
  lineagePressure,
});

export const CROSS_FAMILY_HYBRID_CANDIDATES = Object.freeze([
  candidate(
    'crown-halo-pendant-tripod',
    {},
    'broad dorsal canopy fused to an open annular crown with a suspended interior organ and sparse tripod contacts',
  ),
  candidate(
    'offset-keyhole-canopy-strider',
    {
      apertureWidth: 0.66,
      apertureHeight: 0.94,
      ringRise: 0.88,
      ringTwist: 0.22,
      ringSkew: -0.14,
      canopySpan: 1.78,
      canopyDepth: 0.82,
      canopyArch: 0.22,
      canopyOffset: 0.12,
      canopyAsymmetry: 0.3,
      pendantLateral: -0.2,
      pendantForward: 0.44,
      supportSpread: 0.88,
    },
    'tall annular keyhole carried beneath an offset asymmetric canopy with an eccentric pendant and wide tripod stance',
  ),
  candidate(
    'wide-portal-saddle-canopy',
    {
      apertureWidth: 1.32,
      apertureHeight: 0.58,
      ringRise: 0.86,
      ringSkew: 0.22,
      ringTwist: -0.16,
      canopySpan: 1.48,
      canopyHeight: 0.42,
      canopyDepth: 0.58,
      canopyArch: -0.04,
      canopyLift: 0.22,
      canopyOffset: -0.18,
      canopyAsymmetry: -0.24,
      pendantDrop: 0.68,
      pendantLateral: 0.38,
      supportForeAft: 0.58,
    },
    'wide low annular portal hanging beneath a compact saddle canopy with a laterally displaced pendant and deep tripod support field',
  ),
]);
