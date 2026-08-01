import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as structuralAssay from '../structural-source-assay-core.mjs';
import { compileAssetArrivalProjections } from '../asset-arrival-projection-compiler-core.mjs';
import { createPng } from './png-fixture.mjs';

const assay = JSON.parse(await readFile(
  new URL('../fixtures/phase-three-hip-cup-source-assay.v0.json', import.meta.url),
  'utf8',
));

assert.equal(
  typeof structuralAssay.validateStructuralProjectionOutcome,
  'function',
  'Gate-0 must expose one plan-bound report/failure admission function',
);

const manifest = structuralAssay.buildStructuralSourceGenerationManifest(assay);
const root = await mkdtemp(join(tmpdir(), 'structural-projection-outcome-'));
const outDir = join(root, 'compiled');
const report = await compileAssetArrivalProjections({
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
      bytes: createPng(request.camera.width, request.camera.height, 31 + index),
    })),
  }),
});
const pointerPath = join(outDir, 'current.json');
const pointer = JSON.parse(await readFile(pointerPath, 'utf8'));
const reportPath = join(outDir, pointer.reportPath);

const accepted = await structuralAssay.validateStructuralProjectionOutcome({
  manifest,
  reportPath,
  publicationPointerPath: pointerPath,
});
assert.equal(accepted.ok, true, accepted.failures?.map(failure => failure.message).join('; '));
assert.equal(accepted.status, 'published-outcome-validated');
assert.equal(accepted.evidenceSha256, pointer.reportSha256);

assert.equal((await structuralAssay.validateStructuralProjectionOutcome({
  manifest,
  report: structuredClone(report),
  publicationPointer: pointer,
  reportSha256: pointer.reportSha256,
})).ok, false, 'caller-supplied objects cannot borrow authority from unrelated hashes');

const wrongSourceReport = structuredClone(report);
wrongSourceReport.sourceReceiptId = 'different-source-receipt';
const wrongSourcePath = join(root, 'wrong-source-report.json');
await writeFile(wrongSourcePath, `${JSON.stringify(wrongSourceReport, null, 2)}\n`);
assert.equal((await structuralAssay.validateStructuralProjectionOutcome({
  manifest,
  reportPath: wrongSourcePath,
  publicationPointerPath: pointerPath,
})).ok, false, 'a valid report for another source cannot satisfy this manifest');

const wrongPointer = structuredClone(pointer);
wrongPointer.publicationId = 'projection-different';
const wrongPointerPath = join(outDir, 'wrong-current.json');
await writeFile(wrongPointerPath, `${JSON.stringify(wrongPointer, null, 2)}\n`);
assert.equal((await structuralAssay.validateStructuralProjectionOutcome({
  manifest,
  reportPath,
  publicationPointerPath: wrongPointerPath,
})).ok, false, 'publication pointer drift must fail admission');

const failedOutDir = join(root, 'failed-compiled');
await assert.rejects(
  compileAssetArrivalProjections({
    source: manifest.compilerInput,
    outDir: failedOutDir,
    renderVariant: async () => { throw new Error('renderer unavailable'); },
  }),
  /renderer unavailable/,
);
const failurePath = `${failedOutDir}.failure.json`;
const acceptedFailure = await structuralAssay.validateStructuralProjectionOutcome({ manifest, failurePath });
assert.equal(acceptedFailure.ok, true, acceptedFailure.failures?.map(failure => failure.message).join('; '));
assert.equal(acceptedFailure.status, 'failed-outcome-validated');
assert.match(acceptedFailure.evidenceSha256, /^[0-9a-f]{64}$/);

assert.equal((await structuralAssay.validateStructuralProjectionOutcome({
  manifest,
  failure: JSON.parse(await readFile(failurePath, 'utf8')),
})).ok, false, 'a hand-built failure object is not durable compiler evidence');

const inventedPhase = JSON.parse(await readFile(failurePath, 'utf8'));
inventedPhase.failure.phase = 'something-nearby';
const inventedPhasePath = join(root, 'invented-failure.json');
await writeFile(inventedPhasePath, `${JSON.stringify(inventedPhase, null, 2)}\n`);
assert.equal(
  (await structuralAssay.validateStructuralProjectionOutcome({ manifest, failurePath: inventedPhasePath })).ok,
  false,
  'failure evidence must use one exact compiler phase identity',
);

assert.equal(
  (await structuralAssay.validateStructuralProjectionOutcome({ manifest, reportPath, failurePath })).ok,
  false,
  'report and failure evidence are mutually exclusive',
);

process.stdout.write('structural projection outcome contracts passed\n');
