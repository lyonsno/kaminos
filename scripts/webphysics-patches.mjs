export const WEBPHYSICS_PATCH = 'kaminos-fixed-joint-rest-relative-v1';

export function applyWebphysicsPatches(source) {
  const replacements = [
    ['fn jointFixedAngularConstraint(\n        bodyA: u32,\n        qA: vec4f,\n        qB: vec4f,\n        torqueArm: f32,',
      'fn jointFixedAngularConstraint(\n        bodyA: u32,\n        qA: vec4f,\n        qB: vec4f,\n        restRelative: vec4f,\n        torqueArm: f32,'],
    ['let delta = qmul(worldQA, qconj(normalize(qB)));',
      'let delta = qmul(qmul(worldQA, normalize(restRelative)), qconj(normalize(qB)));'],
    ['regularizationPoseB.rotation,\n            torqueArm,',
      'regularizationPoseB.rotation,\n            loadJointRestRelativeRotation(jointRecords, gid),\n            torqueArm,'],
    ['jointFixedAngularConstraint(jointBodyA, currentQA, currentQB, torqueArm)',
      'jointFixedAngularConstraint(jointBodyA, currentQA, currentQB, loadJointRestRelativeRotation(jointRecords, jointIndex), torqueArm)'],
    ['jointFixedAngularConstraint(bodyA, currentQA, currentQB, torqueArm)',
      'jointFixedAngularConstraint(bodyA, currentQA, currentQB, loadJointRestRelativeRotation(jointRecords, gid), torqueArm)'],
  ];
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) throw new Error(`Webphysics revision drift in ${WEBPHYSICS_PATCH}: ${before.split('\n')[0]}`);
    source = source.replace(before, after);
  }
  return source;
}
