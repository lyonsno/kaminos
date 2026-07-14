#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { writeSilhouetteArchetypeCorpusWitness } from './lirm-silhouette-archetype-corpus-core.js';

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) args.set(token, '1');
    else {
      args.set(token, next);
      index += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const manifestPath = args.get('--manifest');
const outDir = args.get('--out-dir') || args.get('--out');
if (!manifestPath || !outDir) {
  throw new Error('usage: lirm-silhouette-archetype-corpus-witness.mjs --manifest <manifest.json> --out-dir <directory> [--target-size 128] [--padding 6] [--columns 6]');
}

const rawManifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8'));
const defaults = rawManifest.sourceDefaults || {};
const manifest = {
  ...rawManifest,
  sources: rawManifest.sources?.map(source => {
    const variables = { ...defaults, ...source };
    const expand = value => typeof value === 'string'
      ? value.replaceAll(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => String(variables[key] ?? `{${key}}`))
      : value;
    return {
      ...defaults,
      ...source,
      sourceUrl: expand(source.sourceUrl || defaults.sourceUrl),
      sourcePageUrl: expand(source.sourcePageUrl || defaults.sourcePageUrl),
    };
  }),
};
const result = await writeSilhouetteArchetypeCorpusWitness({
  manifest,
  outDir: resolve(outDir),
  targetSize: Number(args.get('--target-size') || 128),
  padding: Number(args.get('--padding') || 6),
  columns: Number(args.get('--columns') || 6),
});

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
