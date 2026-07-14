import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const modulePath = new URL('../lirm-silhouette-source-manifest-core.js', import.meta.url);
assert.ok(existsSync(modulePath), 'silhouette source providers need a reusable manifest expansion core');

const {
  LIRM_SILHOUETTE_SOURCE_MANIFEST_SCHEMA,
  createDigiApiArtworkManifest,
  createPokeApiOfficialArtworkManifest,
  fetchDigiApiArtworkManifest,
} = await import(modulePath);

const digiManifest = createDigiApiArtworkManifest([
  {
    id: 1,
    name: 'Agumon',
    href: 'https://digi-api.com/api/v1/digimon/1',
    image: 'https://digi-api.com/images/digimon/w/Agumon.png',
  },
  {
    id: 2,
    name: 'Airdramon',
    href: 'https://digi-api.com/api/v1/digimon/2',
    image: 'https://digi-api.com/images/digimon/w/Airdramon.png',
  },
], { retrievedAt: '2026-07-13T01:00:00.000Z' });

assert.equal(digiManifest.schema, LIRM_SILHOUETTE_SOURCE_MANIFEST_SCHEMA);
assert.equal(digiManifest.providerRoute.requestedRoute, 'digi-api-artwork');
assert.equal(digiManifest.providerRoute.effectiveRoute, 'digi-api-v1-artwork-v0');
assert.equal(digiManifest.sourceCount, 2);
assert.equal(digiManifest.sources[0].sourceId, 'digi-api-artwork-0001');
assert.equal(digiManifest.sources[0].sourceUrl, 'https://digi-api.com/images/digimon/w/Agumon.png');
assert.equal(digiManifest.sources[0].sourcePageUrl, 'https://digi-api.com/api/v1/digimon/1');
assert.deepEqual(digiManifest.sources[0].maskExtraction, {
  kind: 'border-connected-background-v0',
  colorDistanceThreshold: 24,
});
assert.equal(digiManifest.sources.every(source => source.retrievedAt === '2026-07-13T01:00:00.000Z'), true);
assert.throws(
  () => createDigiApiArtworkManifest([{ id: 1, name: 'Broken', href: '', image: '' }]),
  /record image and href are required/,
);

const requestedPages = [];
const pagedManifest = await fetchDigiApiArtworkManifest({
  endpoint: 'https://digi-api.example/api/v1/digimon',
  pageSize: 2,
  retrievedAt: '2026-07-13T02:00:00.000Z',
  fetchImpl: async url => {
    requestedPages.push(url);
    const page = Number(new URL(url).searchParams.get('page'));
    const records = page === 0 ? [
      { id: 1, name: 'A', href: 'https://example/1', image: 'https://example/1.png' },
      { id: 2, name: 'B', href: 'https://example/2', image: 'https://example/2.png' },
    ] : [{ id: 3, name: 'C', href: 'https://example/3', image: 'https://example/3.png' }];
    return {
      ok: true,
      json: async () => ({
        content: records,
        pageable: {
          currentPage: page,
          totalElements: 3,
          totalPages: 1,
          nextPage: page === 0 ? 'present' : '',
        },
      }),
    };
  },
});
assert.equal(pagedManifest.sourceCount, 3, 'pagination must consume every server-declared record');
assert.equal(requestedPages.length, 2);
assert.equal(pagedManifest.providerEvidence.declaredTotalElements, 3);
assert.equal(pagedManifest.providerEvidence.fetchedPageCount, 2);
assert.equal(pagedManifest.providerEvidence.serverTotalPagesAccurate, false);
assert.equal(pagedManifest.falseClosureGuards.hiddenSourceCap, 'server_total_verified');
const manifest = createPokeApiOfficialArtworkManifest({
  startId: 1,
  endId: 1025,
  retrievedAt: '2026-07-13T00:00:00.000Z',
});

assert.equal(manifest.schema, LIRM_SILHOUETTE_SOURCE_MANIFEST_SCHEMA);
assert.equal(manifest.providerRoute.requestedRoute, 'pokeapi-official-artwork');
assert.equal(manifest.providerRoute.effectiveRoute, 'pokeapi-sprites-github-official-artwork-v0');
assert.equal(manifest.sources.length, 1025, 'provider expansion must not hide an arbitrary source cap');
assert.equal(manifest.sources[0].sourceId, 'pokeapi-official-artwork-0001');
assert.equal(manifest.sources.at(-1).sourceId, 'pokeapi-official-artwork-1025');
assert.match(manifest.sources[0].sourceUrl, /official-artwork\/1\.png$/);
assert.match(manifest.sources.at(-1).sourceUrl, /official-artwork\/1025\.png$/);
assert.equal(manifest.sources.every(source => source.retrievedAt === '2026-07-13T00:00:00.000Z'), true);
assert.equal(new Set(manifest.sources.map(source => source.sourceId)).size, 1025);
assert.equal(manifest.falseClosureGuards.hiddenSourceCap, 'none');
assert.equal(manifest.falseClosureGuards.sourceBytesEmbedded, 'false');

assert.throws(
  () => createPokeApiOfficialArtworkManifest({ startId: 10, endId: 9 }),
  /endId must be greater than or equal to startId/,
);
