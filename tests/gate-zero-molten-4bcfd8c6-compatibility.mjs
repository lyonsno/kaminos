import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildStructuralSourceGenerationManifest,
  validateStructuralProjectionOutcome,
} from '../structural-source-assay-core.mjs';
import { createPng } from './png-fixture.mjs';

const MOLTEN_COMPILER_COMMIT = '4bcfd8c6';
const MOLTEN_COMPILER_PATH = 'asset-arrival-projection-compiler-core.mjs';

function importExactMoltenCompiler() {
  const source = execFileSync(
    'git',
    ['show', `${MOLTEN_COMPILER_COMMIT}:${MOLTEN_COMPILER_PATH}`],
    { encoding: 'utf8' },
  );
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(moduleUrl);
}

const assay = JSON.parse(await readFile(
  new URL('../fixtures/phase-three-hip-cup-source-assay.v0.json', import.meta.url),
  'utf8',
));
const manifest = buildStructuralSourceGenerationManifest(assay);
const exactMolten = await importExactMoltenCompiler();

const exactMoltenPlan = exactMolten.buildAssetArrivalProjectionPlan(manifest.compilerInput);
assert.deepEqual(
  manifest.projectionPlan,
  exactMoltenPlan,
  'the current producer and exact published Molten 4bcfd8c6 consumer must construct the same plan',
);

assert.equal(
  manifest.compilerInput.relation.delta,
  Math.min(
    manifest.compilerInput.relation.maxDelta,
    0.5 * Math.min(
      manifest.compilerInput.relation.upperBound - manifest.compilerInput.relation.parentValue,
      manifest.compilerInput.relation.parentValue - manifest.compilerInput.relation.lowerBound,
    ),
  ),
  'asset-arrival-source.v0 must encode the exact bounded delta expected by its published consumer',
);
assert.equal(
  manifest.compilerInput.variants.positive.relationValue,
  manifest.compilerInput.relation.parentValue + manifest.compilerInput.relation.delta,
);
assert.equal(
  manifest.compilerInput.variants.negative.relationValue,
  manifest.compilerInput.relation.parentValue - manifest.compilerInput.relation.delta,
);

const root = await mkdtemp(join(tmpdir(), 'gate-zero-molten-4bcfd8c6-'));
const outDir = join(root, 'compiled');
await exactMolten.compileAssetArrivalProjections({
  source: manifest.compilerInput,
  outDir,
  renderVariant: async request => ({
    effectiveRouteId: request.requestedRouteId,
    sourceInputHash: request.sourceInputHash,
    cameraHash: request.camera.cameraSha256,
    productConfigHash: request.productConfigHash,
    products: request.productKinds.map((kind, index) => ({
      kind,
      mimeType: 'image/png',
      width: request.camera.width,
      height: request.camera.height,
      bytes: createPng(request.camera.width, request.camera.height, 43 + index),
    })),
  }),
});
const publicationPointerPath = join(outDir, 'current.json');
const pointer = JSON.parse(await readFile(publicationPointerPath, 'utf8'));
const outcome = await validateStructuralProjectionOutcome({
  manifest,
  reportPath: join(outDir, pointer.reportPath),
  publicationPointerPath,
});
assert.equal(
  outcome.ok,
  true,
  `the exact historical consumer publication must pass outcome admission: ${JSON.stringify(outcome.failures)}`,
);
assert.equal(outcome.status, 'published-outcome-validated');

console.log('exact Molten 4bcfd8c6 Gate-0 compatibility passed');
