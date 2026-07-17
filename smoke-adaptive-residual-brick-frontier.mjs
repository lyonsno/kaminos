#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildCameraRays,
  compare,
  encodeLumaPng,
  opticalOutputs,
  rayDirection,
  renderGridDepth,
  sampleDenseGridTrilinear,
} from './smoke-matched-optics-falsifier.mjs';

export const SMOKE_ADAPTIVE_RESIDUAL_BRICK_FRONTIER_IDENTITY = 'smoke-adaptive-residual-brick-frontier-v0';
const REPORT_SCHEMA = 'kaminos.smoke-adaptive-residual-brick-frontier-report.v0';
const HIERARCHY_IDENTITY = 'mass-conserving-adaptive-residual-bricks-v0';
const OPTICAL_MODEL = 'beer-lambert-one-minus-exp-negative-depth-v0';

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function finite(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

function finiteVector(value, length, label) {
  if (!Array.isArray(value) || value.length !== length || value.some(item => !Number.isFinite(item))) {
    throw new Error(`${label} must contain ${length} finite values`);
  }
  return value;
}

function resolveArtifactPath(anchorPath, artifactPath, label) {
  if (typeof artifactPath !== 'string' || artifactPath.length === 0) throw new Error(`${label} path is missing`);
  const absolute = isAbsolute(artifactPath) ? artifactPath : resolve(dirname(anchorPath), artifactPath);
  if (!existsSync(absolute)) throw new Error(`${label} is missing: ${absolute}`);
  return absolute;
}

function validateRequest(options) {
  if (!Array.isArray(options.blockSizes) || options.blockSizes.length === 0) throw new Error('blockSizes must be a non-empty array');
  const blockSizes = options.blockSizes.map(value => positiveInteger(value, 'blockSize'));
  if (new Set(blockSizes).size !== blockSizes.length) throw new Error('blockSizes must be unique');
  if (!Array.isArray(options.retainedResidualEnergyFractions) || options.retainedResidualEnergyFractions.length < 2) {
    throw new Error('retainedResidualEnergyFractions must be an array');
  }
  const fractions = options.retainedResidualEnergyFractions.map(value => finite(value, 'retained residual energy fraction'));
  if (fractions[0] !== 0 || fractions.at(-1) !== 1) throw new Error('retained residual energy fractions must include exact endpoints 0 and 1');
  for (let index = 0; index < fractions.length; index += 1) {
    if (fractions[index] < 0 || fractions[index] > 1) throw new Error('retained residual energy fractions must be between 0 and 1');
    if (index > 0 && !(fractions[index] > fractions[index - 1])) throw new Error('retained residual energy fractions must be strictly increasing');
  }
  return { blockSizes, fractions };
}

function cellIndex(x, y, z, grid) {
  return x + y * grid + z * grid * grid;
}

function brickCoordinates(index, coarseGrid) {
  return [index % coarseGrid, Math.floor(index / coarseGrid) % coarseGrid, Math.floor(index / (coarseGrid * coarseGrid))];
}

function brickIndexForCell(x, y, z, grid, blockSize) {
  const coarseGrid = grid / blockSize;
  return Math.floor(x / blockSize)
    + Math.floor(y / blockSize) * coarseGrid
    + Math.floor(z / blockSize) * coarseGrid * coarseGrid;
}

export function buildAdaptiveResidualBrickHierarchy({
  values,
  grid,
  blockSize,
  minimum = [-1, -1, -1],
  maximum = [1, 1, 1],
  extinctionCoefficient = 1,
} = {}) {
  const size = positiveInteger(grid, 'grid');
  const block = positiveInteger(blockSize, 'blockSize');
  if (size % block !== 0) throw new Error('blockSize must divide grid exactly');
  if (!(values instanceof Float32Array || values instanceof Float64Array) || values.length !== size ** 3) {
    throw new Error('adaptive hierarchy source shape mismatch');
  }
  finiteVector(minimum, 3, 'minimum bounds');
  finiteVector(maximum, 3, 'maximum bounds');
  const coefficient = finite(extinctionCoefficient, 'extinctionCoefficient');
  if (!(coefficient > 0)) throw new Error('extinctionCoefficient must be positive');
  const coarseGrid = size / block;
  const brickCount = coarseGrid ** 3;
  const cellsPerBrick = block ** 3;
  const coarseValues = new Float64Array(brickCount);
  let sourceMass = 0;
  let minimumSourceValue = Infinity;
  let maximumSourceValue = 0;
  for (const value of values) {
    if (!Number.isFinite(value) || value < 0) throw new Error('adaptive hierarchy source must be finite and non-negative');
    sourceMass += value;
    minimumSourceValue = Math.min(minimumSourceValue, value);
    maximumSourceValue = Math.max(maximumSourceValue, value);
  }
  for (let z = 0; z < size; z += 1) {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        coarseValues[brickIndexForCell(x, y, z, size, block)] += values[cellIndex(x, y, z, size)];
      }
    }
  }
  for (let index = 0; index < coarseValues.length; index += 1) coarseValues[index] /= cellsPerBrick;

  const brickWorldDiagonal = Math.hypot(...minimum.map((value, axis) => ((maximum[axis] - value) / size) * block));
  const bricks = Array.from({ length: brickCount }, (_, index) => ({
    index,
    coordinates: brickCoordinates(index, coarseGrid),
    residualEnergy: 0,
    residualAbsoluteMass: 0,
    residualSum: 0,
    maximumAbsoluteResidual: 0,
    maximumOpticalDepthBound: 0,
  }));
  for (let z = 0; z < size; z += 1) {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const brickIndex = brickIndexForCell(x, y, z, size, block);
        const residual = values[cellIndex(x, y, z, size)] - coarseValues[brickIndex];
        const brickRecord = bricks[brickIndex];
        brickRecord.residualEnergy += residual * residual;
        brickRecord.residualAbsoluteMass += Math.abs(residual);
        brickRecord.residualSum += residual;
        brickRecord.maximumAbsoluteResidual = Math.max(brickRecord.maximumAbsoluteResidual, Math.abs(residual));
      }
    }
  }
  let totalResidualEnergy = 0;
  let totalAbsoluteResidualMass = 0;
  for (const brickRecord of bricks) {
    brickRecord.maximumOpticalDepthBound = brickRecord.maximumAbsoluteResidual * brickWorldDiagonal * coefficient;
    totalResidualEnergy += brickRecord.residualEnergy;
    totalAbsoluteResidualMass += brickRecord.residualAbsoluteMass;
  }
  const residualOrder = bricks.map(record => record.index).sort((left, right) => (
    bricks[right].residualEnergy - bricks[left].residualEnergy || left - right
  ));
  let coarseMass = 0;
  for (const value of coarseValues) coarseMass += value * cellsPerBrick;
  return {
    identity: HIERARCHY_IDENTITY,
    grid: size,
    blockSize: block,
    coarseGrid,
    brickCount,
    cellsPerBrick,
    hiddenBrickCapApplied: false,
    minimum: [...minimum],
    maximum: [...maximum],
    extinctionCoefficient: coefficient,
    brickWorldDiagonal,
    sourceValues: values,
    coarseValues,
    bricks,
    residualOrder,
    sourceMass,
    coarseMass,
    minimumSourceValue,
    maximumSourceValue,
    totalResidualEnergy,
    totalAbsoluteResidualMass,
  };
}

function selectedBrickTopology(mask, coarseGrid) {
  const visited = new Uint8Array(mask.length);
  let componentCount = 0;
  let adjacencyEdgeCount = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    const [x, y, z] = brickCoordinates(index, coarseGrid);
    for (const neighbor of [x > 0 ? index - 1 : -1, y > 0 ? index - coarseGrid : -1, z > 0 ? index - coarseGrid ** 2 : -1]) {
      if (neighbor >= 0 && mask[neighbor]) adjacencyEdgeCount += 1;
    }
    if (visited[index]) continue;
    componentCount += 1;
    const queue = [index];
    visited[index] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      const [cx, cy, cz] = brickCoordinates(current, coarseGrid);
      for (const neighbor of [
        cx > 0 ? current - 1 : -1,
        cx + 1 < coarseGrid ? current + 1 : -1,
        cy > 0 ? current - coarseGrid : -1,
        cy + 1 < coarseGrid ? current + coarseGrid : -1,
        cz > 0 ? current - coarseGrid ** 2 : -1,
        cz + 1 < coarseGrid ? current + coarseGrid ** 2 : -1,
      ]) {
        if (neighbor >= 0 && mask[neighbor] && !visited[neighbor]) {
          visited[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }
  }
  return { componentCount, adjacencyEdgeCount };
}

function retainedFineCellsWithHalo(hierarchy, selectedBrickIndices) {
  const retained = new Uint8Array(hierarchy.grid ** 3);
  for (const brickIndex of selectedBrickIndices) {
    const [bx, by, bz] = brickCoordinates(brickIndex, hierarchy.coarseGrid);
    const minimum = [bx, by, bz].map(value => Math.max(0, value * hierarchy.blockSize - 1));
    const maximum = [bx, by, bz].map(value => Math.min(hierarchy.grid - 1, (value + 1) * hierarchy.blockSize));
    for (let z = minimum[2]; z <= maximum[2]; z += 1) {
      for (let y = minimum[1]; y <= maximum[1]; y += 1) {
        for (let x = minimum[0]; x <= maximum[0]; x += 1) retained[cellIndex(x, y, z, hierarchy.grid)] = 1;
      }
    }
  }
  let count = 0;
  for (const value of retained) count += value;
  return { mask: retained, count };
}

export function selectResidualBricks({ hierarchy, retainedResidualEnergyFraction } = {}) {
  if (!hierarchy || hierarchy.identity !== HIERARCHY_IDENTITY || hierarchy.hiddenBrickCapApplied !== false) {
    throw new Error('invalid adaptive residual hierarchy');
  }
  const requested = finite(retainedResidualEnergyFraction, 'retainedResidualEnergyFraction');
  if (requested < 0 || requested > 1) throw new Error('retainedResidualEnergyFraction must be between 0 and 1');
  const selectedBrickIndices = [];
  let retainedEnergy = 0;
  if (requested === 1) {
    for (const brickIndex of hierarchy.residualOrder) selectedBrickIndices.push(brickIndex);
    retainedEnergy = hierarchy.totalResidualEnergy;
  } else if (requested > 0 && hierarchy.totalResidualEnergy > 0) {
    const target = hierarchy.totalResidualEnergy * requested;
    for (const brickIndex of hierarchy.residualOrder) {
      if (retainedEnergy >= target) break;
      selectedBrickIndices.push(brickIndex);
      retainedEnergy += hierarchy.bricks[brickIndex].residualEnergy;
    }
  }
  selectedBrickIndices.sort((left, right) => left - right);
  const selectedMask = new Uint8Array(hierarchy.brickCount);
  for (const index of selectedBrickIndices) selectedMask[index] = 1;
  let maximumOmittedBrickOpticalDepthBound = 0;
  let omittedResidualEnergy = 0;
  for (const brickRecord of hierarchy.bricks) {
    if (selectedMask[brickRecord.index]) continue;
    maximumOmittedBrickOpticalDepthBound = Math.max(maximumOmittedBrickOpticalDepthBound, brickRecord.maximumOpticalDepthBound);
    omittedResidualEnergy += brickRecord.residualEnergy;
  }
  const topology = selectedBrickTopology(selectedMask, hierarchy.coarseGrid);
  const retainedFine = retainedFineCellsWithHalo(hierarchy, selectedBrickIndices);
  return {
    identity: 'adaptive-residual-brick-selection-v0',
    requestedRetainedResidualEnergyFraction: requested,
    actualRetainedResidualEnergyFraction: hierarchy.totalResidualEnergy > 0 ? retainedEnergy / hierarchy.totalResidualEnergy : 1,
    retainedResidualEnergy: retainedEnergy,
    omittedResidualEnergy,
    selectedBrickCount: selectedBrickIndices.length,
    selectedBrickIndices,
    selectedMask,
    retainedFineCellCountWithHalo: retainedFine.count,
    retainedFineMask: retainedFine.mask,
    maximumOmittedBrickOpticalDepthBound,
    componentCount: topology.componentCount,
    adjacencyEdgeCount: topology.adjacencyEdgeCount,
    hiddenBrickCapApplied: false,
  };
}

export function sampleRetainedFineGridTrilinear({ hierarchy, selection, point } = {}) {
  if (!hierarchy || hierarchy.identity !== HIERARCHY_IDENTITY) throw new Error('invalid adaptive residual hierarchy');
  if (!selection || !(selection.retainedFineMask instanceof Uint8Array) || selection.retainedFineMask.length !== hierarchy.grid ** 3) {
    throw new Error('invalid retained fine-cell halo');
  }
  finiteVector(point, 3, 'sample point');
  const coordinate = point.map((value, axis) => (
    ((value - hierarchy.minimum[axis]) / (hierarchy.maximum[axis] - hierarchy.minimum[axis])) * hierarchy.grid - 0.5
  ));
  const base = coordinate.map(Math.floor);
  const fraction = coordinate.map((value, axis) => value - base[axis]);
  let sampled = 0;
  for (let dz = 0; dz <= 1; dz += 1) {
    for (let dy = 0; dy <= 1; dy += 1) {
      for (let dx = 0; dx <= 1; dx += 1) {
        const x = Math.max(0, Math.min(hierarchy.grid - 1, base[0] + dx));
        const y = Math.max(0, Math.min(hierarchy.grid - 1, base[1] + dy));
        const z = Math.max(0, Math.min(hierarchy.grid - 1, base[2] + dz));
        const index = cellIndex(x, y, z, hierarchy.grid);
        if (!selection.retainedFineMask[index]) throw new Error(`selected refinement attempted unretained fine cell ${index}`);
        const weight = (dx ? fraction[0] : 1 - fraction[0])
          * (dy ? fraction[1] : 1 - fraction[1])
          * (dz ? fraction[2] : 1 - fraction[2]);
        sampled += hierarchy.sourceValues[index] * weight;
      }
    }
  }
  return Math.max(0, sampled);
}

export function reconstructAdaptiveGrid({ hierarchy, selection } = {}) {
  if (!hierarchy || hierarchy.identity !== HIERARCHY_IDENTITY) throw new Error('invalid adaptive residual hierarchy');
  if (!selection || selection.hiddenBrickCapApplied !== false || !(selection.selectedMask instanceof Uint8Array)) {
    throw new Error('invalid adaptive residual selection');
  }
  const values = new Float32Array(hierarchy.grid ** 3);
  let reconstructedMass = 0;
  let maximumAbsoluteCellError = 0;
  let squaredCellError = 0;
  for (let z = 0; z < hierarchy.grid; z += 1) {
    for (let y = 0; y < hierarchy.grid; y += 1) {
      for (let x = 0; x < hierarchy.grid; x += 1) {
        const index = cellIndex(x, y, z, hierarchy.grid);
        const brickIndex = brickIndexForCell(x, y, z, hierarchy.grid, hierarchy.blockSize);
        const value = selection.selectedMask[brickIndex] ? hierarchy.sourceValues[index] : hierarchy.coarseValues[brickIndex];
        values[index] = value;
        reconstructedMass += value;
        const error = Math.abs(value - hierarchy.sourceValues[index]);
        maximumAbsoluteCellError = Math.max(maximumAbsoluteCellError, error);
        squaredCellError += error * error;
      }
    }
  }
  return {
    values,
    reconstructedMass,
    massRelativeError: Math.abs(reconstructedMass - hierarchy.sourceMass) / Math.max(hierarchy.sourceMass, 1e-30),
    maximumAbsoluteCellError,
    cellMse: squaredCellError / values.length,
  };
}

function pointBrickIndex(point, hierarchy) {
  const cell = point.map((value, axis) => Math.max(0, Math.min(
    hierarchy.grid - 1,
    Math.floor(((value - hierarchy.minimum[axis]) / (hierarchy.maximum[axis] - hierarchy.minimum[axis])) * hierarchy.grid),
  )));
  return brickIndexForCell(cell[0], cell[1], cell[2], hierarchy.grid, hierarchy.blockSize);
}

function renderAdaptiveDepth({ hierarchy, selection, camera, rays, width, height, samplesPerCell, extinctionCoefficient }) {
  const cellSize = hierarchy.minimum.map((value, axis) => (hierarchy.maximum[axis] - value) / hierarchy.grid);
  const stepWorld = Math.min(...cellSize) / samplesPerCell;
  const opticalDepth = new Float32Array(width * height);
  let denseSampleCount = 0;
  let fineSampleCount = 0;
  let coarseRunCount = 0;
  for (let pixel = 0; pixel < opticalDepth.length; pixel += 1) {
    if (!(rays.ends[pixel] > rays.starts[pixel])) continue;
    const direction = rayDirection(rays, pixel);
    let depth = 0;
    let activeCoarseRun = -1;
    for (let distance = rays.starts[pixel]; distance < rays.ends[pixel]; distance += stepWorld) {
      const segment = Math.min(stepWorld, rays.ends[pixel] - distance);
      const midpoint = distance + segment / 2;
      const point = camera.position.map((value, axis) => value + direction[axis] * midpoint);
      const brickIndex = pointBrickIndex(point, hierarchy);
      denseSampleCount += 1;
      if (selection.selectedMask[brickIndex]) {
        depth += sampleRetainedFineGridTrilinear({ hierarchy, selection, point }) * segment * extinctionCoefficient;
        fineSampleCount += 1;
        activeCoarseRun = -1;
      } else {
        depth += hierarchy.coarseValues[brickIndex] * segment * extinctionCoefficient;
        if (activeCoarseRun !== brickIndex) {
          coarseRunCount += 1;
          activeCoarseRun = brickIndex;
        }
      }
    }
    opticalDepth[pixel] = depth;
  }
  const chargedSampleCount = fineSampleCount + coarseRunCount;
  const denseTextureFetchCount = denseSampleCount * 8;
  const modeledTextureFetchCount = fineSampleCount * 8 + coarseRunCount;
  return {
    opticalDepth,
    workAccounting: {
      authority: 'cpu-fixed-fine-segment-coarse-run-collapse-model-v0',
      denseSampleCount,
      fineSampleCount,
      coarseRunCount,
      chargedSampleCount,
      chargedSampleRatio: chargedSampleCount / Math.max(denseSampleCount, 1),
      denseTextureFetchCount,
      modeledTextureFetchCount,
      modeledTextureFetchRatio: modeledTextureFetchCount / Math.max(denseTextureFetchCount, 1),
      hierarchyLookupCount: chargedSampleCount,
      hiddenDenseTouchApplied: false,
      productionTimingAuthority: false,
    },
  };
}

async function loadMatchedSource(options, progress) {
  const reportPath = resolve(options.matchedOpticsReportPath || '');
  if (!options.matchedOpticsReportPath) throw new Error('matchedOpticsReportPath is required');
  if (!existsSync(reportPath)) throw new Error(`matched-optics report is missing: ${reportPath}`);
  const reportBytes = await readFile(reportPath);
  const reportIdentity = sha256(reportBytes);
  if (reportIdentity !== options.expectedMatchedOpticsReportSha256) {
    throw new Error(`matched-optics report sha256 mismatch: expected ${options.expectedMatchedOpticsReportSha256}, received ${reportIdentity}`);
  }
  const report = JSON.parse(reportBytes.toString('utf8'));
  if (report.status !== 'passed' || report.identity !== 'smoke-matched-optics-falsifier-v0') throw new Error('matched-optics report is not passed authority');
  if (report.hiddenCellCapApplied !== false) throw new Error('matched-optics report applied a hidden cell cap');
  if (report.effective?.opticalModel !== OPTICAL_MODEL || report.effective?.productionCompositorAuthority !== false) {
    throw new Error('matched-optics report optical authority mismatch');
  }
  const evidence = report.lastTrustworthyEvidence;
  if (!evidence || evidence.effectiveRoute !== report.effective.route || evidence.backend !== report.effective.backend || evidence.cameraIdentity !== report.effective.cameraIdentity) {
    throw new Error('matched-optics last trustworthy evidence identity mismatch');
  }
  const sidecarPath = resolveArtifactPath(reportPath, evidence.sidecarPath, 'physical sidecar');
  const sidecarBytes = await readFile(sidecarPath);
  if (sha256(sidecarBytes) !== evidence.sidecarSha256) throw new Error('physical sidecar sha256 mismatch');
  const grid = positiveInteger(report.effective.grid, 'effective grid');
  if (sidecarBytes.byteLength !== grid ** 3 * 4 * Float32Array.BYTES_PER_ELEMENT) throw new Error('physical sidecar shape mismatch');
  const sidecar = new Float32Array(sidecarBytes.buffer.slice(sidecarBytes.byteOffset, sidecarBytes.byteOffset + sidecarBytes.byteLength));
  const physical = new Float32Array(grid ** 3);
  for (let index = 0; index < physical.length; index += 1) physical[index] = sidecar[index * 4];

  const fitPath = resolveArtifactPath(reportPath, evidence.gaussianFitReportPath, 'camera fit report');
  const fitBytes = await readFile(fitPath);
  if (sha256(fitBytes) !== evidence.gaussianFitReportSha256) throw new Error('camera fit report sha256 mismatch');
  const fit = JSON.parse(fitBytes.toString('utf8'));
  if (fit.status !== 'passed' || fit.hiddenBudgetCapApplied !== false) throw new Error('camera fit report is not passed uncapped authority');
  if (fit.teacher?.effectiveRoute !== report.effective.route || fit.teacher?.backend !== report.effective.backend || fit.teacher?.grid !== grid) {
    throw new Error('camera fit teacher identity mismatch');
  }
  const camera = fit.teacher.camera;
  finiteVector(camera?.position, 3, 'camera position');
  finiteVector(camera?.target, 3, 'camera target');
  finiteVector(camera?.projectionMatrix, 16, 'camera projectionMatrix');
  finiteVector(camera?.matrixWorldInverse, 16, 'camera matrixWorldInverse');
  const cameraIdentity = sha256(Buffer.from(JSON.stringify(camera)));
  if (cameraIdentity !== report.effective.cameraIdentity || cameraIdentity !== fit.teacher.cameraIdentity) throw new Error('camera identity mismatch');
  const minimum = finiteVector(fit.teacher.worldSpace?.bounds?.minimum, 3, 'minimum bounds');
  const maximum = finiteVector(fit.teacher.worldSpace?.bounds?.maximum, 3, 'maximum bounds');
  progress.lastTrustworthyEvidence = {
    matchedOpticsReportPath: reportPath,
    matchedOpticsReportSha256: reportIdentity,
    sidecarPath,
    sidecarSha256: evidence.sidecarSha256,
    cameraFitReportPath: fitPath,
    cameraFitReportSha256: evidence.gaussianFitReportSha256,
    effectiveRoute: report.effective.route,
    backend: report.effective.backend,
    cameraIdentity,
  };
  return { report, reportPath, reportIdentity, physical, grid, camera, cameraIdentity, minimum, maximum };
}

async function writeFloatArtifact(path, values, shape) {
  const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
  await writeFile(path, bytes);
  return { path, sha256: sha256(bytes), byteLength: bytes.byteLength, dtype: 'float32', byteOrder: 'little-endian', shape };
}

async function writeUint32Artifact(path, values) {
  const typed = Uint32Array.from(values);
  const bytes = Buffer.alloc(8 + typed.byteLength);
  bytes.write('SBRK', 0, 4, 'ascii');
  bytes.writeUInt32LE(typed.length, 4);
  Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).copy(bytes, 8);
  await writeFile(path, bytes);
  return {
    path,
    sha256: sha256(bytes),
    byteLength: bytes.byteLength,
    schema: 'kaminos.adaptive-residual-brick-selection.v0',
    headerBytes: 8,
    dtype: 'uint32',
    byteOrder: 'little-endian',
    shape: [typed.length],
  };
}

async function writeRenderArtifacts(outDir, id, width, height, opticalDepth, outputs, displayExposure) {
  const roleDir = join(outDir, id);
  await mkdir(roleDir, { recursive: true });
  const depth = await writeFloatArtifact(join(roleDir, 'optical-depth.f32'), opticalDepth, [height, width]);
  const luma = await writeFloatArtifact(join(roleDir, 'linear-smoke-radiance.f32'), outputs.luma, [height, width]);
  const display = Float32Array.from(outputs.luma, value => Math.min(1, value * displayExposure));
  const pngBytes = encodeLumaPng(width, height, display);
  const pngPath = join(roleDir, 'display.png');
  await writeFile(pngPath, pngBytes);
  return {
    opticalDepth: depth,
    linearRadiance: luma,
    displayPng: { path: pngPath, sha256: sha256(pngBytes), byteLength: pngBytes.byteLength, width, height },
  };
}

function fractionId(value) {
  return String(Math.round(value * 1_000_000)).padStart(7, '0');
}

async function writeContextHtml(outDir, report) {
  const reference = `<figure><img src="${report.reference.artifacts.displayPng.path.replace(`${outDir}/`, '')}"><figcaption><strong>DENSE R${report.effective.grid} REFERENCE</strong><br>Exact R5 source, camera, and Beer-Lambert transfer. Dense samples: ${report.reference.totalSamples.toLocaleString()}.</figcaption></figure>`;
  const cards = report.frontier.map(row => `<figure><img src="${row.artifacts.displayPng.path.replace(`${outDir}/`, '')}"><figcaption><strong>R${row.coarseGrid} + ${Math.round(row.requestedRetainedResidualEnergyFraction * 100)}% RESIDUAL ENERGY</strong><br>${row.selectedBrickCount.toLocaleString()} / ${row.brickCount.toLocaleString()} bricks; halo fine cells ${(row.storageAccounting.retainedFineCellRatio * 100).toFixed(1)}%; charged samples ${(row.workAccounting.chargedSampleRatio * 100).toFixed(1)}%; luma nMSE ${row.comparisonToDense.luma.normalizedMse.toExponential(3)}.</figcaption></figure>`).join('\n');
  const html = `<!doctype html><meta charset="utf-8"><title>Adaptive residual brick frontier</title>
<style>
  body { margin: 0; padding: 24px; background: #111416; color: #eef2f4; font: 14px/1.45 system-ui, sans-serif; }
  h1 { font-size: 24px; margin: 0 0 8px; letter-spacing: 0; }
  p { max-width: 1180px; color: #c6cdd1; }
  main { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 18px; }
  figure { margin: 0; border: 1px solid #3a4146; background: #181c1f; }
  img { display: block; width: 100%; background: black; }
  figcaption { padding: 9px; min-height: 92px; }
  strong { color: #fff; }
</style>
<h1>Mass-conserving adaptive smoke volume frontier</h1>
<p>Every arm uses source <code>${report.effective.matchedOpticsReportSha256}</code>, camera <code>${report.effective.cameraIdentity}</code>, extinction coefficient <code>${report.effective.extinctionCoefficient}</code>, and ${OPTICAL_MODEL}. Coarse parents retain exact mean extinction; selected complete residual bricks retain original R${report.effective.grid} values plus a one-cell trilinear halo. Charged samples are a CPU traversal model, not measured production timing. PNGs use display-only ${report.effective.displayExposure}x exposure; metrics remain linear.</p>
<main>${reference}${cards}</main>`;
  const path = join(outDir, 'context.html');
  const bytes = Buffer.from(html);
  await writeFile(path, bytes);
  return { path, sha256: sha256(bytes), byteLength: bytes.byteLength };
}

export async function runSmokeAdaptiveResidualBrickFrontier(options = {}) {
  const outDir = resolve(options.outDir || '');
  if (!options.outDir) throw new Error('outDir is required');
  await mkdir(outDir, { recursive: true });
  const reportPath = join(outDir, 'adaptive-residual-brick-frontier-report.json');
  const progress = { failurePhase: 'request-validation', lastTrustworthyEvidence: null };
  try {
    const request = validateRequest(options);
    progress.failurePhase = 'source-validation';
    const source = await loadMatchedSource(options, progress);
    for (const blockSize of request.blockSizes) {
      if (source.grid % blockSize !== 0) throw new Error(`blockSize ${blockSize} must divide source grid ${source.grid}`);
    }
    const width = positiveInteger(source.report.effective.width, 'width');
    const height = positiveInteger(source.report.effective.height, 'height');
    const samplesPerCell = finite(source.report.effective.samplesPerCell, 'samplesPerCell');
    const extinctionCoefficient = finite(source.report.effective.extinctionCoefficient, 'extinctionCoefficient');
    const displayExposure = finite(source.report.effective.displayExposure, 'displayExposure');
    const rays = buildCameraRays(source.camera, width, height, source.minimum, source.maximum);

    progress.failurePhase = 'dense-reference-render';
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
    const denseRenderMs = performance.now() - denseStarted;
    const denseArtifacts = await writeRenderArtifacts(outDir, 'dense-reference', width, height, denseRender.opticalDepth, denseOutputs, displayExposure);

    const frontier = [];
    for (const blockSize of request.blockSizes) {
      progress.failurePhase = `hierarchy-b${blockSize}`;
      const hierarchy = buildAdaptiveResidualBrickHierarchy({
        values: source.physical,
        grid: source.grid,
        blockSize,
        minimum: source.minimum,
        maximum: source.maximum,
        extinctionCoefficient,
      });
      for (const fraction of request.fractions) {
        progress.failurePhase = `render-b${blockSize}-e${fractionId(fraction)}`;
        const selection = selectResidualBricks({ hierarchy, retainedResidualEnergyFraction: fraction });
        const reconstruction = reconstructAdaptiveGrid({ hierarchy, selection });
        const started = performance.now();
        const rendered = renderAdaptiveDepth({
          hierarchy,
          selection,
          camera: source.camera,
          rays,
          width,
          height,
          samplesPerCell,
          extinctionCoefficient,
        });
        const outputs = opticalOutputs(rendered.opticalDepth);
        const renderMs = performance.now() - started;
        const depthComparison = compare(denseRender.opticalDepth, rendered.opticalDepth);
        if (fraction === 1 && depthComparison.maximumAbsoluteError !== 0) throw new Error(`full refinement b${blockSize} failed exact dense reconstruction`);
        const id = `b${blockSize}-e${fractionId(fraction)}`;
        const artifacts = await writeRenderArtifacts(outDir, id, width, height, rendered.opticalDepth, outputs, displayExposure);
        artifacts.selectedBrickIndices = await writeUint32Artifact(
          join(outDir, id, 'selected-brick-indices.sbrk'),
          selection.selectedBrickIndices,
        );
        const retainedFineBytes = selection.retainedFineCellCountWithHalo * Float32Array.BYTES_PER_ELEMENT;
        const coarseBytes = hierarchy.coarseValues.byteLength;
        const denseBytes = source.physical.byteLength;
        frontier.push({
          id,
          representation: HIERARCHY_IDENTITY,
          blockSize,
          coarseGrid: hierarchy.coarseGrid,
          brickCount: hierarchy.brickCount,
          requestedRetainedResidualEnergyFraction: fraction,
          actualRetainedResidualEnergyFraction: selection.actualRetainedResidualEnergyFraction,
          selectedBrickCount: selection.selectedBrickCount,
          selectionIdentity: artifacts.selectedBrickIndices.sha256,
          selectedBrickFraction: selection.selectedBrickCount / hierarchy.brickCount,
          selectedComponentCount: selection.componentCount,
          selectedAdjacencyEdgeCount: selection.adjacencyEdgeCount,
          maximumOmittedBrickOpticalDepthBound: selection.maximumOmittedBrickOpticalDepthBound,
          fieldError: {
            cellMse: reconstruction.cellMse,
            maximumAbsoluteCellError: reconstruction.maximumAbsoluteCellError,
          },
          massAccounting: {
            authority: 'complete-parent-mean-or-full-residual-zero-sum-v0',
            sourceCellSum: hierarchy.sourceMass,
            reconstructedCellSum: reconstruction.reconstructedMass,
            relativeError: reconstruction.massRelativeError,
            droppedTailMass: 0,
          },
          storageAccounting: {
            authority: 'float64-coarse-plus-unioned-float32-trilinear-halo-v0',
            denseBytes,
            coarseBytes,
            retainedFineBytes,
            totalBytes: coarseBytes + retainedFineBytes,
            byteRatioToDense: (coarseBytes + retainedFineBytes) / denseBytes,
            retainedFineCellCountWithHalo: selection.retainedFineCellCountWithHalo,
            retainedFineCellRatio: selection.retainedFineCellCountWithHalo / source.physical.length,
          },
          workAccounting: rendered.workAccounting,
          comparisonToDense: {
            opticalDepth: depthComparison,
            maximumAbsoluteOpticalDepthError: depthComparison.maximumAbsoluteError,
            luma: compare(denseOutputs.luma, outputs.luma),
          },
          renderMs,
          productionTimingAuthority: false,
          artifacts,
        });
      }
    }

    progress.failurePhase = 'artifact-validation';
    const report = {
      schema: REPORT_SCHEMA,
      identity: SMOKE_ADAPTIVE_RESIDUAL_BRICK_FRONTIER_IDENTITY,
      status: 'passed',
      failurePhase: null,
      createdAt: new Date().toISOString(),
      hiddenBrickCapApplied: false,
      requested: {
        matchedOpticsReportPath: options.matchedOpticsReportPath,
        expectedMatchedOpticsReportSha256: options.expectedMatchedOpticsReportSha256,
        blockSizes: request.blockSizes,
        retainedResidualEnergyFractions: request.fractions,
      },
      effective: {
        matchedOpticsReportPath: source.reportPath,
        matchedOpticsReportSha256: source.reportIdentity,
        route: source.report.effective.route,
        backend: source.report.effective.backend,
        cameraIdentity: source.cameraIdentity,
        grid: source.grid,
        width,
        height,
        samplesPerCell,
        extinctionCoefficient,
        displayExposure,
        opticalModel: OPTICAL_MODEL,
        productionCompositorAuthority: false,
        productionTimingAuthority: false,
      },
      reference: {
        id: 'dense-reference',
        representation: 'dense-cell-centered-physical-extinction-grid-v0',
        totalSamples: denseRender.totalSamples,
        renderMs: denseRenderMs,
        outputs: {
          maximumOpticalDepth: denseOutputs.maximumOpticalDepth,
          nonzeroPixelCount: denseOutputs.nonzeroPixelCount,
        },
        artifacts: denseArtifacts,
      },
      frontier,
      contextHtml: null,
      lastTrustworthyEvidence: progress.lastTrustworthyEvidence,
      claimBoundary: 'Static CPU optical-quality and modeled hierarchy-work frontier only. Charged samples and texture fetches model coarse-run collapse; they are not measured GPU or production-compositor timing. Full refinement is exact; partial arms preserve parent mass but may introduce coarse/fine boundary error.',
    };
    report.contextHtml = await writeContextHtml(outDir, report);
    for (const row of [report.reference, ...report.frontier]) {
      for (const artifact of Object.values(row.artifacts)) {
        if (!existsSync(artifact.path) || !(artifact.byteLength > 0)) throw new Error(`missing or partial artifact: ${artifact.path}`);
      }
    }
    const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
    await writeFile(reportPath, reportBytes);
    return { ...report, reportPath, reportIdentity: sha256(reportBytes) };
  } catch (error) {
    const failure = {
      schema: REPORT_SCHEMA,
      identity: SMOKE_ADAPTIVE_RESIDUAL_BRICK_FRONTIER_IDENTITY,
      status: 'failed',
      failurePhase: progress.failurePhase,
      error: error?.message || String(error),
      createdAt: new Date().toISOString(),
      hiddenBrickCapApplied: false,
      requested: {
        matchedOpticsReportPath: options.matchedOpticsReportPath || null,
        expectedMatchedOpticsReportSha256: options.expectedMatchedOpticsReportSha256 || null,
        blockSizes: options.blockSizes || null,
        retainedResidualEnergyFractions: options.retainedResidualEnergyFractions || null,
      },
      lastTrustworthyEvidence: progress.lastTrustworthyEvidence,
    };
    await writeFile(reportPath, `${JSON.stringify(failure, null, 2)}\n`);
    throw error;
  }
}

function parseNumberList(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is required`);
  return value.split(',').map(item => Number(item));
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) args.set(argv[index], argv[index + 1]);
  return {
    matchedOpticsReportPath: args.get('--matched-optics-report'),
    expectedMatchedOpticsReportSha256: args.get('--expected-report-sha256'),
    outDir: args.get('--out-dir'),
    blockSizes: parseNumberList(args.get('--block-sizes'), '--block-sizes'),
    retainedResidualEnergyFractions: parseNumberList(args.get('--energy-fractions'), '--energy-fractions'),
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  runSmokeAdaptiveResidualBrickFrontier(parseArgs(process.argv.slice(2)))
    .then(report => process.stdout.write(`${JSON.stringify({ status: report.status, reportPath: report.reportPath, reportIdentity: report.reportIdentity, frontierRows: report.frontier.length })}\n`))
    .catch(error => {
      process.stderr.write(`${error?.stack || error}\n`);
      process.exitCode = 1;
    });
}
