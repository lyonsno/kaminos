#!/usr/bin/env node

import { resolve } from 'node:path';

import {
  writeMuscleCompartmentPackingSensitivityAssay,
} from '../muscle-compartment-packing-sensitivity.mjs';

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') return { help:true };
    if (!['--source', '--request', '--out', '--report'].includes(flag)) {
      throw new Error(`unknown argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a path`);
    values.set(flag.slice(2), value);
    index += 1;
  }
  for (const key of ['source', 'request', 'out', 'report']) {
    if (!values.has(key)) throw new Error(`--${key} is required`);
  }
  return values;
}

function usage() {
  return [
    'Usage:',
    '  node tools/run-muscle-compartment-packing-sensitivity.mjs \\',
    '    --source <authenticated-source.json> \\',
    '    --request <assay-request.json> \\',
    '    --out <visual-artifact-root> \\',
    '    --report <terminal-report.json>',
  ].join('\n');
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const written = await writeMuscleCompartmentPackingSensitivityAssay({
    sourcePath:args.get('source'),
    requestPath:args.get('request'),
    outDir:args.get('out'),
    reportPath:args.get('report'),
  });
  process.stdout.write(`${JSON.stringify({
    status:written.report.status,
    route:written.report.route,
    run:written.report.run,
    source:written.report.input.source,
    variants:written.report.variants.map(variant => ({
      id:variant.id,
      axis:variant.derivation.axis,
      solveStatus:variant.solve.status,
      visual:variant.visual,
      artifacts:variant.artifacts,
    })),
    outputRoot:written.outputRoot,
    reportPath:written.reportPath,
  }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  if (error.failureReportPath) {
    process.stderr.write(`failure report: ${resolve(error.failureReportPath)}\n`);
  }
  process.exitCode = 1;
});
