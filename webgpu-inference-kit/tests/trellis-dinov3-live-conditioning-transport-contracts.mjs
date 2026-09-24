import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
let forwardF32ConditioningTensor;
try {
  ({ forwardF32ConditioningTensor } = await import('../tools/trellis-dinov3-live-conditioning-transport.mjs'));
} catch (error) {
  if (error?.code === 'ERR_MODULE_NOT_FOUND') {
    assert.fail('the WebGPU conditioner has no model-specific raw-F32 live consumer transport');
  }
  throw error;
}

const tensorShape = [1, 1029, 1024];
const byteLength = tensorShape.reduce((count, axis) => count * axis, 1) * 4;
const bytes = Buffer.alloc(byteLength);
for (let offset = 0; offset < bytes.byteLength; offset += 4) {
  bytes.writeFloatLE((offset / 4 % 127) / 127, offset);
}
const provenance = {
  requestId: 'trellis-dinov3-live-conditioning-test-001',
  producerProcess: 'Chrome',
  producerPid: 4123,
  producerSessionId: 'trellis-dinov3-full-conditioning-test-001',
  producerSourceRevision: 'a'.repeat(40),
  producerRouteId: 'trellis2.dinov3.block0-through-full-conditioning.resident-session-probe.webgpu-local.v0',
  sourceImageSha256: 'b'.repeat(64),
  modelId: 'facebook/dinov3-vitl16-pretrain-lvd1689m',
  modelRevision: 'c'.repeat(40),
  modelWeightsSha256: 'd'.repeat(64),
  preprocessedPixelsSha256: 'e'.repeat(64),
  consumerModelReferenceRevision: 'f'.repeat(40),
  consumerDinoSourceSha256: '1'.repeat(64),
};
const browserPage = readFileSync(new URL('../smokes/trellis-dinov3-prefix-block-browser.html', import.meta.url), 'utf8');
const browserRunner = readFileSync(new URL('../tools/trellis-dinov3-prefix-block-browser-parity-smoke.mjs', import.meta.url), 'utf8');
const assayRunner = readFileSync(new URL('../tools/trellis-dinov3-prefix-block-parity-assay.mjs', import.meta.url), 'utf8');
const parityGateOffset = browserPage.indexOf('if (failedComparisons.length)');
const liveTransferOffset = browserPage.indexOf('if (liveConditioningMode) {', parityGateOffset);
const sessionCloseOffset = browserPage.indexOf('if (residentFullConditioningMode) await closeInferenceSession()', liveTransferOffset);
assert.ok(parityGateOffset >= 0 && parityGateOffset < liveTransferOffset && liveTransferOffset < sessionCloseOffset,
  'live forwarding must occur only after the exact full-conditioning tensor passes its pinned MLX comparison and before its WebGPU session closes');
assert.match(browserRunner, /request\.headers\['x-request-id'\]!==invocationId/,
  'the host bridge must reject stale or cross-session producer requests');
assert.match(browserRunner, /liveConditioningRequestSeen/,
  'the host bridge must reject duplicate deliveries from one producer session');
assert.match(browserRunner, /mode!=='resident-full-conditioning'/,
  'the host bridge must not accept a partial or non-final DINO tensor as TRELLIS conditioning');
assert.match(browserRunner, /forwardF32ConditioningTensor\(\{url:conditioningSinkUrl,bytes,provenance\}\)/,
  'the host bridge must forward the current request bytes rather than reload an artifact');
assert.match(assayRunner, /conditioningSinkUrl/,
  'the composite assay must record and route an explicitly requested live consumer endpoint');

let received = null;
let receivedCount = 0;
const receivedUrls = [];
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  received = { method: request.method, url: request.url, headers: request.headers, bytes: Buffer.concat(chunks) };
  receivedCount += 1;
  receivedUrls.push(request.url);
  const rejected = request.url.endsWith('/reject');
  if (request.url.endsWith('/redirect')) {
    response.writeHead(302, { location: '/conditioning' });
    response.end();
    return;
  }
  response.writeHead(rejected ? 503 : 202, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ received: !rejected }));
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
const url = `http://127.0.0.1:${address.port}/conditioning`;

try {
  const result = await forwardF32ConditioningTensor({ url, bytes, provenance });
  assert.equal(result.status, 202, 'the forwarding receipt must preserve the consumer HTTP status');
  assert.equal(result.tensor.sha256, received.headers['x-tensor-sha256']);
  assert.equal(received.method, 'POST');
  assert.equal(received.url, '/conditioning');
  assert.equal(received.headers['content-type'], 'application/octet-stream');
  assert.equal(received.headers['x-tensor-name'], 'cond');
  assert.equal(received.headers['x-tensor-dtype'], 'float32');
  assert.equal(received.headers['x-tensor-shape'], '1,1029,1024');
  assert.equal(received.headers['x-request-id'], provenance.requestId);
  assert.deepEqual(received.bytes, bytes, 'the consumer must receive the exact raw F32 bytes, not an artifact wrapper');
  const envelope = JSON.parse(Buffer.from(received.headers['x-kaminos-conditioning-envelope'], 'base64url').toString('utf8'));
  assert.equal(envelope.schema, 'kaminos.trellis-dinov3-live-conditioning.v1');
  assert.equal(envelope.requestId, provenance.requestId);
  assert.equal(envelope.producer.sessionId, provenance.producerSessionId);
  assert.equal(envelope.consumer.modelReference.revision, provenance.consumerModelReferenceRevision);
  assert.equal(envelope.consumer.modelReference.dinov3SourceSha256, provenance.consumerDinoSourceSha256);
  assert.match(envelope.consumer.negativeConditioning, /zeros_like\(cond\)/);
  assert.deepEqual(envelope.tensor.shape, tensorShape);
  assert.equal(envelope.tensor.byteLength, byteLength);
  assert.equal(envelope.tensor.sha256, result.tensor.sha256);
  assert.equal(envelope.tensor.layout, 'BSH');
  assert.match(envelope.transfer.semantics, /host readback/);
  assert.match(envelope.transfer.semantics, /distinct MLX-owned array/);

  await assert.rejects(
    forwardF32ConditioningTensor({ url, bytes: bytes.subarray(0, -4), provenance }),
    /byte length.*expected 4214784/,
    'partial tensor must be rejected before it reaches the consumer',
  );
  const nonFinite = Buffer.from(bytes);
  nonFinite.writeFloatLE(Number.NaN, 0);
  await assert.rejects(
    forwardF32ConditioningTensor({ url, bytes: nonFinite, provenance }),
    /non-finite/,
    'non-finite tensor data must not be forwarded',
  );
  await assert.rejects(
    forwardF32ConditioningTensor({ url, bytes: Buffer.alloc(byteLength), provenance }),
    /blank\/all-zero/,
    'blank output must not masquerade as a transferred conditioning tensor',
  );
  await assert.rejects(
    forwardF32ConditioningTensor({ url: url.replace('127.0.0.1', 'example.com'), bytes, provenance }),
    /loopback/,
    'the model-local consumer bridge must not silently send tensor bytes off-host',
  );
  await assert.rejects(
    forwardF32ConditioningTensor({ url: `${url}/reject`, bytes, provenance }),
    /HTTP 503/,
    'a consumer-side rejection must remain a visible transport failure',
  );
  await assert.rejects(
    forwardF32ConditioningTensor({ url: `${url}/redirect`, bytes, provenance }),
    error => /redirect/i.test(`${error?.message} ${error?.cause?.message}`),
    'a redirected sink must not silently substitute a different receiver',
  );
  assert.equal(receivedCount, 3, 'partial, non-finite, blank, and off-host requests must be refused before reaching any receiver');
  assert.deepEqual(receivedUrls, ['/conditioning', '/conditioning/reject', '/conditioning/redirect'], 'a redirect must not cause the tensor to be resent to a substituted receiver path');
} finally {
  server.close();
  await once(server, 'close');
}

console.log('TRELLIS DINOv3 live-conditioning transport contracts passed');
