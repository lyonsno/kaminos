import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

console.log('grid96 layer-retention comparison contracts passed');
