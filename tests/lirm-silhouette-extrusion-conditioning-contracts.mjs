import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const script = new URL('../lirm-silhouette-extrusion-conditioning.py', import.meta.url);
assert.ok(existsSync(script), 'silhouette seeds need an actual 3D conditioning bridge');

const sourceDir = await mkdtemp(join(tmpdir(), 'kaminos-silhouette-extrusion-source-'));
await mkdir(join(sourceDir, 'generated'));
const size = 48;
const sdf = new Float32Array(size * size);
const mask = new Uint8Array(size * size);
for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    const ax = (x - 18) / 11;
    const ay = (y - 24) / 14;
    const bx = (x - 31) / 9;
    const by = (y - 18) / 8;
    const body = 1 - Math.sqrt(ax * ax + ay * ay);
    const head = 1 - Math.sqrt(bx * bx + by * by);
    const value = Math.max(body * 10, head * 8);
    sdf[y * size + x] = value;
    mask[y * size + x] = value >= 0 ? 255 : 0;
  }
}
const pgm = Buffer.concat([Buffer.from(`P5\n${size} ${size}\n255\n`), Buffer.from(mask)]);
const expectedMaskHash = `sha256:${createHash('sha256').update(pgm).digest('hex')}`;
const expectedMaskArrayHash = `sha256:${createHash('sha256').update(Buffer.from(mask.map((value) => value ? 1 : 0))).digest('hex')}`;
writeFileSync(join(sourceDir, 'generated', 'shape-a.pgm'), pgm);
writeFileSync(join(sourceDir, 'generated', 'shape-a.f32'), Buffer.from(sdf.buffer));
await writeFile(join(sourceDir, 'receipt.json'), `${JSON.stringify({
  schema: 'kaminos.lirm-silhouette-local-shape-space-assay.v0',
  status: 'complete',
  routeIdentity: {
    requestedRoute: 'kaminos/lirm-speciation-armature/silhouette-local-shape-space-v0',
    effectiveRoute: 'numpy-local-sdf-pca-topology-neighborhood-v0',
  },
})}\n`);
await writeFile(join(sourceDir, 'accepted-generation-index.jsonl'), `${JSON.stringify({
  schema: 'kaminos.lirm-silhouette-local-generation.v0',
  generationId: 'shape-a',
  noveltyAssay: { copied: false },
  maskPath: 'generated/shape-a.pgm',
  signedDistancePath: 'generated/shape-a.f32',
})}\n`);

const outDir = await mkdtemp(join(tmpdir(), 'kaminos-silhouette-extrusion-out-'));
const run = spawnSync('python3', [
  script.pathname,
  '--shape-space-dir', sourceDir,
  '--generation-ids', 'shape-a',
  '--out-dir', outDir,
  '--resolution', '96',
  '--thickness', '0.3',
  '--roundness', '0.06',
], { encoding: 'utf8' });
assert.equal(run.status, 0, `silhouette extrusion failed: ${run.stderr || run.stdout}`);

const receipt = JSON.parse(readFileSync(join(outDir, 'receipt.json'), 'utf8'));
assert.equal(receipt.schema, 'kaminos.lirm-silhouette-extrusion-conditioning-witness.v0');
assert.equal(receipt.status, 'complete');
assert.equal(receipt.routeIdentity.requestedRoute, 'kaminos/lirm-speciation-armature/silhouette-extrusion-conditioning-v0');
assert.equal(receipt.routeIdentity.effectiveRoute, 'cpu-sdf-raymarch-rounded-extrusion-v0');
assert.equal(receipt.sourceRouteIdentity.effectiveRoute, 'numpy-local-sdf-pca-topology-neighborhood-v0');
assert.equal(receipt.generatedBodyCount, 1);
assert.equal(receipt.bodies[0].generationId, 'shape-a');
assert.equal(receipt.bodies[0].source.maskFileHash, expectedMaskHash, 'packet must bind the exact generated silhouette file bytes');
assert.equal(receipt.bodies[0].volume.kind, 'rounded_silhouette_extrusion_sdf');
assert.equal(receipt.bodies[0].volume.actual3dStructure, true);
assert.ok(receipt.bodies[0].renderStats.hitPixelCount > 100);
assert.ok(receipt.bodies[0].renderStats.distinctDepthLevels > 8, 'depth must vary across the actual 3D surface');
assert.ok(receipt.bodies[0].renderStats.distinctNormalColors > 16, 'normal map must encode curved 3D surface variation');
assert.equal(receipt.falseClosureGuards.flatMaskRelabeledAsDepth, 'rejected');
for (const kind of ['clay', 'depth', 'normal']) {
  const contactSheet = receipt.outputInventory.contactSheets[kind];
  assert.match(contactSheet.hash, /^sha256:/, `${kind} contact sheet must be hash-bound`);
  const contactSheetBytes = readFileSync(join(outDir, contactSheet.path));
  assert.ok(contactSheetBytes.length > 100, `${kind} contact sheet must be nonblank`);
  assert.equal(
    contactSheet.hash,
    `sha256:${createHash('sha256').update(contactSheetBytes).digest('hex')}`,
    `${kind} contact sheet hash must bind its exact bytes`,
  );
}
for (const kind of ['clay', 'depth', 'normal', 'mask']) {
  const output = receipt.bodies[0].outputs[kind];
  const path = join(outDir, output.path);
  assert.ok(existsSync(path), `${kind} output must exist`);
  const bytes = readFileSync(path);
  assert.ok(bytes.length > 100, `${kind} output must be nonblank`);
  assert.equal(output.byteSize, bytes.length, `${kind} byte size must bind its exact output`);
  assert.equal(
    output.hash,
    `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    `${kind} hash must bind its exact output bytes`,
  );
}
const verified = spawnSync('python3', [
  script.pathname,
  '--verify-output-dir', outDir,
], { encoding: 'utf8' });
assert.equal(verified.status, 0, `fresh conditioning outputs must verify: ${verified.stderr || verified.stdout}`);
const verificationReportPath = join(outDir, 'verification-report.json');
let verificationReport = JSON.parse(readFileSync(verificationReportPath, 'utf8'));
assert.equal(verificationReport.status, 'complete');
assert.equal(verificationReport.verifiedBodyCount, 1);

const mutatedDepthPath = join(outDir, receipt.bodies[0].outputs.depth.path);
writeFileSync(mutatedDepthPath, Buffer.concat([readFileSync(mutatedDepthPath), Buffer.from([0])]));
const mutatedVerification = spawnSync('python3', [
  script.pathname,
  '--verify-output-dir', outDir,
], { encoding: 'utf8' });
assert.notEqual(mutatedVerification.status, 0, 'mutated conditioning output must fail verification');
verificationReport = JSON.parse(readFileSync(verificationReportPath, 'utf8'));
assert.equal(verificationReport.status, 'failed');
assert.equal(verificationReport.failurePhase, 'output_inventory_verification');
assert.match(verificationReport.error, /depth.*(byte size|hash) mismatch/i);

const latentSourceDir = await mkdtemp(join(tmpdir(), 'kaminos-silhouette-extrusion-latent-source-'));
await mkdir(join(latentSourceDir, 'generated'));
await writeFile(join(latentSourceDir, 'generated', 'prior-shape-0000.pgm'), pgm);
const normalizedSdf = new Float32Array(sdf.length);
for (let index = 0; index < sdf.length; index += 1) normalizedSdf[index] = sdf[index] / 40;
await writeFile(join(latentSourceDir, 'generated', 'prior-shape-0000.f32'), Buffer.from(normalizedSdf.buffer));
const narrowSdf = new Float32Array(size * size);
const narrowMask = new Uint8Array(size * size);
for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    const dx = (x - 24) / 5;
    const dy = (y - 24) / 12;
    const value = (1 - Math.sqrt(dx * dx + dy * dy)) / 8;
    narrowSdf[y * size + x] = value;
    narrowMask[y * size + x] = value >= 0 ? 255 : 0;
  }
}
const narrowPgm = Buffer.concat([Buffer.from(`P5\n${size} ${size}\n255\n`), Buffer.from(narrowMask)]);
await writeFile(join(latentSourceDir, 'generated', 'prior-shape-0001.pgm'), narrowPgm);
await writeFile(join(latentSourceDir, 'receipt.json'), `${JSON.stringify({
  schema: 'kaminos.lirm-silhouette-latent-sample.v0',
  status: 'complete',
  phase: 'witness_written',
  routeIdentity: {
    requestedRoute: 'kaminos/lirm-speciation-armature/silhouette-latent-sample-v0',
    effectiveRoute: 'mlx-sdf-vae-prior-sample-v0',
  },
  generatedSampleCount: 2,
  acceptedSampleCount: 2,
  generations: [{
    generationId: 'prior-shape-0000',
    acceptedForDownstream: true,
    noveltyAssay: { copied: false },
    maskPath: 'generated/prior-shape-0000.pgm',
    signedDistancePath: 'generated/prior-shape-0000.f32',
  }, {
    generationId: 'prior-shape-0001',
    acceptedForDownstream: true,
    noveltyAssay: { copied: false },
    maskPath: 'generated/prior-shape-0001.pgm',
    signedDistancePath: 'generated/prior-shape-0001.f32',
  }],
}, null, 2)}\n`);
const latentOutDir = await mkdtemp(join(tmpdir(), 'kaminos-silhouette-extrusion-latent-out-'));
const latentRun = spawnSync('python3', [
  script.pathname,
  '--shape-space-dir', latentSourceDir,
  '--generation-ids', 'prior-shape-0000,prior-shape-0001',
  '--out-dir', latentOutDir,
  '--resolution', '96',
], { encoding: 'utf8' });
assert.equal(latentRun.status, 0, `latent silhouette extrusion failed: ${latentRun.stderr || latentRun.stdout}`);
const latentReceipt = JSON.parse(readFileSync(join(latentOutDir, 'receipt.json'), 'utf8'));
assert.equal(latentReceipt.status, 'complete');
assert.equal(latentReceipt.sourceRouteIdentity.effectiveRoute, 'mlx-sdf-vae-prior-sample-v0');
assert.match(latentReceipt.sourceReceiptHash, /^sha256:/);
assert.equal(latentReceipt.generatedBodyCount, 2);
assert.equal(latentReceipt.bodies[0].generationId, 'prior-shape-0000');
assert.equal(latentReceipt.bodies[0].source.receiptHash, latentReceipt.sourceReceiptHash);
assert.equal(latentReceipt.bodies[0].volume.sourceDistanceKind, 'mask-derived-chamfer-signed-distance');
assert.equal(latentReceipt.outputInventory.contactSheets.clay.path, 'clay-contact-sheet.png');
const latentHitFractions = latentReceipt.bodies.map((body) => body.renderStats.hitPixelFraction);
assert.ok(
  Math.max(...latentHitFractions) - Math.min(...latentHitFractions) > 0.08,
  'distinct latent silhouettes must remain geometrically distinct after extrusion',
);

const basinSourceDir = await mkdtemp(join(tmpdir(), 'kaminos-silhouette-extrusion-basin-source-'));
await mkdir(join(basinSourceDir, 'generated'));
await writeFile(join(basinSourceDir, 'generated', 'basin-03-s3p00-n00.pgm'), pgm);
await writeFile(join(basinSourceDir, 'generated', 'basin-03-s3p00-n00.f32'), Buffer.from(normalizedSdf.buffer));
const expectedSignedDistanceHash = `sha256:${createHash('sha256').update(Buffer.from(normalizedSdf.buffer)).digest('hex')}`;
const basinSourceReceipt = {
  schema: 'kaminos.lirm-silhouette-basin-latent.v0',
  status: 'complete',
  phase: 'witness_written',
  routeIdentity: {
    requestedRoute: 'kaminos/lirm-speciation-armature/silhouette-basin-latent-v0',
    effectiveRoute: 'mlx-sdf-vae-posterior-basin-perturbation-v0',
  },
  generatedSampleCount: 1,
  acceptedSampleCount: 1,
  generations: [{
    generationId: 'basin-03-s3p00-n00',
    sourceBasinIndex: 3,
    strength: 3,
    targetBasinRetained: true,
    acceptedForDownstream: true,
    sourceEscapeAssay: {
      nearestTraining: { copied: false },
    },
    usabilityAssay: {
      usable: true,
      componentCount: 1,
      largestComponentFraction: 1,
    },
    maskHash: expectedMaskArrayHash,
    signedDistanceHash: expectedSignedDistanceHash,
    maskPath: 'generated/basin-03-s3p00-n00.pgm',
    signedDistancePath: 'generated/basin-03-s3p00-n00.f32',
  }],
};
await writeFile(join(basinSourceDir, 'receipt.json'), `${JSON.stringify(basinSourceReceipt, null, 2)}\n`);
const basinOutDir = await mkdtemp(join(tmpdir(), 'kaminos-silhouette-extrusion-basin-out-'));
const basinRun = spawnSync('python3', [
  script.pathname,
  '--shape-space-dir', basinSourceDir,
  '--generation-ids', 'basin-03-s3p00-n00',
  '--out-dir', basinOutDir,
  '--resolution', '96',
], { encoding: 'utf8' });
assert.equal(basinRun.status, 0, `basin-posterior silhouette extrusion failed: ${basinRun.stderr || basinRun.stdout}`);
const basinReceipt = JSON.parse(readFileSync(join(basinOutDir, 'receipt.json'), 'utf8'));
assert.equal(basinReceipt.status, 'complete');
assert.equal(basinReceipt.sourceRouteIdentity.effectiveRoute, 'mlx-sdf-vae-posterior-basin-perturbation-v0');
assert.equal(basinReceipt.generatedBodyCount, 1);
assert.equal(basinReceipt.bodies[0].source.sourceBasinIndex, 3);
assert.equal(basinReceipt.bodies[0].source.posteriorStrength, 3);
assert.equal(basinReceipt.bodies[0].source.usabilityAssay.componentCount, 1);
assert.equal(basinReceipt.bodies[0].source.sourceReceiptMaskHash, expectedMaskArrayHash);
assert.equal(basinReceipt.bodies[0].source.maskArrayHash, expectedMaskArrayHash);
assert.equal(basinReceipt.bodies[0].source.maskFileHash, expectedMaskHash);
assert.equal(basinReceipt.bodies[0].source.sourceReceiptSignedDistanceHash, expectedSignedDistanceHash);
assert.equal(basinReceipt.bodies[0].source.signedDistanceFileHash, expectedSignedDistanceHash);
assert.equal(basinReceipt.bodies[0].volume.sourceDistanceKind, 'mask-derived-chamfer-signed-distance');

const malformedBasinRows = [
  ['sourceBasinIndex', (row) => { delete row.sourceBasinIndex; }],
  ['strength', (row) => { delete row.strength; }],
  ['targetBasinRetained', (row) => { delete row.targetBasinRetained; }],
  ['usabilityAssay', (row) => { delete row.usabilityAssay; }],
  ['usabilityAssay.usable', (row) => { row.usabilityAssay.usable = false; }],
  ['sourceEscapeAssay.nearestTraining.copied', (row) => { delete row.sourceEscapeAssay.nearestTraining.copied; }],
  ['maskHash', (row) => { delete row.maskHash; }],
  ['signedDistanceHash', (row) => { delete row.signedDistanceHash; }],
  ['maskPath', (row) => { delete row.maskPath; }],
  ['signedDistancePath', (row) => { delete row.signedDistancePath; }],
];
for (const [label, mutate] of malformedBasinRows) {
  const malformedDir = await mkdtemp(join(tmpdir(), 'kaminos-silhouette-extrusion-basin-malformed-'));
  await mkdir(join(malformedDir, 'generated'));
  await writeFile(join(malformedDir, 'generated', 'basin-03-s3p00-n00.pgm'), pgm);
  await writeFile(join(malformedDir, 'generated', 'basin-03-s3p00-n00.f32'), Buffer.from(normalizedSdf.buffer));
  const malformedReceipt = structuredClone(basinSourceReceipt);
  mutate(malformedReceipt.generations[0]);
  await writeFile(join(malformedDir, 'receipt.json'), `${JSON.stringify(malformedReceipt, null, 2)}\n`);
  const malformedRun = spawnSync('python3', [
    script.pathname,
    '--shape-space-dir', malformedDir,
    '--generation-ids', 'basin-03-s3p00-n00',
    '--out-dir', join(malformedDir, 'out'),
    '--resolution', '96',
  ], { encoding: 'utf8' });
  assert.notEqual(malformedRun.status, 0, `basin row missing or invalid ${label} must be rejected`);
  const malformedOutputReceipt = JSON.parse(readFileSync(join(malformedDir, 'out', 'receipt.json'), 'utf8'));
  assert.equal(malformedOutputReceipt.status, 'failed');
  assert.match(malformedOutputReceipt.error, new RegExp(label.replaceAll('.', '\\.'), 'i'));
}

const copiedDir = await mkdtemp(join(tmpdir(), 'kaminos-silhouette-extrusion-copied-'));
await writeFile(join(copiedDir, 'receipt.json'), readFileSync(join(sourceDir, 'receipt.json')));
await mkdir(join(copiedDir, 'generated'));
await writeFile(join(copiedDir, 'generated', 'shape-a.pgm'), pgm);
await writeFile(join(copiedDir, 'generated', 'shape-a.f32'), Buffer.from(sdf.buffer));
await writeFile(join(copiedDir, 'accepted-generation-index.jsonl'), `${JSON.stringify({
  generationId: 'shape-a',
  noveltyAssay: { copied: true },
  maskPath: 'generated/shape-a.pgm',
  signedDistancePath: 'generated/shape-a.f32',
})}\n`);
const rejected = spawnSync('python3', [
  script.pathname,
  '--shape-space-dir', copiedDir,
  '--generation-ids', 'shape-a',
  '--out-dir', join(copiedDir, 'out'),
], { encoding: 'utf8' });
assert.notEqual(rejected.status, 0, 'copied silhouettes must not silently enter conditioning packets');
const rejectedReceipt = JSON.parse(readFileSync(join(copiedDir, 'out', 'receipt.json'), 'utf8'));
assert.equal(rejectedReceipt.status, 'failed');
assert.match(rejectedReceipt.error, /not accepted for downstream conditioning/);
