import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeSilhouetteArchetypeCorpusWitness } from '../lirm-silhouette-archetype-corpus-core.js';

const assayScript = new URL('../lirm-silhouette-shape-space-assay.py', import.meta.url);
assert.ok(existsSync(assayScript), 'shape-space assay must exist before latent-manifold claims can be made');

function mask(width, height, points) {
  const data = Array(width * height).fill(0);
  for (const [x, y] of points) data[y * width + x] = 1;
  return { width, height, data };
}

function rectPoints(x0, y0, x1, y1) {
  const points = [];
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) points.push([x, y]);
  return points;
}

const shapes = [
  rectPoints(2, 4, 10, 7),
  [...rectPoints(4, 2, 7, 11), ...rectPoints(7, 8, 12, 11)],
  [...rectPoints(2, 3, 12, 5), ...rectPoints(6, 5, 8, 12)],
  [...rectPoints(2, 2, 5, 11), ...rectPoints(5, 8, 12, 11)],
  [...rectPoints(3, 3, 11, 10), ...rectPoints(11, 6, 14, 8)],
  [...rectPoints(1, 5, 8, 9), ...rectPoints(8, 2, 11, 12)],
];
const manifestSources = shapes.map((_shape, index) => ({
  sourceId: `fixture-shape-${index}`,
  provider: 'shape-space-contract',
  sourceUrl: `https://example.invalid/${index}.png`,
  sourcePageUrl: `https://example.invalid/${index}`,
  retrievedAt: '2026-07-13T00:00:00.000Z',
}));
const corpusDir = await mkdtemp(join(tmpdir(), 'kaminos-shape-space-corpus-'));
await writeSilhouetteArchetypeCorpusWitness({
  outDir: corpusDir,
  targetSize: 32,
  padding: 3,
  manifest: { schema: 'kaminos.lirm-silhouette-source-manifest.v0', sources: manifestSources },
  fetchSource: async source => ({
    bytes: Buffer.from(`shape-space:${source.sourceId}`),
    contentType: 'image/png',
    effectiveUrl: source.sourceUrl,
    cacheStatus: 'contract',
  }),
  decodeMask: async (_download, source) => mask(16, 16, shapes[Number(source.sourceId.split('-').at(-1))]),
});

const outDir = await mkdtemp(join(tmpdir(), 'kaminos-shape-space-assay-'));
const args = [
  assayScript.pathname,
  '--corpus-dir', corpusDir,
  '--out-dir', outDir,
  '--components', '4',
  '--samples', '8',
  '--seed', '713',
  '--copy-threshold', '0.98',
];
const run = spawnSync('python3', args, { encoding: 'utf8' });
assert.equal(run.status, 0, `shape-space assay failed: ${run.stderr || run.stdout}`);

const receipt = JSON.parse(readFileSync(join(outDir, 'receipt.json'), 'utf8'));
assert.equal(receipt.schema, 'kaminos.lirm-silhouette-shape-space-assay.v0');
assert.equal(receipt.status, 'complete');
assert.equal(receipt.routeIdentity.requestedRoute, 'kaminos/lirm-speciation-armature/silhouette-shape-space-v0');
assert.equal(receipt.routeIdentity.effectiveRoute, 'numpy-svd-sdf-pca-v0');
assert.equal(receipt.trainingSampleCount, 6);
assert.equal(receipt.effectiveComponentCount, 4);
assert.equal(receipt.generatedSampleCount, 8);
assert.equal(receipt.generations.every(item => item.noveltyAssay?.metric === 'canonical-mask-iou'), true);
assert.equal(receipt.generations.every(item => item.parentShapeIds.length >= 1), true);
assert.equal(receipt.falseClosureGuards.identityUsedAsModelInput, 'false');
assert.equal(receipt.falseClosureGuards.unassayedGenerationCount, 0);
assert.ok(existsSync(join(outDir, 'contact-sheet.svg')));
assert.ok(existsSync(join(outDir, 'contact-sheet.png')));
assert.ok(existsSync(join(outDir, receipt.generations[0].maskPath)));
assert.ok(existsSync(join(outDir, receipt.generations[0].signedDistancePath)));

const repeatDir = await mkdtemp(join(tmpdir(), 'kaminos-shape-space-repeat-'));
const repeat = spawnSync('python3', args.map((value, index) => args[index - 1] === '--out-dir' ? repeatDir : value), { encoding: 'utf8' });
assert.equal(repeat.status, 0, repeat.stderr);
const repeatReceipt = JSON.parse(readFileSync(join(repeatDir, 'receipt.json'), 'utf8'));
assert.deepEqual(
  repeatReceipt.generations.map(item => [item.mode, item.parentShapeIds, item.maskHash]),
  receipt.generations.map(item => [item.mode, item.parentShapeIds, item.maskHash]),
  'same corpus, seed, and component count must reproduce the generated shape family',
);

