#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

import {
  admitMuscleCompartmentPackingSensitivityVisualInspection,
} from '../muscle-compartment-packing-sensitivity.mjs';

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') return { help:true };
    if (!['--out', '--report', '--inspection', '--receipt'].includes(flag)) {
      throw new Error(`unknown argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a path`);
    values.set(flag.slice(2), value);
    index += 1;
  }
  for (const key of ['out', 'report', 'inspection', 'receipt']) {
    if (!values.has(key)) throw new Error(`--${key} is required`);
  }
  return values;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      'Usage: node tools/admit-muscle-compartment-packing-sensitivity-visual.mjs ' +
      '--out <visual-root> --report <assay-report.json> ' +
      '--inspection <inspection.json> --receipt <receipt.json>\n',
    );
    return;
  }
  const inspection = JSON.parse(await readFile(args.get('inspection'), 'utf8'));
  const admitted = await admitMuscleCompartmentPackingSensitivityVisualInspection({
    outDir:args.get('out'),
    reportPath:args.get('report'),
    receiptPath:args.get('receipt'),
    inspection,
  });
  process.stdout.write(`${JSON.stringify({
    status:admitted.report.visualInspection.status,
    runId:admitted.receipt.bindings.runId,
    variants:admitted.receipt.variants.map(variant => ({
      id:variant.id,
      solveStatus:variant.solveStatus,
      images:variant.images.map(image => ({
        state:image.state,
        sha256:image.sha256,
        route:image.capture.route,
      })),
    })),
    reportPath:admitted.reportPath,
    receiptPath:admitted.receiptPath,
  }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
