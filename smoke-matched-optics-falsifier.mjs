#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import { projectPerspectiveGaussianFootprint } from './smoke-gaussian-oracle-renderer.mjs';

export const SMOKE_MATCHED_OPTICS_FALSIFIER_IDENTITY = 'smoke-matched-optics-falsifier-v0';

const REPORT_SCHEMA = 'kaminos.smoke-matched-optics-falsifier-report.v0';
const ORACLE_SCHEMA = 'kaminos.smoke-extinction-residual-oracle.v0';
const ORACLE_AUTHORITY = 'exact-fluid-extinction-neighborhood-residual-oracle-v0';
const FIT_SCHEMA = 'kaminos.smoke-gaussian-oracle-static-fit-report.v0';
const FIT_IDENTITY = 'smoke-gaussian-oracle-static-fit-v0';
const EXPECTED_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const EXPECTED_PROTOTYPE = 'kaminos-volume-prototype-v0';
const OPTICAL_MODEL = 'beer-lambert-one-minus-exp-negative-depth-v0';
const GAUSSIAN_INTEGRATOR = 'finite-camera-ray-3d-gaussian-closed-form-v0';
const CANDIDATE_MAHALANOBIS_SQUARED = 64;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

function positiveInteger(value, label) {
  const number = finite(value, label);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer`);
  return number;
}

function finiteArray(value, length, label) {
  if (!Array.isArray(value) || value.length !== length || !value.every(Number.isFinite)) {
    throw new Error(`${label} must contain ${length} finite numbers`);
  }
  return value;
}

function resolveArtifactPath(anchorPath, artifactPath, label) {
  if (typeof artifactPath !== 'string' || !artifactPath) throw new Error(`${label} path is missing`);
  if (!isAbsolute(artifactPath)) return resolve(dirname(anchorPath), artifactPath);
  if (existsSync(artifactPath)) return artifactPath;
  const recovered = resolve(dirname(anchorPath), basename(artifactPath));
  if (existsSync(recovered)) return recovered;
  return artifactPath;
}

function multiplyMatrix4(left, right) {
  const output = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let inner = 0; inner < 4; inner += 1) output[column * 4 + row] += left[inner * 4 + row] * right[column * 4 + inner];
    }
  }
  return output;
}

function invertMatrix4(matrix) {
  const rows = Array.from({ length: 4 }, (_, row) => [
    ...Array.from({ length: 4 }, (_, column) => matrix[column * 4 + row]),
    ...Array.from({ length: 4 }, (_, column) => Number(row === column)),
  ]);
  for (let pivotColumn = 0; pivotColumn < 4; pivotColumn += 1) {
    let pivotRow = pivotColumn;
    for (let row = pivotColumn + 1; row < 4; row += 1) {
      if (Math.abs(rows[row][pivotColumn]) > Math.abs(rows[pivotRow][pivotColumn])) pivotRow = row;
    }
    if (Math.abs(rows[pivotRow][pivotColumn]) < 1e-14) throw new Error('camera view-projection matrix is singular');
    [rows[pivotColumn], rows[pivotRow]] = [rows[pivotRow], rows[pivotColumn]];
    const pivot = rows[pivotColumn][pivotColumn];
    for (let column = 0; column < 8; column += 1) rows[pivotColumn][column] /= pivot;
    for (let row = 0; row < 4; row += 1) {
      if (row === pivotColumn) continue;
      const scale = rows[row][pivotColumn];
      for (let column = 0; column < 8; column += 1) rows[row][column] -= scale * rows[pivotColumn][column];
    }
  }
  return Array.from({ length: 16 }, (_, index) => rows[index % 4][4 + Math.floor(index / 4)]);
}

function transformPoint4(matrix, point) {
  return [0, 1, 2, 3].map(row => (
    matrix[row] * point[0]
    + matrix[4 + row] * point[1]
    + matrix[8 + row] * point[2]
    + matrix[12 + row] * point[3]
  ));
}

function unproject(inverseViewProjection, ndcX, ndcY, ndcZ) {
  const homogeneous = transformPoint4(inverseViewProjection, [ndcX, ndcY, ndcZ, 1]);
  if (Math.abs(homogeneous[3]) < 1e-14) throw new Error('camera unprojection produced zero homogeneous weight');
  return homogeneous.slice(0, 3).map(value => value / homogeneous[3]);
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  if (!(length > 0)) throw new Error('camera ray direction has zero length');
  return vector.map(value => value / length);
}

function intersectBounds(origin, direction, minimum, maximum) {
  let start = -Infinity;
  let end = Infinity;
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(direction[axis]) < 1e-14) {
      if (origin[axis] < minimum[axis] || origin[axis] > maximum[axis]) return null;
      continue;
    }
    const first = (minimum[axis] - origin[axis]) / direction[axis];
    const second = (maximum[axis] - origin[axis]) / direction[axis];
    start = Math.max(start, Math.min(first, second));
    end = Math.min(end, Math.max(first, second));
  }
  start = Math.max(start, 0);
  return end > start ? [start, end] : null;
}

function gridCoordinate(point, grid, minimum, maximum) {
  return point.map((value, axis) => ((value - minimum[axis]) / (maximum[axis] - minimum[axis])) * grid - 0.5);
}

function sampleGrid(getValue, grid, minimum, maximum, point) {
  const coordinate = gridCoordinate(point, grid, minimum, maximum);
  const base = coordinate.map(Math.floor);
  const fraction = coordinate.map((value, axis) => value - base[axis]);
  let value = 0;
  for (let dz = 0; dz <= 1; dz += 1) {
    for (let dy = 0; dy <= 1; dy += 1) {
      for (let dx = 0; dx <= 1; dx += 1) {
        const x = Math.max(0, Math.min(grid - 1, base[0] + dx));
        const y = Math.max(0, Math.min(grid - 1, base[1] + dy));
        const z = Math.max(0, Math.min(grid - 1, base[2] + dz));
        const weight = (dx ? fraction[0] : 1 - fraction[0])
          * (dy ? fraction[1] : 1 - fraction[1])
          * (dz ? fraction[2] : 1 - fraction[2]);
        value += getValue(x + y * grid + z * grid * grid) * weight;
      }
    }
  }
  return Math.max(0, value);
}

export function sampleDenseGridTrilinear(values, grid, minimum, maximum, point) {
  if (!(values instanceof Float32Array || values instanceof Float64Array) || values.length !== grid ** 3) {
    throw new Error('dense extinction grid shape mismatch');
  }
  return sampleGrid(index => values[index], grid, minimum, maximum, point);
}

function union(parent, rank, left, right) {
  const root = slot => {
    let current = slot;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };
  const leftRoot = root(left);
  const rightRoot = root(right);
  if (leftRoot === rightRoot) return false;
  if (rank[leftRoot] < rank[rightRoot]) parent[leftRoot] = rightRoot;
  else if (rank[leftRoot] > rank[rightRoot]) parent[rightRoot] = leftRoot;
  else {
    parent[rightRoot] = leftRoot;
    rank[leftRoot] += 1;
  }
  return true;
}

export function buildConnectedSparseGrid({ values, grid } = {}) {
  const size = positiveInteger(grid, 'grid');
  if (!(values instanceof Float32Array || values instanceof Float64Array) || values.length !== size ** 3) {
    throw new Error('connected sparse grid source shape mismatch');
  }
  let positiveCellCount = 0;
  for (const value of values) if (value > 0) positiveCellCount += 1;
  if (positiveCellCount === 0) throw new Error('connected sparse grid source is blank');
  const cellToSlot = new Int32Array(values.length);
  cellToSlot.fill(-1);
  const cellIndices = new Uint32Array(positiveCellCount);
  const sparseValues = new Float32Array(positiveCellCount);
  const parent = new Int32Array(positiveCellCount);
  const rank = new Uint8Array(positiveCellCount);
  let slot = 0;
  let adjacencyEdgeCount = 0;
  for (let cell = 0; cell < values.length; cell += 1) {
    if (!(values[cell] > 0)) continue;
    cellToSlot[cell] = slot;
    cellIndices[slot] = cell;
    sparseValues[slot] = values[cell];
    parent[slot] = slot;
    const x = cell % size;
    const y = Math.floor(cell / size) % size;
    const z = Math.floor(cell / (size * size));
    for (const neighbor of [x > 0 ? cell - 1 : -1, y > 0 ? cell - size : -1, z > 0 ? cell - size * size : -1]) {
      if (neighbor < 0) continue;
      const neighborSlot = cellToSlot[neighbor];
      if (neighborSlot < 0) continue;
      adjacencyEdgeCount += 1;
      union(parent, rank, slot, neighborSlot);
    }
    slot += 1;
  }
  const roots = new Set();
  for (let index = 0; index < parent.length; index += 1) {
    let current = index;
    while (parent[current] !== current) current = parent[current];
    roots.add(current);
  }
  return {
    identity: 'six-neighbor-positive-cell-sparse-grid-v0',
    grid: size,
    positiveCellCount,
    componentCount: roots.size,
    adjacencyEdgeCount,
    hiddenCellCapApplied: false,
    cellToSlot,
    cellIndices,
    values: sparseValues,
  };
}

export function sampleSparseGridTrilinear(sparse, minimum, maximum, point) {
  if (!sparse || sparse.hiddenCellCapApplied !== false || !(sparse.cellToSlot instanceof Int32Array)) {
    throw new Error('invalid connected sparse extinction grid');
  }
  return sampleGrid(index => {
    const slot = sparse.cellToSlot[index];
    return slot >= 0 ? sparse.values[slot] : 0;
  }, sparse.grid, minimum, maximum, point);
}

function invertSymmetricCovariance(covariance) {
  finiteArray(covariance, 6, 'Gaussian covariance');
  const [a, b, c, d, e, f] = covariance;
  const determinant = a * (d * f - e * e) - b * (b * f - c * e) + c * (b * e - c * d);
  if (!(a > 0) || !(a * d - b * b > 0) || !(determinant > 0)) {
    throw new Error('Gaussian covariance must be positive definite');
  }
  return {
    determinant,
    inverse: [
      (d * f - e * e) / determinant,
      (c * e - b * f) / determinant,
      (b * e - c * d) / determinant,
      (a * f - c * c) / determinant,
      (b * c - a * e) / determinant,
      (a * d - b * b) / determinant,
    ],
  };
}

function quadratic(vector, matrix) {
  return vector[0] * vector[0] * matrix[0]
    + 2 * vector[0] * vector[1] * matrix[1]
    + 2 * vector[0] * vector[2] * matrix[2]
    + vector[1] * vector[1] * matrix[3]
    + 2 * vector[1] * vector[2] * matrix[4]
    + vector[2] * vector[2] * matrix[5];
}

function bilinear(left, matrix, right) {
  return left[0] * (matrix[0] * right[0] + matrix[1] * right[1] + matrix[2] * right[2])
    + left[1] * (matrix[1] * right[0] + matrix[3] * right[1] + matrix[4] * right[2])
    + left[2] * (matrix[2] * right[0] + matrix[4] * right[1] + matrix[5] * right[2]);
}

function erf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.5 * x);
  let polynomial = 0.17087277;
  for (const coefficient of [-0.82215223, 1.48851587, -1.13520398, 0.27886807, -0.18628806, 0.09678418, 0.37409196, 1.00002368]) {
    polynomial = coefficient + t * polynomial;
  }
  const tau = t * Math.exp(-x * x - 1.26551223 + t * polynomial);
  return sign * (1 - tau);
}

function prepareGaussian({ mean, covariance, mass }) {
  finiteArray(mean, 3, 'Gaussian mean');
  const extinctionMass = finite(mass, 'Gaussian mass');
  if (!(extinctionMass >= 0)) throw new Error('Gaussian mass must be non-negative');
  const inverted = invertSymmetricCovariance(covariance);
  return {
    mean,
    covariance,
    inverse: inverted.inverse,
    normalization: extinctionMass / (Math.pow(2 * Math.PI, 1.5) * Math.sqrt(inverted.determinant)),
  };
}

function integratePreparedGaussian(prepared, origin, direction, start, end) {
  if (!(end > start) || prepared.normalization === 0) return 0;
  const delta = origin.map((value, axis) => value - prepared.mean[axis]);
  const a = quadratic(direction, prepared.inverse);
  const b = bilinear(direction, prepared.inverse, delta);
  const c = quadratic(delta, prepared.inverse);
  if (!(a > 0)) throw new Error('Gaussian ray quadratic must be positive');
  const centered = Math.max(0, c - b * b / a);
  const root = Math.sqrt(a / 2);
  const shift = b / a;
  const intervalIntegral = Math.sqrt(Math.PI / (2 * a))
    * (erf(root * (end + shift)) - erf(root * (start + shift)));
  return Math.max(0, prepared.normalization * Math.exp(-0.5 * centered) * intervalIntegral);
}

export function integrateGaussianExtinctionSegment({ origin, direction, start, end, mean, covariance, mass } = {}) {
  finiteArray(origin, 3, 'ray origin');
  finiteArray(direction, 3, 'ray direction');
  return integratePreparedGaussian(
    prepareGaussian({ mean, covariance, mass }),
    origin,
    direction,
    finite(start, 'ray start'),
    finite(end, 'ray end'),
  );
}

function buildCameraRays(camera, width, height, minimum, maximum) {
  const viewProjection = multiplyMatrix4(camera.projectionMatrix, camera.matrixWorldInverse);
  const inverseViewProjection = invertMatrix4(viewProjection);
  const directions = new Float64Array(width * height * 3);
  const starts = new Float64Array(width * height);
  const ends = new Float64Array(width * height);
  ends.fill(-1);
  for (let y = 0; y < height; y += 1) {
    const ndcY = 1 - ((y + 0.5) / height) * 2;
    for (let x = 0; x < width; x += 1) {
      const ndcX = ((x + 0.5) / width) * 2 - 1;
      const far = unproject(inverseViewProjection, ndcX, ndcY, 1);
      const direction = normalize(far.map((value, axis) => value - camera.position[axis]));
      const pixel = y * width + x;
      directions.set(direction, pixel * 3);
      const interval = intersectBounds(camera.position, direction, minimum, maximum);
      if (interval) [starts[pixel], ends[pixel]] = interval;
    }
  }
  return { directions, starts, ends };
}

function rayDirection(rays, pixel) {
  const offset = pixel * 3;
  return [rays.directions[offset], rays.directions[offset + 1], rays.directions[offset + 2]];
}

function renderGridDepth({ grid, sampler, camera, rays, minimum, maximum, width, height, samplesPerCell, extinctionCoefficient }) {
  const cellSize = minimum.map((value, axis) => (maximum[axis] - value) / grid);
  const stepWorld = Math.min(...cellSize) / samplesPerCell;
  const opticalDepth = new Float32Array(width * height);
  let totalSamples = 0;
  for (let pixel = 0; pixel < opticalDepth.length; pixel += 1) {
    if (!(rays.ends[pixel] > rays.starts[pixel])) continue;
    const direction = rayDirection(rays, pixel);
    let depth = 0;
    for (let distance = rays.starts[pixel]; distance < rays.ends[pixel]; distance += stepWorld) {
      const segment = Math.min(stepWorld, rays.ends[pixel] - distance);
      const midpoint = distance + segment / 2;
      const point = camera.position.map((value, axis) => value + direction[axis] * midpoint);
      depth += sampler(point) * segment * extinctionCoefficient;
      totalSamples += 1;
    }
    opticalDepth[pixel] = depth;
  }
  return { opticalDepth, totalSamples, stepWorld };
}

function renderGaussianDepth({ rows, camera, rays, minimum, maximum, width, height, extinctionCoefficient, voxelVolume }) {
  const opticalDepth = new Float64Array(width * height);
  let candidateRayCount = 0;
  let integratedRayCount = 0;
  for (const row of rows) {
    const prepared = prepareGaussian({
      mean: row.position,
      covariance: row.covariance,
      mass: row.extinctionMass * voxelVolume * extinctionCoefficient,
    });
    const footprint = projectPerspectiveGaussianFootprint({
      position: row.position,
      covariance: row.covariance,
      projectionMatrix: camera.projectionMatrix,
      matrixWorldInverse: camera.matrixWorldInverse,
      width,
      height,
      varianceFloor: 0,
      coverageScale: 1,
    });
    if (!footprint.visible) continue;
    const trace = footprint.varianceX + footprint.varianceY;
    const discriminant = Math.sqrt(Math.max(0, (footprint.varianceX - footprint.varianceY) ** 2 + 4 * footprint.covarianceXY ** 2));
    const radius = Math.sqrt(CANDIDATE_MAHALANOBIS_SQUARED * (trace + discriminant) / 2);
    const minX = Math.max(0, Math.floor(footprint.pixelX - radius));
    const maxX = Math.min(width - 1, Math.ceil(footprint.pixelX + radius));
    const minY = Math.max(0, Math.floor(footprint.pixelY - radius));
    const maxY = Math.min(height - 1, Math.ceil(footprint.pixelY + radius));
    for (let y = minY; y <= maxY; y += 1) {
      const dy = y + 0.5 - footprint.pixelY;
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x + 0.5 - footprint.pixelX;
        const mahalanobisSquared = footprint.inverseXX * dx * dx
          + 2 * footprint.inverseXY * dx * dy
          + footprint.inverseYY * dy * dy;
        if (mahalanobisSquared > CANDIDATE_MAHALANOBIS_SQUARED) continue;
        candidateRayCount += 1;
        const pixel = y * width + x;
        if (!(rays.ends[pixel] > rays.starts[pixel])) continue;
        opticalDepth[pixel] += integratePreparedGaussian(
          prepared,
          camera.position,
          rayDirection(rays, pixel),
          rays.starts[pixel],
          rays.ends[pixel],
        );
        integratedRayCount += 1;
      }
    }
  }
  return { opticalDepth: Float32Array.from(opticalDepth), candidateRayCount, integratedRayCount };
}

function opticalOutputs(opticalDepth) {
  const transmittance = new Float32Array(opticalDepth.length);
  const luma = new Float32Array(opticalDepth.length);
  let nonzeroPixelCount = 0;
  let maximumOpticalDepth = 0;
  for (let index = 0; index < opticalDepth.length; index += 1) {
    const depth = Math.max(0, opticalDepth[index]);
    const transmission = Math.exp(-depth);
    transmittance[index] = transmission;
    luma[index] = 1 - transmission;
    if (depth > 1e-8) nonzeroPixelCount += 1;
    maximumOpticalDepth = Math.max(maximumOpticalDepth, depth);
  }
  if (nonzeroPixelCount === 0 || !(maximumOpticalDepth > 0)) throw new Error('blank optical output');
  return { transmittance, luma, nonzeroPixelCount, maximumOpticalDepth };
}

function compare(left, right) {
  if (left.length !== right.length) throw new Error('comparison shape mismatch');
  let squaredError = 0;
  let absoluteError = 0;
  let maximumAbsoluteError = 0;
  let targetSquared = 0;
  let targetMaximum = 0;
  for (let index = 0; index < left.length; index += 1) {
    const error = Math.abs(left[index] - right[index]);
    squaredError += error * error;
    absoluteError += error;
    maximumAbsoluteError = Math.max(maximumAbsoluteError, error);
    targetSquared += left[index] * left[index];
    targetMaximum = Math.max(targetMaximum, Math.abs(left[index]));
  }
  const meanSquaredError = squaredError / left.length;
  const targetMeanSquared = targetSquared / left.length;
  return {
    meanSquaredError,
    meanAbsoluteError: absoluteError / left.length,
    maximumAbsoluteError,
    targetMaximum,
    maximumErrorToTargetPeak: maximumAbsoluteError / Math.max(targetMaximum, 1e-30),
    targetMeanSquared,
    normalizedMse: meanSquaredError / Math.max(targetMeanSquared, 1e-30),
  };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return output;
}

function encodeLumaPng(width, height, luma) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const source = y * width + x;
      const target = y * (stride + 1) + 1 + x * 4;
      const value = Math.max(0, Math.min(255, Math.round(luma[source] * 255)));
      raw[target] = value;
      raw[target + 1] = value;
      raw[target + 2] = value;
      raw[target + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function writeFloatArtifact(path, values, shape) {
  const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
  await writeFile(path, bytes);
  return { path, sha256: `sha256:${sha256(bytes)}`, byteLength: bytes.byteLength, dtype: 'float32', byteOrder: 'little-endian', shape };
}

async function writeRoleArtifacts(outDir, id, width, height, depth, outputs, displayExposure) {
  const roleDir = join(outDir, id);
  await mkdir(roleDir, { recursive: true });
  const depthArtifact = await writeFloatArtifact(join(roleDir, 'optical-depth.f32'), depth, [height, width]);
  const transmittanceArtifact = await writeFloatArtifact(join(roleDir, 'transmittance.f32'), outputs.transmittance, [height, width]);
  const lumaArtifact = await writeFloatArtifact(join(roleDir, 'linear-smoke-radiance.f32'), outputs.luma, [height, width]);
  const displayLuma = Float32Array.from(outputs.luma, value => Math.min(1, value * displayExposure));
  const pngBytes = encodeLumaPng(width, height, displayLuma);
  const pngPath = join(roleDir, 'display.png');
  await writeFile(pngPath, pngBytes);
  return {
    opticalDepth: depthArtifact,
    transmittance: transmittanceArtifact,
    linearRadiance: lumaArtifact,
    displayPng: { path: pngPath, sha256: `sha256:${sha256(pngBytes)}`, byteLength: pngBytes.byteLength, width, height },
  };
}

function validateCamera(camera) {
  finiteArray(camera?.position, 3, 'camera position');
  finiteArray(camera?.target, 3, 'camera target');
  finiteArray(camera?.projectionMatrix, 16, 'camera projectionMatrix');
  finiteArray(camera?.matrixWorldInverse, 16, 'camera matrixWorldInverse');
  return camera;
}

function channelMap(channelOrder) {
  const map = Object.fromEntries(channelOrder.map((name, index) => [name, index]));
  for (const name of ['positionX', 'positionY', 'positionZ', 'covXX', 'covXY', 'covXZ', 'covYY', 'covYZ', 'covZZ', 'extinctionMass']) {
    if (!Number.isInteger(map[name])) throw new Error(`Gaussian artifact lacks ${name}`);
  }
  return map;
}

async function loadSource(options, progress) {
  const oraclePath = resolve(options.oracleReportPath || '');
  const oracleBytes = await readFile(oraclePath);
  const oracleIdentity = `sha256:${sha256(oracleBytes)}`;
  if (!options.expectedOracleReportSha256 || oracleIdentity !== options.expectedOracleReportSha256) {
    throw new Error('oracle report sha256 mismatch or missing expectation');
  }
  const oracle = JSON.parse(oracleBytes.toString('utf8'));
  progress.lastTrustworthyEvidence = { oracleReportPath: oraclePath, oracleReportSha256: oracleIdentity };
  if (oracle.schema !== ORACLE_SCHEMA || oracle.authority !== ORACLE_AUTHORITY || oracle.status !== 'passed' || oracle.hiddenCandidateCapApplied !== false) {
    throw new Error('oracle report identity or status mismatch');
  }
  if (oracle.effective?.route !== EXPECTED_ROUTE || oracle.effective?.prototypeIdentity !== EXPECTED_PROTOTYPE
    || typeof oracle.effective?.backend !== 'string' || !oracle.effective.backend.startsWith('WebGPU:')) {
    throw new Error('oracle effective route identity mismatch');
  }
  const grid = positiveInteger(oracle.effective.grid, 'oracle grid');
  const sidecarDescriptor = oracle.sidecar || {};
  if (sidecarDescriptor.dtype !== 'float32' || sidecarDescriptor.byteOrder !== 'little-endian'
    || sidecarDescriptor.shape?.join(',') !== [grid, grid, grid, 4].join(',')
    || sidecarDescriptor.channelOrder?.join(',') !== ['physicalExtinction', 'coverage', 'ridge', 'residualExtinction'].join(',')) {
    throw new Error('oracle sidecar contract mismatch');
  }
  const sidecarPath = resolveArtifactPath(oraclePath, sidecarDescriptor.path, 'sidecar artifact');
  const sidecarBytes = await readFile(sidecarPath);
  if (sidecarBytes.byteLength !== sidecarDescriptor.byteLength
    || `sha256:${sha256(sidecarBytes)}` !== sidecarDescriptor.sha256) throw new Error('sidecar artifact identity mismatch');
  const sidecar = new Float32Array(sidecarBytes.buffer, sidecarBytes.byteOffset, sidecarBytes.byteLength / 4);
  const physical = new Float32Array(grid ** 3);
  let physicalMass = 0;
  for (let cell = 0; cell < physical.length; cell += 1) {
    physical[cell] = sidecar[cell * 4];
    physicalMass += physical[cell];
  }
  const expectedMass = finite(oracle.accounting?.physicalExtinctionMass, 'oracle physical extinction mass');
  if (Math.abs(physicalMass - expectedMass) / Math.max(expectedMass, 1e-12) > 1e-5) throw new Error('sidecar physical extinction mass mismatch');

  const product = oracle.products?.combined;
  if (!product || product.role !== 'coarse-plus-residual' || product.count !== product.descriptor?.shape?.[0]) {
    throw new Error('combined Gaussian product contract mismatch');
  }
  const fitPath = options.cameraFitReportPath
    ? resolve(options.cameraFitReportPath)
    : resolveArtifactPath(oraclePath, product.fitPath, 'Gaussian fit report');
  const fitBytes = await readFile(fitPath);
  const fitIdentity = `sha256:${sha256(fitBytes)}`;
  const expectedFitIdentity = options.expectedCameraFitReportSha256 || options.expectedGaussianFitReportSha256;
  if (!expectedFitIdentity || fitIdentity !== expectedFitIdentity) throw new Error('Gaussian fit report sha256 mismatch or missing expectation');
  const fit = JSON.parse(fitBytes.toString('utf8'));
  if (fit.schema !== FIT_SCHEMA || fit.identity !== FIT_IDENTITY || fit.status !== 'passed' || fit.hiddenBudgetCapApplied !== false) {
    throw new Error('Gaussian fit report identity or status mismatch');
  }
  if (fit.teacher?.effectiveRoute !== EXPECTED_ROUTE || fit.teacher?.prototypeIdentity !== EXPECTED_PROTOTYPE
    || typeof fit.teacher?.backend !== 'string' || !fit.teacher.backend.startsWith('WebGPU:')) {
    throw new Error('Gaussian fit effective route identity mismatch');
  }
  if (fit.teacher.grid !== grid) throw new Error('Gaussian fit grid does not match oracle grid');
  const camera = validateCamera(fit.teacher.camera);
  const cameraIdentity = `sha256:${sha256(Buffer.from(JSON.stringify(camera)))}`;
  if (cameraIdentity !== fit.teacher.cameraIdentity) throw new Error('Gaussian fit camera identity mismatch');
  const minimum = finiteArray(fit.teacher.worldSpace?.bounds?.minimum, 3, 'world minimum');
  const maximum = finiteArray(fit.teacher.worldSpace?.bounds?.maximum, 3, 'world maximum');

  const descriptor = product.descriptor;
  if (descriptor.dtype !== 'float32' || descriptor.byteOrder !== 'little-endian' || descriptor.shape?.[1] !== descriptor.channelOrder?.length) {
    throw new Error('Gaussian artifact encoding mismatch');
  }
  const gaussianPath = resolveArtifactPath(oraclePath, descriptor.path, 'Gaussian artifact');
  let gaussianBytes;
  try {
    gaussianBytes = await readFile(gaussianPath);
  } catch (error) {
    throw new Error(`Gaussian artifact is missing: ${error.message}`);
  }
  if (gaussianBytes.byteLength !== descriptor.byteLength || `sha256:${sha256(gaussianBytes)}` !== descriptor.sha256) {
    throw new Error('Gaussian artifact identity mismatch');
  }
  const map = channelMap(descriptor.channelOrder);
  const gaussianValues = new Float32Array(gaussianBytes.buffer, gaussianBytes.byteOffset, gaussianBytes.byteLength / 4);
  const stride = descriptor.shape[1];
  const rows = [];
  let gaussianMass = 0;
  for (let index = 0; index < descriptor.shape[0]; index += 1) {
    const offset = index * stride;
    const row = {
      position: [gaussianValues[offset + map.positionX], gaussianValues[offset + map.positionY], gaussianValues[offset + map.positionZ]],
      covariance: [
        gaussianValues[offset + map.covXX], gaussianValues[offset + map.covXY], gaussianValues[offset + map.covXZ],
        gaussianValues[offset + map.covYY], gaussianValues[offset + map.covYZ], gaussianValues[offset + map.covZZ],
      ],
      extinctionMass: gaussianValues[offset + map.extinctionMass],
    };
    gaussianMass += row.extinctionMass;
    rows.push(row);
  }
  if (Math.abs(gaussianMass - expectedMass) / Math.max(expectedMass, 1e-12) > 1e-5) throw new Error('Gaussian extinction mass mismatch');
  progress.lastTrustworthyEvidence = {
    ...progress.lastTrustworthyEvidence,
    sidecarPath,
    sidecarSha256: sidecarDescriptor.sha256,
    gaussianFitReportPath: fitPath,
    gaussianFitReportSha256: fitIdentity,
    gaussianArtifactPath: gaussianPath,
    gaussianArtifactSha256: descriptor.sha256,
    effectiveRoute: oracle.effective.route,
    backend: oracle.effective.backend,
    cameraIdentity,
  };
  return { oracle, oraclePath, oracleIdentity, grid, physical, physicalMass, rows, gaussianMass, camera, cameraIdentity, minimum, maximum, fitPath, fitIdentity, sidecarPath, gaussianPath };
}

function roleRecord(id, description, extinctionCoefficient, outputs, artifacts, extra = {}) {
  return {
    id,
    description,
    opticalModel: OPTICAL_MODEL,
    extinctionCoefficient,
    nonzeroPixelCount: outputs.nonzeroPixelCount,
    maximumOpticalDepth: outputs.maximumOpticalDepth,
    artifacts,
    ...extra,
  };
}

async function writeContextHtml(outDir, report) {
  const roleCards = report.roles.map(role => `
    <figure>
      <img src="${role.id}/display.png" alt="${role.id}">
      <figcaption><strong>${role.id}</strong><br>${role.description}<br>Max depth ${role.maximumOpticalDepth.toFixed(6)}; nonzero pixels ${role.nonzeroPixelCount}.</figcaption>
    </figure>`).join('\n');
  const html = `<!doctype html>
<meta charset="utf-8">
<title>Matched-optics smoke falsifier</title>
<style>
  body { margin: 0; padding: 24px; background: #101214; color: #f2f4f5; font: 15px/1.45 system-ui, sans-serif; }
  h1 { margin: 0 0 8px; font-size: 24px; letter-spacing: 0; }
  p { max-width: 1100px; color: #c7cdd1; }
  main { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 18px; }
  figure { margin: 0; border: 1px solid #3a4146; background: #181c1f; }
  img { display: block; width: 100%; image-rendering: auto; background: black; }
  figcaption { padding: 10px; min-height: 84px; }
  strong { color: #fff; }
</style>
<h1>Exact R160 smoke body under one matched Beer-Lambert model</h1>
  <p>All roles use camera <code>${report.effective.cameraIdentity}</code>, explicit extinction coefficient <code>${report.effective.extinctionCoefficient}</code>, and <code>${OPTICAL_MODEL}</code>. PNGs use the same display-only <code>${report.effective.displayExposure}x</code> exposure; metrics and float artifacts remain linear. Dense and connected roles integrate the exact physical-body grid. The Gaussian role integrates each 3D covariance along the finite camera ray, converts cell-sum mass to world-volume mass, and uses an explicit Mahalanobis-${CANDIDATE_MAHALANOBIS_SQUARED} candidate window. This is an isolated optical falsifier, not the production compositor.</p>
<main>${roleCards}</main>`;
  const path = join(outDir, 'context.html');
  const bytes = Buffer.from(html);
  await writeFile(path, bytes);
  return { path, sha256: `sha256:${sha256(bytes)}`, byteLength: bytes.byteLength };
}

export async function runSmokeMatchedOpticsFalsifier(options = {}) {
  const outDir = resolve(options.outDir || '');
  if (!options.outDir) throw new Error('outDir is required');
  await mkdir(outDir, { recursive: true });
  const reportPath = join(outDir, 'matched-optics-report.json');
  const progress = { failurePhase: 'source-validation', lastTrustworthyEvidence: null };
  try {
    const width = positiveInteger(options.width, 'width');
    const height = positiveInteger(options.height, 'height');
    const samplesPerCell = finite(options.samplesPerCell, 'samplesPerCell');
    if (!(samplesPerCell > 0)) throw new Error('samplesPerCell must be positive');
    const extinctionCoefficient = finite(options.extinctionCoefficient, 'extinctionCoefficient');
    if (!(extinctionCoefficient > 0)) throw new Error('extinctionCoefficient must be positive');
    const displayExposure = finite(options.displayExposure, 'displayExposure');
    if (!(displayExposure > 0)) throw new Error('displayExposure must be positive');
    const source = await loadSource(options, progress);
    progress.failurePhase = 'connected-grid-construction';
    const sparse = buildConnectedSparseGrid({ values: source.physical, grid: source.grid });
    const voxelVolume = source.minimum.reduce((volume, minimum, axis) => (
      volume * ((source.maximum[axis] - minimum) / source.grid)
    ), 1);
    const rays = buildCameraRays(source.camera, width, height, source.minimum, source.maximum);

    progress.failurePhase = 'dense-direct-render';
    const denseStarted = performance.now();
    const denseRender = renderGridDepth({
      grid: source.grid,
      sampler: point => sampleDenseGridTrilinear(source.physical, source.grid, source.minimum, source.maximum, point),
      camera: source.camera,
      rays,
      minimum: source.minimum,
      maximum: source.maximum,
      width,
      height,
      samplesPerCell,
      extinctionCoefficient,
    });
    const denseOutputs = opticalOutputs(denseRender.opticalDepth);
    const denseMs = performance.now() - denseStarted;

    progress.failurePhase = 'connected-sparse-render';
    const sparseStarted = performance.now();
    const sparseRender = renderGridDepth({
      grid: source.grid,
      sampler: point => sampleSparseGridTrilinear(sparse, source.minimum, source.maximum, point),
      camera: source.camera,
      rays,
      minimum: source.minimum,
      maximum: source.maximum,
      width,
      height,
      samplesPerCell,
      extinctionCoefficient,
    });
    const sparseOutputs = opticalOutputs(sparseRender.opticalDepth);
    const sparseMs = performance.now() - sparseStarted;
    const sparseDepthComparison = compare(denseRender.opticalDepth, sparseRender.opticalDepth);
    if (sparseDepthComparison.maximumAbsoluteError !== 0) throw new Error('connected sparse grid failed exact dense reconstruction');

    progress.failurePhase = 'analytic-gaussian-render';
    const gaussianStarted = performance.now();
    const gaussianRender = renderGaussianDepth({
      rows: source.rows,
      camera: source.camera,
      rays,
      minimum: source.minimum,
      maximum: source.maximum,
      width,
      height,
      extinctionCoefficient,
      voxelVolume,
    });
    const gaussianOutputs = opticalOutputs(gaussianRender.opticalDepth);
    const gaussianMs = performance.now() - gaussianStarted;

    progress.failurePhase = 'artifact-write';
    const denseArtifacts = await writeRoleArtifacts(outDir, 'dense-direct', width, height, denseRender.opticalDepth, denseOutputs, displayExposure);
    const sparseArtifacts = await writeRoleArtifacts(outDir, 'connected-sparse-grid', width, height, sparseRender.opticalDepth, sparseOutputs, displayExposure);
    const gaussianArtifacts = await writeRoleArtifacts(outDir, 'analytic-gaussian', width, height, gaussianRender.opticalDepth, gaussianOutputs, displayExposure);
    const roles = [
      roleRecord('dense-direct', 'Exact physical smoke-body scalar sampled trilinearly from the full grid.', extinctionCoefficient, denseOutputs, denseArtifacts, {
        representation: 'dense-cell-centered-physical-extinction-grid-v0',
        totalSamples: denseRender.totalSamples,
        renderMs: denseMs,
      }),
      roleRecord('connected-sparse-grid', 'Every positive physical-body cell preserved with explicit six-neighbor connected-component identity.', extinctionCoefficient, sparseOutputs, sparseArtifacts, {
        representation: sparse.identity,
        positiveCellCount: sparse.positiveCellCount,
        componentCount: sparse.componentCount,
        adjacencyEdgeCount: sparse.adjacencyEdgeCount,
        totalSamples: sparseRender.totalSamples,
        renderMs: sparseMs,
      }),
      roleRecord('analytic-gaussian', 'R2/R4 Gaussian mass and full covariance integrated in closed form over each finite camera-ray segment.', extinctionCoefficient, gaussianOutputs, gaussianArtifacts, {
        representation: 'independent-full-covariance-gaussian-mixture-v0',
        integrator: GAUSSIAN_INTEGRATOR,
        gaussianCount: source.rows.length,
        candidateMahalanobisSquared: CANDIDATE_MAHALANOBIS_SQUARED,
        candidateRayCount: gaussianRender.candidateRayCount,
        integratedRayCount: gaussianRender.integratedRayCount,
        cellSumToWorldMassScale: voxelVolume,
        renderMs: gaussianMs,
      }),
    ];
    const report = {
      schema: REPORT_SCHEMA,
      identity: SMOKE_MATCHED_OPTICS_FALSIFIER_IDENTITY,
      status: 'passed',
      failurePhase: null,
      createdAt: new Date().toISOString(),
      hiddenCellCapApplied: false,
      requested: {
        oracleReportPath: options.oracleReportPath,
        expectedOracleReportSha256: options.expectedOracleReportSha256,
        cameraFitReportPath: options.cameraFitReportPath || null,
        expectedGaussianFitReportSha256: options.expectedGaussianFitReportSha256 || null,
        expectedCameraFitReportSha256: options.expectedCameraFitReportSha256 || null,
        width,
        height,
        samplesPerCell,
        extinctionCoefficient,
        displayExposure,
      },
      effective: {
        route: source.oracle.effective.route,
        prototypeIdentity: source.oracle.effective.prototypeIdentity,
        backend: source.oracle.effective.backend,
        oracleReportPath: source.oraclePath,
        oracleReportSha256: source.oracleIdentity,
        gaussianFitReportPath: source.fitPath,
        gaussianFitReportSha256: source.fitIdentity,
        cameraIdentity: source.cameraIdentity,
        grid: source.grid,
        width,
        height,
        samplesPerCell,
        extinctionCoefficient,
        displayExposure,
        opticalModel: OPTICAL_MODEL,
        productionCompositorAuthority: false,
      },
      massAccounting: {
        authority: 'cell-sum-to-world-volume-integral-v0',
        physicalCellSum: source.physicalMass,
        gaussianCellSum: source.gaussianMass,
        voxelVolume,
        physicalWorldIntegratedMass: source.physicalMass * voxelVolume,
        gaussianWorldIntegratedMass: source.gaussianMass * voxelVolume,
      },
      roles,
      comparisons: {
        connectedToDense: {
          opticalDepthMse: sparseDepthComparison.meanSquaredError,
          maximumAbsoluteOpticalDepthError: sparseDepthComparison.maximumAbsoluteError,
          luma: compare(denseOutputs.luma, sparseOutputs.luma),
        },
        gaussianToDense: {
          opticalDepth: compare(denseRender.opticalDepth, gaussianRender.opticalDepth),
          luma: compare(denseOutputs.luma, gaussianOutputs.luma),
        },
      },
      contextHtml: null,
      lastTrustworthyEvidence: progress.lastTrustworthyEvidence,
    };
    report.contextHtml = await writeContextHtml(outDir, report);
    for (const role of report.roles) {
      for (const artifact of Object.values(role.artifacts)) {
        if (!existsSync(artifact.path) || !(artifact.byteLength > 0)) throw new Error(`missing or partial role artifact: ${artifact.path}`);
      }
    }
    const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
    await writeFile(reportPath, reportBytes);
    return { ...report, reportPath, reportIdentity: `sha256:${sha256(reportBytes)}` };
  } catch (error) {
    const failure = {
      schema: REPORT_SCHEMA,
      identity: SMOKE_MATCHED_OPTICS_FALSIFIER_IDENTITY,
      status: 'failed',
      failurePhase: progress.failurePhase,
      error: error?.message || String(error),
      createdAt: new Date().toISOString(),
      hiddenCellCapApplied: false,
      requested: {
        oracleReportPath: options.oracleReportPath || null,
        expectedOracleReportSha256: options.expectedOracleReportSha256 || null,
        cameraFitReportPath: options.cameraFitReportPath || null,
        expectedGaussianFitReportSha256: options.expectedGaussianFitReportSha256 || null,
        expectedCameraFitReportSha256: options.expectedCameraFitReportSha256 || null,
        width: options.width ?? null,
        height: options.height ?? null,
        samplesPerCell: options.samplesPerCell ?? null,
        extinctionCoefficient: options.extinctionCoefficient ?? null,
        displayExposure: options.displayExposure ?? null,
      },
      lastTrustworthyEvidence: progress.lastTrustworthyEvidence,
    };
    await writeFile(reportPath, `${JSON.stringify(failure, null, 2)}\n`);
    throw error;
  }
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const value = argv[index + 1];
    if (value !== undefined && !value.startsWith('--')) {
      args.set(key, value);
      index += 1;
    } else args.set(key, true);
  }
  return args;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const report = await runSmokeMatchedOpticsFalsifier({
      oracleReportPath: args.get('--oracle-report'),
      expectedOracleReportSha256: args.get('--expected-oracle-report-sha256'),
      expectedGaussianFitReportSha256: args.get('--expected-gaussian-fit-report-sha256'),
      cameraFitReportPath: args.get('--camera-fit-report') || null,
      expectedCameraFitReportSha256: args.get('--expected-camera-fit-report-sha256') || null,
      outDir: args.get('--out-dir'),
      width: Number(args.get('--width')),
      height: Number(args.get('--height')),
      samplesPerCell: Number(args.get('--samples-per-cell')),
      extinctionCoefficient: Number(args.get('--extinction-coefficient')),
      displayExposure: Number(args.get('--display-exposure')),
    });
    process.stdout.write(`${JSON.stringify({ status: report.status, reportPath: report.reportPath, reportIdentity: report.reportIdentity }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  }
}
