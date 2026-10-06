export const WEBPHYSICS_PATCH = 'kaminos-fixed-joint-rest-relative-v1';
export const WEBPHYSICS_OWNERSHIP_PATCH = 'kaminos-disabled-bvh-no-acquisition-v1';
export const WEBPHYSICS_COMPUTE_BATCH_PATCH = 'kaminos-colored-solve-commit-batch-v1';

export function applyWebphysicsComputeBatchPatch(source) {
  const before = '        renderer.compute(this.primalBodySolveKernel, [bodyWorkgroups, 1, 1]);\n        renderer.compute(this.commitBodySolveKernel, [bodyWorkgroups, 1, 1]);';
  if (source.split(before).length !== 2) throw new Error(`Webphysics revision drift in ${WEBPHYSICS_COMPUTE_BATCH_PATCH}`);
  return source.replace(before, '        renderer.compute([this.primalBodySolveKernel, this.commitBodySolveKernel], [bodyWorkgroups, 1, 1]);');
}

export function applyWebphysicsOwnershipPatch(source) {
  const replacements = [
    ['private readonly gpuBVHs: [BvhBuildBackend, BvhBuildBackend];', 'private readonly gpuBVHs: BvhBuildBackend[];'],
    ['this.gpuBVHs = [', 'this.gpuBVHs = this.enableBvhBuild ? ['],
    ['    ];\n\n    const prewarmCapacity', '    ] : [];\n\n    const prewarmCapacity'],
    ["    if (typeof this.gpuBVHs[0].prewarm === 'function') {\n      prewarmPromises.push(this.gpuBVHs[0].prewarm(prewarmCapacity));\n    }\n    if (typeof this.gpuBVHs[1].prewarm === 'function') {\n      prewarmPromises.push(this.gpuBVHs[1].prewarm(prewarmCapacity));\n    }",
      "    for (const builder of this.gpuBVHs) {\n      if (typeof builder.prewarm === 'function') prewarmPromises.push(builder.prewarm(prewarmCapacity));\n    }"],
    ['    this.gpuBVHs[0].dispose();\n    this.gpuBVHs[1].dispose();', '    for (const builder of this.gpuBVHs) builder.dispose();'],
  ];
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) throw new Error(`Webphysics revision drift in ${WEBPHYSICS_OWNERSHIP_PATCH}: ${before.split('\n')[0]}`);
    source = source.replace(before, after);
  }
  return source;
}

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
