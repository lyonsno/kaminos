import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const script = new URL('../grid96-layer-retention-comparison.mjs', import.meta.url);
assert.ok(existsSync(script), 'grid96 layer-retention comparison assembler exists');

const source = await readFile(script, 'utf8');
assert.match(source, /kaminos\.volume\.grid96-layer-retention-comparison\.v0/, 'assembler pins its report schema');
assert.match(source, /sha256:120a275c49ce7ae3456a9202ca3da55df5c51ab743b1c49ec71924abadae658d/, 'assembler pins the exact r4 socket identity');
assert.match(source, /kaminos_grid96_layer_retention_oracle_0718/, 'assembler pins the Greenroom route');
assert.match(source, /expectedArmCoordinates/, 'assembler requires the complete Ridge and Non-Ridge ladder');
assert.match(source, /transmittanceLedger/, 'assembler validates exact transmittance artifacts');
assert.match(source, /rowSelectionCap/, 'assembler rejects hidden selection caps');
assert.match(source, /geometryRowsDropped/, 'assembler rejects dropped geometry rows');
assert.match(source, /selectedNativeCellArtifact/, 'assembler binds retained native ids');
assert.match(source, /imageLedger/, 'assembler binds every displayed image');
assert.match(source, /lastTrustworthyEvidence/, 'assembler preserves a failure receipt before primary output');
assert.match(source, /artifactLedger/, 'assembler binds its final page, cohort copy, and displayed images');
assert.match(source, /--verify-bundle/, 'assembler exposes reusable final-bundle verification');
assert.match(source, /--cohort-manifest/, 'assembler accepts a caller-owned cohort manifest path');
assert.match(source, /--out-dir/, 'assembler accepts a caller-owned output path');
assert.match(source, /--report/, 'assembler writes a caller-owned report path');

const root = await mkdtemp(join(tmpdir(), 'grid96-layer-retention-comparison-'));
const invoke = cohort => {
  const cohortPath = join(root, `${cohort.name}.json`);
  const out = join(root, `${cohort.name}-out`);
  return writeFile(cohortPath, `${JSON.stringify(cohort)}\n`).then(() => ({
    out,
    result: spawnSync(process.execPath, [
      script.pathname, '--cohort-manifest', cohortPath,
      '--out-dir', out, '--report', join(out, 'report.json'),
    ], { encoding: 'utf8' }),
  }));
};

const expected = ['p50', 'p75', 'p90', 'p95', 'p99'].flatMap(label => [`ridge-${label}`, `nonridge-${label}`]);
const partial = await invoke({
  name: 'partial', schema: 'kaminos.volume.grid96-layer-retention-cohort.v0', status: 'complete',
  control: { report: '/missing/control.json', receipt: '/missing/control-receipt.json' },
  arms: expected.slice(0, -1).map(key => ({ key, report: `/missing/${key}.json`, receipt: `/missing/${key}-receipt.json` })),
});
assert.notEqual(partial.result.status, 0, 'partial cohort must fail');
const partialFailure = JSON.parse(await readFile(join(partial.out, 'report.json'), 'utf8'));
assert.equal(partialFailure.status, 'failed');
assert.equal(partialFailure.failurePhase, 'cohort-validation');
assert.match(partialFailure.error, /exactly ten arms/i);
assert.ok(partialFailure.lastTrustworthyEvidence, 'partial cohort failure preserves last trustworthy evidence');

const repeated = await invoke({
  name: 'repeated', schema: 'kaminos.volume.grid96-layer-retention-cohort.v0', status: 'complete',
  control: { report: '/missing/control.json', receipt: '/missing/control-receipt.json' },
  arms: expected.map((key, index) => ({
    key: index === expected.length - 1 ? expected[0] : key,
    report: `/missing/${key}.json`, receipt: `/missing/${key}-receipt.json`,
  })),
});
assert.notEqual(repeated.result.status, 0, 'repeated cohort coordinate must fail');
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
const descriptor = (path, bytes) => ({
  path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
});
const artifactLedger = {
  'index.html': descriptor('index.html', gallery),
  'cohort-manifest.json': descriptor('cohort-manifest.json', cohort),
  'images/fixture.png': descriptor('images/fixture.png', png),
};
const bundleReportPath = join(bundle, 'report.json');
await writeFile(bundleReportPath, `${JSON.stringify({
  schema: 'kaminos.volume.grid96-layer-retention-comparison.v0', status: 'complete',
  artifacts: {
    gallery: artifactLedger['index.html'], cohortManifest: artifactLedger['cohort-manifest.json'],
    copiedImageCount: 1, imageLedger: { 'images/fixture.png': artifactLedger['images/fixture.png'] },
    artifactLedger,
  },
})}\n`);
const verify = () => spawnSync(process.execPath, [script.pathname, '--verify-bundle', bundleReportPath], { encoding: 'utf8' });
const validBundle = verify();
assert.equal(validBundle.status, 0, validBundle.stderr || validBundle.stdout || 'valid final bundle verification failed');

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

console.log('grid96 layer-retention comparison contracts passed');
