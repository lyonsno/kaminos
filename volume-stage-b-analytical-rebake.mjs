import { createHash } from 'node:crypto';

export const MANDATORY_STAGE_B_CONTROLS = Object.freeze([
  'volume_reaction_boundary_fire_tip',
  'volume_reaction_boundary_topology',
  'volume_reaction_boundary_fire_erosion',
  'volume_reaction_boundary_cut',
  'volume_reaction_boundary_softness',
  'volume_reaction_boundary_core_reject',
  'volume_reaction_boundary_support_thermal',
  'volume_reaction_boundary_support_reaction',
  'volume_reaction_boundary_support_front',
  'volume_reaction_boundary_support_interface',
  'volume_reaction_boundary_fire_ridge',
  'volume_reaction_boundary_fire_ridge_cut',
  'volume_reaction_boundary_curl',
  'volume_reaction_boundary_divergence',
]);

const CONTROL_SPECS = Object.freeze({
  volume_reaction_boundary_fire_tip: [0, 2, 2],
  volume_reaction_boundary_topology: [0, 2.5, 0.96],
  volume_reaction_boundary_fire_erosion: [0, 1, 0.3],
  volume_reaction_boundary_cut: [0, 0.55, 0.365],
  volume_reaction_boundary_softness: [0.005, 0.45, 0.135],
  volume_reaction_boundary_core_reject: [0, 1, 1],
  volume_reaction_boundary_support_thermal: [0, 2, 0.98],
  volume_reaction_boundary_support_reaction: [0, 2, 1],
  volume_reaction_boundary_support_front: [0, 2, 0.66],
  volume_reaction_boundary_support_interface: [0, 2, 0.78],
  volume_reaction_boundary_fire_ridge: [0, 2, 1.52],
  volume_reaction_boundary_fire_ridge_cut: [0, 0.55, 0.145],
  volume_reaction_boundary_curl: [0, 2, 1.18],
  volume_reaction_boundary_divergence: [0, 1, 0.22],
});

const OPTICAL_LAYERS = 16;
const TAP_OFFSETS = Object.freeze([-1, -0.5, 0, 0.5, 1]);
const TAP_WEIGHTS = Object.freeze([0.075, 0.225, 0.4, 0.225, 0.075]);
const HEX_64 = /^[0-9a-f]{64}$/;

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, Number(value)));
}

function smoothstep(low, high, value) {
  const t = clamp((value - low) / Math.max(high - low, 1e-12), 0, 1);
  return t * t * (3 - 2 * t);
}

function mix(a, b, weight) {
  return a * (1 - weight) + b * weight;
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function hashBytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

function failMissing(field) {
  throw new Error(`stage-b-rebake-missing-input:${field}`);
}

export function defaultStageBControls() {
  return Object.fromEntries(MANDATORY_STAGE_B_CONTROLS.map(control => [control, CONTROL_SPECS[control][2]]));
}

export function normalizeStageBControls(requested = {}) {
  const effective = {};
  for (const control of MANDATORY_STAGE_B_CONTROLS) {
    const [low, high, fallback] = CONTROL_SPECS[control];
    const value = requested[control] ?? fallback;
    if (!Number.isFinite(Number(value))) throw new Error(`stage-b-rebake-invalid-control:${control}`);
    effective[control] = clamp(value, low, high);
  }
  return effective;
}

function validateState(state) {
  if (!state || typeof state !== 'object') failMissing('state');
  if (!Number.isInteger(state.grid) || state.grid < 3) failMissing('grid');
  const cellCount = state.grid ** 3;
  if (!(state.fluid instanceof Float32Array) || state.fluid.length !== cellCount * 16) failMissing('fluid');
  if (!(state.front instanceof Float32Array) || state.front.length !== cellCount) failMissing('front');
  if (!state.source?.stateId) failMissing('stateId');
  if (!HEX_64.test(state.source?.fluidSha256 || '')) failMissing('fluidSha256');
  if (!HEX_64.test(state.source?.frontSha256 || '')) failMissing('frontSha256');
  if (!state.source?.cameraIdentity) failMissing('cameraIdentity');
  return cellCount;
}

function fireColor(temperature) {
  const ember = [0.70, 0.10, 0.018];
  const orange = [1, 0.38, 0.055];
  const gold = [1, 0.74, 0.20];
  const pale = [1, 0.82, 0.34];
  const aWeight = smoothstep(0.08, 0.44, temperature);
  const bWeight = smoothstep(0.86, 1.55, temperature);
  const finalWeight = smoothstep(0.34, 1.08, temperature);
  return ember.map((value, index) => mix(mix(value, orange[index], aWeight), mix(gold[index], pale[index], bWeight), finalWeight));
}

function cellIndex(x, y, z, grid) {
  const cx = Math.max(0, Math.min(grid - 1, x));
  const cy = Math.max(0, Math.min(grid - 1, y));
  const cz = Math.max(0, Math.min(grid - 1, z));
  return cx + cy * grid + cz * grid * grid;
}

function supportAt(fluid, front, cell, controls) {
  const offset = cell * 16;
  const vx = fluid[offset];
  const vy = fluid[offset + 1];
  const vz = fluid[offset + 2];
  const smoke = fluid[offset + 4];
  const heat = fluid[offset + 5];
  const fuel = fluid[offset + 6];
  const detail = fluid[offset + 7];
  const flame = fluid[offset + 8];
  const ember = fluid[offset + 9];
  const flameDetail = fluid[offset + 10];
  const combustionFront = fluid[offset + 11];
  const microSmoke = fluid[offset + 12];
  const interfaceShred = fluid[offset + 13];
  const fireLick = fluid[offset + 14];
  const emberFleck = fluid[offset + 15];
  const velocity = Math.hypot(vx, vy, vz);
  const rawTemp = clamp(
    flame * 1.22 + ember * 0.46 + flameDetail * 0.40 + fireLick * 1.18
      + emberFleck * 0.48 + heat * 0.20 + velocity * 0.30,
    0,
    2.4,
  );
  const thermal = smoothstep(0.018, 0.62, rawTemp + flame * 0.16 + heat * 0.24 + ember * 0.12);
  const reaction = smoothstep(0.004, 0.30, flameDetail * 0.72 + fireLick * 0.44 + combustionFront * 0.34 + fuel * heat * 0.28);
  const frontSupport = smoothstep(0.001, 0.088, front[cell] * 1.08 + combustionFront * 0.54 + fireLick * 0.12);
  const interfaceSupport = smoothstep(0.004, 0.24, interfaceShred * 0.58 + microSmoke * 0.18 + smoke * 0.08 + detail * 0.06);
  const weights = [
    controls.volume_reaction_boundary_support_thermal,
    controls.volume_reaction_boundary_support_reaction,
    controls.volume_reaction_boundary_support_front,
    controls.volume_reaction_boundary_support_interface,
  ];
  const weightSum = Math.max(0.001, weights.reduce((sum, weight) => sum + weight, 0));
  return clamp((thermal * weights[0] + reaction * weights[1] + frontSupport * weights[2] + interfaceSupport * weights[3]) / weightSum, 0, 1.35);
}

function velocityDifferentials(fluid, x, y, z, grid) {
  const slot = (cx, cy, cz, channel) => fluid[cellIndex(cx, cy, cz, grid) * 16 + channel];
  const vx0x = slot(x - 1, y, z, 0);
  const vx1x = slot(x + 1, y, z, 0);
  const vy0y = slot(x, y - 1, z, 1);
  const vy1y = slot(x, y + 1, z, 1);
  const vz0z = slot(x, y, z - 1, 2);
  const vz1z = slot(x, y, z + 1, 2);
  const curlX = ((slot(x, y + 1, z, 2) - slot(x, y - 1, z, 2)) - (slot(x, y, z + 1, 1) - slot(x, y, z - 1, 1))) * 0.5;
  const curlY = ((slot(x, y, z + 1, 0) - slot(x, y, z - 1, 0)) - (slot(x + 1, y, z, 2) - slot(x - 1, y, z, 2))) * 0.5;
  const curlZ = ((slot(x + 1, y, z, 1) - slot(x - 1, y, z, 1)) - (slot(x, y + 1, z, 0) - slot(x, y - 1, z, 0))) * 0.5;
  return {
    curlX,
    curlY,
    curlZ,
    curl: Math.hypot(curlX, curlY, curlZ),
    divergence: ((vx1x - vx0x) + (vy1y - vy0y) + (vz1z - vz0z)) * 0.5,
  };
}

function fixedCameraProject(x, y, z, grid, width, height) {
  const world = [((x + 0.5) / grid) * 2 - 1, ((y + 0.5) / grid) * 2 - 1, ((z + 0.5) / grid) * 2 - 1];
  const position = [0, 0.6, 3];
  const forwardLength = Math.hypot(0, -0.6, -3);
  const forward = [0, -0.6 / forwardLength, -3 / forwardLength];
  const right = [1, 0, 0];
  const up = [0, -forward[2], forward[1]];
  const delta = world.map((value, index) => value - position[index]);
  const cameraX = delta[0];
  const cameraY = delta[0] * up[0] + delta[1] * up[1] + delta[2] * up[2];
  const cameraDepth = delta[0] * forward[0] + delta[1] * forward[1] + delta[2] * forward[2];
  if (cameraDepth <= 0.01) return null;
  const tanHalfFov = Math.tan((40 * Math.PI / 180) * 0.5);
  const ndcX = cameraX / (cameraDepth * tanHalfFov * (width / height));
  const ndcY = cameraY / (cameraDepth * tanHalfFov);
  if (ndcX < -1.1 || ndcX > 1.1 || ndcY < -1.1 || ndcY > 1.1) return null;
  return {
    pixelX: (ndcX * 0.5 + 0.5) * width,
    pixelY: (1 - (ndcY * 0.5 + 0.5)) * height,
    depth: clamp((cameraDepth - 1.8) / 2.5, 0, 0.999999),
    cameraDepth,
  };
}

function flowFrame(vx, vy, vz, curlX, curlY, curlZ, gradientX, gradientY, gradientZ, curlActivity) {
  const gradientLength = Math.hypot(gradientX, gradientY, gradientZ);
  const normal = gradientLength > 1e-6
    ? [gradientX / gradientLength, gradientY / gradientLength, gradientZ / gradientLength]
    : [0, 1, 0];
  const velocityDot = vx * normal[0] + vy * normal[1] + vz * normal[2];
  let tangent = [vx - normal[0] * velocityDot, vy - normal[1] * velocityDot, vz - normal[2] * velocityDot];
  let tangentLength = Math.hypot(...tangent);
  if (tangentLength <= 1e-6) {
    const curlDot = curlX * normal[0] + curlY * normal[1] + curlZ * normal[2];
    tangent = [curlX - normal[0] * curlDot, curlY - normal[1] * curlDot, curlZ - normal[2] * curlDot];
    tangentLength = Math.hypot(...tangent);
  }
  if (tangentLength <= 1e-6) {
    const axis = Math.abs(normal[0]) > 0.75 ? [0, 0, 1] : [1, 0, 0];
    tangent = [
      normal[1] * axis[2] - normal[2] * axis[1],
      normal[2] * axis[0] - normal[0] * axis[2],
      normal[0] * axis[1] - normal[1] * axis[0],
    ];
    tangentLength = Math.hypot(...tangent);
  }
  tangent = tangent.map(value => value / Math.max(tangentLength, 1e-6));
  const radiusWorld = 0.03 * (1 + curlActivity * 0.5);
  const variance = 0.5 * radiusWorld * radiusWorld;
  return {
    normal,
    tangent,
    radiusWorld,
    covariance: [
      variance * tangent[0] * tangent[0],
      variance * tangent[0] * tangent[1],
      variance * tangent[0] * tangent[2],
      variance * tangent[1] * tangent[1],
      variance * tangent[1] * tangent[2],
      variance * tangent[2] * tangent[2],
    ],
  };
}

function deposit(layers, width, height, depthBin, centerX, centerY, tangentX, tangentY, radius, emission, extinction) {
  const tangentLength = Math.max(Math.hypot(tangentX, tangentY), 1e-6);
  const unitX = tangentX / tangentLength;
  const unitY = tangentY / tangentLength;
  for (let tap = 0; tap < TAP_OFFSETS.length; tap += 1) {
    const sampleX = centerX + unitX * radius * TAP_OFFSETS[tap];
    const sampleY = centerY + unitY * radius * TAP_OFFSETS[tap];
    const floorX = Math.floor(sampleX);
    const floorY = Math.floor(sampleY);
    const fractionX = sampleX - floorX;
    const fractionY = sampleY - floorY;
    const neighbors = [
      [0, 0, (1 - fractionX) * (1 - fractionY)],
      [1, 0, fractionX * (1 - fractionY)],
      [0, 1, (1 - fractionX) * fractionY],
      [1, 1, fractionX * fractionY],
    ];
    for (const [dx, dy, bilinearWeight] of neighbors) {
      const px = floorX + dx;
      const py = floorY + dy;
      if (px < 0 || px >= width || py < 0 || py >= height) continue;
      const weight = TAP_WEIGHTS[tap] * bilinearWeight;
      const target = ((depthBin * height + py) * width + px) * 4;
      layers[target] += emission[0] * weight;
      layers[target + 1] += emission[1] * weight;
      layers[target + 2] += emission[2] * weight;
      layers[target + 3] += extinction * weight;
    }
  }
}

function resolveOpticalLayers(layers, width, height) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let bin = OPTICAL_LAYERS - 1; bin >= 0; bin -= 1) {
        const source = ((bin * height + py) * width + px) * 4;
        const opticalDepth = Math.max(0, layers[source + 3]);
        const alpha = 1 - Math.exp(-opticalDepth);
        if (opticalDepth > 1e-6) {
          red = (layers[source] / opticalDepth) * alpha + red * (1 - alpha);
          green = (layers[source + 1] / opticalDepth) * alpha + green * (1 - alpha);
          blue = (layers[source + 2] / opticalDepth) * alpha + blue * (1 - alpha);
        }
      }
      const ndcX = ((px + 0.5) / width) * 2 - 1;
      const ndcY = ((py + 0.5) / height) * 2 - 1;
      const vignette = 1 - smoothstep(0.28, 1.48, Math.hypot(ndcX, ndcY));
      const target = (py * width + px) * 4;
      for (const [channel, linear] of [[0, red], [1, green], [2, blue]]) {
        const exposed = 1 - Math.exp(-Math.max(0, linear) * 0.96);
        rgba[target + channel] = Math.round(clamp(Math.pow(Math.max(0, exposed * (0.80 + 0.18 * vignette)), 0.84), 0, 1) * 255);
      }
      rgba[target + 3] = 255;
    }
  }
  return rgba;
}

export async function rebakeAnalyticalStageB({ state, controls = {}, width = 320, height = 320 } = {}) {
  const started = performance.now();
  const cellCount = validateState(state);
  if (!Number.isInteger(width) || width < 16 || width > 1024) throw new Error('stage-b-rebake-invalid-output:width');
  if (!Number.isInteger(height) || height < 16 || height > 1024) throw new Error('stage-b-rebake-invalid-output:height');
  const requestedControls = Object.fromEntries(MANDATORY_STAGE_B_CONTROLS.map(control => [control, controls[control] ?? CONTROL_SPECS[control][2]]));
  const effectiveControls = normalizeStageBControls(requestedControls);
  const { grid, fluid, front } = state;
  const support = new Float32Array(cellCount);
  for (let cell = 0; cell < cellCount; cell += 1) support[cell] = supportAt(fluid, front, cell, effectiveControls);

  const layers = new Float32Array(width * height * OPTICAL_LAYERS * 4);
  let candidateCount = 0;
  let coefficientSum = 0;
  let weightedCoefficientSum = 0;
  const covarianceSum = new Float64Array(6);
  const weightedCovarianceSum = new Float64Array(6);
  let candidateWeightSum = 0;
  let weightedCandidateSum = 0;
  let depositCount = 0;
  const ridgeGain = effectiveControls.volume_reaction_boundary_fire_ridge;
  const ridgeCut = effectiveControls.volume_reaction_boundary_fire_ridge_cut;
  const cut = effectiveControls.volume_reaction_boundary_cut;
  const softness = effectiveControls.volume_reaction_boundary_softness;
  const coreReject = effectiveControls.volume_reaction_boundary_core_reject;
  const topologyGain = effectiveControls.volume_reaction_boundary_topology;
  const curlGain = effectiveControls.volume_reaction_boundary_curl;
  const divergenceGain = effectiveControls.volume_reaction_boundary_divergence;
  const tipBreakup = effectiveControls.volume_reaction_boundary_fire_tip;
  const erosionGain = effectiveControls.volume_reaction_boundary_fire_erosion;

  for (let z = 0; z < grid; z += 1) {
    for (let y = 0; y < grid; y += 1) {
      for (let x = 0; x < grid; x += 1) {
        const cell = cellIndex(x, y, z, grid);
        const offset = cell * 16;
        const center = support[cell];
        const px = support[cellIndex(x + 1, y, z, grid)];
        const nx = support[cellIndex(x - 1, y, z, grid)];
        const py = support[cellIndex(x, y + 1, z, grid)];
        const ny = support[cellIndex(x, y - 1, z, grid)];
        const pz = support[cellIndex(x, y, z + 1, grid)];
        const nz = support[cellIndex(x, y, z - 1, grid)];
        const gradient = Math.hypot(px - nx, py - ny, pz - nz) * 0.5;
        const laplacian = Math.abs(px + nx + py + ny + pz + nz - 6 * center);
        const ridge = smoothstep(ridgeCut, ridgeCut + 0.14, laplacian * ridgeGain);
        const gradientGate = smoothstep(cut, cut + softness, gradient * 1.05);
        const velocity = velocityDifferentials(fluid, x, y, z, grid);
        const curlActivity = smoothstep(0.006, 0.16, velocity.curl);
        const divergenceActivity = smoothstep(0.010, 0.18, Math.abs(velocity.divergence));
        const smoke = fluid[offset + 4];
        const heat = fluid[offset + 5];
        const fuel = fluid[offset + 6];
        const detail = fluid[offset + 7];
        const flame = fluid[offset + 8];
        const ember = fluid[offset + 9];
        const flameDetail = fluid[offset + 10];
        const combustionFront = fluid[offset + 11];
        const microSmoke = fluid[offset + 12];
        const interfaceShred = fluid[offset + 13];
        const fireLick = fluid[offset + 14];
        const emberFleck = fluid[offset + 15];
        const speed = Math.hypot(fluid[offset], fluid[offset + 1], fluid[offset + 2]);
        const rawTemp = clamp(flame * 1.22 + ember * 0.46 + flameDetail * 0.40 + fireLick * 1.18 + emberFleck * 0.48 + heat * 0.20 + speed * 0.30, 0, 2.4);
        const rawExtinction = clamp((smoke * 0.74 + microSmoke * 0.42 + interfaceShred * 0.34 + detail * 0.12) * 0.80, 0, 2.3);
        const reactionSupport = smoothstep(0.004, 0.30, flameDetail * 0.72 + fireLick * 0.44 + combustionFront * 0.34 + fuel * heat * 0.28);
        const frontSupport = smoothstep(0.001, 0.088, front[cell] * 1.08 + combustionFront * 0.54 + fireLick * 0.12);
        const edgeSupport = smoothstep(0.004, 0.24, interfaceShred * 0.58 + microSmoke * 0.18 + rawExtinction * 0.08 + velocity.curl * 0.42);
        const divSupport = divergenceActivity * smoothstep(0.010, 0.46, rawTemp + heat * 0.18 + flameDetail * 0.32);
        const coreBody = smoothstep(0.26, 1.18, rawTemp * 0.54 + flameDetail * 0.44 + heat * 0.12 + ember * 0.12)
          * (1 - clamp(frontSupport * 0.54 + edgeSupport * 0.30 + curlActivity * 0.12, 0, 0.86));
        const coreGate = clamp(mix(1, 1 - coreBody, coreReject), 0, 1);
        const supportThinning = gradientGate * (1 - smoothstep(0.62, 1.12, center));
        const upwardTransport = smoothstep(0.006, 0.085, Math.max(0, fluid[offset + 1]) + speed * 0.12);
        const fuelDepletion = smoothstep(0.020, 0.52, heat + flameDetail * 0.46 + combustionFront * 0.28) * (1 - smoothstep(0.018, 0.18, fuel));
        const tipGate = clamp(supportThinning * (0.35 + ridge * 0.65) * (0.30 + upwardTransport * 0.70) * (0.45 + fuelDepletion * 0.55), 0, 1);
        const topology = clamp(1 + topologyGain * (edgeSupport * 0.50 + frontSupport * 0.24) + curlGain * curlActivity + divergenceGain * divSupport, 0, 3.5);
        const erosion = clamp(erosionGain * (curlActivity * 0.36 + edgeSupport * 0.34 + divSupport * 0.18 + tipGate * 0.48), 0, 0.92);
        const boundaryRaw = clamp(center * gradientGate * coreGate * topology, 0, 2);
        const boundaryScalar = clamp(Math.pow(clamp(boundaryRaw * 0.6, 0, 1.8), 3) * 3, 0, 1.65);
        const boundaryCandidate = boundaryScalar * mix(1, clamp(ridge + tipGate * tipBreakup, 0, 1), 0.62) * (1 - erosion);
        if (boundaryCandidate <= 1e-6) continue;
        const projection = fixedCameraProject(x, y, z, grid, width, height);
        if (!projection) continue;
        const frame = flowFrame(
          fluid[offset], fluid[offset + 1], fluid[offset + 2],
          velocity.curlX, velocity.curlY, velocity.curlZ,
          px - nx, py - ny, pz - nz,
          curlActivity,
        );
        const sootSupport = smoothstep(0.012, 0.42, smoke + microSmoke * 0.50 + rawExtinction * 0.32 + detail * 0.16);
        const cleanBurnGate = smoothstep(0.006, 0.34, reactionSupport + frontSupport * 0.38) * (1 - smoothstep(0.20, 0.86, sootSupport * 0.64));
        const sootMaturity = clamp((sootSupport * 0.56 + fuelDepletion * 0.30 + tipGate * 0.30) * 0.64, 0, 1);
        const clean = [0.12 * 0.3 * cleanBurnGate, 0.42 * 0.3 * cleanBurnGate, 1.75 * 0.3 * cleanBurnGate];
        const thermal = fireColor((rawTemp + heat * 0.28 + flameDetail * 0.42 + frontSupport * 0.28) * 0.16);
        const sootThermal = thermal.map((value, index) => mix(value, [1.55, 0.86, 0.18][index], clamp(sootMaturity * 0.44, 0, 1)));
        const color = clean.map((value, index) => mix(value, sootThermal[index], sootMaturity) * 5);
        const extinction = Math.max(1e-5, boundaryCandidate * (0.035 + rawExtinction * 0.08));
        const emission = color.map(value => Math.max(0, value * boundaryCandidate * 0.055));
        const depthBin = Math.floor(projection.depth * OPTICAL_LAYERS);
        const tangentScreenX = frame.tangent[0];
        const tangentScreenY = -(frame.tangent[1] * 0.9805806757 + frame.tangent[2] * -0.1961161351);
        const projectedRadius = frame.radiusWorld * width / (Math.max(projection.cameraDepth, 0.01) * Math.tan(20 * Math.PI / 180) * 2);
        const radius = clamp(projectedRadius * (1 + gradient * 2 + ridge * 0.65), 0.75, 5);
        deposit(layers, width, height, depthBin, projection.pixelX, projection.pixelY, tangentScreenX, tangentScreenY, radius, emission, extinction);
        candidateCount += 1;
        candidateWeightSum += boundaryCandidate;
        weightedCandidateSum += boundaryCandidate * (cell + 1);
        const coefficient = emission[0] + emission[1] + emission[2] + extinction;
        coefficientSum += coefficient;
        weightedCoefficientSum += coefficient * (cell + 1);
        for (let component = 0; component < frame.covariance.length; component += 1) {
          covarianceSum[component] += frame.covariance[component];
          weightedCovarianceSum[component] += frame.covariance[component] * (cell + 1);
        }
        depositCount += 20;
      }
    }
  }

  const depositionIdentity = hashBytes(Buffer.from(layers.buffer, layers.byteOffset, layers.byteLength));
  const pixels = resolveOpticalLayers(layers, width, height);
  const sourceStateIdentity = hashJson({
    stateId: state.source.stateId,
    grid,
    fluidSha256: state.source.fluidSha256,
    frontSha256: state.source.frontSha256,
    cameraIdentity: state.source.cameraIdentity,
  });
  const candidateIdentity = hashJson({ candidateCount, candidateWeightSum, weightedCandidateSum });
  const coefficientIdentity = hashJson({ candidateCount, coefficientSum, weightedCoefficientSum });
  const covarianceIdentity = hashJson({
    candidateCount,
    covarianceSum: Array.from(covarianceSum),
    weightedCovarianceSum: Array.from(weightedCovarianceSum),
  });
  const pixelIdentity = hashBytes(pixels);
  const controlsIdentity = hashJson(effectiveControls);
  const stageBIdentity = hashJson({ sourceStateIdentity, controlsIdentity, candidateIdentity, coefficientIdentity, covarianceIdentity, depositionIdentity, pixelIdentity });
  const receipt = {
    schema: 'kaminos.volume.stage-b-analytical-rebake-receipt.v0',
    status: 'effective',
    requestedControls,
    effectiveControls,
    controlsIdentity,
    sourceStateIdentity,
    source: { ...state.source, grid },
    stageBIdentity,
    candidateIdentity,
    coefficientIdentity,
    covarianceIdentity,
    depositionIdentity,
    pixelIdentity,
    candidateCount,
    coefficientSummary: { coefficientSum, weightedCoefficientSum },
    covarianceSummary: {
      covarianceSum: Array.from(covarianceSum),
      weightedCovarianceSum: Array.from(weightedCovarianceSum),
    },
    geometrySummary: { candidateWeightSum, weightedCandidateSum },
    opticalLayers: OPTICAL_LAYERS,
    depositCount,
    output: { width, height, byteLength: pixels.byteLength },
    controlStatus: MANDATORY_STAGE_B_CONTROLS.map(control => ({ control, status: 'rebake-coupled' })),
    appliedPasses: [
      'source-validation',
      'boundary-support-rebake',
      'candidate-membership-rebuild',
      'coefficient-rebuild',
      'flow-tangent-five-tap-bilinear-deposition',
      'shared-optics-recurrence',
      'raymarch-matched-exponential-power-grade',
    ],
    fallback: null,
    postLoadMutation: 'analytical-rebake-only',
    simulatorAdvanced: false,
    elapsedMs: performance.now() - started,
  };
  return { receipt, pixels };
}
