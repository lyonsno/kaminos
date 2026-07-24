#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import { createHillMotionSupportIdentity, createHillSampledSupportSurface } from './hill-motion-support-adapter.js';
import { decodeHillMotionAffordancePacket } from './hill-motion-affordance-source.mjs';
import { resolveMotionContactConstraints } from './motion-support-core.js';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseArguments(argv) {
  const result = {
    producerFixture: '',
    hillPacket: '',
    hillData: '',
    outputDir: '',
  };
  const names = new Map([
    ['--producer-fixture', 'producerFixture'],
    ['--hill-packet', 'hillPacket'],
    ['--hill-data', 'hillData'],
    ['--output-dir', 'outputDir'],
  ]);
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const field = names.get(argument);
    if (!field) throw new Error(`unknown argument ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a path`);
    result[field] = value;
    index++;
  }
  for (const [argument, field] of names) {
    if (!result[field]) throw new Error(`motion contact constraints artifact requires ${argument}`);
  }
  return result;
}

function recoverOutputDir(argv) {
  const index = argv.indexOf('--output-dir');
  const value = index >= 0 ? argv[index + 1] : '';
  return value && !value.startsWith('--') ? resolve(value) : null;
}

function errorRecord(error) {
  return {
    name: error?.name || 'Error',
    message: String(error?.message || error),
    stack: String(error?.stack || ''),
  };
}

const PUBLICATION_PATHS = [
  'constraints.json',
  'receipt.json',
  'report.json',
  'constraints.json.pending',
  'receipt.json.pending',
  'report.json.pending',
];

async function removePublication(outputDir) {
  const results = await Promise.allSettled(
    PUBLICATION_PATHS.map(name => rm(join(outputDir, name), { force: true })),
  );
  const failures = results
    .filter(result => result.status === 'rejected')
    .map(result => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(failures, 'failed to invalidate prior artifact publication');
  }
}

function requireFixture(fixture) {
  if (fixture?.schema !== 'kaminos.motion-contact-probe-handshake-fixture.v0') {
    throw new Error('producer fixture schema mismatch');
  }
  if (fixture.effectiveRoute !== 'kaminos/fitted-proxy-rig/motion-contact-probe-adapter-v0') {
    throw new Error('producer fixture effective route mismatch');
  }
  if (!fixture.prepass || !fixture.request || !fixture.response) {
    throw new Error('producer fixture requires prepass, request, and response');
  }
  return fixture;
}

const argv = process.argv.slice(2);
let outputDir = recoverOutputDir(argv);
let requested = null;
const report = {
  schema: 'kaminos.motion-contact-constraints-artifact-report.v0',
  status: 'fail',
  failurePhase: 'argument-parse',
  effectiveRoute: 'motion-support-core + hill-motion-support-adapter',
  source: {},
  supportSurface: null,
  body: null,
  pose: null,
  output: null,
  error: null,
};

try {
  if (outputDir) {
    report.failurePhase = 'artifact-cleanup';
    await mkdir(outputDir, { recursive: true });
    await removePublication(outputDir);
  }
  report.failurePhase = 'argument-parse';
  requested = parseArguments(argv);
  outputDir = resolve(requested.outputDir);
  await mkdir(outputDir, { recursive: true });

  report.failurePhase = 'fixture-load';
  const [producerFixtureBytes, hillPacketBytes, hillDataBytes] = await Promise.all([
    readFile(resolve(requested.producerFixture)),
    readFile(resolve(requested.hillPacket)),
    readFile(resolve(requested.hillData)),
  ]);
  const producerFixture = requireFixture(JSON.parse(producerFixtureBytes));
  const hillPacket = JSON.parse(hillPacketBytes);
  const hillData = JSON.parse(hillDataBytes);
  report.source = {
    producerFixture: basename(requested.producerFixture),
    producerFixtureSha256: sha256(producerFixtureBytes),
    hillPacket: basename(requested.hillPacket),
    hillPacketSha256: sha256(hillPacketBytes),
    hillData: basename(requested.hillData),
    hillDataSha256: sha256(hillDataBytes),
  };

  report.failurePhase = 'support-adapter';
  const hillSource = decodeHillMotionAffordancePacket({ packet: hillPacket, data: hillData });
  const supportIdentity = createHillMotionSupportIdentity(hillPacket);
  const supportSurface = createHillSampledSupportSurface(hillSource, supportIdentity);
  report.supportSurface = { ...supportIdentity };

  report.failurePhase = 'contact-resolution';
  const constraints = resolveMotionContactConstraints(
    supportSurface,
    producerFixture.prepass,
    producerFixture.request,
    producerFixture.response,
  );
  const constraintsBytes = `${JSON.stringify(constraints, null, 2)}\n`;
  const constraintsSha256 = sha256(constraintsBytes);
  const receipt = {
    schema: 'kaminos.motion-contact-constraints-artifact-receipt.v0',
    status: 'pass',
    failurePhase: null,
    effectiveRoute: report.effectiveRoute,
    source: { ...report.source },
    supportSurface: { ...constraints.supportSurface },
    body: { ...constraints.body },
    pose: {
      id: constraints.poseId,
      phase: constraints.phase,
    },
    output: {
      schema: constraints.schema,
      id: constraints.id,
      constraintsSha256,
      patchIds: constraints.patches.map(patch => patch.id),
    },
  };
  const receiptBytes = `${JSON.stringify(receipt, null, 2)}\n`;

  report.status = 'pass';
  report.failurePhase = null;
  report.body = receipt.body;
  report.pose = receipt.pose;
  report.output = receipt.output;
  const reportBytes = `${JSON.stringify(report, null, 2)}\n`;

  report.failurePhase = 'artifact-write';
  await writeFile(join(outputDir, 'constraints.json.pending'), constraintsBytes);
  if (process.env.KAMINOS_CONTACT_CONSTRAINTS_TEST_FAIL_AFTER_CONSTRAINTS_STAGE === '1') {
    throw new Error('forced failure after constraints staging');
  }
  await writeFile(join(outputDir, 'receipt.json.pending'), receiptBytes);
  await writeFile(join(outputDir, 'report.json.pending'), reportBytes);
  await rename(join(outputDir, 'constraints.json.pending'), join(outputDir, 'constraints.json'));
  await rename(join(outputDir, 'report.json.pending'), join(outputDir, 'report.json'));
  await rename(join(outputDir, 'receipt.json.pending'), join(outputDir, 'receipt.json'));
  report.failurePhase = null;
} catch (error) {
  report.status = 'fail';
  report.error = errorRecord(error);
  if (outputDir) {
    try {
      await removePublication(outputDir);
    } catch (cleanupError) {
      report.error.cleanup = errorRecord(cleanupError);
    }
    await writeFile(join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
}

if (report.status !== 'pass') {
  console.error(`${report.failurePhase}: ${report.error?.message || 'unknown failure'}`);
  process.exitCode = 1;
} else {
  console.log(outputDir);
}
