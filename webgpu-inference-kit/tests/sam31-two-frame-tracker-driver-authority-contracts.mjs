import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { SAM31_TWO_FRAME_PACKET_AUTHORITIES } from '../src/sam31-packet-artifact.js';

const root = new URL('../', import.meta.url);
const driver = new URL('../tools/sam31-two-frame-tracker-browser-parity-smoke.mjs', import.meta.url);
const packetDir = await mkdtemp(join(tmpdir(), 'sam31-two-frame-authority-'));
const reportPath = join(packetDir, 'report.json');
const pinnedReference = {
  model: { id: 'facebook/sam3.1', revision: 'daa63191845a41281374e725f4c9e51c7a824460', sha256: 'sha256:0567debeec80ba4ac6369540c6c248025283cb3ff2b92827509e57e2b3541cb6' },
  source: { repository: 'facebookresearch/sam3', commit: '5dd401d1c5c1d5c3eedff06d41b77af824517619', workingTreeClean: true },
};
const episodeShape = { batch: 1, multiplexCount: 16, queryHeight: 2, queryWidth: 2, queryTokens: 4, memorySpatialTokens: 4, numObjPtrTokens: 16, memoryTokens: 20, channels: 256, maskHeight: 8, maskWidth: 8 };
const episodePlan = { frameIndex: 1, numFrames: 2, conditioningFrameIndices: [0], nonConditioningFrameIndices: [], selectedConditioningFrameIndices: [0], spatialFrameIndices: [0], spatialTemporalPositionIndices: [5], pointerFrameIndices: [0], pointerRelativePositions: [1], numMaskmem: 7, maxConditioningFrames: 4, maxObjectPointerFrames: 2, memoryTemporalStride: 1, useMaskmemTemporalPositionV2: true, trackInReverse: false };
const specs = {
  decoder: { manifestSchema: 'kaminos.sam31-multiplex-mask-decoder-meta-packet.v0', receiptSchema: 'kaminos.sam31-multiplex-mask-decoder-meta-reference-receipt.v0', boundary: 'sam31-propagation-features-to-multiplex-masks-scores-and-object-pointers', manifestExtra: { routeId: 'sam3.1.multiplex-mask-decoder.phase-program.webgpu-local.v0', shape: SAM31_TWO_FRAME_PACKET_AUTHORITIES.decoder.shape }, receiptExtra: { routeId: 'sam3.1.multiplex-mask-decoder.phase-program.webgpu-local.v0', shape: SAM31_TWO_FRAME_PACKET_AUTHORITIES.decoder.shape } },
  memory: { manifestSchema: 'kaminos.sam31-propagation-memory-meta-packet.v0', receiptSchema: 'kaminos.sam31-propagation-memory-meta-reference-receipt.v0', boundary: 'sam31-official-tri-neck-to-multiplex-memory-encoder', manifestExtra: { routeIds: ['sam3.1.propagation-neck.phase-program.webgpu-local.v0', 'sam3.1.memory-encoder.phase-program.webgpu-local.v0'], shape: SAM31_TWO_FRAME_PACKET_AUTHORITIES.memory.shape }, receiptExtra: { routeIds: ['sam3.1.propagation-neck.phase-program.webgpu-local.v0', 'sam3.1.memory-encoder.phase-program.webgpu-local.v0'], shape: SAM31_TWO_FRAME_PACKET_AUTHORITIES.memory.shape } },
  temporal: { manifestSchema: 'kaminos.sam31-temporal-memory-bank-meta-packet.v0', receiptSchema: 'kaminos.sam31-temporal-memory-bank-meta-reference-receipt.v0', boundary: 'sam31-video-output-dictionary-to-temporal-bank-to-four-layer-memory-attention', manifestExtra: { routeId: 'sam3.1.temporal-memory-bank.phase-program.webgpu-local.v0', shape: SAM31_TWO_FRAME_PACKET_AUTHORITIES.temporal.shape, plan: SAM31_TWO_FRAME_PACKET_AUTHORITIES.temporal.plan }, receiptExtra: { routeId: 'sam3.1.temporal-memory-bank.phase-program.webgpu-local.v0', shape: SAM31_TWO_FRAME_PACKET_AUTHORITIES.temporal.shape, plan: SAM31_TWO_FRAME_PACKET_AUTHORITIES.temporal.plan } },
  episode: { manifestSchema: 'kaminos.sam31-two-frame-tracker-meta-packet.v0', receiptSchema: 'kaminos.sam31-two-frame-tracker-meta-reference-receipt.v0', boundary: 'frame-0-decoder-to-memory-state-to-frame-1-conditioned-decoder', manifestExtra: { shape: episodeShape, plan: episodePlan }, receiptExtra: { shape: episodeShape, plan: episodePlan } },
};

async function writePacket(name, { reference = pinnedReference, manifestSchema = null, overrides = {} } = {}) {
  const spec = specs[name];
  const directory = join(packetDir, name);
  await mkdir(directory, { recursive: true });
  const manifestText = `${JSON.stringify({ schema: manifestSchema || spec.manifestSchema, boundary: spec.boundary, reference, ...spec.manifestExtra, ...overrides }, null, 2)}\n`;
  const digest = `sha256:${createHash('sha256').update(manifestText).digest('hex')}`;
  await writeFile(join(directory, 'tensor-manifest.json'), manifestText);
  await writeFile(join(directory, 'reference-receipt.json'), `${JSON.stringify({ ok: true, schema: spec.receiptSchema, boundary: spec.boundary, reference, ...spec.receiptExtra, ...overrides, outputs: { tensorManifest: join(directory, 'tensor-manifest.json'), tensorManifestSha256: digest } }, null, 2)}\n`);
  return digest;
}

const digests = {};
for (const name of ['decoder', 'memory', 'temporal', 'episode']) digests[name] = await writePacket(name);

function verifyOnly(report, expected = digests) {
  return spawnSync(process.execPath, [driver.pathname,
    '--packet-dir', packetDir,
    '--report', report,
    '--reuse-packet', '1',
    '--verify-only', '1',
    '--expected-decoder-manifest-sha256', expected.decoder,
    '--expected-memory-manifest-sha256', expected.memory,
    '--expected-temporal-manifest-sha256', expected.temporal,
    '--expected-episode-manifest-sha256', expected.episode,
    '--debug-port', String(20000 + process.pid % 10000),
    '--server-port', String(30000 + process.pid % 10000),
    '--timeout-ms', '1000',
  ], { cwd: root.pathname, encoding: 'utf8', timeout: 10000 });
}

const valid = verifyOnly(reportPath);
assert.equal(valid.status, 0, valid.stderr || valid.stdout);
const validReport = JSON.parse(await readFile(reportPath, 'utf8'));
assert.equal(validReport.ok, true);
assert.equal(validReport.packetAuthority.passed, true);
assert.deepEqual(validReport.packetAuthority.verifiedPackets, ['decoder', 'memory', 'temporal', 'episode']);
assert.equal(validReport.primary_output_written, false, 'authority-only verification must not pretend to write browser evidence');

await writeFile(join(packetDir, 'memory', 'tensor-manifest.json'), '{"tampered":true}\n');
const tamperedReportPath = join(packetDir, 'tampered-report.json');
const tampered = verifyOnly(tamperedReportPath);
assert.notEqual(tampered.status, 0, 'the composed witness must reject a manifest changed after its reference receipt was written');
const tamperedReport = JSON.parse(await readFile(tamperedReportPath, 'utf8'));
assert.equal(tamperedReport.failure_phase, 'verify_packet_authority');
assert.match(tamperedReport.error, /memory.*expectedManifestSha256|memory manifest digest mismatch/);
assert.equal(tamperedReport.primary_output_written, false);

const wrongReference = { ...pinnedReference, source: { ...pinnedReference.source, commit: '0000000000000000000000000000000000000000' } };
await writePacket('memory', { reference: wrongReference });
const coordinatedReportPath = join(packetDir, 'coordinated-report.json');
const coordinated = verifyOnly(coordinatedReportPath);
assert.notEqual(coordinated.status, 0, 'coordinated manifest and receipt replacement must fail the invocation-scoped digest pin');
assert.match(JSON.parse(await readFile(coordinatedReportPath, 'utf8')).error, /memory.*expectedManifestSha256|memory manifest digest mismatch/);

digests.memory = await writePacket('memory');
const wrongSchemaDigest = await writePacket('decoder', { manifestSchema: 'test.decoder.manifest.v0' });
const wrongSchemaReportPath = join(packetDir, 'wrong-schema-report.json');
const wrongSchema = verifyOnly(wrongSchemaReportPath, { ...digests, decoder: wrongSchemaDigest });
assert.notEqual(wrongSchema.status, 0, 'an externally pinned packet must still fail an unexpected manifest schema');
assert.match(JSON.parse(await readFile(wrongSchemaReportPath, 'utf8')).error, /decoder.*manifest\.schema/);

digests.decoder = await writePacket('decoder');
const wrongShapeDigest = await writePacket('decoder', { overrides: { shape: { ...SAM31_TWO_FRAME_PACKET_AUTHORITIES.decoder.shape, queryTokens: 1 } } });
const wrongShapeReportPath = join(packetDir, 'wrong-shape-report.json');
const wrongShape = verifyOnly(wrongShapeReportPath, { ...digests, decoder: wrongShapeDigest });
assert.notEqual(wrongShape.status, 0, 'an externally pinned packet must still fail the wrong decoder fixture shape');
assert.match(JSON.parse(await readFile(wrongShapeReportPath, 'utf8')).error, /decoder.*manifest\.shape/);

digests.decoder = await writePacket('decoder');
const wrongIdentityDigest = await writePacket('episode', { reference: wrongReference });
const wrongIdentityReportPath = join(packetDir, 'wrong-identity-report.json');
const wrongIdentity = verifyOnly(wrongIdentityReportPath, { ...digests, episode: wrongIdentityDigest });
assert.notEqual(wrongIdentity.status, 0, 'an externally pinned packet must still fail the wrong Meta source identity');
assert.match(JSON.parse(await readFile(wrongIdentityReportPath, 'utf8')).error, /episode.*source\.commit/);

console.log('sam3.1 two-frame tracker driver authority contracts passed');
