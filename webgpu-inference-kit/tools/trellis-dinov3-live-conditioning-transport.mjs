import { createHash } from 'node:crypto';

export const TRELLIS_DINO_CONDITIONING_SHAPE = Object.freeze([1, 1029, 1024]);
export const TRELLIS_DINO_CONDITIONING_BYTE_LENGTH = TRELLIS_DINO_CONDITIONING_SHAPE.reduce((count, axis) => count * axis, 1) * 4;

function requireSha256(name, value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) throw new TypeError(`${name} must be a SHA-256 hex digest`);
  return value.toLowerCase();
}

function requireRevision(name, value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/i.test(value)) throw new TypeError(`${name} must be a full Git revision`);
  return value.toLowerCase();
}

function loopbackUrl(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new TypeError('conditioning sink URL must be an absolute loopback HTTP URL'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) {
    throw new TypeError('conditioning sink URL must use unauthenticated loopback HTTP; tensor bytes must stay on this host');
  }
  return url;
}

export function validateLiveConditioningSinkUrl(value) {
  return loopbackUrl(value).href;
}

function tensorBytes(value) {
  if (!(value instanceof Uint8Array)) throw new TypeError('conditioning tensor bytes must be a Uint8Array or Buffer');
  if (value.byteLength !== TRELLIS_DINO_CONDITIONING_BYTE_LENGTH) {
    throw new RangeError(`conditioning tensor byte length ${value.byteLength}; expected ${TRELLIS_DINO_CONDITIONING_BYTE_LENGTH}`);
  }
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  let nonzero = false;
  for (let offset = 0; offset < value.byteLength; offset += 4) {
    const number = view.getFloat32(offset, true);
    if (!Number.isFinite(number)) throw new TypeError(`conditioning tensor contains a non-finite F32 value at element ${offset / 4}`);
    if (number !== 0) nonzero = true;
  }
  if (!nonzero) throw new TypeError('conditioning tensor is blank/all-zero and cannot be forwarded as live model input');
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function buildEnvelope(provenance, bytes, sha256) {
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) throw new TypeError('conditioning provenance must be an object');
  const textFields = [
    'requestId', 'producerProcess', 'producerSessionId', 'producerRouteId',
    'modelId',
  ];
  for (const field of textFields) if (typeof provenance[field] !== 'string' || !provenance[field].trim()) throw new TypeError(`conditioning provenance ${field} is required`);
  if (!Number.isSafeInteger(provenance.producerPid) || provenance.producerPid <= 0) throw new TypeError('conditioning provenance producerPid must be a positive process id');

  const producerSourceRevision = requireRevision('producerSourceRevision', provenance.producerSourceRevision);
  const consumerModelReferenceRevision = requireRevision('consumerModelReferenceRevision', provenance.consumerModelReferenceRevision);
  const consumerDinoSourceSha256 = requireSha256('consumerDinoSourceSha256', provenance.consumerDinoSourceSha256);
  const sourceImageSha256 = requireSha256('sourceImageSha256', provenance.sourceImageSha256);
  const modelWeightsSha256 = requireSha256('modelWeightsSha256', provenance.modelWeightsSha256);
  const preprocessedPixelsSha256 = requireSha256('preprocessedPixelsSha256', provenance.preprocessedPixelsSha256);
  const modelRevision = requireRevision('modelRevision', provenance.modelRevision);

  return {
    schema: 'kaminos.trellis-dinov3-live-conditioning.v1',
    requestId: provenance.requestId,
    producer: {
      process: provenance.producerProcess,
      pid: provenance.producerPid,
      sessionId: provenance.producerSessionId,
      repository: 'kaminos',
      sourceRevision: producerSourceRevision,
      routeId: provenance.producerRouteId,
    },
    consumerReference: {
      repository: 'trellis2mlx',
      modelReference: {
        revision: consumerModelReferenceRevision,
        dinov3SourceSha256: consumerDinoSourceSha256,
      },
      expectedNegativeConditioning: 'mx.zeros_like(cond) in the pinned native single-image route; not observed by this producer transfer',
    },
    input: {
      imageSha256: sourceImageSha256,
      model: { id: provenance.modelId, revision: modelRevision, weightsSha256: modelWeightsSha256 },
      preprocessedPixelsSha256,
    },
    tensor: {
      name: 'cond',
      dtype: 'float32',
      byteOrder: 'little-endian',
      layout: 'BSH',
      shape: TRELLIS_DINO_CONDITIONING_SHAPE,
      byteLength: bytes.byteLength,
      sha256,
    },
    transfer: {
      from: 'WebGPU-owned DINOv3 conditioning tensor',
      via: 'Chrome host F32 readback -> Kaminos Node smoke process -> loopback HTTP body',
      semantics: 'host readback and loopback HTTP copy; receiving process, MLX array allocation, and sampler consumption are unobserved; not same-device or zero-copy',
    },
  };
}

export async function forwardF32ConditioningTensor({ url, bytes: rawBytes, provenance }) {
  const sink = loopbackUrl(url);
  const bytes = tensorBytes(rawBytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const envelope = buildEnvelope(provenance, bytes, sha256);
  const envelopeBase64 = Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url');
  const response = await fetch(sink, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(bytes.byteLength),
      'x-request-id': envelope.requestId,
      'x-tensor-name': envelope.tensor.name,
      'x-tensor-dtype': envelope.tensor.dtype,
      'x-tensor-shape': envelope.tensor.shape.join(','),
      'x-tensor-sha256': sha256,
      'x-kaminos-conditioning-envelope': envelopeBase64,
    },
    body: bytes,
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`live TRELLIS conditioning sink returned HTTP ${response.status}: ${responseText}`);
  return {
    status: response.status,
    statusText: response.statusText,
    responseText,
    requestUrl: sink.href,
    envelope,
    tensor: envelope.tensor,
  };
}
