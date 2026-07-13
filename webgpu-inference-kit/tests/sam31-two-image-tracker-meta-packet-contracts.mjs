import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const exporter = join(root, 'tools', 'sam31-two-frame-tracker-meta-packet.py');
const python = process.env.KAMINOS_TORCH_PYTHON || '/Users/noahlyons/dev/sf3d/.venv/bin/python';
const sourceRoot = process.env.KAMINOS_SAM31_SOURCE_ROOT || '/Users/noahlyons/dev/sam3';
const checkpoint = process.env.KAMINOS_SAM31_CHECKPOINT || '/Users/noahlyons/.cache/huggingface/hub/models--facebook--sam3.1/snapshots/daa63191845a41281374e725f4c9e51c7a824460/sam3.1_multiplex.pt';
const ingressPacketDir = process.env.KAMINOS_SAM31_TWO_IMAGE_INGRESS_PACKET;
assert.ok(ingressPacketDir, 'KAMINOS_SAM31_TWO_IMAGE_INGRESS_PACKET must name an authenticated exact ingress packet');

const ingressManifestBytes = await readFile(join(ingressPacketDir, 'tensor-manifest.json'));
const ingressManifest = JSON.parse(ingressManifestBytes.toString('utf8'));
const ingressManifestSha256 = `sha256:${createHash('sha256').update(ingressManifestBytes).digest('hex')}`;
const ingressByRole = new Map(ingressManifest.tensors.map(entry => [entry.role, entry]));
const outDir = await mkdtemp(join(tmpdir(), 'sam31-two-image-tracker-meta-'));

const result = spawnSync(python, [
  exporter,
  '--out-dir', outDir,
  '--source-root', sourceRoot,
  '--checkpoint', checkpoint,
  '--frame0-mode', 'mask-conditioning',
  '--ingress-packet-dir', ingressPacketDir,
  '--expected-ingress-manifest-sha256', ingressManifestSha256,
], { encoding: 'utf8', timeout: 180_000 });
assert.equal(result.status, 0, `official two-image tracker exporter failed:\n${result.stdout}\n${result.stderr}`);

const manifestBytes = await readFile(join(outDir, 'tensor-manifest.json'));
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const receipt = JSON.parse(await readFile(join(outDir, 'reference-receipt.json'), 'utf8'));
assert.equal(manifest.schema, 'kaminos.sam31-two-image-tracker-meta-packet.v0');
assert.equal(receipt.schema, 'kaminos.sam31-two-image-tracker-meta-reference-receipt.v0');
assert.equal(manifest.boundary, 'two-distinct-raw-images-through-browser-backbone-to-mask-conditioned-temporal-tracker');
assert.equal(receipt.boundary, manifest.boundary);
assert.equal(receipt.ok, true);
assert.equal(receipt.outputs.tensorManifestSha256, `sha256:${createHash('sha256').update(manifestBytes).digest('hex')}`);

assert.deepEqual(manifest.imageIngress, {
  schema: ingressManifest.schema,
  boundary: ingressManifest.boundary,
  tensorManifestSha256: ingressManifestSha256,
  sourceImages: ingressManifest.sourceImages,
  bindings: {
    frame0InteractiveFeature: ingressByRole.get('frame-0-interactive-feature-2').sha256,
    frame0InteractiveHighResolution0: ingressByRole.get('frame-0-interactive-high-resolution-s0').sha256,
    frame0InteractiveHighResolution1: ingressByRole.get('frame-0-interactive-high-resolution-s1').sha256,
    frame0PropagationFeature: ingressByRole.get('frame-0-propagation-feature-2').sha256,
    frame0PropagationPosition: ingressByRole.get('frame-0-propagation-position-2').sha256,
    frame1PropagationFeature: ingressByRole.get('frame-1-propagation-feature-2').sha256,
    frame1PropagationPosition: ingressByRole.get('frame-1-propagation-position-2').sha256,
    frame1HighResolutionS0: ingressByRole.get('frame-1-high-resolution-s0').sha256,
    frame1HighResolutionS1: ingressByRole.get('frame-1-high-resolution-s1').sha256,
  },
});
assert.notEqual(manifest.imageIngress.bindings.frame0InteractiveFeature, manifest.imageIngress.bindings.frame0PropagationFeature);
assert.notEqual(manifest.imageIngress.sourceImages[0].rgbaSha256, manifest.imageIngress.sourceImages[1].rgbaSha256);

assert.deepEqual(manifest.reference.execution, {
  kind: 'pinned-official-two-image-composed-method-and-module-execution',
  decoderClass: 'MultiplexMaskDecoder',
  maskConditioningMethod: 'VideoTrackingMultiplex._use_mask_as_output',
  interactivePromptEncoderClass: 'PromptEncoder',
  interactiveMaskDecoderClass: 'MaskDecoder',
  memoryMethod: 'VideoTrackingMultiplex._encode_new_memory',
  temporalMethod: 'VideoTrackingMultiplex._prepare_memory_conditioned_features',
  attentionClass: 'TransformerEncoderDecoupledCrossAttention',
});
assert.equal(manifest.claims.fullImageBackboneExecuted, true);
assert.equal(manifest.claims.twoDistinctRawImagesComposed, true);
assert.equal(manifest.claims.distinctInteractiveAndPropagationFeatures, true);
assert.equal(manifest.claims.packetOwnsImageEmbeddingsAtBrowserRuntime, false);
assert.equal(manifest.fixture.sourceFeaturesSynthetic, false);

const forbiddenPacketOwnedRoles = [
  'frame-0-image-embedding', 'frame-0-image-position',
  'frame-0-high-resolution-s0', 'frame-0-high-resolution-s1',
  'frame-1-image-embedding', 'frame-1-image-position',
  'frame-1-high-resolution-s0', 'frame-1-high-resolution-s1',
];
const tensorsByRole = new Map(manifest.tensors.map(entry => [entry.role, entry]));
for (const role of forbiddenPacketOwnedRoles) assert.equal(tensorsByRole.has(role), false, `${role} must remain ingress-owned`);
for (const role of [
  'frame-0-binary-mask-inputs', 'frame-0-memory-input-masks', 'frame-0-object-scores',
  'frame-0-object-pointers', 'frame-0-memory-features', 'frame-0-memory-position',
  'frame-1-assembled-memory-image', 'frame-1-assembled-memory',
  'frame-1-assembled-memory-image-position', 'frame-1-assembled-memory-position',
  'frame-1-memory-conditioned-features', 'frame-1-selected-masks',
  'frame-1-object-scores', 'frame-1-object-pointers',
  'frame-0-extra-per-object-embedding', 'frame-1-extra-per-object-embedding',
]) {
  const entry = tensorsByRole.get(role);
  assert.ok(entry, `composed packet is missing ${role}`);
  assert.equal((await stat(join(outDir, entry.file))).size, entry.byteLength, `${role} byte length must match`);
}

const failureDir = await mkdtemp(join(tmpdir(), 'sam31-two-image-tracker-meta-failure-'));
const failure = spawnSync(python, [
  exporter,
  '--out-dir', failureDir,
  '--source-root', sourceRoot,
  '--checkpoint', checkpoint,
  '--frame0-mode', 'mask-conditioning',
  '--ingress-packet-dir', ingressPacketDir,
  '--expected-ingress-manifest-sha256', `sha256:${'0'.repeat(64)}`,
], { encoding: 'utf8', timeout: 30_000 });
assert.notEqual(failure.status, 0, 'wrong invocation-scoped ingress digest must fail');
const failureReceipt = JSON.parse(await readFile(join(failureDir, 'reference-receipt.json'), 'utf8'));
assert.equal(failureReceipt.ok, false);
assert.equal(failureReceipt.failurePhase, 'image-ingress-validation');
await assert.rejects(readFile(join(failureDir, 'tensor-manifest.json')), /ENOENT/);

console.log('sam3.1 two-image tracker official Meta composition contracts passed');
