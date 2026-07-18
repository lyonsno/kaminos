import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

export const REFERENCE_FIT_ROUTE = 'kaminos/reference-fitted-armature/software-glb-raster-plus-sdf-fit-v0';
export const REFERENCE_FIT_CAMERAS = Object.freeze(Array.from({ length: 8 }, (_, index) => Object.freeze({
  id: `az${String(index * 45).padStart(3, '0')}`,
  projection: 'orthographic',
  yaw: index * Math.PI / 4,
  pitch: 0.18,
  radius: 4,
  viewportWidth: 2.8,
  viewportHeight: 2.25,
  near: 2.25,
  far: 5.75,
})));

export const REFERENCE_FIT_PARAMETER_SPECS = Object.freeze([
  { id: 'bodyLength', semanticRole: 'axialExtent', initial: 0.92, min: 0.58, max: 1.58, step: 0.18 },
  { id: 'bodyWidth', semanticRole: 'lateralMass', initial: 0.46, min: 0.25, max: 0.92, step: 0.12 },
  { id: 'bodyHeight', semanticRole: 'verticalMass', initial: 0.36, min: 0.2, max: 0.78, step: 0.1 },
  { id: 'headScale', semanticRole: 'headOrientation', initial: 0.54, min: 0.3, max: 1.18, step: 0.13 },
  { id: 'bellyScale', semanticRole: 'bodyMass', initial: 0.72, min: 0.4, max: 1.42, step: 0.15 },
  { id: 'tailScale', semanticRole: 'posteriorTaper', initial: 0.42, min: 0.18, max: 0.95, step: 0.12 },
  { id: 'dorsalLift', semanticRole: 'dorsalProfile', initial: 0.04, min: -0.18, max: 0.36, step: 0.08 },
  { id: 'curveAmplitude', semanticRole: 'axialCurvature', initial: 0.04, min: 0, max: 0.34, step: 0.07 },
  { id: 'limbLength', semanticRole: 'contactLimb', initial: 0.28, min: 0.12, max: 0.68, step: 0.09 },
  { id: 'limbSpread', semanticRole: 'contactFootprint', initial: 0.54, min: 0.3, max: 1.02, step: 0.1 },
  { id: 'limbThickness', semanticRole: 'contactLimb', initial: 0.09, min: 0.045, max: 0.22, step: 0.035 },
  { id: 'contactHeight', semanticRole: 'groundContact', initial: -0.25, min: -0.62, max: -0.08, step: 0.08 },
  { id: 'headLift', semanticRole: 'headOrientation', initial: 0.04, min: -0.18, max: 0.34, step: 0.07 },
]);

const COMPONENTS = {
  5120: { bytes: 1, read: 'getInt8' },
  5121: { bytes: 1, read: 'getUint8' },
  5122: { bytes: 2, read: 'getInt16' },
  5123: { bytes: 2, read: 'getUint16' },
  5125: { bytes: 4, read: 'getUint32' },
  5126: { bytes: 4, read: 'getFloat32' },
};
const TYPE_COUNTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a, scalar) => v3(a.x * scalar, a.y * scalar, a.z * scalar);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const length3 = value => Math.hypot(value.x, value.y, value.z);
const normalize = value => mul(value, 1 / Math.max(length3(value), 1e-9));

function canonicalCamera(camera) {
  const expected = REFERENCE_FIT_CAMERAS.find(item => item.id === camera?.id);
  if (!expected) throw new Error(`unknown camera: ${camera?.id ?? 'missing'}`);
  for (const key of ['projection', 'yaw', 'pitch', 'radius', 'viewportWidth', 'viewportHeight', 'near', 'far']) {
    if (camera[key] !== expected[key]) throw new Error(`camera substitution rejected for ${camera.id}: ${key}`);
  }
  return expected;
}

export function assertReferenceFitCameraSplit({ fitViewIds, heldOutViewIds }) {
  if (!Array.isArray(fitViewIds) || !Array.isArray(heldOutViewIds)) throw new TypeError('camera split requires arrays');
  const known = new Set(REFERENCE_FIT_CAMERAS.map(camera => camera.id));
  const fit = new Set(fitViewIds);
  const held = new Set(heldOutViewIds);
  if (fit.size !== fitViewIds.length || held.size !== heldOutViewIds.length) throw new Error('camera split contains duplicate IDs');
  for (const id of [...fit, ...held]) if (!known.has(id)) throw new Error(`unknown camera: ${id}`);
  for (const id of fit) if (held.has(id)) throw new Error(`camera split overlap: ${id}`);
  if (fit.size + held.size !== known.size || [...known].some(id => !fit.has(id) && !held.has(id))) {
    throw new Error('camera split must cover all eight canonical cameras');
  }
}

export function createReferenceFitAssayPlan({ donorPath, donorSha256, fitViewIds, heldOutViewIds }) {
  assertReferenceFitCameraSplit({ fitViewIds, heldOutViewIds });
  return {
    schema: 'kaminos.lirm-reference-fitted-armature-plan.v0',
    requestedRoute: REFERENCE_FIT_ROUTE,
    donor: { path: resolve(donorPath), sha256: donorSha256 },
    requestedCameraIds: REFERENCE_FIT_CAMERAS.map(camera => camera.id),
    fitViewIds: [...fitViewIds],
    heldOutViewIds: [...heldOutViewIds],
    parameterSpecs: REFERENCE_FIT_PARAMETER_SPECS,
    evidencePredicate: {
      allowCameraFallback: false,
      allowMissingOrPartialDonorEvidence: false,
      heldOutViewsMayInfluenceOptimization: false,
      requireHeldOutSilhouetteImprovementCount: 3,
      requireHeldOutMeanDepthImprovement: true,
    },
    falseClosureGuards: {
      productionCreatureClaim: 'forbidden',
      meshCopyClaim: 'forbidden',
      learnedPriorClaim: 'not_trained',
      topologySelectionClaim: 'not_assayed',
    },
  };
}

function identity4() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiply4(a, b) {
  const out = Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let k = 0; k < 4; k += 1) out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
    }
  }
  return out;
}

function trsMatrix(node) {
  if (Array.isArray(node.matrix)) return [...node.matrix];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const xx = x * x; const yy = y * y; const zz = z * z;
  const xy = x * y; const xz = x * z; const yz = y * z;
  const wx = w * x; const wy = w * y; const wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * sx, (2 * (xy + wz)) * sx, (2 * (xz - wy)) * sx, 0,
    (2 * (xy - wz)) * sy, (1 - 2 * (xx + zz)) * sy, (2 * (yz + wx)) * sy, 0,
    (2 * (xz + wy)) * sz, (2 * (yz - wx)) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function transformPoint(matrix, point) {
  return v3(
    matrix[0] * point.x + matrix[4] * point.y + matrix[8] * point.z + matrix[12],
    matrix[1] * point.x + matrix[5] * point.y + matrix[9] * point.z + matrix[13],
    matrix[2] * point.x + matrix[6] * point.y + matrix[10] * point.z + matrix[14],
  );
}

function parseGlb(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) {
    throw new Error('donor is not a GLB v2 file');
  }
  const declaredLength = bytes.readUInt32LE(8);
  if (declaredLength !== bytes.length) throw new Error(`GLB length mismatch: ${declaredLength} != ${bytes.length}`);
  let offset = 12;
  let json = null;
  let binary = null;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (data.length !== length) throw new Error('truncated GLB chunk');
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8').replace(/\0+\s*$/, ''));
    if (type === 0x004e4942) binary = data;
    offset += 8 + length;
  }
  if (!json || !binary) throw new Error('GLB requires JSON and BIN chunks');
  return { json, binary };
}

function readAccessor(gltf, binary, accessorIndex) {
  const accessor = gltf.accessors?.[accessorIndex];
  if (!accessor || accessor.sparse) throw new Error(`unsupported or missing accessor ${accessorIndex}`);
  const view = gltf.bufferViews?.[accessor.bufferView];
  const component = COMPONENTS[accessor.componentType];
  const count = TYPE_COUNTS[accessor.type];
  if (!view || !component || !count) throw new Error(`unsupported accessor layout ${accessorIndex}`);
  const stride = view.byteStride ?? component.bytes * count;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const dataView = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const rows = [];
  for (let index = 0; index < accessor.count; index += 1) {
    const row = [];
    for (let item = 0; item < count; item += 1) {
      row.push(dataView[component.read](start + index * stride + item * component.bytes, true));
    }
    rows.push(row);
  }
  return rows;
}

export async function loadGlbTriangleSoup(path) {
  const bytes = await readFile(path);
  const { json, binary } = parseGlb(bytes);
  const triangles = [];
  const scene = json.scenes?.[json.scene ?? 0];
  const roots = scene?.nodes ?? json.nodes?.map((_node, index) => index) ?? [];
  const visit = (nodeIndex, parentMatrix) => {
    const node = json.nodes?.[nodeIndex];
    if (!node) throw new Error(`missing GLB node ${nodeIndex}`);
    const world = multiply4(parentMatrix, trsMatrix(node));
    if (Number.isInteger(node.mesh)) {
      const mesh = json.meshes?.[node.mesh];
      for (const primitive of mesh?.primitives ?? []) {
        if ((primitive.mode ?? 4) !== 4 || !Number.isInteger(primitive.attributes?.POSITION)) continue;
        const positions = readAccessor(json, binary, primitive.attributes.POSITION)
          .map(([x, y, z]) => transformPoint(world, v3(x, y, z)));
        const indices = Number.isInteger(primitive.indices)
          ? readAccessor(json, binary, primitive.indices).map(([value]) => value)
          : positions.map((_value, index) => index);
        for (let index = 0; index + 2 < indices.length; index += 3) {
          triangles.push([positions[indices[index]], positions[indices[index + 1]], positions[indices[index + 2]]]);
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const root of roots) visit(root, identity4());
  if (triangles.length === 0) throw new Error('GLB donor produced no triangles');
  const points = triangles.flat();
  const mins = v3(Infinity, Infinity, Infinity);
  const maxs = v3(-Infinity, -Infinity, -Infinity);
  for (const point of points) {
    mins.x = Math.min(mins.x, point.x); mins.y = Math.min(mins.y, point.y); mins.z = Math.min(mins.z, point.z);
    maxs.x = Math.max(maxs.x, point.x); maxs.y = Math.max(maxs.y, point.y); maxs.z = Math.max(maxs.z, point.z);
  }
  const center = mul(add(mins, maxs), 0.5);
  const diagonal = Math.max(length3(sub(maxs, mins)), 1e-8);
  const scale = 2.15 / diagonal;
  const normalized = triangles.map(triangle => triangle.map(point => mul(sub(point, center), scale)));
  return {
    triangles: normalized,
    triangleCount: normalized.length,
    sourceBounds: { min: mins, max: maxs, center, diagonal },
    normalization: { kind: 'bbox-center-diagonal-scale', targetDiagonal: 2.15, scale },
    bytes: bytes.length,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

function cameraFrame(camera) {
  const position = v3(
    Math.sin(camera.yaw) * camera.radius * Math.cos(camera.pitch),
    Math.sin(camera.pitch) * camera.radius,
    Math.cos(camera.yaw) * camera.radius * Math.cos(camera.pitch),
  );
  const forward = normalize(mul(position, -1));
  const right = normalize(cross(forward, v3(0, 1, 0)));
  const up = normalize(cross(right, forward));
  return { position, forward, right, up };
}

function projectPoint(point, frame, camera, width, height) {
  const relative = sub(point, frame.position);
  return {
    x: (dot(relative, frame.right) / camera.viewportWidth + 0.5) * width,
    y: (0.5 - dot(relative, frame.up) / camera.viewportHeight) * height,
    depth: dot(relative, frame.forward),
  };
}

function rasterizeTriangleSoup({ triangles, camera, width, height }) {
  const exact = canonicalCamera(camera);
  const frame = cameraFrame(exact);
  const depth = new Float64Array(width * height).fill(Infinity);
  const mask = new Uint8Array(width * height);
  for (const triangle of triangles) {
    const [a, b, c] = triangle.map(point => projectPoint(point, frame, exact, width, height));
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(area) < 1e-9) continue;
    const minX = clamp(Math.floor(Math.min(a.x, b.x, c.x)), 0, width - 1);
    const maxX = clamp(Math.ceil(Math.max(a.x, b.x, c.x)), 0, width - 1);
    const minY = clamp(Math.floor(Math.min(a.y, b.y, c.y)), 0, height - 1);
    const maxY = clamp(Math.ceil(Math.max(a.y, b.y, c.y)), 0, height - 1);
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5; const py = y + 0.5;
        const w0 = ((b.x - px) * (c.y - py) - (b.y - py) * (c.x - px)) / area;
        const w1 = ((c.x - px) * (a.y - py) - (c.y - py) * (a.x - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-7 || w1 < -1e-7 || w2 < -1e-7) continue;
        const z = w0 * a.depth + w1 * b.depth + w2 * c.depth;
        const index = y * width + x;
        if (z < depth[index]) { depth[index] = z; mask[index] = 1; }
      }
    }
  }
  const normalizedDepth = new Float64Array(width * height);
  for (let index = 0; index < depth.length; index += 1) {
    normalizedDepth[index] = mask[index] ? clamp((depth[index] - exact.near) / (exact.far - exact.near), 0, 1) : 1;
  }
  return { cameraId: exact.id, width, height, mask, depth: normalizedDepth };
}

function parameterObject(parameters) {
  const out = {};
  for (const spec of REFERENCE_FIT_PARAMETER_SPECS) {
    const value = Number(parameters?.[spec.id]);
    if (!Number.isFinite(value)) throw new Error(`missing semantic parameter: ${spec.id}`);
    out[spec.id] = clamp(value, spec.min, spec.max);
  }
  return out;
}

function capsuleDistance(point, primitive) {
  const pa = sub(point, primitive.a);
  const ba = sub(primitive.b, primitive.a);
  const t = clamp(dot(pa, ba) / Math.max(dot(ba, ba), 1e-8), 0, 1);
  return length3(sub(pa, mul(ba, t))) - primitive.radius;
}

function ellipsoidDistance(point, primitive) {
  const q = sub(point, primitive.center);
  const normalized = v3(q.x / primitive.radius.x, q.y / primitive.radius.y, q.z / primitive.radius.z);
  return (length3(normalized) - 1) * Math.min(primitive.radius.x, primitive.radius.y, primitive.radius.z);
}

function smoothMin(a, b, radius = 0.065) {
  const h = clamp(0.5 + 0.5 * (b - a) / radius, 0, 1);
  return b * (1 - h) + a * h - radius * h * (1 - h);
}

export function createReferenceArmaturePrimitives(parameters) {
  const p = parameterObject(parameters);
  const primitives = [];
  const segmentCount = 5;
  for (let index = 0; index < segmentCount; index += 1) {
    const t = index / (segmentCount - 1);
    const axial = (t - 0.5) * p.bodyLength;
    const belly = Math.exp(-((t - 0.52) ** 2) / 0.085) * (p.bellyScale - 0.45);
    const posterior = t < 0.28 ? p.tailScale : 1;
    const anterior = t > 0.7 ? 0.82 + p.headScale * 0.18 : 1;
    const lateralCurve = Math.sin((t - 0.5) * Math.PI) * p.curveAmplitude;
    primitives.push({
      kind: 'ellipsoid', role: 'bodyMass',
      center: v3(lateralCurve, p.dorsalLift * (0.35 + 0.65 * t), axial),
      radius: v3(
        p.bodyWidth * (0.62 + belly * 0.42) * posterior * anterior,
        p.bodyHeight * (0.67 + belly * 0.34) * posterior,
        p.bodyLength * 0.19,
      ),
    });
  }
  const frontZ = p.bodyLength * 0.54;
  primitives.push({
    kind: 'ellipsoid', role: 'headOrientation',
    center: v3(p.curveAmplitude * 0.7, p.headLift + p.dorsalLift, frontZ),
    radius: v3(p.bodyWidth * (0.42 + p.headScale * 0.28), p.bodyHeight * (0.45 + p.headScale * 0.3), p.bodyLength * (0.13 + p.headScale * 0.05)),
  });
  const limbZs = [-0.27, 0.28];
  for (const longitudinal of limbZs) {
    for (const side of [-1, 1]) {
      const shoulder = v3(side * p.bodyWidth * 0.45, -p.bodyHeight * 0.18, longitudinal * p.bodyLength);
      const contactTarget = v3(side * p.limbSpread, p.contactHeight, longitudinal * p.bodyLength + (longitudinal > 0 ? 0.06 : -0.03));
      const foot = add(shoulder, mul(normalize(sub(contactTarget, shoulder)), p.limbLength));
      primitives.push({ kind: 'capsule', role: 'contactLimb', a: shoulder, b: foot, radius: p.limbThickness });
      primitives.push({
        kind: 'ellipsoid', role: 'groundContact', center: foot,
        radius: v3(p.limbThickness * 1.55, p.limbThickness * 0.72, p.limbThickness * 1.8),
      });
    }
  }
  return primitives;
}

function fieldDistance(point, primitives) {
  let distance = Infinity;
  for (const primitive of primitives) {
    const current = primitive.kind === 'capsule' ? capsuleDistance(point, primitive) : ellipsoidDistance(point, primitive);
    distance = distance === Infinity ? current : smoothMin(distance, current);
  }
  return distance;
}

export function renderReferenceArmature({ parameters, camera, width = 40, height = 32 }) {
  const exact = canonicalCamera(camera);
  const primitives = createReferenceArmaturePrimitives(parameters);
  const semanticRoles = [...new Set(primitives.map(primitive => primitive.role))];
  const frame = cameraFrame(exact);
  const mask = new Uint8Array(width * height);
  const depth = new Float64Array(width * height).fill(1);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const horizontal = ((x + 0.5) / width - 0.5) * exact.viewportWidth;
      const vertical = (0.5 - (y + 0.5) / height) * exact.viewportHeight;
      const origin = add(add(frame.position, mul(frame.right, horizontal)), mul(frame.up, vertical));
      let travel = exact.near;
      for (let step = 0; step < 72 && travel <= exact.far; step += 1) {
        const point = add(origin, mul(frame.forward, travel));
        const distance = fieldDistance(point, primitives);
        if (distance < 0.007) {
          const index = y * width + x;
          mask[index] = 1;
          depth[index] = clamp((travel - exact.near) / (exact.far - exact.near), 0, 1);
          break;
        }
        travel += clamp(distance * 0.72, 0.012, 0.11);
      }
    }
  }
  return { cameraId: exact.id, width, height, mask, depth, semanticRoles, primitiveCount: primitives.length };
}

function viewMetrics(donor, armature) {
  let intersection = 0; let union = 0; let donorCount = 0; let armatureCount = 0;
  let depthError = 0; let depthCount = 0;
  for (let index = 0; index < donor.mask.length; index += 1) {
    const a = donor.mask[index] ? 1 : 0;
    const b = armature.mask[index] ? 1 : 0;
    intersection += a && b ? 1 : 0;
    union += a || b ? 1 : 0;
    donorCount += a; armatureCount += b;
    if (a && b) { depthError += Math.abs(donor.depth[index] - armature.depth[index]); depthCount += 1; }
  }
  const iou = intersection / Math.max(union, 1);
  const depthMae = depthError / Math.max(depthCount, 1);
  const occupancyError = Math.abs(donorCount - armatureCount) / Math.max(donorCount, 1);
  return { iou, depthMae, occupancyError, donorPixels: donorCount, armaturePixels: armatureCount };
}

function aggregateMetrics(viewIds, donorById, armatureById) {
  const byView = {};
  for (const id of viewIds) byView[id] = viewMetrics(donorById[id], armatureById[id]);
  const values = Object.values(byView);
  return {
    byView,
    meanIou: values.reduce((sum, item) => sum + item.iou, 0) / values.length,
    meanDepthMae: values.reduce((sum, item) => sum + item.depthMae, 0) / values.length,
    meanOccupancyError: values.reduce((sum, item) => sum + item.occupancyError, 0) / values.length,
  };
}

function objective(metrics) {
  return (1 - metrics.meanIou) + metrics.meanDepthMae * 0.42 + metrics.meanOccupancyError * 0.12;
}

function renderViews(parameters, viewIds, width, height) {
  return Object.fromEntries(viewIds.map(id => {
    const camera = REFERENCE_FIT_CAMERAS.find(item => item.id === id);
    return [id, renderReferenceArmature({ parameters, camera, width, height })];
  }));
}

function fitReferenceArmature({ donorById, fitViewIds, width, height, passes = 4 }) {
  let parameters = Object.fromEntries(REFERENCE_FIT_PARAMETER_SPECS.map(spec => [spec.id, spec.initial]));
  const steps = Object.fromEntries(REFERENCE_FIT_PARAMETER_SPECS.map(spec => [spec.id, spec.step]));
  let renders = renderViews(parameters, fitViewIds, width, height);
  let metrics = aggregateMetrics(fitViewIds, donorById, renders);
  let score = objective(metrics);
  const trace = [{ pass: -1, parameterId: null, direction: 0, score, accepted: true }];
  for (let pass = 0; pass < passes; pass += 1) {
    for (const spec of REFERENCE_FIT_PARAMETER_SPECS) {
      let best = { parameters, renders, metrics, score, direction: 0 };
      for (const direction of [-1, 1]) {
        const candidate = { ...parameters, [spec.id]: clamp(parameters[spec.id] + steps[spec.id] * direction, spec.min, spec.max) };
        if (candidate[spec.id] === parameters[spec.id]) continue;
        const candidateRenders = renderViews(candidate, fitViewIds, width, height);
        const candidateMetrics = aggregateMetrics(fitViewIds, donorById, candidateRenders);
        const candidateScore = objective(candidateMetrics);
        if (candidateScore + 1e-8 < best.score) {
          best = { parameters: candidate, renders: candidateRenders, metrics: candidateMetrics, score: candidateScore, direction };
        }
      }
      const accepted = best.direction !== 0;
      ({ parameters, renders, metrics, score } = best);
      trace.push({ pass, parameterId: spec.id, direction: best.direction, value: parameters[spec.id], score, accepted });
    }
    for (const spec of REFERENCE_FIT_PARAMETER_SPECS) steps[spec.id] *= 0.58;
  }
  return { parameters, renders, metrics, score, trace };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const kind = Buffer.from(type);
  const header = Buffer.alloc(4); header.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([kind, data])));
  return Buffer.concat([header, kind, data, checksum]);
}

function encodeRgbPng(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1); raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 3;
      raw[row + 1 + x * 3] = pixels[source];
      raw[row + 2 + x * 3] = pixels[source + 1];
      raw[row + 3 + x * 3] = pixels[source + 2];
    }
  }
  return Buffer.concat([
    Buffer.from('\x89PNG\r\n\x1a\n', 'binary'), pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function paintCell(target, targetWidth, cellX, cellY, sourceWidth, sourceHeight, colorAt, scale = 3) {
  for (let y = 0; y < sourceHeight; y += 1) for (let x = 0; x < sourceWidth; x += 1) {
    const color = colorAt(y * sourceWidth + x);
    for (let yy = 0; yy < scale; yy += 1) for (let xx = 0; xx < scale; xx += 1) {
      const tx = cellX + x * scale + xx; const ty = cellY + y * scale + yy;
      const index = (ty * targetWidth + tx) * 3;
      target[index] = color[0]; target[index + 1] = color[1]; target[index + 2] = color[2];
    }
  }
}

function createWitnessSheet({ donorById, initialById, fittedById, width, height, mode }) {
  const scale = 3; const gap = 4; const header = 6;
  const cellWidth = width * scale; const cellHeight = height * scale;
  const outWidth = cellWidth * 5 + gap * 6;
  const outHeight = (cellHeight + header) * 8 + gap * 9;
  const pixels = new Uint8Array(outWidth * outHeight * 3).fill(18);
  REFERENCE_FIT_CAMERAS.forEach((camera, row) => {
    const donor = donorById[camera.id]; const initial = initialById[camera.id]; const fitted = fittedById[camera.id];
    const y0 = gap + row * (cellHeight + header + gap) + header;
    const headerColor = row % 2 ? [70, 116, 104] : [186, 143, 61];
    for (let y = y0 - header; y < y0 - 1; y += 1) for (let x = gap; x < outWidth - gap; x += 1) {
      const index = (y * outWidth + x) * 3; pixels.set(headerColor, index);
    }
    const sources = mode === 'depth'
      ? [
        index => { const value = donor.mask[index] ? Math.round((1 - donor.depth[index]) * 255) : 0; return [value, value, value]; },
        index => { const value = initial.mask[index] ? Math.round((1 - initial.depth[index]) * 255) : 0; return [value, value, value]; },
        index => { const value = fitted.mask[index] ? Math.round((1 - fitted.depth[index]) * 255) : 0; return [value, value, value]; },
        index => donor.mask[index] && fitted.mask[index] ? [Math.round(Math.abs(donor.depth[index] - fitted.depth[index]) * 900), 210, 110] : [0, 0, 0],
        index => donor.mask[index] && initial.mask[index] ? [Math.round(Math.abs(donor.depth[index] - initial.depth[index]) * 900), 120, 220] : [0, 0, 0],
      ]
      : [
        index => donor.mask[index] ? [238, 238, 232] : [0, 0, 0],
        index => initial.mask[index] ? [217, 156, 78] : [0, 0, 0],
        index => fitted.mask[index] ? [98, 208, 173] : [0, 0, 0],
        index => donor.mask[index] && fitted.mask[index] ? [240, 240, 240] : donor.mask[index] ? [230, 60, 68] : fitted.mask[index] ? [60, 126, 235] : [0, 0, 0],
        index => donor.mask[index] && initial.mask[index] ? [240, 240, 240] : donor.mask[index] ? [230, 60, 68] : initial.mask[index] ? [60, 126, 235] : [0, 0, 0],
      ];
    sources.forEach((colorAt, column) => paintCell(pixels, outWidth, gap + column * (cellWidth + gap), y0, width, height, colorAt, scale));
  });
  return { width: outWidth, height: outHeight, bytes: encodeRgbPng(outWidth, outHeight, pixels) };
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

export function validateReferenceFitReport(report, { requireFiles = true } = {}) {
  if (report?.schema !== 'kaminos.lirm-reference-fitted-armature-assay.v0') throw new Error('unexpected reference-fit report schema');
  if (report.requestedRoute !== REFERENCE_FIT_ROUTE || report.effectiveRoute !== REFERENCE_FIT_ROUTE) {
    throw new Error('reference-fit route identity mismatch');
  }
  const expectedCameraIds = REFERENCE_FIT_CAMERAS.map(camera => camera.id);
  if (JSON.stringify(report.requestedCameraIds) !== JSON.stringify(expectedCameraIds)
    || JSON.stringify(report.effectiveCameraIds) !== JSON.stringify(expectedCameraIds)) {
    throw new Error('effective camera coverage does not exactly match requested camera coverage');
  }
  assertReferenceFitCameraSplit({ fitViewIds: report.fitViewIds, heldOutViewIds: report.heldOutViewIds });
  if (typeof report.donor?.sha256 !== 'string' || !report.donor.sha256.startsWith('sha256:')) throw new Error('report requires donor hash');
  if (!Number.isInteger(report.donor?.triangleCount) || report.donor.triangleCount <= 0) throw new Error('report requires admitted donor triangles');
  const parameterIds = REFERENCE_FIT_PARAMETER_SPECS.map(spec => spec.id);
  for (const field of ['initialParameters', 'fittedParameters']) {
    if (JSON.stringify(Object.keys(report[field] ?? {})) !== JSON.stringify(parameterIds)) {
      throw new Error(`${field} semantic parameter IDs drifted`);
    }
  }
  if (!report.metrics?.initial?.heldOut || !report.metrics?.fitted?.heldOut) throw new Error('report requires held-out metrics');
  const startedAt = Date.parse(report.timing?.startedAt);
  const finishedAt = Date.parse(report.timing?.finishedAt);
  const durationSeconds = Number(report.timing?.durationSeconds);
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt
    || !Number.isFinite(durationSeconds) || durationSeconds < 0
    || Math.abs(durationSeconds - (finishedAt - startedAt) / 1000) > 0.02) {
    throw new Error('report timing is missing, non-monotonic, or inconsistent');
  }
  if (report.acceptance?.heldOutSilhouetteImprovementCount < 3 || report.acceptance?.heldOutDepthImproved !== true) {
    throw new Error('report does not satisfy held-out acceptance predicate');
  }
  const evidenceIds = report.outputInventory?.donorEvidence?.map(item => item.cameraId);
  if (JSON.stringify(evidenceIds) !== JSON.stringify(expectedCameraIds)) throw new Error('donor evidence camera coverage mismatch');
  const artifacts = [report.outputInventory?.primaryWitness, report.outputInventory?.depthWitness];
  for (const artifact of artifacts) {
    if (typeof artifact?.path !== 'string' || !Number.isInteger(artifact.bytes) || artifact.bytes <= 0) throw new Error('report requires nonempty witness artifacts');
    if (requireFiles) {
      if (!existsSync(artifact.path)) throw new Error(`missing witness artifact: ${artifact.path}`);
      if (statSync(artifact.path).size !== artifact.bytes) throw new Error(`witness artifact byte drift: ${artifact.path}`);
    }
  }
  if (report.status === 'assay-passed-inspected') {
    const inspection = report.acceptance?.visualInspection;
    if (!inspection || inspection.disposition !== 'accepted' || !Array.isArray(inspection.artifacts) || inspection.artifacts.length !== 2) {
      throw new Error('inspected status requires accepted inspection disposition and artifact hashes');
    }
    for (let index = 0; index < artifacts.length; index += 1) {
      const expected = artifacts[index];
      const inspected = inspection.artifacts[index];
      if (inspected?.path !== expected.path || inspected?.bytes !== expected.bytes) {
        throw new Error(`inspection artifact inventory mismatch: ${expected.path}`);
      }
      if (typeof inspected.sha256 !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(inspected.sha256)) {
        throw new Error(`inspection artifact hash is missing or malformed: ${expected.path}`);
      }
      if (requireFiles) {
        const currentHash = `sha256:${createHash('sha256').update(readFileSync(expected.path)).digest('hex')}`;
        if (currentHash !== inspected.sha256) throw new Error(`inspection artifact hash mismatch: ${expected.path}`);
      }
    }
  }
  return report;
}

export async function recordReferenceFitVisualInspection({ reportPath, disposition, visibleDelta, limitations = [] }) {
  if (!['accepted', 'rejected'].includes(disposition)) throw new Error('visual inspection disposition must be accepted or rejected');
  if (typeof visibleDelta !== 'string' || visibleDelta.trim().length < 20) throw new Error('visual inspection requires a concrete visible delta');
  if (!Array.isArray(limitations)) throw new TypeError('visual inspection limitations must be an array');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  validateReferenceFitReport(report);
  const artifacts = [];
  for (const item of [report.outputInventory.primaryWitness, report.outputInventory.depthWitness]) {
    const bytes = await readFile(item.path);
    if (bytes.length !== item.bytes) throw new Error(`witness artifact byte drift: ${item.path}`);
    artifacts.push({
      path: item.path,
      bytes: bytes.length,
      sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    });
  }
  report.acceptance.visualInspection = {
    disposition,
    visibleDelta: visibleDelta.trim(),
    limitations: [...limitations],
    artifacts,
  };
  report.status = disposition === 'accepted' ? 'assay-passed-inspected' : 'assay-visual-rejected';
  report.lastTrustworthyEvidence = disposition === 'accepted'
    ? 'exact-camera residual witnesses visually inspected and accepted'
    : 'exact-camera residual witnesses visually inspected and rejected';
  await writeJsonAtomic(resolve(reportPath), report);
  if (disposition === 'accepted') validateReferenceFitReport(report);
  return report;
}

export async function runReferenceFittedArmatureAssay({
  donorPath,
  outDir,
  fitViewIds = ['az000', 'az090', 'az180', 'az270'],
  heldOutViewIds = ['az045', 'az135', 'az225', 'az315'],
  width = 40,
  height = 32,
  passes = 4,
} = {}) {
  const outputRoot = resolve(outDir);
  await mkdir(outputRoot, { recursive: true });
  const startedAtMs = Date.now();
  const reportPath = resolve(outputRoot, 'report.json');
  const report = {
    schema: 'kaminos.lirm-reference-fitted-armature-assay.v0',
    status: 'running',
    failurePhase: null,
    requestedRoute: REFERENCE_FIT_ROUTE,
    effectiveRoute: null,
    requestedCameraIds: REFERENCE_FIT_CAMERAS.map(camera => camera.id),
    effectiveCameraIds: null,
    requestedFitViewIds: Array.isArray(fitViewIds) ? [...fitViewIds] : fitViewIds,
    requestedHeldOutViewIds: Array.isArray(heldOutViewIds) ? [...heldOutViewIds] : heldOutViewIds,
    fitViewIds: null,
    heldOutViewIds: null,
    timing: { startedAt: new Date(startedAtMs).toISOString(), finishedAt: null, durationSeconds: null },
    lastTrustworthyEvidence: 'invocation arguments recorded; camera split not yet validated',
    outputInventory: { primaryWitness: null, depthWitness: null, donorEvidence: [] },
  };
  await writeJsonAtomic(reportPath, report);
  let activePhase = 'camera-split-validation';
  try {
    assertReferenceFitCameraSplit({ fitViewIds, heldOutViewIds });
    report.fitViewIds = [...fitViewIds];
    report.heldOutViewIds = [...heldOutViewIds];
    report.lastTrustworthyEvidence = 'camera split validated; donor not yet admitted';
    activePhase = 'donor-admission';
    await writeJsonAtomic(reportPath, report);
    if (!existsSync(donorPath)) throw new Error(`missing donor: ${donorPath}`);
    const donor = await loadGlbTriangleSoup(donorPath);
    report.donor = {
      path: resolve(donorPath), bytes: donor.bytes, sha256: donor.sha256,
      triangleCount: donor.triangleCount, sourceBounds: donor.sourceBounds, normalization: donor.normalization,
    };
    report.plan = createReferenceFitAssayPlan({ donorPath, donorSha256: donor.sha256, fitViewIds, heldOutViewIds });
    report.lastTrustworthyEvidence = `${donor.triangleCount} donor triangles admitted and normalized`;
    activePhase = 'donor-evidence';
    await writeJsonAtomic(reportPath, report);

    const donorById = {};
    for (const camera of REFERENCE_FIT_CAMERAS) {
      donorById[camera.id] = rasterizeTriangleSoup({ triangles: donor.triangles, camera, width, height });
      const foreground = donorById[camera.id].mask.reduce((sum, item) => sum + item, 0);
      if (foreground < Math.max(8, width * height * 0.01)) throw new Error(`partial donor evidence for ${camera.id}: ${foreground} pixels`);
    }
    report.effectiveCameraIds = REFERENCE_FIT_CAMERAS.map(camera => camera.id);
    report.effectiveRoute = REFERENCE_FIT_ROUTE;
    report.lastTrustworthyEvidence = 'all eight exact-camera donor mask/depth views admitted';
    activePhase = 'fit-or-witness';
    await writeJsonAtomic(reportPath, report);

    const initialParameters = Object.fromEntries(REFERENCE_FIT_PARAMETER_SPECS.map(spec => [spec.id, spec.initial]));
    const allViewIds = REFERENCE_FIT_CAMERAS.map(camera => camera.id);
    const initialById = renderViews(initialParameters, allViewIds, width, height);
    const fit = fitReferenceArmature({ donorById, fitViewIds, width, height, passes });
    const fittedById = renderViews(fit.parameters, allViewIds, width, height);
    const initialFitMetrics = aggregateMetrics(fitViewIds, donorById, initialById);
    const fittedFitMetrics = aggregateMetrics(fitViewIds, donorById, fittedById);
    const initialHeldOutMetrics = aggregateMetrics(heldOutViewIds, donorById, initialById);
    const fittedHeldOutMetrics = aggregateMetrics(heldOutViewIds, donorById, fittedById);
    const heldOutSilhouetteImprovementCount = heldOutViewIds.filter(id => (
      fittedHeldOutMetrics.byView[id].iou > initialHeldOutMetrics.byView[id].iou + 1e-6
    )).length;
    const heldOutDepthImproved = fittedHeldOutMetrics.meanDepthMae < initialHeldOutMetrics.meanDepthMae;
    const boundPinnedParameters = REFERENCE_FIT_PARAMETER_SPECS.filter(spec => (
      Math.abs(fit.parameters[spec.id] - spec.min) < 1e-8 || Math.abs(fit.parameters[spec.id] - spec.max) < 1e-8
    )).map(spec => spec.id);

    const silhouetteSheet = createWitnessSheet({ donorById, initialById, fittedById, width, height, mode: 'silhouette' });
    const depthSheet = createWitnessSheet({ donorById, initialById, fittedById, width, height, mode: 'depth' });
    const silhouettePath = resolve(outputRoot, 'silhouette-residual-witness.png');
    const depthPath = resolve(outputRoot, 'depth-residual-witness.png');
    await writeFile(silhouettePath, silhouetteSheet.bytes);
    await writeFile(depthPath, depthSheet.bytes);
    report.status = heldOutSilhouetteImprovementCount >= 3 && heldOutDepthImproved ? 'assay-passed-uninspected' : 'assay-missed-threshold-uninspected';
    report.initialParameters = initialParameters;
    report.fittedParameters = fit.parameters;
    report.parameterSpecs = REFERENCE_FIT_PARAMETER_SPECS;
    report.optimization = { kind: 'deterministic-bounded-coordinate-search', passes, objective: fit.score, trace: fit.trace };
    report.metrics = { initial: { fit: initialFitMetrics, heldOut: initialHeldOutMetrics }, fitted: { fit: fittedFitMetrics, heldOut: fittedHeldOutMetrics } };
    report.acceptance = {
      heldOutSilhouetteImprovementCount,
      requiredHeldOutSilhouetteImprovementCount: 3,
      heldOutDepthImproved,
      boundPinnedParameters,
      semanticParameterIdsStable: true,
      visualInspection: 'pending',
    };
    report.outputInventory = {
      primaryWitness: { path: silhouettePath, bytes: silhouetteSheet.bytes.length, columns: ['donor', 'initial', 'fitted', 'fitted-overlay', 'initial-overlay'] },
      depthWitness: { path: depthPath, bytes: depthSheet.bytes.length, columns: ['donor', 'initial', 'fitted', 'fitted-depth-error', 'initial-depth-error'] },
      donorEvidence: allViewIds.map(id => ({ cameraId: id, kind: 'software-raster-mask-depth', width, height })),
    };
    report.falseClosureGuards = report.plan.falseClosureGuards;
    report.lastTrustworthyEvidence = 'fit and held-out metrics computed; visual witness written but not inspected';
    const finishedAtMs = Date.now();
    report.timing.finishedAt = new Date(finishedAtMs).toISOString();
    report.timing.durationSeconds = (finishedAtMs - startedAtMs) / 1000;
    if (report.status === 'assay-passed-uninspected') validateReferenceFitReport(report);
    await writeJsonAtomic(reportPath, report);
    return report;
  } catch (error) {
    report.status = 'failed';
    report.failurePhase = activePhase;
    report.error = String(error?.stack ?? error);
    const finishedAtMs = Date.now();
    report.timing.finishedAt = new Date(finishedAtMs).toISOString();
    report.timing.durationSeconds = (finishedAtMs - startedAtMs) / 1000;
    await writeJsonAtomic(reportPath, report);
    throw error;
  }
}
