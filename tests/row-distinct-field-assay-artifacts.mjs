import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  ROW_DISTINCT_ARTIFACT_ROUTE,
  renderRowDistinctAssaySvg,
  writeRowDistinctAssayArtifacts,
} from '../row-distinct-field-assay-artifacts.mjs';

const assayCard = JSON.parse(await readFile(
  new URL('../fixtures/analytical-tissue/row-distinct-scalar-anisotropic-assay.v0.json', import.meta.url),
  'utf8',
));
const target = JSON.parse(await readFile(
  new URL('../fixtures/analytical-tissue/row-distinct-hindquarter-target.v0.json', import.meta.url),
  'utf8',
));

async function withTemporaryDirectory(run) {
  const path = await mkdtemp(join(tmpdir(), 'row-distinct-assay-'));
  try {
    return await run(path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}

test('artifact writer emits hashed result, fixed-camera contact sheet, and four meshes', async () => {
  await withTemporaryDirectory(async (outDir) => {
    const result = await writeRowDistinctAssayArtifacts({ outDir, assayCard, target });
    assert.equal(result.report.status, 'completed');
    assert.equal(result.report.requestedRouteId, ROW_DISTINCT_ARTIFACT_ROUTE);
    assert.equal(result.report.effectiveRouteId, ROW_DISTINCT_ARTIFACT_ROUTE);
    assert.equal(result.report.cameraId, assayCard.camera.id);
    assert.equal(result.report.outputs.length, 6);
    assert.ok(result.report.outputs.every((output) => /^[0-9a-f]{64}$/.test(output.sha256)));
    assert.ok(result.report.outputs.every((output) => output.byteLength > 100));
    const svg = await readFile(join(outDir, 'contact-sheet.svg'), 'utf8');
    assert.match(svg, /scalar-metaball-control/);
    assert.match(svg, /anisotropic-identity-challenger/);
    assert.match(svg, new RegExp(assayCard.camera.id));
    assert.match(svg, new RegExp(result.assay.assayHash));
  });
});

test('artifact renderer rejects partial or stale-looking assay products', () => {
  assert.throws(
    () => renderRowDistinctAssaySvg({ status: 'partial', rows: [] }),
    /completed row-distinct assay is required/,
  );
});

test('route substitution fails loud and still leaves a phase-named report', async () => {
  await withTemporaryDirectory(async (outDir) => {
    await assert.rejects(
      writeRowDistinctAssayArtifacts({
        outDir,
        assayCard,
        target,
        requestedRouteId: 'fallback-metaball-route',
      }),
      /requested route fallback-metaball-route is unavailable/,
    );
    const report = JSON.parse(await readFile(join(outDir, 'report.json'), 'utf8'));
    assert.equal(report.status, 'failed');
    assert.equal(report.failurePhase, 'input-validation');
    assert.equal(report.requestedRouteId, 'fallback-metaball-route');
    assert.equal(report.effectiveRouteId, null);
    assert.deepEqual(report.outputs, []);
  });
});
