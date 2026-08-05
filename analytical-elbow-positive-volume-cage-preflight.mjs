#!/usr/bin/env node

import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  ANALYTICAL_ELBOW_CAGE_PREFLIGHT_BUNDLE_SCHEMA,
  createAnalyticalElbowRowSBundle,
  createAsymmetricNonRingBundle,
} from './analytical-elbow-positive-volume-cage-preflight-core.mjs';

const ROUTE = 'analytical-elbow-positive-volume-cage-preflight';

function extractOutputPath(argv) {
  const outputIndex = argv.indexOf('--output');
  if (outputIndex < 0 || !argv[outputIndex + 1]) return null;
  return resolve(argv[outputIndex + 1]);
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--case') {
      options.case = argv[++index];
      if (!options.case) throw new Error('cage preflight --case requires a value');
    } else if (argument === '--output') {
      options.output = argv[++index];
      if (!options.output) throw new Error('cage preflight --output requires a path');
    } else {
      throw new Error(`unknown cage preflight argument ${argument}`);
    }
  }
  if (!options.case) throw new Error('cage preflight requires --case');
  if (!options.output) throw new Error('cage preflight requires --output');
  if (!['row-s', 'asymmetric-non-ring'].includes(options.case)) {
    throw new Error(`unknown cage preflight case ${options.case}`);
  }
  return options;
}

async function writeJsonAtomically(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryPath, path);
}

export async function runAnalyticalElbowCagePreflightCli(argv) {
  let outputPath = extractOutputPath(argv);
  let requestedCase = null;
  let failurePhase = 'argument-parsing';
  try {
    const options = parseArguments(argv);
    outputPath = resolve(options.output);
    requestedCase = options.case;
    failurePhase = 'fixture-execution';
    const bundle = options.case === 'row-s'
      ? createAnalyticalElbowRowSBundle()
      : createAsymmetricNonRingBundle();
    const receipt = {
      ...bundle,
      execution: {
        requestedRoute: ROUTE,
        effectiveRoute: ROUTE,
        fallbackUsed: false,
        innerRequestedRoute: bundle.report.requestedRoute,
        innerEffectiveRoute: bundle.report.effectiveRoute,
      },
    };
    await writeJsonAtomically(outputPath, receipt);
    return receipt;
  } catch (error) {
    if (outputPath) {
      await writeJsonAtomically(outputPath, {
        schema: ANALYTICAL_ELBOW_CAGE_PREFLIGHT_BUNDLE_SCHEMA,
        status: 'failed',
        case: requestedCase,
        requestedRoute: ROUTE,
        effectiveRoute: null,
        fallbackUsed: false,
        failurePhase,
        lastTrustworthyEvidence: outputPath
          ? 'caller output path parsed'
          : null,
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
  runAnalyticalElbowCagePreflightCli(process.argv.slice(2)).then(bundle => {
    console.log(JSON.stringify({
      status: bundle.status,
      case: bundle.case,
      preflightStatus: bundle.report.status,
      failurePhase: bundle.report.failurePhase,
    }));
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
