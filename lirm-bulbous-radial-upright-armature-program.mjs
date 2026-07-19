export const BULBOUS_RADIAL_UPRIGHT_PARAMETER_SPECS = Object.freeze([
  { id: 'posteriorBulbLength', semanticRole: 'posteriorBulbousMass', initial: 0.92, min: 0.56, max: 1.46, step: 0.14 },
  { id: 'posteriorBulbWidth', semanticRole: 'posteriorBulbousMass', initial: 0.72, min: 0.4, max: 1.12, step: 0.11 },
  { id: 'posteriorBulbHeight', semanticRole: 'posteriorBulbousMass', initial: 0.68, min: 0.38, max: 1.08, step: 0.1 },
  { id: 'posteriorLift', semanticRole: 'posteriorElevation', initial: 0.04, min: -0.18, max: 0.3, step: 0.07 },
  { id: 'bridgeLength', semanticRole: 'bodyBridge', initial: 0.88, min: 0.52, max: 1.42, step: 0.13 },
  { id: 'bridgeWidth', semanticRole: 'bodyBridge', initial: 0.42, min: 0.24, max: 0.74, step: 0.08 },
  { id: 'bridgeHeight', semanticRole: 'bodyBridge', initial: 0.32, min: 0.18, max: 0.58, step: 0.07 },
  { id: 'bridgeLift', semanticRole: 'bridgeElevation', initial: 0.02, min: -0.16, max: 0.3, step: 0.06 },
  { id: 'chestWidth', semanticRole: 'anteriorChestMass', initial: 0.56, min: 0.3, max: 0.92, step: 0.09 },
  { id: 'chestHeight', semanticRole: 'anteriorChestMass', initial: 0.6, min: 0.3, max: 0.98, step: 0.1 },
  { id: 'chestDepth', semanticRole: 'anteriorChestMass', initial: 0.5, min: 0.28, max: 0.86, step: 0.08 },
  { id: 'chestLift', semanticRole: 'anteriorChestElevation', initial: 0.06, min: -0.18, max: 0.38, step: 0.07 },
  { id: 'neckHeight', semanticRole: 'anteriorUprightNeck', initial: 0.86, min: 0.42, max: 1.34, step: 0.13 },
  { id: 'neckThickness', semanticRole: 'anteriorUprightNeck', initial: 0.25, min: 0.13, max: 0.46, step: 0.06 },
  { id: 'neckForward', semanticRole: 'anteriorNeckTrajectory', initial: 0.2, min: -0.18, max: 0.52, step: 0.08 },
  { id: 'neckCurve', semanticRole: 'anteriorNeckTrajectory', initial: 0.08, min: -0.28, max: 0.3, step: 0.07 },
  { id: 'headWidth', semanticRole: 'anteriorHead', initial: 0.42, min: 0.22, max: 0.72, step: 0.08 },
  { id: 'headHeight', semanticRole: 'anteriorHead', initial: 0.38, min: 0.2, max: 0.68, step: 0.07 },
  { id: 'headDepth', semanticRole: 'anteriorHead', initial: 0.36, min: 0.2, max: 0.66, step: 0.07 },
  { id: 'headForward', semanticRole: 'anteriorHeadProjection', initial: 0.12, min: -0.16, max: 0.38, step: 0.07 },
  { id: 'contactSpread', semanticRole: 'radialContactField', initial: 0.66, min: 0.4, max: 1.08, step: 0.1 },
  { id: 'contactLength', semanticRole: 'radialContactLimb', initial: 0.34, min: 0.16, max: 0.68, step: 0.08 },
  { id: 'contactThickness', semanticRole: 'radialContactLimb', initial: 0.075, min: 0.04, max: 0.17, step: 0.025 },
  { id: 'contactBias', semanticRole: 'longitudinalContactDistribution', initial: 0.1, min: -0.42, max: 0.42, step: 0.08 },
  { id: 'radialTwist', semanticRole: 'radialContactField', initial: 0.08, min: -0.34, max: 0.34, step: 0.07 },
  { id: 'asymmetry', semanticRole: 'controlledAsymmetry', initial: 0.06, min: -0.3, max: 0.3, step: 0.06 },
].map(Object.freeze));

const point = (x, y, z) => ({ x, y, z });
const ellipsoid = (role, center, radius) => ({ kind: 'ellipsoid', role, center, radius });
const capsule = (role, a, b, radius) => ({ kind: 'capsule', role, a, b, radius });

export function createBulbousRadialUprightPrimitives(p) {
  const primitives = [];
  const groundY = -0.57;
  const posteriorCenter = point(-p.asymmetry * 0.08, -0.14 + p.posteriorLift, -0.5);
  const posteriorRadius = point(
    p.posteriorBulbWidth * 0.5,
    p.posteriorBulbHeight * 0.5,
    p.posteriorBulbLength * 0.5,
  );
  primitives.push(ellipsoid('posteriorBulbousMass', posteriorCenter, posteriorRadius));
  primitives.push(ellipsoid(
    'posteriorBulbousMass',
    point(
      posteriorCenter.x + p.asymmetry * 0.16,
      posteriorCenter.y + p.posteriorBulbHeight * 0.08,
      posteriorCenter.z - p.posteriorBulbLength * 0.2,
    ),
    point(
      p.posteriorBulbWidth * 0.42,
      p.posteriorBulbHeight * 0.43,
      p.posteriorBulbLength * 0.32,
    ),
  ));

  const bridgeCenter = point(p.asymmetry * 0.06, -0.05 + p.bridgeLift, 0.04);
  const bridgeRadius = point(p.bridgeWidth * 0.5, p.bridgeHeight * 0.5, p.bridgeLength * 0.5);
  primitives.push(ellipsoid('bodyBridge', bridgeCenter, bridgeRadius));

  const chestCenter = point(
    p.asymmetry * 0.05,
    bridgeCenter.y + p.chestLift,
    bridgeCenter.z + bridgeRadius.z * 0.45,
  );
  const chestRadius = point(p.chestWidth * 0.5, p.chestHeight * 0.5, p.chestDepth * 0.5);
  primitives.push(ellipsoid('anteriorChestMass', chestCenter, chestRadius));

  const neckSegmentCount = 4;
  const neckBaseY = chestCenter.y + chestRadius.y * 0.52;
  const neckBaseZ = chestCenter.z + chestRadius.z * 0.34;
  let neckTip = null;
  for (let index = 0; index < neckSegmentCount; index += 1) {
    const t = index / (neckSegmentCount - 1);
    const center = point(
      Math.sin(t * Math.PI) * p.neckCurve + p.asymmetry * (t - 0.35),
      neckBaseY + t * p.neckHeight * 0.72,
      neckBaseZ + t * (0.18 + p.neckForward),
    );
    const taper = 1 - t * 0.2;
    const radius = point(
      p.neckThickness * 0.62 * taper,
      p.neckHeight * 0.17,
      p.neckThickness * 0.7 * taper,
    );
    primitives.push(ellipsoid('anteriorUprightNeck', center, radius));
    neckTip = { center, radius };
  }

  const headCenter = point(
    neckTip.center.x + p.asymmetry * 0.18,
    neckTip.center.y + p.headHeight * 0.28,
    neckTip.center.z + p.headDepth * 0.18 + p.headForward,
  );
  primitives.push(ellipsoid(
    'anteriorHead',
    headCenter,
    point(p.headWidth * 0.5, p.headHeight * 0.5, p.headDepth * 0.5),
  ));

  const contactStations = [
    posteriorCenter.z - posteriorRadius.z * 0.48,
    posteriorCenter.z + posteriorRadius.z * 0.3,
    bridgeCenter.z + bridgeRadius.z * 0.05,
    neckBaseZ + p.neckForward * 0.18,
  ];
  contactStations.forEach((stationZ, stationIndex) => {
    const longitudinal = stationIndex / (contactStations.length - 1) * 2 - 1;
    for (const side of [-1, 1]) {
      const localWidth = stationIndex < 2 ? posteriorRadius.x : bridgeRadius.x;
      const shoulder = point(
        side * localWidth * 0.72 + p.asymmetry * 0.08 * longitudinal,
        Math.max(groundY + 0.17, bridgeCenter.y - bridgeRadius.y * 0.55),
        stationZ,
      );
      const spread = p.contactSpread * (1 + p.contactBias * longitudinal);
      const longitudinalSplay = p.radialTwist * (side * 0.38 + longitudinal * 0.24);
      const footTarget = point(
        side * spread + p.asymmetry * 0.12 * (stationIndex % 2 ? 1 : -1),
        groundY,
        stationZ + longitudinalSplay,
      );
      const dx = footTarget.x - shoulder.x;
      const dy = footTarget.y - shoulder.y;
      const dz = footTarget.z - shoulder.z;
      const distance = Math.max(Math.hypot(dx, dy, dz), 1e-8);
      const reach = Math.min(1, p.contactLength / distance);
      const foot = point(
        shoulder.x + dx * reach,
        shoulder.y + dy * reach,
        shoulder.z + dz * reach,
      );
      primitives.push(capsule('radialContactLimb', shoulder, foot, p.contactThickness));
      primitives.push(ellipsoid(
        'groundContact',
        foot,
        point(p.contactThickness * 1.75, p.contactThickness * 0.7, p.contactThickness * 1.9),
      ));
    }
  });
  return primitives;
}

export const BULBOUS_RADIAL_UPRIGHT_ARMATURE_PROGRAM = Object.freeze({
  id: 'kaminos.lirm-armature-program.bulbous-radial-upright.v0',
  parameterVocabulary: 'kaminos.reference-fitted-armature.bulbous-radial-upright-26.v0',
  parameterSpecs: BULBOUS_RADIAL_UPRIGHT_PARAMETER_SPECS,
  createPrimitives: createBulbousRadialUprightPrimitives,
});
