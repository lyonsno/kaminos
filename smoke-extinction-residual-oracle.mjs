import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KAMINOS_FLUID_CHANNEL_ORDER } from './smoke-splat-field-hierarchy.mjs';

export const KAMINOS_SMOKE_EXTINCTION_CHANNEL_ORDER = Object.freeze([
  'physicalExtinction', 'coverage', 'ridge', 'residualExtinction',
]);

const ORACLE_SCHEMA = 'kaminos.smoke-extinction-residual-oracle.v0';
const ORACLE_AUTHORITY = 'exact-fluid-extinction-neighborhood-residual-oracle-v0';
const STATIC_FIT_SCHEMA = 'kaminos.smoke-gaussian-oracle-static-fit-report.v0';
const STATIC_FIT_IDENTITY = 'smoke-gaussian-oracle-static-fit-v0';
const EXPECTED_EXPORT_SCHEMA = 'kaminos.volume.full-grid-field-export.v0';
const EXPECTED_EXPORT_IDENTITY = 'full-grid-fluid-front-boundary-sidecars-v0';
const EXPECTED_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const EXPECTED_PROTOTYPE = 'kaminos-volume-prototype-v0';
const BODY_SMOKE_COEFFICIENT = 0.74;
const MICRO_SMOKE_COEFFICIENT = 0.42;
const INTERFACE_SHRED_COEFFICIENT = 0.34;
const MATERIAL_DETAIL_COEFFICIENT = 0.12;
const MASS_TOLERANCE = 1e-5;
const RESIDUAL_GEOMETRIES = new Set(['diagonal-covariance-v0', 'full-covariance-v0']);

const GAUSSIAN_CHANNEL_ORDER = Object.freeze([
  'positionX', 'positionY', 'positionZ',
  'covXX', 'covXY', 'covXZ', 'covYY', 'covYZ', 'covZZ',
  'axis0X', 'axis0Y', 'axis0Z',
  'axis1X', 'axis1Y', 'axis1Z',
  'axis2X', 'axis2Y', 'axis2Z',
  'radius0', 'radius1', 'radius2',
  'extinctionMass', 'densityWitness', 'temperatureWitness',
  'velocityX', 'velocityY', 'velocityZ', 'sourceVoxelCount',
]);

const CHANNEL = Object.freeze(Object.fromEntries(KAMINOS_FLUID_CHANNEL_ORDER.map((name, index) => [name, index])));

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function positiveInteger(value, label) {
  const number = finite(value, label);
  if (!Number.isInteger(number) || number <= 0) throw new TypeError(`${label} must be a positive integer`);
  return number;
}

function normalizeCamera(camera) {
  if (camera == null) return null;
  const normalized = {};
  for (const [field, length] of [['position', 3], ['target', 3], ['projectionMatrix', 16], ['matrixWorldInverse', 16]]) {
    if (!Array.isArray(camera[field]) || camera[field].length !== length) throw new Error(`source camera ${field} must contain ${length} values`);
    normalized[field] = camera[field].map((value, index) => finite(value, `source camera ${field} ${index}`));
  }
  return normalized;
}

function assertChannelOrder(channelOrder) {
  if (!Array.isArray(channelOrder) || channelOrder.length !== KAMINOS_FLUID_CHANNEL_ORDER.length) {
    throw new Error('fluid channel order mismatch');
  }
  for (let index = 0; index < KAMINOS_FLUID_CHANNEL_ORDER.length; index += 1) {
    if (channelOrder[index] !== KAMINOS_FLUID_CHANNEL_ORDER[index]) {
      throw new Error(`fluid channel order mismatch at ${index}: expected ${KAMINOS_FLUID_CHANNEL_ORDER[index]}, got ${channelOrder[index]}`);
    }
  }
}

function validateControlRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new TypeError('controlRows must be a non-empty array');
  return rows.map((row, index) => {
    if (!row || typeof row !== 'object') throw new TypeError(`control row ${index} must be an object`);
    const position = row.position?.map((value, axis) => finite(value, `control row ${index} position ${axis}`));
    const covariance = row.covariance?.map((value, component) => finite(value, `control row ${index} covariance ${component}`));
    if (position?.length !== 3 || covariance?.length !== 6) throw new TypeError(`control row ${index} geometry is incomplete`);
    const mass = finite(row.extinctionMass, `control row ${index} extinctionMass`);
    if (mass < 0) throw new RangeError(`control row ${index} extinctionMass must be non-negative`);
    return structuredClone({
      ...row,
      position,
      covariance,
      extinctionMass: mass,
      orientation: row.orientation || [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      radii: row.radii || [Math.sqrt(covariance[0]), Math.sqrt(covariance[3]), Math.sqrt(covariance[5])],
      densityWitness: finite(row.densityWitness ?? 0, `control row ${index} densityWitness`),
      temperatureWitness: finite(row.temperatureWitness ?? 0, `control row ${index} temperatureWitness`),
      velocityWitness: (row.velocityWitness || [0, 0, 0]).map((value, axis) => finite(value, `control row ${index} velocity ${axis}`)),
      sourceVoxelCount: finite(row.sourceVoxelCount ?? 0, `control row ${index} sourceVoxelCount`),
    });
  });
}

function relativeError(actual, expected) {
  return Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-12);
}

function residualGeometryIdentity(value) {
  const identity = String(value || 'diagonal-covariance-v0');
  if (!RESIDUAL_GEOMETRIES.has(identity)) throw new Error(`unsupported residual geometry: ${identity}`);
  return identity;
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
      const offDiagonal = matrix[p][q];
      if (Math.abs(offDiagonal) < 1e-12) continue;
      const angle = 0.5 * Math.atan2(2 * offDiagonal, matrix[q][q] - matrix[p][p]);
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

function index3(x, y, z, grid) {
  return x + y * grid + z * grid * grid;
}

function clampedIndex(x, grid) {
  return Math.max(0, Math.min(grid - 1, x));
}

function supportSidecar({ field, grid }) {
  const cellCount = grid ** 3;
  const physical = new Float64Array(cellCount);
  const residual = new Float64Array(cellCount);
  let smokeDensityMass = 0;
  let physicalExtinctionMass = 0;
  let residualExtinctionMass = 0;
  for (let cell = 0; cell < cellCount; cell += 1) {
    const offset = cell * KAMINOS_FLUID_CHANNEL_ORDER.length;
    const smokeDensity = Math.max(0, finite(field[offset + CHANNEL.smokeDensity], `cell ${cell} smokeDensity`));
    const materialDetail = Math.max(0, finite(field[offset + CHANNEL.detail], `cell ${cell} detail`));
    const microSmoke = Math.max(0, finite(field[offset + CHANNEL.microdetail], `cell ${cell} microdetail`));
    const interfaceShred = Math.max(0, finite(field[offset + CHANNEL.interfaceShred], `cell ${cell} interfaceShred`));
    const residualValue = MICRO_SMOKE_COEFFICIENT * microSmoke
      + INTERFACE_SHRED_COEFFICIENT * interfaceShred
      + MATERIAL_DETAIL_COEFFICIENT * materialDetail;
    const physicalValue = BODY_SMOKE_COEFFICIENT * smokeDensity + residualValue;
    smokeDensityMass += smokeDensity;
    residualExtinctionMass += residualValue;
    physicalExtinctionMass += physicalValue;
    physical[cell] = physicalValue;
    residual[cell] = residualValue;
  }

  const values = new Float32Array(cellCount * KAMINOS_SMOKE_EXTINCTION_CHANNEL_ORDER.length);
  for (let z = 0; z < grid; z += 1) {
    for (let y = 0; y < grid; y += 1) {
      for (let x = 0; x < grid; x += 1) {
        const cell = index3(x, y, z, grid);
        const center = physical[cell];
        const px = physical[index3(clampedIndex(x + 1, grid), y, z, grid)];
        const nx = physical[index3(clampedIndex(x - 1, grid), y, z, grid)];
        const py = physical[index3(x, clampedIndex(y + 1, grid), z, grid)];
        const ny = physical[index3(x, clampedIndex(y - 1, grid), z, grid)];
        const pz = physical[index3(x, y, clampedIndex(z + 1, grid), grid)];
        const nz = physical[index3(x, y, clampedIndex(z - 1, grid), grid)];
        const coverage = Math.max(center, px, nx, py, ny, pz, nz);
        const gradient = 0.5 * Math.hypot(px - nx, py - ny, pz - nz);
        const laplacian = Math.abs(px + nx + py + ny + pz + nz - 6 * center) / 6;
        const offset = cell * KAMINOS_SMOKE_EXTINCTION_CHANNEL_ORDER.length;
        values[offset] = center;
        values[offset + 1] = coverage;
        values[offset + 2] = gradient + laplacian;
        values[offset + 3] = residual[cell];
      }
    }
  }
  return { values, physical, residual, smokeDensityMass, physicalExtinctionMass, residualExtinctionMass };
}

function residualRows({ field, residual, grid, residualBlockSize, residualGeometry }) {
  const rows = [];
  const cellWidth = 2 / grid;
  const voxelVariance = cellWidth * cellWidth / 12;
  for (let bz = 0; bz < grid; bz += residualBlockSize) {
    for (let by = 0; by < grid; by += residualBlockSize) {
      for (let bx = 0; bx < grid; bx += residualBlockSize) {
        let mass = 0;
        let sourceVoxelCount = 0;
        const first = [0, 0, 0];
        const second = [0, 0, 0, 0, 0, 0];
        const velocity = [0, 0, 0];
        let densityMass = 0;
        let heatMass = 0;
        for (let z = bz; z < bz + residualBlockSize; z += 1) {
          for (let y = by; y < by + residualBlockSize; y += 1) {
            for (let x = bx; x < bx + residualBlockSize; x += 1) {
              const cell = index3(x, y, z, grid);
              const weight = residual[cell];
              if (!(weight > 0)) continue;
              const position = [x, y, z].map(component => -1 + (component + 0.5) * cellWidth);
              const offset = cell * KAMINOS_FLUID_CHANNEL_ORDER.length;
              mass += weight;
              sourceVoxelCount += 1;
              for (let axis = 0; axis < 3; axis += 1) {
                first[axis] += position[axis] * weight;
                velocity[axis] += field[offset + axis] * weight;
              }
              second[0] += position[0] * position[0] * weight;
              second[1] += position[0] * position[1] * weight;
              second[2] += position[0] * position[2] * weight;
              second[3] += position[1] * position[1] * weight;
              second[4] += position[1] * position[2] * weight;
              second[5] += position[2] * position[2] * weight;
              densityMass += field[offset + CHANNEL.smokeDensity] * weight;
              heatMass += field[offset + CHANNEL.heat] * weight;
            }
          }
        }
        if (!(mass > 0)) continue;
        const position = first.map(value => value / mass);
        const covariance = [
          Math.max(voxelVariance, second[0] / mass - position[0] * position[0] + voxelVariance),
          residualGeometry === 'full-covariance-v0' ? second[1] / mass - position[0] * position[1] : 0,
          residualGeometry === 'full-covariance-v0' ? second[2] / mass - position[0] * position[2] : 0,
          Math.max(voxelVariance, second[3] / mass - position[1] * position[1] + voxelVariance),
          residualGeometry === 'full-covariance-v0' ? second[4] / mass - position[1] * position[2] : 0,
          Math.max(voxelVariance, second[5] / mass - position[2] * position[2] + voxelVariance),
        ];
        const eigen = residualGeometry === 'full-covariance-v0' ? symmetricEigenbasis3x3(covariance) : null;
        rows.push({
          position,
          covariance,
          orientation: eigen?.vectors || [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
          radii: eigen?.values.map(Math.sqrt) || [Math.sqrt(covariance[0]), Math.sqrt(covariance[3]), Math.sqrt(covariance[5])],
          extinctionMass: mass,
          densityWitness: densityMass / mass,
          temperatureWitness: heatMass / mass,
          velocityWitness: velocity.map(value => value / mass),
          sourceVoxelCount,
          residualBlock: [bx / residualBlockSize, by / residualBlockSize, bz / residualBlockSize],
        });
      }
    }
  }
  return rows;
}

export function buildSmokeExtinctionResidualOracle(request = {}) {
  if (request.maxCandidates !== undefined || request.capacity !== undefined) {
    throw new Error('candidate cap is forbidden for the uncapped residual oracle');
  }
  const grid = positiveInteger(request.grid, 'grid');
  assertChannelOrder(request.channelOrder);
  if (!(request.field instanceof Float32Array)) throw new TypeError('field must be a Float32Array');
  const expectedLength = grid ** 3 * KAMINOS_FLUID_CHANNEL_ORDER.length;
  if (request.field.length !== expectedLength) throw new Error(`field length ${request.field.length} does not match ${expectedLength}`);
  const residualBlockSize = positiveInteger(request.residualBlockSize ?? 2, 'residualBlockSize');
  const residualGeometry = residualGeometryIdentity(request.residualGeometry);
  if (grid % residualBlockSize !== 0) throw new Error(`residualBlockSize must divide grid ${grid}`);
  const controlRows = validateControlRows(request.controlRows);
  const sidecar = supportSidecar({ field: request.field, grid });
  const controlSmokeDensityMass = controlRows.reduce((sum, row) => sum + row.extinctionMass, 0);
  if (relativeError(controlSmokeDensityMass, sidecar.smokeDensityMass) > MASS_TOLERANCE) {
    throw new Error(`control smoke mass ${controlSmokeDensityMass} does not match source smoke mass ${sidecar.smokeDensityMass}`);
  }
  const coarseRows = controlRows.map(row => ({ ...row, extinctionMass: row.extinctionMass * BODY_SMOKE_COEFFICIENT }));
  const detailRows = residualRows({ field: request.field, residual: sidecar.residual, grid, residualBlockSize, residualGeometry });
  const coarseExtinctionMass = coarseRows.reduce((sum, row) => sum + row.extinctionMass, 0);
  const representedResidualMass = detailRows.reduce((sum, row) => sum + row.extinctionMass, 0);
  const combinedExtinctionMass = coarseExtinctionMass + representedResidualMass;
  const combinedRelativeError = relativeError(combinedExtinctionMass, sidecar.physicalExtinctionMass);
  if (combinedRelativeError > MASS_TOLERANCE) throw new Error(`combined physical extinction accounting mismatch ${combinedRelativeError}`);
  return {
    schema: ORACLE_SCHEMA,
    authority: ORACLE_AUTHORITY,
    hiddenCandidateCapApplied: false,
    residualBlockSize,
    residualGeometry,
    sidecar: {
      shape: [grid, grid, grid, KAMINOS_SMOKE_EXTINCTION_CHANNEL_ORDER.length],
      channelOrder: [...KAMINOS_SMOKE_EXTINCTION_CHANNEL_ORDER],
      values: sidecar.values,
      neighborhoodAuthority: 'center-plus-six-axis-neighbors-clamped-domain-v0',
      ridgeAuthority: 'central-gradient-plus-normalized-absolute-laplacian-v0',
    },
    coarseRows,
    residualRows: detailRows,
    combinedRows: [...coarseRows, ...detailRows],
    accounting: {
      authority: 'physical-extinction-component-sum-v0',
      coefficients: {
        smokeDensity: BODY_SMOKE_COEFFICIENT,
        microSmoke: MICRO_SMOKE_COEFFICIENT,
        interfaceShred: INTERFACE_SHRED_COEFFICIENT,
        materialDetail: MATERIAL_DETAIL_COEFFICIENT,
      },
      controlSmokeDensityMass,
      sourceSmokeDensityMass: sidecar.smokeDensityMass,
      coarseExtinctionMass,
      residualExtinctionMass: sidecar.residualExtinctionMass,
      representedResidualMass,
      physicalExtinctionMass: sidecar.physicalExtinctionMass,
      combinedExtinctionMass,
      combinedRelativeError,
      residualCandidateCount: detailRows.length,
      residualCandidateCountAuthority: 'all-positive-explicit-blocks-no-cap-v0',
      residualGeometry,
    },
  };
}

function resolveArtifactPath(anchorPath, artifactPath) {
  if (isAbsolute(artifactPath)) return artifactPath;
  const cwdPath = resolve(artifactPath);
  if (existsSync(cwdPath)) return cwdPath;
  return resolve(dirname(anchorPath), artifactPath);
}

function gaussianChannelMap(order) {
  const map = Object.fromEntries(order.map((name, index) => [name, index]));
  for (const channel of GAUSSIAN_CHANNEL_ORDER) {
    if (!Number.isInteger(map[channel])) throw new Error(`control artifact lacks ${channel}`);
  }
  return map;
}

function decodeControlRows(bytes, descriptor) {
  if (descriptor.dtype !== 'float32' || descriptor.byteOrder !== 'little-endian') throw new Error('control artifact encoding mismatch');
  if (!Array.isArray(descriptor.shape) || descriptor.shape.length !== 2 || descriptor.shape[1] !== GAUSSIAN_CHANNEL_ORDER.length) {
    throw new Error('control artifact shape mismatch');
  }
  if (bytes.byteLength !== descriptor.byteLength) throw new Error('control artifact byte length mismatch');
  const map = gaussianChannelMap(descriptor.channelOrder);
  const values = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const rows = [];
  for (let index = 0; index < descriptor.shape[0]; index += 1) {
    const offset = index * descriptor.shape[1];
    rows.push({
      position: [values[offset + map.positionX], values[offset + map.positionY], values[offset + map.positionZ]],
      covariance: [
        values[offset + map.covXX], values[offset + map.covXY], values[offset + map.covXZ],
        values[offset + map.covYY], values[offset + map.covYZ], values[offset + map.covZZ],
      ],
      orientation: [
        [values[offset + map.axis0X], values[offset + map.axis0Y], values[offset + map.axis0Z]],
        [values[offset + map.axis1X], values[offset + map.axis1Y], values[offset + map.axis1Z]],
        [values[offset + map.axis2X], values[offset + map.axis2Y], values[offset + map.axis2Z]],
      ],
      radii: [values[offset + map.radius0], values[offset + map.radius1], values[offset + map.radius2]],
      extinctionMass: values[offset + map.extinctionMass],
      densityWitness: values[offset + map.densityWitness],
      temperatureWitness: values[offset + map.temperatureWitness],
      velocityWitness: [values[offset + map.velocityX], values[offset + map.velocityY], values[offset + map.velocityZ]],
      sourceVoxelCount: values[offset + map.sourceVoxelCount],
    });
  }
  return rows;
}

function encodeRows(rows) {
  const values = new Float32Array(rows.length * GAUSSIAN_CHANNEL_ORDER.length);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const flat = [
      ...row.position,
      ...row.covariance,
      ...row.orientation[0], ...row.orientation[1], ...row.orientation[2],
      ...row.radii,
      row.extinctionMass, row.densityWitness, row.temperatureWitness,
      ...row.velocityWitness, row.sourceVoxelCount,
    ];
    values.set(flat, index * GAUSSIAN_CHANNEL_ORDER.length);
  }
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength);
}

async function writeRoleProduct({ outDir, role, rows, teacher, targetMass, residualGeometry }) {
  const artifactName = `${role}.gaussians.f32`;
  const artifactPath = join(outDir, artifactName);
  const bytes = encodeRows(rows);
  await writeFile(artifactPath, bytes);
  const serialized = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const massChannel = GAUSSIAN_CHANNEL_ORDER.indexOf('extinctionMass');
  let representedExtinction = 0;
  for (let index = 0; index < rows.length; index += 1) representedExtinction += serialized[index * GAUSSIAN_CHANNEL_ORDER.length + massChannel];
  const accounting = {
    teacherTotalExtinction: targetMass,
    representedExtinction,
    absoluteError: Math.abs(representedExtinction - targetMass),
    relativeError: relativeError(representedExtinction, targetMass),
  };
  const descriptor = {
    path: artifactName,
    sha256: `sha256:${sha256(bytes)}`,
    byteLength: bytes.byteLength,
    dtype: 'float32',
    byteOrder: 'little-endian',
    shape: [rows.length, GAUSSIAN_CHANNEL_ORDER.length],
    channelOrder: [...GAUSSIAN_CHANNEL_ORDER],
  };
  const fit = {
    schema: STATIC_FIT_SCHEMA,
    identity: STATIC_FIT_IDENTITY,
    status: 'passed',
    createdAt: new Date().toISOString(),
    hiddenBudgetCapApplied: false,
    teacher: { ...teacher, totalSmokeExtinction: targetMass },
    requestedBudgets: [rows.length],
    optimizer: {
      identity: 'fixed-coarse-plus-uncapped-local-extinction-residual-oracle-v0',
      sampleSelectionAuthority: 'all-positive-explicit-blocks-no-subsampling-v0',
      role,
      residualGeometry,
    },
    warmStart: null,
    costs: { authority: 'producer-report-only-v0' },
    budgetCurve: [{
      requestedBudget: rows.length,
      activeGaussianCount: rows.length,
      iterationCount: 0,
      totalAssignedExtinction: representedExtinction,
      extinctionAccounting: accounting,
      support: {
        supportLeakageGaussianCount: null,
        supportLeakageFraction: null,
        authority: 'not-evaluated-by-product-writer-v0',
      },
      artifact: descriptor,
      preview: rows.slice(0, 8),
    }],
  };
  const fitPath = join(outDir, `${role}.fit-report.json`);
  await writeFile(fitPath, `${JSON.stringify(fit, null, 2)}\n`);
  return { role, count: rows.length, targetMass, representedExtinction, accounting, descriptor, fitPath };
}

async function loadInputs(options, progress) {
  const manifestPath = resolve(options.manifestPath);
  const controlReportPath = resolve(options.controlReportPath);
  progress.lastTrustworthyEvidence = { manifestPath, controlReportPath };
  const manifestBytes = await readFile(manifestPath);
  const controlReportBytes = await readFile(controlReportPath);
  if (!options.expectedManifestSha256 || sha256(manifestBytes) !== options.expectedManifestSha256.replace(/^sha256:/, '')) {
    throw new Error('source manifest sha256 mismatch or missing expectation');
  }
  if (!options.expectedControlReportSha256 || sha256(controlReportBytes) !== options.expectedControlReportSha256.replace(/^sha256:/, '')) {
    throw new Error('control report sha256 mismatch or missing expectation');
  }
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const controlReport = JSON.parse(controlReportBytes.toString('utf8'));
  progress.lastTrustworthyEvidence = {
    manifestPath,
    manifestSha256: `sha256:${sha256(manifestBytes)}`,
    controlReportPath,
    controlReportSha256: `sha256:${sha256(controlReportBytes)}`,
    effectiveRoute: manifest.effectiveRoute || null,
    prototypeIdentity: manifest.prototypeIdentity || null,
    backend: manifest.backend || null,
  };
  if (manifest.schema !== EXPECTED_EXPORT_SCHEMA || manifest.identity !== EXPECTED_EXPORT_IDENTITY || manifest.status !== 'captured') {
    throw new Error('source manifest identity mismatch');
  }
  if (manifest.effectiveRoute !== EXPECTED_ROUTE || manifest.prototypeIdentity !== EXPECTED_PROTOTYPE) throw new Error('source route identity mismatch');
  if (typeof manifest.backend !== 'string' || !manifest.backend.startsWith('WebGPU:')) throw new Error('source backend identity mismatch');
  assertChannelOrder(manifest.fluidChannelOrder);
  const fluid = manifest.sidecars?.fluid;
  if (!fluid || fluid.shape?.join(',') !== [manifest.grid, manifest.grid, manifest.grid, 16].join(',')) throw new Error('fluid sidecar shape mismatch');
  assertChannelOrder(fluid.channelOrder);
  const fluidPath = resolveArtifactPath(manifestPath, fluid.path);
  const fluidBytes = await readFile(fluidPath);
  if (fluidBytes.byteLength !== fluid.byteLength || sha256(fluidBytes) !== String(fluid.sha256).replace(/^sha256:/, '')) throw new Error('fluid sidecar identity mismatch');
  const controlEntry = controlReport.budgetCurve?.find(entry => entry.requestedBudget === options.controlBudget);
  if (!controlEntry || controlEntry.activeGaussianCount !== options.controlBudget) throw new Error('control report lacks exact requested budget');
  const controlArtifactPath = options.controlArtifactPath
    ? resolve(options.controlArtifactPath)
    : resolveArtifactPath(controlReportPath, controlEntry.artifact?.path);
  const controlArtifactBytes = await readFile(controlArtifactPath);
  const actualControlArtifactSha = sha256(controlArtifactBytes);
  if (!options.expectedControlArtifactSha256 || actualControlArtifactSha !== options.expectedControlArtifactSha256.replace(/^sha256:/, '')) {
    throw new Error('control artifact sha256 mismatch or missing expectation');
  }
  if (actualControlArtifactSha !== String(controlEntry.artifact.sha256).replace(/^sha256:/, '')) throw new Error('control report artifact binding mismatch');
  progress.lastTrustworthyEvidence = {
    manifestPath,
    manifestSha256: `sha256:${sha256(manifestBytes)}`,
    fluidPath,
    fluidSha256: `sha256:${sha256(fluidBytes)}`,
    controlReportPath,
    controlReportSha256: `sha256:${sha256(controlReportBytes)}`,
    controlArtifactPath,
    controlArtifactSha256: `sha256:${actualControlArtifactSha}`,
    effectiveRoute: manifest.effectiveRoute,
    backend: manifest.backend,
  };
  return {
    manifest,
    manifestPath,
    manifestBytes,
    fluidPath,
    fluidBytes,
    controlReport,
    controlReportPath,
    controlEntry,
    controlArtifactPath,
    controlArtifactBytes,
  };
}

export async function produceSmokeExtinctionResidualOracle(options = {}) {
  const outDir = resolve(options.outDir);
  await mkdir(outDir, { recursive: true });
  const progress = { failurePhase: 'input-validation', lastTrustworthyEvidence: null };
  try {
    const inputs = await loadInputs(options, progress);
    progress.failurePhase = 'oracle-construction';
    const field = new Float32Array(inputs.fluidBytes.buffer, inputs.fluidBytes.byteOffset, inputs.fluidBytes.byteLength / 4);
    const controlRows = decodeControlRows(inputs.controlArtifactBytes, inputs.controlEntry.artifact);
    const oracle = buildSmokeExtinctionResidualOracle({
      grid: inputs.manifest.grid,
      field,
      channelOrder: inputs.manifest.fluidChannelOrder,
      controlRows,
      residualBlockSize: options.residualBlockSize,
      residualGeometry: options.residualGeometry,
    });
    progress.lastTrustworthyEvidence = { ...progress.lastTrustworthyEvidence, accounting: oracle.accounting };
    progress.failurePhase = 'product-write';
    const sidecarBytes = Buffer.from(oracle.sidecar.values.buffer, oracle.sidecar.values.byteOffset, oracle.sidecar.values.byteLength);
    const sidecarPath = join(outDir, 'smoke-extinction-support-sidecar.f32');
    await writeFile(sidecarPath, sidecarBytes);
    const camera = normalizeCamera(inputs.manifest.camera);
    const teacher = {
      ...inputs.controlReport.teacher,
      manifestPath: inputs.manifestPath,
      manifestIdentity: `sha256:${sha256(inputs.manifestBytes)}`,
      fluidPath: inputs.fluidPath,
      fluidIdentity: `sha256:${sha256(inputs.fluidBytes)}`,
      sourceSchema: inputs.manifest.schema,
      effectiveRoute: inputs.manifest.effectiveRoute,
      prototypeIdentity: inputs.manifest.prototypeIdentity,
      backend: inputs.manifest.backend,
      grid: inputs.manifest.grid,
      worldSpace: inputs.manifest.worldSpace,
      camera,
      cameraIdentity: camera ? `sha256:${sha256(Buffer.from(JSON.stringify(camera)))}` : null,
    };
    const products = {
      coarse: await writeRoleProduct({ outDir, role: 'coarse-control', rows: oracle.coarseRows, teacher, targetMass: oracle.accounting.coarseExtinctionMass, residualGeometry: oracle.residualGeometry }),
      residual: await writeRoleProduct({ outDir, role: 'residual-oracle', rows: oracle.residualRows, teacher, targetMass: oracle.accounting.residualExtinctionMass, residualGeometry: oracle.residualGeometry }),
      combined: await writeRoleProduct({ outDir, role: 'coarse-plus-residual', rows: oracle.combinedRows, teacher, targetMass: oracle.accounting.physicalExtinctionMass, residualGeometry: oracle.residualGeometry }),
    };
    const report = {
    schema: ORACLE_SCHEMA,
    authority: ORACLE_AUTHORITY,
    status: 'passed',
    failurePhase: null,
    createdAt: new Date().toISOString(),
    hiddenCandidateCapApplied: false,
    requested: {
      manifestPath: options.manifestPath,
      controlReportPath: options.controlReportPath,
      controlArtifactPath: options.controlArtifactPath || null,
      controlBudget: options.controlBudget,
      residualBlockSize: options.residualBlockSize,
      residualGeometry: options.residualGeometry || 'diagonal-covariance-v0',
    },
    effective: {
      manifestPath: inputs.manifestPath,
      manifestSha256: `sha256:${sha256(inputs.manifestBytes)}`,
      fluidPath: inputs.fluidPath,
      fluidSha256: `sha256:${sha256(inputs.fluidBytes)}`,
      controlReportPath: inputs.controlReportPath,
      controlReportSha256: `sha256:${sha256(await readFile(inputs.controlReportPath))}`,
      controlArtifactPath: inputs.controlArtifactPath,
      controlArtifactSha256: `sha256:${sha256(inputs.controlArtifactBytes)}`,
      route: inputs.manifest.effectiveRoute,
      prototypeIdentity: inputs.manifest.prototypeIdentity,
      backend: inputs.manifest.backend,
      grid: inputs.manifest.grid,
      residualBlockSize: oracle.residualBlockSize,
      residualGeometry: oracle.residualGeometry,
    },
    sidecar: {
      path: sidecarPath,
      sha256: `sha256:${sha256(sidecarBytes)}`,
      byteLength: sidecarBytes.byteLength,
      dtype: 'float32',
      byteOrder: 'little-endian',
      shape: oracle.sidecar.shape,
      channelOrder: oracle.sidecar.channelOrder,
      neighborhoodAuthority: oracle.sidecar.neighborhoodAuthority,
      ridgeAuthority: oracle.sidecar.ridgeAuthority,
    },
    accounting: oracle.accounting,
    products,
    lastTrustworthyEvidence: progress.lastTrustworthyEvidence,
    };
    const reportPath = join(outDir, 'oracle-report.json');
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    return { ...report, reportPath };
  } catch (error) {
    await writeFile(join(outDir, 'oracle-report.json'), `${JSON.stringify({
      schema: ORACLE_SCHEMA,
      authority: ORACLE_AUTHORITY,
      status: 'failed',
      failurePhase: progress.failurePhase,
      error: error?.message || String(error),
      createdAt: new Date().toISOString(),
      hiddenCandidateCapApplied: false,
      requested: {
        manifestPath: options.manifestPath || null,
        controlReportPath: options.controlReportPath || null,
        controlArtifactPath: options.controlArtifactPath || null,
        controlBudget: options.controlBudget,
        residualBlockSize: options.residualBlockSize,
        residualGeometry: options.residualGeometry || 'diagonal-covariance-v0',
      },
      lastTrustworthyEvidence: progress.lastTrustworthyEvidence,
    }, null, 2)}\n`);
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
  const options = {
    manifestPath: args.get('--manifest'),
    expectedManifestSha256: args.get('--expected-manifest-sha256'),
    controlReportPath: args.get('--control-report'),
    expectedControlReportSha256: args.get('--expected-control-report-sha256'),
    controlArtifactPath: args.get('--control-artifact') || null,
    expectedControlArtifactSha256: args.get('--expected-control-artifact-sha256'),
    controlBudget: Number(args.get('--control-budget') || 1024),
    residualBlockSize: Number(args.get('--residual-block-size') || 2),
    residualGeometry: args.get('--residual-geometry') || 'diagonal-covariance-v0',
    outDir: args.get('--out-dir'),
  };
  const requested = {
    manifestPath: options.manifestPath || null,
    controlReportPath: options.controlReportPath || null,
    controlArtifactPath: options.controlArtifactPath,
    controlBudget: options.controlBudget,
    residualBlockSize: options.residualBlockSize,
    residualGeometry: options.residualGeometry,
  };
  let failurePhase = 'input-validation';
  let lastTrustworthyEvidence = { requested };
  try {
    if (!options.outDir) throw new Error('--out-dir is required');
    await mkdir(resolve(options.outDir), { recursive: true });
    if (!options.manifestPath || !options.controlReportPath) throw new Error('--manifest and --control-report are required');
    const report = await produceSmokeExtinctionResidualOracle(options);
    console.log(JSON.stringify({
      status: report.status,
      reportPath: report.reportPath,
      accounting: report.accounting,
      products: Object.fromEntries(Object.entries(report.products).map(([role, product]) => [role, { count: product.count, fitPath: product.fitPath }])),
    }, null, 2));
  } catch (error) {
    if (options.outDir) {
      const outDir = resolve(options.outDir);
      await mkdir(outDir, { recursive: true });
      const progressPath = join(outDir, 'oracle-report.json');
      if (existsSync(progressPath)) {
        try {
          const previous = JSON.parse((await readFile(progressPath)).toString('utf8'));
          failurePhase = previous.failurePhase || failurePhase;
          lastTrustworthyEvidence = previous.lastTrustworthyEvidence || lastTrustworthyEvidence;
        } catch {
          // Preserve the current failure when a partial report is unreadable.
        }
      }
      await writeFile(progressPath, `${JSON.stringify({
        schema: ORACLE_SCHEMA,
        authority: ORACLE_AUTHORITY,
        status: 'failed',
        failurePhase,
        error: error?.message || String(error),
        createdAt: new Date().toISOString(),
        hiddenCandidateCapApplied: false,
        requested,
        lastTrustworthyEvidence,
      }, null, 2)}\n`);
    }
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}
