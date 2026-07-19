const point = (x, y, z) => ({ x, y, z });
const ellipsoid = (role, center, radius) => ({ kind: 'ellipsoid', role, center, radius });
const capsule = (role, a, b, radius) => ({ kind: 'capsule', role, a, b, radius });

const freezeSpecs = specs => Object.freeze(specs.map(Object.freeze));

export const ANNULAR_TRIPOD_PARAMETER_SPECS = freezeSpecs([
  { id: 'apertureWidth', semanticRole: 'loadBearingAperture', initial: 0.94, min: 0.56, max: 1.52, step: 0.12 },
  { id: 'apertureHeight', semanticRole: 'loadBearingAperture', initial: 0.96, min: 0.54, max: 1.5, step: 0.12 },
  { id: 'ringThickness', semanticRole: 'annularBody', initial: 0.17, min: 0.1, max: 0.31, step: 0.035 },
  { id: 'ringDepth', semanticRole: 'annularBody', initial: 0.22, min: 0.12, max: 0.42, step: 0.05 },
  { id: 'ringRise', semanticRole: 'annularElevation', initial: 0.82, min: 0.5, max: 1.22, step: 0.1 },
  { id: 'ringTwist', semanticRole: 'controlledDepthAsymmetry', initial: 0.1, min: -0.32, max: 0.32, step: 0.07 },
  { id: 'ringSkew', semanticRole: 'controlledLateralAsymmetry', initial: 0.08, min: -0.3, max: 0.3, step: 0.065 },
  { id: 'sensoryWidth', semanticRole: 'offAxisSensoryMass', initial: 0.42, min: 0.22, max: 0.7, step: 0.07 },
  { id: 'sensoryHeight', semanticRole: 'offAxisSensoryMass', initial: 0.36, min: 0.2, max: 0.62, step: 0.06 },
  { id: 'sensoryDepth', semanticRole: 'offAxisSensoryMass', initial: 0.38, min: 0.2, max: 0.66, step: 0.065 },
  { id: 'sensoryAngle', semanticRole: 'sensoryPlacement', initial: 0.7, min: 0.28, max: 1.22, step: 0.1 },
  { id: 'supportSpread', semanticRole: 'tripodSupportField', initial: 0.72, min: 0.42, max: 1.12, step: 0.09 },
  { id: 'supportForeAft', semanticRole: 'tripodSupportField', initial: 0.34, min: 0.16, max: 0.62, step: 0.07 },
  { id: 'supportThickness', semanticRole: 'tripodSupport', initial: 0.09, min: 0.05, max: 0.18, step: 0.025 },
  { id: 'footWidth', semanticRole: 'groundContact', initial: 0.16, min: 0.09, max: 0.3, step: 0.035 },
  { id: 'footDepth', semanticRole: 'groundContact', initial: 0.22, min: 0.11, max: 0.38, step: 0.045 },
  { id: 'groundHeight', semanticRole: 'groundContact', initial: -0.7, min: -0.9, max: -0.48, step: 0.06 },
]);

export function createAnnularTripodPrimitives(p) {
  const primitives = [];
  const ringCenterY = p.groundHeight + p.ringRise;
  const radiusX = p.apertureWidth * 0.5 + p.ringThickness;
  const radiusY = p.apertureHeight * 0.5 + p.ringThickness;
  const segmentCount = 16;
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
      const center = ringPoints[index];
      primitives.push(ellipsoid(
        'annularBody',
        center,
        point(p.ringThickness * 1.05, p.ringThickness * 1.12, p.ringDepth),
      ));
    }
  }

  const sensoryCenter = point(
    Math.cos(p.sensoryAngle) * (radiusX + p.sensoryWidth * 0.2) + p.ringSkew,
    ringCenterY + Math.sin(p.sensoryAngle) * (radiusY + p.sensoryHeight * 0.12),
    p.ringDepth * 0.55 + p.ringTwist,
  );
  primitives.push(ellipsoid(
    'offAxisSensoryMass',
    sensoryCenter,
    point(p.sensoryWidth * 0.5, p.sensoryHeight * 0.5, p.sensoryDepth * 0.5),
  ));

  const supportRoots = [
    point(-radiusX * 0.68, ringCenterY - radiusY * 0.68, -p.ringTwist * 0.2),
    point(radiusX * 0.68, ringCenterY - radiusY * 0.68, p.ringTwist * 0.2),
    point(0, ringCenterY - radiusY * 0.92, p.ringDepth * 0.48),
  ];
  const supportTargets = [
    point(-p.supportSpread, p.groundHeight, -p.supportForeAft),
    point(p.supportSpread, p.groundHeight, -p.supportForeAft),
    point(p.ringSkew * 0.4, p.groundHeight, p.supportForeAft),
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

export const ANNULAR_TRIPOD_ARMATURE_PROGRAM = Object.freeze({
  id: 'kaminos.lirm-armature-program.annular-tripod.v0',
  parameterVocabulary: `kaminos.rare-gestalt-armature.annular-tripod-${ANNULAR_TRIPOD_PARAMETER_SPECS.length}.v0`,
  parameterSpecs: ANNULAR_TRIPOD_PARAMETER_SPECS,
  createPrimitives: createAnnularTripodPrimitives,
});

export const TRIPOD_CANOPY_PARAMETER_SPECS = freezeSpecs([
  { id: 'canopyWidth', semanticRole: 'dorsalCanopy', initial: 1.42, min: 0.86, max: 2.02, step: 0.15 },
  { id: 'canopyHeight', semanticRole: 'dorsalCanopy', initial: 0.42, min: 0.24, max: 0.7, step: 0.07 },
  { id: 'canopyDepth', semanticRole: 'dorsalCanopy', initial: 0.92, min: 0.52, max: 1.42, step: 0.12 },
  { id: 'canopyArch', semanticRole: 'dorsalCanopyArch', initial: 0.2, min: -0.08, max: 0.48, step: 0.07 },
  { id: 'canopyRise', semanticRole: 'dorsalCanopyElevation', initial: 0.88, min: 0.62, max: 1.28, step: 0.09 },
  { id: 'canopyAsymmetry', semanticRole: 'controlledAsymmetry', initial: 0.12, min: -0.38, max: 0.38, step: 0.075 },
  { id: 'pendantWidth', semanticRole: 'suspendedSensoryMass', initial: 0.42, min: 0.22, max: 0.7, step: 0.07 },
  { id: 'pendantHeight', semanticRole: 'suspendedSensoryMass', initial: 0.46, min: 0.24, max: 0.76, step: 0.075 },
  { id: 'pendantDepth', semanticRole: 'suspendedSensoryMass', initial: 0.4, min: 0.22, max: 0.68, step: 0.065 },
  { id: 'pendantDrop', semanticRole: 'sensorySuspension', initial: 0.56, min: 0.28, max: 0.92, step: 0.09 },
  { id: 'pendantForward', semanticRole: 'sensorySuspension', initial: 0.34, min: 0.08, max: 0.68, step: 0.08 },
  { id: 'suspensorSpread', semanticRole: 'sensorySuspensor', initial: 0.3, min: 0.14, max: 0.52, step: 0.055 },
  { id: 'supportSpread', semanticRole: 'tripodSupportField', initial: 0.68, min: 0.38, max: 1.08, step: 0.09 },
  { id: 'supportForeAft', semanticRole: 'tripodSupportField', initial: 0.38, min: 0.18, max: 0.68, step: 0.07 },
  { id: 'supportThickness', semanticRole: 'tripodSupport', initial: 0.1, min: 0.055, max: 0.2, step: 0.025 },
  { id: 'footWidth', semanticRole: 'groundContact', initial: 0.17, min: 0.09, max: 0.3, step: 0.035 },
  { id: 'footDepth', semanticRole: 'groundContact', initial: 0.22, min: 0.11, max: 0.4, step: 0.045 },
  { id: 'groundHeight', semanticRole: 'groundContact', initial: -0.72, min: -0.92, max: -0.5, step: 0.06 },
]);

export function createTripodCanopyPrimitives(p) {
  const primitives = [];
  const canopyY = p.groundHeight + p.canopyRise;
  const lobeStations = [-0.72, -0.36, 0, 0.36, 0.72];
  for (const [index, station] of lobeStations.entries()) {
    const edgeTaper = 1 - Math.abs(station) * 0.38;
    primitives.push(ellipsoid(
      'dorsalCanopy',
      point(
        station * p.canopyWidth * 0.52 + p.canopyAsymmetry * (index / 4 - 0.5),
        canopyY + Math.cos(station * Math.PI) * p.canopyArch,
        Math.sin(station * Math.PI) * p.canopyAsymmetry * 0.42,
      ),
      point(
        p.canopyWidth * 0.23 * edgeTaper,
        p.canopyHeight * 0.5 * edgeTaper,
        p.canopyDepth * 0.5 * (0.9 + edgeTaper * 0.1),
      ),
    ));
  }
  primitives.push(capsule(
    'dorsalCanopy',
    point(-p.canopyWidth * 0.43, canopyY, 0),
    point(p.canopyWidth * 0.43, canopyY + p.canopyAsymmetry * 0.12, 0),
    p.canopyHeight * 0.32,
  ));

  const pendantCenter = point(
    p.canopyAsymmetry * 0.55,
    canopyY - p.pendantDrop,
    p.pendantForward,
  );
  const suspensorRoots = [
    point(-p.suspensorSpread, canopyY - p.canopyHeight * 0.28, p.pendantForward * 0.42),
    point(p.suspensorSpread, canopyY - p.canopyHeight * 0.28, p.pendantForward * 0.42),
  ];
  for (const root of suspensorRoots) {
    primitives.push(capsule('sensorySuspensor', root, pendantCenter, p.supportThickness * 0.52));
  }
  primitives.push(ellipsoid(
    'suspendedSensoryMass',
    pendantCenter,
    point(p.pendantWidth * 0.5, p.pendantHeight * 0.5, p.pendantDepth * 0.5),
  ));

  const supportRoots = [
    point(-p.canopyWidth * 0.38, canopyY - p.canopyHeight * 0.16, -p.canopyDepth * 0.2),
    point(p.canopyWidth * 0.38, canopyY - p.canopyHeight * 0.16, -p.canopyDepth * 0.2),
    point(p.canopyAsymmetry * 0.32, canopyY - p.canopyHeight * 0.18, p.canopyDepth * 0.32),
  ];
  const supportTargets = [
    point(-p.supportSpread, p.groundHeight, -p.supportForeAft),
    point(p.supportSpread, p.groundHeight, -p.supportForeAft),
    point(p.canopyAsymmetry * 0.2, p.groundHeight, p.supportForeAft),
  ];
  for (let index = 0; index < supportRoots.length; index += 1) {
    primitives.push(capsule('tripodSupport', supportRoots[index], supportTargets[index], p.supportThickness));
    primitives.push(ellipsoid(
      'groundContact',
      supportTargets[index],
      point(p.footWidth, p.supportThickness * 0.7, p.footDepth),
    ));
  }
  return primitives;
}

export const TRIPOD_CANOPY_ARMATURE_PROGRAM = Object.freeze({
  id: 'kaminos.lirm-armature-program.tripod-canopy.v0',
  parameterVocabulary: `kaminos.rare-gestalt-armature.tripod-canopy-${TRIPOD_CANOPY_PARAMETER_SPECS.length}.v0`,
  parameterSpecs: TRIPOD_CANOPY_PARAMETER_SPECS,
  createPrimitives: createTripodCanopyPrimitives,
});
