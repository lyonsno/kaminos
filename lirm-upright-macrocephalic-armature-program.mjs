export const UPRIGHT_MACROCEPHALIC_PARAMETER_SPECS = Object.freeze([
  { id: 'trunkHeight', semanticRole: 'uprightTrunk', initial: 0.78, min: 0.42, max: 1.24, step: 0.14 },
  { id: 'trunkWidth', semanticRole: 'uprightTrunk', initial: 0.38, min: 0.22, max: 0.72, step: 0.09 },
  { id: 'trunkDepth', semanticRole: 'uprightTrunk', initial: 0.42, min: 0.22, max: 0.78, step: 0.1 },
  { id: 'crownWidth', semanticRole: 'macrocephalicCrown', initial: 0.74, min: 0.38, max: 1.18, step: 0.14 },
  { id: 'crownHeight', semanticRole: 'macrocephalicCrown', initial: 0.48, min: 0.26, max: 0.82, step: 0.1 },
  { id: 'crownDepth', semanticRole: 'macrocephalicCrown', initial: 0.58, min: 0.3, max: 0.98, step: 0.12 },
  { id: 'crownLift', semanticRole: 'crownElevation', initial: 0.16, min: -0.04, max: 0.42, step: 0.07 },
  { id: 'waistScale', semanticRole: 'waistCompression', initial: 0.56, min: 0.3, max: 0.9, step: 0.09 },
  { id: 'crownForward', semanticRole: 'anteriorProjection', initial: 0.08, min: -0.24, max: 0.38, step: 0.08 },
  { id: 'posteriorBulb', semanticRole: 'posteriorCountermass', initial: 0.42, min: 0.16, max: 0.82, step: 0.1 },
  { id: 'contactSpread', semanticRole: 'radialContactField', initial: 0.62, min: 0.36, max: 1.02, step: 0.11 },
  { id: 'contactLength', semanticRole: 'radialContactLimb', initial: 0.32, min: 0.16, max: 0.62, step: 0.08 },
  { id: 'contactThickness', semanticRole: 'radialContactLimb', initial: 0.085, min: 0.045, max: 0.18, step: 0.025 },
  { id: 'radialTwist', semanticRole: 'controlledAsymmetry', initial: 0.08, min: -0.34, max: 0.34, step: 0.07 },
].map(Object.freeze));

const point = (x, y, z) => ({ x, y, z });
const ellipsoid = (role, center, radius) => ({ kind: 'ellipsoid', role, center, radius });
const capsule = (role, a, b, radius) => ({ kind: 'capsule', role, a, b, radius });

export function createUprightMacrocephalicPrimitives(p) {
  const primitives = [];
  const groundY = -0.54;
  const trunkCenterY = -0.08 + p.trunkHeight * 0.22;
  const crownCenterY = trunkCenterY + p.trunkHeight * 0.42 + p.crownLift;

  primitives.push(ellipsoid(
    'uprightTrunk',
    point(0, trunkCenterY, -0.05),
    point(p.trunkWidth * 0.78, p.trunkHeight * 0.5, p.trunkDepth * 0.78),
  ));
  primitives.push(ellipsoid(
    'posteriorCountermass',
    point(-p.radialTwist * 0.09, trunkCenterY + p.trunkHeight * 0.04, -p.trunkDepth * 0.42),
    point(p.trunkWidth * (0.52 + p.posteriorBulb * 0.26), p.trunkHeight * 0.32, p.trunkDepth * (0.4 + p.posteriorBulb * 0.34)),
  ));
  primitives.push(ellipsoid(
    'waistCompression',
    point(p.radialTwist * 0.08, trunkCenterY + p.trunkHeight * 0.34, p.crownForward * 0.22),
    point(p.trunkWidth * p.waistScale, p.trunkHeight * 0.22, p.trunkDepth * p.waistScale),
  ));

  const crownSideOffset = p.crownWidth * 0.24;
  for (const side of [-1, 1]) {
    primitives.push(ellipsoid(
      'macrocephalicCrown',
      point(
        side * crownSideOffset + p.radialTwist * (side > 0 ? 0.08 : -0.03),
        crownCenterY + (side > 0 ? p.radialTwist * 0.04 : 0),
        p.crownForward + side * p.radialTwist * 0.05,
      ),
      point(p.crownWidth * 0.38, p.crownHeight * 0.5, p.crownDepth * 0.48),
    ));
  }
  primitives.push(ellipsoid(
    'macrocephalicCrown',
    point(0, crownCenterY - p.crownHeight * 0.03, p.crownForward - p.crownDepth * 0.06),
    point(p.crownWidth * 0.46, p.crownHeight * 0.43, p.crownDepth * 0.5),
  ));

  const contactCount = 6;
  for (let index = 0; index < contactCount; index += 1) {
    const baseAngle = index * Math.PI * 2 / contactCount;
    const angle = baseAngle + p.radialTwist * (index % 2 ? -0.55 : 0.8);
    const directionX = Math.cos(angle);
    const directionZ = Math.sin(angle);
    const shoulder = point(
      directionX * p.trunkWidth * 0.45,
      groundY + 0.2,
      directionZ * p.trunkDepth * 0.45,
    );
    const radialDistance = Math.min(p.contactSpread, Math.hypot(shoulder.x, shoulder.z) + p.contactLength);
    const foot = point(directionX * radialDistance, groundY, directionZ * radialDistance);
    primitives.push(capsule('radialContactLimb', shoulder, foot, p.contactThickness));
    primitives.push(ellipsoid(
      'groundContact',
      foot,
      point(p.contactThickness * 1.7, p.contactThickness * 0.72, p.contactThickness * 1.7),
    ));
  }
  return primitives;
}

export const UPRIGHT_MACROCEPHALIC_ARMATURE_PROGRAM = Object.freeze({
  id: 'kaminos.lirm-armature-program.upright-macrocephalic.v0',
  parameterVocabulary: 'kaminos.reference-fitted-armature.upright-macrocephalic-14.v0',
  parameterSpecs: UPRIGHT_MACROCEPHALIC_PARAMETER_SPECS,
  createPrimitives: createUprightMacrocephalicPrimitives,
});
