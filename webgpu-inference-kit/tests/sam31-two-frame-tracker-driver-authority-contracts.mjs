import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { SAM31_TWO_FRAME_PACKET_AUTHORITIES, SAM31_TWO_IMAGE_INGRESS_PACKET_AUTHORITY } from '../src/sam31-packet-artifact.js';

const root = new URL('../', import.meta.url);
const driver = new URL('../tools/sam31-two-frame-tracker-browser-parity-smoke.mjs', import.meta.url);
const driverSource = await readFile(driver, 'utf8');
assert.match(driverSource, /args\.get\('--user-data-dir'\)/, 'the browser witness must accept a caller-owned profile for reusable package storage');
assert.match(driverSource, /userDataDir,/, 'the durable report must expose the effective browser profile path');
assert.match(driverSource, /args\.get\('--static-backing'\)/, 'the browser witness must expose retained-memory versus OPFS package storage');
assert.match(
  driverSource,
  /name === 'pointer' && isTwoImage[\s\S]*?toolArgs\.push\('--ingress-dir', packetDirs\.ingress, '--expected-ingress-manifest-sha256', ingressDigest\)/,
  'fresh two-image generation must bind the pointer exporter to the generated ingress directory and digest',
);
const packetDir = await mkdtemp(join(tmpdir(), 'sam31-two-frame-authority-'));
const reportPath = join(packetDir, 'report.json');
const pinnedReference = {
  model: { id: 'facebook/sam3.1', revision: 'daa63191845a41281374e725f4c9e51c7a824460', sha256: 'sha256:0567debeec80ba4ac6369540c6c248025283cb3ff2b92827509e57e2b3541cb6' },
  source: { repository: 'facebookresearch/sam3', commit: '5dd401d1c5c1d5c3eedff06d41b77af824517619', workingTreeClean: true },
};
const episodeShape = { batch: 1, multiplexCount: 16, queryHeight: 2, queryWidth: 2, queryTokens: 4, memorySpatialTokens: 4, numObjPtrTokens: 16, memoryTokens: 20, channels: 256, maskHeight: 8, maskWidth: 8, sourceImageHeight: 28, sourceImageWidth: 28, sourceMaskHeight: 32, sourceMaskWidth: 32, promptMaskHeight: 8, promptMaskWidth: 8, decoderMaskHeight: 8, decoderMaskWidth: 8, memoryInputMaskHeight: 8, memoryInputMaskWidth: 8 };
const conditionedEpisodeShape = { ...episodeShape, memoryInputMaskHeight: 32, memoryInputMaskWidth: 32 };
const episodePlan = { frameIndex: 1, numFrames: 2, conditioningFrameIndices: [0], nonConditioningFrameIndices: [], selectedConditioningFrameIndices: [0], spatialFrameIndices: [0], spatialTemporalPositionIndices: [5], pointerFrameIndices: [0], pointerRelativePositions: [1], numMaskmem: 7, maxConditioningFrames: 4, maxObjectPointerFrames: 2, memoryTemporalStride: 1, useMaskmemTemporalPositionV2: true, trackInReverse: false };
const specs = {
  decoder: { manifestSchema: 'kaminos.sam31-multiplex-mask-decoder-meta-packet.v0', receiptSchema: 'kaminos.sam31-multiplex-mask-decoder-meta-reference-receipt.v0', boundary: 'sam31-propagation-features-to-multiplex-masks-scores-and-object-pointers', manifestExtra: { routeId: 'sam3.1.multiplex-mask-decoder.phase-program.webgpu-local.v0', shape: SAM31_TWO_FRAME_PACKET_AUTHORITIES.decoder.shape }, receiptExtra: { routeId: 'sam3.1.multiplex-mask-decoder.phase-program.webgpu-local.v0', shape: SAM31_TWO_FRAME_PACKET_AUTHORITIES.decoder.shape } },
  memory: { manifestSchema: 'kaminos.sam31-propagation-memory-meta-packet.v0', receiptSchema: 'kaminos.sam31-propagation-memory-meta-reference-receipt.v0', boundary: 'sam31-official-tri-neck-to-multiplex-memory-encoder', manifestExtra: { routeIds: ['sam3.1.propagation-neck.phase-program.webgpu-local.v0', 'sam3.1.memory-encoder.phase-program.webgpu-local.v0'], shape: SAM31_TWO_FRAME_PACKET_AUTHORITIES.memory.shape }, receiptExtra: { routeIds: ['sam3.1.propagation-neck.phase-program.webgpu-local.v0', 'sam3.1.memory-encoder.phase-program.webgpu-local.v0'], shape: SAM31_TWO_FRAME_PACKET_AUTHORITIES.memory.shape } },
  temporal: { manifestSchema: 'kaminos.sam31-temporal-memory-bank-meta-packet.v0', receiptSchema: 'kaminos.sam31-temporal-memory-bank-meta-reference-receipt.v0', boundary: 'sam31-video-output-dictionary-to-temporal-bank-to-four-layer-memory-attention', manifestExtra: { routeId: 'sam3.1.temporal-memory-bank.phase-program.webgpu-local.v0', shape: SAM31_TWO_FRAME_PACKET_AUTHORITIES.temporal.shape, plan: SAM31_TWO_FRAME_PACKET_AUTHORITIES.temporal.plan }, receiptExtra: { routeId: 'sam3.1.temporal-memory-bank.phase-program.webgpu-local.v0', shape: SAM31_TWO_FRAME_PACKET_AUTHORITIES.temporal.shape, plan: SAM31_TWO_FRAME_PACKET_AUTHORITIES.temporal.plan } },
  pointer: {
    manifestSchema: 'kaminos.sam31-interactive-pointer-meta-packet.v0',
    receiptSchema: 'kaminos.sam31-interactive-pointer-meta-reference-receipt.v0',
    boundary: 'binary-mask-to-interactive-prompt-decoder-to-final-object-pointer',
    manifestExtra: { routeId: 'sam3.1.interactive-pointer.phase-program.webgpu-local.v0', shape: SAM31_TWO_FRAME_PACKET_AUTHORITIES.pointer.shape, checkpointAudit: { mappedTensorCount: 158, allMappedOfficialKeysPresent: true } },
    receiptExtra: { routeId: 'sam3.1.interactive-pointer.phase-program.webgpu-local.v0', shape: SAM31_TWO_FRAME_PACKET_AUTHORITIES.pointer.shape, checkpointAudit: { mappedTensorCount: 158, allMappedOfficialKeysPresent: true } },
  },
  episode: { manifestSchema: 'kaminos.sam31-two-frame-tracker-meta-packet.v0', receiptSchema: 'kaminos.sam31-two-frame-tracker-meta-reference-receipt.v0', boundary: 'frame-0-decoder-to-memory-state-to-frame-1-conditioned-decoder', manifestExtra: { shape: episodeShape, plan: episodePlan }, receiptExtra: { shape: episodeShape, plan: episodePlan } },
  conditionedEpisode: {
    manifestSchema: 'kaminos.sam31-mask-conditioned-two-frame-tracker-meta-packet.v0',
    receiptSchema: 'kaminos.sam31-mask-conditioned-two-frame-tracker-meta-reference-receipt.v0',
    boundary: 'frame-0-mask-conditioning-to-memory-state-to-frame-1-conditioned-decoder',
    manifestExtra: {
      mode: 'official-meta-mask-conditioning-memory-attention-propagation-decoder',
      shape: conditionedEpisodeShape,
      plan: episodePlan,
      stateTransition: { frame0OriginKind: 'mask-conditioning', maskOwner: 'browser-webgpu', pointerOwner: 'official-reference-bridge' },
      claims: { officialFrame0DecoderExecuted: false, officialMaskConditioningMethodExecuted: true, officialInteractiveSamHeadsExecuted: true, officialInteractivePromptEncoderExecuted: true, officialInteractiveMaskDecoderExecuted: true, checkpointBackedInteractivePointers: true, fullProductionInteractiveGeometryExecuted: false, effectiveInteractiveImageEmbeddingSize: [2, 2], effectiveSourceMaskSize: [32, 32], effectivePromptMaskSize: [8, 8], effectiveDecoderMaskSize: [8, 8], officialMemoryMethodExecuted: true, officialTemporalMethodExecuted: true, officialMemoryAttentionExecuted: true, officialFrame1DecoderExecuted: true },
    },
    receiptExtra: { shape: conditionedEpisodeShape, plan: episodePlan, stateTransition: { frame0OriginKind: 'mask-conditioning', maskOwner: 'browser-webgpu', pointerOwner: 'official-reference-bridge' } },
  },
  twoImageEpisode: {
    manifestSchema: 'kaminos.sam31-two-image-tracker-meta-packet.v0',
    receiptSchema: 'kaminos.sam31-two-image-tracker-meta-reference-receipt.v0',
    boundary: 'two-distinct-raw-images-through-browser-backbone-to-mask-conditioned-temporal-tracker',
    manifestExtra: {
      mode: 'official-meta-two-image-mask-conditioning-memory-attention-propagation-decoder',
      shape: conditionedEpisodeShape,
      plan: episodePlan,
      stateTransition: { frame0OriginKind: 'mask-conditioning', maskOwner: 'browser-webgpu', pointerOwner: 'official-reference-bridge' },
      claims: { fullImageBackboneExecuted: true, twoDistinctRawImagesComposed: true, distinctInteractiveAndPropagationFeatures: true, packetOwnsImageEmbeddingsAtBrowserRuntime: false },
    },
    receiptExtra: { shape: conditionedEpisodeShape, plan: episodePlan, stateTransition: { frame0OriginKind: 'mask-conditioning', maskOwner: 'browser-webgpu', pointerOwner: 'official-reference-bridge' } },
  },
};

async function writePacket(name, { reference = pinnedReference, manifestSchema = null, overrides = {}, authorityName = name } = {}) {
  const spec = specs[authorityName];
  const directory = join(packetDir, name);
  await mkdir(directory, { recursive: true });
  const manifestText = `${JSON.stringify({ schema: manifestSchema || spec.manifestSchema, boundary: spec.boundary, reference, ...spec.manifestExtra, ...overrides }, null, 2)}\n`;
  const digest = `sha256:${createHash('sha256').update(manifestText).digest('hex')}`;
  await writeFile(join(directory, 'tensor-manifest.json'), manifestText);
  await writeFile(join(directory, 'reference-receipt.json'), `${JSON.stringify({ ok: true, schema: spec.receiptSchema, boundary: spec.boundary, reference, ...spec.receiptExtra, ...overrides, outputs: { tensorManifest: join(directory, 'tensor-manifest.json'), tensorManifestSha256: digest } }, null, 2)}\n`);
  return digest;
}

async function writeIngressPacket() {
  const authority = SAM31_TWO_IMAGE_INGRESS_PACKET_AUTHORITY;
  const directory = join(packetDir, 'ingress');
  await mkdir(directory, { recursive: true });
  const sourceImages = [
    { frameIndex: 0, originalSha256: `sha256:${'1'.repeat(64)}`, rgbaSha256: `sha256:${'2'.repeat(64)}` },
    { frameIndex: 1, originalSha256: `sha256:${'3'.repeat(64)}`, rgbaSha256: `sha256:${'4'.repeat(64)}` },
  ];
  const tensors = [
    ['frame-0-interactive-feature-2', 'a'],
    ['frame-0-interactive-high-resolution-s0', 'b'],
    ['frame-0-interactive-high-resolution-s1', 'c'],
    ['frame-0-propagation-feature-2', 'd'],
    ['frame-0-propagation-position-2', 'e'],
    ['frame-1-propagation-feature-2', 'f'],
    ['frame-1-propagation-position-2', '5'],
    ['frame-1-high-resolution-s0', '6'],
    ['frame-1-high-resolution-s1', '7'],
  ].map(([role, digit]) => ({ role, sha256: `sha256:${digit.repeat(64)}` }));
  const manifest = {
    schema: authority.manifestSchema,
    boundary: authority.boundary,
    routeIds: authority.routeIds,
    reference: {
      model: { id: authority.modelId, revision: authority.modelRevision },
      checkpoint: { sha256: authority.checkpointSha256 },
      source: { commit: authority.sourceCommit, clean: true },
    },
    claims: { twoDistinctSourceImages: true, officialMetaViTExecuted: true, officialMetaTriNeckExecuted: true, officialMetaHighResolutionProjectionExecuted: true, packetOwnsImageEmbeddingsAtBrowserRuntime: false },
    shape: {
      batch: 1,
      imageHeight: 28,
      imageWidth: 28,
      imageChannels: 3,
      patchSize: 14,
      patchHeight: 2,
      patchWidth: 2,
      patchTokens: 4,
      fpnLevels: [
        { level: 0, scaleFactor: 4, height: 8, width: 8 },
        { level: 1, scaleFactor: 2, height: 4, width: 4 },
        { level: 2, scaleFactor: 1, height: 2, width: 2 },
      ],
    },
    sourceImages,
    tensors,
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const digest = `sha256:${createHash('sha256').update(manifestText).digest('hex')}`;
  await writeFile(join(directory, 'tensor-manifest.json'), manifestText);
  await writeFile(join(directory, 'reference-receipt.json'), `${JSON.stringify({ ok: true, schema: authority.receiptSchema, boundary: authority.boundary, routeIds: authority.routeIds, outputs: { tensorManifestSha256: digest } }, null, 2)}\n`);
  return { digest, manifest };
}

function imageIngressFor(ingressDigest, ingressManifest, bindings = null) {
  const entries = Object.fromEntries(ingressManifest.tensors.map(entry => [entry.role, entry]));
  return {
    schema: ingressManifest.schema,
    boundary: ingressManifest.boundary,
    tensorManifestSha256: ingressDigest,
    sourceImages: ingressManifest.sourceImages,
    bindings: bindings || {
      frame0InteractiveFeature: entries['frame-0-interactive-feature-2'].sha256,
      frame0InteractiveHighResolution0: entries['frame-0-interactive-high-resolution-s0'].sha256,
      frame0InteractiveHighResolution1: entries['frame-0-interactive-high-resolution-s1'].sha256,
      frame0PropagationFeature: entries['frame-0-propagation-feature-2'].sha256,
      frame0PropagationPosition: entries['frame-0-propagation-position-2'].sha256,
      frame1PropagationFeature: entries['frame-1-propagation-feature-2'].sha256,
      frame1PropagationPosition: entries['frame-1-propagation-position-2'].sha256,
      frame1HighResolutionS0: entries['frame-1-high-resolution-s0'].sha256,
      frame1HighResolutionS1: entries['frame-1-high-resolution-s1'].sha256,
    },
  };
}

const digests = {};
for (const name of ['decoder', 'memory', 'temporal', 'episode']) digests[name] = await writePacket(name);

function verifyOnly(report, expected = digests, episodeMode = 'propagation-decoder') {
  const command = [driver.pathname,
    '--packet-dir', packetDir,
    '--report', report,
    '--reuse-packet', '1',
    '--verify-only', '1',
    '--episode-mode', episodeMode,
    '--expected-decoder-manifest-sha256', expected.decoder,
    '--expected-memory-manifest-sha256', expected.memory,
    '--expected-temporal-manifest-sha256', expected.temporal,
    '--expected-episode-manifest-sha256', expected.episode,
    '--debug-port', String(20000 + process.pid % 10000),
    '--server-port', String(30000 + process.pid % 10000),
    '--timeout-ms', '1000'];
  if (episodeMode !== 'propagation-decoder') command.push('--expected-pointer-manifest-sha256', expected.pointer);
  if (episodeMode === 'two-image') command.push('--expected-ingress-manifest-sha256', expected.ingress);
  return spawnSync(process.execPath, command, { cwd: root.pathname, encoding: 'utf8', timeout: 10000 });
}

const valid = verifyOnly(reportPath);
assert.equal(valid.status, 0, valid.stderr || valid.stdout);
const validReport = JSON.parse(await readFile(reportPath, 'utf8'));
assert.equal(validReport.ok, true);
assert.equal(validReport.packetAuthority.passed, true);
assert.deepEqual(validReport.packetAuthority.verifiedPackets, ['decoder', 'memory', 'temporal', 'episode']);
assert.equal(validReport.primary_output_written, false, 'authority-only verification must not pretend to write browser evidence');

const conditionedDigest = await writePacket('episode', { authorityName: 'conditionedEpisode' });
const pointerDigest = await writePacket('pointer');
const conditionedAsPropagationReportPath = join(packetDir, 'conditioned-as-propagation-report.json');
const conditionedAsPropagation = verifyOnly(conditionedAsPropagationReportPath, { ...digests, episode: conditionedDigest });
assert.notEqual(conditionedAsPropagation.status, 0, 'a conditioned packet must not select conditioned authority when propagation was requested');
assert.match(JSON.parse(await readFile(conditionedAsPropagationReportPath, 'utf8')).error, /episode.*manifest\.schema/);
const conditionedReportPath = join(packetDir, 'conditioned-report.json');
const conditioned = verifyOnly(conditionedReportPath, { ...digests, episode: conditionedDigest, pointer: pointerDigest }, 'mask-conditioning');
assert.equal(conditioned.status, 0, conditioned.stderr || conditioned.stdout);
const conditionedReport = JSON.parse(await readFile(conditionedReportPath, 'utf8'));
assert.equal(conditionedReport.packetAuthority.packets.episode.name, 'conditionedEpisode');
assert.deepEqual(conditionedReport.packetAuthority.verifiedPackets, ['decoder', 'memory', 'temporal', 'episode', 'pointer']);
assert.equal(conditionedReport.episodeMode, 'mask-conditioning');
digests.episode = await writePacket('episode');
const propagationAsConditionedReportPath = join(packetDir, 'propagation-as-conditioned-report.json');
const propagationAsConditioned = verifyOnly(propagationAsConditionedReportPath, digests, 'mask-conditioning');
assert.notEqual(propagationAsConditioned.status, 0, 'a propagation packet must not select legacy authority when mask conditioning was requested');
assert.match(JSON.parse(await readFile(propagationAsConditionedReportPath, 'utf8')).error, /conditionedEpisode.*manifest\.schema/);

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

const ingressPacket = await writeIngressPacket();
const validImageIngress = imageIngressFor(ingressPacket.digest, ingressPacket.manifest);
const twoImageEpisodeDigest = await writePacket('episode', { authorityName: 'twoImageEpisode', overrides: { imageIngress: validImageIngress } });
const ingressEntries = Object.fromEntries(ingressPacket.manifest.tensors.map(entry => [entry.role, entry]));
const pointerIngressAuthority = {
  passed: true,
  schema: ingressPacket.manifest.schema,
  manifestSha256: ingressPacket.digest,
  bindings: {
    frame0ImageEmbedding: ingressEntries['frame-0-interactive-feature-2'].sha256,
    frame0HighResolutionS0: ingressEntries['frame-0-interactive-high-resolution-s0'].sha256,
    frame0HighResolutionS1: ingressEntries['frame-0-interactive-high-resolution-s1'].sha256,
  },
};
const twoImagePointerDigest = await writePacket('pointer', { overrides: {
  shape: {
    ...SAM31_TWO_FRAME_PACKET_AUTHORITIES.pointer.shape,
    sourceImageHeight: 28,
    sourceImageWidth: 28,
    sourceMaskHeight: 32,
    sourceMaskWidth: 32,
    promptMaskHeight: 8,
    promptMaskWidth: 8,
  },
  ingressAuthority: pointerIngressAuthority,
} });
const twoImageDigests = { ...digests, ingress: ingressPacket.digest, episode: twoImageEpisodeDigest, pointer: twoImagePointerDigest };
const twoImageReportPath = join(packetDir, 'two-image-report.json');
const twoImage = verifyOnly(twoImageReportPath, twoImageDigests, 'two-image');
assert.equal(twoImage.status, 0, twoImage.stderr || twoImage.stdout);
const twoImageReport = JSON.parse(await readFile(twoImageReportPath, 'utf8'));
assert.equal(twoImageReport.packetAuthority.packets.episode.ingressBindingsPassed, true);
assert.equal(twoImageReport.packetAuthority.packets.episode.ingressBindingCount, 9);
assert.equal(twoImageReport.packetAuthority.packets.pointer.ingressBindingsPassed, true);
assert.equal(twoImageReport.packetAuthority.packets.pointer.ingressBindingCount, 3);

const falseBindings = { ...validImageIngress.bindings, frame0PropagationPosition: `sha256:${'0'.repeat(64)}` };
const falseEpisodeDigest = await writePacket('episode', { authorityName: 'twoImageEpisode', overrides: { imageIngress: imageIngressFor(ingressPacket.digest, ingressPacket.manifest, falseBindings) } });
const falseBindingReportPath = join(packetDir, 'two-image-false-binding-report.json');
const falseBinding = verifyOnly(falseBindingReportPath, { ...twoImageDigests, episode: falseEpisodeDigest }, 'two-image');
assert.notEqual(falseBinding.status, 0, 'the terminal authority gate must reject a coordinated rewrite of an ingress-owned position binding');
const falseBindingReport = JSON.parse(await readFile(falseBindingReportPath, 'utf8'));
assert.equal(falseBindingReport.failure_phase, 'verify_packet_authority');
assert.match(falseBindingReport.error, /twoImageEpisode.*imageIngress\.bindings\.frame0PropagationPosition/);
assert.equal(falseBindingReport.primary_output_written, false);

console.log('sam3.1 two-frame tracker driver authority contracts passed');
