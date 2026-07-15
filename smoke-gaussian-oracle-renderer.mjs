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
    if (teacher.sourceSchema !== 'kaminos.volume.operator-basin-replay.v0'
      || teacher.worldSpace?.transformAuthority !== 'operator-basin-normalized-volume-domain-v0') {
      throw new Error('native-camera rendering requires checksum-bound held replay world-space authority');
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

function projectPerspectiveOpticalDepth(rows, width, height, camera, coverageScale) {
  const opticalDepth = new Float32Array(width * height);
  const contributorCounts = new Uint32Array(width * height);
  const peakContributions = new Float32Array(width * height);
  const varianceFloor = 1 / 12;
  const projectedRows = rows.map(row => ({
    ...row,
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
    for (let y = minY; y <= maxY; y += 1) {
      const dy = y + 0.5 - footprint.pixelY;
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x + 0.5 - footprint.pixelX;
        const mahalanobisSquared = footprint.inverseXX * dx * dx
          + 2 * footprint.inverseXY * dx * dy
          + footprint.inverseYY * dy * dy;
        if (mahalanobisSquared > 32) continue;
        const contribution = row.extinctionMass * footprint.normalization * Math.exp(-0.5 * mahalanobisSquared);
        const index = y * width + x;
        opticalDepth[index] += contribution;
        peakContributions[index] = Math.max(peakContributions[index], contribution);
        if (mahalanobisSquared <= 16) contributorCounts[index] += 1;
      }
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
  const determinants = footprints.map(row => row.footprint.determinant);
  return {
    opticalDepth,
    diagnostics: {
      identity: 'perspective-full-covariance-overlap-diagnostics-v0',
      coverageScale,
      requestedGaussianCount: rows.length,
      visibleGaussianCount: footprints.length,
      rejectedGaussianCount: rows.length - footprints.length,
      rejectionReasons: Object.fromEntries(projectedRows
        .filter(row => !row.footprint.visible)
        .reduce((counts, row) => counts.set(row.footprint.rejectionReason, (counts.get(row.footprint.rejectionReason) || 0) + 1), new Map())),
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

function compareLuma(teacher, render) {
  let mse = 0;
  let mae = 0;
  let renderActivePixels = 0;
  let teacherActivePixels = 0;
  let intersection = 0;
  let union = 0;
  let renderMean = 0;
  let teacherMean = 0;
  for (let index = 0; index < teacher.length; index += 1) {
    const diff = render[index] - teacher[index];
    mse += diff * diff;
    mae += Math.abs(diff);
    renderMean += render[index];
    teacherMean += teacher[index];
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
  if (best.metrics.renderActivePixels <= 0) throw new Error(`budget ${budget} rendered blank output`);
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
