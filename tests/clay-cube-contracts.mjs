import assert from 'node:assert/strict';

import * as clayCore from '../clay-core.js';

const {
  measureClayCubeVolumeProxy,
  normalizeClayCubePointerCollider,
  normalizeClayCubeConfig,
  runClayCubeFirstLoopOracle,
  seedClayCubeMaterialPoints,
} = clayCore;

const config = normalizeClayCubeConfig('8x8x8');
assert.equal(config.requestedClayCube, '8x8x8');
assert.equal(config.effectiveClayCube, '8x8x8');
assert.equal(config.cubeX, 8);
assert.equal(config.cubeY, 8);
assert.equal(config.cubeZ, 8);
assert.equal(config.particleCount, 512);
assert.equal(config.gridDimension, 16);
assert.deepEqual(config.clayCubeConfigWarnings, []);

const unsupported = normalizeClayCubeConfig('99x2x1');
assert.equal(unsupported.effectiveClayCube, '8x8x8', 'unsupported cube preset falls back to default explicitly');
assert.deepEqual(unsupported.clayCubeConfigWarnings, ['unsupported-clay-cube:99x2x1']);

const particles = seedClayCubeMaterialPoints(config);
assert.equal(particles.length, config.particleCount * 4, 'cube material points are packed as vec4 positions');
assert.ok(particles[0] < 0 && particles[2] < 0, 'first material point starts in the negative cube corner');
assert.ok(particles[particles.length - 4] > 0, 'last material point reaches positive X extent');
assert.equal(particles[3], 1, 'material point w lane stores active mass');

const oracle = runClayCubeFirstLoopOracle({
  basePositions: particles,
  previousPositions: particles,
  config,
  colliders: [{
    id: 'test-finger',
    center: [0, 0.34, 0],
    radius: 0.46,
    strength: 1.35,
  }],
});

assert.equal(oracle.evidenceKind, 'deterministic-js-oracle-not-runtime-fallback');
assert.equal(oracle.particleCount, config.particleCount);
assert.equal(oracle.gridDimension, config.gridDimension);
assert.ok(oracle.deformedParticleCount > 0, 'cube oracle produces hand-influenced deformation');
assert.ok(oracle.contactParticleCount > 0, 'cube oracle records hand contact over material points');
assert.ok(oracle.activeGridCellCount > 0, 'cube oracle records occupied grid cells');
assert.equal(oracle.surfaceVisible, false, 'cube oracle defaults to cube-only witness visibility');
assert.equal(oracle.diagnosticColorMode, 'cube-diagnostic-contact-displacement-colors-v0');
assert.ok(oracle.diagnosticColoredParticleCount > 0, 'cube oracle records particles receiving diagnostic color');
assert.ok(oracle.diagnosticHotParticleCount > 0, 'cube oracle records hot/contact diagnostic particles');
assert.equal(oracle.faceMetricEvidenceKind, 'solver-space-material-point-face-locality-v0');
assert.ok(Number.isFinite(oracle.frontBackDeformationRatio), 'cube oracle reports front/back deformation ratio');
assert.ok(oracle.edgeBandDeformedParticleCount >= 0, 'cube oracle reports edge-band deformation count');
assert.ok(oracle.cornerBandDeformedParticleCount >= 0, 'cube oracle reports corner-band deformation count');
assert.ok(['front', 'back', 'left', 'right', 'top', 'bottom', 'interior'].includes(oracle.maxDisplacementFace), 'cube oracle names max displacement face');
assert.ok(oracle.maxDisplacement > 0.01, 'cube oracle produces readable 3D displacement');
assert.ok(oracle.minY < 0.08, 'cube oracle lets lower/interior material move, not only the top skin');
assert.ok(oracle.heightRange > 0.25, 'cube oracle keeps a coherent 3D height span');

const cubePointer = normalizeClayCubePointerCollider({
  id: 'front-face-pointer',
  center: [0.0968, 0.4468, 0.34],
  rawCenter: [0.0968, 0.4468, 0.34],
  surfaceNormal: [0, 0, -1],
  radius: 0.17,
  strength: 1.18,
});

assert.equal(cubePointer.id, 'front-face-pointer');
assert.equal(cubePointer.center[0], 0.0968);
assert.equal(cubePointer.center[1], 0.4468);
assert.equal(cubePointer.center[2], 0.34, 'cube pointer normalization must not inset a front-face hit with the old heightfield edge clamp');
assert.deepEqual(cubePointer.rawCenter, [0.0968, 0.4468, 0.34]);
assert.deepEqual(cubePointer.surfaceNormal, [0, 0, -1], 'cube pointer preserves inward face normal for front-face contact');
assert.equal(cubePointer.radius, 0.17);
assert.equal(cubePointer.strength, 1.18);

const frontFaceOracle = runClayCubeFirstLoopOracle({
  basePositions: particles,
  previousPositions: particles,
  config,
  colliders: [cubePointer],
});

let maxAbsY = 0;
let maxInwardZ = 0;
for (let i = 0; i < config.particleCount; i += 1) {
  const offset = i * 4;
  maxAbsY = Math.max(maxAbsY, Math.abs(frontFaceOracle.positions[offset + 1] - particles[offset + 1]));
  maxInwardZ = Math.max(maxInwardZ, particles[offset + 2] - frontFaceOracle.positions[offset + 2]);
}
assert.ok(maxInwardZ > maxAbsY * 2, `front-face cube brush should press inward along Z, not down like the top surface: z=${maxInwardZ} y=${maxAbsY}`);

const leftFacePointer = normalizeClayCubePointerCollider({
  id: 'left-face-pointer',
  center: [-0.44, 0.34, 0.02],
  rawCenter: [-0.44, 0.34, 0.02],
  surfaceNormal: [1, 0, 0],
  radius: 0.17,
  strength: 1.18,
});
const leftFaceOracle = runClayCubeFirstLoopOracle({
  basePositions: particles,
  previousPositions: particles,
  config,
  colliders: [leftFacePointer],
});

let maxInwardX = 0;
let leftMaxAbsY = 0;
for (let i = 0; i < config.particleCount; i += 1) {
  const offset = i * 4;
  maxInwardX = Math.max(maxInwardX, leftFaceOracle.positions[offset] - particles[offset]);
  leftMaxAbsY = Math.max(leftMaxAbsY, Math.abs(leftFaceOracle.positions[offset + 1] - particles[offset + 1]));
}
assert.ok(maxInwardX > leftMaxAbsY * 2, `side-face cube brush should press inward along X, not down like the top surface: x=${maxInwardX} y=${leftMaxAbsY}`);

const cornerConfig = normalizeClayCubeConfig('10x10x10');
const cornerParticles = seedClayCubeMaterialPoints(cornerConfig);
const nearCornerPointer = normalizeClayCubePointerCollider({
  id: 'front-upper-right-corner-pointer',
  center: [0.36, 0.58, 0.34],
  rawCenter: [0.36, 0.58, 0.34],
  surfaceNormal: [0, 0, -1],
  radius: 0.17,
  strength: 1.18,
});
const nearCornerOracle = runClayCubeFirstLoopOracle({
  basePositions: cornerParticles,
  previousPositions: cornerParticles,
  config: cornerConfig,
  colliders: [nearCornerPointer],
});

let maxCornerDisplacement = 0;
let maxNonCornerDisplacement = 0;
for (let y = 0; y < cornerConfig.cubeY; y += 1) {
  for (let z = 0; z < cornerConfig.cubeZ; z += 1) {
    for (let x = 0; x < cornerConfig.cubeX; x += 1) {
      const index = y * cornerConfig.cubeZ * cornerConfig.cubeX + z * cornerConfig.cubeX + x;
      const offset = index * 4;
      const displacement = Math.hypot(
        nearCornerOracle.positions[offset] - cornerParticles[offset],
        nearCornerOracle.positions[offset + 1] - cornerParticles[offset + 1],
        nearCornerOracle.positions[offset + 2] - cornerParticles[offset + 2],
      );
      const boundaryAxes = Number(x === 0 || x === cornerConfig.cubeX - 1)
        + Number(y === 0 || y === cornerConfig.cubeY - 1)
        + Number(z === 0 || z === cornerConfig.cubeZ - 1);
      if (boundaryAxes >= 3) {
        maxCornerDisplacement = Math.max(maxCornerDisplacement, displacement);
      } else {
        maxNonCornerDisplacement = Math.max(maxNonCornerDisplacement, displacement);
      }
    }
  }
}
assert.ok(
  maxCornerDisplacement >= maxNonCornerDisplacement * 0.18,
  `near-corner brush left the cube corner too pointed: corner=${maxCornerDisplacement} nonCorner=${maxNonCornerDisplacement}`,
);
assert.ok(
  maxCornerDisplacement >= maxNonCornerDisplacement * 0.45,
  `near-corner brush did not materially soften the corner: corner=${maxCornerDisplacement} nonCorner=${maxNonCornerDisplacement}`,
);

assert.equal(
  typeof clayCore.buildClayCubeBoundarySkinFrame,
  'function',
  'cube route needs a boundary-skin fairing frame builder with roughness metrics',
);

const rawBoundaryFrame = clayCore.buildClayCubeBoundarySkinFrame({
  basePositions: cornerParticles,
  positions: nearCornerOracle.positions,
  config: cornerConfig,
  fair: false,
});
const fairedBoundaryFrame = clayCore.buildClayCubeBoundarySkinFrame({
  basePositions: cornerParticles,
  positions: nearCornerOracle.positions,
  config: cornerConfig,
  fair: true,
});

assert.equal(fairedBoundaryFrame.fairingPolicy, 'contacted-boundary-skin-curvature-fairing-v0');
assert.equal(fairedBoundaryFrame.cullingPolicy, 'boundary-skin-folded-triangle-cull-v0');
assert.equal(fairedBoundaryFrame.vertexCount, rawBoundaryFrame.vertexCount, 'fairing must preserve boundary-skin topology');
assert.equal(fairedBoundaryFrame.triangleCount, rawBoundaryFrame.triangleCount, 'fairing must preserve boundary-skin triangle count');
assert.equal(fairedBoundaryFrame.culledTriangleCount, 0, 'ordinary near-corner fairing should not cull coherent boundary triangles');
assert.ok(rawBoundaryFrame.maxBoundarySkinRoughness > 0, 'raw corner boundary frame should expose measurable roughness');
assert.ok(
  fairedBoundaryFrame.maxBoundarySkinRoughness <= rawBoundaryFrame.maxBoundarySkinRoughness * 0.72,
  `corner fairing did not materially reduce skin roughness: raw=${rawBoundaryFrame.maxBoundarySkinRoughness} faired=${fairedBoundaryFrame.maxBoundarySkinRoughness}`,
);
assert.ok(
  fairedBoundaryFrame.maxFairingDisplacement <= 0.055,
  `corner fairing moved boundary skin too far from material points: ${fairedBoundaryFrame.maxFairingDisplacement}`,
);

const spikedBoundaryPositions = new Float32Array(nearCornerOracle.positions);
const spikedCornerIndex = (cornerConfig.cubeY - 1) * cornerConfig.cubeZ * cornerConfig.cubeX
  + (cornerConfig.cubeZ - 1) * cornerConfig.cubeX
  + (cornerConfig.cubeX - 1);
const spikedCornerOffset = spikedCornerIndex * 4;
spikedBoundaryPositions[spikedCornerOffset] += 0.42;
spikedBoundaryPositions[spikedCornerOffset + 1] += 0.30;
spikedBoundaryPositions[spikedCornerOffset + 2] += 0.38;
const spikedBoundaryFrame = clayCore.buildClayCubeBoundarySkinFrame({
  basePositions: cornerParticles,
  positions: spikedBoundaryPositions,
  config: cornerConfig,
  fair: true,
});
assert.ok(spikedBoundaryFrame.culledTriangleCount > 0, 'boundary-skin frame failed to cull a synthetic floating gribble spike');
assert.ok(
  spikedBoundaryFrame.triangleCount < rawBoundaryFrame.triangleCount,
  `boundary-skin culling did not reduce rendered triangles: raw=${rawBoundaryFrame.triangleCount} spiked=${spikedBoundaryFrame.triangleCount}`,
);

const localAverageDisplacement = ({ basePositions, positions, center, radius, config: localConfig }) => {
  let displacementSum = 0;
  let particleCount = 0;
  for (let i = 0; i < localConfig.particleCount; i += 1) {
    const offset = i * 4;
    const seedDistance = Math.hypot(
      basePositions[offset] - center[0],
      basePositions[offset + 1] - center[1],
      basePositions[offset + 2] - center[2],
    );
    if (seedDistance > radius) continue;
    displacementSum += Math.hypot(
      positions[offset] - basePositions[offset],
      positions[offset + 1] - basePositions[offset + 1],
      positions[offset + 2] - basePositions[offset + 2],
    );
    particleCount += 1;
  }
  return displacementSum / Math.max(1, particleCount);
};

const plasticConfig = normalizeClayCubeConfig('10x10x10');
const plasticParticles = seedClayCubeMaterialPoints(plasticConfig);
const plasticBrush = normalizeClayCubePointerCollider({
  id: 'plastic-front-scribble-pointer',
  center: [0.08, 0.34, 0.34],
  rawCenter: [0.08, 0.34, 0.34],
  surfaceNormal: [0, 0, -1],
  radius: 0.22,
  strength: 1.0,
});
const distantBrush = normalizeClayCubePointerCollider({
  id: 'distant-pointer-for-no-popback',
  center: [-0.30, 0.34, -0.34],
  rawCenter: [-0.30, 0.34, -0.34],
  surfaceNormal: [0, 0, 1],
  radius: 0.18,
  strength: 0.70,
});

let plasticState = plasticParticles;
let firstScribbleAverage = 0;
let sixthScribbleAverage = 0;
for (let step = 0; step < 6; step += 1) {
  plasticState = runClayCubeFirstLoopOracle({
    basePositions: plasticParticles,
    previousPositions: plasticState,
    config: plasticConfig,
    colliders: [plasticBrush],
  }).positions;
  const average = localAverageDisplacement({
    basePositions: plasticParticles,
    positions: plasticState,
    center: plasticBrush.center,
    radius: plasticBrush.radius,
    config: plasticConfig,
  });
  if (step === 0) firstScribbleAverage = average;
  if (step === 5) sixthScribbleAverage = average;
}

assert.ok(
  sixthScribbleAverage > firstScribbleAverage * 2.4,
  `repeated cube brushing should accumulate plastic deformation instead of plateauing immediately: first=${firstScribbleAverage} sixth=${sixthScribbleAverage}`,
);

const dentedAverage = sixthScribbleAverage;
let idlePlasticState = plasticState;
for (let step = 0; step < 8; step += 1) {
  idlePlasticState = runClayCubeFirstLoopOracle({
    basePositions: plasticParticles,
    previousPositions: idlePlasticState,
    config: plasticConfig,
    colliders: [],
  }).positions;
}
const idleRetainedAverage = localAverageDisplacement({
  basePositions: plasticParticles,
  positions: idlePlasticState,
  center: plasticBrush.center,
  radius: plasticBrush.radius,
  config: plasticConfig,
});
assert.ok(
  idleRetainedAverage >= dentedAverage * 0.98,
  `plastic cube dent popped back during idle steps: dented=${dentedAverage} idle=${idleRetainedAverage}`,
);

let elsewherePlasticState = plasticState;
for (let step = 0; step < 8; step += 1) {
  elsewherePlasticState = runClayCubeFirstLoopOracle({
    basePositions: plasticParticles,
    previousPositions: elsewherePlasticState,
    config: plasticConfig,
    colliders: [distantBrush],
  }).positions;
}
const elsewhereRetainedAverage = localAverageDisplacement({
  basePositions: plasticParticles,
  positions: elsewherePlasticState,
  center: plasticBrush.center,
  radius: plasticBrush.radius,
  config: plasticConfig,
});
assert.ok(
  elsewhereRetainedAverage >= dentedAverage * 0.98,
  `plastic cube dent popped back while brushing elsewhere: dented=${dentedAverage} elsewhere=${elsewhereRetainedAverage}`,
);

assert.equal(
  typeof measureClayCubeVolumeProxy,
  'function',
  'cube route needs an explicit volume proxy for preserve-demo reporting',
);

const volumeConfig = normalizeClayCubeConfig('10x10x10');
const volumeParticles = seedClayCubeMaterialPoints(volumeConfig);
const volumeBrush = normalizeClayCubePointerCollider({
  id: 'preserve-demo-front-face-pointer',
  center: [0.08, 0.34, 0.34],
  rawCenter: [0.08, 0.34, 0.34],
  surfaceNormal: [0, 0, -1],
  radius: 0.22,
  strength: 1.20,
});
const seedVolumeProxy = measureClayCubeVolumeProxy({
  basePositions: volumeParticles,
  positions: volumeParticles,
  config: volumeConfig,
});
assert.ok(seedVolumeProxy.volume > 0.35, 'cube seed volume proxy is too small to be useful');

let ordinaryVolumeState = volumeParticles;
let preserveVolumeState = volumeParticles;
let ordinaryVolumeOracle = null;
let preserveVolumeOracle = null;
for (let step = 0; step < 6; step += 1) {
  ordinaryVolumeOracle = runClayCubeFirstLoopOracle({
    basePositions: volumeParticles,
    previousPositions: ordinaryVolumeState,
    config: volumeConfig,
    colliders: [volumeBrush],
  });
  ordinaryVolumeState = ordinaryVolumeOracle.positions;
  preserveVolumeOracle = runClayCubeFirstLoopOracle({
    basePositions: volumeParticles,
    previousPositions: preserveVolumeState,
    config: volumeConfig,
    colliders: [volumeBrush],
    volumePreservation: 'preserve_demo',
  });
  preserveVolumeState = preserveVolumeOracle.positions;
}

assert.equal(ordinaryVolumeOracle.volumePreservationMode, 'disabled', 'ordinary cube brush should not silently preserve volume');
assert.equal(preserveVolumeOracle.volumePreservationMode, 'preserve_demo', 'preserve-demo cube brush did not report effective mode');
assert.equal(
  preserveVolumeOracle.volumePreservationPolicy,
  'local-boundary-pressure-compensation-not-incompressible-mpm-v0',
  'preserve-demo cube brush did not report the honest policy identity',
);
assert.ok(Number.isFinite(ordinaryVolumeOracle.volumeRatio), 'ordinary cube brush did not report volume ratio');
assert.ok(Number.isFinite(preserveVolumeOracle.volumeRatio), 'preserve-demo cube brush did not report volume ratio');
assert.ok(
  preserveVolumeOracle.volumeRatio >= ordinaryVolumeOracle.volumeRatio + 0.012,
  `preserve-demo did not retain materially more volume: ordinary=${ordinaryVolumeOracle.volumeRatio} preserve=${preserveVolumeOracle.volumeRatio}`,
);
assert.ok(
  preserveVolumeOracle.volumeRatio >= 0.985,
  `preserve-demo volume loss is too large for hand-demo fake conservation: ${preserveVolumeOracle.volumeRatio}`,
);
assert.ok(
  preserveVolumeOracle.maxDisplacement > ordinaryVolumeOracle.maxDisplacement * 0.70,
  `preserve-demo erased the visible clay deformation instead of compensating around it: ordinary=${ordinaryVolumeOracle.maxDisplacement} preserve=${preserveVolumeOracle.maxDisplacement}`,
);
