#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeSmokeFieldTomographyWitness } from './smoke-gaussian-oracle-fitter.mjs';

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key.startsWith('--')) continue;
    if (value && !value.startsWith('--')) {
      args.set(key, value);
      index += 1;
    } else {
      args.set(key, true);
    }
  }
  return args;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const thresholds = String(args.get('--thresholds') || '0,0.001,0.01,0.05,0.1,0.25,0.5,1')
    .split(',')
    .map(value => Number(value.trim()));
  const report = await writeSmokeFieldTomographyWitness({
    manifestPath: args.get('--manifest'),
    expectedManifestSha256: args.get('--manifest-sha256'),
    outDir: args.get('--out-dir'),
    thresholds,
    cellScale: Number(args.get('--cell-scale') || 2),
  });
  console.log(JSON.stringify(report, null, 2));
}
