#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const generator = new URL('../motion-contact-constraints-artifact.mjs', import.meta.url);
const artifact = new URL(
  '../artifacts/motion-ready-719024/stationary-contact-constraints/',
  import.meta.url,
);
const producerFixture = new URL('producer-fixture.json', artifact);
const checkedConstraints = new URL('constraints.json', artifact);
const checkedReceipt = new URL('receipt.json', artifact);
const checkedReport = new URL('report.json', artifact);
const expectedProducerSha256 = 'a84bfcae1ad03f71961bcfc4c9040980648f4c579b1bccc3ba15d82a25a6210a';
const expectedConstraintsSha256 = '77a8e0f795791956ceb34a17da397865ea0a7504f98542de1e6b0529e66f72fb';

function run(outputDir, options = {}) {
  const fixture = options.fixture || producerFixture.pathname;
  const hillPacket = options.hillPacket
    || new URL('artifacts/motion-ready-719024/hill/motion-affordance-packet.json', root).pathname;
  const hillData = options.hillData
    || new URL('artifacts/motion-ready-719024/hill/motion-affordance-data.json', root).pathname;
  return spawnSync(
    process.execPath,
    [
      generator.pathname,
      '--producer-fixture',
      fixture,
      '--hill-packet',
      hillPacket,
      '--hill-data',
      hillData,
      '--output-dir',
      outputDir,
    ],
    {
      cwd: root.pathname,
      encoding: 'utf8',
      env: { ...process.env, ...options.env },
    },
  );
}

const temporary = await mkdtemp(join(tmpdir(), 'kaminos-contact-constraints-artifact-'));
const positiveDir = join(temporary, 'positive');
const positive = run(positiveDir);
assert.equal(positive.status, 0, positive.stderr);

const generatedConstraintsBytes = await readFile(join(positiveDir, 'constraints.json'), 'utf8');
const checkedConstraintsBytes = await readFile(checkedConstraints, 'utf8');
assert.equal(
  generatedConstraintsBytes,
  checkedConstraintsBytes,
  'the checked-in constraint packet must be byte-reproducible',
);

const generatedReceiptBytes = await readFile(join(positiveDir, 'receipt.json'), 'utf8');
const checkedReceiptBytes = await readFile(checkedReceipt, 'utf8');
assert.equal(
  generatedReceiptBytes,
  checkedReceiptBytes,
  'the checked-in consumer receipt must be byte-reproducible',
);

const generatedReportBytes = await readFile(join(positiveDir, 'report.json'), 'utf8');
const checkedReportBytes = await readFile(checkedReport, 'utf8');
assert.equal(
  generatedReportBytes,
  checkedReportBytes,
  'the checked-in success report must be byte-reproducible',
);

const receipt = JSON.parse(generatedReceiptBytes);
assert.equal(receipt.schema, 'kaminos.motion-contact-constraints-artifact-receipt.v0');
assert.equal(receipt.status, 'pass');
assert.equal(receipt.failurePhase, null);
assert.equal(receipt.source.producerFixtureSha256, expectedProducerSha256);
assert.equal(receipt.output.constraintsSha256, expectedConstraintsSha256);
assert.equal(receipt.effectiveRoute, 'motion-support-core + hill-motion-support-adapter');
assert.equal(
  receipt.supportSurface.sourceRef,
  'lerms:cc/hill-of-hills-live-terrain-server-0702@81c5348',
);
assert.equal(receipt.supportSurface.revision, '81c5348');
assert.equal(receipt.body.id, 'motion-ready-719024:axial-footprint');
assert.equal(receipt.pose.id, 'molten-low-frequency:C');
assert.equal(receipt.pose.phase, 1.3);
assert.deepEqual(
  receipt.output.patchIds,
  ['front-left', 'front-right', 'rear-left', 'rear-right'],
);

const corruptFixturePath = join(temporary, 'corrupt-producer-fixture.json');
const corruptFixture = JSON.parse(await readFile(producerFixture, 'utf8'));
corruptFixture.response.body.scale = 999;
await writeFile(corruptFixturePath, `${JSON.stringify(corruptFixture, null, 2)}\n`);
const corruptDir = join(temporary, 'corrupt');
assert.equal(run(corruptDir).status, 0, 'cached-output case requires a prior successful run');
const corrupt = run(corruptDir, { fixture: corruptFixturePath });
assert.notEqual(corrupt.status, 0, 'corrupted producer identity must fail');
const corruptReport = JSON.parse(await readFile(join(corruptDir, 'report.json'), 'utf8'));
assert.equal(corruptReport.status, 'fail');
assert.equal(corruptReport.failurePhase, 'contact-resolution');
assert.match(corruptReport.error.message, /body identity mismatch/);
await assert.rejects(
  readFile(join(corruptDir, 'constraints.json')),
  /ENOENT/,
  'a failed run must not leave a consumable constraint packet',
);

const partialWriteDir = join(temporary, 'partial-write');
const partialWrite = run(partialWriteDir, {
  env: {
    KAMINOS_CONTACT_CONSTRAINTS_TEST_FAIL_AFTER_CONSTRAINTS_STAGE: '1',
  },
});
assert.notEqual(partialWrite.status, 0, 'a forced partial artifact write must fail');
const partialWriteReport = JSON.parse(await readFile(join(partialWriteDir, 'report.json'), 'utf8'));
assert.equal(partialWriteReport.status, 'fail');
assert.equal(partialWriteReport.failurePhase, 'artifact-write');
for (const name of ['constraints.json', 'receipt.json']) {
  await assert.rejects(
    readFile(join(partialWriteDir, name)),
    /ENOENT/,
    `a partial artifact write must not leave ${name} consumable`,
  );
}

const stalePacketPath = join(temporary, 'stale-hill-packet.json');
const hillPacket = JSON.parse(await readFile(
  new URL('artifacts/motion-ready-719024/hill/motion-affordance-packet.json', root),
  'utf8',
));
hillPacket.source.sourceRefDetail.commit = 'stale-hill-revision';
await writeFile(stalePacketPath, `${JSON.stringify(hillPacket, null, 2)}\n`);
const staleDir = join(temporary, 'stale-hill');
const stale = run(staleDir, { hillPacket: stalePacketPath });
assert.notEqual(stale.status, 0, 'stale terrain identity must fail');
const staleReport = JSON.parse(await readFile(join(staleDir, 'report.json'), 'utf8'));
assert.equal(staleReport.status, 'fail');
assert.equal(staleReport.failurePhase, 'contact-resolution');
assert.match(staleReport.error.message, /support surface revision mismatch/);

const malformedDir = join(temporary, 'malformed-arguments');
assert.equal(run(malformedDir).status, 0, 'malformed invocation case requires cached primary outputs');
const malformed = spawnSync(
  process.execPath,
  [
    generator.pathname,
    '--producer-fixture',
    producerFixture.pathname,
    '--output-dir',
    malformedDir,
  ],
  { cwd: root.pathname, encoding: 'utf8' },
);
assert.notEqual(malformed.status, 0, 'missing required paths must fail');
const malformedReport = JSON.parse(await readFile(join(malformedDir, 'report.json'), 'utf8'));
assert.equal(malformedReport.status, 'fail');
assert.equal(malformedReport.failurePhase, 'argument-parse');
assert.match(malformedReport.error.message, /requires --hill-packet/);
for (const name of ['constraints.json', 'receipt.json']) {
  await assert.rejects(
    readFile(join(malformedDir, name)),
    /ENOENT/,
    `argument failure must invalidate cached ${name}`,
  );
}

console.log('motion contact constraints artifact contracts passed');
