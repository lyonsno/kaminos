export const SMOKE_SPLAT_GPU_PRODUCT_SCHEMA = 'kaminos.smoke-splat-gpu-product.v1';
export const SMOKE_SPLAT_PACKING_IDENTITY = 'float32x16-axisymmetric-smoke-v0';
export const SMOKE_SPLAT_DIRECT_DRAW_AUTHORITY = 'cpu-active-count-direct-v0';
export const SMOKE_SPLAT_INDIRECT_DRAW_AUTHORITY = 'gpu-active-count-indirect-v0';

const PACKED_SPLAT_BYTES = 16 * Float32Array.BYTES_PER_ELEMENT;
const destroyedProducts = new WeakSet();
const destroyedBuffers = new WeakSet();

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function identity(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function nonnegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new TypeError(`${label} must be a nonnegative integer`);
  return number;
}

function destroyBuffer(buffer) {
  if (!buffer || destroyedBuffers.has(buffer)) return;
  buffer.destroy?.();
  destroyedBuffers.add(buffer);
}

export function validateSmokeSplatGpuProduct(candidate, { device = null } = {}) {
  const product = object(candidate, 'smoke splat GPU product');
  if (product.schema !== SMOKE_SPLAT_GPU_PRODUCT_SCHEMA) throw new Error('smoke splat GPU product schema mismatch');
  identity(product.identity, 'smoke splat GPU product identity');
  identity(product.producerAuthority, 'smoke splat GPU producer authority');
  identity(product.compilerIdentity, 'smoke splat GPU compiler identity');
  identity(product.ownership, 'smoke splat GPU ownership');
  if (device && product.device !== device) throw new Error('smoke splat GPU product device mismatch');
  if (!product.packedBuffer?.destroy) throw new Error('smoke splat GPU product has no owned packed buffer');

  const capacity = nonnegativeInteger(product.capacity, 'smoke splat GPU product capacity');
  if (capacity === 0) throw new Error('smoke splat GPU product capacity must be positive');
  const activeCount = nonnegativeInteger(product.activeCount, 'smoke splat GPU product activeCount');
  if (activeCount > capacity) throw new Error('smoke splat GPU product activeCount exceeds capacity');
  const packedByteLength = nonnegativeInteger(product.packedByteLength, 'smoke splat GPU packedByteLength');
  if (packedByteLength !== capacity * PACKED_SPLAT_BYTES) {
    throw new Error('smoke splat GPU packedByteLength does not match capacity');
  }

  const counts = object(product.hierarchyCounts, 'smoke splat GPU hierarchyCounts');
  const coarse = nonnegativeInteger(counts.coarse, 'smoke splat GPU coarse count');
  const fine = nonnegativeInteger(counts.fine, 'smoke splat GPU fine count');
  const total = nonnegativeInteger(counts.total, 'smoke splat GPU total count');
  if (total !== activeCount || coarse + fine !== total) {
    throw new Error('smoke splat GPU hierarchy counts do not match activeCount');
  }

  const representation = object(product.representation, 'smoke splat GPU representation');
  const requestedIdentity = identity(representation.requestedIdentity, 'requested smoke representation');
  const effectiveIdentity = identity(representation.effectiveIdentity, 'effective smoke representation');
  if (requestedIdentity !== effectiveIdentity || representation.fallbackReason !== null) {
    throw new Error(`requested and effective smoke representations disagree: ${requestedIdentity} != ${effectiveIdentity}`);
  }
  if (representation.packingIdentity !== SMOKE_SPLAT_PACKING_IDENTITY) {
    throw new Error('smoke splat GPU packing identity mismatch');
  }
  if (representation.activeRecordsPackedFirst !== true) {
    throw new Error('active smoke splat records must be packed first');
  }
  if (representation.outputWasTruncated !== false) {
    throw new Error('smoke splat GPU product cannot hide truncated output');
  }

  const draw = object(product.draw, 'smoke splat GPU draw descriptor');
  if (draw.mode === 'direct') {
    if (draw.authority !== SMOKE_SPLAT_DIRECT_DRAW_AUTHORITY) throw new Error('direct smoke draw authority mismatch');
  } else if (draw.mode === 'indirect') {
    if (draw.authority !== SMOKE_SPLAT_INDIRECT_DRAW_AUTHORITY) throw new Error('indirect smoke draw authority mismatch');
    if (!draw.indirectBuffer) throw new Error('indirect smoke draw requires an indirectBuffer');
    const indirectOffset = nonnegativeInteger(draw.indirectOffset, 'indirect smoke draw offset');
    if (indirectOffset % 4 !== 0) throw new Error('indirect smoke draw offset must be 4-byte aligned');
    if (!['product-owned-destroy-on-evict-v0', 'borrowed-do-not-destroy-v0'].includes(draw.ownership)) {
      throw new Error('indirect smoke draw ownership mismatch');
    }
    if (draw.ownership === 'product-owned-destroy-on-evict-v0'
        && draw.indirectBuffer !== product.packedBuffer
        && typeof draw.indirectBuffer.destroy !== 'function') {
      throw new Error('product-owned indirectBuffer must expose destroy()');
    }
  } else {
    throw new Error(`unsupported smoke splat draw mode: ${draw.mode}`);
  }
  return product;
}

export function destroySmokeSplatGpuProduct(product) {
  if (!product || typeof product !== 'object' || destroyedProducts.has(product)) return;
  destroyBuffer(product.packedBuffer);
  if (product.draw?.mode === 'indirect'
      && product.draw.ownership === 'product-owned-destroy-on-evict-v0'
      && product.draw.indirectBuffer !== product.packedBuffer) {
    destroyBuffer(product.draw.indirectBuffer);
  }
  destroyedProducts.add(product);
}
