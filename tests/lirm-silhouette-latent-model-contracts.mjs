import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const trainer = new URL('../lirm-silhouette-latent-model.py', import.meta.url);
const reassay = new URL('../lirm-silhouette-latent-reassay.py', import.meta.url);
assert.ok(existsSync(trainer), 'silhouette latent-model trainer must exist');
assert.ok(existsSync(reassay), 'silhouette latent-model reassay must exist');

function writePgm(size, inset, variant) {
  const data = Buffer.alloc(size * size);
  for (let y = inset; y < size - inset; y += 1) {
    for (let x = inset; x < size - inset; x += 1) {
      const notch = variant % 2 === 0 && x > size / 2 && y < inset + 3;
      if (!notch) data[y * size + x] = 255;
    }
  }
  return Buffer.concat([Buffer.from(`P5\n${size} ${size}\n255\n`), data]);
}

function writeSdf(size, inset, variant) {
  const values = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = Math.max(inset - x, 0, x - (size - inset - 1));
      const dy = Math.max(inset - y, 0, y - (size - inset - 1));
      const outside = Math.hypot(dx, dy);
      const inside = Math.min(x - inset, y - inset, size - inset - 1 - x, size - inset - 1 - y);
      values[y * size + x] = outside > 0 ? -outside : Math.max(0.25, inside + 0.25 + variant * 0.01);
    }
  }
  return Buffer.from(values.buffer);
}

async function makeCorpus(root, prefix, count, options = {}) {
  await mkdir(join(root, 'masks'), { recursive: true });
  await mkdir(join(root, 'sdf'), { recursive: true });
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    const shapeId = `${prefix}-${index}`;
    const maskPath = `masks/${shapeId}.pgm`;
    const sdfPath = `sdf/${shapeId}.f32`;
    await writeFile(join(root, maskPath), writePgm(16, 2 + (index % 3), index));
    await writeFile(join(root, sdfPath), writeSdf(16, 2 + (index % 3), index));
    rows.push({
      shapeId,
      sourceId: `copyrighted-character-name-${index}`,
      shapeHash: `sha256:${prefix}${index}`,
      sourceContentHash: `sha256:source-${prefix}${index}`,
      mask: { path: maskPath, width: 16, height: 16 },
      signedDistance: { path: sdfPath, dtype: 'float32-le', width: 16, height: 16 },
    });
  }
  await writeFile(join(root, 'training-index.jsonl'), `${rows.map(row => JSON.stringify(row)).join('\n')}\n`);
  await writeFile(join(root, 'receipt.json'), `${JSON.stringify({
    schema: 'kaminos.lirm-silhouette-archetype-corpus-witness.v0',
    status: options.status || 'complete',
    requestedSourceCount: count + Number(options.failedSourceCount || 0),
    acceptedSourceCount: count,
    failedSourceCount: Number(options.failedSourceCount || 0),
    routeIdentity: {
      requestedRoute: 'kaminos/lirm-speciation-armature/silhouette-archetype-corpus-v0',
      effectiveRoute: 'kaminos/lirm-speciation-armature/silhouette-archetype-corpus-v0',
    },
    falseClosureGuards: { sourceBytesRetained: false },
  }, null, 2)}\n`);
}

const root = await mkdtemp(join(tmpdir(), 'kaminos-silhouette-latent-contract-'));
const corpusA = join(root, 'corpus-a');
const corpusB = join(root, 'corpus-b');
await makeCorpus(corpusA, 'a', 5);
await makeCorpus(corpusB, 'b', 4, { status: 'partial', failedSourceCount: 2 });

const outDir = join(root, 'probe');
const args = [
  trainer.pathname,
  '--corpus-dir', corpusA,
  '--corpus-dir', corpusB,
  '--out-dir', outDir,
  '--seed', '713',
  '--validation-fraction', '0.22',
  '--probe-only',
];
const run = spawnSync('python3', args, { encoding: 'utf8' });
assert.equal(run.status, 0, `latent-model probe failed: ${run.stderr || run.stdout}`);

const receipt = JSON.parse(readFileSync(join(outDir, 'receipt.json'), 'utf8'));
assert.equal(receipt.schema, 'kaminos.lirm-silhouette-latent-model.v0');
assert.equal(receipt.status, 'complete');
assert.equal(receipt.phase, 'dataset_probe_complete');
assert.equal(receipt.routeIdentity.requestedRoute, 'kaminos/lirm-speciation-armature/silhouette-latent-model-v0');
assert.equal(receipt.routeIdentity.effectiveRoute, 'identity-free-sdf-dataset-probe-v0');
assert.equal(receipt.trainingSampleCount + receipt.validationSampleCount, 9);
assert.equal(receipt.validationSampleCount, 2);
assert.equal(receipt.inputShape, '16x16x1');
assert.equal(receipt.falseClosureGuards.sourceBytesConsumed, false);
assert.equal(receipt.falseClosureGuards.identityLabelsConsumed, false);
assert.equal(receipt.falseClosureGuards.missingSdfCount, 0);
assert.equal(receipt.falseClosureGuards.checkpointWritten, false);
assert.equal(receipt.falseClosureGuards.contactSheetRasterWritten, false);
assert.equal(receipt.corpora.length, 2);
assert.equal(receipt.corpora[1].status, 'partial');
assert.equal(receipt.corpora[1].requestedSourceCount, 6);
assert.equal(receipt.corpora[1].failedSourceCount, 2);

const datasetManifestText = readFileSync(join(outDir, 'dataset-manifest.json'), 'utf8');
assert.doesNotMatch(datasetManifestText, /copyrighted-character-name/);
assert.doesNotMatch(datasetManifestText, /sourceContentHash/);
const datasetManifest = JSON.parse(datasetManifestText);
assert.equal(datasetManifest.samples.length, 9);
assert.equal(datasetManifest.samples.every(sample => Object.keys(sample).sort().join(',') === 'corpusIndex,shapeHash,split,tensorHash'), true);

const repeatDir = join(root, 'probe-repeat');
const repeatArgs = args.map((value, index) => args[index - 1] === '--out-dir' ? repeatDir : value);
const repeat = spawnSync('python3', repeatArgs, { encoding: 'utf8' });
assert.equal(repeat.status, 0, repeat.stderr);
const repeatManifest = JSON.parse(readFileSync(join(repeatDir, 'dataset-manifest.json'), 'utf8'));
assert.deepEqual(repeatManifest.samples, datasetManifest.samples, 'same corpora and seed must reproduce split and ordering');

const brokenCorpus = join(root, 'corpus-broken');
await makeCorpus(brokenCorpus, 'broken', 3);
const brokenIndex = readFileSync(join(brokenCorpus, 'training-index.jsonl'), 'utf8')
  .replace('sdf/broken-1.f32', 'sdf/missing.f32');
await writeFile(join(brokenCorpus, 'training-index.jsonl'), brokenIndex);
const failureDir = join(root, 'failure');
const failed = spawnSync('python3', [
  trainer.pathname,
  '--corpus-dir', brokenCorpus,
  '--out-dir', failureDir,
  '--probe-only',
], { encoding: 'utf8' });
assert.notEqual(failed.status, 0, 'missing SDF must fail the probe');
const failureReceipt = JSON.parse(readFileSync(join(failureDir, 'receipt.json'), 'utf8'));
assert.equal(failureReceipt.status, 'failed');
assert.equal(failureReceipt.failurePhase, 'dataset_load');
assert.match(failureReceipt.errorMessage, /missing\.f32/);
assert.equal(failureReceipt.lastTrustworthyEvidence.corpusReceiptCount, 1);

const svgPath = join(root, 'raster-contract.svg');
const pngPath = join(root, 'raster-contract.png');
await writeFile(svgPath, '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#fff"/></svg>');
const rasterize = spawnSync('python3', ['-c', `
import importlib.util
from pathlib import Path
spec = importlib.util.spec_from_file_location("latent_model", ${JSON.stringify(trainer.pathname)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.rasterize_svg(Path(${JSON.stringify(svgPath)}), Path(${JSON.stringify(pngPath)}))
`], { encoding: 'utf8' });
assert.equal(rasterize.status, 0, `contact-sheet rasterization failed: ${rasterize.stderr || rasterize.stdout}`);
assert.ok(existsSync(pngPath), 'successful witness rasterization must produce the PNG');

const decodePolarity = spawnSync('python3', ['-c', `
import importlib.util
import numpy as np
spec = importlib.util.spec_from_file_location("latent_model", ${JSON.stringify(trainer.pathname)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
field = np.array([[-1.0, 0.0, 0.25], [2.0, -3.0, 4.0]], dtype=np.float32)
decoded = module.decode_sdf_mask(field)
expected = np.array([[0, 0, 1], [1, 0, 1]], dtype=np.uint8)
if not np.array_equal(decoded, expected):
    raise SystemExit(f"positive-inside SDF decoded incorrectly: {decoded.tolist()}")
interior = np.zeros((8, 8), dtype=np.uint8)
interior[2:6, 2:6] = 1
interior_assay = module.mask_usability_assay(interior)
if not interior_assay["usable"] or interior_assay["touchesFrame"]:
    raise SystemExit(f"padded silhouette rejected: {interior_assay}")
multipart = interior.copy()
multipart[1, 1] = 1
multipart_assay = module.mask_usability_assay(multipart)
if not multipart_assay["usable"] or multipart_assay["componentCount"] != 2:
    raise SystemExit(f"multipart silhouette rejected: {multipart_assay}")
clipped = interior.copy()
clipped[3, :3] = 1
clipped_assay = module.mask_usability_assay(clipped)
if clipped_assay["usable"] or not clipped_assay["touchesFrame"]:
    raise SystemExit(f"frame-clipped silhouette accepted: {clipped_assay}")
`], { encoding: 'utf8' });
assert.equal(
  decodePolarity.status,
  0,
  `corpus SDF polarity must decode positive values as foreground: ${decodePolarity.stderr || decodePolarity.stdout}`,
);

const sourceRun = join(root, 'source-run');
await mkdir(join(sourceRun, 'generated'), { recursive: true });
const interiorField = new Float32Array(16 * 16).fill(-1);
const clippedField = new Float32Array(16 * 16).fill(-1);
for (let y = 3; y < 13; y += 1) {
  for (let x = 5; x < 11; x += 1) interiorField[y * 16 + x] = 1;
}
for (let y = 4; y < 12; y += 1) {
  for (let x = 0; x < 8; x += 1) clippedField[y * 16 + x] = 1;
}
await writeFile(join(sourceRun, 'generated', 'latent-shape-000.f32'), Buffer.from(interiorField.buffer));
await writeFile(join(sourceRun, 'generated', 'latent-shape-001.f32'), Buffer.from(clippedField.buffer));
await writeFile(join(sourceRun, 'receipt.json'), `${JSON.stringify({
  schema: 'kaminos.lirm-silhouette-latent-model.v0',
  status: 'complete',
  phase: 'witness_written',
  routeIdentity: {
    requestedRoute: 'kaminos/lirm-speciation-armature/silhouette-latent-model-v0',
    effectiveRoute: 'mlx-convolutional-sdf-vae-v0',
  },
  requestedConfig: { seed: 713, validationFraction: 0.22, copyThreshold: 0.94 },
  effectiveConfig: { inputShape: [16, 16, 1], maskDecode: 'normalized_sdf < 0' },
  corpora: [{ path: corpusA }, { path: corpusB }],
  generations: [
    { generationId: 'latent-shape-000', mode: 'posterior-interpolation', parameters: {}, parentTensorHashes: [], signedDistancePath: 'generated/latent-shape-000.f32' },
    { generationId: 'latent-shape-001', mode: 'prior-sample', parameters: {}, parentTensorHashes: [], signedDistancePath: 'generated/latent-shape-001.f32' },
  ],
}, null, 2)}\n`);
const reassayDir = join(root, 'reassay');
const reassayRun = spawnSync('python3', [
  reassay.pathname,
  '--run-dir', sourceRun,
  '--out-dir', reassayDir,
], { encoding: 'utf8' });
assert.equal(reassayRun.status, 0, `latent reassay failed: ${reassayRun.stderr || reassayRun.stdout}`);
const reassayReceipt = JSON.parse(readFileSync(join(reassayDir, 'receipt.json'), 'utf8'));
assert.equal(reassayReceipt.schema, 'kaminos.lirm-silhouette-latent-reassay.v0');
assert.equal(reassayReceipt.status, 'complete');
assert.equal(reassayReceipt.phase, 'witness_written');
assert.equal(reassayReceipt.routeIdentity.effectiveRoute, 'positive-inside-sdf-reassay-v0');
assert.match(reassayReceipt.sourceRun.receiptHash, /^sha256:/);
assert.equal(reassayReceipt.falseClosureGuards.sourceFieldsReused, 2);
assert.equal(reassayReceipt.generations[0].acceptedForDownstream, true);
assert.equal(reassayReceipt.generations[0].usabilityAssay.touchesFrame, false);
assert.equal(reassayReceipt.generations[1].acceptedForDownstream, false);
assert.equal(reassayReceipt.generations[1].usabilityAssay.touchesFrame, true);
assert.equal(reassayReceipt.acceptedSampleCount, 1);
assert.ok(existsSync(join(reassayDir, 'contact-sheet.png')));
