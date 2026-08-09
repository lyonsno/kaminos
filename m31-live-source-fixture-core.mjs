import { createHash } from 'node:crypto';

import { canonicalProxyRigJson } from './proxy-rig-runtime.mjs';

export const M31_HISTORICAL_SOURCE_REF = '9d3802d5:artifacts/m31-generated-relation-positive-volume-transfer-v0/source-fixture.json';

export function compactM31HistoricalSource(sourceBytes, {
  historicalRef = M31_HISTORICAL_SOURCE_REF,
} = {}) {
  const bytes = Buffer.isBuffer(sourceBytes) ? sourceBytes : Buffer.from(sourceBytes);
  const source = JSON.parse(bytes.toString('utf8'));
  if (source.schema !== 'kaminos.m31-generated-relation-source-fixture.v0'
      || source.selection?.constructionId !== 'muscle-31'
      || canonicalProxyRigJson(source.selection?.supportFamily)
        !== canonicalProxyRigJson(['Cube.002', 'Cube.003'])
      || source.identities?.fixedSupport !== 'Cube.002'
      || source.identities?.movingSupport !== 'Cube.003') {
    throw new Error('Historical M31 source identity or support family mismatched');
  }
  if (source.vertices?.length !== 300 || source.triangles?.length !== 596
      || source.sections?.length !== 25 || source.profileSideCount !== 12) {
    throw new Error('Historical M31 surface topology mismatched');
  }

  const content = {
    schema: 'kaminos.proxy-rig-muscle-source.v0',
    relationId: 'muscle-31',
    historicalRef,
    sourceArtifactSha256: createHash('sha256').update(bytes).digest('hex'),
    source: {
      assetSha256: source.source.assetSha256,
      routingFixtureSha256: source.source.routingFixtureSha256,
      surfaceGeometrySha256: source.source.surfaceGeometrySha256,
      graphIdentity: source.source.graphIdentity,
      blenderVersion: source.source.blenderVersion,
    },
    selection: {
      constructionId: source.selection.constructionId,
      supportFamily: source.selection.supportFamily,
      authority: source.selection.authority,
      frozenBeforeOutput: source.selection.frozenBeforeOutput,
    },
    identities: source.identities,
    hinge: source.hinge,
    positions: source.vertices.flatMap(vertex => vertex.rest),
    triangles: source.triangles.flatMap(triangle => triangle.vertexIndices),
    sectionIndices: source.vertices.map(vertex => vertex.sectionIndex),
    sectionCount: source.sections.length,
    profileSideCount: source.profileSideCount,
  };
  const digest = createHash('sha256').update(canonicalProxyRigJson(content)).digest('hex');
  return { ...content, fixtureId: `sha256:${digest}` };
}

export function assertM31CompactFixtureMatchesHistorical(compactFixture, sourceBytes) {
  const expected = compactM31HistoricalSource(sourceBytes);
  if (canonicalProxyRigJson(compactFixture) !== canonicalProxyRigJson(expected)) {
    throw new Error('Historical M31 compact fixture mismatch: checked-in compact bytes diverge from exact historical source');
  }
  return expected;
}
