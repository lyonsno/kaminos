import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const witnessUrl = new URL('../volume-layer-coefficient-corpus-witness.mjs', import.meta.url);
assert.ok(existsSync(witnessUrl), 'layer coefficient corpus witness exists');
const witness = await readFile(witnessUrl, 'utf8');

assert.match(witness, /single-browser-multi-state-layer-coefficient-capture-v0/, 'witness owns one browser across every simulator state');
assert.match(witness, /sampleDeterministicReplayFrame/, 'witness captures separated simulator states rather than relabeling control variants');
assert.match(witness, /whole-simulator-state-holdout-v0/, 'witness emits a whole-state train and holdout split');
assert.match(witness, /beginDebugNonRidgeSourceBasisCapture/, 'witness captures exact local Ridge and Non-Ridge source coefficients');
assert.match(witness, /selectAnalyticalLayerRows/, 'witness applies the reviewed analytical Ridge-or-Non-Ridge selector');
assert.match(witness, /sampleCap:\s*null/, 'witness preserves uncapped admitted support');
assert.match(witness, /droppedRowCount:\s*0/, 'witness reports zero dropped admitted rows');
assert.match(witness, /beginDebugFullFieldExport/, 'witness exports the full same-state fluid, front, boundary, and majorant fields');
assert.match(witness, /beginDebugFullFieldImport/, 'witness checksum-binds descriptor capture through a same-state field import');
assert.match(witness, /beginFlowKernelDescriptorIndexUpload/, 'witness uploads caller-ordered native cell indices');
assert.match(witness, /flowKernelDescriptorCapture:\s*true/, 'witness explicitly requests flow-kernel descriptor capture');
assert.match(witness, /flow-kernel-local-descriptor-socket-v0/, 'witness binds the reviewed descriptor socket identity');
assert.match(witness, /kaminos\.volume\.layer-coefficient-training-manifest\.v0/, 'witness emits the learner manifest schema');
assert.match(witness, /--probe-only/, 'witness runs the no-training airlock before declaring completion');
assert.match(witness, /failurePhase[\s\S]*lastTrustworthyEvidence/, 'witness preserves phase-local failure evidence');
assert.match(witness, /effectiveRoute[\s\S]*prototypeIdentity[\s\S]*backend/, 'witness records effective runtime identity');
assert.doesNotMatch(witness, /Promise\.all\([^)]*state/i, 'witness does not launch state captures concurrently');

const failureRoot = await mkdtemp(join(tmpdir(), 'kaminos-layer-coefficient-witness-failure-'));
const failureReportPath = join(failureRoot, 'capture-report.json');
const missingUrl = spawnSync('node', [
  witnessUrl.pathname,
  '--out-dir', failureRoot,
  '--report', failureReportPath,
], { encoding: 'utf8' });
assert.notEqual(missingUrl.status, 0, 'missing requested route must fail');
assert.ok(existsSync(failureReportPath), 'argument admission failure writes a durable report');
const failureReport = JSON.parse(await readFile(failureReportPath, 'utf8'));
assert.equal(failureReport.status, 'failed');
assert.equal(failureReport.failurePhase, 'argument-validation');
assert.match(failureReport.reason, /--url is required/);

console.log('volume layer coefficient corpus witness contracts passed');
