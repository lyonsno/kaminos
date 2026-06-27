import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  KILN_IMAGE_ARTIFACT_SCHEMA,
  KILN_IMAGE_IMPORT_TRAY_WITNESS_SCHEMA,
  KILN_IMAGE_LEDGER_SCHEMA,
  KILN_IMAGE_ROUTE_RECEIPT_SCHEMA,
  buildFallbackRouteReceipt,
  buildFixtureImportTrayWitness,
  buildImageArtifact,
  buildImageRouteReceipt,
} from '../kiln-image-ledger.mjs';

const root = new URL('..', import.meta.url).pathname;
const witnessPath = join(root, 'kiln-image-import-witness.mjs');

assert.equal(KILN_IMAGE_ARTIFACT_SCHEMA, 'kaminos.kiln.image-artifact.v0');
assert.equal(KILN_IMAGE_ROUTE_RECEIPT_SCHEMA, 'kaminos.kiln.image-route-receipt.v0');
assert.equal(KILN_IMAGE_LEDGER_SCHEMA, 'kaminos.kiln.image-ledger.v0');
assert.equal(KILN_IMAGE_IMPORT_TRAY_WITNESS_SCHEMA, 'kaminos.kiln.image-import-tray-witness.v0');
assert.ok(existsSync(witnessPath), 'kiln-image-import-witness.mjs must provide a durable import-tray fixture witness');

const bytes = Buffer.from('red lerm no-face reference pixels\n');
const expectedHash = createHash('sha256').update(bytes).digest('hex');
const importReceipt = buildImageRouteReceipt({
  requestedRoute: 'operator_import',
  effectiveRoute: 'operator_import',
  backend: 'kaminos-import-tray',
  runtime: 'node-fixture',
  model: null,
  inputArtifactIds: [],
});

const artifact = buildImageArtifact({
  artifactId: 'artifact-red-lerm-import',
  sourceKind: 'operator_import',
  assetRole: 'reference',
  promotionState: 'bench_evidence',
  mimeType: 'image/png',
  width: 64,
  height: 48,
  storageRef: 'fixtures/red-lerm/reference.png',
  content: bytes,
  licenseOrCustody: 'operator_supplied_unknown',
  routeReceipt: importReceipt,
  conditioningLinks: {
    specimenCheckpointId: 'red-lerm-specimen-checkpoint-v0',
    maskArtifactIds: ['mask-no-face-front-cap'],
    normalArtifactIds: [],
    depthArtifactIds: [],
    negativeLawIds: ['no-visible-eyes'],
  },
  failureLabels: ['eye-drift-blocked'],
});

assert.equal(artifact.schema, KILN_IMAGE_ARTIFACT_SCHEMA);
assert.equal(artifact.contentHash, expectedHash);
assert.equal(artifact.sourceKind, 'operator_import');
assert.equal(artifact.routeReceipt.requestedRoute, 'operator_import');
assert.equal(artifact.routeReceipt.effectiveRoute, 'operator_import');
assert.deepEqual(artifact.conditioningLinks.negativeLawIds, ['no-visible-eyes']);
assert.ok(artifact.sourceTruthWarnings.includes('operator_supplied_unknown_custody'), 'unknown import custody must stay visible');

assert.throws(
  () => buildImageRouteReceipt({
    requestedRoute: 'openai_api',
    effectiveRoute: 'fixture',
    backend: 'fixture',
  }),
  /fallbackReason is required/,
  'fallback route mismatch must not masquerade as the requested route',
);

const fallbackReceipt = buildFallbackRouteReceipt({
  requestedRoute: 'openai_api',
  effectiveRoute: 'fixture',
  backend: 'kaminos-fixture',
  fallbackReason: 'openai_api_unconfigured',
  errorPhase: 'route-selection',
});

assert.equal(fallbackReceipt.schema, KILN_IMAGE_ROUTE_RECEIPT_SCHEMA);
assert.equal(fallbackReceipt.requestedRoute, 'openai_api');
assert.equal(fallbackReceipt.effectiveRoute, 'fixture');
assert.equal(fallbackReceipt.fallbackReason, 'openai_api_unconfigured');
assert.ok(fallbackReceipt.sourceTruthWarnings.includes('fallback_route_mismatch'), 'fallback receipt must carry mismatch warning');

const fixtureWitness = buildFixtureImportTrayWitness({
  importedContent: bytes,
  requestedGeneratorRoute: 'openai_api',
  effectiveFallbackRoute: 'fixture',
  fallbackReason: 'openai_api_unconfigured',
});

assert.equal(fixtureWitness.schema, KILN_IMAGE_IMPORT_TRAY_WITNESS_SCHEMA);
assert.equal(fixtureWitness.ok, true);
assert.equal(fixtureWitness.ledger.schema, KILN_IMAGE_LEDGER_SCHEMA);
assert.equal(fixtureWitness.ledger.artifacts.length, 2, 'fixture witness keeps import and fallback candidate distinct');
assert.equal(fixtureWitness.ledger.artifacts[0].sourceKind, 'operator_import');
assert.equal(fixtureWitness.ledger.artifacts[1].sourceKind, 'fallback');
assert.equal(fixtureWitness.ledger.artifacts[1].routeReceipt.requestedRoute, 'openai_api');
assert.equal(fixtureWitness.ledger.artifacts[1].routeReceipt.effectiveRoute, 'fixture');
assert.ok(fixtureWitness.sourceTruthSummary.fallbackCount === 1, 'witness counts fallback truth explicitly');

const temp = mkdtempSync(join(tmpdir(), 'kaminos-kiln-image-ledger-test-'));
const reportPath = join(temp, 'witness.json');
const cli = spawnSync('node', [witnessPath, '--report', reportPath], { encoding: 'utf8' });
assert.equal(cli.status, 0, cli.stderr || cli.stdout);
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
assert.equal(report.schema, KILN_IMAGE_IMPORT_TRAY_WITNESS_SCHEMA);
assert.equal(report.ok, true);
assert.equal(report.ledger.artifacts[0].contentHash, expectedHash);
assert.equal(report.ledger.artifacts[1].routeReceipt.fallbackReason, 'openai_api_unconfigured');

const badReportPath = join(temp, 'bad-witness.json');
const bad = spawnSync('node', [
  witnessPath,
  '--requested-route', 'openai_api',
  '--effective-route', 'fixture',
  '--fallback-reason', '',
  '--report', badReportPath,
], { encoding: 'utf8' });
assert.notEqual(bad.status, 0, 'witness must fail when fallback lacks a reason');
const badReport = JSON.parse(readFileSync(badReportPath, 'utf8'));
assert.equal(badReport.ok, false);
assert.equal(badReport.phase, 'building-witness');
assert.match(badReport.error, /fallbackReason is required/);
