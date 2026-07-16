#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
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
  if (isAbsolute(artifactPath)) return artifactPath;
  const fromCwd = resolve(artifactPath);
  return existsSync(fromCwd) ? fromCwd : resolve(dirname(manifestPath), artifactPath);
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
    camera: {
      position: [...camera.position],
      target: [...camera.target],
      projectionMatrix: [...camera.projectionMatrix],
      matrixWorldInverse: [...camera.matrixWorldInverse],
    },
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

async function loadWarmStartReport(reportPath, requestedBudgets, targetFrame) {
  const absolutePath = resolve(reportPath);
  const bytes = await readFile(absolutePath);
  const report = JSON.parse(bytes.toString('utf8'));
  if (report.schema !== 'kaminos.smoke-gaussian-oracle-static-fit-report.v0'
    || report.identity !== SMOKE_GAUSSIAN_ORACLE_FIT_IDENTITY
    || report.status !== 'passed' || report.hiddenBudgetCapApplied !== false) {
    throw new Error('warm-start source is not a passed uncapped smoke Gaussian fit');
  }
  const teacher = report.teacher || {};
  if (teacher.effectiveRoute !== targetFrame.manifest.effectiveRoute
    || teacher.prototypeIdentity !== targetFrame.manifest.prototypeIdentity
    || teacher.backend !== targetFrame.manifest.backend
    || teacher.grid !== targetFrame.grid
    || JSON.stringify(teacher.worldSpace?.bounds) !== JSON.stringify(targetFrame.worldSpace?.bounds)) {
    throw new Error('warm-start source route, backend, grid, or world-space mismatch');
  }
  let fromSimStepCount = teacher.simStepCount;
  if (!Number.isInteger(fromSimStepCount) && teacher.manifestPath) {
    const manifestPath = resolveArtifactPath(absolutePath, teacher.manifestPath);
    const manifest = JSON.parse((await readFile(manifestPath)).toString('utf8'));
    if (manifest.effectiveRoute !== teacher.effectiveRoute || manifest.prototypeIdentity !== teacher.prototypeIdentity) {
      throw new Error('warm-start source manifest route or prototype mismatch');
    }
    fromSimStepCount = Number(manifest.deterministicReplay?.simStepCount ?? manifest.deterministicReplay?.completedSteps);
  }
  if (!Number.isInteger(fromSimStepCount) || !(fromSimStepCount < targetFrame.simStepCount)) {
    throw new Error('warm-start source must have a strictly earlier sim step');
  }
  const budgets = new Map();
  for (const budget of requestedBudgets) {
    const entry = report.budgetCurve?.find(item => item.requestedBudget === budget);
    if (!entry || entry.activeGaussianCount !== budget) throw new Error(`warm-start source lacks exact budget ${budget}`);
    const artifact = entry.artifact || {};
    const map = Object.fromEntries((artifact.channelOrder || []).map((name, index) => [name, index]));
    for (const name of ['positionX', 'positionY', 'positionZ']) {
      if (!Number.isInteger(map[name])) throw new Error(`warm-start Gaussian artifact lacks ${name}`);
    }
    const artifactPath = resolveArtifactPath(absolutePath, artifact.path);
    const artifactBytes = await readFile(artifactPath);
    const identity = `sha256:${sha256(artifactBytes)}`;
    if (identity !== artifact.sha256 || artifactBytes.byteLength !== artifact.byteLength) throw new Error(`warm-start artifact identity mismatch at budget ${budget}`);
    const values = new Float32Array(artifactBytes.buffer, artifactBytes.byteOffset, artifactBytes.byteLength / 4);
    const stride = artifact.shape[1];
    const centers = Array.from({ length: budget }, (_, index) => {
      const offset = index * stride;
      return [values[offset + map.positionX], values[offset + map.positionY], values[offset + map.positionZ]];
    });
    budgets.set(budget, { centers, artifactPath, artifactIdentity: identity });
  }
  return {
    reportPath: absolutePath,
    reportIdentity: `sha256:${sha256(bytes)}`,
    fromSimStepCount,
    budgets,
  };
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
  const sourceCamera = manifest.camera || {};
  if (sourceCamera.identity !== 'checksum-bound-native-camera-matrices-v0') throw new Error('teacher camera identity mismatch');
  const camera = {
    position: [...requireFiniteArray(sourceCamera.position, 3, 'teacher camera position')],
    target: [...requireFiniteArray(sourceCamera.target, 3, 'teacher camera target')],
    projectionMatrix: [...requireFiniteArray(sourceCamera.projectionMatrix, 16, 'teacher camera projectionMatrix')],
    matrixWorldInverse: [...requireFiniteArray(sourceCamera.matrixWorldInverse, 16, 'teacher camera matrixWorldInverse')],
  };
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
    cameraIdentity: `sha256:${sha256(Buffer.from(JSON.stringify(camera)))}`,
    camera,
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

function cellCoordinates(cellIndex, grid) {
  const plane = grid * grid;
  const z = Math.floor(cellIndex / plane);
  const remainder = cellIndex - z * plane;
  const y = Math.floor(remainder / grid);
  return [remainder - y * grid, y, z];
}

function extractDenseSmokeIndices(frame, densityThreshold, structureGradientGain = 0) {
  const { field, grid, worldSpace } = frame;
  const minimum = worldSpace.bounds?.minimum || [-1, -1, -1];
  const maximum = worldSpace.bounds?.maximum || [1, 1, 1];
  const cellSize = minimum.map((value, axis) => (maximum[axis] - value) / grid);
  const admitted = new Int32Array(grid ** 3);
  let activeVoxelCount = 0;
  let totalSmokeExtinction = 0;
  let maxSmokeDensity = 0;
  const stride = KAMINOS_FLUID_CHANNEL_ORDER.length;
  for (let cellIndex = 0; cellIndex < grid ** 3; cellIndex += 1) {
    const density = field[cellIndex * stride + CHANNEL.smokeDensity];
    if (!(density > densityThreshold)) continue;
    admitted[activeVoxelCount] = cellIndex;
    activeVoxelCount += 1;
    totalSmokeExtinction += density;
    maxSmokeDensity = Math.max(maxSmokeDensity, density);
  }
  if (activeVoxelCount === 0) throw new Error(`teacher frame has no smoke samples above density threshold ${densityThreshold}`);
  let normalizedSmokeGradients = null;
  let gradientDiagnostics = null;
  const smokeDensityAt = (x, y, z) => {
    const clampedX = Math.max(0, Math.min(grid - 1, x));
    const clampedY = Math.max(0, Math.min(grid - 1, y));
    const clampedZ = Math.max(0, Math.min(grid - 1, z));
    return field[((clampedZ * grid * grid) + (clampedY * grid) + clampedX) * stride + CHANNEL.smokeDensity];
  };
  if (structureGradientGain > 0) {
    const smokeGradients = new Float32Array(grid ** 3);
    let maximumSmokeGradient = 0;
    let activeSmokeGradientSum = 0;
    for (let index = 0; index < activeVoxelCount; index += 1) {
      const cellIndex = admitted[index];
      const [x, y, z] = cellCoordinates(cellIndex, grid);
      const density = smokeDensityAt(x, y, z);
      const dx = Math.max(Math.abs(density - smokeDensityAt(x - 1, y, z)), Math.abs(smokeDensityAt(x + 1, y, z) - density));
      const dy = Math.max(Math.abs(density - smokeDensityAt(x, y - 1, z)), Math.abs(smokeDensityAt(x, y + 1, z) - density));
      const dz = Math.max(Math.abs(density - smokeDensityAt(x, y, z - 1)), Math.abs(smokeDensityAt(x, y, z + 1) - density));
      const magnitude = Math.hypot(dx, dy, dz);
      smokeGradients[cellIndex] = magnitude;
      maximumSmokeGradient = Math.max(maximumSmokeGradient, magnitude);
      activeSmokeGradientSum += magnitude;
    }
    normalizedSmokeGradients = new Float32Array(grid ** 3);
    if (maximumSmokeGradient > 0) {
      for (let index = 0; index < activeVoxelCount; index += 1) {
        const cellIndex = admitted[index];
        normalizedSmokeGradients[cellIndex] = smokeGradients[cellIndex] / maximumSmokeGradient;
      }
    }
    gradientDiagnostics = {
      authority: 'maximum-one-sided-smoke-density-boundary-gradient-clamped-domain-v0',
      maximumSmokeGradient,
      meanActiveSmokeGradient: activeSmokeGradientSum / activeVoxelCount,
      normalization: 'divide-by-measured-maximum-no-clamp-v0',
    };
  }
  return {
    frame,
    indices: admitted.slice(0, activeVoxelCount),
    totalSmokeExtinction,
    maxSmokeDensity,
    activeVoxelCount,
    cellSize,
    bounds: { minimum, maximum },
    structureGradientGain,
    normalizedSmokeGradients,
    gradientDiagnostics,
  };
}

function extinctionWeight(source, cellIndex) {
  return source.extinctionWeights
    ? source.extinctionWeights[cellIndex]
    : source.frame.field[cellIndex * KAMINOS_FLUID_CHANNEL_ORDER.length + CHANNEL.smokeDensity];
}

function allocationWeight(source, cellIndex) {
  const extinction = extinctionWeight(source, cellIndex);
  if (!(source.structureGradientGain > 0)) return extinction;
  return extinction * (1 + source.structureGradientGain * source.normalizedSmokeGradients[cellIndex]);
}

function gaussianForDenseIndices(source, indices) {
  const { frame, cellSize, bounds } = source;
  const { field, grid } = frame;
  const stride = KAMINOS_FLUID_CHANNEL_ORDER.length;
  const first = [0, 0, 0];
  const second = [0, 0, 0, 0, 0, 0];
  const velocity = [0, 0, 0];
  let mass = 0;
  let densityMass = 0;
  let heatMass = 0;
  for (const cellIndex of indices) {
    const [x, y, z] = cellCoordinates(cellIndex, grid);
    const position = [x, y, z].map((coordinate, axis) => bounds.minimum[axis] + (coordinate + 0.5) * cellSize[axis]);
    const offset = cellIndex * stride;
    const weight = extinctionWeight(source, cellIndex);
    mass += weight;
    first[0] += position[0] * weight;
    first[1] += position[1] * weight;
    first[2] += position[2] * weight;
    second[0] += position[0] * position[0] * weight;
    second[1] += position[0] * position[1] * weight;
    second[2] += position[0] * position[2] * weight;
    second[3] += position[1] * position[1] * weight;
    second[4] += position[1] * position[2] * weight;
    second[5] += position[2] * position[2] * weight;
    velocity[0] += field[offset + CHANNEL.velocityX] * weight;
    velocity[1] += field[offset + CHANNEL.velocityY] * weight;
    velocity[2] += field[offset + CHANNEL.velocityZ] * weight;
    densityMass += weight * weight;
    heatMass += field[offset + CHANNEL.heat] * weight;
  }
  const position = first.map(value => value / mass);
  const covariance = [
    second[0] / mass - position[0] * position[0],
    second[1] / mass - position[0] * position[1],
    second[2] / mass - position[0] * position[2],
    second[3] / mass - position[1] * position[1],
    second[4] / mass - position[1] * position[2],
    second[5] / mass - position[2] * position[2],
  ];
  const rawTrace = covariance[0] + covariance[3] + covariance[5];
  const minVariance = Math.min(...cellSize.map(size => size * size)) / 12;
  covariance[0] = Math.max(covariance[0], minVariance);
  covariance[3] = Math.max(covariance[3], minVariance);
  covariance[5] = Math.max(covariance[5], minVariance);
  const eigen = jacobiEigenbasis3x3(covariance);
  let structureWeightedSse = Math.max(0, rawTrace) * mass;
  if (source.structureGradientGain > 0) {
    structureWeightedSse = 0;
    for (const cellIndex of indices) {
      const coordinates = cellCoordinates(cellIndex, grid);
      const samplePosition = coordinates.map((coordinate, axis) => bounds.minimum[axis] + (coordinate + 0.5) * cellSize[axis]);
      structureWeightedSse += squaredDistance(samplePosition, position) * allocationWeight(source, cellIndex);
    }
  }
  return {
    gaussian: {
      position,
      covariance,
      eigenValues: eigen.values,
      orientation: eigen.vectors,
      radii: eigen.values.map(value => Math.sqrt(Math.max(value, minVariance))),
      extinctionMass: mass,
      densityWitness: densityMass / mass,
      temperatureWitness: heatMass / mass,
      velocityWitness: velocity.map(value => value / mass),
      sourceVoxelCount: indices.length,
    },
    massWeightedSse: Math.max(0, rawTrace) * mass,
    structureWeightedSse,
  };
}

function makeDenseLeaf(source, indices) {
  const moment = gaussianForDenseIndices(source, indices);
  return { indices, ...moment };
}

export function chooseLegalWeightedSplitCut(counts, masses, leafCount) {
  const totalMass = masses.reduce((sum, value) => sum + value, 0);
  let candidateCount = 0;
  let candidateMass = 0;
  let minimumImbalance = Infinity;
  let selected = null;
  for (let coordinate = 0; coordinate < counts.length - 1; coordinate += 1) {
    candidateCount += counts[coordinate];
    candidateMass += masses[coordinate];
    if (candidateCount <= 0 || candidateCount >= leafCount) continue;
    const imbalance = Math.abs(candidateMass - totalMass / 2);
    if (imbalance < minimumImbalance) {
      minimumImbalance = imbalance;
      selected = { cut: coordinate, leftCount: candidateCount, leftMass: candidateMass };
    }
  }
  return selected;
}

function splitDenseLeaf(source, leaf) {
  const { grid } = source.frame;
  let allocationVariances = [leaf.gaussian.covariance[0], leaf.gaussian.covariance[3], leaf.gaussian.covariance[5]];
  if (source.structureGradientGain > 0) {
    const weightSums = [0, 0, 0];
    const coordinateSums = [0, 0, 0];
    const coordinateSquares = [0, 0, 0];
    for (const cellIndex of leaf.indices) {
      const coordinates = cellCoordinates(cellIndex, grid);
      const weight = allocationWeight(source, cellIndex);
      for (let axis = 0; axis < 3; axis += 1) {
        weightSums[axis] += weight;
        coordinateSums[axis] += coordinates[axis] * weight;
        coordinateSquares[axis] += coordinates[axis] * coordinates[axis] * weight;
      }
    }
    allocationVariances = weightSums.map((weight, axis) => (
      coordinateSquares[axis] / weight - (coordinateSums[axis] / weight) ** 2
    ));
  }
  const axisOrder = [0, 1, 2].sort((left, right) => allocationVariances[right] - allocationVariances[left]);
  for (const axis of axisOrder) {
    const counts = new Uint32Array(grid);
    const masses = new Float64Array(grid);
    for (const cellIndex of leaf.indices) {
      const coordinate = cellCoordinates(cellIndex, grid)[axis];
      const weight = allocationWeight(source, cellIndex);
      counts[coordinate] += 1;
      masses[coordinate] += weight;
    }
    const selected = chooseLegalWeightedSplitCut(counts, masses, leaf.indices.length);
    if (!selected) continue;
    const { cut, leftCount } = selected;
    const left = new Int32Array(leftCount);
    const right = new Int32Array(leaf.indices.length - leftCount);
    let leftIndex = 0;
    let rightIndex = 0;
    for (const cellIndex of leaf.indices) {
      if (cellCoordinates(cellIndex, grid)[axis] <= cut) {
        left[leftIndex] = cellIndex;
        leftIndex += 1;
      } else {
        right[rightIndex] = cellIndex;
        rightIndex += 1;
      }
    }
    return [makeDenseLeaf(source, left), makeDenseLeaf(source, right)];
  }
  throw new Error(`cannot split dense smoke leaf containing ${leaf.indices.length} distinct voxels`);
}

function splitDenseLeafAlongPrincipalAxis(source, leaf) {
  const { grid } = source.frame;
  const principalAxis = leaf.gaussian.orientation[0];
  const projected = Array.from(leaf.indices, cellIndex => {
    const coordinates = cellCoordinates(cellIndex, grid);
    const position = coordinates.map((coordinate, axis) => (
      source.bounds.minimum[axis] + (coordinate + 0.5) * source.cellSize[axis]
    ));
    return {
      cellIndex,
      projection: position.reduce((sum, component, axis) => sum + component * principalAxis[axis], 0),
      weight: allocationWeight(source, cellIndex),
    };
  }).sort((left, right) => left.projection - right.projection || left.cellIndex - right.cellIndex);
  const totalWeight = projected.reduce((sum, entry) => sum + entry.weight, 0);
  let accumulatedWeight = 0;
  let selectedIndex = -1;
  let selectedProjectionGap = null;
  let minimumImbalance = Infinity;
  let tiedProjectionBoundaryCount = 0;
  for (let index = 0; index < projected.length - 1; index += 1) {
    accumulatedWeight += projected[index].weight;
    const leftProjection = projected[index].projection;
    const rightProjection = projected[index + 1].projection;
    const projectionGap = rightProjection - leftProjection;
    const distinctTolerance = Number.EPSILON * 64 * Math.max(1, Math.abs(leftProjection), Math.abs(rightProjection));
    if (!(projectionGap > distinctTolerance)) {
      tiedProjectionBoundaryCount += 1;
      continue;
    }
    const imbalance = Math.abs(accumulatedWeight - totalWeight / 2);
    if (imbalance < minimumImbalance) {
      minimumImbalance = imbalance;
      selectedIndex = index;
      selectedProjectionGap = projectionGap;
    }
  }
  if (selectedIndex < 0) {
    throw new Error(`cannot geometrically split principal smoke leaf containing ${leaf.indices.length} voxels across distinct projection buckets`);
  }
  const left = Int32Array.from(projected.slice(0, selectedIndex + 1), entry => entry.cellIndex);
  const right = Int32Array.from(projected.slice(selectedIndex + 1), entry => entry.cellIndex);
  const maximumAxisComponent = Math.max(...principalAxis.map(Math.abs));
  return {
    children: [makeDenseLeaf(source, left), makeDenseLeaf(source, right)],
    split: {
      principalAxis,
      cutProjection: (projected[selectedIndex].projection + projected[selectedIndex + 1].projection) / 2,
      projectionGap: selectedProjectionGap,
      tiedProjectionBoundaryCount,
      oblique: maximumAxisComponent < 1 - 1e-6,
    },
  };
}

async function recursiveMomentBudgetCurve({ frame, requestedBudgets, densityThreshold, outDir, structureGradientGain = 0, principalAxisSplit = false }) {
  const source = extractDenseSmokeIndices(frame, densityThreshold, structureGradientGain);
  const maximumBudget = Math.max(...requestedBudgets);
  if (maximumBudget > source.activeVoxelCount) {
    throw new Error(`requested budget ${maximumBudget} exceeds active smoke sample count ${source.activeVoxelCount}; refusing to substitute a hidden cap`);
  }
  const requested = new Set(requestedBudgets);
  const leaves = [makeDenseLeaf(source, source.indices)];
  const budgetCurve = [];
  const partition = {
    obliqueSplitCount: 0,
    axisAlignedSplitCount: 0,
    minimumCutProjectionGap: Infinity,
    tiedProjectionBoundaryCount: 0,
  };
  while (leaves.length <= maximumBudget) {
    if (requested.has(leaves.length)) {
      const gaussians = leaves.map(leaf => leaf.gaussian).sort((left, right) => (
        left.position[0] - right.position[0]
        || left.position[1] - right.position[1]
        || left.position[2] - right.position[2]
      ));
      const totalAssignedExtinction = gaussians.reduce((sum, gaussian) => sum + gaussian.extinctionMass, 0);
      const artifact = await writeGaussianArtifact(outDir, leaves.length, gaussians);
      budgetCurve.push({
        requestedBudget: leaves.length,
        activeGaussianCount: gaussians.length,
        iterationCount: 0,
        splitCount: leaves.length - 1,
        totalAssignedExtinction,
        massWeightedSse: leaves.reduce((sum, leaf) => sum + leaf.massWeightedSse, 0),
        structureWeightedSse: leaves.reduce((sum, leaf) => sum + leaf.structureWeightedSse, 0),
        meanSquaredErrorPerExtinction: leaves.reduce((sum, leaf) => sum + leaf.massWeightedSse, 0) / Math.max(source.totalSmokeExtinction, 1e-12),
        extinctionAccounting: {
          teacherTotalExtinction: source.totalSmokeExtinction,
          representedExtinction: totalAssignedExtinction,
          absoluteError: Math.abs(totalAssignedExtinction - source.totalSmokeExtinction),
          relativeError: Math.abs(totalAssignedExtinction - source.totalSmokeExtinction) / Math.max(source.totalSmokeExtinction, 1e-12),
        },
        covariance: {
          axisSystem: 'jacobi-eigenbasis-3x3-v0',
          minRadius: Math.min(...gaussians.flatMap(gaussian => gaussian.radii)),
          maxRadius: Math.max(...gaussians.flatMap(gaussian => gaussian.radii)),
          maxEigenValue: Math.max(...gaussians.flatMap(gaussian => gaussian.eigenValues)),
        },
        support: supportDiagnostics(gaussians, source.bounds),
        partition: principalAxisSplit ? {
          authority: 'leaf-covariance-principal-axis-distinct-projection-weighted-median-v1',
          splitCount: leaves.length - 1,
          obliqueSplitCount: partition.obliqueSplitCount,
          axisAlignedSplitCount: partition.axisAlignedSplitCount,
          minimumCutProjectionGap: Number.isFinite(partition.minimumCutProjectionGap)
            ? partition.minimumCutProjectionGap
            : null,
          tiedProjectionBoundaryCount: partition.tiedProjectionBoundaryCount,
        } : null,
        artifact,
        preview: gaussians.slice(0, 8),
      });
    }
    if (leaves.length === maximumBudget) break;
    let splitIndex = -1;
    let maximumSse = -Infinity;
    for (let index = 0; index < leaves.length; index += 1) {
      if (leaves[index].indices.length <= 1) continue;
      const allocationSse = source.structureGradientGain > 0
        ? leaves[index].structureWeightedSse
        : leaves[index].massWeightedSse;
      if (allocationSse > maximumSse) {
        maximumSse = allocationSse;
        splitIndex = index;
      }
    }
    if (splitIndex < 0) throw new Error(`cannot reach requested budget ${maximumBudget} without substituting active count`);
    if (principalAxisSplit) {
      const result = splitDenseLeafAlongPrincipalAxis(source, leaves[splitIndex]);
      if (result.split.oblique) partition.obliqueSplitCount += 1;
      else partition.axisAlignedSplitCount += 1;
      partition.minimumCutProjectionGap = Math.min(partition.minimumCutProjectionGap, result.split.projectionGap);
      partition.tiedProjectionBoundaryCount += result.split.tiedProjectionBoundaryCount;
      leaves.splice(splitIndex, 1, ...result.children);
    } else {
      const children = splitDenseLeaf(source, leaves[splitIndex]);
      leaves.splice(splitIndex, 1, ...children);
    }
  }
  return { source, budgetCurve };
}

function recursivePrincipalBank(source, budget) {
  if (!Number.isInteger(budget) || budget <= 0) throw new Error(`dual-bank principal budget must be a positive integer, got ${budget}`);
  if (budget > source.activeVoxelCount) {
    throw new Error(`dual-bank ${source.bankIdentity} budget ${budget} exceeds positive-mass voxel count ${source.activeVoxelCount}; refusing to substitute a hidden cap`);
  }
  const leaves = [makeDenseLeaf(source, source.indices)];
  const partition = {
    authority: 'leaf-covariance-principal-axis-distinct-projection-weighted-median-v1',
    splitCount: 0,
    obliqueSplitCount: 0,
    axisAlignedSplitCount: 0,
    minimumCutProjectionGap: Infinity,
    tiedProjectionBoundaryCount: 0,
  };
  while (leaves.length < budget) {
    let splitIndex = -1;
    let maximumSse = -Infinity;
    for (let index = 0; index < leaves.length; index += 1) {
      if (leaves[index].indices.length <= 1) continue;
      if (leaves[index].massWeightedSse > maximumSse) {
        maximumSse = leaves[index].massWeightedSse;
        splitIndex = index;
      }
    }
    if (splitIndex < 0) throw new Error(`cannot reach dual-bank ${source.bankIdentity} budget ${budget} without substituting active count`);
    const result = splitDenseLeafAlongPrincipalAxis(source, leaves[splitIndex]);
    if (result.split.oblique) partition.obliqueSplitCount += 1;
    else partition.axisAlignedSplitCount += 1;
    partition.minimumCutProjectionGap = Math.min(partition.minimumCutProjectionGap, result.split.projectionGap);
    partition.tiedProjectionBoundaryCount += result.split.tiedProjectionBoundaryCount;
    leaves.splice(splitIndex, 1, ...result.children);
  }
  partition.splitCount = leaves.length - 1;
  partition.minimumCutProjectionGap = Number.isFinite(partition.minimumCutProjectionGap)
    ? partition.minimumCutProjectionGap
    : null;
  return { leaves, partition };
}

function buildDualBankSources(frame, densityThreshold, detailMassFraction) {
  const measured = extractDenseSmokeIndices(frame, densityThreshold, 1);
  const coarseWeights = new Float64Array(frame.grid ** 3);
  const detailWeights = new Float64Array(frame.grid ** 3);
  const stride = KAMINOS_FLUID_CHANNEL_ORDER.length;
  let coarseExtinction = 0;
  let detailExtinction = 0;
  let maximumCoarseWeight = 0;
  let maximumDetailWeight = 0;
  for (const cellIndex of measured.indices) {
    const density = frame.field[cellIndex * stride + CHANNEL.smokeDensity];
    const detail = density * detailMassFraction * measured.normalizedSmokeGradients[cellIndex];
    const coarse = density - detail;
    coarseWeights[cellIndex] = coarse;
    detailWeights[cellIndex] = detail;
    coarseExtinction += coarse;
    detailExtinction += detail;
    maximumCoarseWeight = Math.max(maximumCoarseWeight, coarse);
    maximumDetailWeight = Math.max(maximumDetailWeight, detail);
  }
  const sourceFor = (bankIdentity, extinctionWeights, totalSmokeExtinction, maxSmokeDensity) => {
    const indices = Int32Array.from(measured.indices.filter(cellIndex => extinctionWeights[cellIndex] > 0));
    if (indices.length === 0 || !(totalSmokeExtinction > 0)) throw new Error(`dual-bank ${bankIdentity} source has no positive extinction mass`);
    return {
      ...measured,
      indices,
      activeVoxelCount: indices.length,
      totalSmokeExtinction,
      maxSmokeDensity,
      structureGradientGain: 0,
      extinctionWeights,
      bankIdentity,
    };
  };
  return {
    source: { ...measured, structureGradientGain: 0 },
    coarse: sourceFor('coarse-support', coarseWeights, coarseExtinction, maximumCoarseWeight),
    detail: sourceFor('gradient-detail', detailWeights, detailExtinction, maximumDetailWeight),
  };
}

async function recursiveDualBankBudgetCurve({
  frame,
  requestedBudgets,
  densityThreshold,
  outDir,
  detailBudgetFraction,
  detailMassFraction,
}) {
  const sources = buildDualBankSources(frame, densityThreshold, detailMassFraction);
  const budgetCurve = [];
  for (const budget of requestedBudgets) {
    const detailBudget = budget * detailBudgetFraction;
    const coarseBudget = budget - detailBudget;
    if (!Number.isInteger(detailBudget) || !Number.isInteger(coarseBudget) || detailBudget <= 0 || coarseBudget <= 0) {
      throw new Error(`dual-bank budget ${budget} and detailBudgetFraction ${detailBudgetFraction} must produce positive integer coarse and detail budgets`);
    }
    const coarse = recursivePrincipalBank(sources.coarse, coarseBudget);
    const detail = recursivePrincipalBank(sources.detail, detailBudget);
    const coarseGaussians = coarse.leaves.map(leaf => leaf.gaussian).sort((left, right) => (
      left.position[0] - right.position[0]
      || left.position[1] - right.position[1]
      || left.position[2] - right.position[2]
    ));
    const detailGaussians = detail.leaves.map(leaf => leaf.gaussian).sort((left, right) => (
      left.position[0] - right.position[0]
      || left.position[1] - right.position[1]
      || left.position[2] - right.position[2]
    ));
    const gaussians = [...coarseGaussians, ...detailGaussians];
    const coarseAssignedExtinction = coarseGaussians.reduce((sum, gaussian) => sum + gaussian.extinctionMass, 0);
    const detailAssignedExtinction = detailGaussians.reduce((sum, gaussian) => sum + gaussian.extinctionMass, 0);
    const totalAssignedExtinction = coarseAssignedExtinction + detailAssignedExtinction;
    const massWeightedSse = [...coarse.leaves, ...detail.leaves].reduce((sum, leaf) => sum + leaf.massWeightedSse, 0);
    const artifact = await writeGaussianArtifact(outDir, budget, gaussians);
    budgetCurve.push({
      requestedBudget: budget,
      activeGaussianCount: gaussians.length,
      iterationCount: 0,
      splitCount: gaussians.length - 2,
      totalAssignedExtinction,
      massWeightedSse,
      structureWeightedSse: massWeightedSse,
      meanSquaredErrorPerExtinction: massWeightedSse / Math.max(sources.source.totalSmokeExtinction, 1e-12),
      extinctionAccounting: {
        teacherTotalExtinction: sources.source.totalSmokeExtinction,
        representedExtinction: totalAssignedExtinction,
        absoluteError: Math.abs(totalAssignedExtinction - sources.source.totalSmokeExtinction),
        relativeError: Math.abs(totalAssignedExtinction - sources.source.totalSmokeExtinction) / Math.max(sources.source.totalSmokeExtinction, 1e-12),
      },
      bankAccounting: {
        authority: 'explicit-positive-coarse-gradient-detail-extinction-partition-v0',
        detailBudgetFraction,
        detailMassFraction,
        coarse: {
          identity: sources.coarse.bankIdentity,
          requestedBudget: coarseBudget,
          activeGaussianCount: coarseGaussians.length,
          activeVoxelCount: sources.coarse.activeVoxelCount,
          totalAssignedExtinction: coarseAssignedExtinction,
          artifactRowRange: [0, coarseGaussians.length],
        },
        detail: {
          identity: sources.detail.bankIdentity,
          requestedBudget: detailBudget,
          activeGaussianCount: detailGaussians.length,
          activeVoxelCount: sources.detail.activeVoxelCount,
          totalAssignedExtinction: detailAssignedExtinction,
          artifactRowRange: [coarseGaussians.length, gaussians.length],
        },
      },
      covariance: {
        axisSystem: 'jacobi-eigenbasis-3x3-v0',
        minRadius: Math.min(...gaussians.flatMap(gaussian => gaussian.radii)),
        maxRadius: Math.max(...gaussians.flatMap(gaussian => gaussian.radii)),
        maxEigenValue: Math.max(...gaussians.flatMap(gaussian => gaussian.eigenValues)),
      },
      support: supportDiagnostics(gaussians, sources.source.bounds),
      partition: {
        authority: 'independent-coarse-and-gradient-detail-principal-banks-v0',
        coarse: coarse.partition,
        detail: detail.partition,
      },
      artifact,
      preview: gaussians.slice(0, 8),
    });
  }
  return { source: sources.source, budgetCurve };
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

async function fitBudget({ samples, budget, maxIterations, cellSize, bounds, outDir, totalSmokeExtinction, warmStart = null, maxCenterResidual = null }) {
  if (budget > samples.length) throw new Error(`requested budget ${budget} exceeds active smoke sample count ${samples.length}; refusing to substitute a hidden cap`);
  let centers = warmStart ? warmStart.centers.map(center => [...center]) : initializeCenters(samples, budget);
  const residualAnchors = warmStart ? warmStart.centers.map(center => [...center]) : null;
  let assignments = null;
  let massWeightedSse = Infinity;
  let iterationCount = 0;
  let clippedCenterUpdateCount = 0;
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const assigned = assignSamples(samples, centers);
    assignments = assigned.assignments;
    massWeightedSse = assigned.sse;
    const nextCenters = updateCenters(samples, assignments, centers);
    if (residualAnchors) {
      for (let index = 0; index < nextCenters.length; index += 1) {
        const delta = nextCenters[index].map((value, axis) => value - residualAnchors[index][axis]);
        const magnitude = Math.hypot(...delta);
        if (magnitude > maxCenterResidual) {
          const scale = maxCenterResidual / magnitude;
          nextCenters[index] = residualAnchors[index].map((value, axis) => value + delta[axis] * scale);
          clippedCenterUpdateCount += 1;
        }
      }
    }
    const shift = centers.reduce((sum, center, index) => sum + squaredDistance(center, nextCenters[index]), 0);
    centers = nextCenters;
    iterationCount = iteration + 1;
    if (shift < 1e-12) break;
  }
  const gaussians = buildGaussians({ samples, assignments, centers, cellSize });
  const totalAssignedExtinction = gaussians.reduce((sum, gaussian) => sum + gaussian.extinctionMass, 0);
  const artifact = await writeGaussianArtifact(outDir, budget, gaussians);
  const appliedResiduals = residualAnchors
    ? centers.map((center, index) => Math.sqrt(squaredDistance(center, residualAnchors[index])))
    : [];
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
    warmStart: warmStart ? {
      authority: 'prior-artifact-centers-bounded-residual-v0',
      initialArtifactPath: warmStart.artifactPath,
      initialArtifactIdentity: warmStart.artifactIdentity,
      initialActiveGaussianCount: warmStart.centers.length,
      maxCenterResidual,
      maximumAppliedCenterResidual: Math.max(0, ...appliedResiduals),
      meanAppliedCenterResidual: appliedResiduals.reduce((sum, value) => sum + value, 0) / Math.max(1, appliedResiduals.length),
      clippedCenterUpdateCount,
    } : null,
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
  optimizerStrategy = 'weighted-kmeans',
  warmStartReportPath = null,
  maxCenterResidual = null,
  structureGradientGain = null,
  detailBudgetFraction = null,
  detailMassFraction = null,
} = {}) {
  const startedAt = performance.now();
  if (!manifestPath) throw new Error('manifestPath is required');
  if (!outDir) throw new Error('outDir is required');
  const requestedBudgets = normalizeBudgets(budgets);
  const iterations = Math.max(1, Math.floor(Number(maxIterations) || 12));
  const threshold = Math.max(0, Number(densityThreshold) || 0);
  if (!['weighted-kmeans', 'recursive-moment-split', 'recursive-gradient-moment-split', 'recursive-principal-moment-split', 'recursive-gradient-principal-moment-split', 'recursive-dual-bank-principal-moment-split'].includes(optimizerStrategy)) throw new Error(`unsupported optimizer strategy ${optimizerStrategy}`);
  if (warmStartReportPath && optimizerStrategy !== 'weighted-kmeans') throw new Error('warm start is only supported by weighted-kmeans');
  const dualBankStrategy = optimizerStrategy === 'recursive-dual-bank-principal-moment-split';
  const recursiveStrategy = ['recursive-moment-split', 'recursive-gradient-moment-split', 'recursive-principal-moment-split', 'recursive-gradient-principal-moment-split', 'recursive-dual-bank-principal-moment-split'].includes(optimizerStrategy);
  const gradientStrategy = ['recursive-gradient-moment-split', 'recursive-gradient-principal-moment-split'].includes(optimizerStrategy);
  const principalStrategy = ['recursive-principal-moment-split', 'recursive-gradient-principal-moment-split'].includes(optimizerStrategy);
  const gradientGain = gradientStrategy ? Number(structureGradientGain) : 0;
  if (gradientStrategy && (!(gradientGain > 0) || !Number.isFinite(gradientGain))) {
    throw new Error('recursive gradient moment split requires a positive finite structureGradientGain');
  }
  const effectiveDetailBudgetFraction = dualBankStrategy ? Number(detailBudgetFraction) : null;
  const effectiveDetailMassFraction = dualBankStrategy ? Number(detailMassFraction) : null;
  if (dualBankStrategy && (!(effectiveDetailBudgetFraction > 0) || !(effectiveDetailBudgetFraction < 1) || !Number.isFinite(effectiveDetailBudgetFraction))) {
    throw new Error('recursive dual-bank principal split requires detailBudgetFraction strictly between zero and one');
  }
  if (dualBankStrategy && (!(effectiveDetailMassFraction > 0) || !(effectiveDetailMassFraction <= 1) || !Number.isFinite(effectiveDetailMassFraction))) {
    throw new Error('recursive dual-bank principal split requires detailMassFraction greater than zero and at most one');
  }
  if (dualBankStrategy) {
    for (const budget of requestedBudgets) {
      const detailBudget = budget * effectiveDetailBudgetFraction;
      const coarseBudget = budget - detailBudget;
      if (!Number.isInteger(detailBudget) || !Number.isInteger(coarseBudget) || detailBudget <= 0 || coarseBudget <= 0) {
        throw new Error(`dual-bank budget ${budget} and detailBudgetFraction ${effectiveDetailBudgetFraction} must produce positive integer coarse and detail budgets`);
      }
    }
  }
  const residualLimit = warmStartReportPath ? Number(maxCenterResidual) : null;
  if (warmStartReportPath && (!(residualLimit > 0) || !Number.isFinite(residualLimit))) throw new Error('warm start requires a positive finite maxCenterResidual');
  await mkdir(outDir, { recursive: true });
  const frame = await loadTeacherFrame(resolve(manifestPath), expectedManifestSha256);
  const sourceLoadedAt = performance.now();
  const warmStart = warmStartReportPath ? await loadWarmStartReport(warmStartReportPath, requestedBudgets, frame) : null;
  let smoke;
  let budgetCurve;
  if (dualBankStrategy) {
    const recursive = await recursiveDualBankBudgetCurve({
      frame,
      requestedBudgets,
      densityThreshold: threshold,
      outDir,
      detailBudgetFraction: effectiveDetailBudgetFraction,
      detailMassFraction: effectiveDetailMassFraction,
    });
    smoke = recursive.source;
    budgetCurve = recursive.budgetCurve;
  } else if (recursiveStrategy) {
    const recursive = await recursiveMomentBudgetCurve({
      frame,
      requestedBudgets,
      densityThreshold: threshold,
      outDir,
      structureGradientGain: gradientGain,
      principalAxisSplit: principalStrategy,
    });
    smoke = recursive.source;
    budgetCurve = recursive.budgetCurve;
  } else {
    smoke = extractSmokeSamples(frame, threshold);
    budgetCurve = [];
    for (const budget of requestedBudgets) {
      budgetCurve.push(await fitBudget({
        samples: smoke.samples,
        budget,
        maxIterations: iterations,
        cellSize: smoke.cellSize,
        bounds: smoke.bounds,
        outDir,
        totalSmokeExtinction: smoke.totalSmokeExtinction,
        warmStart: warmStart?.budgets.get(budget) || null,
        maxCenterResidual: residualLimit,
      }));
    }
  }
  const productsBuiltAt = performance.now();
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
      camera: frame.camera,
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
      identity: warmStart
        ? 'warm-started-weighted-kmeans-anisotropic-moment-fit-v0'
        : optimizerStrategy === 'recursive-dual-bank-principal-moment-split'
        ? 'recursive-dual-bank-principal-axis-moment-split-v0'
        : optimizerStrategy === 'recursive-gradient-principal-moment-split'
        ? 'recursive-gradient-principal-axis-moment-split-v0'
        : optimizerStrategy === 'recursive-principal-moment-split'
        ? 'recursive-principal-axis-moment-split-v0'
        : optimizerStrategy === 'recursive-gradient-moment-split'
        ? 'recursive-gradient-weighted-moment-split-v0'
        : optimizerStrategy === 'recursive-moment-split'
        ? 'recursive-weighted-moment-split-v0'
        : 'deterministic-weighted-kmeans-anisotropic-moment-fit-v0',
      maxIterations: recursiveStrategy ? 0 : iterations,
      densityThreshold: threshold,
      positionAuthority: 'continuous-mass-weighted-world-centroids',
      covarianceAuthority: 'cluster-smoke-density-weighted-world-covariance',
      sampleSelectionAuthority: 'all-voxels-above-explicit-density-threshold-no-subsampling-v0',
      structureGradientGain: gradientStrategy ? gradientGain : null,
      detailBudgetFraction: dualBankStrategy ? effectiveDetailBudgetFraction : null,
      detailMassFraction: dualBankStrategy ? effectiveDetailMassFraction : null,
      allocationAuthority: optimizerStrategy === 'recursive-dual-bank-principal-moment-split'
        ? 'positive-coarse-plus-normalized-gradient-detail-mass-principal-banks-v0'
        : optimizerStrategy === 'recursive-gradient-principal-moment-split'
        ? 'density-times-one-plus-normalized-smoke-gradient-gain-principal-axis-sse-v0'
        : optimizerStrategy === 'recursive-gradient-moment-split'
        ? 'density-times-one-plus-normalized-smoke-gradient-gain-v0'
        : optimizerStrategy === 'recursive-principal-moment-split'
        ? 'smoke-density-mass-weighted-principal-axis-sse-v0'
        : 'smoke-density-mass-weighted-sse-v0',
      gradientDiagnostics: gradientStrategy || dualBankStrategy ? smoke.gradientDiagnostics : null,
    },
    warmStart: warmStart ? {
      authority: 'prior-static-fit-artifact-bounded-residual-v0',
      sourceReportPath: warmStart.reportPath,
      sourceReportIdentity: warmStart.reportIdentity,
      fromSimStepCount: warmStart.fromSimStepCount,
      toSimStepCount: frame.simStepCount,
      maxCenterResidual: residualLimit,
    } : null,
    costs: {
      authority: 'cpu-wall-clock-performance-now-v0',
      sourceLoadAndValidateMs: sourceLoadedAt - startedAt,
      optimizerAndProductBuildMs: productsBuiltAt - sourceLoadedAt,
      totalMs: productsBuiltAt - startedAt,
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
  const optimizerStrategy = args.get('--optimizer') || 'weighted-kmeans';
  const warmStartReportPath = args.get('--warm-start-report') || null;
  const maxCenterResidual = args.has('--max-center-residual') ? Number(args.get('--max-center-residual')) : null;
  const structureGradientGain = args.has('--structure-gradient-gain') ? Number(args.get('--structure-gradient-gain')) : null;
  const detailBudgetFraction = args.has('--detail-budget-fraction') ? Number(args.get('--detail-budget-fraction')) : null;
  const detailMassFraction = args.has('--detail-mass-fraction') ? Number(args.get('--detail-mass-fraction')) : null;
  try {
    const report = await fitSmokeGaussianOracleFrame({
      manifestPath,
      expectedManifestSha256,
      outDir,
      budgets,
      maxIterations,
      densityThreshold,
      optimizerStrategy,
      warmStartReportPath,
      maxCenterResidual,
      structureGradientGain,
      detailBudgetFraction,
      detailMassFraction,
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
