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
