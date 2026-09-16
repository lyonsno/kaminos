export const WEBGPU_ROUTE_RECEIPT_SCHEMA = 'kaminos.webgpu-route-receipt.v0';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function requireString(errors, value, path) {
  if (!isNonEmptyString(value)) errors.push(`${path} must be a non-empty string`);
}

function requireArray(errors, value, path) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${path} must be a non-empty array`);
  }
}

export function createWebGpuLocalRouteReceipt(input) {
  const status = input.status || (input.fallbackReason ? 'fallback' : 'real');
  return {
    schema: WEBGPU_ROUTE_RECEIPT_SCHEMA,
    requestedRouteId: input.requestedRouteId,
    effectiveRouteId: input.effectiveRouteId,
    status,
    fallbackReason: input.fallbackReason || null,
    backend: clone(input.backend),
    model: clone(input.model),
    kernel: clone(input.kernel),
    inputs: clone(input.inputs || []),
    outputs: clone(input.outputs || []),
    timings: clone(input.timings),
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

export function validateRouteReceipt(receipt) {
  const errors = [];

  if (!receipt || typeof receipt !== 'object') {
    return { ok: false, errors: ['receipt must be an object'] };
  }

  if (receipt.schema !== WEBGPU_ROUTE_RECEIPT_SCHEMA) {
    errors.push(`schema must be ${WEBGPU_ROUTE_RECEIPT_SCHEMA}`);
  }

  requireString(errors, receipt.requestedRouteId, 'requestedRouteId');
  requireString(errors, receipt.effectiveRouteId, 'effectiveRouteId');
  requireString(errors, receipt.status, 'status');

  if (!receipt.backend || typeof receipt.backend !== 'object') {
    errors.push('backend must be an object');
  } else {
    if (receipt.backend.kind !== 'webgpu-local') {
      errors.push('backend.kind must be webgpu-local');
    }
    requireString(errors, receipt.backend.runtime, 'backend.runtime');
  }

  if (!receipt.model || typeof receipt.model !== 'object') {
    errors.push('model must be an object');
  } else {
    requireString(errors, receipt.model.id, 'model.id');
    requireString(errors, receipt.model.revision, 'model.revision');
    requireString(errors, receipt.model.weightsHash, 'model.weightsHash');
    requireString(errors, receipt.model.dtype, 'model.dtype');
  }

  if (!receipt.kernel || typeof receipt.kernel !== 'object') {
    errors.push('kernel must be an object');
  } else {
    requireString(errors, receipt.kernel.kitVersion, 'kernel.kitVersion');
    requireString(errors, receipt.kernel.profile, 'kernel.profile');
  }

  requireArray(errors, receipt.inputs, 'inputs');
  if (Array.isArray(receipt.inputs)) {
    receipt.inputs.forEach((input, index) => {
      requireString(errors, input?.role, `inputs[${index}].role`);
      requireString(errors, input?.artifactId, `inputs[${index}].artifactId`);
      requireString(errors, input?.sha256, `inputs[${index}].sha256`);
    });
  }

  requireArray(errors, receipt.outputs, 'outputs');
  if (Array.isArray(receipt.outputs)) {
    receipt.outputs.forEach((output, index) => {
      requireString(errors, output?.role, `outputs[${index}].role`);
      requireString(errors, output?.artifactId, `outputs[${index}].artifactId`);
      requireString(errors, output?.sha256, `outputs[${index}].sha256`);
      requireString(errors, output?.status, `outputs[${index}].status`);
      if (!Array.isArray(output?.shape) || output.shape.length === 0 || !output.shape.every(Number.isInteger)) {
        errors.push(`outputs[${index}].shape must be a non-empty integer array`);
      }
    });
  }

  if (!receipt.timings || typeof receipt.timings !== 'object') {
    errors.push('timings must be an object');
  } else {
    requireString(errors, receipt.timings.source, 'timings.source');
    if (!isFiniteNonNegative(receipt.timings.totalMs)) {
      errors.push('timings.totalMs must be a finite non-negative number');
    }
    if (receipt.timings.stages != null && !Array.isArray(receipt.timings.stages)) {
      errors.push('timings.stages must be an array when present');
    }
  }

  if (receipt.status === 'fallback' && !isNonEmptyString(receipt.fallbackReason)) {
    errors.push('fallback receipts must include fallbackReason');
  }

  return { ok: errors.length === 0, errors };
}

export function assertAuthoritativeRouteReceipt(receipt) {
  const result = validateRouteReceipt(receipt);
  if (!result.ok) {
    throw new Error(`invalid route receipt: ${result.errors.join('; ')}`);
  }

  if (receipt.status !== 'real') {
    throw new Error(`not authoritative: receipt status is ${receipt.status}`);
  }
  if (receipt.fallbackReason) {
    throw new Error(`not authoritative: fallback reason present (${receipt.fallbackReason})`);
  }

  for (const output of receipt.outputs) {
    if (output.status === 'partial') {
      throw new Error(`partial output is not authoritative: ${output.role}`);
    }
    if (output.status !== 'real') {
      throw new Error(`output is not authoritative: ${output.role} status=${output.status}`);
    }
  }

  return receipt;
}
