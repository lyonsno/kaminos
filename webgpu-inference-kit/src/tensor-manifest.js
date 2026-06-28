const MANIFEST_SCHEMA = 'kaminos.tensor-manifest.v0';

const BYTES_PER_ELEMENT = new Map([
  ['fp32', 4],
  ['f32', 4],
  ['fp16', 2],
  ['f16', 2],
  ['u32', 4],
  ['i32', 4],
  ['u8', 1],
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function tensorElements(shape) {
  if (!Array.isArray(shape) || shape.length === 0 || !shape.every(Number.isInteger)) {
    return null;
  }
  if (shape.some(dim => dim <= 0)) return null;
  return shape.reduce((product, dim) => product * dim, 1);
}

export function defineTensorManifest(input) {
  const tensors = (input.tensors || []).map(tensor => {
    const elements = tensorElements(tensor.shape);
    const bytesPerElement = BYTES_PER_ELEMENT.get(tensor.dtype) || null;
    return {
      ...tensor,
      elements,
      bytesPerElement,
    };
  });

  return {
    schema: MANIFEST_SCHEMA,
    modelId: input.modelId,
    revision: input.revision,
    weightFormat: input.weightFormat || MANIFEST_SCHEMA,
    tensors,
  };
}

export function validateTensorManifest(manifest) {
  const errors = [];

  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, errors: ['manifest must be an object'] };
  }

  if (manifest.schema !== MANIFEST_SCHEMA) {
    errors.push(`schema must be ${MANIFEST_SCHEMA}`);
  }
  if (!isNonEmptyString(manifest.modelId)) errors.push('modelId must be a non-empty string');
  if (!isNonEmptyString(manifest.revision)) errors.push('revision must be a non-empty string');
  if (!Array.isArray(manifest.tensors) || manifest.tensors.length === 0) {
    errors.push('tensors must be a non-empty array');
  }

  if (Array.isArray(manifest.tensors)) {
    manifest.tensors.forEach((tensor, index) => {
      if (!isNonEmptyString(tensor.name)) errors.push(`tensors[${index}].name must be a non-empty string`);
      if (!BYTES_PER_ELEMENT.has(tensor.dtype)) errors.push(`tensors[${index}] unsupported dtype ${tensor.dtype}`);
      const elements = tensorElements(tensor.shape);
      if (elements == null) errors.push(`tensors[${index}].shape must contain positive integer dimensions`);
      if (!Number.isInteger(tensor.byteOffset) || tensor.byteOffset < 0) {
        errors.push(`tensors[${index}].byteOffset must be a non-negative integer`);
      }
      if (!Number.isInteger(tensor.byteLength) || tensor.byteLength < 0) {
        errors.push(`tensors[${index}].byteLength must be a non-negative integer`);
      }
      const bytesPerElement = BYTES_PER_ELEMENT.get(tensor.dtype);
      if (elements != null && bytesPerElement != null && tensor.byteLength !== elements * bytesPerElement) {
        errors.push(`tensors[${index}].byteLength must equal shape elements * dtype size`);
      }
    });
  }

  return { ok: errors.length === 0, errors };
}
