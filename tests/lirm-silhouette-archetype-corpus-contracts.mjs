import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const modulePath = new URL('../lirm-silhouette-archetype-corpus-core.js', import.meta.url);
assert.ok(
  existsSync(modulePath),
  'silhouette corpus core must exist before internet-derived morphology can enter the armature route',
);

const silhouetteCore = await import(modulePath);
assert.equal(
  typeof silhouetteCore.writeSilhouetteArchetypeCorpusWitness,
  'function',
  'internet acquisition needs a durable writer that reports partial and early failure',
);

const {
  LIRM_SILHOUETTE_ARCHETYPE_CORPUS_SCHEMA,
  assaySilhouetteNovelty,
  canonicalizeSilhouetteMask,
  createSilhouetteArchetypeCorpus,
  extractBorderConnectedForegroundMask,
  interpolateSilhouetteMasks,
  assaySilhouetteFraming,
  measureSilhouetteTopology,
  toTrainableSilhouetteSample,
  writeSilhouetteArchetypeCorpusWitness,
} = silhouetteCore;

const rgb = new Uint8Array(8 * 8 * 3).fill(255);
function setRgb(x, y, r, g, b) {
  const index = (y * 8 + x) * 3;
  rgb[index] = r;
  rgb[index + 1] = g;
  rgb[index + 2] = b;
}
for (let y = 1; y <= 6; y += 1) {
  for (let x = 2; x <= 5; x += 1) setRgb(x, y, 70, 45, 25);
}
setRgb(0, 3, 248, 248, 248);
setRgb(3, 3, 255, 255, 255);
const borderExtracted = extractBorderConnectedForegroundMask({ width: 8, height: 8, data: rgb }, { colorDistanceThreshold: 24 });
assert.equal(borderExtracted.data[3 * 8], 0, 'near-white pixels connected to the border remain background');
assert.equal(borderExtracted.data[1 * 8 + 2], 1, 'dark object pixels become foreground');
assert.equal(borderExtracted.data[3 * 8 + 3], 1, 'an enclosed white detail remains part of the silhouette');
assert.equal(borderExtracted.extraction.kind, 'border-connected-background-v0');
const cleanFraming = assaySilhouetteFraming(borderExtracted);
assert.equal(cleanFraming.accepted, true);
const panelLike = blank(8, 8);
fillRect(panelLike, 0, 0, 7, 7);
fillRect(panelLike, 1, 1, 6, 6, 0);
const panelFraming = assaySilhouetteFraming(panelLike);
assert.equal(panelFraming.accepted, false, 'panel borders must not masquerade as isolated character silhouettes');
assert.ok(panelFraming.reasons.includes('foreground_touches_border'));

function blank(width, height) {
  return { width, height, data: Array(width * height).fill(0) };
}

const smallRing = ring(12, 10, 3, 2, 8, 7, 1);
const translatedScaledRing = ring(24, 20, 6, 4, 17, 15, 2);

const witnessDir = await mkdtemp(join(tmpdir(), 'kaminos-silhouette-corpus-contract-'));
const witness = await writeSilhouetteArchetypeCorpusWitness({
  outDir: witnessDir,
  targetSize: 32,
  padding: 3,
  manifest: {
    schema: 'kaminos.lirm-silhouette-source-manifest.v0',
    sources: [
      source('hero-a', '', 'Hero A'),
      source('hero-b', '', 'Hero B'),
      source('fetch-failure', '', 'Fetch Failure'),
    ].map(item => ({ ...item, contentHash: undefined })),
  },
  fetchSource: async sourceRecord => {
    if (sourceRecord.sourceId === 'fetch-failure') throw new Error('fixture network failure');
    return {
      bytes: Buffer.from(`fixture:${sourceRecord.sourceId}`),
      contentType: 'image/png',
      effectiveUrl: sourceRecord.sourceUrl,
      cacheStatus: 'network',
    };
  },
  decodeMask: async (_download, sourceRecord) => sourceRecord.sourceId === 'hero-a' ? smallRing : translatedScaledRing,
});

assert.equal(witness.status, 'partial');
assert.equal(witness.requestedSourceCount, 3);
assert.equal(witness.acceptedSourceCount, 2);
assert.equal(witness.failures[0].sourceId, 'fetch-failure');
assert.equal(witness.failures[0].phase, 'fetch_source');
assert.equal(witness.routeIdentity.requestedRoute, 'kaminos/lirm-speciation-armature/silhouette-archetype-corpus-v0');
assert.equal(witness.routeIdentity.effectiveRoute, 'kaminos/lirm-speciation-armature/silhouette-archetype-corpus-v0');
assert.equal(witness.routeIdentity.extractionRoute, 'injected-contract-decoder');
assert.ok(existsSync(join(witnessDir, 'receipt.json')), 'partial acquisition must still emit a receipt');
assert.ok(existsSync(join(witnessDir, 'training-index.jsonl')), 'accepted samples need a trainable index');
assert.ok(existsSync(join(witnessDir, 'contact-sheet.svg')), 'accepted silhouettes need a visual witness');
assert.ok(existsSync(join(witnessDir, 'masks', 'hero-a.pgm')), 'canonical masks need a compact durable raster');
assert.ok(existsSync(join(witnessDir, 'distance-fields', 'hero-a.f32')), 'signed-distance fields need a model-ready binary artifact');
const writtenMask = readFileSync(join(witnessDir, 'masks', 'hero-a.pgm'));
const pgmHeaderEnd = writtenMask.indexOf(Buffer.from('\n255\n')) + Buffer.from('\n255\n').length;
const pgmPixels = writtenMask.subarray(pgmHeaderEnd);
assert.equal(Math.max(...pgmPixels), 255, 'model-facing PGM must encode foreground as 255, not a nearly black value');
assert.equal(Math.min(...pgmPixels), 0, 'model-facing PGM must retain background pixels');

const writtenReceipt = JSON.parse(readFileSync(join(witnessDir, 'receipt.json'), 'utf8'));
assert.equal(writtenReceipt.status, 'partial');
assert.equal(writtenReceipt.failures[0].lastTrustworthyEvidence, 'manifest_source_validated');
assert.equal(writtenReceipt.falseClosureGuards.blankOrOpaqueRectangle, 'rejected');
assert.equal(writtenReceipt.falseClosureGuards.sourceBytesCommitted, 'false');
assert.equal(writtenReceipt.outputInventory.sourceBytes, null);

const earlyFailureDir = await mkdtemp(join(tmpdir(), 'kaminos-silhouette-corpus-early-failure-'));
await assert.rejects(
  writeSilhouetteArchetypeCorpusWitness({ outDir: earlyFailureDir, manifest: { schema: 'wrong', sources: [] } }),
  /manifest schema/,
);
const earlyReceipt = JSON.parse(readFileSync(join(earlyFailureDir, 'receipt.json'), 'utf8'));
assert.equal(earlyReceipt.status, 'failed');
assert.equal(earlyReceipt.failurePhase, 'validate_manifest');
assert.equal(earlyReceipt.lastTrustworthyEvidence, 'writer_initialized');
function fillRect(mask, x0, y0, x1, y1, value = 1) {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      mask.data[y * mask.width + x] = value;
    }
  }
  return mask;
}

function ring(width, height, x0, y0, x1, y1, thickness = 1) {
  const mask = blank(width, height);
  fillRect(mask, x0, y0, x1, y1);
  fillRect(mask, x0 + thickness, y0 + thickness, x1 - thickness, y1 - thickness, 0);
  return mask;
}

function source(sourceId, contentHash, characterName) {
  return {
    sourceId,
    provider: 'contract-fixture',
    sourceUrl: `https://example.invalid/assets/${sourceId}.png`,
    sourcePageUrl: `https://example.invalid/characters/${sourceId}`,
    characterName,
    retrievedAt: '2026-07-13T00:00:00.000Z',
    contentHash,
  };
}

const canonicalSmall = canonicalizeSilhouetteMask(smallRing, { targetSize: 32, padding: 3 });
const canonicalScaled = canonicalizeSilhouetteMask(translatedScaledRing, { targetSize: 32, padding: 3 });

assert.equal(canonicalSmall.width, 32);
assert.equal(canonicalSmall.height, 32);
assert.deepEqual(
  measureSilhouetteTopology(canonicalSmall),
  { foregroundComponents: 1, holes: 1 },
  'canonicalization must preserve the ring topology',
);
assert.deepEqual(
  measureSilhouetteTopology(canonicalScaled),
  { foregroundComponents: 1, holes: 1 },
  'scale and translation normalization must preserve topology',
);

const corpus = createSilhouetteArchetypeCorpus([
  { source: source('hero-a', 'sha256:source-a', 'Hero A'), mask: smallRing },
  { source: source('hero-b', 'sha256:source-b', 'Hero B'), mask: translatedScaledRing },
  { source: source('hero-a-copy', 'sha256:source-a', 'Hero A duplicate'), mask: smallRing },
  { source: source('broken', 'sha256:source-broken', 'Broken Hero'), mask: { width: 0, height: 0, data: [] } },
], { targetSize: 32, padding: 3 });

assert.equal(corpus.schema, LIRM_SILHOUETTE_ARCHETYPE_CORPUS_SCHEMA);
assert.equal(corpus.status, 'partial');
assert.equal(corpus.requestedSourceCount, 4);
assert.equal(corpus.acceptedSourceCount, 3);
assert.equal(corpus.uniqueSourceContentCount, 2);
assert.equal(corpus.uniqueDerivedShapeCount, 1);
assert.equal(corpus.shapeGroups[0].sourceIds.length, 3, 'dedup must retain all source lineage');
assert.equal(corpus.failures[0].sourceId, 'broken');
assert.equal(corpus.failures[0].phase, 'canonicalize_mask');
assert.equal(corpus.failures[0].lastTrustworthyEvidence, 'source_validated');

const trainable = toTrainableSilhouetteSample(corpus.accepted[0]);
const serializedTrainable = JSON.stringify(trainable);
assert.equal(trainable.schema, 'kaminos.lirm-silhouette-trainable-sample.v0');
assert.ok(Array.isArray(trainable.mask.data));
assert.ok(Array.isArray(trainable.signedDistance.data));
for (const forbidden of ['Hero A', 'characterName', 'sourceUrl', 'sourcePageUrl', 'provider']) {
  assert.equal(serializedTrainable.includes(forbidden), false, `trainable packet must exclude ${forbidden}`);
}

const directReplay = assaySilhouetteNovelty(canonicalSmall, [canonicalScaled], { copyThreshold: 0.98 });
assert.equal(directReplay.copied, true);
assert.equal(directReplay.nearest.transform, 'direct');
assert.equal(directReplay.nearest.similarity, 1);

const asymmetric = blank(16, 16);
fillRect(asymmetric, 2, 3, 7, 12);
fillRect(asymmetric, 7, 9, 12, 12);
const mirrored = blank(16, 16);
for (let y = 0; y < 16; y += 1) {
  for (let x = 0; x < 16; x += 1) {
    mirrored.data[y * 16 + (15 - x)] = asymmetric.data[y * 16 + x];
  }
}
const mirrorReplay = assaySilhouetteNovelty(mirrored, [asymmetric], { copyThreshold: 0.98, includeMirror: true });
assert.equal(mirrorReplay.copied, true);
assert.equal(mirrorReplay.nearest.transform, 'mirror_x');

const bar = fillRect(blank(12, 10), 2, 4, 9, 6);
const interpolated = interpolateSilhouetteMasks(smallRing, bar, 0.5, { targetSize: 32, padding: 3 });
const midpointAssay = assaySilhouetteNovelty(interpolated, [canonicalSmall, canonicalizeSilhouetteMask(bar, { targetSize: 32, padding: 3 })]);
assert.equal(interpolated.width, 32);
assert.equal(interpolated.height, 32);
assert.equal(midpointAssay.copied, false, 'SDF interpolation must not silently return either endpoint');
