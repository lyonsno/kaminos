import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const exporter = join(root, 'tools', 'sam31-two-image-ingress-meta-packet.py');
const python = process.env.KAMINOS_TORCH_PYTHON || '/Users/noahlyons/dev/sf3d/.venv/bin/python';
const sourceRoot = process.env.KAMINOS_SAM31_SOURCE_ROOT || '/Users/noahlyons/dev/sam3';
const checkpoint = process.env.KAMINOS_SAM31_CHECKPOINT || '/Users/noahlyons/.cache/huggingface/hub/models--facebook--sam3.1/snapshots/daa63191845a41281374e725f4c9e51c7a824460/sam3.1_multiplex.pt';
const frame0 = join(sourceRoot, 'assets', 'videos', '0001', '0.jpg');
const frame1 = join(sourceRoot, 'assets', 'videos', '0001', '1.jpg');
const outDir = await mkdtemp(join(tmpdir(), 'sam31-two-image-ingress-meta-'));

const result = spawnSync(python, [
  exporter,
  '--out-dir', outDir,
  '--source-root', sourceRoot,
  '--checkpoint', checkpoint,
  '--frame-0', frame0,
  '--frame-1', frame1,
  '--resolution', '28',
], { encoding: 'utf8', timeout: 180_000 });
assert.equal(result.status, 0, `official two-image exporter failed:\n${result.stdout}\n${result.stderr}`);

const manifestBytes = await readFile(join(outDir, 'tensor-manifest.json'));
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const receipt = JSON.parse(await readFile(join(outDir, 'reference-receipt.json'), 'utf8'));
assert.equal(manifest.schema, 'kaminos.sam31-two-image-ingress-meta-packet.v0');
assert.equal(receipt.schema, 'kaminos.sam31-two-image-ingress-meta-reference-receipt.v0');
assert.equal(manifest.boundary, 'sam31-two-distinct-raw-images-to-interactive-propagation-backbone-features');
assert.equal(receipt.boundary, manifest.boundary);
assert.equal(receipt.ok, true);
assert.equal(manifest.reference.model.id, 'facebook/sam3.1');
assert.equal(manifest.reference.model.revision, 'daa63191845a41281374e725f4c9e51c7a824460');
assert.equal(manifest.reference.source.commit, '5dd401d1c5c1d5c3eedff06d41b77af824517619');
assert.equal(manifest.reference.source.clean, true);
assert.equal(manifest.reference.checkpoint.sha256, 'sha256:0567debeec80ba4ac6369540c6c248025283cb3ff2b92827509e57e2b3541cb6');

assert.equal(manifest.sourceImages.length, 2);
assert.deepEqual(manifest.sourceImages.map(image => image.frameIndex), [0, 1]);
assert.notEqual(manifest.sourceImages[0].originalSha256, manifest.sourceImages[1].originalSha256, 'the fixture must begin from two distinct encoded frames');
assert.notEqual(manifest.sourceImages[0].rgbaSha256, manifest.sourceImages[1].rgbaSha256, 'the browser invocation must remain bound to two distinct resized RGBA tensors');
assert.equal(manifest.sourceImages.every(image => image.resolution[0] === 28 && image.resolution[1] === 28), true);

assert.deepEqual(manifest.shape, {
  batch: 1,
  imageHeight: 28,
  imageWidth: 28,
  imageChannels: 3,
  patchSize: 14,
  patchHeight: 2,
  patchWidth: 2,
  patchTokens: 4,
  visionHiddenSize: 1024,
  visionHeads: 16,
  visionHeadDim: 64,
  visionMlpHidden: 4736,
  visionWindowSize: 24,
  fpnHiddenSize: 256,
  fpnLevels: [
    { level: 0, scaleFactor: 4, height: 8, width: 8 },
    { level: 1, scaleFactor: 2, height: 4, width: 4 },
    { level: 2, scaleFactor: 1, height: 2, width: 2 },
  ],
  decoderHighResolutionS0Channels: 32,
  decoderHighResolutionS1Channels: 64,
});

assert.deepEqual(manifest.routeIds, [
  'sam3.image-preprocess.phase-program.webgpu-local.v0',
  'sam3.image-patch-embed.phase-program.webgpu-local.v0',
  'sam3.image-vit-prefix.phase-program.webgpu-local.v0',
  'sam3.image-vit-block-stack.phase-program.webgpu-local.v0',
  'sam3.1.interactive-neck.phase-program.webgpu-local.v0',
  'sam3.1.image-propagation-neck.phase-program.webgpu-local.v0',
  'sam3.1.decoder-high-resolution-projection.phase-program.webgpu-local.v0',
]);
assert.deepEqual(manifest.execution.officialCalls, [
  'ViT.forward(frame-0)',
  'Sam3TriViTDetNeck.forward(frame-0, need_interactive_out=True, need_propagation_out=True)',
  'MultiplexMaskDecoder.conv_s0(frame-0-interactive-level-0)',
  'MultiplexMaskDecoder.conv_s1(frame-0-interactive-level-1)',
  'ViT.forward(frame-1)',
  'Sam3TriViTDetNeck.forward(frame-1, need_interactive_out=False, need_propagation_out=True)',
  'MultiplexMaskDecoder.conv_s0(frame-1-propagation-level-0)',
  'MultiplexMaskDecoder.conv_s1(frame-1-propagation-level-1)',
]);
assert.equal(manifest.execution.cpuCompatibilitySubstitution.kind, 'meta-fused-addmm-bfloat16-to-linear-exact-gelu');
assert.equal(manifest.execution.cpuCompatibilitySubstitution.semanticOperationPreserved, true);
assert.deepEqual(manifest.tolerances, {
  pixelValuesMaxAbsDiff: 0.000001,
  patchEmbeddingsMaxAbsDiff: 0.0005,
  vitPrefixMaxAbsDiff: 0.006,
  vitBackboneMaxAbsDiff: 0.02,
  vitBackboneMeanAbsDiff: 0.0001,
  vitBackboneRootMeanSquareDiff: 0.0003,
  vitBackboneRelativeDiffAtMaxAbsDiff: 0.002,
  neckMaxAbsDiff: 0.02,
  positionMaxAbsDiff: 0.00001,
  highResolutionMaxAbsDiff: 0.02,
}, 'the measured ViT-prefix budget must not relax any downstream parity gate');

const requiredTensorRoles = [
  'frame-0-rgba', 'frame-1-rgba',
  'frame-0-pixel-values', 'frame-1-pixel-values',
  'frame-0-patch-embeddings', 'frame-1-patch-embeddings',
  'frame-0-vit-prefix-hidden-states', 'frame-1-vit-prefix-hidden-states',
  'frame-0-vit-backbone-hidden-states', 'frame-1-vit-backbone-hidden-states',
  'frame-0-interactive-feature-0', 'frame-0-interactive-feature-1', 'frame-0-interactive-feature-2', 'frame-0-interactive-position-2',
  'frame-0-interactive-high-resolution-s0', 'frame-0-interactive-high-resolution-s1',
  'frame-0-propagation-feature-0', 'frame-0-propagation-feature-1', 'frame-0-propagation-feature-2', 'frame-0-propagation-position-2',
  'frame-1-propagation-feature-0', 'frame-1-propagation-feature-1', 'frame-1-propagation-feature-2', 'frame-1-propagation-position-2',
  'frame-1-high-resolution-s0', 'frame-1-high-resolution-s1',
];
const tensorsByRole = new Map(manifest.tensors.map(entry => [entry.role, entry]));
for (const role of requiredTensorRoles) {
  assert.equal(tensorsByRole.has(role), true, `packet is missing ${role}`);
  const entry = tensorsByRole.get(role);
  assert.equal((await stat(join(outDir, entry.file))).size, entry.byteLength, `${role} byte length must match its artifact`);
}

assert.equal(manifest.weights.length, 556, 'packet must export every browser-consumed trunk, branch-neck, and high-resolution projection role');
assert.equal(new Set(manifest.weights.map(entry => entry.role)).size, 556, 'browser weight roles must be unique');
assert.deepEqual(manifest.checkpointAudit, {
  officialStateTensorCount: manifest.checkpointAudit.officialStateTensorCount,
  officialTrunkTensorCount: 420,
  generatedRopeBufferCount: 32,
  interactiveNeckTensorCount: 18,
  propagationNeckTensorCount: 18,
  highResolutionProjectionTensorCount: 4,
  browserWeightRoleCount: 556,
  allMappedOfficialKeysPresent: true,
  allOfficialModuleLoadsAccepted: true,
});
assert.equal(receipt.outputs.tensorManifestSha256, `sha256:${createHash('sha256').update(manifestBytes).digest('hex')}`, 'reference receipt must bind the exact manifest bytes');

const failureDir = await mkdtemp(join(tmpdir(), 'sam31-two-image-ingress-meta-failure-'));
const failure = spawnSync(python, [
  exporter,
  '--out-dir', failureDir,
  '--source-root', sourceRoot,
  '--checkpoint', join(failureDir, 'missing.pt'),
  '--frame-0', frame0,
  '--frame-1', frame1,
], { encoding: 'utf8', timeout: 30_000 });
assert.notEqual(failure.status, 0, 'missing checkpoint must fail');
const failureReceipt = JSON.parse(await readFile(join(failureDir, 'reference-receipt.json'), 'utf8'));
assert.equal(failureReceipt.ok, false);
assert.equal(failureReceipt.failurePhase, 'identity-validation');
assert.equal(failureReceipt.primaryOutputWritten, false);
assert.equal(failureReceipt.lastTrustworthyEvidence, 'No primary two-image ingress packet was published.');
await assert.rejects(readFile(join(failureDir, 'tensor-manifest.json')), /ENOENT/, 'failed export must not leave a primary manifest');

console.log('sam3.1 two-image ingress official Meta packet contracts passed');
