import { isAbsolute, relative, resolve } from 'node:path';

const ROUTE = 'spatial-strata-hybrid-smoke-v0';
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
  const manifestUrl = String(params.get('volume_hybrid_smoke_manifest') || '').trim();
  if (!manifestUrl) throw new Error('hybrid smoke manifest must be present');
  return {
    manifestUrl,
    fineLodFraction: strictNumber(params, 'volume_hybrid_smoke_fine_lod', 'fine LOD'),
    coarseCoverageScale: strictNumber(params, 'volume_hybrid_smoke_coarse_coverage', 'coarse coverage'),
    motionRate: strictNumber(params, 'volume_hybrid_smoke_motion_rate', 'motion rate'),
  };
}

function parseConfigIdentity(value, label) {
  try {
    const parsed = JSON.parse(String(value || ''));
    return {
      manifestUrl: String(parsed.manifestUrl || ''),
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
    manifestUrl: String(requested?.manifestUrl || ''),
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
  for (const capture of captures) {
    const debug = capture?.spatialStrataHybridSmokeDebug;
    if (
      debug?.identity !== RENDERER
      || debug?.requestedRoute !== ROUTE
      || debug?.effectiveRoute !== ROUTE
    ) {
      throw new Error(`nested smoke route mismatch: ${JSON.stringify(debug)}`);
    }
  }
  return ROUTE;
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
