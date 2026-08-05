#!/usr/bin/env node

import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  ANALYTICAL_ELBOW_C_P0_BUNDLE_SCHEMA,
  createAnalyticalElbowCP0Bundle,
} from './analytical-elbow-positive-volume-c-p0-core.mjs';

const ROUTE = 'analytical-elbow-positive-volume-c-p0-cli';

function extractOutputPath(argv) {
  const outputIndex = argv.indexOf('--output');
  if (outputIndex < 0 || !argv[outputIndex + 1]) return null;
  return resolve(argv[outputIndex + 1]);
}

function parseArguments(argv) {
  let output = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--output') {
      output = argv[++index];
      if (!output) throw new Error('C(P0) --output requires a path');
    } else {
      throw new Error(`unknown C(P0) argument ${argv[index]}`);
    }
  }
  if (!output) throw new Error('C(P0) requires --output');
  return { output };
}

async function writeJsonAtomically(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryPath, path);
}

function canonicalizeJsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}

export async function runAnalyticalElbowCP0Cli(argv) {
  let outputPath = extractOutputPath(argv);
  let failurePhase = 'argument-parsing';
  try {
    const options = parseArguments(argv);
    outputPath = resolve(options.output);
    failurePhase = 'matched-solver-comparison';
    const bundle = createAnalyticalElbowCP0Bundle();
    const receipt = canonicalizeJsonValue({
      ...bundle,
      execution: {
        requestedRoute: ROUTE,
        effectiveRoute: ROUTE,
        fallbackUsed: false,
        innerRequestedRoute: bundle.report.requestedRoute,
        innerEffectiveRoute: bundle.report.effectiveRoute,
      },
    });
    await writeJsonAtomically(outputPath, receipt);
    return receipt;
  } catch (error) {
    if (outputPath) {
      await writeJsonAtomically(outputPath, {
        schema: ANALYTICAL_ELBOW_C_P0_BUNDLE_SCHEMA,
        status: 'failed',
        case: 'c-p0',
        requestedRoute: ROUTE,
        effectiveRoute: null,
        fallbackUsed: false,
        failurePhase,
        lastTrustworthyEvidence: 'caller output path parsed',
        primaryOutput: null,
        error: error.message,
      });
    }
    throw error;
  }
}

const isMain = process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  runAnalyticalElbowCP0Cli(process.argv.slice(2)).then(bundle => {
    console.log(JSON.stringify({
      status: bundle.status,
      case: bundle.case,
      solverStatus: bundle.report.status,
      candidateStatus: bundle.report.controlComparison.status,
      failurePhase: bundle.report.failurePhase,
    }));
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
