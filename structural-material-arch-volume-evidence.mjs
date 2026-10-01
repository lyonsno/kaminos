export function findArchVolumeEvidenceContradictions({
  expectedSources,
  servedSources,
  expectedProfileSourceHashes,
  cases,
}) {
  const issues = [];
  for (const [path, expectedHash] of Object.entries(expectedSources)) {
    const served = servedSources?.[path];
    if (served?.status !== 200 || served.sha256 !== expectedHash) issues.push(`served source mismatch: ${path}`);
  }
  for (const [name, expectedHash] of Object.entries(expectedProfileSourceHashes)) {
    const item = cases?.[name];
    if (!item) {
      issues.push(`missing profile case: ${name}`);
      continue;
    }
    if (item.sourceSha256 !== expectedHash) issues.push(`profile source mismatch: ${name}`);
    if (!Number.isInteger(item.nodes) || item.nodes <= 0 || item.renderedInstances !== item.nodes) {
      issues.push(`rendered population mismatch: ${name}`);
    }
  }
  return issues;
}

export function findArchVolumeContinuationContradictions(priorCases, nextCases, { requireNewFracture = true } = {}) {
  const issues = [];
  for (const [name, prior] of Object.entries(priorCases)) {
    const next = nextCases?.[name];
    if (!next) { issues.push(`missing continued profile: ${name}`); continue; }
    if (!Array.isArray(next.brokenBondIds) || next.brokenBondIds.length !== next.broken ||
        prior.brokenBondIds.some(id => !next.brokenBondIds.includes(id))) {
      issues.push(`damage was reset or incompletely observed: ${name}`);
    }
    if (!(next.eventCount >= prior.eventCount) || !(next.crackEventCount >= prior.crackEventCount) ||
        !(next.broken >= prior.broken) || !(next.connectivityEpoch >= prior.connectivityEpoch)) {
      issues.push(`fracture history regressed: ${name}`);
    }
    if (requireNewFracture && (!(next.crackEventCount > prior.crackEventCount) ||
        !(next.broken > prior.broken) || !(next.connectivityEpoch > prior.connectivityEpoch))) {
      issues.push(`no new persistent fracture event: ${name}`);
    }
    if (next.loadApplication?.round !== prior.loadApplication?.round + 1 ||
        !(next.loadApplication?.elapsed > prior.loadApplication?.elapsed)) {
      issues.push(`stale or reset force interval: ${name}`);
    }
  }
  return issues;
}

export function findArchVolumeConstructionContradictions(requested, cases) {
  const issues = [];
  if (!cases || Object.keys(cases).length === 0) return ['missing construction observations'];
  for (const [name, item] of Object.entries(cases)) {
    if (item.construction?.kind !== requested) issues.push(`construction mismatch: ${name}`);
    if (!Number.isInteger(item.layers) || item.layers < 2 || item.loadedNodeLayers?.length !== 1 ||
        item.loadedNodeLayers[0] !== item.layers - 1) issues.push(`not front-only force: ${name}`);
    if (requested === 'cell-volume-braced' &&
        (!(item.depthDiagonalBonds > 0) || !(item.totalMaterialVolume > 0))) issues.push(`missing volume construction: ${name}`);
    if (item.broken > 0 && (!(item.renderedHistoryMarks > 0) || !Number.isFinite(item.maxHistoryMarkLength) ||
        !(item.historyMarkBound > 0) || item.maxHistoryMarkLength > item.historyMarkBound + 1e-7)) {
      issues.push(`missing or tethering damage display: ${name}`);
    }
  }
  return issues;
}
