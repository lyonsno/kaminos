#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

export const SMOKE_GAUSSIAN_ORACLE_RENDER_IDENTITY = 'smoke-gaussian-oracle-render-witness-v1';

const STATIC_FIT_IDENTITY = 'smoke-gaussian-oracle-static-fit-v0';
const EXPECTED_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const EXPECTED_PROTOTYPE = 'kaminos-volume-prototype-v0';
const REQUIRED_CHANNELS = [
  'positionX', 'positionY', 'positionZ',
  'covXX', 'covXY', 'covYY',
  'extinctionMass',
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
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
  const typeBuf = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuf.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 8 + data.length);
  return out;
}

function writeRgbaPng(path, width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.slice(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function parsePngRgba(buffer) {
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error('only 8-bit PNGs are supported');
      if (data[12] !== 0) throw new Error('interlaced PNGs are not supported');
      if (data[9] === 6) channels = 4;
      else if (data[9] === 2) channels = 3;
      else if (data[9] === 0) channels = 1;
      else throw new Error(`unsupported PNG color type ${data[9]}`);
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (!width || !height || !channels) throw new Error('PNG lacks usable IHDR');
  const inflated = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rgba = new Uint8ClampedArray(width * height * 4);
  let inOffset = 0;
  const previous = Buffer.alloc(stride);
  const current = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inOffset];
    inOffset += 1;
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[inOffset + x];
      const left = x >= channels ? current[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      if (filter === 0) current[x] = raw;
      else if (filter === 1) current[x] = (raw + left) & 255;
      else if (filter === 2) current[x] = (raw + up) & 255;
      else if (filter === 3) current[x] = (raw + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) current[x] = (raw + paeth(left, up, upLeft)) & 255;
      else throw new Error(`unsupported PNG filter ${filter}`);
    }
    inOffset += stride;
    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      const target = (y * width + x) * 4;
      if (channels === 1) {
        rgba[target] = current[source];
        rgba[target + 1] = current[source];
        rgba[target + 2] = current[source];
        rgba[target + 3] = 255;
      } else {
        rgba[target] = current[source];
        rgba[target + 1] = current[source + 1];
        rgba[target + 2] = current[source + 2];
        rgba[target + 3] = channels === 4 ? current[source + 3] : 255;
      }
    }
    current.copy(previous);
  }
  return { width, height, rgba };
}

function resolveArtifactPath(anchorPath, artifactPath) {
  if (isAbsolute(artifactPath)) return artifactPath;
  const fromCwd = resolve(artifactPath);
  if (existsSync(fromCwd)) return fromCwd;
  return resolve(dirname(anchorPath), artifactPath);
}

function normalizeBudgets(budgets) {
  if (!Array.isArray(budgets) || budgets.length === 0) throw new Error('at least one positive integer budget is required');
  return Array.from(new Set(budgets.map(value => {
    const budget = Number(value);
    if (!Number.isInteger(budget) || budget <= 0) throw new Error(`positive integer budget required, got ${value}`);
    return budget;
  }))).sort((left, right) => left - right);
}

function normalizeScales(scales) {
  if (!Array.isArray(scales) || scales.length === 0) throw new Error('at least one positive extinction scale is required');
  return Array.from(new Set(scales.map(value => {
    const scale = Number(value);
    if (!(scale > 0)) throw new Error(`positive extinction scale required, got ${value}`);
    return scale;
  }))).sort((left, right) => left - right);
}

function normalizeCoverageScales(scales) {
  if (!Array.isArray(scales) || scales.length === 0) throw new Error('at least one positive coverage scale is required');
  return Array.from(new Set(scales.map(value => {
    const scale = Number(value);
    if (!(scale > 0)) throw new Error(`positive coverage scale required, got ${value}`);
    return scale;
  }))).sort((left, right) => left - right);
}

async function readJson(path) {
  return JSON.parse((await readFile(path)).toString('utf8'));
}

function validateTeacher(report, projectionMode) {
  if (report.schema !== 'kaminos.smoke-gaussian-oracle-static-fit-report.v0'
    || report.identity !== STATIC_FIT_IDENTITY
    || report.status !== 'passed') {
    throw new Error('static fit report is not a passed smoke Gaussian oracle fit');
  }
  if (report.hiddenBudgetCapApplied !== false) throw new Error('static fit report applied or omitted hidden budget cap accounting');
  const teacher = report.teacher || {};
  if (teacher.effectiveRoute !== EXPECTED_ROUTE) throw new Error(`wrong effective route: ${teacher.effectiveRoute || '(missing)'}`);
  if (teacher.prototypeIdentity !== EXPECTED_PROTOTYPE) throw new Error(`wrong prototype identity: ${teacher.prototypeIdentity || '(missing)'}`);
  if (typeof teacher.backend !== 'string' || !teacher.backend.startsWith('WebGPU:')) throw new Error(`wrong backend: ${teacher.backend || '(missing)'}`);
  if (projectionMode === 'native-camera') {
    const heldReplayAuthority = teacher.sourceSchema === 'kaminos.volume.operator-basin-replay.v0'
      && teacher.worldSpace?.transformAuthority === 'operator-basin-normalized-volume-domain-v0';
    const nativeFullGridAuthority = teacher.sourceSchema === 'kaminos.volume.full-grid-field-export.v0'
      && teacher.worldSpace?.transformAuthority === 'native-volume-grid-world-transform-v0';
    if (!heldReplayAuthority && !nativeFullGridAuthority) {
      throw new Error('native-camera rendering requires checksum-bound held replay or native full-grid world-space authority');
    }
    const camera = teacher.camera;
    if (!camera || !['position', 'target'].every(key => Array.isArray(camera[key]) && camera[key].length === 3 && camera[key].every(Number.isFinite))
      || !['projectionMatrix', 'matrixWorldInverse'].every(key => Array.isArray(camera[key]) && camera[key].length === 16 && camera[key].every(Number.isFinite))) {
      throw new Error('native-camera rendering requires complete finite camera matrices');
    }
    const cameraIdentity = `sha256:${sha256(Buffer.from(JSON.stringify(camera)))}`;
    if (cameraIdentity !== teacher.cameraIdentity) throw new Error(`camera identity mismatch: ${cameraIdentity} != ${teacher.cameraIdentity || '(missing)'}`);
  } else if (teacher.worldSpace?.transformAuthority !== 'native-volume-grid-world-transform-v0') {
    throw new Error('static fit report lacks native world-space authority');
  }
}

function normalizeProjectionMode(value) {
  const mode = value || 'orthographic';
  if (!['orthographic', 'native-camera'].includes(mode)) throw new Error(`unsupported projection mode ${mode}`);
  return mode;
}

function channelMap(channelOrder) {
  const map = Object.fromEntries(channelOrder.map((name, index) => [name, index]));
  for (const name of REQUIRED_CHANNELS) {
    if (!Number.isInteger(map[name])) throw new Error(`Gaussian artifact lacks ${name} channel`);
  }
  return map;
}

async function loadRows(reportPath, entry) {
  const artifact = entry.artifact;
  if (!artifact || artifact.dtype !== 'float32' || artifact.byteOrder !== 'little-endian') throw new Error('Gaussian artifact is missing or incompatible');
  if (!Array.isArray(artifact.shape) || artifact.shape[0] !== entry.activeGaussianCount) throw new Error('Gaussian artifact shape does not match active count');
  const map = channelMap(artifact.channelOrder);
  const artifactPath = resolveArtifactPath(reportPath, artifact.path);
  const bytes = await readFile(artifactPath);
  if (bytes.byteLength !== artifact.byteLength) throw new Error('Gaussian artifact byte length mismatch');
  const artifactSha = `sha256:${sha256(bytes)}`;
  if (artifactSha !== artifact.sha256) throw new Error(`Gaussian artifact sha256 mismatch: ${artifactSha} != ${artifact.sha256}`);
  const values = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / Float32Array.BYTES_PER_ELEMENT);
  const stride = artifact.shape[1];
  const rows = [];
  for (let index = 0; index < artifact.shape[0]; index += 1) {
    const offset = index * stride;
    rows.push({
      index,
      position: [values[offset + map.positionX], values[offset + map.positionY], values[offset + map.positionZ]],
      covariance: [
        values[offset + map.covXX],
        values[offset + map.covXY],
        Number.isInteger(map.covXZ) ? values[offset + map.covXZ] : 0,
        values[offset + map.covYY],
        Number.isInteger(map.covYZ) ? values[offset + map.covYZ] : 0,
        Number.isInteger(map.covZZ) ? values[offset + map.covZZ] : 0,
      ],
      extinctionMass: values[offset + map.extinctionMass],
    });
  }
  return { rows, artifactPath, artifactIdentity: artifactSha };
}

function lumaFromRgba(rgba) {
  const luma = new Float32Array(rgba.length / 4);
  for (let index = 0; index < luma.length; index += 1) {
    const offset = index * 4;
    luma[index] = (0.2126 * rgba[offset] + 0.7152 * rgba[offset + 1] + 0.0722 * rgba[offset + 2]) / 255;
  }
  return luma;
}

export function projectOrthographicGaussianFootprint(covariance, varianceFloor = 0, coverageScale = 1) {
  if (!Array.isArray(covariance) || covariance.length !== 6) throw new Error('six-channel symmetric covariance is required');
  if (!(varianceFloor >= 0)) throw new Error(`nonnegative variance floor required, got ${varianceFloor}`);
  if (!(coverageScale > 0)) throw new Error(`positive coverage scale required, got ${coverageScale}`);
  const covarianceScale = coverageScale * coverageScale;
  let varianceX = Math.max(Number(covariance[0]) * covarianceScale, varianceFloor);
  const covarianceXY = Number(covariance[1]) * covarianceScale;
  let varianceY = Math.max(Number(covariance[3]) * covarianceScale, varianceFloor);
  if (![varianceX, covarianceXY, varianceY].every(Number.isFinite)) throw new Error('finite projected covariance is required');
  const minimumDeterminant = Math.max(varianceFloor * varianceFloor, Number.EPSILON);
  let determinant = varianceX * varianceY - covarianceXY * covarianceXY;
  if (determinant < minimumDeterminant) {
    let jitter = Math.max(varianceFloor, 1e-12);
    for (let iteration = 0; iteration < 12 && determinant < minimumDeterminant; iteration += 1) {
      varianceX += jitter;
      varianceY += jitter;
      determinant = varianceX * varianceY - covarianceXY * covarianceXY;
      jitter *= 10;
    }
  }
  if (!(determinant > 0)) throw new Error(`projected covariance is not positive definite: determinant ${determinant}`);
  return {
    varianceX,
    covarianceXY,
    varianceY,
    determinant,
    inverseXX: varianceY / determinant,
    inverseXY: -covarianceXY / determinant,
    inverseYY: varianceX / determinant,
    normalization: 1 / (2 * Math.PI * Math.sqrt(determinant)),
  };
}

function multiplyMatrix4(left, right) {
  const result = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let inner = 0; inner < 4; inner += 1) {
        result[column * 4 + row] += left[inner * 4 + row] * right[column * 4 + inner];
      }
    }
  }
  return result;
}

function transformPoint4(matrix, point) {
  return [0, 1, 2, 3].map(row => (
    matrix[row] * point[0]
    + matrix[4 + row] * point[1]
    + matrix[8 + row] * point[2]
    + matrix[12 + row]
  ));
}

function covarianceQuadratic(left, covariance, right) {
  return left[0] * right[0] * covariance[0]
    + (left[0] * right[1] + left[1] * right[0]) * covariance[1]
    + (left[0] * right[2] + left[2] * right[0]) * covariance[2]
    + left[1] * right[1] * covariance[3]
    + (left[1] * right[2] + left[2] * right[1]) * covariance[4]
    + left[2] * right[2] * covariance[5];
}

export function projectPerspectiveGaussianFootprint({
  position,
  covariance,
  projectionMatrix,
  matrixWorldInverse,
  width,
  height,
  varianceFloor = 0,
  coverageScale = 1,
} = {}) {
  if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)) throw new Error('three finite Gaussian position channels are required');
  if (!Array.isArray(covariance) || covariance.length !== 6 || !covariance.every(Number.isFinite)) throw new Error('six finite symmetric covariance channels are required');
  if (!Array.isArray(projectionMatrix) || projectionMatrix.length !== 16 || !projectionMatrix.every(Number.isFinite)) throw new Error('finite 4x4 projectionMatrix is required');
  if (!Array.isArray(matrixWorldInverse) || matrixWorldInverse.length !== 16 || !matrixWorldInverse.every(Number.isFinite)) throw new Error('finite 4x4 matrixWorldInverse is required');
  if (!(width > 0) || !(height > 0)) throw new Error('positive projection dimensions are required');
  if (!(varianceFloor >= 0)) throw new Error(`nonnegative variance floor required, got ${varianceFloor}`);
  if (!(coverageScale > 0)) throw new Error(`positive coverage scale required, got ${coverageScale}`);

  const viewProjection = multiplyMatrix4(projectionMatrix, matrixWorldInverse);
  const clip = transformPoint4(viewProjection, position);
  const clipW = clip[3];
  if (!(clipW > 1e-12)) {
    return { visible: false, rejectionReason: 'behind-camera', clipW };
  }
  const ndc = [clip[0] / clipW, clip[1] / clipW, clip[2] / clipW];
  if (ndc[2] < -1 || ndc[2] > 1) {
    return { visible: false, rejectionReason: 'outside-depth-range', clipW, ndc };
  }

  const jacobian = [0, 1].map(clipAxis => {
    const pixelScale = clipAxis === 0 ? width / 2 : -height / 2;
    return [0, 1, 2].map(worldAxis => {
      const numeratorDerivative = viewProjection[worldAxis * 4 + clipAxis];
      const denominatorDerivative = viewProjection[worldAxis * 4 + 3];
      return pixelScale * ((numeratorDerivative * clipW - clip[clipAxis] * denominatorDerivative) / (clipW * clipW));
    });
  });
  const covarianceScale = coverageScale * coverageScale;
  let varianceX = Math.max(covarianceQuadratic(jacobian[0], covariance, jacobian[0]) * covarianceScale, varianceFloor);
  const covarianceXY = covarianceQuadratic(jacobian[0], covariance, jacobian[1]) * covarianceScale;
  let varianceY = Math.max(covarianceQuadratic(jacobian[1], covariance, jacobian[1]) * covarianceScale, varianceFloor);
  const minimumDeterminant = Math.max(varianceFloor * varianceFloor, Number.EPSILON);
  let determinant = varianceX * varianceY - covarianceXY * covarianceXY;
  if (determinant < minimumDeterminant) {
    let jitter = Math.max(varianceFloor, 1e-12);
    for (let iteration = 0; iteration < 12 && determinant < minimumDeterminant; iteration += 1) {
      varianceX += jitter;
      varianceY += jitter;
      determinant = varianceX * varianceY - covarianceXY * covarianceXY;
      jitter *= 10;
    }
  }
  if (!(determinant > 0)) throw new Error(`perspective projected covariance is not positive definite: determinant ${determinant}`);
  return {
    visible: true,
    pixelX: (ndc[0] * 0.5 + 0.5) * width,
    pixelY: (0.5 - ndc[1] * 0.5) * height,
    ndc,
    clipW,
    jacobian,
    varianceX,
    covarianceXY,
    varianceY,
    determinant,
    inverseXX: varianceY / determinant,
    inverseXY: -covarianceXY / determinant,
    inverseYY: varianceX / determinant,
    normalization: 1 / (2 * Math.PI * Math.sqrt(determinant)),
  };
}

function projectOrthographicOpticalDepth(rows, width, height, worldSpace, coverageScale) {
  const opticalDepth = new Float32Array(width * height);
  const minimum = worldSpace?.bounds?.minimum || [-1, -1, -1];
  const maximum = worldSpace?.bounds?.maximum || [1, 1, 1];
  const pixelWorldX = (maximum[0] - minimum[0]) / width;
  const pixelWorldY = (maximum[1] - minimum[1]) / height;
  const varianceFloor = Math.max(pixelWorldX * pixelWorldX, pixelWorldY * pixelWorldY) / 12;
  const footprints = rows.map(row => ({
    ...row,
    footprint: projectOrthographicGaussianFootprint(row.covariance, varianceFloor, coverageScale),
  }));
  let supportPixelCount = 0;
  let singleContributorPixelCount = 0;
  let contributorSum = 0;
  let maxContributors = 0;
  let peakDominanceSum = 0;
  for (let y = 0; y < height; y += 1) {
    const worldY = maximum[1] - (y + 0.5) * pixelWorldY;
    for (let x = 0; x < width; x += 1) {
      const worldX = minimum[0] + (x + 0.5) * pixelWorldX;
      let pixelOpticalDepth = 0;
      let contributors = 0;
      let peakContribution = 0;
      for (const row of footprints) {
        const dx = worldX - row.position[0];
        const dy = worldY - row.position[1];
        const footprint = row.footprint;
        const mahalanobisSquared = footprint.inverseXX * dx * dx
          + 2 * footprint.inverseXY * dx * dy
          + footprint.inverseYY * dy * dy;
        if (mahalanobisSquared > 32) continue;
        const contribution = row.extinctionMass * footprint.normalization * Math.exp(-0.5 * mahalanobisSquared);
        pixelOpticalDepth += contribution;
        peakContribution = Math.max(peakContribution, contribution);
        if (mahalanobisSquared <= 16) contributors += 1;
      }
      const index = y * width + x;
      opticalDepth[index] = pixelOpticalDepth;
      if (contributors > 0) {
        supportPixelCount += 1;
        contributorSum += contributors;
        maxContributors = Math.max(maxContributors, contributors);
        if (contributors === 1) singleContributorPixelCount += 1;
        if (pixelOpticalDepth > 0) peakDominanceSum += peakContribution / pixelOpticalDepth;
      }
    }
  }
  const determinants = footprints.map(row => row.footprint.determinant);
  return {
    opticalDepth,
    diagnostics: {
      identity: 'orthographic-full-covariance-overlap-diagnostics-v0',
      coverageScale,
      supportPixelCount,
      singleContributorPixelCount,
      singleContributorPixelFraction: supportPixelCount ? singleContributorPixelCount / supportPixelCount : 0,
      meanContributorsPerSupportPixel: supportPixelCount ? contributorSum / supportPixelCount : 0,
      maxContributors,
      meanPeakContributionFraction: supportPixelCount ? peakDominanceSum / supportPixelCount : 0,
      minimumProjectedCovarianceDeterminant: Math.min(...determinants),
      maximumProjectedCovarianceDeterminant: Math.max(...determinants),
    },
  };
}

export function buildPerspectiveGaussianBasis({ rows, width, height, camera, coverageScale = 1 } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('perspective Gaussian basis requires nonempty rows');
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) throw new Error('perspective Gaussian basis requires positive integer dimensions');
  if (!(coverageScale > 0)) throw new Error('perspective Gaussian basis requires positive coverageScale');
  const varianceFloor = 1 / 12;
  const projectedRows = rows.map((row, gaussianIndex) => ({
    ...row,
    gaussianIndex,
    footprint: projectPerspectiveGaussianFootprint({
      position: row.position,
      covariance: row.covariance,
      projectionMatrix: camera.projectionMatrix,
      matrixWorldInverse: camera.matrixWorldInverse,
      width,
      height,
      varianceFloor,
      coverageScale,
    }),
  }));
  const footprints = projectedRows.filter(row => row.footprint.visible);
  const basis = [];
  for (const row of footprints) {
    const footprint = row.footprint;
    const trace = footprint.varianceX + footprint.varianceY;
    const discriminant = Math.sqrt(Math.max(0, (footprint.varianceX - footprint.varianceY) ** 2 + 4 * footprint.covarianceXY ** 2));
    const maximumVariance = (trace + discriminant) / 2;
    const supportRadius = Math.sqrt(32 * maximumVariance);
    const minX = Math.max(0, Math.floor(footprint.pixelX - supportRadius));
    const maxX = Math.min(width - 1, Math.ceil(footprint.pixelX + supportRadius));
    const minY = Math.max(0, Math.floor(footprint.pixelY - supportRadius));
    const maxY = Math.min(height - 1, Math.ceil(footprint.pixelY + supportRadius));
    const indices = [];
    const values = [];
    const coreIndices = [];
    for (let y = minY; y <= maxY; y += 1) {
      const dy = y + 0.5 - footprint.pixelY;
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x + 0.5 - footprint.pixelX;
        const mahalanobisSquared = footprint.inverseXX * dx * dx
          + 2 * footprint.inverseXY * dx * dy
          + footprint.inverseYY * dy * dy;
        if (mahalanobisSquared > 32) continue;
        const index = y * width + x;
        indices.push(index);
        values.push(footprint.normalization * Math.exp(-0.5 * mahalanobisSquared));
        if (mahalanobisSquared <= 16) coreIndices.push(index);
      }
    }
    basis.push({
      gaussianIndex: row.gaussianIndex,
      indices: Uint32Array.from(indices),
      values: Float32Array.from(values),
      coreIndices: Uint32Array.from(coreIndices),
      determinant: footprint.determinant,
      footprint,
    });
  }
  return {
    basis,
    requestedGaussianCount: rows.length,
    visibleGaussianCount: footprints.length,
    rejectedGaussianCount: rows.length - footprints.length,
    rejectionReasons: Object.fromEntries(projectedRows
      .filter(row => !row.footprint.visible)
      .reduce((counts, row) => counts.set(row.footprint.rejectionReason, (counts.get(row.footprint.rejectionReason) || 0) + 1), new Map())),
  };
}

export function renderSparseGaussianBasis(basis, masses, pixelCount) {
  if (!Array.isArray(basis) || !masses || basis.length !== masses.length) throw new Error('sparse Gaussian basis and masses must have equal nonzero count');
  const opticalDepth = new Float64Array(pixelCount);
  for (let gaussianIndex = 0; gaussianIndex < basis.length; gaussianIndex += 1) {
    const item = basis[gaussianIndex];
    const mass = masses[gaussianIndex];
    for (let itemIndex = 0; itemIndex < item.indices.length; itemIndex += 1) {
      opticalDepth[item.indices[itemIndex]] += mass * item.values[itemIndex];
    }
  }
  return opticalDepth;
}

function projectPerspectiveOpticalDepth(rows, width, height, camera, coverageScale) {
  const sparse = buildPerspectiveGaussianBasis({ rows, width, height, camera, coverageScale });
  const masses = Float64Array.from(sparse.basis, item => rows[item.gaussianIndex].extinctionMass);
  const opticalDepth64 = renderSparseGaussianBasis(sparse.basis, masses, width * height);
  const opticalDepth = Float32Array.from(opticalDepth64);
  const contributorCounts = new Uint32Array(width * height);
  const peakContributions = new Float32Array(width * height);
  for (let gaussianIndex = 0; gaussianIndex < sparse.basis.length; gaussianIndex += 1) {
    const item = sparse.basis[gaussianIndex];
    const mass = masses[gaussianIndex];
    for (const index of item.coreIndices) contributorCounts[index] += 1;
    for (let itemIndex = 0; itemIndex < item.indices.length; itemIndex += 1) {
      const index = item.indices[itemIndex];
      peakContributions[index] = Math.max(peakContributions[index], mass * item.values[itemIndex]);
    }
  }
  let supportPixelCount = 0;
  let singleContributorPixelCount = 0;
  let contributorSum = 0;
  let maxContributors = 0;
  let peakDominanceSum = 0;
  for (let index = 0; index < opticalDepth.length; index += 1) {
    const contributors = contributorCounts[index];
    if (contributors === 0) continue;
    supportPixelCount += 1;
    contributorSum += contributors;
    maxContributors = Math.max(maxContributors, contributors);
    if (contributors === 1) singleContributorPixelCount += 1;
    if (opticalDepth[index] > 0) peakDominanceSum += peakContributions[index] / opticalDepth[index];
  }
  const determinants = sparse.basis.map(item => item.determinant);
  return {
    opticalDepth,
    diagnostics: {
      identity: 'perspective-full-covariance-overlap-diagnostics-v0',
      coverageScale,
      requestedGaussianCount: sparse.requestedGaussianCount,
      visibleGaussianCount: sparse.visibleGaussianCount,
      rejectedGaussianCount: sparse.rejectedGaussianCount,
      rejectionReasons: sparse.rejectionReasons,
      supportPixelCount,
      singleContributorPixelCount,
      singleContributorPixelFraction: supportPixelCount ? singleContributorPixelCount / supportPixelCount : 0,
      meanContributorsPerSupportPixel: supportPixelCount ? contributorSum / supportPixelCount : 0,
      maxContributors,
      meanPeakContributionFraction: supportPixelCount ? peakDominanceSum / supportPixelCount : 0,
      minimumProjectedCovarianceDeterminant: determinants.length ? Math.min(...determinants) : null,
      maximumProjectedCovarianceDeterminant: determinants.length ? Math.max(...determinants) : null,
    },
  };
}

function lumaFromOpticalDepth(opticalDepth, extinctionScale) {
  const luma = new Float32Array(opticalDepth.length);
  for (let index = 0; index < opticalDepth.length; index += 1) {
    luma[index] = Math.min(1, 1 - Math.exp(-extinctionScale * opticalDepth[index]));
  }
  return luma;
}

function lumaToRgba(luma, tone = 'render') {
  const rgba = new Uint8ClampedArray(luma.length * 4);
  for (let index = 0; index < luma.length; index += 1) {
    const value = Math.max(0, Math.min(255, Math.round(luma[index] * 255)));
    const offset = index * 4;
    if (tone === 'diff') {
      rgba[offset] = value;
      rgba[offset + 1] = value;
      rgba[offset + 2] = 255 - value;
    } else {
      rgba[offset] = value;
      rgba[offset + 1] = value;
      rgba[offset + 2] = value;
    }
    rgba[offset + 3] = 255;
  }
  return rgba;
}

export function multiscaleStructuralLoss({
  prediction,
  target,
  width,
  height,
  scales = [1, 2, 4],
  valueWeight = 1,
  gradientWeight = 1,
} = {}) {
  if (!prediction || !target || prediction.length !== target.length || prediction.length !== width * height) {
    throw new Error('prediction and target must match the declared image dimensions');
  }
  if (!Array.isArray(scales) || scales.length === 0 || scales.some(scale => !Number.isInteger(scale) || scale <= 0)) {
    throw new Error('multiscale structural loss requires positive integer scales');
  }
  if (!(valueWeight >= 0) || !(gradientWeight >= 0) || !(valueWeight + gradientWeight > 0)) {
    throw new Error('multiscale structural loss requires nonnegative nonzero weights');
  }
  const fullGradient = new Float64Array(prediction.length);
  const levelWeight = 1 / scales.length;
  const levels = [];
  let valueLoss = 0;
  let gradientLoss = 0;
  for (const scale of scales) {
    const levelWidth = Math.ceil(width / scale);
    const levelHeight = Math.ceil(height / scale);
    const levelLength = levelWidth * levelHeight;
    const predictedLevel = new Float64Array(levelLength);
    const targetLevel = new Float64Array(levelLength);
    const counts = new Uint32Array(levelLength);
    for (let y = 0; y < height; y += 1) {
      const levelY = Math.floor(y / scale);
      for (let x = 0; x < width; x += 1) {
        const sourceIndex = y * width + x;
        const levelIndex = levelY * levelWidth + Math.floor(x / scale);
        predictedLevel[levelIndex] += prediction[sourceIndex];
        targetLevel[levelIndex] += target[sourceIndex];
        counts[levelIndex] += 1;
      }
    }
    for (let index = 0; index < levelLength; index += 1) {
      predictedLevel[index] /= counts[index];
      targetLevel[index] /= counts[index];
    }
    const levelGradient = new Float64Array(levelLength);
    let levelValueLoss = 0;
    for (let index = 0; index < levelLength; index += 1) {
      const residual = predictedLevel[index] - targetLevel[index];
      levelValueLoss += residual * residual;
      levelGradient[index] += levelWeight * valueWeight * 2 * residual / levelLength;
    }
    levelValueLoss = levelWeight * valueWeight * levelValueLoss / levelLength;
    let edgeSquaredError = 0;
    let edgeCount = 0;
    for (let y = 0; y < levelHeight; y += 1) {
      for (let x = 0; x < levelWidth; x += 1) {
        const index = y * levelWidth + x;
        if (x + 1 < levelWidth) {
          const next = index + 1;
          const residual = (predictedLevel[next] - predictedLevel[index]) - (targetLevel[next] - targetLevel[index]);
          edgeSquaredError += residual * residual;
          edgeCount += 1;
        }
        if (y + 1 < levelHeight) {
          const next = index + levelWidth;
          const residual = (predictedLevel[next] - predictedLevel[index]) - (targetLevel[next] - targetLevel[index]);
          edgeSquaredError += residual * residual;
          edgeCount += 1;
        }
      }
    }
    const edgeScale = edgeCount ? levelWeight * gradientWeight / edgeCount : 0;
    for (let y = 0; y < levelHeight; y += 1) {
      for (let x = 0; x < levelWidth; x += 1) {
        const index = y * levelWidth + x;
        if (x + 1 < levelWidth) {
          const next = index + 1;
          const residual = (predictedLevel[next] - predictedLevel[index]) - (targetLevel[next] - targetLevel[index]);
          const derivative = 2 * edgeScale * residual;
          levelGradient[index] -= derivative;
          levelGradient[next] += derivative;
        }
        if (y + 1 < levelHeight) {
          const next = index + levelWidth;
          const residual = (predictedLevel[next] - predictedLevel[index]) - (targetLevel[next] - targetLevel[index]);
          const derivative = 2 * edgeScale * residual;
          levelGradient[index] -= derivative;
          levelGradient[next] += derivative;
        }
      }
    }
    const levelGradientLoss = edgeScale * edgeSquaredError;
    valueLoss += levelValueLoss;
    gradientLoss += levelGradientLoss;
    for (let y = 0; y < height; y += 1) {
      const levelY = Math.floor(y / scale);
      for (let x = 0; x < width; x += 1) {
        const sourceIndex = y * width + x;
        const levelIndex = levelY * levelWidth + Math.floor(x / scale);
        fullGradient[sourceIndex] += levelGradient[levelIndex] / counts[levelIndex];
      }
    }
    levels.push({
      scale,
      width: levelWidth,
      height: levelHeight,
      valueLoss: levelValueLoss,
      gradientLoss: levelGradientLoss,
      edgeCount,
    });
  }
  return {
    identity: 'multiscale-luma-value-gradient-loss-v0',
    scales: [...scales],
    valueWeight,
    gradientWeight,
    valueLoss,
    gradientLoss,
    totalLoss: valueLoss + gradientLoss,
    gradient: fullGradient,
    levels,
  };
}

export function optimizeGaussianExtinctionMasses({
  basis,
  initialMasses,
  target,
  width,
  height,
  extinctionScale,
  iterations,
  learningRate,
  scales = [1, 2, 4],
  valueWeight = 1,
  gradientWeight = 1,
} = {}) {
  if (!Array.isArray(basis) || basis.length === 0 || !initialMasses || basis.length !== initialMasses.length) {
    throw new Error('optimizer requires one sparse image basis per initial Gaussian mass');
  }
  if (!target || target.length !== width * height) throw new Error('optimizer target dimensions do not match');
  if (!(extinctionScale > 0) || !Number.isFinite(extinctionScale)) throw new Error('optimizer requires positive finite extinctionScale');
  if (!Number.isInteger(iterations) || iterations <= 0) throw new Error('optimizer requires a positive integer iteration count');
  if (!(learningRate > 0) || !Number.isFinite(learningRate)) throw new Error('optimizer requires positive finite learningRate');
  const totalMass = Array.from(initialMasses).reduce((sum, value) => sum + Number(value), 0);
  if (!(totalMass > 0) || Array.from(initialMasses).some(value => !(value > 0) || !Number.isFinite(value))) {
    throw new Error('optimizer requires positive finite initial masses');
  }
  for (const item of basis) {
    if (!(item.indices instanceof Uint32Array) || !(item.values instanceof Float32Array) || item.indices.length !== item.values.length) {
      throw new Error('optimizer sparse basis entries require matched Uint32 indices and Float32 values');
    }
    if (item.indices.some(index => index >= target.length) || item.values.some(value => !(value >= 0) || !Number.isFinite(value))) {
      throw new Error('optimizer sparse basis contains an invalid pixel or contribution');
    }
  }
  const logMasses = Float64Array.from(initialMasses, value => Math.log(value));
  const masses = Float64Array.from(initialMasses);
  const firstMoment = new Float64Array(masses.length);
  const secondMoment = new Float64Array(masses.length);
  const checkpoints = [];
  const evaluate = (withGradient) => {
    const depth = new Float64Array(target.length);
    for (let gaussianIndex = 0; gaussianIndex < basis.length; gaussianIndex += 1) {
      const item = basis[gaussianIndex];
      const mass = masses[gaussianIndex];
      for (let itemIndex = 0; itemIndex < item.indices.length; itemIndex += 1) {
        depth[item.indices[itemIndex]] += mass * item.values[itemIndex];
      }
    }
    const luma = new Float32Array(target.length);
    for (let index = 0; index < luma.length; index += 1) luma[index] = 1 - Math.exp(-extinctionScale * depth[index]);
    const structural = multiscaleStructuralLoss({ prediction: luma, target, width, height, scales, valueWeight, gradientWeight });
    if (!withGradient) return { depth, luma, structural, massGradient: null };
    const depthGradient = new Float64Array(depth.length);
    for (let index = 0; index < depth.length; index += 1) {
      depthGradient[index] = structural.gradient[index] * extinctionScale * Math.exp(-extinctionScale * depth[index]);
    }
    const massGradient = new Float64Array(masses.length);
    for (let gaussianIndex = 0; gaussianIndex < basis.length; gaussianIndex += 1) {
      const item = basis[gaussianIndex];
      let gradient = 0;
      for (let itemIndex = 0; itemIndex < item.indices.length; itemIndex += 1) {
        gradient += depthGradient[item.indices[itemIndex]] * item.values[itemIndex];
      }
      massGradient[gaussianIndex] = gradient;
    }
    return { depth, luma, structural, massGradient };
  };
  const initial = evaluate(false);
  checkpoints.push({ iteration: 0, loss: initial.structural.totalLoss });
  const beta1 = 0.9;
  const beta2 = 0.999;
  const epsilon = 1e-8;
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const current = evaluate(true);
    for (let index = 0; index < masses.length; index += 1) {
      const gradient = current.massGradient[index] * masses[index];
      firstMoment[index] = beta1 * firstMoment[index] + (1 - beta1) * gradient;
      secondMoment[index] = beta2 * secondMoment[index] + (1 - beta2) * gradient * gradient;
      const correctedFirst = firstMoment[index] / (1 - beta1 ** iteration);
      const correctedSecond = secondMoment[index] / (1 - beta2 ** iteration);
      logMasses[index] -= learningRate * correctedFirst / (Math.sqrt(correctedSecond) + epsilon);
      masses[index] = Math.exp(Math.max(-30, Math.min(30, logMasses[index])));
    }
    const representedMass = masses.reduce((sum, value) => sum + value, 0);
    const normalization = totalMass / representedMass;
    for (let index = 0; index < masses.length; index += 1) {
      masses[index] *= normalization;
      logMasses[index] = Math.log(masses[index]);
    }
    if (iteration === iterations || iteration % Math.max(1, Math.floor(iterations / 10)) === 0) {
      checkpoints.push({ iteration, loss: evaluate(false).structural.totalLoss });
    }
  }
  const final = evaluate(false);
  return {
    identity: 'nonnegative-log-mass-adam-multiscale-structure-v0',
    iterationCount: iterations,
    hiddenIterationCapApplied: false,
    learningRate,
    extinctionScale,
    scales: [...scales],
    valueWeight,
    gradientWeight,
    totalExtinction: totalMass,
    initialLoss: initial.structural.totalLoss,
    finalLoss: final.structural.totalLoss,
    masses,
    luma: final.luma,
    checkpoints,
  };
}

function covarianceToCholesky(covariance) {
  const floor = 1e-12;
  const l00 = Math.sqrt(Math.max(floor, covariance[0]));
  const l10 = covariance[1] / l00;
  const l20 = covariance[2] / l00;
  const l11 = Math.sqrt(Math.max(floor, covariance[3] - l10 * l10));
  const l21 = (covariance[4] - l20 * l10) / l11;
  const l22 = Math.sqrt(Math.max(floor, covariance[5] - l20 * l20 - l21 * l21));
  return [Math.log(l00), l10, Math.log(l11), l20, l21, Math.log(l22)];
}

function choleskyToCovariance(parameters, offset = 0) {
  const l00 = Math.exp(parameters[offset]);
  const l10 = parameters[offset + 1];
  const l11 = Math.exp(parameters[offset + 2]);
  const l20 = parameters[offset + 3];
  const l21 = parameters[offset + 4];
  const l22 = Math.exp(parameters[offset + 5]);
  return [
    l00 * l00,
    l00 * l10,
    l00 * l20,
    l10 * l10 + l11 * l11,
    l10 * l20 + l11 * l21,
    l20 * l20 + l21 * l21 + l22 * l22,
  ];
}

function choleskyGradient(covarianceGradient, parameters, offset) {
  const l = [
    [Math.exp(parameters[offset]), 0, 0],
    [parameters[offset + 1], Math.exp(parameters[offset + 2]), 0],
    [parameters[offset + 3], parameters[offset + 4], Math.exp(parameters[offset + 5])],
  ];
  const g = [
    [covarianceGradient[0], covarianceGradient[1] / 2, covarianceGradient[2] / 2],
    [covarianceGradient[1] / 2, covarianceGradient[3], covarianceGradient[4] / 2],
    [covarianceGradient[2] / 2, covarianceGradient[4] / 2, covarianceGradient[5]],
  ];
  const dL = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let inner = 0; inner < 3; inner += 1) dL[row][column] += 2 * g[row][inner] * l[inner][column];
    }
  }
  return [
    dL[0][0] * l[0][0],
    dL[1][0],
    dL[1][1] * l[1][1],
    dL[2][0],
    dL[2][1],
    dL[2][2] * l[2][2],
  ];
}

export function optimizeGaussianGeometryMultiView({
  rows,
  views,
  iterations,
  optimizePositions = true,
  optimizeCovariances = true,
  positionLearningRate,
  covarianceLearningRate,
  maxCenterResidual,
  maxLogScaleResidual,
  maxCholeskyResidual,
  scales = [1, 2, 4],
  valueWeight = 1,
  gradientWeight = 1,
} = {}) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('geometry optimizer requires nonempty Gaussian rows');
  if (!Array.isArray(views) || views.length < 2) throw new Error('geometry optimizer requires at least two camera views');
  if (!Number.isInteger(iterations) || iterations <= 0) throw new Error('geometry optimizer requires a positive integer iteration count');
  if (!optimizePositions && !optimizeCovariances) throw new Error('geometry optimizer requires at least one enabled geometry head');
  if (!(positionLearningRate > 0) || !(covarianceLearningRate > 0)) throw new Error('geometry optimizer requires positive learning rates');
  if (!(maxCenterResidual > 0) || !(maxLogScaleResidual > 0) || !(maxCholeskyResidual > 0)) {
    throw new Error('geometry optimizer requires positive residual bounds');
  }
  const viewWeight = views.reduce((sum, view) => sum + Number(view.weight ?? 1), 0);
  if (!(viewWeight > 0)) throw new Error('geometry optimizer requires positive total view weight');
  for (const row of rows) {
    if (!Array.isArray(row.position) || row.position.length !== 3 || !row.position.every(Number.isFinite)
      || !Array.isArray(row.covariance) || row.covariance.length !== 6 || !row.covariance.every(Number.isFinite)
      || !(row.extinctionMass > 0) || !Number.isFinite(row.extinctionMass)) {
      throw new Error('geometry optimizer requires finite positions, covariances, and positive extinction masses');
    }
  }
  for (const view of views) {
    if (!view.id || !Number.isInteger(view.width) || view.width <= 0 || !Number.isInteger(view.height) || view.height <= 0
      || !view.target || view.target.length !== view.width * view.height
      || !(view.coverageScale > 0) || !(view.extinctionScale > 0)
      || !view.camera) {
      throw new Error('geometry optimizer received an incomplete camera view');
    }
  }

  const count = rows.length;
  const positions = new Float64Array(count * 3);
  const positionAnchors = new Float64Array(count * 3);
  const cholesky = new Float64Array(count * 6);
  const choleskyAnchors = new Float64Array(count * 6);
  for (let index = 0; index < count; index += 1) {
    positions.set(rows[index].position, index * 3);
    positionAnchors.set(rows[index].position, index * 3);
    const parameters = covarianceToCholesky(rows[index].covariance);
    cholesky.set(parameters, index * 6);
    choleskyAnchors.set(parameters, index * 6);
  }
  const positionFirst = new Float64Array(positions.length);
  const positionSecond = new Float64Array(positions.length);
  const choleskyFirst = new Float64Array(cholesky.length);
  const choleskySecond = new Float64Array(cholesky.length);
  const beta1 = 0.9;
  const beta2 = 0.999;
  const epsilon = 1e-8;

  const currentRows = () => rows.map((row, index) => ({
    ...row,
    position: Array.from(positions.slice(index * 3, index * 3 + 3)),
    covariance: choleskyToCovariance(cholesky, index * 6),
  }));

  const evaluate = withGradient => {
    const activeRows = currentRows();
    const positionGradient = withGradient ? new Float64Array(positions.length) : null;
    const covarianceGradient = withGradient ? new Float64Array(count * 6) : null;
    const viewLosses = [];
    let totalLoss = 0;
    for (const view of views) {
      const basisProduct = buildPerspectiveGaussianBasis({
        rows: activeRows,
        width: view.width,
        height: view.height,
        camera: view.camera,
        coverageScale: view.coverageScale,
      });
      if (basisProduct.visibleGaussianCount !== count || basisProduct.rejectedGaussianCount !== 0) {
        throw new Error(`geometry optimizer view ${view.id} rejected ${basisProduct.rejectedGaussianCount} Gaussians`);
      }
      const masses = Float64Array.from(basisProduct.basis, item => activeRows[item.gaussianIndex].extinctionMass);
      const depth = renderSparseGaussianBasis(basisProduct.basis, masses, view.width * view.height);
      const luma = Float32Array.from(depth, value => 1 - Math.exp(-view.extinctionScale * value));
      const structural = multiscaleStructuralLoss({
        prediction: luma,
        target: view.target,
        width: view.width,
        height: view.height,
        scales,
        valueWeight,
        gradientWeight,
      });
      const normalizedWeight = Number(view.weight ?? 1) / viewWeight;
      totalLoss += normalizedWeight * structural.totalLoss;
      viewLosses.push({ id: view.id, loss: structural.totalLoss, weight: Number(view.weight ?? 1) });
      if (!withGradient) continue;
      const depthGradient = new Float64Array(depth.length);
      for (let pixel = 0; pixel < depth.length; pixel += 1) {
        depthGradient[pixel] = normalizedWeight * structural.gradient[pixel]
          * view.extinctionScale * Math.exp(-view.extinctionScale * depth[pixel]);
      }
      for (const item of basisProduct.basis) {
        const gaussianIndex = item.gaussianIndex;
        const footprint = item.footprint;
        const mass = activeRows[gaussianIndex].extinctionMass;
        let meanXGradient = 0;
        let meanYGradient = 0;
        let projectedXXGradient = 0;
        let projectedXYGradient = 0;
        let projectedYYGradient = 0;
        for (let itemIndex = 0; itemIndex < item.indices.length; itemIndex += 1) {
          const pixel = item.indices[itemIndex];
          const x = pixel % view.width;
          const y = Math.floor(pixel / view.width);
          const dx = x + 0.5 - footprint.pixelX;
          const dy = y + 0.5 - footprint.pixelY;
          const ux = footprint.inverseXX * dx + footprint.inverseXY * dy;
          const uy = footprint.inverseXY * dx + footprint.inverseYY * dy;
          const common = depthGradient[pixel] * mass * item.values[itemIndex];
          meanXGradient += common * ux;
          meanYGradient += common * uy;
          projectedXXGradient += 0.5 * common * (ux * ux - footprint.inverseXX);
          projectedXYGradient += common * (ux * uy - footprint.inverseXY);
          projectedYYGradient += 0.5 * common * (uy * uy - footprint.inverseYY);
        }
        const positionOffset = gaussianIndex * 3;
        for (let axis = 0; axis < 3; axis += 1) {
          positionGradient[positionOffset + axis] += footprint.jacobian[0][axis] * meanXGradient
            + footprint.jacobian[1][axis] * meanYGradient;
        }
        const jx = footprint.jacobian[0];
        const jy = footprint.jacobian[1];
        const coverageSquared = view.coverageScale * view.coverageScale;
        const covarianceOffset = gaussianIndex * 6;
        const addCovarianceGradient = (channel, dxx, dxy, dyy) => {
          covarianceGradient[covarianceOffset + channel] += coverageSquared * (
            projectedXXGradient * dxx + projectedXYGradient * dxy + projectedYYGradient * dyy
          );
        };
        addCovarianceGradient(0, jx[0] * jx[0], jx[0] * jy[0], jy[0] * jy[0]);
        addCovarianceGradient(1, 2 * jx[0] * jx[1], jx[0] * jy[1] + jx[1] * jy[0], 2 * jy[0] * jy[1]);
        addCovarianceGradient(2, 2 * jx[0] * jx[2], jx[0] * jy[2] + jx[2] * jy[0], 2 * jy[0] * jy[2]);
        addCovarianceGradient(3, jx[1] * jx[1], jx[1] * jy[1], jy[1] * jy[1]);
        addCovarianceGradient(4, 2 * jx[1] * jx[2], jx[1] * jy[2] + jx[2] * jy[1], 2 * jy[1] * jy[2]);
        addCovarianceGradient(5, jx[2] * jx[2], jx[2] * jy[2], jy[2] * jy[2]);
      }
    }
    return { totalLoss, viewLosses, positionGradient, covarianceGradient };
  };

  const initial = evaluate(false);
  const checkpoints = [{ iteration: 0, loss: initial.totalLoss, viewLosses: initial.viewLosses }];
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const current = evaluate(true);
    if (optimizePositions) {
      for (let index = 0; index < positions.length; index += 1) {
        const gradient = current.positionGradient[index];
        positionFirst[index] = beta1 * positionFirst[index] + (1 - beta1) * gradient;
        positionSecond[index] = beta2 * positionSecond[index] + (1 - beta2) * gradient * gradient;
        const correctedFirst = positionFirst[index] / (1 - beta1 ** iteration);
        const correctedSecond = positionSecond[index] / (1 - beta2 ** iteration);
        positions[index] -= positionLearningRate * correctedFirst / (Math.sqrt(correctedSecond) + epsilon);
      }
    }
    for (let gaussianIndex = 0; gaussianIndex < count; gaussianIndex += 1) {
      const covarianceOffset = gaussianIndex * 6;
      if (optimizeCovariances) {
        const covariance = Array.from(current.covarianceGradient.slice(covarianceOffset, covarianceOffset + 6));
        const gradient = choleskyGradient(covariance, cholesky, covarianceOffset);
        for (let channel = 0; channel < 6; channel += 1) {
          const index = covarianceOffset + channel;
          choleskyFirst[index] = beta1 * choleskyFirst[index] + (1 - beta1) * gradient[channel];
          choleskySecond[index] = beta2 * choleskySecond[index] + (1 - beta2) * gradient[channel] * gradient[channel];
          const correctedFirst = choleskyFirst[index] / (1 - beta1 ** iteration);
          const correctedSecond = choleskySecond[index] / (1 - beta2 ** iteration);
          cholesky[index] -= covarianceLearningRate * correctedFirst / (Math.sqrt(correctedSecond) + epsilon);
          const residualBound = channel === 0 || channel === 2 || channel === 5
            ? maxLogScaleResidual
            : maxCholeskyResidual;
          cholesky[index] = Math.max(
            choleskyAnchors[index] - residualBound,
            Math.min(choleskyAnchors[index] + residualBound, cholesky[index]),
          );
        }
      }
      const positionOffset = gaussianIndex * 3;
      if (optimizePositions) {
        const residual = [0, 1, 2].map(axis => positions[positionOffset + axis] - positionAnchors[positionOffset + axis]);
        const residualLength = Math.hypot(...residual);
        if (residualLength > maxCenterResidual) {
          const scale = maxCenterResidual / residualLength;
          for (let axis = 0; axis < 3; axis += 1) {
            positions[positionOffset + axis] = positionAnchors[positionOffset + axis] + residual[axis] * scale;
          }
        }
      }
    }
    if (iteration === iterations || iteration % Math.max(1, Math.floor(iterations / 10)) === 0) {
      const checkpoint = evaluate(false);
      checkpoints.push({ iteration, loss: checkpoint.totalLoss, viewLosses: checkpoint.viewLosses });
    }
  }
  const final = evaluate(false);
  let maximumCenterResidualObserved = 0;
  let maximumLogScaleResidualObserved = 0;
  let maximumCholeskyResidualObserved = 0;
  for (let gaussianIndex = 0; gaussianIndex < count; gaussianIndex += 1) {
    const positionOffset = gaussianIndex * 3;
    maximumCenterResidualObserved = Math.max(maximumCenterResidualObserved, Math.hypot(
      positions[positionOffset] - positionAnchors[positionOffset],
      positions[positionOffset + 1] - positionAnchors[positionOffset + 1],
      positions[positionOffset + 2] - positionAnchors[positionOffset + 2],
    ));
    const covarianceOffset = gaussianIndex * 6;
    for (let channel = 0; channel < 6; channel += 1) {
      const residual = Math.abs(cholesky[covarianceOffset + channel] - choleskyAnchors[covarianceOffset + channel]);
      if (channel === 0 || channel === 2 || channel === 5) maximumLogScaleResidualObserved = Math.max(maximumLogScaleResidualObserved, residual);
      else maximumCholeskyResidualObserved = Math.max(maximumCholeskyResidualObserved, residual);
    }
  }
  return {
    identity: 'bounded-center-cholesky-adam-multiview-structure-v0',
    iterationCount: iterations,
    hiddenIterationCapApplied: false,
    viewCount: views.length,
    viewIds: views.map(view => view.id),
    heads: {
      position: optimizePositions ? 'enabled' : 'disabled',
      covariance: optimizeCovariances ? 'enabled' : 'disabled',
    },
    positionLearningRate,
    covarianceLearningRate,
    maxCenterResidual,
    maxLogScaleResidual,
    maxCholeskyResidual,
    maximumCenterResidual: maximumCenterResidualObserved,
    maximumLogScaleResidual: maximumLogScaleResidualObserved,
    maximumCholeskyResidual: maximumCholeskyResidualObserved,
    covarianceParameterization: 'positive-diagonal-lower-cholesky-v0',
    centerGradientAuthority: 'exact-projected-mean-jacobian-with-covariance-center-coupling-omitted-v0',
    covarianceGradientAuthority: 'exact-projected-covariance-jacobian-at-current-center-v0',
    extinctionAuthority: 'source-per-record-extinction-fixed-v0',
    scales: [...scales],
    valueWeight,
    gradientWeight,
    initialLoss: initial.totalLoss,
    finalLoss: final.totalLoss,
    initialViewLosses: initial.viewLosses,
    finalViewLosses: final.viewLosses,
    checkpoints,
    rows: currentRows(),
  };
}

function downsampleFloatImage(source, width, height, factor) {
  if (!Number.isInteger(factor) || factor <= 0) throw new Error('downsampleFactor must be a positive integer');
  if (factor === 1) return { values: Float32Array.from(source), width, height };
  const outputWidth = Math.ceil(width / factor);
  const outputHeight = Math.ceil(height / factor);
  const values = new Float32Array(outputWidth * outputHeight);
  for (let outputY = 0; outputY < outputHeight; outputY += 1) {
    for (let outputX = 0; outputX < outputWidth; outputX += 1) {
      let sum = 0;
      let count = 0;
      for (let y = outputY * factor; y < Math.min(height, (outputY + 1) * factor); y += 1) {
        for (let x = outputX * factor; x < Math.min(width, (outputX + 1) * factor); x += 1) {
          sum += source[y * width + x];
          count += 1;
        }
      }
      values[outputY * outputWidth + outputX] = sum / count;
    }
  }
  return { values, width: outputWidth, height: outputHeight };
}

function symmetricEigenbasis3x3(covariance) {
  const matrix = [
    [covariance[0], covariance[1], covariance[2]],
    [covariance[1], covariance[3], covariance[4]],
    [covariance[2], covariance[4], covariance[5]],
  ];
  const vectors = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 12; sweep += 1) {
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      const apq = matrix[p][q];
      if (Math.abs(apq) < 1e-12) continue;
      const angle = 0.5 * Math.atan2(2 * apq, matrix[q][q] - matrix[p][p]);
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      for (let row = 0; row < 3; row += 1) {
        const left = matrix[row][p];
        const right = matrix[row][q];
        matrix[row][p] = cosine * left - sine * right;
        matrix[row][q] = sine * left + cosine * right;
      }
      for (let column = 0; column < 3; column += 1) {
        const left = matrix[p][column];
        const right = matrix[q][column];
        matrix[p][column] = cosine * left - sine * right;
        matrix[q][column] = sine * left + cosine * right;
      }
      for (let row = 0; row < 3; row += 1) {
        const left = vectors[row][p];
        const right = vectors[row][q];
        vectors[row][p] = cosine * left - sine * right;
        vectors[row][q] = sine * left + cosine * right;
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

function optimizedSupportDiagnostics(rows, bounds) {
  if (!bounds?.minimum || !bounds?.maximum) throw new Error('optimized geometry requires world-space bounds for support diagnostics');
  let leaking = 0;
  let maxThreeSigmaDiameter = 0;
  for (const row of rows) {
    const eigen = symmetricEigenbasis3x3(row.covariance);
    const majorRadius = Math.sqrt(Math.max(...eigen.values));
    maxThreeSigmaDiameter = Math.max(maxThreeSigmaDiameter, majorRadius * 6);
    const outside = row.position.some((component, axis) => (
      component - majorRadius * 3 < bounds.minimum[axis]
      || component + majorRadius * 3 > bounds.maximum[axis]
    ));
    if (outside) leaking += 1;
  }
  return {
    authority: 'optimized-world-space-three-sigma-bounds-v0',
    bounds,
    supportLeakageGaussianCount: leaking,
    supportLeakageFraction: rows.length ? leaking / rows.length : 0,
    maxThreeSigmaDiameter,
  };
}

export async function optimizeSmokeGaussianGeometryProduct({
  sourceFitReportPath,
  views,
  outDir,
  budget,
  downsampleFactor = 1,
  coverageScale = 1.5,
  extinctionScale = 0.2,
  iterations = 40,
  optimizePositions = true,
  optimizeCovariances = true,
  positionLearningRate = 0.005,
  covarianceLearningRate = 0.002,
  maxCenterResidual = 0.04,
  maxLogScaleResidual = 0.35,
  maxCholeskyResidual = 0.02,
  scales = [1, 2, 4],
  valueWeight = 1,
  gradientWeight = 1,
} = {}) {
  if (!outDir) throw new Error('geometry product outDir is required');
  await mkdir(outDir, { recursive: true });
  const reportPath = join(outDir, 'geometry-optimization-report.json');
  let failurePhase = 'validate-source';
  let lastTrustworthyEvidence = null;
  try {
    if (!sourceFitReportPath) throw new Error('geometry product requires sourceFitReportPath');
    if (!Array.isArray(views) || views.length < 2) throw new Error('geometry product requires at least two view inputs');
    const requestedBudget = Number(budget);
    if (!Number.isInteger(requestedBudget) || requestedBudget <= 0) throw new Error('geometry product requires a positive integer budget');
    if (!Number.isInteger(downsampleFactor) || downsampleFactor <= 0) throw new Error('geometry product downsampleFactor must be a positive integer');
    const absoluteSourceFitPath = resolve(sourceFitReportPath);
    const sourceFitBytes = await readFile(absoluteSourceFitPath);
    const sourceFit = JSON.parse(sourceFitBytes.toString('utf8'));
    validateTeacher(sourceFit, 'native-camera');
    const sourceEntry = sourceFit.budgetCurve?.find(entry => entry.requestedBudget === requestedBudget);
    if (!sourceEntry || sourceEntry.activeGaussianCount !== requestedBudget) {
      throw new Error(`geometry product lacks exact uncapped source budget ${requestedBudget}`);
    }
    if (sourceEntry.extinctionAccounting?.relativeError > 1e-5) throw new Error('geometry source product does not conserve extinction');
    const sourceLoaded = await loadRows(absoluteSourceFitPath, sourceEntry);
    lastTrustworthyEvidence = {
      sourceFitReportPath: absoluteSourceFitPath,
      sourceFitReportIdentity: `sha256:${sha256(sourceFitBytes)}`,
      sourceArtifactPath: sourceLoaded.artifactPath,
      sourceArtifactIdentity: sourceLoaded.artifactIdentity,
      activeGaussianCount: sourceLoaded.rows.length,
      fluidIdentity: sourceFit.teacher.fluidIdentity,
    };

    failurePhase = 'validate-views';
    const seenViewIds = new Set();
    const seenCameraIdentities = new Set();
    const optimizerViews = [];
    const viewReceipts = [];
    for (const view of views) {
      if (!view?.id || seenViewIds.has(view.id)) throw new Error(`duplicate or missing geometry view id ${view?.id || '(missing)'}`);
      seenViewIds.add(view.id);
      const absoluteFitPath = resolve(view.fitReportPath);
      const fitBytes = await readFile(absoluteFitPath);
      const fit = JSON.parse(fitBytes.toString('utf8'));
      validateTeacher(fit, 'native-camera');
      const cameraIdentity = fit.teacher.cameraIdentity;
      if (seenCameraIdentities.has(cameraIdentity)) throw new Error(`duplicate geometry camera identity ${cameraIdentity}`);
      seenCameraIdentities.add(cameraIdentity);
      if (fit.teacher.fluidIdentity !== sourceFit.teacher.fluidIdentity) throw new Error(`geometry view ${view.id} fluid identity mismatch`);
      const entry = fit.budgetCurve?.find(item => item.requestedBudget === requestedBudget);
      if (!entry || entry.activeGaussianCount !== requestedBudget) throw new Error(`geometry view ${view.id} lacks exact budget ${requestedBudget}`);
      const loaded = await loadRows(absoluteFitPath, entry);
      if (loaded.artifactIdentity !== sourceLoaded.artifactIdentity) throw new Error(`geometry view ${view.id} Gaussian product identity mismatch`);

      const absoluteTeacherPath = resolve(view.teacherReportPath);
      const teacherBytes = await readFile(absoluteTeacherPath);
      const teacher = JSON.parse(teacherBytes.toString('utf8'));
      if (teacher.schema !== 'kaminos.smoke-dense-raymarch-teacher-report.v0'
        || teacher.identity !== 'smoke-dense-state-raymarch-teacher-v0'
        || teacher.status !== 'passed' || teacher.pixelStats?.blank !== false) {
        throw new Error(`geometry view ${view.id} requires a passed nonblank dense smoke teacher`);
      }
      for (const key of ['manifestIdentity', 'fluidIdentity', 'cameraIdentity', 'effectiveRoute', 'prototypeIdentity', 'backend']) {
        const label = key === 'cameraIdentity' ? 'camera identity' : key;
        if (teacher.source?.[key] !== fit.teacher?.[key]) throw new Error(`geometry view ${view.id} teacher ${label} mismatch`);
      }
      if (JSON.stringify(teacher.source?.camera) !== JSON.stringify(fit.teacher.camera)) {
        throw new Error(`geometry view ${view.id} teacher camera identity matrices mismatch`);
      }
      const radiance = teacher.artifacts?.linearRadiance;
      const width = Number(teacher.raymarch?.width);
      const height = Number(teacher.raymarch?.height);
      if (!radiance || radiance.dtype !== 'float32' || radiance.byteOrder !== 'little-endian'
        || !Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0
        || JSON.stringify(radiance.shape) !== JSON.stringify([height, width])) {
        throw new Error(`geometry view ${view.id} lacks compatible linear radiance dimensions`);
      }
      const radiancePath = view.teacherRadiancePath
        ? resolve(view.teacherRadiancePath)
        : resolveArtifactPath(absoluteTeacherPath, radiance.path);
      const radianceBytes = await readFile(radiancePath);
      const radianceIdentity = `sha256:${sha256(radianceBytes)}`;
      if (radianceBytes.byteLength !== radiance.byteLength || radianceIdentity !== radiance.sha256) {
        throw new Error(`geometry view ${view.id} linear radiance identity mismatch`);
      }
      const target = new Float32Array(radianceBytes.buffer, radianceBytes.byteOffset, radianceBytes.byteLength / 4);
      const downsampled = downsampleFloatImage(target, width, height, downsampleFactor);
      optimizerViews.push({
        id: view.id,
        width: downsampled.width,
        height: downsampled.height,
        camera: fit.teacher.camera,
        target: downsampled.values,
        coverageScale: Number(view.coverageScale ?? coverageScale),
        extinctionScale: Number(view.extinctionScale ?? extinctionScale),
        weight: Number(view.weight ?? 1),
      });
      viewReceipts.push({
        id: view.id,
        sourceCameraRole: fit.cameraEvaluation?.role || null,
        fitReportPath: absoluteFitPath,
        fitReportIdentity: `sha256:${sha256(fitBytes)}`,
        teacherReportPath: absoluteTeacherPath,
        teacherReportIdentity: `sha256:${sha256(teacherBytes)}`,
        requestedTeacherRadiancePath: view.teacherRadiancePath ? resolve(view.teacherRadiancePath) : radiance.path,
        teacherRadiancePath: radiancePath,
        teacherRadianceIdentity: radianceIdentity,
        cameraIdentity,
        requestedDimensions: { width, height },
        effectiveDimensions: { width: downsampled.width, height: downsampled.height },
        downsampleFactor,
        weight: Number(view.weight ?? 1),
        coverageScale: Number(view.coverageScale ?? coverageScale),
        extinctionScale: Number(view.extinctionScale ?? extinctionScale),
      });
    }

    failurePhase = 'optimize-geometry';
    const startedAt = performance.now();
    const optimized = optimizeGaussianGeometryMultiView({
      rows: sourceLoaded.rows,
      views: optimizerViews,
      iterations,
      optimizePositions,
      optimizeCovariances,
      positionLearningRate,
      covarianceLearningRate,
      maxCenterResidual,
      maxLogScaleResidual,
      maxCholeskyResidual,
      scales,
      valueWeight,
      gradientWeight,
    });
    const optimizedAt = performance.now();

    failurePhase = 'write-optimized-product';
    const sourceArtifactBytes = await readFile(sourceLoaded.artifactPath);
    const packed = Float32Array.from(new Float32Array(
      sourceArtifactBytes.buffer,
      sourceArtifactBytes.byteOffset,
      sourceArtifactBytes.byteLength / Float32Array.BYTES_PER_ELEMENT,
    ));
    const artifact = sourceEntry.artifact;
    const map = channelMap(artifact.channelOrder);
    const stride = artifact.shape[1];
    for (let gaussianIndex = 0; gaussianIndex < requestedBudget; gaussianIndex += 1) {
      const offset = gaussianIndex * stride;
      const row = optimized.rows[gaussianIndex];
      packed[offset + map.positionX] = row.position[0];
      packed[offset + map.positionY] = row.position[1];
      packed[offset + map.positionZ] = row.position[2];
      for (const [name, value] of [
        ['covXX', row.covariance[0]], ['covXY', row.covariance[1]], ['covXZ', row.covariance[2]],
        ['covYY', row.covariance[3]], ['covYZ', row.covariance[4]], ['covZZ', row.covariance[5]],
      ]) {
        if (Number.isInteger(map[name])) packed[offset + map[name]] = value;
      }
      const eigen = symmetricEigenbasis3x3(row.covariance);
      for (let axis = 0; axis < 3; axis += 1) {
        for (let component = 0; component < 3; component += 1) {
          const name = `axis${axis}${['X', 'Y', 'Z'][component]}`;
          if (Number.isInteger(map[name])) packed[offset + map[name]] = eigen.vectors[axis][component];
        }
        const radiusName = `radius${axis}`;
        if (Number.isInteger(map[radiusName])) packed[offset + map[radiusName]] = Math.sqrt(eigen.values[axis]);
      }
    }
    const optimizedArtifactPath = join(outDir, `budget-${requestedBudget}.gaussians.f32`);
    const optimizedArtifactBytes = Buffer.from(packed.buffer);
    await writeFile(optimizedArtifactPath, optimizedArtifactBytes);
    const optimizedArtifact = {
      ...artifact,
      path: optimizedArtifactPath,
      sha256: `sha256:${sha256(optimizedArtifactBytes)}`,
      byteLength: optimizedArtifactBytes.byteLength,
    };
    let representedExtinction = 0;
    for (let index = 0; index < requestedBudget; index += 1) representedExtinction += packed[index * stride + map.extinctionMass];
    const teacherExtinction = sourceFit.teacher.totalSmokeExtinction;
    const extinctionAccounting = {
      teacherTotalExtinction: teacherExtinction,
      representedExtinction,
      absoluteError: Math.abs(representedExtinction - teacherExtinction),
      relativeError: Math.abs(representedExtinction - teacherExtinction) / Math.max(teacherExtinction, 1e-12),
    };
    const support = optimizedSupportDiagnostics(optimized.rows, sourceFit.teacher.worldSpace?.bounds);
    const optimizedFit = structuredClone(sourceFit);
    optimizedFit.createdAt = new Date().toISOString();
    optimizedFit.requestedBudgets = [requestedBudget];
    optimizedFit.budgetCurve = [structuredClone(sourceEntry)];
    optimizedFit.budgetCurve[0].artifact = optimizedArtifact;
    optimizedFit.budgetCurve[0].totalAssignedExtinction = representedExtinction;
    optimizedFit.budgetCurve[0].extinctionAccounting = extinctionAccounting;
    optimizedFit.budgetCurve[0].support = support;
    optimizedFit.optimizer = {
      identity: 'direct-multiview-center-covariance-structure-optimization-v0',
      sourceOptimizer: sourceFit.optimizer,
      positionAuthority: 'bounded-multiview-image-gradient-center-residual-v0',
      covarianceAuthority: 'bounded-positive-cholesky-multiview-image-gradient-v0',
      extinctionAuthority: optimized.extinctionAuthority,
    };
    optimizedFit.geometryOptimization = {
      sourceFitReportPath: absoluteSourceFitPath,
      sourceFitReportIdentity: `sha256:${sha256(sourceFitBytes)}`,
      sourceArtifactIdentity: sourceLoaded.artifactIdentity,
      views: viewReceipts,
      optimizer: {
        identity: optimized.identity,
        heads: optimized.heads,
        iterationCount: optimized.iterationCount,
        hiddenIterationCapApplied: optimized.hiddenIterationCapApplied,
        positionLearningRate,
        covarianceLearningRate,
        maxCenterResidual,
        maxLogScaleResidual,
        maxCholeskyResidual,
        maximumCenterResidual: optimized.maximumCenterResidual,
        maximumLogScaleResidual: optimized.maximumLogScaleResidual,
        maximumCholeskyResidual: optimized.maximumCholeskyResidual,
        centerGradientAuthority: optimized.centerGradientAuthority,
        covarianceGradientAuthority: optimized.covarianceGradientAuthority,
        covarianceParameterization: optimized.covarianceParameterization,
        scales: optimized.scales,
        valueWeight,
        gradientWeight,
        initialLoss: optimized.initialLoss,
        finalLoss: optimized.finalLoss,
        initialViewLosses: optimized.initialViewLosses,
        finalViewLosses: optimized.finalViewLosses,
        checkpoints: optimized.checkpoints,
      },
    };
    const optimizedFitReportPath = join(outDir, 'oracle-fit-report.json');
    await writeFile(optimizedFitReportPath, `${JSON.stringify(optimizedFit, null, 2)}\n`);
    const report = {
      schema: 'kaminos.smoke-gaussian-oracle-multiview-geometry-optimization-report.v0',
      identity: 'smoke-gaussian-oracle-multiview-geometry-optimization-v0',
      status: 'passed',
      createdAt: new Date().toISOString(),
      source: lastTrustworthyEvidence,
      views: viewReceipts,
      budget: { requestedBudget, activeGaussianCount: requestedBudget, hiddenBudgetCapApplied: false },
      optimizer: optimizedFit.geometryOptimization.optimizer,
      hiddenIterationCapApplied: optimized.hiddenIterationCapApplied,
      extinctionAccounting,
      support,
      optimizedArtifact,
      optimizedFitReportPath,
      costs: {
        authority: 'cpu-wall-clock-performance-now-v0',
        optimizerMs: optimizedAt - startedAt,
        productBuildMs: performance.now() - optimizedAt,
        totalMs: performance.now() - startedAt,
      },
      reportPath,
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    return report;
  } catch (error) {
    const failure = {
      schema: 'kaminos.smoke-gaussian-oracle-multiview-geometry-optimization-report.v0',
      identity: 'smoke-gaussian-oracle-multiview-geometry-optimization-v0',
      status: 'failed',
      createdAt: new Date().toISOString(),
      failurePhase,
      lastTrustworthyEvidence,
      message: error?.message || String(error),
      stack: error?.stack || null,
      reportPath,
    };
    await writeFile(reportPath, `${JSON.stringify(failure, null, 2)}\n`);
    throw error;
  }
}

export async function optimizeSmokeGaussianStructureProduct({
  fitReportPath,
  teacherReportPath,
  outDir,
  budget,
  coverageScale = 1.5,
  extinctionScale = 0.008,
  iterations = 120,
  learningRate = 0.02,
  scales = [1, 2, 4, 8],
  valueWeight = 1,
  gradientWeight = 2,
} = {}) {
  if (!outDir) throw new Error('structure optimizer outDir is required');
  await mkdir(outDir, { recursive: true });
  const failureReportPath = join(outDir, 'structure-optimization-report.json');
  let lastTrustworthyEvidence = null;
  let failurePhase = 'validate-inputs';
  try {
    if (!fitReportPath || !teacherReportPath) throw new Error('structure optimizer requires fitReportPath and teacherReportPath');
    const requestedBudget = Number(budget);
    if (!Number.isInteger(requestedBudget) || requestedBudget <= 0) throw new Error('structure optimizer requires a positive integer budget');
    const absoluteFitPath = resolve(fitReportPath);
    const fitBytes = await readFile(absoluteFitPath);
    const fit = JSON.parse(fitBytes.toString('utf8'));
    validateTeacher(fit, 'native-camera');
    if (fit.cameraEvaluation?.role !== 'calibration' || !fit.cameraEvaluation.cameraId) {
      throw new Error('structure optimization requires an explicit calibration-role camera product');
    }
    const entry = fit.budgetCurve?.find(item => item.requestedBudget === requestedBudget);
    if (!entry || entry.activeGaussianCount !== requestedBudget) throw new Error(`structure optimizer lacks exact uncapped budget ${requestedBudget}`);
    if (entry.extinctionAccounting?.relativeError > 1e-5) throw new Error('source Gaussian product does not conserve extinction');
    const loaded = await loadRows(absoluteFitPath, entry);
    lastTrustworthyEvidence = {
      sourceFitReportPath: absoluteFitPath,
      sourceFitReportIdentity: `sha256:${sha256(fitBytes)}`,
      sourceArtifactPath: loaded.artifactPath,
      sourceArtifactIdentity: loaded.artifactIdentity,
      activeGaussianCount: loaded.rows.length,
    };

    failurePhase = 'validate-dense-teacher';
    const absoluteTeacherPath = resolve(teacherReportPath);
    const teacherBytes = await readFile(absoluteTeacherPath);
    const teacher = JSON.parse(teacherBytes.toString('utf8'));
    if (teacher.schema !== 'kaminos.smoke-dense-raymarch-teacher-report.v0'
      || teacher.identity !== 'smoke-dense-state-raymarch-teacher-v0'
      || teacher.status !== 'passed' || teacher.pixelStats?.blank !== false) {
      throw new Error('structure optimizer requires a passed nonblank dense smoke teacher');
    }
    for (const key of ['manifestIdentity', 'fluidIdentity', 'cameraIdentity', 'effectiveRoute', 'prototypeIdentity', 'backend']) {
      const label = key === 'cameraIdentity' ? 'camera identity' : key;
      if (teacher.source?.[key] !== fit.teacher?.[key]) throw new Error(`dense teacher ${label} does not match fit authority`);
    }
    if (JSON.stringify(teacher.source?.camera) !== JSON.stringify(fit.teacher.camera)) throw new Error('dense teacher camera does not match fit camera');
    const radiance = teacher.artifacts?.linearRadiance;
    const width = Number(teacher.raymarch?.width);
    const height = Number(teacher.raymarch?.height);
    if (!radiance || radiance.dtype !== 'float32' || radiance.byteOrder !== 'little-endian'
      || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
      || JSON.stringify(radiance.shape) !== JSON.stringify([height, width])) {
      throw new Error('dense teacher lacks compatible linear radiance dimensions');
    }
    const radiancePath = resolveArtifactPath(absoluteTeacherPath, radiance.path);
    const radianceBytes = await readFile(radiancePath);
    const radianceIdentity = `sha256:${sha256(radianceBytes)}`;
    if (radianceBytes.byteLength !== radiance.byteLength || radianceIdentity !== radiance.sha256) {
      throw new Error('dense teacher linear radiance artifact identity mismatch');
    }
    const target = new Float32Array(radianceBytes.buffer, radianceBytes.byteOffset, radianceBytes.byteLength / 4);
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      teacherReportPath: absoluteTeacherPath,
      teacherReportIdentity: `sha256:${sha256(teacherBytes)}`,
      teacherRadiancePath: radiancePath,
      teacherRadianceIdentity: radianceIdentity,
      cameraId: fit.cameraEvaluation.cameraId,
    };

    failurePhase = 'build-shared-projection-basis';
    const basisProduct = buildPerspectiveGaussianBasis({
      rows: loaded.rows,
      width,
      height,
      camera: fit.teacher.camera,
      coverageScale,
    });
    if (basisProduct.visibleGaussianCount !== requestedBudget || basisProduct.rejectedGaussianCount !== 0) {
      throw new Error(`structure optimizer rejected ${basisProduct.rejectedGaussianCount} source Gaussians from the train view`);
    }

    failurePhase = 'optimize-extinction-masses';
    const startedAt = performance.now();
    const initialMasses = Float64Array.from(loaded.rows, row => row.extinctionMass);
    const optimized = optimizeGaussianExtinctionMasses({
      basis: basisProduct.basis,
      initialMasses,
      target,
      width,
      height,
      extinctionScale,
      iterations,
      learningRate,
      scales,
      valueWeight,
      gradientWeight,
    });
    const optimizedAt = performance.now();

    failurePhase = 'write-optimized-product';
    const sourceArtifact = entry.artifact;
    const sourceArtifactBytes = await readFile(loaded.artifactPath);
    const packed = Float32Array.from(new Float32Array(
      sourceArtifactBytes.buffer,
      sourceArtifactBytes.byteOffset,
      sourceArtifactBytes.byteLength / Float32Array.BYTES_PER_ELEMENT,
    ));
    const massChannel = sourceArtifact.channelOrder.indexOf('extinctionMass');
    if (massChannel < 0) throw new Error('source artifact lacks extinctionMass channel');
    const stride = sourceArtifact.shape[1];
    for (let index = 0; index < requestedBudget; index += 1) packed[index * stride + massChannel] = optimized.masses[index];
    const optimizedArtifactPath = join(outDir, `budget-${requestedBudget}.gaussians.f32`);
    const optimizedArtifactBytes = Buffer.from(packed.buffer);
    await writeFile(optimizedArtifactPath, optimizedArtifactBytes);
    const optimizedArtifact = {
      ...sourceArtifact,
      path: optimizedArtifactPath,
      sha256: `sha256:${sha256(optimizedArtifactBytes)}`,
      byteLength: optimizedArtifactBytes.byteLength,
    };
    let representedExtinction = 0;
    for (let index = 0; index < requestedBudget; index += 1) {
      representedExtinction += packed[index * stride + massChannel];
    }
    const teacherExtinction = fit.teacher.totalSmokeExtinction;
    const extinctionAccounting = {
      teacherTotalExtinction: teacherExtinction,
      representedExtinction,
      absoluteError: Math.abs(representedExtinction - teacherExtinction),
      relativeError: Math.abs(representedExtinction - teacherExtinction) / Math.max(teacherExtinction, 1e-12),
    };
    const optimizedFit = structuredClone(fit);
    optimizedFit.createdAt = new Date().toISOString();
    optimizedFit.requestedBudgets = [requestedBudget];
    optimizedFit.budgetCurve = [structuredClone(entry)];
    optimizedFit.budgetCurve[0].artifact = optimizedArtifact;
    optimizedFit.budgetCurve[0].totalAssignedExtinction = representedExtinction;
    optimizedFit.budgetCurve[0].extinctionAccounting = extinctionAccounting;
    optimizedFit.optimizer = {
      identity: 'direct-image-space-extinction-mass-structure-optimization-v0',
      sourceOptimizer: fit.optimizer,
      positionAuthority: 'source-world-space-position-fixed-v0',
      covarianceAuthority: 'source-world-space-covariance-fixed-v0',
      extinctionAuthority: optimized.identity,
    };
    optimizedFit.structureOptimization = {
      sourceFitReportPath: absoluteFitPath,
      sourceFitReportIdentity: `sha256:${sha256(fitBytes)}`,
      teacherReportPath: absoluteTeacherPath,
      teacherReportIdentity: `sha256:${sha256(teacherBytes)}`,
      cameraId: fit.cameraEvaluation.cameraId,
      role: fit.cameraEvaluation.role,
      coverageScale,
      extinctionScale,
      iterationCount: optimized.iterationCount,
      hiddenIterationCapApplied: optimized.hiddenIterationCapApplied,
      scales: optimized.scales,
      valueWeight,
      gradientWeight,
      initialLoss: optimized.initialLoss,
      finalLoss: optimized.finalLoss,
      checkpoints: optimized.checkpoints,
    };
    const optimizedFitReportPath = join(outDir, 'oracle-fit-report.json');
    await writeFile(optimizedFitReportPath, `${JSON.stringify(optimizedFit, null, 2)}\n`);
    const report = {
      schema: 'kaminos.smoke-gaussian-oracle-structure-optimization-report.v0',
      identity: 'smoke-gaussian-oracle-structure-optimization-v0',
      status: 'passed',
      createdAt: new Date().toISOString(),
      source: lastTrustworthyEvidence,
      trainView: {
        cameraId: fit.cameraEvaluation.cameraId,
        role: fit.cameraEvaluation.role,
        cameraIdentity: fit.teacher.cameraIdentity,
      },
      budget: { requestedBudget, activeGaussianCount: requestedBudget, hiddenBudgetCapApplied: false },
      optimizer: {
        identity: optimized.identity,
        iterationCount: optimized.iterationCount,
        learningRate,
        scales: optimized.scales,
        valueWeight,
        gradientWeight,
        coverageScale,
        extinctionScale,
        initialLoss: optimized.initialLoss,
        finalLoss: optimized.finalLoss,
        checkpoints: optimized.checkpoints,
      },
      hiddenIterationCapApplied: optimized.hiddenIterationCapApplied,
      extinctionAccounting,
      optimizedArtifact,
      optimizedFitReportPath,
      costs: {
        authority: 'cpu-wall-clock-performance-now-v0',
        optimizerMs: optimizedAt - startedAt,
        productBuildMs: performance.now() - optimizedAt,
        totalMs: performance.now() - startedAt,
      },
      reportPath: failureReportPath,
    };
    await writeFile(failureReportPath, `${JSON.stringify(report, null, 2)}\n`);
    return report;
  } catch (error) {
    const failure = {
      schema: 'kaminos.smoke-gaussian-oracle-structure-optimization-report.v0',
      identity: 'smoke-gaussian-oracle-structure-optimization-v0',
      status: 'failed',
      createdAt: new Date().toISOString(),
      failurePhase,
      lastTrustworthyEvidence,
      message: error?.message || String(error),
      stack: error?.stack || null,
      reportPath: failureReportPath,
    };
    await writeFile(failureReportPath, `${JSON.stringify(failure, null, 2)}\n`);
    throw error;
  }
}

function compareLuma(teacher, render) {
  let mse = 0;
  let mae = 0;
  let renderActivePixels = 0;
  let teacherActivePixels = 0;
  let intersection = 0;
  let union = 0;
  let renderMean = 0;
  let teacherMean = 0;
  let nonzeroRenderPixels = 0;
  let maximumRenderLuma = 0;
  for (let index = 0; index < teacher.length; index += 1) {
    const diff = render[index] - teacher[index];
    mse += diff * diff;
    mae += Math.abs(diff);
    renderMean += render[index];
    teacherMean += teacher[index];
    if (render[index] > 0) nonzeroRenderPixels += 1;
    maximumRenderLuma = Math.max(maximumRenderLuma, render[index]);
    const renderActive = render[index] > 0.04;
    const teacherActive = teacher[index] > 0.04;
    if (renderActive) renderActivePixels += 1;
    if (teacherActive) teacherActivePixels += 1;
    if (renderActive && teacherActive) intersection += 1;
    if (renderActive || teacherActive) union += 1;
  }
  return {
    lumaMse: mse / teacher.length,
    lumaMae: mae / teacher.length,
    renderMeanLuma: renderMean / teacher.length,
    teacherMeanLuma: teacherMean / teacher.length,
    renderActivePixels,
    nonzeroRenderPixels,
    maximumRenderLuma,
    teacherActivePixels,
    activePixelIoU: union ? intersection / union : 0,
  };
}

function diffLuma(teacher, render) {
  const diff = new Float32Array(teacher.length);
  for (let index = 0; index < teacher.length; index += 1) diff[index] = Math.abs(teacher[index] - render[index]);
  return diff;
}

function makeContactSheet(images, width, height) {
  const sheet = new Uint8ClampedArray(width * 3 * height * images.length * 4);
  const sheetWidth = width * 3;
  for (let row = 0; row < images.length; row += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let column = 0; column < 3; column += 1) {
        const source = images[row][column];
        for (let x = 0; x < width; x += 1) {
          const sourceOffset = (y * width + x) * 4;
          const targetOffset = (((row * height + y) * sheetWidth) + column * width + x) * 4;
          sheet.set(source.subarray(sourceOffset, sourceOffset + 4), targetOffset);
        }
      }
    }
  }
  return { width: sheetWidth, height: height * images.length, rgba: sheet };
}

async function renderBudget({ reportPath, report, raymarch, teacherLuma, entry, budget, outDir, extinctionScales, coverageScales, projectionMode }) {
  if (entry.activeGaussianCount !== budget) throw new Error(`budget ${budget} has active count ${entry.activeGaussianCount}; refusing hidden cap/substitution`);
  if (entry.extinctionAccounting?.relativeError > 1e-5) throw new Error(`budget ${budget} does not conserve extinction`);
  const loaded = await loadRows(reportPath, entry);
  const started = performance.now();
  let best = null;
  for (const coverageScale of coverageScales) {
    const projected = projectionMode === 'native-camera'
      ? projectPerspectiveOpticalDepth(loaded.rows, raymarch.width, raymarch.height, report.teacher.camera, coverageScale)
      : projectOrthographicOpticalDepth(loaded.rows, raymarch.width, raymarch.height, report.teacher.worldSpace, coverageScale);
    for (const scale of extinctionScales) {
      const luma = lumaFromOpticalDepth(projected.opticalDepth, scale);
      const metrics = compareLuma(teacherLuma, luma);
      if (!best || metrics.lumaMse < best.metrics.lumaMse) {
        best = { scale, coverageScale, luma, metrics, projectionDiagnostics: projected.diagnostics };
      }
    }
  }
  const renderMs = performance.now() - started;
  if (best.metrics.nonzeroRenderPixels <= 0 || best.metrics.maximumRenderLuma <= 0) throw new Error(`budget ${budget} rendered blank output`);
  const renderRgba = lumaToRgba(best.luma);
  const diffRgba = lumaToRgba(diffLuma(teacherLuma, best.luma), 'diff');
  const imagePrefix = projectionMode === 'native-camera' ? 'perspective' : 'orthographic';
  const renderPngPath = join(outDir, `budget-${budget}.${imagePrefix}-render.png`);
  const diffPngPath = join(outDir, `budget-${budget}.${imagePrefix}-diff.png`);
  writeRgbaPng(renderPngPath, raymarch.width, raymarch.height, renderRgba);
  writeRgbaPng(diffPngPath, raymarch.width, raymarch.height, diffRgba);
  return {
    requestedBudget: budget,
    activeGaussianCount: entry.activeGaussianCount,
    selectedExtinctionScale: best.scale,
    selectedCoverageScale: best.coverageScale,
    scaleSweep: extinctionScales,
    coverageSweep: coverageScales,
    timing: { cpuProxyRenderMs: renderMs },
    projectionDiagnostics: best.projectionDiagnostics,
    gaussianArtifact: {
      path: loaded.artifactPath,
      identity: loaded.artifactIdentity,
    },
    metrics: best.metrics,
    support: entry.support,
    images: {
      renderPngPath,
      diffPngPath,
    },
    contactSheetRow: [raymarch.rgba, renderRgba, diffRgba],
  };
}

export async function renderSmokeGaussianOracleWitness({
  fitReportPath,
  raymarchPngPath,
  outDir,
  budgets = [32, 64, 128],
  extinctionScales = [0.0005, 0.001, 0.002, 0.004, 0.008, 0.016],
  coverageScales = [1],
  projectionMode = 'orthographic',
  inspectedNote = null,
} = {}) {
  if (!fitReportPath) throw new Error('fitReportPath is required');
  if (!raymarchPngPath) throw new Error('raymarchPngPath is required');
  if (!outDir) throw new Error('outDir is required');
  const requestedBudgets = normalizeBudgets(budgets);
  const requestedScales = normalizeScales(extinctionScales);
  const requestedCoverageScales = normalizeCoverageScales(coverageScales);
  const effectiveProjectionMode = normalizeProjectionMode(projectionMode);
  await mkdir(outDir, { recursive: true });
  const reportPath = resolve(fitReportPath);
  const report = await readJson(reportPath);
  validateTeacher(report, effectiveProjectionMode);
  const raymarchPath = resolve(raymarchPngPath);
  const raymarchBytes = await readFile(raymarchPath);
  const raymarch = parsePngRgba(raymarchBytes);
  const teacherLuma = lumaFromRgba(raymarch.rgba);
  const budgetCurve = [];
  for (const budget of requestedBudgets) {
    const entry = report.budgetCurve?.find(item => item.requestedBudget === budget);
    if (!entry) throw new Error(`static fit report lacks requested budget ${budget}`);
    budgetCurve.push(await renderBudget({
      reportPath,
      report,
      raymarch,
      teacherLuma,
      entry,
      budget,
      outDir,
      extinctionScales: requestedScales,
      coverageScales: requestedCoverageScales,
      projectionMode: effectiveProjectionMode,
    }));
  }
  const sheet = makeContactSheet(budgetCurve.map(entry => entry.contactSheetRow), raymarch.width, raymarch.height);
  const contactSheetPath = join(outDir, `${effectiveProjectionMode === 'native-camera' ? 'perspective' : 'orthographic'}-render-contact-sheet.png`);
  writeRgbaPng(contactSheetPath, sheet.width, sheet.height, sheet.rgba);
  const finalReport = {
    schema: 'kaminos.smoke-gaussian-oracle-render-witness-report.v0',
    identity: SMOKE_GAUSSIAN_ORACLE_RENDER_IDENTITY,
    status: 'passed',
    createdAt: new Date().toISOString(),
    hiddenBudgetCapApplied: false,
    fitReportPath: reportPath,
    teacher: {
      raymarchPngPath: raymarchPath,
      raymarchSha256: `sha256:${sha256(raymarchBytes)}`,
      width: raymarch.width,
      height: raymarch.height,
      effectiveRoute: report.teacher.effectiveRoute,
      prototypeIdentity: report.teacher.prototypeIdentity,
      backend: report.teacher.backend,
      worldSpace: report.teacher.worldSpace,
      cameraIdentity: report.teacher.cameraIdentity || null,
      camera: report.teacher.camera || null,
    },
    renderer: {
      identity: effectiveProjectionMode === 'native-camera'
        ? 'cpu-perspective-full-covariance-gaussian-smoke-v0'
        : 'cpu-orthographic-full-covariance-gaussian-smoke-v1',
      cameraAuthority: effectiveProjectionMode === 'native-camera'
        ? 'checksum-bound-fit-teacher-camera-v0'
        : 'orthographic-world-proxy-not-native-camera-v0',
      cameraIdentity: report.teacher.cameraIdentity || null,
      compositorAuthority: 'single-channel-smoke-luma-proxy-not-production-compositor-v0',
      projectionAuthority: effectiveProjectionMode === 'native-camera'
        ? 'full-view-projection-jacobian-covariance-v0'
        : 'exact-world-xy-covariance-line-integral-v0',
      scaleSelection: 'explicit-extinction-scale-sweep-min-luma-mse-v0',
      requestedExtinctionScales: requestedScales,
      coverageSelection: 'explicit-mass-preserving-covariance-dilation-sweep-min-luma-mse-v0',
      requestedCoverageScales,
    },
    requestedBudgets,
    budgetCurve: budgetCurve.map(({ contactSheetRow, ...entry }) => entry),
    contactSheet: {
      path: contactSheetPath,
      sha256: `sha256:${sha256(await readFile(contactSheetPath))}`,
      layout: 'columns: teacher-raymarch | gaussian-proxy-render | abs-luma-diff; rows: requested budgets',
      inspected: Boolean(inspectedNote),
      inspectionNote: inspectedNote,
    },
  };
  const outputReportPath = join(outDir, 'render-witness-report.json');
  const bytes = Buffer.from(`${JSON.stringify(finalReport, null, 2)}\n`);
  await writeFile(outputReportPath, bytes);
  finalReport.reportPath = outputReportPath;
  finalReport.reportIdentity = `sha256:${sha256(bytes)}`;
  await writeFile(outputReportPath, `${JSON.stringify(finalReport, null, 2)}\n`);
  return finalReport;
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
    } else args.set(key, true);
  }
  return args;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (args.has('--optimize-geometry')) {
    try {
      const configPath = args.get('--geometry-config');
      if (!configPath) throw new Error('--geometry-config is required for multi-view geometry optimization');
      const config = await readJson(resolve(configPath));
      const report = await optimizeSmokeGaussianGeometryProduct({
        ...config,
        outDir: args.get('--out-dir'),
      });
      console.log(JSON.stringify({
        status: report.status,
        identity: report.identity,
        reportPath: report.reportPath,
        optimizedFitReportPath: report.optimizedFitReportPath,
        budget: report.budget,
        views: report.views,
        optimizer: report.optimizer,
        extinctionAccounting: report.extinctionAccounting,
        costs: report.costs,
      }, null, 2));
    } catch (error) {
      console.error(error?.stack || error);
      process.exitCode = 1;
    }
  } else if (args.has('--optimize-structure')) {
    const structureScales = String(args.get('--structure-scales') || '1,2,4,8')
      .split(',')
      .map(value => Number(value.trim()))
      .filter(value => value || value === 0);
    try {
      const report = await optimizeSmokeGaussianStructureProduct({
        fitReportPath: args.get('--fit-report'),
        teacherReportPath: args.get('--teacher-report'),
        outDir: args.get('--out-dir'),
        budget: Number(args.get('--budget') || 1024),
        coverageScale: Number(args.get('--coverage-scale') || 1.5),
        extinctionScale: Number(args.get('--extinction-scale') || 0.008),
        iterations: Number(args.get('--iterations') || 120),
        learningRate: Number(args.get('--learning-rate') || 0.02),
        scales: structureScales,
        valueWeight: Number(args.get('--value-weight') || 1),
        gradientWeight: Number(args.get('--gradient-weight') || 2),
      });
      console.log(JSON.stringify({
        status: report.status,
        identity: report.identity,
        reportPath: report.reportPath,
        optimizedFitReportPath: report.optimizedFitReportPath,
        budget: report.budget,
        trainView: report.trainView,
        optimizer: report.optimizer,
        extinctionAccounting: report.extinctionAccounting,
        costs: report.costs,
      }, null, 2));
    } catch (error) {
      console.error(error?.stack || error);
      process.exitCode = 1;
    }
  } else {
  const budgets = String(args.get('--budgets') || '32,64,128')
    .split(',')
    .map(value => Number(value.trim()))
    .filter(value => value || value === 0);
  const extinctionScales = String(args.get('--extinction-scales') || '0.0005,0.001,0.002,0.004,0.008,0.016')
    .split(',')
    .map(value => Number(value.trim()))
    .filter(value => value || value === 0);
  const coverageScales = String(args.get('--coverage-scales') || '1')
    .split(',')
    .map(value => Number(value.trim()))
    .filter(value => value || value === 0);
  try {
    const report = await renderSmokeGaussianOracleWitness({
      fitReportPath: args.get('--fit-report'),
      raymarchPngPath: args.get('--raymarch-png'),
      outDir: args.get('--out-dir'),
      budgets,
      extinctionScales,
      coverageScales,
      projectionMode: args.get('--projection') || 'orthographic',
      inspectedNote: args.get('--inspected-note') || null,
    });
    console.log(JSON.stringify({
      status: report.status,
      identity: report.identity,
      reportPath: report.reportPath,
      contactSheet: report.contactSheet.path,
      budgets: report.budgetCurve.map(entry => ({
        budget: entry.requestedBudget,
        activeGaussianCount: entry.activeGaussianCount,
        selectedExtinctionScale: entry.selectedExtinctionScale,
        lumaMse: entry.metrics.lumaMse,
        activePixelIoU: entry.metrics.activePixelIoU,
      })),
    }, null, 2));
  } catch (error) {
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
  }
}
