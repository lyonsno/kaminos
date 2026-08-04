#!/usr/bin/env node

import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createAnalyticalElbowConsumerExport,
  createAnalyticalElbowDescriptor,
} from './analytical-elbow-core.mjs';
import {
  COLLAR_ASSAY_SCHEMA,
  runShapeBearingCollarAssay,
} from './analytical-elbow-collar-assay-core.mjs';

function parseArguments(argv) {
  const options = { collarHalfWidths: [0, 0.24, 0.48, 0.72] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--output') {
      options.output = argv[++index];
      if (!options.output) throw new Error('collar assay --output requires a path');
    }
    else if (argument === '--collar-half-widths') {
      const value = argv[++index];
      if (!value) throw new Error('collar assay --collar-half-widths requires a value');
      options.collarHalfWidths = value.split(',').map(Number);
    } else throw new Error(`unknown collar assay argument ${argument}`);
  }
  if (!options.output) throw new Error('collar assay requires --output');
  return options;
}

function extractOutputPath(argv) {
  const outputIndex = argv.indexOf('--output');
  if (outputIndex < 0 || !argv[outputIndex + 1]) return null;
  return resolve(argv[outputIndex + 1]);
}

async function writeJsonAtomically(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryPath, path);
}

export async function runCollarAssayCli(argv) {
  let outputPath = extractOutputPath(argv);
  let requestedWidths = null;
  let failurePhase = 'argument-parsing';
  try {
    const options = parseArguments(argv);
    outputPath = resolve(options.output);
    requestedWidths = options.collarHalfWidths;
    failurePhase = 'assay-execution';
    const source = createAnalyticalElbowConsumerExport(
      createAnalyticalElbowDescriptor(),
      { flexionDegrees: [0, 35, 80] },
    );
    const report = runShapeBearingCollarAssay({
      source,
      collarHalfWidths: options.collarHalfWidths,
    });
    await writeJsonAtomically(outputPath, report);
    return report;
  } catch (error) {
    if (outputPath) {
      await writeJsonAtomically(outputPath, {
        schema: COLLAR_ASSAY_SCHEMA,
        status: 'failed',
        requestedRoute: 'analytical-elbow-graded-collar',
        effectiveRoute: null,
        requestedCollarHalfWidths: requestedWidths,
        failurePhase,
        lastTrustworthyEvidence: 'caller output path parsed',
        error: error.message,
      });
    }
    throw error;
  }
}

const isMain = process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  runCollarAssayCli(process.argv.slice(2)).then(report => {
    console.log(JSON.stringify({
      status: report.status,
      disposition: report.disposition,
      survivingWidths: report.survivingWidths,
    }));
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
