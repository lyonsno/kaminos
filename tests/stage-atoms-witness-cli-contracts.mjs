import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'kaminos-stage-atoms-cli-'));
const successPath = join(tempDir, 'ccmixter-witness.json');

execFileSync(process.execPath, [
  'stage-atoms-witness.mjs',
  '--fixture',
  'ccmixter',
  '--output',
  successPath,
], {
  cwd: new URL('..', import.meta.url),
  stdio: 'pipe',
});

const successReport = JSON.parse(readFileSync(successPath, 'utf8'));
assert.equal(successReport.schema, 'kaminos.stage-atoms-witness-report.v0');
assert.equal(successReport.status, 'passed');
assert.equal(successReport.requestedFixture, 'ccmixter');
assert.equal(successReport.effectiveRoute, 'stage-atoms-pulp-shaped-material-spatializer-v0');
assert.equal(successReport.witness.schema, 'kaminos.stage-atoms-witness.v0');
assert.equal(successReport.witness.operatorHandle.sourcePanel.primarySourceKind, 'ccmixter');
assert.equal(successReport.falseCloseChecks.spotifyReferenceRejected, true);
assert.equal(successReport.falseCloseChecks.spatializerIgnoresRawAudio, true);

const realCcmixterPath = join(tempDir, 'ccmixter-geppetto-witness.json');
execFileSync(process.execPath, [
  'stage-atoms-witness.mjs',
  '--fixture',
  'ccmixter-geppetto',
  '--output',
  realCcmixterPath,
], {
  cwd: new URL('..', import.meta.url),
  stdio: 'pipe',
});

const realCcmixterReport = JSON.parse(readFileSync(realCcmixterPath, 'utf8'));
assert.equal(realCcmixterReport.status, 'passed');
assert.equal(realCcmixterReport.witness.operatorHandle.sourcePanel.primarySourceKind, 'ccmixter');
assert.equal(realCcmixterReport.witness.stage.sourceAccess.trackId, 'ccmixter:70553:file:127740');
assert.equal(realCcmixterReport.witness.stage.sourceAccess.title, 'Geppetto V4 (Pell + Stems) - Dry Main Acapella');
assert.equal(realCcmixterReport.witness.stage.sourceAccess.license, 'CC BY 2.5');
assert.equal(realCcmixterReport.witness.stage.sourceAccess.downloadUrl, 'https://ccmixter.org/content/Coruscate/Coruscate_-_Geppetto_V4_(Pell_Stems).mp3');
assert.equal(realCcmixterReport.witness.stage.sourceAccess.sourcePageUrl, 'https://ccmixter.org/files/Coruscate/70553');
assert.equal(realCcmixterReport.witness.stage.sourceAccess.publicDemoAllowed, true);
assert.ok(realCcmixterReport.witness.stage.sourceAccess.receiptWarnings.includes('direct_mp3_probe_returned_403_use_ccmixter_page_or_download_flow'));
assert.equal(realCcmixterReport.lastTrustworthyEvidence.fixture, 'ccmixter-geppetto');

const failurePath = join(tempDir, 'spotify-reference-failure.json');
const failureRun = spawnSync(process.execPath, [
  'stage-atoms-witness.mjs',
  '--fixture',
  'spotify-reference',
  '--output',
  failurePath,
], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
});

assert.notEqual(failureRun.status, 0, 'reference-only fixture exits nonzero');
const failureReport = JSON.parse(readFileSync(failurePath, 'utf8'));
assert.equal(failureReport.schema, 'kaminos.stage-atoms-witness-report.v0');
assert.equal(failureReport.status, 'failed');
assert.equal(failureReport.failurePhase, 'source_access');
assert.equal(failureReport.errorCode, 'analysis_not_allowed');
assert.equal(failureReport.requestedFixture, 'spotify-reference');
assert.equal(failureReport.effectiveRoute, 'stage-atoms-pulp-shaped-material-spatializer-v0');
assert.equal(failureReport.witness, null);
assert.equal(failureReport.lastTrustworthyEvidence.sourceAccess.accessClass, 'reference_only');
assert.equal(failureReport.lastTrustworthyEvidence.sourceAccess.analysisAllowed, false);
