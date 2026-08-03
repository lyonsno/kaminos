import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { validateSf3dLiveSmokeConfig } from '../sf3d-live-smoke-core.js';

export const EXPECTED_TET_VERTICES = 535_882;
export const EXPECTED_TETS = 2_971_452;
export const EXPECTED_TET_VERTEX_BYTES = 6_430_584;
export const EXPECTED_TET_INDEX_BYTES = 47_543_232;
export const TET_ASSET_PATHS = ['/_grid_vertices.bin', '/indices.bin'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function extractRequestedReportPath(argv, fallback) {
  const index = argv.lastIndexOf('--report');
  const candidate = index >= 0 ? argv[index + 1] : null;
  return candidate && !candidate.startsWith('--') ? candidate : fallback;
}

export function requireArgumentValue(argument, value) {
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`Unknown or incomplete argument: ${argument}`);
  }
  return value;
}

function sourceIdentity(config) {
  return {
    schema: config.schema,
    routeId: config.routeId,
    requestedRevision: config.requestedRevision,
    effectiveRevision: config.effectiveRevision,
    requestedKitVersion: config.requestedKitVersion,
    effectiveKitVersion: config.effectiveKitVersion,
    effectiveKitPackagePath: config.effectiveKitPackagePath,
    clean: config.clean,
    origin: config.origin,
    repo: config.repo,
  };
}

export function validateTetWitnessEvidence({
  configBefore,
  configAfter,
  expectedRevision,
  expectedRepo,
  tetAssets,
  tetResponses,
}) {
  const before = validateSf3dLiveSmokeConfig(configBefore);
  const after = validateSf3dLiveSmokeConfig(configAfter);
  const acceptedRepo = resolve(expectedRepo);

  assert(
    before.requestedRevision === expectedRevision && before.effectiveRevision === expectedRevision,
    `SF3D witness did not exercise accepted revision ${expectedRevision}`,
  );
  assert(before.repo === acceptedRepo, `SF3D witness repo mismatch: ${before.repo || 'missing'} != ${acceptedRepo}`);
  assert(
    JSON.stringify(sourceIdentity(after)) === JSON.stringify(sourceIdentity(before)),
    'SF3D source identity changed during tet probe',
  );
  assert(tetAssets?.sourceOrigin === before.origin, `tet module origin mismatch: ${tetAssets?.sourceOrigin || 'missing'}`);
  assert(new URL(tetAssets.moduleUrl).origin === before.origin, `tet module escaped SF3D origin: ${tetAssets.moduleUrl}`);
  assert(tetAssets.numVertices === EXPECTED_TET_VERTICES, `unexpected tet vertex count: ${tetAssets.numVertices}`);
  assert(tetAssets.numTets === EXPECTED_TETS, `unexpected tetrahedra count: ${tetAssets.numTets}`);
  assert(tetAssets.vertexBytes === EXPECTED_TET_VERTEX_BYTES, `unexpected tet vertex byte length: ${tetAssets.vertexBytes}`);
  assert(tetAssets.indexBytes === EXPECTED_TET_INDEX_BYTES, `unexpected tet index byte length: ${tetAssets.indexBytes}`);
  assert(tetResponses.length === TET_ASSET_PATHS.length, `expected ${TET_ASSET_PATHS.length} tet responses, got ${tetResponses.length}`);

  for (const suffix of TET_ASSET_PATHS) {
    const matches = tetResponses.filter(candidate => new URL(candidate.url).pathname.endsWith(`/tets${suffix}`));
    assert(matches.length === 1, `expected one tet response for ${suffix}, got ${matches.length}`);
    const [response] = matches;
    assert(response.status === 200, `tet response ${response.url} returned HTTP ${response.status}`);
    assert(response.origin === before.origin, `tet response escaped SF3D origin: ${response.url}`);
    assert(response.fromCache === false, `tet response came from browser cache: ${response.url}`);
    assert(response.fromServiceWorker === false, `tet response came from a service worker: ${response.url}`);
  }

  return Object.freeze({
    ...sourceIdentity(before),
    tetAssets: Object.freeze({ ...tetAssets }),
    tetResponses: Object.freeze(tetResponses.map(response => Object.freeze({ ...response }))),
  });
}

export async function finalizeWitnessReport({
  browser,
  report,
  reportPath,
  closeTimeoutMs = 5_000,
  mkdirImpl = mkdir,
  writeFileImpl = writeFile,
}) {
  if (browser) {
    let timer;
    try {
      await Promise.race([
        browser.close(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`browser close timed out after ${closeTimeoutMs}ms`)), closeTimeoutMs);
        }),
      ]);
    } catch (error) {
      report.ok = false;
      report.failurePhase ||= 'browser-cleanup';
      report.cleanupError = error.message || String(error);
      try {
        browser.process?.()?.kill('SIGKILL');
      } catch (releaseError) {
        report.cleanupReleaseError = releaseError.message || String(releaseError);
      }
      try {
        await browser.disconnect?.();
      } catch (releaseError) {
        report.cleanupReleaseError ||= releaseError.message || String(releaseError);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  await mkdirImpl(dirname(reportPath), { recursive: true });
  await writeFileImpl(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}
