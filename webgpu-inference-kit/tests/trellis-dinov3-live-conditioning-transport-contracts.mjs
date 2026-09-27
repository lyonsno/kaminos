import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let forwardF32ConditioningTensor;
let liveConditioningReceiptMatches;
let liveConditioningConsumerReceiptMatches;
let liveConditioningProducerSessionReleaseMatches;
try {
  ({ forwardF32ConditioningTensor, liveConditioningReceiptMatches, liveConditioningConsumerReceiptMatches, liveConditioningProducerSessionReleaseMatches } = await import('../tools/trellis-dinov3-live-conditioning-transport.mjs'));
} catch (error) {
  if (error?.code === 'ERR_MODULE_NOT_FOUND') {
    assert.fail('the WebGPU conditioner has no model-specific raw-F32 live consumer transport');
  }
  throw error;
}
assert.equal(typeof liveConditioningReceiptMatches, 'function',
  'the browser CLI needs a testable gate that prevents configured live-transfer requests from succeeding without a matching receipt');
assert.equal(typeof liveConditioningConsumerReceiptMatches, 'function',
  'the producer needs a testable fail-closed gate for receiver-owned MLX and sampler evidence');
assert.equal(typeof liveConditioningProducerSessionReleaseMatches, 'function',
  'the producer report needs a testable receipt that the WebGPU session closed before the live HTTP handoff');
const tensorShape = [1, 1029, 1024];
const byteLength = tensorShape.reduce((count, axis) => count * axis, 1) * 4;
const gateIdentity={requestId:'configured-transfer-request',tensorSha256:'a'.repeat(64)};
const gateSinkUrl='http://127.0.0.1:43999/conditioning';
const gateProducerSessionId=`trellis-dinov3-full-conditioning-${gateIdentity.requestId}`;
const producerSessionRelease={
  process:'Chrome',producerSessionId:gateProducerSessionId,routeId:'trellis-dinov3-full-conditioning-route',
  tensorName:'cond',tensorSha256:gateIdentity.tensorSha256,
  webgpuInferenceSessionClosed:true,releasedAt:'2026-09-27T14:00:00.000Z',beforeHostForward:true,
};
assert.equal(liveConditioningProducerSessionReleaseMatches({requestId:gateIdentity.requestId,routeId:producerSessionRelease.routeId,tensorSha256:gateIdentity.tensorSha256,receipt:producerSessionRelease}),true,
  'a complete same-session release receipt must bind the copied tensor to the pre-forward WebGPU close');
assert.equal(liveConditioningProducerSessionReleaseMatches({requestId:gateIdentity.requestId,routeId:producerSessionRelease.routeId,tensorSha256:gateIdentity.tensorSha256,receipt:{...producerSessionRelease,beforeHostForward:false}}),false,
  'a session-release receipt after host forwarding must not satisfy the live route');
assert.equal(liveConditioningProducerSessionReleaseMatches({requestId:gateIdentity.requestId,routeId:producerSessionRelease.routeId,tensorSha256:gateIdentity.tensorSha256,receipt:{...producerSessionRelease,tensorSha256:'c'.repeat(64)}}),false,
  'a session-release receipt for a different tensor must not satisfy the live route');
assert.equal(liveConditioningProducerSessionReleaseMatches({requestId:gateIdentity.requestId,routeId:producerSessionRelease.routeId,tensorSha256:gateIdentity.tensorSha256,receipt:{...producerSessionRelease,releasedAt:'not-a-time'}}),false,
  'a session-release receipt without a parseable release time must not satisfy the live route');
const consumerReceipt={
  schema:'trellis2mlx.live-conditioning-consumer.v1',ok:true,
  requestId:gateIdentity.requestId,producerSessionId:gateProducerSessionId,
  receiver:{pid:9876,sessionId:'receiver-session-001',sourceRevision:'b'.repeat(40),url:gateSinkUrl},
  tensor:{sha256:gateIdentity.tensorSha256,shape:tensorShape,dtype:'float32',byteOrder:'little-endian',byteLength},
  transfer:{receiverObservedHttpBodyBytes:byteLength,mlxUpload:'mx.array from receiver-owned F32 body; evaluated'},
  mlx:{device:'Device(gpu, 0)',condArrayObjectId:0,condEvaluated:true,negCondPolicy:'mx.zeros_like(cond)',negCondEvaluated:true},
  sampler:{stage:'sparse_flow_step',consumedCond:true,consumedNegCond:true,outputFinite:true},
};
assert.equal(liveConditioningConsumerReceiptMatches({sinkUrl:gateSinkUrl,...gateIdentity,producerSessionId:gateProducerSessionId,receipt:consumerReceipt}),true,
  'only a matching receiver report naming MLX allocation, upload, and real sampler consumption may satisfy consumer acceptance');
assert.equal(liveConditioningConsumerReceiptMatches({sinkUrl:gateSinkUrl,...gateIdentity,producerSessionId:gateProducerSessionId,receipt:{...consumerReceipt,schema:'transport-echo.v1'}}),false,
  'a generic transport echo must not satisfy the consumer schema');
assert.equal(liveConditioningConsumerReceiptMatches({sinkUrl:gateSinkUrl,...gateIdentity,producerSessionId:gateProducerSessionId,receipt:{...consumerReceipt,sampler:{...consumerReceipt.sampler,consumedCond:false}}}),false,
  'a receiver report that did not consume the positive MLX conditioning array must fail');
assert.equal(liveConditioningConsumerReceiptMatches({sinkUrl:gateSinkUrl,...gateIdentity,producerSessionId:gateProducerSessionId,receipt:{...consumerReceipt,mlx:{...consumerReceipt.mlx,negCondEvaluated:false}}}),false,
  'a receiver report that did not evaluate the negative MLX conditioning array must fail');
const gateReceipt={
  ok:true,requestId:gateIdentity.requestId,producerSessionId:gateProducerSessionId,
  receiverUrl:gateSinkUrl,receiverHttpStatus:200,
  tensor:{sha256:gateIdentity.tensorSha256},
  envelope:{requestId:gateIdentity.requestId,producer:{routeId:producerSessionRelease.routeId},tensor:{sha256:gateIdentity.tensorSha256}},
  producerSessionRelease,
  consumerReceipt,
};
assert.equal(liveConditioningReceiptMatches({sinkUrl:null,...gateIdentity,receipt:null}),true,
  'parity-only runs without a requested sink must not require a consumer transfer');
assert.equal(liveConditioningReceiptMatches({sinkUrl:'http://127.0.0.1:43999/conditioning',...gateIdentity,receipt:null}),false,
  'a configured consumer sink must not be reported complete without a transfer receipt');
assert.equal(liveConditioningReceiptMatches({sinkUrl:'http://127.0.0.1:43999/conditioning',...gateIdentity,receipt:gateReceipt}),true,
  'a matching host receipt with receiver-owned sampler evidence must satisfy the configured consumer gate');
assert.equal(liveConditioningReceiptMatches({sinkUrl:gateSinkUrl,...gateIdentity,receipt:{...gateReceipt,receiverHttpStatus:202}}),false,
  'a non-contract 2xx status must not satisfy the exact HTTP-200 consumer response contract');
assert.equal(liveConditioningReceiptMatches({sinkUrl:gateSinkUrl,...gateIdentity,receipt:{...gateReceipt,consumerReceipt:undefined}}),false,
  'a host transport echo without the consumer-owned MLX/sampler report must not satisfy the live gate');
assert.equal(liveConditioningReceiptMatches({sinkUrl:gateSinkUrl,...gateIdentity,receipt:{...gateReceipt,producerSessionRelease:{...producerSessionRelease,beforeHostForward:false}}}),false,
  'a consumer receipt cannot close the live gate if the producer session release occurred after forwarding');
assert.equal(liveConditioningReceiptMatches({sinkUrl:'http://127.0.0.1:43999/conditioning',...gateIdentity,receipt:{...gateReceipt,tensor:{sha256:'b'.repeat(64)}}}),false,
  'a receipt for other tensor bytes must not satisfy the configured transfer gate');
const bytes = Buffer.alloc(byteLength);
for (let offset = 0; offset < bytes.byteLength; offset += 4) {
  bytes.writeFloatLE((offset / 4 % 127) / 127, offset);
}
const provenance = {
  requestId: 'trellis-dinov3-live-conditioning-test-001',
  producerProcess: 'Chrome',
  producerPid: 4123,
  producerSessionId: 'trellis-dinov3-full-conditioning-trellis-dinov3-live-conditioning-test-001',
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
const transportSessionRelease={
  process:'Chrome',producerSessionId:provenance.producerSessionId,routeId:provenance.producerRouteId,
  tensorName:'cond',tensorSha256:null,webgpuInferenceSessionClosed:true,
  releasedAt:'2026-09-27T14:00:00.000Z',beforeHostForward:true,
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
const finalTensorDigestOffset = browserPage.indexOf('if (sha256Value!==state.actualOutputs.conditioningFeatures.sha256)', liveTransferOffset);
const copiedHostBytesOffset = browserPage.indexOf('const bytes=new Uint8Array(values.buffer,values.byteOffset,values.byteLength).slice()', liveTransferOffset);
const sessionCloseOffset = browserPage.indexOf('await closeInferenceSession()', liveTransferOffset);
const sessionReleaseReceiptOffset = browserPage.indexOf('state.producerSessionRelease=', liveTransferOffset);
const liveFetchOffset = browserPage.indexOf("fetch('/__live_conditioning'", liveTransferOffset);
assert.ok(parityGateOffset >= 0 && parityGateOffset < liveTransferOffset && liveTransferOffset < copiedHostBytesOffset && copiedHostBytesOffset < finalTensorDigestOffset && finalTensorDigestOffset < sessionCloseOffset && sessionCloseOffset < sessionReleaseReceiptOffset && sessionReleaseReceiptOffset < liveFetchOffset,
  'the producer must copy/hash host bytes, close its WebGPU session, record that release, and only then await the Python sampler');
assert.match(browserPage, /const bytes=new Uint8Array\(values\.buffer,values\.byteOffset,values\.byteLength\)\.slice\(\)/,
  'the host-owned F32 bytes must be copied before the WebGPU inference session is released');
assert.match(browserRunner, /request\.headers\['x-request-id'\]!==invocationId/,
  'the host bridge must reject stale or cross-session producer requests');
assert.match(browserRunner, /liveConditioningRequestSeen/,
  'the host bridge must reject duplicate deliveries from one producer session');
assert.match(browserRunner, /consumerReceipt/,
  'the host bridge receipt must preserve the receiver-owned consumer report rather than only an HTTP echo');
assert.match(browserRunner, /x-producer-session-release/,
  'the browser must transfer its post-close producer receipt to the host bridge');
assert.match(browserRunner, /liveConditioningProducerSessionReleaseMatches/,
  'the host bridge and final report must reject missing or mismatched producer release evidence');
assert.match(browserRunner, /mode!=='resident-full-conditioning'/,
  'the host bridge must not accept a partial or non-final DINO tensor as TRELLIS conditioning');
assert.match(browserRunner, /forwardF32ConditioningTensor\(\{url:conditioningSinkUrl,bytes,provenance,producerSessionRelease\}\)/,
  'the host bridge must forward current request bytes with the matching post-close receipt rather than reload an artifact');
assert.match(assayRunner, /conditioningSinkUrl/,
  'the composite assay must record and route an explicitly requested live consumer endpoint');
const hostReleaseGateOffset=browserRunner.indexOf('if (!liveConditioningProducerSessionReleaseMatches({requestId:invocationId');
const hostForwardOffset=browserRunner.indexOf('forwardF32ConditioningTensor({url:conditioningSinkUrl,bytes,provenance,producerSessionRelease}');
assert.ok(hostReleaseGateOffset>=0&&hostReleaseGateOffset<hostForwardOffset,
  'the Node relay must validate producer release evidence before sending any tensor bytes to Python');

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
  const missingConsumer = request.url.endsWith('/missing-consumer');
  const accepted202 = request.url.endsWith('/accepted-202');
  if (request.url.endsWith('/redirect')) {
    response.writeHead(302, { location: '/conditioning' });
    response.end();
    return;
  }
  response.writeHead(rejected ? 503 : accepted202 ? 202 : 200, { 'content-type': 'application/json' });
  if (missingConsumer) {
    response.end(JSON.stringify({ received: true }));
    return;
  }
  const requestId = request.headers['x-request-id'];
  const envelope = JSON.parse(Buffer.from(request.headers['x-kaminos-conditioning-envelope'], 'base64url').toString('utf8'));
  response.end(JSON.stringify(receiverReceiptFor(request.url, requestId, envelope.producer.sessionId, request.headers['x-tensor-sha256'], received.bytes.byteLength)));
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
const url = `http://127.0.0.1:${address.port}/conditioning`;
function receiverReceiptFor(requestUrl, requestId, producerSessionId, tensorSha256, bodyByteLength) {
  return {
    schema:'trellis2mlx.live-conditioning-consumer.v1',ok:true,requestId,producerSessionId,
    receiver:{pid:54321,sessionId:'receiver-session-test-001',sourceRevision:'2'.repeat(40),url:`http://127.0.0.1:${address.port}${requestUrl}`},
    tensor:{sha256:tensorSha256,shape:tensorShape,dtype:'float32',byteOrder:'little-endian',byteLength:bodyByteLength},
    transfer:{receiverObservedHttpBodyBytes:bodyByteLength,mlxUpload:'mx.array from receiver-owned F32 body; evaluated'},
    mlx:{device:'Device(gpu, 0)',condArrayObjectId:0,condEvaluated:true,negCondPolicy:'mx.zeros_like(cond)',negCondEvaluated:true},
    sampler:{stage:'sparse_flow_step',consumedCond:true,consumedNegCond:true,outputFinite:true},
  };
}

try {
  transportSessionRelease.tensorSha256=(await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
  await assert.rejects(
    forwardF32ConditioningTensor({ url, bytes, provenance }),
    /pre-forward producer-session release receipt/,
    'valid bytes without producer session-release evidence must not reach the receiver',
  );
  assert.equal(receivedCount,0,'missing producer release evidence must be rejected before a receiver can accept the tensor');
  const result = await forwardF32ConditioningTensor({ url, bytes, provenance, producerSessionRelease:transportSessionRelease });
  assert.equal(result.status, 200, 'the forwarding receipt must require the receiver contract HTTP status');
  assert.equal(result.consumerReceipt.schema, 'trellis2mlx.live-conditioning-consumer.v1');
  assert.equal(result.consumerReceipt.sampler.stage, 'sparse_flow_step');
  assert.equal(result.consumerReceipt.transfer.receiverObservedHttpBodyBytes, byteLength);
  assert.deepEqual(result.producerSessionRelease,transportSessionRelease);
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
    forwardF32ConditioningTensor({ url: `${url}/reject`, bytes, provenance, producerSessionRelease:transportSessionRelease }),
    /HTTP 503/,
    'a consumer-side rejection must remain a visible transport failure',
  );
  await assert.rejects(
    forwardF32ConditioningTensor({ url: `${url}/missing-consumer`, bytes, provenance, producerSessionRelease:transportSessionRelease }),
    /consumer receipt/i,
    'a successful HTTP response without the consumer-owned response schema must be rejected',
  );
  await assert.rejects(
    forwardF32ConditioningTensor({ url: `${url}/accepted-202`, bytes, provenance, producerSessionRelease:transportSessionRelease }),
    /HTTP 200/,
    'a generic 2xx status must not substitute for the receiver contract status',
  );
  await assert.rejects(
    forwardF32ConditioningTensor({ url: `${url}/redirect`, bytes, provenance, producerSessionRelease:transportSessionRelease }),
    error => /redirect/i.test(`${error?.message} ${error?.cause?.message}`),
    'a redirected sink must not silently substitute a different receiver',
  );
  assert.equal(receivedCount, 5, 'partial, non-finite, blank, and off-host requests must be refused before reaching any receiver');
  assert.deepEqual(receivedUrls, ['/conditioning', '/conditioning/reject', '/conditioning/missing-consumer', '/conditioning/accepted-202', '/conditioning/redirect'], 'a redirect must not cause the tensor to be resent to a substituted receiver path');
} finally {
  server.close();
  await once(server, 'close');
}

console.log('TRELLIS DINOv3 live-conditioning transport contracts passed');
