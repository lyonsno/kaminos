#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  TRACK_M_SOURCE_PROJECTION_COMPILER_ID,
  TRACK_M_SOURCE_PROJECTION_FAILURE_SCHEMA,
  compileTrackMSourceProjection,
} from '../track-m-source-projection-core.mjs';

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`invalid argument sequence near ${key ?? '<end>'}`);
    args.set(key, value);
  }
  for (const required of ['--input', '--out', '--failure', '--expected-source-sha256']) {
    if (!args.has(required)) throw new Error(`${required} is required`);
  }
  return args;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

let args;
let requestedInputPath = null;
let effectiveInputPath = null;
let inputSha256 = null;
let expectedSourceSha256 = null;
let failurePath = null;
let lastTrustworthyEvidence = 'no input bytes read';
try {
  args = parseArgs(process.argv.slice(2));
  requestedInputPath = args.get('--input');
  failurePath = resolve(args.get('--failure'));
  expectedSourceSha256 = args.get('--expected-source-sha256');
  effectiveInputPath = await realpath(requestedInputPath);
  const inputBytes = await readFile(effectiveInputPath);
  inputSha256 = createHash('sha256').update(inputBytes).digest('hex');
  lastTrustworthyEvidence = 'raw extraction bytes read and hashed';
  const raw = JSON.parse(inputBytes);
  const graph = compileTrackMSourceProjection(raw, { expectedSourceSha256 });
  await writeJson(resolve(args.get('--out')), graph);
  process.stdout.write(`${JSON.stringify({
    status: 'compiled',
    graphSha256: graph.graphSha256,
    outputPath: resolve(args.get('--out')),
  })}\n`);
} catch (error) {
  const report = {
    schema: TRACK_M_SOURCE_PROJECTION_FAILURE_SCHEMA,
    compilerId: TRACK_M_SOURCE_PROJECTION_COMPILER_ID,
    status: 'failed',
    failurePhase: lastTrustworthyEvidence === 'no input bytes read' ? 'input-read' : 'source-validation',
    requestedInputPath,
    effectiveInputPath,
    inputSha256,
    expectedSourceSha256,
    error: error instanceof Error ? error.message : String(error),
    lastTrustworthyEvidence,
  };
  try {
    if (!failurePath) {
      const candidate = process.argv.indexOf('--failure');
      if (candidate >= 0 && process.argv[candidate + 1]) failurePath = resolve(process.argv[candidate + 1]);
    }
    if (failurePath) await writeJson(failurePath, report);
  } catch (reportError) {
    process.stderr.write(`failed to write projection failure report: ${reportError}\n`);
  }
  process.stderr.write(`${report.error}\n`);
  process.exitCode = 1;
}
