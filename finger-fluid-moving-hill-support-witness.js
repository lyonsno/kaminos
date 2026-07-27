import {
  KAMINOS_FINGER_FLUID_FIXED_STEP_SECONDS,
  KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_CONTACT_ROUTE,
  createFingerFluidMovingHillSupportContactProvider,
  createWebGPUFingerFluidSolver,
} from './finger-fluid-webgpu-core.js';

const WITNESS_SCHEMA = 'kaminos.finger-fluid.moving-hill-support-browser-witness.v0';
const SYNTHETIC_SOURCE_ID = 'kaminos-moving-hill-canonical-frame-witness';
const TERRAIN_ID = 'synthetic-moving-hill-support-49x49';
const GRID_WIDTH = 49;
const GRID_HEIGHT = 49;
const GRID_SPACING = 6.8 / (GRID_WIDTH - 1);
const GRID_ORIGIN = [-3.4, 0, -3.4];
const SUPPORT_UPDATE_INTERVAL = 4;
const query = new URLSearchParams(window.location.search);
const composedRevision = query.get('composed_revision');
const canvas = document.getElementById('moving-hill-support');
const status = document.getElementById('status');

let solver = null;
let provider = null;
let frameCount = 0;
let supportWriteCount = 0;
let terrainEpoch = 1;
let startTime = performance.now();
let failure = null;

window.kaminosMovingHillSupportWitnessState = {
  schema: WITNESS_SCHEMA,
  status: 'initializing',
  requestedRoute: KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_CONTACT_ROUTE,
  effectiveRoute: null,
  fallbackRoute: null,
  backend: null,
  evidenceScope: 'synthetic_canonical_frame_contract_witness_not_lerms_source_authority',
  primaryOutputWritten: false,
  blank: true,
  partial: true,
};

function publishState() {
  const debug = solver?.getDebugState?.() || null;
  const support = debug?.supportContact || null;
  const effectiveRoute = support?.route || null;
  const fallbackRoute = support?.fallbackRoute ?? null;
  const routeExact = (
    effectiveRoute === KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_CONTACT_ROUTE
    && fallbackRoute === null
  );
  window.kaminosMovingHillSupportWitnessState = {
    schema: WITNESS_SCHEMA,
    status: failure ? 'error' : frameCount > 0 && routeExact ? 'running' : 'initializing',
    requestedRoute: KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_CONTACT_ROUTE,
    effectiveRoute,
    fallbackRoute,
    backend: debug?.solver_backend || null,
    evidenceScope: 'synthetic_canonical_frame_contract_witness_not_lerms_source_authority',
    sourceAuthority: 'synthetic_fixture_only',
    composedRevision,
    frameCount,
    supportWriteCount,
    terrainEpoch: support?.terrainEpoch ?? null,
    supportEpoch: support?.supportEpoch ?? null,
    remapEpoch: support?.remapEpoch ?? null,
    deviceMatchesSolver: support?.deviceMatchesSolver ?? false,
    hostReadbackVisibility: support?.hostReadbackVisibility ?? null,
    primaryOutputWritten: frameCount > 0 && routeExact,
    blank: frameCount === 0,
    partial: frameCount === 0 || !routeExact,
    failure,
  };
  status.textContent = [
    'KAMINOS MOVING HILL SUPPORT',
    `${window.kaminosMovingHillSupportWitnessState.backend || 'pending'} · frame ${frameCount}`,
    `${effectiveRoute || 'route pending'}`,
    `terrain ${support?.terrainEpoch ?? '-'} · support ${support?.supportEpoch ?? '-'} · remap ${support?.remapEpoch ?? '-'}`,
    `same device ${support?.deviceMatchesSolver === true ? 'yes' : 'no'} · fallback ${fallbackRoute ?? 'none'}`,
    'synthetic canonical frame witness · not LERMS source authority',
    failure ? `FAILED: ${failure.message}` : 'live moving support · GPU contact · no host readback',
  ].join('\n');
  return window.kaminosMovingHillSupportWitnessState;
}

function terrainHeightAndDerivatives(x, z, timeSeconds) {
  const phaseA = x * 0.68 + timeSeconds * 1.1;
  const phaseB = z * 0.55 - timeSeconds * 0.8;
  const phaseC = (x + z) * 0.42 - timeSeconds * 0.7;
  const sinA = Math.sin(phaseA);
  const cosA = Math.cos(phaseA);
  const sinB = Math.sin(phaseB);
  const cosB = Math.cos(phaseB);
  const sinC = Math.sin(phaseC);
  const cosC = Math.cos(phaseC);
  return {
    height: -0.82 + 0.18 * sinA * cosB + 0.13 * sinC,
    dx: 0.18 * 0.68 * cosA * cosB + 0.13 * 0.42 * cosC,
    dz: -0.18 * 0.55 * sinA * sinB + 0.13 * 0.42 * cosC,
    dyDt: 0.18 * (1.1 * cosA * cosB + 0.8 * sinA * sinB) - 0.13 * 0.7 * cosC,
  };
}

function createTerrainFrame(timeSeconds, currentEpoch, priorEpoch) {
  const sampleCount = GRID_WIDTH * GRID_HEIGHT;
  const worldPosition = new Float64Array(sampleCount * 3);
  const bedHeight = new Float64Array(sampleCount);
  const jacobian = new Float64Array(sampleCount);
  const gradient = new Float64Array(sampleCount * 2);
  const tangentU = new Float64Array(sampleCount * 3);
  const tangentV = new Float64Array(sampleCount * 3);
  const normal = new Float64Array(sampleCount * 3);
  const supportVelocity = new Float64Array(sampleCount * 3);
  const valid = new Uint8Array(sampleCount);
  for (let row = 0; row < GRID_HEIGHT; row += 1) {
    for (let column = 0; column < GRID_WIDTH; column += 1) {
      const index = row * GRID_WIDTH + column;
      const vectorOffset = index * 3;
      const gradientOffset = index * 2;
      const x = GRID_ORIGIN[0] + column * GRID_SPACING;
      const z = GRID_ORIGIN[2] + row * GRID_SPACING;
      const sample = terrainHeightAndDerivatives(x, z, timeSeconds);
      const normalLength = Math.hypot(sample.dx, 1, sample.dz);
      worldPosition.set([x, sample.height, z], vectorOffset);
      bedHeight[index] = sample.height;
      jacobian[index] = Math.hypot(1, sample.dx, sample.dz);
      gradient.set([sample.dx, sample.dz], gradientOffset);
      tangentU.set([1, sample.dx, 0], vectorOffset);
      tangentV.set([0, sample.dz, 1], vectorOffset);
      normal.set([-sample.dx / normalLength, 1 / normalLength, -sample.dz / normalLength], vectorOffset);
      supportVelocity.set([0, sample.dyDt, 0], vectorOffset);
      valid[index] = 1;
    }
  }
  return {
    schema: 'kaminos.fluid.terrain-fluid-frame.v1',
    route: 'lerms/hill-of-hills/terrain-fluid-frame-v1',
    producer: {
      id: 'kaminos-moving-hill-support-witness',
      revision: composedRevision,
    },
    source: {
      requested: SYNTHETIC_SOURCE_ID,
      effective: SYNTHETIC_SOURCE_ID,
    },
    worldMetersPerUnit: 1,
    gravity: [0, -9.81, 0],
    terrainId: TERRAIN_ID,
    supportClass: 'heightfield',
    transformId: 'synthetic-moving-hill-world-frame',
    priorEpoch,
    currentEpoch,
    motionClass: 'deforming_heightfield',
    shockId: null,
    grid: {
      width: GRID_WIDTH,
      height: GRID_HEIGHT,
      spacing: [GRID_SPACING, GRID_SPACING],
      origin: [...GRID_ORIGIN],
    },
    fields: {
      worldPosition,
      bedHeight,
      jacobian,
      gradient,
      tangentU,
      tangentV,
      normal,
      supportVelocity,
      valid,
    },
    dirtyRegions: [{ x: 0, y: 0, width: GRID_WIDTH, height: GRID_HEIGHT }],
    complete: true,
    expectedSampleCount: sampleCount,
    actualSampleCount: sampleCount,
  };
}

function providerIdentity(frame, supportEpoch) {
  return {
    sourceId: SYNTHETIC_SOURCE_ID,
    terrainId: TERRAIN_ID,
    terrainEpoch: frame.currentEpoch,
    supportEpoch,
    remapEpoch: 1,
    stale: false,
    fallbackRoute: null,
  };
}

function resizeCanvas() {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.floor(canvas.clientWidth * pixelRatio));
  canvas.height = Math.max(1, Math.floor(canvas.clientHeight * pixelRatio));
}

async function initialize() {
  if (!composedRevision || !/^[0-9a-f]{40}$/.test(composedRevision)) {
    throw new Error('composed_revision must be an exact 40-character lowercase Git revision');
  }
  resizeCanvas();
  solver = await createWebGPUFingerFluidSolver({
    canvas,
    particleCount: 24576,
    densityIterations: 3,
    truthScene: 'multi_regime_playground',
    colorMode: 'phase',
    rendererMode: 'sphere_debug',
    supportContactRoute: KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_CONTACT_ROUTE,
    composedRevision,
    movingHillSupportContactProviderFactory({ device }) {
      const frame = createTerrainFrame(0, terrainEpoch, 0);
      provider = createFingerFluidMovingHillSupportContactProvider({
        device,
        terrainFrame: frame,
        identity: providerIdentity(frame, terrainEpoch),
      });
      supportWriteCount = 1;
      return provider;
    },
  });
  if (!solver.available) {
    throw new Error(`WebGPU solver unavailable: ${solver.reason || 'unknown reason'}`);
  }
  const support = solver.getDebugState().supportContact;
  if (
    support?.route !== KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_CONTACT_ROUTE
    || support.fallbackRoute !== null
    || support.deviceMatchesSolver !== true
    || support.hostReadbackVisibility !== false
  ) {
    throw new Error(`moving-Hill route identity mismatch: ${JSON.stringify(support)}`);
  }
  requestAnimationFrame(animate);
}

function animate(now) {
  try {
    if (frameCount > 0 && frameCount % SUPPORT_UPDATE_INTERVAL === 0) {
      const priorEpoch = terrainEpoch;
      terrainEpoch += 1;
      const timeSeconds = Math.max(0, (now - startTime) / 1000);
      const frame = createTerrainFrame(timeSeconds, terrainEpoch, priorEpoch);
      provider.update({
        terrainFrame: frame,
        identity: providerIdentity(frame, terrainEpoch),
      });
      supportWriteCount += 1;
    }
    solver.step(KAMINOS_FINGER_FLUID_FIXED_STEP_SECONDS);
    solver.render({
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      yaw: -0.58,
      pitch: 0.42,
      distance: 6.1,
      target: [0, -0.18, 0],
      colorMode: 'phase',
      rendererMode: 'sphere_debug',
    });
    frameCount += 1;
    publishState();
    requestAnimationFrame(animate);
  } catch (error) {
    failure = {
      message: error?.message || String(error),
      stack: error?.stack || null,
      phase: 'animation_or_support_epoch_update',
    };
    publishState();
  }
}

window.addEventListener('resize', resizeCanvas);
window.addEventListener('beforeunload', () => solver?.destroy?.(), { once: true });

initialize().catch(error => {
  failure = {
    message: error?.message || String(error),
    stack: error?.stack || null,
    phase: 'initialization_before_primary_output',
  };
  publishState();
});
