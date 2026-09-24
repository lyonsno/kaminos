import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let forwardF32ConditioningTensor;
let liveConditioningReceiptMatches;
try {
  ({ forwardF32ConditioningTensor, liveConditioningReceiptMatches } = await import('../tools/trellis-dinov3-live-conditioning-transport.mjs'));
} catch (error) {
  if (error?.code === 'ERR_MODULE_NOT_FOUND') {
    assert.fail('the WebGPU conditioner has no model-specific raw-F32 live consumer transport');
  }
  throw error;
}
assert.equal(typeof liveConditioningReceiptMatches, 'function',
  'the browser CLI needs a testable gate that prevents configured live-transfer requests from succeeding without a matching receipt');
const gateIdentity={requestId:'configured-transfer-request',tensorSha256:'a'.repeat(64)};
const gateReceipt={
  ok:true,requestId:gateIdentity.requestId,producerSessionId:`trellis-dinov3-full-conditioning-${gateIdentity.requestId}`,
  receiverUrl:'http://127.0.0.1:43999/conditioning',receiverHttpStatus:202,
  tensor:{sha256:gateIdentity.tensorSha256},
  envelope:{requestId:gateIdentity.requestId,tensor:{sha256:gateIdentity.tensorSha256}},
};
assert.equal(liveConditioningReceiptMatches({sinkUrl:null,...gateIdentity,receipt:null}),true,
  'parity-only runs without a requested sink must not require a consumer transfer');
assert.equal(liveConditioningReceiptMatches({sinkUrl:'http://127.0.0.1:43999/conditioning',...gateIdentity,receipt:null}),false,
  'a configured consumer sink must not be reported complete without a transfer receipt');
assert.equal(liveConditioningReceiptMatches({sinkUrl:'http://127.0.0.1:43999/conditioning',...gateIdentity,receipt:gateReceipt}),true,
  'a matching host receipt must satisfy only the producer-to-receiver transfer gate');
assert.equal(liveConditioningReceiptMatches({sinkUrl:'http://127.0.0.1:43999/conditioning',...gateIdentity,receipt:{...gateReceipt,tensor:{sha256:'b'.repeat(64)}}}),false,
  'a receipt for other tensor bytes must not satisfy the configured transfer gate');
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
assert.match(browserRunner, /failurePhase:report\.failure_phase/,
  'the direct browser CLI must preserve its specific transfer-gate failure phase through the catch report rewrite');
assert.ok(browserRunner.includes('writeReport({failure_phase:error?.failurePhase||phase,error:'),
  'the final caller-owned report must prefer an explicit failure phase carried by the error');
assert.ok(browserRunner.includes('failure_phase:report.failure_phase,reportPath'),
  'the CLI error summary must report the same final failure phase as its persisted report');
const browserRunnerPath = new URL('../tools/trellis-dinov3-prefix-block-browser-parity-smoke.mjs', import.meta.url);
const assayRunnerPath = new URL('../tools/trellis-dinov3-prefix-block-parity-assay.mjs', import.meta.url);
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

const failureReportRoot = mkdtempSync(join(tmpdir(), 'trellis-dinov3-invalid-sink-report-'));
const invalidSink = 'http://example.com/conditioning';
try {
  const compositeReportPath = join(failureReportRoot, 'composite-report.json');
  const compositeEvidenceDir = join(failureReportRoot, 'composite-evidence');
  const compositeRun = spawnSync(process.execPath, [assayRunnerPath.pathname,
    '--model-dir', join(failureReportRoot, 'missing-model'),
    '--source-image', join(failureReportRoot, 'missing-image.png'),
    '--trellis-root', join(failureReportRoot, 'missing-trellis'),
    '--evidence-dir', compositeEvidenceDir,
    '--report', compositeReportPath,
    '--receiver', 'invalid-sink-contract-test',
    '--mode', 'resident-full-conditioning',
    '--conditioning-sink-url', invalidSink,
  ], { encoding: 'utf8' });
  assert.equal(compositeRun.status, 1, 'the composite assay must reject an off-host sink');
  assert.ok(existsSync(compositeReportPath), 'invalid sink preflight must leave the caller-requested composite failure report');
  const compositeReport = JSON.parse(readFileSync(compositeReportPath, 'utf8'));
  assert.equal(compositeReport.failure_phase, 'local-preflight');
  assert.equal(compositeReport.requestedConditioningSinkUrl, invalidSink);
  assert.equal(compositeReport.effectiveConditioningSinkUrl, null);
  assert.match(compositeReport.error, /loopback/);
  assert.equal(compositeReport.lastTrustworthyEvidence?.description, 'command inputs not yet verified');
  assert.equal(compositeReport.lastTrustworthyEvidence?.detail?.phase, 'local-preflight');
  assert.deepEqual(compositeReport.commandIdentity, {}, 'invalid sink must fail before MLX or browser commands are prepared');
  assert.equal(existsSync(join(compositeEvidenceDir, 'start-receipt.json')), false,
    'invalid sink must fail before any MLX or browser process start receipt');

  const browserReportPath = join(failureReportRoot, 'browser-report.json');
  const browserOutputDir = join(failureReportRoot, 'browser-output');
  const browserRun = spawnSync(process.execPath, [browserRunnerPath.pathname,
    '--reference-dir', join(failureReportRoot, 'missing-reference'),
    '--source-image', join(failureReportRoot, 'missing-image.png'),
    '--output-dir', browserOutputDir,
    '--report', browserReportPath,
    '--mode', 'resident-full-conditioning',
    '--conditioning-sink-url', invalidSink,
  ], { encoding: 'utf8' });
  assert.equal(browserRun.status, 1, 'the direct browser smoke must reject an off-host sink');
  assert.ok(existsSync(browserReportPath), 'invalid sink preflight must leave the caller-requested browser failure report');
  const browserFailureReport = JSON.parse(readFileSync(browserReportPath, 'utf8'));
  assert.equal(browserFailureReport.failure_phase, 'local_preflight');
  assert.equal(browserFailureReport.requestedConditioningSinkUrl, invalidSink);
  assert.equal(browserFailureReport.effectiveConditioningSinkUrl, null);
  assert.match(browserFailureReport.error, /loopback/);
  assert.equal(browserFailureReport.lastTrustworthyEvidence?.description, 'local command setup only');
  assert.equal(browserFailureReport.lastTrustworthyEvidence?.detail?.phase, 'local_preflight');
  assert.equal(browserFailureReport.chromeProcessPid, null, 'invalid sink must fail before Chrome launches');
  assert.equal(existsSync(browserOutputDir), false, 'invalid sink must fail before creating the browser output route');

  const validSink = 'http://127.0.0.1:43999/conditioning';
  const validSinkReportPath = join(failureReportRoot, 'valid-sink-preflight-report.json');
  const validSinkRun = spawnSync(process.execPath, [browserRunnerPath.pathname,
    '--reference-dir', join(failureReportRoot, 'missing-reference'),
    '--source-image', join(failureReportRoot, 'missing-image.png'),
    '--output-dir', join(failureReportRoot, 'valid-sink-output'),
    '--report', validSinkReportPath,
    '--mode', 'resident-full-conditioning',
    '--conditioning-sink-url', validSink,
  ], { encoding: 'utf8' });
  assert.equal(validSinkRun.status, 1, 'incomplete source preflight must stop before launching the browser');
  assert.ok(existsSync(validSinkReportPath), 'valid-sink preflight must still leave a caller-requested report');
  const validSinkReport = JSON.parse(readFileSync(validSinkReportPath, 'utf8'));
  assert.equal(validSinkReport.effectiveConditioningSinkUrl, validSink);
  assert.equal(new URL(validSinkReport.requestedUrl).searchParams.get('liveConditioning'), '1',
    'a validated requested sink must enable the browser transfer route before launch');
  assert.equal(validSinkReport.chromeProcessPid, null, 'the valid-sink route check must not launch Chrome');
} finally {
  rmSync(failureReportRoot, { recursive: true, force: true });
}

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
  assert.equal(envelope.consumer, undefined,
    'the producer must not report an effective consumer process when the configured receiver is unowned');
  assert.equal(envelope.consumerReference.repository, 'trellis2mlx');
  assert.equal(envelope.consumerReference.modelReference.revision, provenance.consumerModelReferenceRevision);
  assert.equal(envelope.consumerReference.modelReference.dinov3SourceSha256, provenance.consumerDinoSourceSha256);
  assert.match(envelope.consumerReference.expectedNegativeConditioning, /zeros_like\(cond\)/);
  assert.match(envelope.consumerReference.expectedNegativeConditioning, /not observed/i);
  assert.deepEqual(envelope.tensor.shape, tensorShape);
  assert.equal(envelope.tensor.byteLength, byteLength);
  assert.equal(envelope.tensor.sha256, result.tensor.sha256);
  assert.equal(envelope.tensor.layout, 'BSH');
  assert.match(envelope.transfer.semantics, /host readback/);
  assert.match(envelope.transfer.semantics, /receiving process.*unobserved/i);
  assert.doesNotMatch(envelope.transfer.semantics, /MLX consumer constructs a distinct MLX-owned array/);

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
