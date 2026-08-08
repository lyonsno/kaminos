// Browser-safe proxy-rig evaluation kernel. Preparation and receipt production
// remain in proxy-rig-core.mjs; live consumers share these exact numerics.

export const PROXY_RIG_RUNTIME_SCHEMA = 'kaminos.proxy-rig-runtime.v0';
export const PROXY_RIG_PACKAGE_SCHEMA = 'kaminos.proxy-rig-package.v0';
export const PROXY_POSE_RUN_SCHEMA = 'kaminos.proxy-pose-run.v0';

function fail(message) {
  throw new Error(`Proxy rig package: ${message}`);
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function requireArray(value, label, { length = null, multipleOf = null } = {}) {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) fail(`${label} must be an array`);
  if (length !== null && value.length !== length) fail(`${label} length ${value.length} != ${length}`);
  if (multipleOf !== null && value.length % multipleOf !== 0) fail(`${label} length must be a multiple of ${multipleOf}`);
  for (let i = 0; i < value.length; i += 1) {
    if (typeof value[i] !== 'number' || !Number.isFinite(value[i])) fail(`${label}[${i}] must be finite`);
  }
  return value;
}

function requireIndexArray(value, label, limit, options = {}) {
  requireArray(value, label, options);
  for (let i = 0; i < value.length; i += 1) {
    if (!Number.isInteger(value[i]) || value[i] < 0 || value[i] >= limit) {
      fail(`${label}[${i}] is outside [0, ${limit})`);
    }
  }
  return value;
}

export function canonicalProxyRigJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalProxyRigJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalProxyRigJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function computeProxyRigPackageId(input) {
  const pkg = requireObject(input, 'root');
  const { packageId: _claimedPackageId, ...content } = pkg;
  if (!globalThis.crypto?.subtle) fail('Web Crypto SHA-256 is unavailable');
  const bytes = new TextEncoder().encode(canonicalProxyRigJson(content));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}

export async function verifyProxyRigPackageIdentity(input) {
  const pkg = requireObject(input, 'root');
  if (typeof pkg.packageId !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(pkg.packageId)) {
    fail('package id must be a SHA-256 identity');
  }
  const computed = await computeProxyRigPackageId(pkg);
  if (computed !== pkg.packageId) fail(`package id ${pkg.packageId} does not match content ${computed}`);
  return computed;
}

function rotationFromAxisAngle(axis, angleDeg) {
  const angle = (angleDeg * Math.PI) / 180;
  const len = Math.hypot(...axis) || 1;
  if (Math.abs(angleDeg) < 1e-9) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const [x, y, z] = axis.map(v => v / len);
  const c = Math.cos(angle); const s = Math.sin(angle); const t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}

function normalizeQuaternion(value, label = 'quaternion') {
  requireArray(value, label, { length: 4 });
  const length = Math.hypot(...value);
  if (length < 1e-12) fail(`${label} must have non-zero length`);
  return Array.from(value, component => Number(component) / length);
}

function rotationFromQuaternion(value) {
  const [x, y, z, w] = normalizeQuaternion(value);
  const xx = x * x; const yy = y * y; const zz = z * z;
  const xy = x * y; const xz = x * z; const yz = y * z;
  const wx = w * x; const wy = w * y; const wz = w * z;
  return [
    [1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy)],
    [2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx)],
    [2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy)],
  ];
}

// pose: { [groupName]: { quaternion: [x,y,z,w] | axis + angleDeg, pivot?: override } }
export function poseEnvelope({ envelopeInCastFrame, skinBinding, pose }) {
  const { weightGroups, weightValues, neighbors, groups } = skinBinding;
  const transforms = groups.map(group => {
    const spec = pose[group.name];
    if (!spec) return null;
    return {
      rotation: spec.quaternion
        ? rotationFromQuaternion(spec.quaternion)
        : rotationFromAxisAngle(spec.axis, spec.angleDeg),
      pivot: spec.pivot ?? group.pivot,
    };
  });
  const vertexCount = envelopeInCastFrame.positions.length / 3;
  const posed = envelopeInCastFrame.positions.slice();
  for (let v = 0; v < vertexCount; v += 1) {
    const px = posed[v * 3]; const py = posed[v * 3 + 1]; const pz = posed[v * 3 + 2];
    let ox = 0; let oy = 0; let oz = 0;
    for (let k = 0; k < neighbors; k += 1) {
      const g = weightGroups[v * neighbors + k];
      const w = weightValues[v * neighbors + k];
      const t = g >= 0 ? transforms[g] : null;
      if (!t) { ox += w * px; oy += w * py; oz += w * pz; continue; }
      const [cx, cy, cz] = t.pivot;
      const x = px - cx; const y = py - cy; const z = pz - cz;
      ox += w * (t.rotation[0][0] * x + t.rotation[0][1] * y + t.rotation[0][2] * z + cx);
      oy += w * (t.rotation[1][0] * x + t.rotation[1][1] * y + t.rotation[1][2] * z + cy);
      oz += w * (t.rotation[2][0] * x + t.rotation[2][1] * y + t.rotation[2][2] * z + cz);
    }
    posed[v * 3] = ox; posed[v * 3 + 1] = oy; posed[v * 3 + 2] = oz;
  }
  return { positions: posed, triangles: envelopeInCastFrame.triangles };
}

export function buildCastAdjacency(cast) {
  const vertexCount = cast.positions.length / 3;
  const key = v => `${cast.positions[v * 3].toFixed(6)},${cast.positions[v * 3 + 1].toFixed(6)},${cast.positions[v * 3 + 2].toFixed(6)}`;
  const canon = new Map();
  const vid = new Int32Array(vertexCount);
  for (let v = 0; v < vertexCount; v += 1) {
    const k = key(v);
    if (!canon.has(k)) canon.set(k, v);
    vid[v] = canon.get(k);
  }
  const adjacency = new Map();
  const link = (a, b) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    adjacency.get(a).add(b);
  };
  const { triangles } = cast;
  for (let t = 0; t < triangles.length; t += 3) {
    const a = vid[triangles[t]]; const b = vid[triangles[t + 1]]; const c = vid[triangles[t + 2]];
    link(a, b); link(b, a); link(b, c); link(c, b); link(a, c); link(c, a);
  }
  return { vid, adjacency };
}

export function smoothDisplacementField({
  cast,
  posedPositions,
  adjacency: adjacencyInput = null,
  iterations = 15,
  lambda = 0.6,
}) {
  const { vid, adjacency } = adjacencyInput ?? buildCastAdjacency(cast);
  const vertexCount = cast.positions.length / 3;
  let disp = new Map();
  for (let v = 0; v < vertexCount; v += 1) {
    const c = vid[v];
    if (!disp.has(c)) {
      disp.set(c, [
        posedPositions[v * 3] - cast.positions[v * 3],
        posedPositions[v * 3 + 1] - cast.positions[v * 3 + 1],
        posedPositions[v * 3 + 2] - cast.positions[v * 3 + 2],
      ]);
    }
  }
  for (let iter = 0; iter < iterations; iter += 1) {
    const next = new Map();
    for (const [v, d] of disp) {
      const neighbors = adjacency.get(v);
      if (!neighbors || neighbors.size === 0) { next.set(v, d); continue; }
      const mean = [0, 0, 0];
      for (const n of neighbors) {
        const nd = disp.get(n) ?? [0, 0, 0];
        mean[0] += nd[0]; mean[1] += nd[1]; mean[2] += nd[2];
      }
      const inv = 1 / neighbors.size;
      next.set(v, [
        d[0] + lambda * (mean[0] * inv - d[0]),
        d[1] + lambda * (mean[1] * inv - d[1]),
        d[2] + lambda * (mean[2] * inv - d[2]),
      ]);
    }
    disp = next;
  }
  const out = new Float64Array(cast.positions.length);
  for (let v = 0; v < vertexCount; v += 1) {
    const d = disp.get(vid[v]);
    out[v * 3] = cast.positions[v * 3] + d[0];
    out[v * 3 + 1] = cast.positions[v * 3 + 1] + d[1];
    out[v * 3 + 2] = cast.positions[v * 3 + 2] + d[2];
  }
  return out;
}

export function poseCastThroughProxy({ cast, posedEnvelope, castBinding }) {
  const { positions, triangles } = posedEnvelope;
  const vertexCount = cast.positions.length / 3;
  const posed = new Float64Array(cast.positions.length);
  for (let v = 0; v < vertexCount; v += 1) {
    const t = castBinding.triangle[v];
    const ia = triangles[t * 3] * 3; const ib = triangles[t * 3 + 1] * 3; const ic = triangles[t * 3 + 2] * 3;
    const e0x = positions[ib] - positions[ia]; const e0y = positions[ib + 1] - positions[ia + 1]; const e0z = positions[ib + 2] - positions[ia + 2];
    const e1x = positions[ic] - positions[ia]; const e1y = positions[ic + 1] - positions[ia + 1]; const e1z = positions[ic + 2] - positions[ia + 2];
    let nx = e0y * e1z - e0z * e1y;
    let ny = e0z * e1x - e0x * e1z;
    let nz = e0x * e1y - e0y * e1x;
    const nLen = Math.hypot(nx, ny, nz) || 1e-18;
    nx /= nLen; ny /= nLen; nz /= nLen;
    const a = castBinding.local[v * 3];
    const b = castBinding.local[v * 3 + 1];
    const c = castBinding.local[v * 3 + 2];
    posed[v * 3] = positions[ia] + a * e0x + b * e1x + c * nx;
    posed[v * 3 + 1] = positions[ia + 1] + a * e0y + b * e1y + c * ny;
    posed[v * 3 + 2] = positions[ia + 2] + a * e0z + b * e1z + c * nz;
  }
  return { positions: posed, triangles: cast.triangles };
}

function hydrateProxyRigPackage(input, expectedPackageId = null) {
  const pkg = requireObject(input, 'root');
  if (pkg.schema !== PROXY_RIG_PACKAGE_SCHEMA) {
    fail(`schema ${String(pkg.schema)} != ${PROXY_RIG_PACKAGE_SCHEMA}`);
  }
  if (pkg.runtimeSchema !== PROXY_RIG_RUNTIME_SCHEMA) {
    fail(`runtime schema ${String(pkg.runtimeSchema)} != ${PROXY_RIG_RUNTIME_SCHEMA}`);
  }
  if (typeof pkg.packageId !== 'string' || !pkg.packageId.trim()) fail('package id is required');
  if (expectedPackageId && pkg.packageId !== expectedPackageId) {
    fail(`package id ${pkg.packageId} != requested ${expectedPackageId}`);
  }
  const source = requireObject(pkg.source, 'source');
  for (const key of ['cast', 'envelope', 'skeleton']) {
    if (typeof source[key] !== 'string' || !source[key].trim()) fail(`source.${key} is required`);
  }

  const envelopeInput = requireObject(pkg.envelope, 'envelope');
  requireArray(envelopeInput.positions, 'envelope positions', { multipleOf: 3 });
  const envelopeVertexCount = envelopeInput.positions.length / 3;
  requireIndexArray(envelopeInput.triangles, 'envelope triangles', envelopeVertexCount, { multipleOf: 3 });
  const envelopeTriangleCount = envelopeInput.triangles.length / 3;

  const castInput = requireObject(pkg.cast, 'cast');
  requireArray(castInput.positions, 'cast positions', { multipleOf: 3 });
  const castVertexCount = castInput.positions.length / 3;
  requireIndexArray(castInput.triangles, 'cast triangles', castVertexCount, { multipleOf: 3 });

  const skinInput = requireObject(pkg.skinBinding, 'skin binding');
  if (!Number.isInteger(skinInput.neighbors) || skinInput.neighbors < 1) {
    fail('skin binding neighbors must be a positive integer');
  }
  if (!Array.isArray(skinInput.groups) || skinInput.groups.length === 0) fail('skin binding groups are required');
  const names = new Set();
  const groups = skinInput.groups.map((value, index) => {
    const group = requireObject(value, `skin binding group ${index}`);
    if (typeof group.name !== 'string' || !group.name.trim()) fail(`skin binding group ${index} name is required`);
    if (names.has(group.name)) fail(`skin binding group name ${group.name} is duplicated`);
    names.add(group.name);
    requireArray(group.pivot, `skin binding group ${group.name} pivot`, { length: 3 });
    return { name: group.name, pivot: Array.from(group.pivot, Number) };
  });
  const weightCount = envelopeVertexCount * skinInput.neighbors;
  requireArray(skinInput.weightGroups, 'skin binding weight groups', { length: weightCount });
  requireArray(skinInput.weightValues, 'skin binding weight values', { length: weightCount });
  for (let i = 0; i < weightCount; i += 1) {
    const groupIndex = Number(skinInput.weightGroups[i]);
    if (!Number.isInteger(groupIndex) || groupIndex < -1 || groupIndex >= groups.length) {
      fail(`skin binding weight groups[${i}] is invalid`);
    }
    const weight = skinInput.weightValues[i];
    if (weight < 0) fail(`skin binding weight values[${i}] must be nonnegative`);
    if (groupIndex === -1 && weight !== 0) {
      fail(`skin binding weight values[${i}] must be zero for an unbound group`);
    }
  }
  for (let vertex = 0; vertex < envelopeVertexCount; vertex += 1) {
    let total = 0;
    for (let neighbor = 0; neighbor < skinInput.neighbors; neighbor += 1) {
      total += skinInput.weightValues[vertex * skinInput.neighbors + neighbor];
    }
    if (Math.abs(total - 1) > 1e-6) {
      fail(`skin binding weights for envelope vertex ${vertex} must sum to one (got ${total})`);
    }
  }

  const castBindingInput = requireObject(pkg.castBinding, 'cast binding');
  requireIndexArray(castBindingInput.triangle, 'cast binding triangle', envelopeTriangleCount, { length: castVertexCount });
  requireArray(castBindingInput.local, 'cast binding local', { length: castVertexCount * 3 });

  return {
    schema: pkg.schema,
    runtimeSchema: pkg.runtimeSchema,
    packageId: pkg.packageId,
    source: { ...source },
    envelope: {
      positions: Float64Array.from(envelopeInput.positions),
      triangles: Uint32Array.from(envelopeInput.triangles),
    },
    cast: {
      positions: Float64Array.from(castInput.positions),
      triangles: Uint32Array.from(castInput.triangles),
    },
    skinBinding: {
      groups,
      neighbors: skinInput.neighbors,
      weightGroups: Int16Array.from(skinInput.weightGroups),
      weightValues: Float64Array.from(skinInput.weightValues),
    },
    castBinding: {
      triangle: Int32Array.from(castBindingInput.triangle),
      local: Float64Array.from(castBindingInput.local),
    },
  };
}

export function createProxyRigEvaluator(input, {
  expectedPackageId = null,
  smooth = true,
  smoothingIterations = 15,
  smoothingLambda = 0.6,
} = {}) {
  const packageData = hydrateProxyRigPackage(input, expectedPackageId);
  const adjacency = smooth ? buildCastAdjacency(packageData.cast) : null;
  return {
    packageId: packageData.packageId,
    runtimeSchema: packageData.runtimeSchema,
    source: packageData.source,
    groups: packageData.skinBinding.groups.map(group => ({ ...group, pivot: [...group.pivot] })),
    cast: packageData.cast,
    evaluate(pose = {}) {
      const posedEnvelope = poseEnvelope({
        envelopeInCastFrame: packageData.envelope,
        skinBinding: packageData.skinBinding,
        pose,
      });
      const posedCast = poseCastThroughProxy({
        cast: packageData.cast,
        posedEnvelope,
        castBinding: packageData.castBinding,
      });
      if (!smooth) return posedCast;
      return {
        positions: smoothDisplacementField({
          cast: packageData.cast,
          posedPositions: posedCast.positions,
          adjacency,
          iterations: smoothingIterations,
          lambda: smoothingLambda,
        }),
        triangles: packageData.cast.triangles,
      };
    },
  };
}

function slerpQuaternion(aInput, bInput, amount) {
  const a = normalizeQuaternion(aInput, 'pose quaternion');
  let b = normalizeQuaternion(bInput, 'pose quaternion');
  let dot = a.reduce((sum, value, index) => sum + value * b[index], 0);
  if (dot < 0) {
    b = b.map(value => -value);
    dot = -dot;
  }
  if (dot > 0.9995) {
    return normalizeQuaternion(a.map((value, index) => value + amount * (b[index] - value)), 'pose quaternion');
  }
  const theta = Math.acos(Math.min(1, dot));
  const sinTheta = Math.sin(theta);
  const left = Math.sin((1 - amount) * theta) / sinTheta;
  const right = Math.sin(amount * theta) / sinTheta;
  return a.map((value, index) => left * value + right * b[index]);
}

function validatePoseFrame(frame, index) {
  requireObject(frame, `pose frame ${index}`);
  if (!Number.isFinite(frame.tMs) || frame.tMs < 0) fail(`pose frame ${index} tMs must be non-negative`);
  requireObject(frame.pose, `pose frame ${index} pose`);
  const pose = {};
  for (const [name, transform] of Object.entries(frame.pose)) {
    requireObject(transform, `pose frame ${index} control ${name}`);
    pose[name] = { quaternion: normalizeQuaternion(transform.quaternion, `pose frame ${index} control ${name} quaternion`) };
  }
  return { tMs: frame.tMs, pose };
}

export function createProxyPoseRun({ packageId, frames }) {
  if (typeof packageId !== 'string' || !packageId.trim()) fail('pose run package id is required');
  if (!Array.isArray(frames) || frames.length === 0) fail('pose run frames are required');
  const normalized = frames.map(validatePoseFrame);
  requireMonotonicFrameTimes(normalized);
  return { schema: PROXY_POSE_RUN_SCHEMA, packageId, frames: normalized };
}

function requireMonotonicFrameTimes(frames) {
  for (let i = 1; i < frames.length; i += 1) {
    if (frames[i].tMs < frames[i - 1].tMs) fail('pose run frame times must be monotonic');
  }
}

export function sampleProxyPoseRun(input, tMs, { expectedPackageId = null } = {}) {
  const run = requireObject(input, 'pose run');
  if (run.schema !== PROXY_POSE_RUN_SCHEMA) fail(`pose run schema ${String(run.schema)} is unsupported`);
  if (expectedPackageId && run.packageId !== expectedPackageId) {
    fail(`pose run package id ${String(run.packageId)} != requested ${expectedPackageId}`);
  }
  if (!Array.isArray(run.frames) || run.frames.length === 0) fail('pose run frames are required');
  const frames = run.frames.map(validatePoseFrame);
  requireMonotonicFrameTimes(frames);
  if (tMs <= frames[0].tMs) return frames[0].pose;
  if (tMs >= frames.at(-1).tMs) return frames.at(-1).pose;
  let upper = 1;
  while (frames[upper].tMs < tMs) upper += 1;
  const a = frames[upper - 1]; const b = frames[upper];
  const amount = (tMs - a.tMs) / Math.max(1e-12, b.tMs - a.tMs);
  const names = new Set([...Object.keys(a.pose), ...Object.keys(b.pose)]);
  const pose = {};
  for (const name of names) {
    const aq = a.pose[name]?.quaternion ?? [0, 0, 0, 1];
    const bq = b.pose[name]?.quaternion ?? [0, 0, 0, 1];
    pose[name] = { quaternion: slerpQuaternion(aq, bq, amount) };
  }
  return pose;
}
