#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KAMINOS_FLUID_CHANNEL_ORDER } from './smoke-splat-field-hierarchy.mjs';

export const SMOKE_GAUSSIAN_ORACLE_FIT_IDENTITY = 'smoke-gaussian-oracle-static-fit-v0';
const EXPECTED_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const EXPECTED_PROTOTYPE = 'kaminos-volume-prototype-v0';
const EXPECTED_EXPORT_IDENTITY = 'full-grid-fluid-front-boundary-sidecars-v0';
const HELD_REPLAY_SCHEMA = 'kaminos.volume.operator-basin-replay.v0';
const HELD_INITIALIZATION_AUTHORITY = 'offline-high-truth-held-render-only-v0';
const HELD_FILTER_IDENTITY = 'phase-aligned-held-render-application-v0';
const HELD_LAYOUT_IDENTITY = 'x-fastest-zyx-c-interleaved-v0';
const CHANNEL = Object.freeze(Object.fromEntries(KAMINOS_FLUID_CHANNEL_ORDER.map((name, index) => [name, index])));

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sameArray(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function resolveArtifactPath(manifestPath, artifactPath) {
  return isAbsolute(artifactPath) ? artifactPath : resolve(dirname(manifestPath), artifactPath);
}

function requireFiniteArray(value, length, label) {
  if (!Array.isArray(value) || value.length !== length || !value.every(item => typeof item === 'number' && Number.isFinite(item))) {
    throw new Error(`${label} must contain ${length} finite numbers`);
  }
  return value;
}

function validateHeldArtifact(artifact, { kind, shape, channelOrder }) {
  if (!artifact || artifact.kind !== kind || artifact.dtype !== 'float32' || artifact.byteOrder !== 'little-endian') {
    throw new Error(`held ${kind} artifact is missing or incompatible`);
  }
  if (!sameArray(artifact.shape, shape)) throw new Error(`held ${kind} shape mismatch`);
  if (!sameArray(artifact.channelOrder, channelOrder)) throw new Error(`held ${kind} channel order mismatch`);
  const expectedFloatCount = shape.reduce((product, value) => product * value, 1);
  if (artifact.floatCount !== expectedFloatCount || artifact.byteLength !== expectedFloatCount * Float32Array.BYTES_PER_ELEMENT) {
    throw new Error(`held ${kind} length mismatch`);
  }
  if (typeof artifact.url !== 'string' || artifact.url.length === 0) throw new Error(`held ${kind} URL is missing`);
  if (typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw new Error(`held ${kind} sha256 is invalid`);
  return artifact;
}

async function loadHeldTeacherFrame({ manifestPath, manifestBytes, manifest, expectedManifestSha256 }) {
  const manifestSha = sha256(manifestBytes);
  if (typeof expectedManifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expectedManifestSha256)) {
    throw new Error('held replay requires an exact requested manifest sha256');
  }
  if (manifestSha !== expectedManifestSha256) {
    throw new Error(`requested manifest sha256 mismatch: ${manifestSha} != ${expectedManifestSha256}`);
  }
  if (manifest.status !== 'captured' || manifest.failurePhase !== null) throw new Error('held replay manifest is not a complete capture');
  if (typeof manifest.captureId !== 'string' || manifest.captureId.trim().length === 0) throw new Error('held replay captureId is missing');
  if (manifest.initializationAuthority !== HELD_INITIALIZATION_AUTHORITY
    || manifest.filterIdentity !== HELD_FILTER_IDENTITY
    || manifest.layoutIdentity !== HELD_LAYOUT_IDENTITY) {
    throw new Error('held replay field authority or layout mismatch');
  }
  const source = manifest.source || {};
  if (source.identity !== 'operator-live-evolved-basin-v0') throw new Error('held replay source identity mismatch');
  if (source.effectiveRoute !== EXPECTED_ROUTE) throw new Error(`wrong effective route: ${source.effectiveRoute || '(missing)'}`);
  if (typeof source.backend !== 'string' || !source.backend.startsWith('WebGPU:')) throw new Error(`wrong backend: ${source.backend || '(missing)'}`);
  const grid = manifest.grid;
  if (!Number.isInteger(grid) || grid <= 0) throw new Error(`held replay grid is invalid: ${grid}`);
  if (!Number.isInteger(manifest.initialSimStepCount) || manifest.initialSimStepCount < 0) {
    throw new Error(`held replay sim step is invalid: ${manifest.initialSimStepCount}`);
  }
  const camera = manifest.camera || {};
  requireFiniteArray(camera.position, 3, 'held camera position');
  requireFiniteArray(camera.target, 3, 'held camera target');
  requireFiniteArray(camera.projectionMatrix, 16, 'held camera projectionMatrix');
  requireFiniteArray(camera.matrixWorldInverse, 16, 'held camera matrixWorldInverse');

  const fluid = validateHeldArtifact(manifest.fluid, {
    kind: 'fluid',
    shape: [grid, grid, grid, KAMINOS_FLUID_CHANNEL_ORDER.length],
    channelOrder: KAMINOS_FLUID_CHANNEL_ORDER,
  });
  validateHeldArtifact(manifest.front, {
    kind: 'front',
    shape: [grid, grid, grid, 1],
    channelOrder: ['frontTopology'],
  });
  validateHeldArtifact(manifest.boundary, {
    kind: 'boundary',
    shape: [grid, grid, grid, 4],
    channelOrder: ['support', 'coverage', 'ridge', 'footprint'],
  });

  if (typeof source.sourceCaptureManifest !== 'string' || source.sourceCaptureManifest.length === 0
    || typeof source.sourceCaptureManifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sourceCaptureManifestSha256)) {
    throw new Error('held replay source capture identity is missing');
  }
  const sourceCapturePath = resolveArtifactPath(manifestPath, source.sourceCaptureManifest);
  const sourceCaptureBytes = await readFile(sourceCapturePath);
  const sourceCaptureSha = sha256(sourceCaptureBytes);
  if (sourceCaptureSha !== source.sourceCaptureManifestSha256) {
    throw new Error(`source capture sha256 mismatch: ${sourceCaptureSha} != ${source.sourceCaptureManifestSha256}`);
  }

  const fluidPath = resolveArtifactPath(manifestPath, fluid.url);
  const bytes = await readFile(fluidPath);
  if (bytes.byteLength !== fluid.byteLength) throw new Error('held fluid byte length mismatch');
  const fluidSha = sha256(bytes);
  if (fluidSha !== fluid.sha256) throw new Error(`held fluid sha256 mismatch: ${fluidSha} != ${fluid.sha256}`);
  const worldSpace = {
    coordinateFrame: 'kaminos-normalized-volume-local-v0',
    transformAuthority: 'operator-basin-normalized-volume-domain-v0',
    bounds: { minimum: [-1, -1, -1], maximum: [1, 1, 1] },
  };
  const normalizedManifest = {
    ...manifest,
    effectiveRoute: source.effectiveRoute,
    prototypeIdentity: EXPECTED_PROTOTYPE,
    backend: source.backend,
    worldSpace,
  };
  return {
    manifestPath,
    manifestIdentity: `sha256:${manifestSha}`,
    fluidPath,
    fluidIdentity: `sha256:${fluidSha}`,
    manifest: normalizedManifest,
    field: new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / Float32Array.BYTES_PER_ELEMENT),
    grid,
    worldSpace,
    sourceSchema: HELD_REPLAY_SCHEMA,
    captureId: manifest.captureId,
    simStepCount: manifest.initialSimStepCount,
    sourceCaptureIdentity: `sha256:${sourceCaptureSha}`,
    cameraIdentity: `sha256:${sha256(Buffer.from(JSON.stringify(camera)))}`,
  };
}

function requirePositiveIntegerBudget(value) {
  const budget = Number(value);
  if (!Number.isInteger(budget) || budget <= 0) throw new Error(`positive integer budget required, got ${value}`);
  return budget;
}

function normalizeBudgets(budgets) {
  if (!Array.isArray(budgets) || budgets.length === 0) throw new Error('at least one positive integer budget is required');
  const normalized = budgets.map(requirePositiveIntegerBudget);
  return Array.from(new Set(normalized)).sort((left, right) => left - right);
}

async function loadTeacherFrame(manifestPath, expectedManifestSha256) {
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.schema === HELD_REPLAY_SCHEMA) {
    return loadHeldTeacherFrame({ manifestPath, manifestBytes, manifest, expectedManifestSha256 });
  }
  if (manifest.schema !== 'kaminos.volume.full-grid-field-export.v0'
    || manifest.identity !== EXPECTED_EXPORT_IDENTITY
    || manifest.status !== 'captured'
    || manifest.completeFieldCoverage !== true) {
    throw new Error('teacher manifest is not a complete captured full-grid export');
  }
  if (manifest.effectiveRoute !== EXPECTED_ROUTE) throw new Error(`wrong effective route: ${manifest.effectiveRoute || '(missing)'}`);
  if (manifest.prototypeIdentity !== EXPECTED_PROTOTYPE) throw new Error(`wrong prototype identity: ${manifest.prototypeIdentity || '(missing)'}`);
  if (typeof manifest.backend !== 'string' || !manifest.backend.startsWith('WebGPU:')) throw new Error(`wrong backend: ${manifest.backend || '(missing)'}`);
  if (!sameArray(manifest.fluidChannelOrder, KAMINOS_FLUID_CHANNEL_ORDER)) throw new Error('teacher manifest fluid channel order mismatch');
  const fluid = manifest.sidecars?.fluid;
  if (!fluid || fluid.kind !== 'fluid' || fluid.dtype !== 'float32' || fluid.byteOrder !== 'little-endian') throw new Error('teacher fluid sidecar is missing or incompatible');
  if (!sameArray(fluid.channelOrder, KAMINOS_FLUID_CHANNEL_ORDER)) throw new Error('teacher fluid sidecar channel order mismatch');
  const grid = Number(manifest.grid);
  if (!Number.isInteger(grid) || grid <= 0 || !sameArray(fluid.shape, [grid, grid, grid, KAMINOS_FLUID_CHANNEL_ORDER.length])) {
    throw new Error(`teacher fluid shape does not match grid ${grid}`);
  }
  const fluidPath = resolveArtifactPath(manifestPath, fluid.path);
  const bytes = await readFile(fluidPath);
  if (bytes.byteLength !== fluid.byteLength || bytes.byteLength !== fluid.floatCount * Float32Array.BYTES_PER_ELEMENT) throw new Error('teacher fluid byte length mismatch');
  const fluidSha = sha256(bytes);
  if (fluidSha !== fluid.sha256) throw new Error(`teacher fluid sha256 mismatch: ${fluidSha} != ${fluid.sha256}`);
  const replay = manifest.deterministicReplay;
  if (replay?.identity !== 'deterministic-replay-same-route-controls-fixed-step-v0'
    || replay?.authority !== 'same-route-controls-fixed-step-replay') {
    throw new Error('teacher manifest lacks deterministic replay authority');
  }
  for (const key of ['effectiveRoute', 'prototypeIdentity', 'backend', 'grid']) {
    if (replay[key] !== manifest[key]) throw new Error(`teacher replay ${key} does not match manifest`);
  }
  const worldSpace = manifest.worldSpace || {};
  if (worldSpace.transformAuthority !== 'native-volume-grid-world-transform-v0') throw new Error('teacher manifest lacks native world-space transform authority');
  const field = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / Float32Array.BYTES_PER_ELEMENT);
  return {
    manifestPath,
    manifestIdentity: `sha256:${sha256(manifestBytes)}`,
    fluidPath,
    fluidIdentity: `sha256:${fluidSha}`,
    manifest,
    field,
    grid,
    worldSpace,
    sourceSchema: manifest.schema,
    captureId: null,
    simStepCount: replay.simStepCount,
    sourceCaptureIdentity: manifest.sourceCapture?.manifestSha256 || null,
    cameraIdentity: null,
  };
}

function extractSmokeSamples(frame, densityThreshold) {
  const { field, grid, worldSpace } = frame;
  const minimum = worldSpace.bounds?.minimum || [-1, -1, -1];
  const maximum = worldSpace.bounds?.maximum || [1, 1, 1];
  const cellSize = [
    (maximum[0] - minimum[0]) / grid,
    (maximum[1] - minimum[1]) / grid,
    (maximum[2] - minimum[2]) / grid,
  ];
  const samples = [];
  let totalSmokeExtinction = 0;
  let maxSmokeDensity = 0;
  for (let z = 0; z < grid; z += 1) {
    for (let y = 0; y < grid; y += 1) {
      for (let x = 0; x < grid; x += 1) {
        const offset = ((z * grid * grid) + (y * grid) + x) * KAMINOS_FLUID_CHANNEL_ORDER.length;
        const density = field[offset + CHANNEL.smokeDensity];
        if (!(density > densityThreshold)) continue;
        const weight = density;
        totalSmokeExtinction += weight;
        maxSmokeDensity = Math.max(maxSmokeDensity, density);
        samples.push({
          position: [
            minimum[0] + (x + 0.5) * cellSize[0],
            minimum[1] + (y + 0.5) * cellSize[1],
            minimum[2] + (z + 0.5) * cellSize[2],
          ],
          velocity: [
            field[offset + CHANNEL.velocityX],
            field[offset + CHANNEL.velocityY],
            field[offset + CHANNEL.velocityZ],
          ],
          density,
          heat: field[offset + CHANNEL.heat],
          weight,
        });
      }
    }
  }
  if (samples.length === 0) throw new Error(`teacher frame has no smoke samples above density threshold ${densityThreshold}`);
  return {
    samples,
    totalSmokeExtinction,
    maxSmokeDensity,
    activeVoxelCount: samples.length,
    cellSize,
    bounds: { minimum, maximum },
  };
}

function squaredDistance(left, right) {
  const dx = left[0] - right[0];
  const dy = left[1] - right[1];
  const dz = left[2] - right[2];
  return dx * dx + dy * dy + dz * dz;
}

function initializeCenters(samples, budget) {
  let heaviestIndex = 0;
  for (let index = 1; index < samples.length; index += 1) {
    if (samples[index].weight > samples[heaviestIndex].weight) heaviestIndex = index;
  }
  const centers = [samples[heaviestIndex].position.slice()];
  while (centers.length < budget) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      const nearest = Math.min(...centers.map(center => squaredDistance(sample.position, center)));
      const score = nearest * sample.weight;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    centers.push(samples[bestIndex].position.slice());
  }
  return centers;
}

function assignSamples(samples, centers) {
  const assignments = new Int32Array(samples.length);
  let sse = 0;
  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    const sample = samples[sampleIndex];
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let centerIndex = 0; centerIndex < centers.length; centerIndex += 1) {
      const distance = squaredDistance(sample.position, centers[centerIndex]);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = centerIndex;
      }
    }
    assignments[sampleIndex] = bestIndex;
    sse += bestDistance * sample.weight;
  }
  return { assignments, sse };
}

function updateCenters(samples, assignments, centers) {
  const sums = Array.from({ length: centers.length }, () => ({ mass: 0, position: [0, 0, 0] }));
  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    const sample = samples[sampleIndex];
    const aggregate = sums[assignments[sampleIndex]];
    aggregate.mass += sample.weight;
    for (let axis = 0; axis < 3; axis += 1) aggregate.position[axis] += sample.position[axis] * sample.weight;
  }
  return centers.map((center, index) => {
    const aggregate = sums[index];
    return aggregate.mass > 0 ? aggregate.position.map(component => component / aggregate.mass) : center;
  });
}

function covarianceForCluster(samples, assignments, clusterIndex, center, minVariance) {
  const covariance = [0, 0, 0, 0, 0, 0];
  const velocity = [0, 0, 0];
  let mass = 0;
  let densityMass = 0;
  let heatMass = 0;
  let sourceVoxelCount = 0;
  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    if (assignments[sampleIndex] !== clusterIndex) continue;
    const sample = samples[sampleIndex];
    const weight = sample.weight;
    const dx = sample.position[0] - center[0];
    const dy = sample.position[1] - center[1];
    const dz = sample.position[2] - center[2];
    covariance[0] += dx * dx * weight;
    covariance[1] += dx * dy * weight;
    covariance[2] += dx * dz * weight;
    covariance[3] += dy * dy * weight;
    covariance[4] += dy * dz * weight;
    covariance[5] += dz * dz * weight;
    velocity[0] += sample.velocity[0] * weight;
    velocity[1] += sample.velocity[1] * weight;
    velocity[2] += sample.velocity[2] * weight;
    densityMass += sample.density * weight;
    heatMass += sample.heat * weight;
    mass += weight;
    sourceVoxelCount += 1;
  }
  if (mass > 0) {
    for (let index = 0; index < covariance.length; index += 1) covariance[index] /= mass;
    for (let axis = 0; axis < 3; axis += 1) velocity[axis] /= mass;
  }
  covariance[0] = Math.max(covariance[0], minVariance);
  covariance[3] = Math.max(covariance[3], minVariance);
  covariance[5] = Math.max(covariance[5], minVariance);
  return {
    mass,
    covariance,
    velocity,
    densityWitness: mass > 0 ? densityMass / mass : 0,
    temperatureWitness: mass > 0 ? heatMass / mass : 0,
    sourceVoxelCount,
  };
}

function jacobiEigenbasis3x3(covariance) {
  const matrix = [
    [covariance[0], covariance[1], covariance[2]],
    [covariance[1], covariance[3], covariance[4]],
    [covariance[2], covariance[4], covariance[5]],
  ];
  const vectors = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 12; sweep += 1) {
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      const apq = matrix[p][q];
      if (Math.abs(apq) < 1e-12) continue;
      const app = matrix[p][p];
      const aqq = matrix[q][q];
      const angle = 0.5 * Math.atan2(2 * apq, aqq - app);
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      for (let row = 0; row < 3; row += 1) {
        const mrp = matrix[row][p];
        const mrq = matrix[row][q];
        matrix[row][p] = c * mrp - s * mrq;
        matrix[row][q] = s * mrp + c * mrq;
      }
      for (let col = 0; col < 3; col += 1) {
        const mpc = matrix[p][col];
        const mqc = matrix[q][col];
        matrix[p][col] = c * mpc - s * mqc;
        matrix[q][col] = s * mpc + c * mqc;
      }
      for (let row = 0; row < 3; row += 1) {
        const vrp = vectors[row][p];
        const vrq = vectors[row][q];
        vectors[row][p] = c * vrp - s * vrq;
        vectors[row][q] = s * vrp + c * vrq;
      }
    }
  }
  const eigen = [0, 1, 2].map(index => ({
    value: Math.max(matrix[index][index], 0),
    vector: [vectors[0][index], vectors[1][index], vectors[2][index]],
  })).sort((left, right) => right.value - left.value);
  return {
    values: eigen.map(item => item.value),
    vectors: eigen.map(item => item.vector),
  };
}

function buildGaussians({ samples, assignments, centers, cellSize }) {
  const minVariance = Math.min(...cellSize.map(size => size * size)) / 12;
  return centers.map((center, index) => {
    const aggregate = covarianceForCluster(samples, assignments, index, center, minVariance);
    const eigen = jacobiEigenbasis3x3(aggregate.covariance);
    return {
      index,
      position: center,
      covariance: aggregate.covariance,
      eigenValues: eigen.values,
      orientation: eigen.vectors,
      radii: eigen.values.map(value => Math.sqrt(Math.max(value, minVariance))),
      extinctionMass: aggregate.mass,
      densityWitness: aggregate.densityWitness,
      temperatureWitness: aggregate.temperatureWitness,
      velocityWitness: aggregate.velocity,
      sourceVoxelCount: aggregate.sourceVoxelCount,
    };
  });
}

function packGaussians(gaussians) {
  const channelOrder = [
    'positionX', 'positionY', 'positionZ',
    'covXX', 'covXY', 'covXZ', 'covYY', 'covYZ', 'covZZ',
    'axis0X', 'axis0Y', 'axis0Z', 'axis1X', 'axis1Y', 'axis1Z', 'axis2X', 'axis2Y', 'axis2Z',
    'radius0', 'radius1', 'radius2',
    'extinctionMass', 'densityWitness', 'temperatureWitness',
    'velocityX', 'velocityY', 'velocityZ', 'sourceVoxelCount',
  ];
  const packed = new Float32Array(gaussians.length * channelOrder.length);
  for (let index = 0; index < gaussians.length; index += 1) {
    const gaussian = gaussians[index];
    packed.set([
      ...gaussian.position,
      ...gaussian.covariance,
      ...gaussian.orientation[0],
      ...gaussian.orientation[1],
      ...gaussian.orientation[2],
      ...gaussian.radii,
      gaussian.extinctionMass,
      gaussian.densityWitness,
      gaussian.temperatureWitness,
      ...gaussian.velocityWitness,
      gaussian.sourceVoxelCount,
    ], index * channelOrder.length);
  }
  return { bytes: Buffer.from(packed.buffer), channelOrder };
}

function supportDiagnostics(gaussians, bounds) {
  let leaking = 0;
  let maxCovarianceInflation = 0;
  const minimum = bounds.minimum;
  const maximum = bounds.maximum;
  for (const gaussian of gaussians) {
    const majorRadius = Math.max(...gaussian.radii);
    const diameter = majorRadius * 6;
    maxCovarianceInflation = Math.max(maxCovarianceInflation, diameter);
    const outside = gaussian.position.some((component, axis) => component - majorRadius * 3 < minimum[axis] || component + majorRadius * 3 > maximum[axis]);
    if (outside) leaking += 1;
  }
  return {
    supportLeakageGaussianCount: leaking,
    supportLeakageFraction: gaussians.length ? leaking / gaussians.length : 0,
    maxThreeSigmaDiameter: maxCovarianceInflation,
  };
}

async function writeGaussianArtifact(outDir, budget, gaussians) {
  const { bytes, channelOrder } = packGaussians(gaussians);
  const artifactPath = join(outDir, `budget-${budget}.gaussians.f32`);
  await writeFile(artifactPath, bytes);
  return {
    path: artifactPath,
    sha256: `sha256:${sha256(bytes)}`,
    byteLength: bytes.byteLength,
    dtype: 'float32',
    byteOrder: 'little-endian',
    shape: [gaussians.length, channelOrder.length],
    channelOrder,
  };
}

async function fitBudget({ samples, budget, maxIterations, cellSize, bounds, outDir, totalSmokeExtinction }) {
  if (budget > samples.length) throw new Error(`requested budget ${budget} exceeds active smoke sample count ${samples.length}; refusing to substitute a hidden cap`);
  let centers = initializeCenters(samples, budget);
  let assignments = null;
  let massWeightedSse = Infinity;
  let iterationCount = 0;
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const assigned = assignSamples(samples, centers);
    assignments = assigned.assignments;
    massWeightedSse = assigned.sse;
    const nextCenters = updateCenters(samples, assignments, centers);
    const shift = centers.reduce((sum, center, index) => sum + squaredDistance(center, nextCenters[index]), 0);
    centers = nextCenters;
    iterationCount = iteration + 1;
    if (shift < 1e-12) break;
  }
  const gaussians = buildGaussians({ samples, assignments, centers, cellSize });
  const totalAssignedExtinction = gaussians.reduce((sum, gaussian) => sum + gaussian.extinctionMass, 0);
  const artifact = await writeGaussianArtifact(outDir, budget, gaussians);
  return {
    requestedBudget: budget,
    activeGaussianCount: gaussians.length,
    iterationCount,
    totalAssignedExtinction,
    massWeightedSse,
    meanSquaredErrorPerExtinction: massWeightedSse / Math.max(totalSmokeExtinction, 1e-12),
    extinctionAccounting: {
      teacherTotalExtinction: totalSmokeExtinction,
      representedExtinction: totalAssignedExtinction,
      absoluteError: Math.abs(totalAssignedExtinction - totalSmokeExtinction),
      relativeError: Math.abs(totalAssignedExtinction - totalSmokeExtinction) / Math.max(totalSmokeExtinction, 1e-12),
    },
    covariance: {
      axisSystem: 'jacobi-eigenbasis-3x3-v0',
      minRadius: Math.min(...gaussians.flatMap(gaussian => gaussian.radii)),
      maxRadius: Math.max(...gaussians.flatMap(gaussian => gaussian.radii)),
      maxEigenValue: Math.max(...gaussians.flatMap(gaussian => gaussian.eigenValues)),
    },
    support: supportDiagnostics(gaussians, bounds),
    artifact,
    preview: gaussians.slice(0, 8),
  };
}

export async function fitSmokeGaussianOracleFrame({
  manifestPath,
  expectedManifestSha256,
  outDir,
  budgets = [8, 16, 32, 64],
  maxIterations = 12,
  densityThreshold = 0,
} = {}) {
  if (!manifestPath) throw new Error('manifestPath is required');
  if (!outDir) throw new Error('outDir is required');
  const requestedBudgets = normalizeBudgets(budgets);
  const iterations = Math.max(1, Math.floor(Number(maxIterations) || 12));
  const threshold = Math.max(0, Number(densityThreshold) || 0);
  await mkdir(outDir, { recursive: true });
  const frame = await loadTeacherFrame(resolve(manifestPath), expectedManifestSha256);
  const smoke = extractSmokeSamples(frame, threshold);
  const budgetCurve = [];
  for (const budget of requestedBudgets) {
    budgetCurve.push(await fitBudget({
      samples: smoke.samples,
      budget,
      maxIterations: iterations,
      cellSize: smoke.cellSize,
      bounds: smoke.bounds,
      outDir,
      totalSmokeExtinction: smoke.totalSmokeExtinction,
    }));
  }
  const report = {
    schema: 'kaminos.smoke-gaussian-oracle-static-fit-report.v0',
    identity: SMOKE_GAUSSIAN_ORACLE_FIT_IDENTITY,
    status: 'passed',
    createdAt: new Date().toISOString(),
    teacher: {
      manifestPath: frame.manifestPath,
      manifestIdentity: frame.manifestIdentity,
      sourceSchema: frame.sourceSchema,
      captureId: frame.captureId,
      simStepCount: frame.simStepCount,
      sourceCaptureIdentity: frame.sourceCaptureIdentity,
      cameraIdentity: frame.cameraIdentity,
      fluidPath: frame.fluidPath,
      fluidIdentity: frame.fluidIdentity,
      effectiveRoute: frame.manifest.effectiveRoute,
      prototypeIdentity: frame.manifest.prototypeIdentity,
      backend: frame.manifest.backend,
      grid: frame.grid,
      worldSpace: frame.worldSpace,
      activeSmokeVoxelCount: smoke.activeVoxelCount,
      totalSmokeExtinction: smoke.totalSmokeExtinction,
      maxSmokeDensity: smoke.maxSmokeDensity,
    },
    requestedBudgets,
    hiddenBudgetCapApplied: false,
    optimizer: {
      identity: 'deterministic-weighted-kmeans-anisotropic-moment-fit-v0',
      maxIterations: iterations,
      densityThreshold: threshold,
      positionAuthority: 'continuous-mass-weighted-world-centroids',
      covarianceAuthority: 'cluster-smoke-density-weighted-world-covariance',
    },
    budgetCurve,
  };
  const reportPath = join(outDir, 'oracle-fit-report.json');
  const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  await writeFile(reportPath, bytes);
  report.reportPath = reportPath;
  report.reportIdentity = `sha256:${sha256(bytes)}`;
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key.startsWith('--')) continue;
    if (value && !value.startsWith('--')) {
      args.set(key, value);
      index += 1;
    } else {
      args.set(key, true);
    }
  }
  return args;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = args.get('--manifest');
  const outDir = args.get('--out-dir');
  const expectedManifestSha256 = args.get('--manifest-sha256');
  const budgets = String(args.get('--budgets') || '8,16,32,64')
    .split(',')
    .map(value => Number(value.trim()))
    .filter(value => value || value === 0);
  const maxIterations = Number(args.get('--max-iterations') || 12);
  const densityThreshold = Number(args.get('--density-threshold') || 0);
  try {
    const report = await fitSmokeGaussianOracleFrame({
      manifestPath,
      expectedManifestSha256,
      outDir,
      budgets,
      maxIterations,
      densityThreshold,
    });
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    if (outDir) {
      await mkdir(outDir, { recursive: true });
      const failure = {
        schema: 'kaminos.smoke-gaussian-oracle-static-fit-report.v0',
        identity: SMOKE_GAUSSIAN_ORACLE_FIT_IDENTITY,
        status: 'failed',
        message: error?.message || String(error),
        stack: error?.stack || null,
        createdAt: new Date().toISOString(),
      };
      await writeFile(join(outDir, 'oracle-fit-report.json'), `${JSON.stringify(failure, null, 2)}\n`);
    }
    throw error;
  }
}
