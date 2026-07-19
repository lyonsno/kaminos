const point = (x, y, z) => ({ x, y, z });
const ellipsoid = (role, center, radius) => ({ kind: 'ellipsoid', role, center, radius });
const capsule = (role, a, b, radius) => ({ kind: 'capsule', role, a, b, radius });

export const FORKED_SADDLE_PARAMETER_SPECS = Object.freeze([
  { id: 'rootWidth', semanticRole: 'saddleRootMass', initial: 0.82, min: 0.48, max: 1.26, step: 0.12 },
  { id: 'rootHeight', semanticRole: 'saddleRootMass', initial: 0.42, min: 0.24, max: 0.72, step: 0.08 },
  { id: 'rootDepth', semanticRole: 'saddleRootMass', initial: 0.42, min: 0.22, max: 0.72, step: 0.08 },
  { id: 'branchSpread', semanticRole: 'forkBranchSeparation', initial: 1.18, min: 0.72, max: 1.82, step: 0.15 },
  { id: 'branchRise', semanticRole: 'forkBranchElevation', initial: 0.88, min: 0.44, max: 1.42, step: 0.14 },
  { id: 'branchArc', semanticRole: 'forkBranchCurvature', initial: 0.2, min: -0.18, max: 0.54, step: 0.08 },
  { id: 'branchThickness', semanticRole: 'forkBranch', initial: 0.26, min: 0.14, max: 0.48, step: 0.055 },
  { id: 'branchDepth', semanticRole: 'forkBranch', initial: 0.3, min: 0.16, max: 0.58, step: 0.065 },
  { id: 'branchForward', semanticRole: 'forkBranchTrajectory', initial: 0.04, min: -0.3, max: 0.42, step: 0.08 },
  { id: 'terminalWidth', semanticRole: 'terminalMass', initial: 0.52, min: 0.26, max: 0.9, step: 0.09 },
  { id: 'terminalHeight', semanticRole: 'terminalMass', initial: 0.46, min: 0.24, max: 0.82, step: 0.08 },
  { id: 'terminalDepth', semanticRole: 'terminalMass', initial: 0.42, min: 0.22, max: 0.76, step: 0.08 },
  { id: 'terminalLift', semanticRole: 'terminalElevation', initial: 0.06, min: -0.18, max: 0.34, step: 0.06 },
  { id: 'asymmetry', semanticRole: 'controlledAsymmetry', initial: 0.05, min: -0.34, max: 0.34, step: 0.065 },
  { id: 'depthTwist', semanticRole: 'branchDepthDivergence', initial: 0.05, min: -0.3, max: 0.3, step: 0.06 },
  { id: 'contactSpread', semanticRole: 'localizedContactField', initial: 0.62, min: 0.36, max: 1.04, step: 0.1 },
  { id: 'contactLength', semanticRole: 'localizedContactLimb', initial: 0.3, min: 0.14, max: 0.58, step: 0.075 },
  { id: 'contactThickness', semanticRole: 'localizedContactLimb', initial: 0.075, min: 0.04, max: 0.16, step: 0.022 },
  { id: 'contactForeAft', semanticRole: 'localizedContactDistribution', initial: 0.24, min: 0.08, max: 0.5, step: 0.07 },
  { id: 'groundHeight', semanticRole: 'groundContact', initial: -0.56, min: -0.76, max: -0.38, step: 0.06 },
].map(Object.freeze));

export function createForkedSaddlePrimitives(p) {
  const primitives = [];
  const rootCenter = point(0, p.groundHeight + p.rootHeight * 0.58, 0);
  const rootRadius = point(p.rootWidth * 0.5, p.rootHeight * 0.5, p.rootDepth * 0.5);
  primitives.push(ellipsoid('saddleRootMass', rootCenter, rootRadius));
  primitives.push(ellipsoid(
    'saddleRootMass',
    point(p.asymmetry * 0.14, rootCenter.y + p.rootHeight * 0.17, -p.branchForward * 0.18),
    point(p.rootWidth * 0.38, p.rootHeight * 0.42, p.rootDepth * 0.42),
  ));

  const terminals = [];
  for (const side of [-1, 1]) {
    const base = point(
      side * p.rootWidth * 0.28,
      rootCenter.y + p.rootHeight * 0.12,
      side * p.depthTwist * -0.14,
    );
    let previous = base;
    const branchSegments = 4;
    for (let index = 0; index < branchSegments; index += 1) {
      const t = (index + 1) / branchSegments;
      const outward = side * (
        p.rootWidth * 0.28
        + (p.branchSpread * 0.5 - p.rootWidth * 0.28) * t
        + Math.sin(t * Math.PI) * p.branchArc
      );
      const center = point(
        outward + p.asymmetry * t * (side > 0 ? 0.2 : 0.06),
        rootCenter.y + p.branchRise * t + p.terminalLift * t,
        p.branchForward * t + side * p.depthTwist * t,
      );
      const taper = 1 - t * 0.18;
      primitives.push(capsule('forkBranch', previous, center, p.branchThickness * 0.58 * taper));
      primitives.push(ellipsoid(
        'forkBranch',
        center,
        point(p.branchThickness * taper, p.branchThickness * 1.08 * taper, p.branchDepth * taper),
      ));
      previous = center;
    }
    const terminalCenter = point(
      previous.x + side * p.terminalWidth * 0.08,
      previous.y + p.terminalHeight * 0.12,
      previous.z + p.branchForward * 0.12,
    );
    primitives.push(ellipsoid(
      'terminalMass',
      terminalCenter,
      point(p.terminalWidth * 0.5, p.terminalHeight * 0.5, p.terminalDepth * 0.5),
    ));
    terminals.push(terminalCenter);
  }

  for (const side of [-1, 1]) {
    for (const foreAft of [-1, 1]) {
      const shoulder = point(
        side * p.rootWidth * 0.38,
        rootCenter.y - p.rootHeight * 0.28,
        foreAft * p.contactForeAft,
      );
      const target = point(
        side * p.contactSpread + p.asymmetry * foreAft * 0.08,
        p.groundHeight,
        foreAft * (p.contactForeAft + p.depthTwist * 0.3),
      );
      const dx = target.x - shoulder.x;
      const dy = target.y - shoulder.y;
      const dz = target.z - shoulder.z;
      const distance = Math.max(Math.hypot(dx, dy, dz), 1e-8);
      const reach = Math.min(1, p.contactLength / distance);
      const foot = point(
        shoulder.x + dx * reach,
        shoulder.y + dy * reach,
        shoulder.z + dz * reach,
      );
      primitives.push(capsule('localizedContactLimb', shoulder, foot, p.contactThickness));
      primitives.push(ellipsoid(
        'groundContact',
        foot,
        point(p.contactThickness * 1.7, p.contactThickness * 0.72, p.contactThickness * 1.9),
      ));
    }
  }
  return primitives;
}

export const FORKED_SADDLE_ARMATURE_PROGRAM = Object.freeze({
  id: 'kaminos.lirm-armature-program.forked-saddle.v0',
  parameterVocabulary: `kaminos.reference-fitted-armature.forked-saddle-${FORKED_SADDLE_PARAMETER_SPECS.length}.v0`,
  parameterSpecs: FORKED_SADDLE_PARAMETER_SPECS,
  createPrimitives: createForkedSaddlePrimitives,
});

export const ASYMMETRIC_BEAD_CHAIN_PARAMETER_SPECS = Object.freeze([
  { id: 'posteriorLength', semanticRole: 'posteriorCluster', initial: 0.84, min: 0.46, max: 1.34, step: 0.13 },
  { id: 'posteriorWidth', semanticRole: 'posteriorCluster', initial: 0.72, min: 0.38, max: 1.14, step: 0.11 },
  { id: 'posteriorHeight', semanticRole: 'posteriorCluster', initial: 0.62, min: 0.34, max: 1.02, step: 0.1 },
  { id: 'posteriorSplit', semanticRole: 'posteriorMassArticulation', initial: 0.26, min: 0.08, max: 0.52, step: 0.07 },
  { id: 'posteriorLift', semanticRole: 'posteriorElevation', initial: 0.08, min: -0.18, max: 0.34, step: 0.07 },
  { id: 'chainLength', semanticRole: 'axialBeadTrajectory', initial: 1.38, min: 0.82, max: 2.02, step: 0.17 },
  { id: 'beadWidth', semanticRole: 'axialBead', initial: 0.46, min: 0.24, max: 0.76, step: 0.08 },
  { id: 'beadHeight', semanticRole: 'axialBead', initial: 0.42, min: 0.22, max: 0.72, step: 0.075 },
  { id: 'beadDepth', semanticRole: 'axialBead', initial: 0.48, min: 0.26, max: 0.78, step: 0.08 },
  { id: 'beadTaper', semanticRole: 'axialMassTaper', initial: 0.48, min: 0.08, max: 0.82, step: 0.09 },
  { id: 'lateralSweep', semanticRole: 'axialLateralSweep', initial: 0.38, min: -0.62, max: 0.82, step: 0.1 },
  { id: 'verticalArc', semanticRole: 'axialVerticalArc', initial: 0.18, min: -0.28, max: 0.54, step: 0.08 },
  { id: 'axialBias', semanticRole: 'axialMassDistribution', initial: 0.12, min: -0.42, max: 0.42, step: 0.08 },
  { id: 'terminalWidth', semanticRole: 'terminalSensoryMass', initial: 0.44, min: 0.22, max: 0.76, step: 0.08 },
  { id: 'terminalHeight', semanticRole: 'terminalSensoryMass', initial: 0.42, min: 0.22, max: 0.72, step: 0.075 },
  { id: 'terminalDepth', semanticRole: 'terminalSensoryMass', initial: 0.46, min: 0.24, max: 0.78, step: 0.08 },
  { id: 'terminalOffset', semanticRole: 'terminalSensoryOffset', initial: 0.14, min: -0.28, max: 0.44, step: 0.075 },
  { id: 'contactSpread', semanticRole: 'localizedContactField', initial: 0.54, min: 0.3, max: 0.92, step: 0.09 },
  { id: 'contactLength', semanticRole: 'localizedContactLimb', initial: 0.28, min: 0.13, max: 0.56, step: 0.07 },
  { id: 'contactThickness', semanticRole: 'localizedContactLimb', initial: 0.072, min: 0.04, max: 0.16, step: 0.022 },
  { id: 'contactBias', semanticRole: 'localizedContactDistribution', initial: 0.16, min: -0.38, max: 0.38, step: 0.07 },
  { id: 'groundHeight', semanticRole: 'groundContact', initial: -0.56, min: -0.76, max: -0.38, step: 0.06 },
].map(Object.freeze));

export function createAsymmetricBeadChainPrimitives(p) {
  const primitives = [];
  const posteriorCenter = point(
    -p.lateralSweep * 0.2,
    p.groundHeight + p.posteriorHeight * 0.62 + p.posteriorLift,
    -p.chainLength * 0.48,
  );
  const posteriorRadius = point(p.posteriorWidth * 0.5, p.posteriorHeight * 0.5, p.posteriorLength * 0.5);
  primitives.push(ellipsoid('posteriorCluster', posteriorCenter, posteriorRadius));
  for (const side of [-1, 1]) {
    primitives.push(ellipsoid(
      'posteriorCluster',
      point(
        posteriorCenter.x + side * p.posteriorSplit + p.lateralSweep * (side > 0 ? 0.08 : -0.02),
        posteriorCenter.y + p.posteriorHeight * (side > 0 ? 0.12 : -0.02),
        posteriorCenter.z + p.posteriorLength * (side > 0 ? 0.08 : -0.06),
      ),
      point(p.posteriorWidth * 0.34, p.posteriorHeight * 0.4, p.posteriorLength * 0.34),
    ));
  }

  const beadCount = 5;
  let previous = point(
    posteriorCenter.x + p.lateralSweep * 0.08,
    posteriorCenter.y - p.posteriorHeight * 0.08,
    posteriorCenter.z + posteriorRadius.z * 0.72,
  );
  for (let index = 0; index < beadCount; index += 1) {
    const t = (index + 1) / beadCount;
    const taper = 1 - p.beadTaper * t * 0.62;
    const center = point(
      posteriorCenter.x + p.lateralSweep * (Math.sin(t * Math.PI * 0.82) + t * 0.52),
      posteriorCenter.y - p.posteriorHeight * 0.14 + Math.sin(t * Math.PI) * p.verticalArc + p.axialBias * (t - 0.5),
      posteriorCenter.z + posteriorRadius.z * 0.58 + p.chainLength * t,
    );
    primitives.push(capsule('axialBead', previous, center, p.beadWidth * 0.32 * taper));
    primitives.push(ellipsoid(
      'axialBead',
      center,
      point(p.beadWidth * 0.5 * taper, p.beadHeight * 0.5 * taper, p.beadDepth * 0.5 * taper),
    ));
    previous = center;
  }
  const terminalCenter = point(
    previous.x + p.terminalOffset,
    previous.y + p.terminalHeight * 0.05,
    previous.z + p.terminalDepth * 0.24,
  );
  primitives.push(capsule('axialBead', previous, terminalCenter, p.beadWidth * 0.24));
  primitives.push(ellipsoid(
    'terminalSensoryMass',
    terminalCenter,
    point(p.terminalWidth * 0.5, p.terminalHeight * 0.5, p.terminalDepth * 0.5),
  ));

  const supportStations = [
    { t: 0.18, side: -1 },
    { t: 0.3, side: 1 },
    { t: 0.64, side: -1 },
    { t: 0.76, side: 1 },
  ];
  for (const [index, station] of supportStations.entries()) {
    const z = posteriorCenter.z + posteriorRadius.z * 0.46 + p.chainLength * station.t;
    const x = posteriorCenter.x + p.lateralSweep * Math.sin(station.t * Math.PI * 0.82);
    const shoulder = point(
      x + station.side * p.beadWidth * 0.32,
      posteriorCenter.y - p.posteriorHeight * 0.38,
      z,
    );
    const target = point(
      x + station.side * p.contactSpread + p.contactBias * (index - 1.5) * 0.08,
      p.groundHeight,
      z + p.contactBias * station.side,
    );
    const dx = target.x - shoulder.x;
    const dy = target.y - shoulder.y;
    const dz = target.z - shoulder.z;
    const distance = Math.max(Math.hypot(dx, dy, dz), 1e-8);
    const reach = Math.min(1, p.contactLength / distance);
    const foot = point(
      shoulder.x + dx * reach,
      shoulder.y + dy * reach,
      shoulder.z + dz * reach,
    );
    primitives.push(capsule('localizedContactLimb', shoulder, foot, p.contactThickness));
    primitives.push(ellipsoid(
      'groundContact',
      foot,
      point(p.contactThickness * 1.7, p.contactThickness * 0.72, p.contactThickness * 1.9),
    ));
  }
  return primitives;
}

export const ASYMMETRIC_BEAD_CHAIN_ARMATURE_PROGRAM = Object.freeze({
  id: 'kaminos.lirm-armature-program.asymmetric-bead-chain.v0',
  parameterVocabulary: `kaminos.reference-fitted-armature.asymmetric-bead-chain-${ASYMMETRIC_BEAD_CHAIN_PARAMETER_SPECS.length}.v0`,
  parameterSpecs: ASYMMETRIC_BEAD_CHAIN_PARAMETER_SPECS,
  createPrimitives: createAsymmetricBeadChainPrimitives,
});
