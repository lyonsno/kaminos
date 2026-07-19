import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = new URL('../grid96-transverse-comparison.mjs', import.meta.url);
assert.ok(existsSync(script), 'Grid96 transverse comparison assembler exists');

const source = await readFile(script, 'utf8');
assert.match(source, /kaminos\.volume\.grid96-transverse-comparison\.v0/, 'assembler pins its report schema');
assert.match(source, /rank-one-tangent-plus-world-normal-binormal-symmetric-placement-v0/, 'assembler pins transverse placement identity');
assert.match(source, /const TRANSVERSE_FOOTPRINT = TRANSVERSE_IDENTITY;/, 'assembler validates the exact effective transverse footprint identity');
assert.match(source, /sha256:b424b2eeb4bc30b2210ab5a3c5e2aebd16eb9ff270c9add32802926fd8f5f9e1/, 'assembler pins the exact transverse socket identity');
assert.match(source, /739d60e8965d923acd10761331b5d1310d4dba75a7484a006217032d185d14c0/, 'assembler pins the socket manifest hash');
assert.match(source, /3713938c8e664cf746d10fe4ed2b9c8082d8673d887e595becabbc67b0cb3cf5/, 'assembler pins the basis payload hash');
assert.match(source, /kaminos_grid96_transverse_oracle_0718/, 'assembler pins the Greenroom route');
assert.match(source, /expectedArmCoordinates/, 'assembler requires the complete width surface');
assert.match(source, /transmittanceLedger/, 'assembler validates exact transmittance artifacts');
assert.match(source, /geometryRowsDropped/, 'assembler rejects dropped geometry rows');
assert.match(source, /candidateSupportChanged/, 'assembler rejects changed candidate support');
assert.match(source, /allNominalKernelMassConserved/, 'assembler rejects nonconserved parent mass');
assert.match(source, /imageLedger/, 'assembler binds every displayed image');
assert.match(source, /artifactLedger/, 'assembler binds the page, cohort, and displayed images');
assert.match(source, /lastTrustworthyEvidence/, 'assembler preserves evidence on pre-output failure');
assert.match(source, /--verify-bundle/, 'assembler exposes reusable final-bundle verification');

const root = await mkdtemp(join(tmpdir(), 'grid96-transverse-comparison-'));
const invoke = async cohort => {
  const cohortPath = join(root, `${cohort.name}.json`);
  const out = join(root, `${cohort.name}-out`);
  await writeFile(cohortPath, `${JSON.stringify(cohort)}\n`);
  return {
    out,
    result: spawnSync(process.execPath, [
      script.pathname, '--cohort-manifest', cohortPath,
      '--out-dir', out, '--report', join(out, 'report.json'),
    ], { encoding: 'utf8' }),
  };
};

const expected = ['n1-b0', 'n0-b1', 'n05-b05', 'n1-b1', 'n15-b15'];
const partial = await invoke({
  name: 'partial', schema: 'kaminos.volume.grid96-transverse-cohort.v0', status: 'complete',
  control: { report: '/missing/control.json', receipt: '/missing/control-receipt.json' },
  arms: expected.slice(0, -1).map(key => ({ key, report: `/missing/${key}.json`, receipt: `/missing/${key}-receipt.json` })),
});
assert.notEqual(partial.result.status, 0, 'partial transverse cohort must fail');
const partialFailure = JSON.parse(await readFile(join(partial.out, 'report.json'), 'utf8'));
assert.equal(partialFailure.status, 'failed');
assert.equal(partialFailure.failurePhase, 'cohort-validation');
assert.match(partialFailure.error, /exactly five arms/i);
assert.ok(partialFailure.lastTrustworthyEvidence, 'partial cohort failure preserves last trustworthy evidence');

const repeated = await invoke({
  name: 'repeated', schema: 'kaminos.volume.grid96-transverse-cohort.v0', status: 'complete',
  control: { report: '/missing/control.json', receipt: '/missing/control-receipt.json' },
  arms: expected.map((key, index) => ({
    key: index === expected.length - 1 ? expected[0] : key,
    report: `/missing/${key}.json`, receipt: `/missing/${key}-receipt.json`,
  })),
});
assert.notEqual(repeated.result.status, 0, 'repeated transverse coordinate must fail');
const repeatedFailure = JSON.parse(await readFile(join(repeated.out, 'report.json'), 'utf8'));
assert.equal(repeatedFailure.failurePhase, 'cohort-validation');
assert.match(repeatedFailure.error, /keys repeat/i);

const bundle = join(root, 'bundle');
const imageDir = join(bundle, 'images');
await mkdir(imageDir, { recursive: true });
const gallery = Buffer.from('<!doctype html><title>fixture</title>');
const cohort = Buffer.from('{"schema":"fixture"}\n');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const galleryPath = join(bundle, 'index.html');
const cohortPath = join(bundle, 'cohort-manifest.json');
const imagePath = join(imageDir, 'fixture.png');
await writeFile(galleryPath, gallery);
await writeFile(cohortPath, cohort);
await writeFile(imagePath, png);
const descriptor = (path, bytes) => ({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
const artifactLedger = {
  'index.html': descriptor('index.html', gallery),
  'cohort-manifest.json': descriptor('cohort-manifest.json', cohort),
  'images/fixture.png': descriptor('images/fixture.png', png),
};
const bundleReportPath = join(bundle, 'report.json');
await writeFile(bundleReportPath, `${JSON.stringify({
  schema: 'kaminos.volume.grid96-transverse-comparison.v0', status: 'complete',
  artifacts: {
    gallery: artifactLedger['index.html'], cohortManifest: artifactLedger['cohort-manifest.json'],
    copiedImageCount: 1, imageLedger: { 'images/fixture.png': artifactLedger['images/fixture.png'] }, artifactLedger,
  },
})}\n`);
const verify = () => spawnSync(process.execPath, [script.pathname, '--verify-bundle', bundleReportPath], { encoding: 'utf8' });
const validBundle = verify();
assert.equal(validBundle.status, 0, validBundle.stderr || validBundle.stdout || 'valid bundle verification failed');

await writeFile(imagePath, Buffer.from(png).fill(0, png.length - 1));
const driftedBundle = verify();
assert.notEqual(driftedBundle.status, 0, 'hash-drifted displayed image must fail verification');
assert.match(driftedBundle.stderr, /hash drifted/i);

await writeFile(imagePath, Buffer.alloc(0));
const blankBundle = verify();
assert.notEqual(blankBundle.status, 0, 'blank displayed image must fail verification');
assert.match(blankBundle.stderr, /blank|partial/i);

await writeFile(imagePath, png);
await rename(imagePath, `${imagePath}.missing`);
const missingBundle = verify();
assert.notEqual(missingBundle.status, 0, 'missing displayed image must fail verification');
assert.match(missingBundle.stderr, /missing/i);

console.log('Grid96 transverse comparison contracts passed');
