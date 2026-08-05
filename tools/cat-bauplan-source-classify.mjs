#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { classifyCatBauplanSource } from '../cat-bauplan-source-classifier-core.mjs';

const FAILURE_SCHEMA = 'kaminos.cat-bauplan-source-classification-failure.v0';

function argumentsFrom(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`invalid argument at ${key ?? '<end>'}`);
    values[key.slice(2)] = value;
  }
  for (const name of ['input', 'out', 'failure', 'expected-source-sha256']) {
    if (!values[name]) throw new Error(`missing --${name}`);
  }
  return values;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

let args;
let extractionRead = false;
try {
  args = argumentsFrom(process.argv.slice(2));
  const extraction = JSON.parse(await readFile(args.input, 'utf8'));
  extractionRead = true;
  const classification = classifyCatBauplanSource(extraction, {
    expectedSourceSha256: args['expected-source-sha256'],
  });
  await writeJson(args.out, classification);
  console.log(JSON.stringify({
    status: 'completed',
    outputPath: resolve(args.out),
    admittedObjectCount: classification.admittedObjectNames.length,
    sourceSha256: classification.source.sha256,
  }));
} catch (error) {
  const failurePath = args?.failure;
  if (failurePath) {
    await writeJson(failurePath, {
      schema: FAILURE_SCHEMA,
      classifierId: 'cat-bauplan-source-classifier-v0',
      status: 'failed',
      failurePhase: 'source-classification',
      error: error instanceof Error ? error.message : String(error),
      lastTrustworthyEvidence: extractionRead
        ? 'The input extraction was readable; no source geometry classification was admitted'
        : 'No source extraction was admitted',
    });
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
