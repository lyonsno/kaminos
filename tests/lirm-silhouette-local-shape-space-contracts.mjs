import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeSilhouetteArchetypeCorpusWitness } from '../lirm-silhouette-archetype-corpus-core.js';

const assayScript = new URL('../lirm-silhouette-local-shape-space-assay.py', import.meta.url);
assert.ok(existsSync(assayScript), 'topology-local shape-space assay must exist before local-manifold claims can be made');

function blank(size = 24) {
  return { width: size, height: size, data: Array(size * size).fill(0) };
}

function fillRect(mask, x0, y0, x1, y1, value = 1) {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) mask.data[y * mask.width + x] = value;
  }
  return mask;
}

function solidVariant(index) {
  const mask = blank();
  fillRect(mask, 3 + index, 7 - index, 16 + index, 15 + index);
  fillRect(mask, 14, 4 + index, 18 + index, 10 + index);
  return mask;
}

function ringVariant(index) {
  const mask = blank();
  fillRect(mask, 3 + index, 3, 19, 19 - index);
  fillRect(mask, 7 + index, 7, 15, 15 - index, 0);
  if (index % 2) fillRect(mask, 2, 10, 5, 13);
  return mask;
}

const masks = [
  ...Array.from({ length: 4 }, (_value, index) => solidVariant(index)),
  ...Array.from({ length: 4 }, (_value, index) => ringVariant(index)),
];
const manifestSources = masks.map((_mask, index) => ({
  sourceId: `local-shape-${index}`,
  provider: 'local-shape-contract',
  sourceUrl: `https://example.invalid/${index}.png`,
  sourcePageUrl: `https://example.invalid/${index}`,
  retrievedAt: '2026-07-13T00:00:00.000Z',
}));

const corpusDir = await mkdtemp(join(tmpdir(), 'kaminos-local-shape-corpus-'));
await writeSilhouetteArchetypeCorpusWitness({
  outDir: corpusDir,
  targetSize: 48,
  padding: 4,
  manifest: { schema: 'kaminos.lirm-silhouette-source-manifest.v0', sources: manifestSources },
  fetchSource: async source => ({
    bytes: Buffer.from(`local-shape:${source.sourceId}`),
    contentType: 'image/png',
    effectiveUrl: source.sourceUrl,
    cacheStatus: 'contract',
  }),
  decodeMask: async (_download, source) => masks[Number(source.sourceId.split('-').at(-1))],
});

const outDir = await mkdtemp(join(tmpdir(), 'kaminos-local-shape-assay-'));
const args = [
  assayScript.pathname,
  '--corpus-dir', corpusDir,
  '--out-dir', outDir,
  '--components', '3',
  '--samples', '12',
  '--seed', '713',
  '--neighborhood-size', '4',
  '--copy-threshold', '0.98',
];
const run = spawnSync('python3', args, { encoding: 'utf8' });
assert.equal(run.status, 0, `local shape-space assay failed: ${run.stderr || run.stdout}`);

const receipt = JSON.parse(readFileSync(join(outDir, 'receipt.json'), 'utf8'));
assert.equal(receipt.schema, 'kaminos.lirm-silhouette-local-shape-space-assay.v0');
assert.equal(receipt.status, 'complete');
assert.equal(receipt.routeIdentity.requestedRoute, 'kaminos/lirm-speciation-armature/silhouette-local-shape-space-v0');
assert.equal(receipt.routeIdentity.effectiveRoute, 'numpy-local-sdf-pca-topology-neighborhood-v0');
assert.equal(receipt.trainingSampleCount, 8);
assert.equal(receipt.generatedSampleCount, 12);
assert.equal(receipt.requestedNeighborhoodSize, 4);
assert.equal(receipt.generations.every(item => item.neighborhood.parentTopologyCompatible === true), true);
assert.equal(receipt.generations.every(item => item.neighborhood.shapeIds.length >= 3), true);
assert.equal(receipt.generations.every(item => item.generatedTopology?.foregroundComponents >= 1), true);
assert.equal(receipt.generations.every(item => item.topologyRelation?.parentClass), true);
assert.equal(receipt.generations.every(item => item.noveltyAssay?.metric === 'canonical-mask-iou'), true);
assert.equal(receipt.generations.every(item => item.acceptedForDownstream === !item.noveltyAssay.copied), true);
assert.equal(receipt.falseClosureGuards.crossTopologyParentCount, 0);
assert.equal(receipt.falseClosureGuards.unassayedGenerationCount, 0);
assert.equal(receipt.falseClosureGuards.acceptedCopiedGenerationCount, 0);
assert.ok(existsSync(join(outDir, 'contact-sheet.svg')));
assert.ok(existsSync(join(outDir, 'contact-sheet.png')));
assert.ok(existsSync(join(outDir, 'accepted-generation-index.jsonl')));
const acceptedRows = readFileSync(join(outDir, 'accepted-generation-index.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map(line => JSON.parse(line));
assert.equal(acceptedRows.every(item => item.noveltyAssay.copied === false), true);

const repeatDir = await mkdtemp(join(tmpdir(), 'kaminos-local-shape-repeat-'));
const repeatArgs = args.map((value, index) => args[index - 1] === '--out-dir' ? repeatDir : value);
const repeat = spawnSync('python3', repeatArgs, { encoding: 'utf8' });
assert.equal(repeat.status, 0, repeat.stderr);
const repeatReceipt = JSON.parse(readFileSync(join(repeatDir, 'receipt.json'), 'utf8'));
assert.deepEqual(
  repeatReceipt.generations.map(item => [item.mode, item.parentShapeIds, item.maskHash]),
  receipt.generations.map(item => [item.mode, item.parentShapeIds, item.maskHash]),
  'same corpus, seed, and neighborhood size must reproduce the local shape family',
);
