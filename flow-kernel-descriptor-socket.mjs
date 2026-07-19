export const FLOW_KERNEL_DESCRIPTOR_SOCKET_IDENTITY = 'flow-kernel-local-descriptor-socket-v0';
export const FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS = 100;

const CONSUMED_FIELDS = Object.freeze(['sidecar', 'material', 'fire', 'micro']);
const COMPONENTS = Object.freeze(['x', 'y', 'z', 'w']);
const AXES = Object.freeze(['x', 'y', 'z']);

export const FLOW_KERNEL_DESCRIPTOR_ORDER = Object.freeze([
  'position.world.x', 'position.world.y', 'position.world.z', 'position.nativeCellIndex',
  'kernel.normalizedMass', 'kernel.firstMoment.x', 'kernel.firstMoment.y', 'kernel.firstMoment.z',
  'kernel.covariance.xx', 'kernel.covariance.xy', 'kernel.covariance.xz', 'kernel.covariance.yy',
  'kernel.covariance.yz', 'kernel.covariance.zz', 'kernel.radiusWorld', 'kernel.coherence',
  'structure.normal.x', 'structure.normal.y', 'structure.normal.z', 'structure.normalValid',
  'flow.tangent.x', 'flow.tangent.y', 'flow.tangent.z', 'flow.coherence',
  'flow.curl.x', 'flow.curl.y', 'flow.curl.z', 'flow.curlMagnitude',
  'flow.divergence', 'flow.curlActivity', 'validity.strengthZeroIdentity', 'validity.conservativeMajorant',
  'majorant.density', 'majorant.fire', 'majorant.extinction', 'majorant.importance',
  ...CONSUMED_FIELDS.flatMap(field => COMPONENTS.map(component => `value.${field}.${component}`)),
  ...CONSUMED_FIELDS.flatMap(field => AXES.flatMap(axis => COMPONENTS.map(component => `gradient.${field}.${component}.${axis}`))),
]);

if (FLOW_KERNEL_DESCRIPTOR_ORDER.length !== FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS) {
  throw new Error(`flow kernel descriptor order has ${FLOW_KERNEL_DESCRIPTOR_ORDER.length} entries, expected ${FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS}`);
}

function finite(value, label) {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`${label} must be finite`);
  return result;
}

function stable(value) {
  return Number(Number(value).toPrecision(15));
}

function normalizeTangent(tangent) {
  if (!Array.isArray(tangent) && !ArrayBuffer.isView(tangent)) throw new Error('kernel tangent must have three finite components');
  const vector = [finite(tangent[0], 'kernel tangent x'), finite(tangent[1], 'kernel tangent y'), finite(tangent[2], 'kernel tangent z')];
  const length = Math.hypot(...vector);
  if (length <= 1e-12) throw new Error('kernel tangent must be nonzero');
  return vector.map(value => value / length);
}

export function flowKernelMomentDescriptor({ strength, radiusWorld, tangent }) {
  const effectiveStrength = Math.max(0, Math.min(1, finite(strength, 'kernel strength')));
  const requestedRadius = Math.max(0, finite(radiusWorld, 'kernel radius'));
  const direction = normalizeTangent(tangent);
  const strengthZeroIdentity = effectiveStrength === 0;
  const effectiveRadiusWorld = strengthZeroIdentity ? 0 : requestedRadius;
  const variance = 0.5 * effectiveStrength * requestedRadius * requestedRadius;
  return {
    normalizedMass: 1,
    firstMoment: [0, 0, 0],
    covariance: {
      xx: stable(variance * direction[0] * direction[0]),
      xy: stable(variance * direction[0] * direction[1]),
      xz: stable(variance * direction[0] * direction[2]),
      yy: stable(variance * direction[1] * direction[1]),
      yz: stable(variance * direction[1] * direction[2]),
      zz: stable(variance * direction[2] * direction[2]),
    },
    effectiveRadiusWorld,
    strengthZeroIdentity,
  };
}

function validateControls(controls, label) {
  if (!controls || typeof controls !== 'object') throw new Error(`${label} controls are missing`);
  return {
    strength: finite(controls.strength, `${label} strength`),
    radiusWorld: finite(controls.radiusWorld, `${label} radiusWorld`),
    coherence: finite(controls.coherence, `${label} coherence`),
  };
}

function validateSourceHashes(sourceHashes) {
  const required = ['fluidSha256', 'frontSha256', 'boundarySidecarSha256', 'majorantSha256'];
  const result = {};
  for (const key of required) {
    const value = sourceHashes?.[key];
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) throw new Error(`authoritative source hash ${key} is missing or malformed`);
    result[key] = value.toLowerCase();
  }
  if (sourceHashes.sourceManifestSha256 != null) {
    const value = sourceHashes.sourceManifestSha256;
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) throw new Error('authoritative source hash sourceManifestSha256 is malformed');
    result.sourceManifestSha256 = value.toLowerCase();
  }
  return result;
}

export function decodeFlowKernelDescriptorCapture(values, rowCount, capacity, metadata, { includeRows = true } = {}) {
  if (!(values instanceof Float32Array)) throw new Error('flow kernel descriptor values must be a Float32Array');
  if (!Number.isInteger(rowCount) || rowCount <= 0) throw new Error('flow kernel descriptor row count must be a positive integer');
  if (!Number.isInteger(capacity) || capacity <= 0 || rowCount > capacity) throw new Error('flow kernel descriptor row count exceeds capacity');
  const expectedLength = rowCount * FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS;
  if (values.length !== expectedLength) throw new Error(`flow kernel descriptor must contain exactly ${expectedLength} values, received ${values.length}`);
  const requestedControls = validateControls(metadata?.requestedControls, 'requested kernel');
  const effectiveControls = validateControls(metadata?.effectiveControls, 'effective kernel');
  if (metadata?.kernelIdentity !== 'flow-tangent-positive-symmetric-trilinear-v0') throw new Error('flow kernel descriptor kernel identity mismatch');
  const sourceHashes = validateSourceHashes(metadata?.sourceHashes);
  const strengthZeroIdentity = effectiveControls.strength === 0;
  const minima = new Array(FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS).fill(Number.POSITIVE_INFINITY);
  const maxima = new Array(FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS).fill(Number.NEGATIVE_INFINITY);
  const sums = new Array(FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS).fill(0);
  const rows = includeRows ? new Array(rowCount) : null;
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const row = new Array(FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS);
    const offset = rowIndex * FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS;
    for (let featureIndex = 0; featureIndex < FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS; featureIndex += 1) {
      const value = values[offset + featureIndex];
      if (!Number.isFinite(value)) throw new Error(`flow kernel descriptor contains non-finite value at row ${rowIndex}, feature ${featureIndex}`);
      row[featureIndex] = value;
      minima[featureIndex] = Math.min(minima[featureIndex], value);
      maxima[featureIndex] = Math.max(maxima[featureIndex], value);
      sums[featureIndex] += value;
    }
    if (Math.abs(row[4] - 1) > 1e-5) throw new Error(`flow kernel descriptor row ${rowIndex} has non-normalized mass ${row[4]}`);
    const expectedIdentityFlag = strengthZeroIdentity ? 1 : 0;
    if (Math.abs(row[30] - expectedIdentityFlag) > 1e-5) {
      throw new Error(`flow kernel descriptor row ${rowIndex} strength-zero identity flag disagrees with effective controls`);
    }
    if (strengthZeroIdentity) {
      const covarianceMax = Math.max(...row.slice(8, 14).map(value => Math.abs(value)));
      if (covarianceMax > 1e-7 || Math.abs(row[14]) > 1e-7) {
        throw new Error(`flow kernel descriptor row ${rowIndex} violates strength-zero identity moments`);
      }
    }
    if (rows) rows[rowIndex] = row;
  }
  const capture = {
    identity: FLOW_KERNEL_DESCRIPTOR_SOCKET_IDENTITY,
    descriptorOrder: [...FLOW_KERNEL_DESCRIPTOR_ORDER],
    strideFloats: FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS,
    rowCount,
    capacity,
    cameraIndependent: true,
    kernel: {
      identity: metadata.kernelIdentity,
      requestedControls,
      effectiveControls,
      strengthZeroIdentity,
      normalizedMass: 1,
      literalTapsExposed: false,
    },
    sourceHashes,
    statistics: FLOW_KERNEL_DESCRIPTOR_ORDER.map((descriptor, index) => ({
      descriptor,
      min: minima[index],
      max: maxima[index],
      mean: sums[index] / rowCount,
    })),
  };
  if (rows) capture.rows = rows;
  return capture;
}
