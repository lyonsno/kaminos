#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SMOKE_ORACLE_HOSTILE_CAMERA_SPLIT_IDENTITY = 'smoke-oracle-hostile-camera-split-v0';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function finiteArray(value, length, label) {
  if (!Array.isArray(value) || value.length !== length || !value.every(Number.isFinite)) throw new Error(`${label} must contain ${length} finite numbers`);
  return value;
}

function subtract(left, right) {
  return left.map((value, index) => value - right[index]);
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  if (!(length > 0)) throw new Error('camera basis vector has zero length');
  return vector.map(value => value / length);
}

function lookAtMatrixWorldInverse(position, target) {
  const cameraZ = normalize(subtract(position, target));
  const up = Math.abs(cameraZ[1]) > 0.999 ? [0, 0, 1] : [0, 1, 0];
  const cameraX = normalize(cross(up, cameraZ));
  const cameraY = cross(cameraZ, cameraX);
  return [
    cameraX[0], cameraY[0], cameraZ[0], 0,
    cameraX[1], cameraY[1], cameraZ[1], 0,
    cameraX[2], cameraY[2], cameraZ[2], 0,
    -dot(cameraX, position), -dot(cameraY, position), -dot(cameraZ, position), 1,
  ];
}

function rotateAroundY(position, target, degrees) {
  const angle = degrees * Math.PI / 180;
  const offset = subtract(position, target);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [
    target[0] + offset[0] * cosine + offset[2] * sine,
    position[1],
    target[2] - offset[0] * sine + offset[2] * cosine,
  ];
}

function elevate(position, target, degrees) {
  const offset = subtract(position, target);
  const radius = Math.hypot(...offset);
  const azimuth = Math.atan2(offset[0], offset[2]);
  const elevation = Math.asin(offset[1] / radius) + degrees * Math.PI / 180;
  const clamped = Math.max(-80 * Math.PI / 180, Math.min(80 * Math.PI / 180, elevation));
  const horizontal = radius * Math.cos(clamped);
  return [
    target[0] + Math.sin(azimuth) * horizontal,
    target[1] + Math.sin(clamped) * radius,
    target[2] + Math.cos(azimuth) * horizontal,
  ];
}

function derivedCamera(sourceCamera, position) {
  return {
    position,
    target: [...sourceCamera.target],
    projectionMatrix: [...sourceCamera.projectionMatrix],
    matrixWorldInverse: lookAtMatrixWorldInverse(position, sourceCamera.target),
  };
}

function validateSourceFit(report) {
  if (report.schema !== 'kaminos.smoke-gaussian-oracle-static-fit-report.v0'
    || report.identity !== 'smoke-gaussian-oracle-static-fit-v0'
    || report.status !== 'passed' || report.hiddenBudgetCapApplied !== false) {
    throw new Error('source fit is not a passed uncapped smoke oracle report');
  }
  const teacher = report.teacher || {};
  const heldReplayAuthority = teacher.sourceSchema === 'kaminos.volume.operator-basin-replay.v0'
    && teacher.worldSpace?.transformAuthority === 'operator-basin-normalized-volume-domain-v0';
  const nativeFullGridAuthority = teacher.sourceSchema === 'kaminos.volume.full-grid-field-export.v0'
    && teacher.worldSpace?.transformAuthority === 'native-volume-grid-world-transform-v0';
  if (teacher.effectiveRoute !== 'native-3d-compute-fluid-raymarch-v0'
    || (!heldReplayAuthority && !nativeFullGridAuthority)) {
    throw new Error('hostile camera split requires checksum-bound held replay or native full-grid world-space source authority');
  }
  const camera = teacher.camera || {};
  finiteArray(camera.position, 3, 'source camera position');
  finiteArray(camera.target, 3, 'source camera target');
  finiteArray(camera.projectionMatrix, 16, 'source camera projectionMatrix');
  finiteArray(camera.matrixWorldInverse, 16, 'source camera matrixWorldInverse');
  const identity = `sha256:${sha256(Buffer.from(JSON.stringify(camera)))}`;
  if (identity !== teacher.cameraIdentity) throw new Error(`source camera identity mismatch: ${identity} != ${teacher.cameraIdentity || '(missing)'}`);
  return camera;
}

export async function buildSmokeOracleHostileCameraSplit({ fitReportPath, outDir } = {}) {
  if (!fitReportPath) throw new Error('fitReportPath is required');
  if (!outDir) throw new Error('outDir is required');
  const sourcePath = resolve(fitReportPath);
  const sourceBytes = await readFile(sourcePath);
  const source = JSON.parse(sourceBytes.toString('utf8'));
  const sourceCamera = validateSourceFit(source);
  const cameras = [
    { cameraId: 'recorded-native', role: 'calibration', camera: structuredClone(sourceCamera), transform: 'recorded-camera-unchanged' },
    { cameraId: 'side-plus-90', role: 'held-out', camera: derivedCamera(sourceCamera, rotateAroundY(sourceCamera.position, sourceCamera.target, 90)), transform: 'world-y-azimuth-plus-90-degrees' },
    { cameraId: 'back-plus-180', role: 'held-out', camera: derivedCamera(sourceCamera, rotateAroundY(sourceCamera.position, sourceCamera.target, 180)), transform: 'world-y-azimuth-plus-180-degrees' },
    { cameraId: 'elevated-plus-35', role: 'held-out', camera: derivedCamera(sourceCamera, elevate(sourceCamera.position, sourceCamera.target, 35)), transform: 'camera-elevation-plus-35-degrees-radius-preserved' },
  ];
  await mkdir(outDir, { recursive: true });
  const products = [];
  for (const entry of cameras) {
    const cameraIdentity = `sha256:${sha256(Buffer.from(JSON.stringify(entry.camera)))}`;
    const productDirectory = join(outDir, entry.cameraId);
    const productPath = join(productDirectory, 'oracle-fit-report.json');
    const product = structuredClone(source);
    product.teacher.camera = entry.camera;
    product.teacher.cameraIdentity = cameraIdentity;
    product.cameraEvaluation = {
      identity: 'smoke-oracle-camera-evaluation-product-v0',
      cameraId: entry.cameraId,
      role: entry.role,
      transform: entry.transform,
      sourceFitReportPath: sourcePath,
      sourceFitReportIdentity: `sha256:${sha256(sourceBytes)}`,
      fitAuthority: 'world-space-state-fit-camera-independent-v0',
      cameraAuthority: entry.role === 'calibration' ? 'checksum-bound-recorded-camera-v0' : 'deterministic-hostile-camera-derived-from-recorded-v0',
    };
    await mkdir(productDirectory, { recursive: true });
    await writeFile(productPath, `${JSON.stringify(product, null, 2)}\n`);
    products.push({
      cameraId: entry.cameraId,
      role: entry.role,
      transform: entry.transform,
      cameraIdentity,
      fitReportPath: productPath,
    });
  }
  const report = {
    schema: 'kaminos.smoke-oracle-hostile-camera-split.v0',
    identity: SMOKE_ORACLE_HOSTILE_CAMERA_SPLIT_IDENTITY,
    status: 'passed',
    createdAt: new Date().toISOString(),
    sourceFitReportPath: sourcePath,
    sourceFitReportIdentity: `sha256:${sha256(sourceBytes)}`,
    cameraSplit: {
      authority: 'explicit-disjoint-world-space-hostile-camera-split-v0',
      calibrationCameraIds: cameras.filter(entry => entry.role === 'calibration').map(entry => entry.cameraId),
      heldOutCameraIds: cameras.filter(entry => entry.role === 'held-out').map(entry => entry.cameraId),
      overlap: 0,
    },
    products,
  };
  report.reportPath = join(outDir, 'hostile-camera-split-report.json');
  await writeFile(report.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    args.set(argv[index], argv[index + 1]);
    index += 1;
  }
  return args;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const report = await buildSmokeOracleHostileCameraSplit({
    fitReportPath: args.get('--fit-report'),
    outDir: args.get('--out-dir'),
  });
  console.log(JSON.stringify({ status: report.status, reportPath: report.reportPath, cameraSplit: report.cameraSplit, products: report.products }, null, 2));
}
