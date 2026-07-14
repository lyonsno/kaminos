export const LIRM_SILHOUETTE_SOURCE_MANIFEST_SCHEMA = 'kaminos.lirm-silhouette-source-manifest.v0';
export const POKEAPI_OFFICIAL_ARTWORK_ROUTE = 'pokeapi-sprites-github-official-artwork-v0';
export const DIGI_API_ARTWORK_ROUTE = 'digi-api-v1-artwork-v0';

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export async function fetchDigiApiArtworkManifest(options = {}) {
  const endpoint = String(options.endpoint || 'https://digi-api.com/api/v1/digimon');
  const pageSize = positiveInteger(options.pageSize ?? 250, 'pageSize');
  const fetchImpl = options.fetchImpl || fetch;
  const records = [];
  let page = 0;
  let declaredTotalElements = null;
  let declaredTotalPages = null;
  while (declaredTotalElements === null || records.length < declaredTotalElements) {
    const url = new URL(endpoint);
    url.searchParams.set('page', String(page));
    url.searchParams.set('pageSize', String(pageSize));
    const response = await fetchImpl(url.toString(), {
      headers: { 'user-agent': 'Kaminos silhouette source manifest/0' },
    });
    if (!response?.ok) throw new Error(`Digi-API page ${page} returned HTTP ${response?.status ?? 'unknown'}`);
    const payload = await response.json();
    if (!Array.isArray(payload?.content)) throw new Error(`Digi-API page ${page} omitted content`);
    const totalElements = positiveInteger(payload?.pageable?.totalElements, 'Digi-API totalElements');
    const totalPages = positiveInteger(payload?.pageable?.totalPages, 'Digi-API totalPages');
    if (declaredTotalElements !== null && totalElements !== declaredTotalElements) throw new Error('Digi-API totalElements changed during pagination');
    if (declaredTotalPages !== null && totalPages !== declaredTotalPages) throw new Error('Digi-API totalPages changed during pagination');
    declaredTotalElements = totalElements;
    declaredTotalPages = totalPages;
    if (payload.content.length === 0 && records.length < totalElements) {
      throw new Error(`Digi-API page ${page} was empty before ${totalElements} declared records were received`);
    }
    records.push(...payload.content);
    page += 1;
  }
  if (records.length !== declaredTotalElements) {
    throw new Error(`Digi-API declared ${declaredTotalElements} records but pagination returned ${records.length}`);
  }
  const uniqueIds = new Set(records.map(record => String(record?.id)));
  if (uniqueIds.size !== records.length) throw new Error('Digi-API pagination returned duplicate record ids');
  const manifest = createDigiApiArtworkManifest(records, options);
  manifest.providerEvidence = {
    endpoint,
    requestedPageSize: pageSize,
    declaredTotalElements,
    declaredTotalPages,
    fetchedPageCount: page,
    serverTotalPagesAccurate: page === declaredTotalPages,
  };
  manifest.falseClosureGuards.hiddenSourceCap = 'server_total_verified';
  return manifest;
}

export function createDigiApiArtworkManifest(records, options = {}) {
  if (!Array.isArray(records) || records.length === 0) throw new Error('records must be a non-empty array');
  const retrievedAt = String(options.retrievedAt || new Date().toISOString());
  const sources = records.map(record => {
    const id = positiveInteger(record?.id, 'record id');
    if (!record?.image || !record?.href) throw new Error(`record image and href are required for Digi-API id ${id}`);
    return {
      sourceId: `digi-api-artwork-${String(id).padStart(4, '0')}`,
      provider: 'digi-api-artwork',
      sourceUrl: String(record.image),
      sourcePageUrl: String(record.href),
      retrievedAt,
      providerRecordId: String(id),
      characterName: String(record.name || `Digi-API ${id}`),
      maskExtraction: {
        kind: 'border-connected-background-v0',
        colorDistanceThreshold: Number(options.colorDistanceThreshold ?? 24),
      },
    };
  });
  return {
    schema: LIRM_SILHOUETTE_SOURCE_MANIFEST_SCHEMA,
    providerRoute: {
      requestedRoute: 'digi-api-artwork',
      effectiveRoute: DIGI_API_ARTWORK_ROUTE,
    },
    sourceCount: sources.length,
    sources,
    falseClosureGuards: {
      hiddenSourceCap: 'none',
      sourceBytesEmbedded: 'false',
      sourceIdentityTrainable: 'false',
      opaqueBackgroundExtraction: 'border_connected_only',
    },
  };
}
export function createPokeApiOfficialArtworkManifest(options = {}) {
  const startId = positiveInteger(options.startId ?? 1, 'startId');
  const endId = positiveInteger(options.endId ?? 1025, 'endId');
  if (endId < startId) throw new Error('endId must be greater than or equal to startId');
  const retrievedAt = String(options.retrievedAt || new Date().toISOString());
  const sources = [];
  for (let pokemonId = startId; pokemonId <= endId; pokemonId += 1) {
    sources.push({
      sourceId: `pokeapi-official-artwork-${String(pokemonId).padStart(4, '0')}`,
      provider: 'pokeapi-sprites-official-artwork',
      sourceUrl: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokemonId}.png`,
      sourcePageUrl: `https://pokeapi.co/api/v2/pokemon/${pokemonId}`,
      retrievedAt,
      providerRecordId: String(pokemonId),
    });
  }
  return {
    schema: LIRM_SILHOUETTE_SOURCE_MANIFEST_SCHEMA,
    providerRoute: {
      requestedRoute: 'pokeapi-official-artwork',
      effectiveRoute: POKEAPI_OFFICIAL_ARTWORK_ROUTE,
    },
    requestedRange: { startId, endId },
    sourceCount: sources.length,
    sources,
    falseClosureGuards: {
      hiddenSourceCap: 'none',
      sourceBytesEmbedded: 'false',
      sourceIdentityTrainable: 'false',
    },
  };
}
