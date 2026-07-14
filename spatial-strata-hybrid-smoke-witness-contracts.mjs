import { isAbsolute, relative, resolve } from 'node:path';

const OFFLINE_ROUTE = 'spatial-strata-hybrid-smoke-v0';
const LIVE_ROUTE = 'spatial-strata-hybrid-smoke-live-coupled-v0';
const RENDERER = 'phase-matched-spatial-strata-front-back-raster-v0';

function strictNumber(params, name, label) {
  const raw = params.get(name);
  if (raw === null || raw.trim() === '') throw new Error(`${label} must be present and finite`);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite, got ${raw}`);
  return value;
}

export function parseSpatialStrataHybridSmokeWitnessRequest(url) {
  const parsed = new URL(String(url));
  const params = parsed.searchParams;
  if (params.get('volume_hybrid_smoke_representation') !== 'spatial-strata') {
    throw new Error('hybrid smoke representation must be spatial-strata');
  }
  const sourceMode = params.get('volume_hybrid_smoke_source') === 'live-coupled'
    ? 'live-coupled'
    : 'offline-manifest';
  const manifestUrl = String(params.get('volume_hybrid_smoke_manifest') || '').trim();
  if (sourceMode === 'offline-manifest' && !manifestUrl) throw new Error('hybrid smoke manifest must be present');
  return {
    sourceMode,
    manifestUrl: manifestUrl || null,
    fineLodFraction: strictNumber(params, 'volume_hybrid_smoke_fine_lod', 'fine LOD'),
    coarseCoverageScale: strictNumber(params, 'volume_hybrid_smoke_coarse_coverage', 'coarse coverage'),
    motionRate: strictNumber(params, 'volume_hybrid_smoke_motion_rate', 'motion rate'),
  };
}

function parseConfigIdentity(value, label) {
  try {
    const parsed = JSON.parse(String(value || ''));
    const sourceMode = parsed.sourceMode === 'live-coupled' ? 'live-coupled' : 'offline-manifest';
    return {
      sourceMode,
      manifestUrl: sourceMode === 'live-coupled' ? null : String(parsed.manifestUrl || ''),
      fineLodFraction: Number(parsed.fineLodFraction),
      coarseCoverageScale: Number(parsed.coarseCoverageScale),
      motionRate: Number(parsed.motionRate),
    };
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error?.message || String(error)}`);
  }
}

export function validateSpatialStrataHybridSmokeWitnessConfig({ requested, lifecycle } = {}) {
  if (lifecycle?.status !== 'loaded' || lifecycle?.hasRenderer !== true) {
    throw new Error(`spatial-strata source lifecycle is not loaded: ${lifecycle?.status ?? null}`);
  }
  const lifecycleRequested = parseConfigIdentity(lifecycle.requestedConfigIdentity, 'requested config identity');
  const lifecycleEffective = parseConfigIdentity(lifecycle.effectiveConfigIdentity, 'effective config identity');
  const canonicalRequested = {
    sourceMode: requested?.sourceMode === 'live-coupled' ? 'live-coupled' : 'offline-manifest',
    manifestUrl: requested?.sourceMode === 'live-coupled' ? null : String(requested?.manifestUrl || ''),
    fineLodFraction: Number(requested?.fineLodFraction),
    coarseCoverageScale: Number(requested?.coarseCoverageScale),
    motionRate: Number(requested?.motionRate),
  };
  if (
    JSON.stringify(canonicalRequested) !== JSON.stringify(lifecycleRequested)
    || JSON.stringify(lifecycleRequested) !== JSON.stringify(lifecycleEffective)
  ) {
    throw new Error(`requested and effective smoke config mismatch: ${JSON.stringify({ canonicalRequested, lifecycleRequested, lifecycleEffective })}`);
  }
  return lifecycleEffective;
}

export function requirePositiveHybridWitnessWallDelay(value) {
  const delay = Number(value);
  if (!(delay > 0) || !Number.isFinite(delay)) throw new Error('hybrid determinism witness requires a positive wall delay');
  return delay;
}

export function deriveSpatialStrataHybridSmokeEffectiveRoute(captures) {
  if (!Array.isArray(captures) || captures.length === 0) throw new Error('hybrid captures must be non-empty');
  const firstDebug = captures[0]?.spatialStrataHybridSmokeDebug;
  const route = firstDebug?.productSourceMode === 'live-owned-product-source' ? LIVE_ROUTE : OFFLINE_ROUTE;
  for (const capture of captures) {
    const debug = capture?.spatialStrataHybridSmokeDebug;
    if (
      debug?.identity !== RENDERER
      || debug?.requestedRoute !== route
      || debug?.effectiveRoute !== route
    ) {
      throw new Error(`nested smoke route mismatch: ${JSON.stringify(debug)}`);
    }
  }
  return route;
}

function requireWithin(root, target, label) {
  const edge = relative(resolve(root), resolve(target));
  if (edge === '..' || edge.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(edge)) {
    throw new Error(`${label} is outside ${root}`);
  }
}

export function requireHybridWitnessArtifactPath({ evidenceRoot, bundleRoot, artifact } = {}) {
  requireWithin(evidenceRoot, bundleRoot, 'witness bundle outside evidence root');
  requireWithin(bundleRoot, artifact, 'artifact outside witness bundle');
  return resolve(artifact);
}
