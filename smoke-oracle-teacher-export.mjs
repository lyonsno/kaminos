import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const FULL_GRID_FIELD_EXPORT_SCHEMA = 'kaminos.volume.full-grid-field-export.v0';
export const FULL_GRID_FIELD_EXPORT_IDENTITY = 'full-grid-fluid-front-boundary-sidecars-v0';
export const FULL_GRID_FIELD_CHUNK_IDENTITY = 'full-grid-fluid-field-chunked-readback-v0';
export const NATIVE_RAYMARCH_ROUTE_IDENTITY = 'native-3d-compute-fluid-raymarch-v0';
export const VOLUME_PROTOTYPE_IDENTITY = 'kaminos-volume-prototype-v0';
export const VOLUME_FULL_GRID_FIELD_CHANNEL_ORDER = Object.freeze([
  'velocityX', 'velocityY', 'velocityZ', 'densityCarrier',
  'smokeDensity', 'heat', 'fuel', 'detail',
  'flame', 'ember', 'visibleFireCarrier', 'combustionFront',
  'microdetail', 'interfaceShred', 'fireLick', 'emberFleck',
]);

function identity(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function integer(value, label) {
  const number = finite(value, label);
  if (!Number.isInteger(number)) throw new TypeError(`${label} must be an integer`);
  return number;
}

function positiveInteger(value, label) {
  const number = integer(value, label);
  if (number <= 0) throw new RangeError(`${label} must be positive`);
  return number;
}

function nonNegativeInteger(value, label) {
  const number = integer(value, label);
  if (number < 0) throw new RangeError(`${label} must be non-negative`);
  return number;
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function requireFiniteArray(value, length, label) {
  if (!Array.isArray(value) || value.length !== length || !value.every(Number.isFinite)) {
    throw new TypeError(`${label} must be a finite ${length}-element array`);
  }
  return value;
}

function sameArray(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function validateNativeCamera(value, label) {
  const camera = requireObject(value, label);
  if (camera.identity !== 'checksum-bound-native-camera-matrices-v0') throw new Error(`${label} identity mismatch`);
  requireFiniteArray(camera.position, 3, `${label}.position`);
  requireFiniteArray(camera.target, 3, `${label}.target`);
  requireFiniteArray(camera.projectionMatrix, 16, `${label}.projectionMatrix`);
  requireFiniteArray(camera.matrixWorldInverse, 16, `${label}.matrixWorldInverse`);
  return camera;
}

function sameNativeCamera(left, right) {
  return left.identity === right.identity
    && sameArray(left.position, right.position)
    && sameArray(left.target, right.target)
    && sameArray(left.projectionMatrix, right.projectionMatrix)
    && sameArray(left.matrixWorldInverse, right.matrixWorldInverse);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function validateMetadata(metadata) {
  const source = requireObject(metadata, 'metadata');
  if (source.identity !== FULL_GRID_FIELD_CHUNK_IDENTITY) throw new Error('chunk metadata identity mismatch');
  if (source.exportIdentity !== FULL_GRID_FIELD_EXPORT_IDENTITY) throw new Error('chunk metadata export identity mismatch');
  if (source.status !== 'captured') throw new Error('chunk metadata must be captured');
  if (source.effectiveRoute !== NATIVE_RAYMARCH_ROUTE_IDENTITY) {
    throw new Error(`effective route must be ${NATIVE_RAYMARCH_ROUTE_IDENTITY}`);
  }
  if (source.prototypeIdentity !== VOLUME_PROTOTYPE_IDENTITY) throw new Error('prototype identity mismatch');
  if (typeof source.backend !== 'string' || !source.backend.startsWith('WebGPU:')) throw new Error('backend must preserve WebGPU identity');
  if (!['render-only-frozen-sim-state', 'sim-advanced-frame-readback'].includes(source.sampleAuthority)) {
    throw new Error('sample authority must preserve frozen or explicit stepped simulator state');
  }
  const grid = positiveInteger(source.grid, 'metadata.grid');
  const totalByteLength = positiveInteger(source.totalByteLength, 'metadata.totalByteLength');
  const floatCount = positiveInteger(source.floatCount, 'metadata.floatCount');
  if (floatCount * Float32Array.BYTES_PER_ELEMENT !== totalByteLength) {
    throw new Error('metadata float count does not match byte length');
  }
  const expectedFloatCount = grid ** 3 * VOLUME_FULL_GRID_FIELD_CHANNEL_ORDER.length;
  if (floatCount !== expectedFloatCount) throw new Error(`metadata float count does not match full grid shape ${grid}`);
  if (!sameArray(source.channelOrder, VOLUME_FULL_GRID_FIELD_CHANNEL_ORDER)) throw new Error('metadata channel order mismatch');
  const replay = requireObject(source.deterministicReplay, 'metadata.deterministicReplay');
  if (replay.identity !== 'deterministic-replay-same-route-controls-fixed-step-v0') throw new Error('deterministic replay identity mismatch');
  if (replay.authority !== 'same-route-controls-fixed-step-replay') throw new Error('deterministic replay authority mismatch');
  if (replay.grid !== grid) throw new Error('deterministic replay grid does not match metadata grid');
  if (replay.effectiveRoute !== source.effectiveRoute) throw new Error('deterministic replay effectiveRoute does not match metadata');
  if (replay.prototypeIdentity !== source.prototypeIdentity) throw new Error('deterministic replay prototypeIdentity does not match metadata');
  if (replay.backend !== source.backend) throw new Error('deterministic replay backend does not match metadata');
  identity(replay.controlsSignature, 'deterministicReplay.controlsSignature');
  const camera = validateNativeCamera(source.camera, 'camera');
  const replayCamera = validateNativeCamera(replay.camera, 'deterministic replay camera');
  if (!sameNativeCamera(camera, replayCamera)) {
    throw new Error('camera does not match deterministic replay camera');
  }
  const step = integer(replay.simStepCount ?? replay.completedSteps, 'deterministicReplay.simStepCount');
  return { source, grid, totalByteLength, floatCount, replay: { ...replay, simStepCount: step, completedSteps: step } };
}

function materializeChunks({ chunks, totalByteLength }) {
  if (!Array.isArray(chunks) || chunks.length === 0) throw new TypeError('chunks must be a non-empty array');
  const buffer = Buffer.alloc(totalByteLength);
  let expectedOffset = 0;
  for (const [index, chunk] of chunks.entries()) {
    requireObject(chunk, `chunks[${index}]`);
    const offsetBytes = nonNegativeInteger(chunk.offsetBytes, `chunks[${index}].offsetBytes`);
    const byteLength = positiveInteger(chunk.byteLength, `chunks[${index}].byteLength`);
    if (offsetBytes !== expectedOffset) throw new Error(`chunk offset ${offsetBytes} does not continue complete field at ${expectedOffset}`);
    const bytes = Buffer.from(identity(chunk.packedBase64, `chunks[${index}].packedBase64`), 'base64');
    if (bytes.byteLength !== byteLength) throw new Error(`chunk ${index} byte length mismatch`);
    if (offsetBytes + byteLength > totalByteLength) throw new Error(`chunk ${index} exceeds total byte length`);
    bytes.copy(buffer, offsetBytes);
    expectedOffset += byteLength;
  }
  if (expectedOffset !== totalByteLength) throw new Error(`chunk set is incomplete: ${expectedOffset}/${totalByteLength} bytes`);
  return buffer;
}

export async function materializeSmokeOracleTeacherFrameExport({
  outDir,
  frameId,
  metadata,
  chunks,
} = {}) {
  const destination = identity(outDir, 'outDir');
  const label = identity(frameId, 'frameId');
  const { source, grid, totalByteLength, floatCount, replay } = validateMetadata(metadata);
  const bytes = materializeChunks({ chunks, totalByteLength });
  const digest = sha256(bytes);
  const fluidPath = `${label}.fluid.f32`;
  const manifestPath = join(destination, `${label}.manifest.json`);
  const sidecarPath = join(destination, fluidPath);
  const worldSpace = source.worldSpace ? { ...source.worldSpace } : null;
  const camera = source.camera ? structuredClone(source.camera) : null;
  const manifest = {
    schema: FULL_GRID_FIELD_EXPORT_SCHEMA,
    identity: FULL_GRID_FIELD_EXPORT_IDENTITY,
    status: 'captured',
    completeFieldCoverage: true,
    effectiveRoute: source.effectiveRoute,
    prototypeIdentity: source.prototypeIdentity,
    backend: source.backend,
    sampleAuthority: source.sampleAuthority,
    grid,
    fluidChannelOrder: VOLUME_FULL_GRID_FIELD_CHANNEL_ORDER,
    worldSpace,
    camera,
    sidecars: {
      fluid: {
        kind: 'fluid',
        dtype: 'float32',
        byteOrder: 'little-endian',
        floatCount,
        byteLength: bytes.byteLength,
        shape: [grid, grid, grid, VOLUME_FULL_GRID_FIELD_CHANNEL_ORDER.length],
        channelOrder: VOLUME_FULL_GRID_FIELD_CHANNEL_ORDER,
        path: fluidPath,
        sha256: digest,
      },
    },
    deterministicReplay: replay,
  };
  await mkdir(destination, { recursive: true });
  await writeFile(sidecarPath, bytes);
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const manifestBytes = await readFile(manifestPath);
  return {
    manifestPath,
    manifestIdentity: `sha256:${sha256(manifestBytes)}`,
    fluidPath: sidecarPath,
    fluidIdentity: `sha256:${digest}`,
    byteLength: bytes.byteLength,
    manifest,
  };
}
