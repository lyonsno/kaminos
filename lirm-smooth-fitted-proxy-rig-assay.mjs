#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import {
  createFittedProxyRigBinding,
  createSmoothFittedProxyRigBinding,
  createSmoothFittedProxyRigPose,
  deformFittedProxyRigBinding,
  deformSmoothFittedProxyRigBinding,
} from './lirm-reference-fitted-armature-core.mjs';

export const SMOOTH_FITTED_PROXY_RIG_ASSAY_ROUTE = 'kaminos/fitted-proxy-rig/exact-glb-smooth-curve-stress-v0';

const COMPONENTS = {
  5121: { bytes: 1, read: 'getUint8' },
  5123: { bytes: 2, read: 'getUint16' },
  5125: { bytes: 4, read: 'getUint32' },
  5126: { bytes: 4, read: 'getFloat32', write: 'setFloat32' },
};
const TYPE_COUNTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

export function parseGlb(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) {
    throw new Error('source is not a GLB v2 file');
  }
  if (bytes.readUInt32LE(8) !== bytes.length) throw new Error('source GLB declared length mismatch');
  let offset = 12;
  let json = null;
  let binary = null;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (data.length !== length) throw new Error('source GLB contains a truncated chunk');
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8').replace(/\0+\s*$/, ''));
    if (type === 0x004e4942) binary = Buffer.from(data);
    offset += 8 + length;
  }
  if (!json || !binary) throw new Error('source GLB requires JSON and BIN chunks');
  return { json, binary };
}

function encodeGlb(json, binary) {
  const rawJson = Buffer.from(JSON.stringify(json));
  const jsonPadding = (4 - rawJson.length % 4) % 4;
  const jsonBytes = Buffer.concat([rawJson, Buffer.alloc(jsonPadding, 0x20)]);
  const binaryPadding = (4 - binary.length % 4) % 4;
  const binaryBytes = Buffer.concat([binary, Buffer.alloc(binaryPadding)]);
  const output = Buffer.alloc(12 + 8 + jsonBytes.length + 8 + binaryBytes.length);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  let offset = 12;
  output.writeUInt32LE(jsonBytes.length, offset);
  output.writeUInt32LE(0x4e4f534a, offset + 4);
  jsonBytes.copy(output, offset + 8);
  offset += 8 + jsonBytes.length;
  output.writeUInt32LE(binaryBytes.length, offset);
  output.writeUInt32LE(0x004e4942, offset + 4);
  binaryBytes.copy(output, offset + 8);
  return output;
}

function accessorLayout(json, binary, accessorIndex, expectedType = null) {
  const accessor = json.accessors?.[accessorIndex];
  if (!accessor || accessor.sparse) throw new Error(`missing or unsupported accessor ${accessorIndex}`);
  if (expectedType && accessor.type !== expectedType) throw new Error(`accessor ${accessorIndex} must be ${expectedType}`);
  const view = json.bufferViews?.[accessor.bufferView];
  const component = COMPONENTS[accessor.componentType];
  const itemCount = TYPE_COUNTS[accessor.type];
  if (!view || !component || !itemCount) throw new Error(`unsupported accessor layout ${accessorIndex}`);
  const stride = view.byteStride ?? component.bytes * itemCount;
  const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  if (offset + Math.max(0, accessor.count - 1) * stride + component.bytes * itemCount > binary.length) {
    throw new Error(`accessor ${accessorIndex} exceeds the GLB binary chunk`);
  }
  return { accessor, component, itemCount, stride, offset };
}

export function readAccessor(json, binary, accessorIndex, expectedType = null) {
  const layout = accessorLayout(json, binary, accessorIndex, expectedType);
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const output = new Float64Array(layout.accessor.count * layout.itemCount);
  for (let index = 0; index < layout.accessor.count; index += 1) {
    for (let item = 0; item < layout.itemCount; item += 1) {
      output[index * layout.itemCount + item] = view[layout.component.read](
        layout.offset + index * layout.stride + item * layout.component.bytes,
        true,
      );
    }
  }
  return { ...layout, values: output };
}

function writeFloatAccessor(json, binary, accessorIndex, values, expectedType) {
  const layout = accessorLayout(json, binary, accessorIndex, expectedType);
  if (layout.accessor.componentType !== 5126 || values.length !== layout.accessor.count * layout.itemCount) {
    throw new Error(`float accessor ${accessorIndex} output shape mismatch`);
  }
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  for (let index = 0; index < layout.accessor.count; index += 1) {
    for (let item = 0; item < layout.itemCount; item += 1) {
      view.setFloat32(layout.offset + index * layout.stride + item * 4, values[index * layout.itemCount + item], true);
    }
  }
}

export function locateEditablePrimitive(json) {
  const scene = json.scenes?.[json.scene ?? 0];
  const roots = scene?.nodes ?? [];
  let found = null;
  const visit = index => {
    const node = json.nodes?.[index];
    if (!node) throw new Error(`missing GLB node ${index}`);
    const hasTransform = node.matrix || node.translation || node.rotation || node.scale;
    if (Number.isInteger(node.mesh)) {
      if (hasTransform) throw new Error('exact stress assay requires an identity mesh node');
      for (const primitive of json.meshes?.[node.mesh]?.primitives ?? []) {
        if ((primitive.mode ?? 4) !== 4 || !Number.isInteger(primitive.attributes?.POSITION)) continue;
        if (found) throw new Error('exact stress assay requires one editable triangle primitive');
        if (!Number.isInteger(primitive.indices) || !Number.isInteger(primitive.attributes?.NORMAL)) {
          throw new Error('exact stress assay requires indexed positions and normals');
        }
        found = primitive;
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  for (const root of roots) visit(root);
  if (!found) throw new Error('source GLB has no editable triangle primitive');
  return found;
}

export function normalizePositions(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[index + axis]);
      max[axis] = Math.max(max[axis], positions[index + axis]);
    }
  }
  const center = min.map((value, axis) => (value + max[axis]) * 0.5);
  const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const scale = 2.15 / Math.max(diagonal, 1e-12);
  return {
    values: Float64Array.from(positions, (value, index) => (value - center[index % 3]) * scale),
    center,
    scale,
    sourceBounds: { min, max, diagonal },
  };
}

export function denormalizePositions(positions, normalization) {
  return Float64Array.from(positions, (value, index) => value / normalization.scale + normalization.center[index % 3]);
}

function indexValues(json, binary, accessorIndex) {
  const { accessor, values } = readAccessor(json, binary, accessorIndex, 'SCALAR');
  if (![5121, 5123, 5125].includes(accessor.componentType)) throw new Error('triangle index accessor must use an unsigned integer type');
  return Uint32Array.from(values);
}

function recomputeNormals(positions, indices) {
  const normals = new Float64Array(positions.length);
  for (let index = 0; index + 2 < indices.length; index += 3) {
    const ia = indices[index] * 3;
    const ib = indices[index + 1] * 3;
    const ic = indices[index + 2] * 3;
    const abx = positions[ib] - positions[ia];
    const aby = positions[ib + 1] - positions[ia + 1];
    const abz = positions[ib + 2] - positions[ia + 2];
    const acx = positions[ic] - positions[ia];
    const acy = positions[ic + 1] - positions[ia + 1];
    const acz = positions[ic + 2] - positions[ia + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const offset of [ia, ib, ic]) {
      normals[offset] += nx; normals[offset + 1] += ny; normals[offset + 2] += nz;
    }
  }
  for (let index = 0; index < normals.length; index += 3) {
    const length = Math.hypot(normals[index], normals[index + 1], normals[index + 2]) || 1;
    normals[index] /= length; normals[index + 1] /= length; normals[index + 2] /= length;
  }
  return normals;
}

function updatePositionBounds(accessor, positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[index + axis]);
      max[axis] = Math.max(max[axis], positions[index + axis]);
    }
  }
  accessor.min = min;
  accessor.max = max;
}

function vectorAt(values, vertex) {
  const offset = vertex * 3;
  return [values[offset], values[offset + 1], values[offset + 2]];
}

function edgeLength(values, left, right) {
  const a = vectorAt(values, left);
  const b = vectorAt(values, right);
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

function triangleNormal(values, a, b, c) {
  const av = vectorAt(values, a); const bv = vectorAt(values, b); const cv = vectorAt(values, c);
  const ab = [bv[0] - av[0], bv[1] - av[1], bv[2] - av[2]];
  const ac = [cv[0] - av[0], cv[1] - av[1], cv[2] - av[2]];
  return [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)))];
}

function deformationMetrics(rest, posed, indices) {
  const edgeRatios = [];
  let flippedTriangles = 0;
  let degenerateTriangles = 0;
  let maxDisplacement = 0;
  for (let vertex = 0; vertex < rest.length / 3; vertex += 1) {
    const a = vectorAt(rest, vertex); const b = vectorAt(posed, vertex);
    maxDisplacement = Math.max(maxDisplacement, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  for (let index = 0; index + 2 < indices.length; index += 3) {
    const vertices = [indices[index], indices[index + 1], indices[index + 2]];
    for (const [left, right] of [[0, 1], [1, 2], [2, 0]]) {
      const restLength = edgeLength(rest, vertices[left], vertices[right]);
      if (restLength > 1e-9) edgeRatios.push(edgeLength(posed, vertices[left], vertices[right]) / restLength);
    }
    const restNormal = triangleNormal(rest, ...vertices);
    const posedNormal = triangleNormal(posed, ...vertices);
    const restArea = Math.hypot(...restNormal);
    const posedArea = Math.hypot(...posedNormal);
    if (restArea < 1e-10 || posedArea < 1e-10) degenerateTriangles += 1;
    else if (restNormal[0] * posedNormal[0] + restNormal[1] * posedNormal[1] + restNormal[2] * posedNormal[2] < 0) flippedTriangles += 1;
  }
  edgeRatios.sort((a, b) => a - b);
  return {
    maxDisplacement,
    edgeRatio: {
      p001: percentile(edgeRatios, 0.001),
      p01: percentile(edgeRatios, 0.01),
      median: percentile(edgeRatios, 0.5),
      p99: percentile(edgeRatios, 0.99),
      p999: percentile(edgeRatios, 0.999),
      min: edgeRatios[0] ?? null,
      max: edgeRatios.at(-1) ?? null,
    },
    flippedTriangles,
    degenerateTriangles,
    triangleCount: Math.floor(indices.length / 3),
  };
}

function hardPoseFromSmooth(registration, smoothPose) {
  return {
    schema: 'kaminos.lirm-fitted-proxy-rig-pose.v0',
    sourceCandidateId: registration.sourceCandidateId,
    phase: null,
    amplitude: smoothPose.amplitude,
    stationPositions: smoothPose.stationPositions.map(point => ({ ...point })),
  };
}

async function writeDeformedGlb({ sourceJson, sourceBinary, primitive, positions, indices, outputPath, outputRoot }) {
  const json = structuredClone(sourceJson);
  const binary = Buffer.from(sourceBinary);
  writeFloatAccessor(json, binary, primitive.attributes.POSITION, positions, 'VEC3');
  writeFloatAccessor(json, binary, primitive.attributes.NORMAL, recomputeNormals(positions, indices), 'VEC3');
  updatePositionBounds(json.accessors[primitive.attributes.POSITION], positions);
  const bytes = encodeGlb(json, binary);
  await writeFile(outputPath, bytes);
  return { path: relative(outputRoot, outputPath), bytes: bytes.length, sha256: sha256(bytes) };
}

export async function runSmoothFittedProxyRigAssay({
  sourcePath,
  registrationPath,
  outDir,
  expectedSourceSha256,
  sampleCount = 192,
  amplitude = 0.31,
} = {}) {
  const outputRoot = resolve(outDir);
  await mkdir(outputRoot, { recursive: true });
  const reportPath = resolve(outputRoot, 'report.json');
  const startedAt = Date.now();
  const report = {
    schema: 'kaminos.lirm-smooth-fitted-proxy-rig-assay.v0',
    status: 'running',
    failurePhase: null,
    requestedRoute: SMOOTH_FITTED_PROXY_RIG_ASSAY_ROUTE,
    effectiveRoute: null,
    requestedConfig: { sampleCount, amplitude, parameterization: 'monotonic-axial-z' },
    effectiveConfig: null,
    source: { path: sourcePath ? relative(outputRoot, resolve(sourcePath)) : null, sha256: null },
    registration: { path: registrationPath ? relative(outputRoot, resolve(registrationPath)) : null, sha256: null },
    outputInventory: {},
    results: {},
    timing: { startedAt: new Date(startedAt).toISOString(), finishedAt: null, durationSeconds: null },
    lastTrustworthyEvidence: 'invocation recorded; inputs not admitted',
  };
  await writeJsonAtomic(reportPath, report);
  let phase = 'input-admission';
  try {
    if (!existsSync(sourcePath) || !existsSync(registrationPath)) throw new Error('source GLB and registration must exist');
    const sourceBytes = await readFile(sourcePath);
    report.source.sha256 = sha256(sourceBytes);
    if (expectedSourceSha256 && report.source.sha256 !== expectedSourceSha256) {
      throw new Error(`source GLB hash mismatch: ${report.source.sha256} != ${expectedSourceSha256}`);
    }
    const registrationBytes = await readFile(registrationPath);
    report.registration.sha256 = sha256(registrationBytes);
    const registration = JSON.parse(registrationBytes.toString('utf8'));
    if (registration.schema !== 'kaminos.lirm-fitted-proxy-rig-registration.v0'
        || registration.donorSha256 !== report.source.sha256) {
      throw new Error('registration does not bind the exact source GLB');
    }
    const { json, binary } = parseGlb(sourceBytes);
    const primitive = locateEditablePrimitive(json);
    const sourcePositions = readAccessor(json, binary, primitive.attributes.POSITION, 'VEC3').values;
    const indices = indexValues(json, binary, primitive.indices);
    const normalization = normalizePositions(sourcePositions);
    report.lastTrustworthyEvidence = 'exact source, registration, indexed positions, and topology admitted';
    phase = 'binding';
    await writeJsonAtomic(reportPath, report);

    const smoothBinding = createSmoothFittedProxyRigBinding({
      positions: normalization.values,
      registration,
      sampleCount,
    });
    const hardBinding = createFittedProxyRigBinding({ positions: normalization.values, registration });
    report.binding = {
      smoothParameterization: smoothBinding.parameterization,
      smoothSampleCount: smoothBinding.sampleCount,
      legacyParameterization: 'nearest-hard-segment',
      vertexCount: smoothBinding.vertexCount,
      indexCount: indices.length,
    };
    const restPose = createSmoothFittedProxyRigPose({ registration, preset: 'rest' });
    const reconstructed = deformSmoothFittedProxyRigBinding({ binding: smoothBinding, pose: restPose });
    let maxRestError = 0;
    for (let index = 0; index < reconstructed.length; index += 1) {
      maxRestError = Math.max(maxRestError, Math.abs(reconstructed[index] - normalization.values[index]));
    }
    if (maxRestError > 1e-9) throw new Error(`smooth binding failed exact rest reconstruction: ${maxRestError}`);
    report.lastTrustworthyEvidence = `${smoothBinding.vertexCount} unique vertices bound with exact rest reconstruction`;
    phase = 'strong-pose-deformation';
    await writeJsonAtomic(reportPath, report);

    for (const preset of ['c-bend', 's-bend', 'asymmetric']) {
      const smoothPose = createSmoothFittedProxyRigPose({ registration, preset, amplitude });
      const smoothPositions = deformSmoothFittedProxyRigBinding({ binding: smoothBinding, pose: smoothPose });
      const hardPositions = deformFittedProxyRigBinding({ binding: hardBinding, pose: hardPoseFromSmooth(registration, smoothPose) });
      const smoothOutputPath = resolve(outputRoot, `smooth-${preset}.glb`);
      report.outputInventory[`smooth-${preset}`] = await writeDeformedGlb({
        sourceJson: json,
        sourceBinary: binary,
        primitive,
        positions: denormalizePositions(smoothPositions, normalization),
        indices,
        outputPath: smoothOutputPath,
        outputRoot,
      });
      report.results[preset] = {
        smooth: deformationMetrics(normalization.values, smoothPositions, indices),
        hard: deformationMetrics(normalization.values, hardPositions, indices),
      };
      if (preset === 's-bend') {
        report.outputInventory['legacy-s-bend'] = await writeDeformedGlb({
          sourceJson: json,
          sourceBinary: binary,
          primitive,
          positions: denormalizePositions(hardPositions, normalization),
          indices,
          outputPath: resolve(outputRoot, 'legacy-s-bend.glb'),
          outputRoot,
        });
      }
      await writeJsonAtomic(reportPath, report);
    }
    report.effectiveRoute = SMOOTH_FITTED_PROXY_RIG_ASSAY_ROUTE;
    report.effectiveConfig = {
      sampleCount,
      amplitude,
      parameterization: smoothBinding.parameterization,
      presets: ['c-bend', 's-bend', 'asymmetric'],
      legacyControl: 's-bend',
    };
    report.status = 'assay-complete-uninspected';
    report.maxRestError = maxRestError;
    report.lastTrustworthyEvidence = 'exact textured GLB variants and deformation metrics written; visual inspection pending';
  } catch (error) {
    report.status = 'failed';
    report.failurePhase = phase;
    report.error = { name: error.name, message: error.message };
    report.lastTrustworthyEvidence = `${report.lastTrustworthyEvidence}; failed during ${phase}`;
    throw error;
  } finally {
    const finishedAt = Date.now();
    report.timing.finishedAt = new Date(finishedAt).toISOString();
    report.timing.durationSeconds = (finishedAt - startedAt) / 1000;
    await writeJsonAtomic(reportPath, report);
  }
  return report;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
    const value = argv[++index];
    if (value === undefined) throw new Error(`missing value for ${key}`);
    options[key.slice(2)] = value;
  }
  return options;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2));
  const report = await runSmoothFittedProxyRigAssay({
    sourcePath: options.source,
    registrationPath: options.registration,
    outDir: options.out,
    expectedSourceSha256: options['expected-source-sha256'],
    sampleCount: options.samples ? Number(options.samples) : 192,
    amplitude: options.amplitude ? Number(options.amplitude) : 0.31,
  });
  process.stdout.write(`${JSON.stringify({ status: report.status, report: resolve(options.out, 'report.json'), timing: report.timing }, null, 2)}\n`);
}
