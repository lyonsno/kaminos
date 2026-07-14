#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  createPokeApiOfficialArtworkManifest,
  fetchDigiApiArtworkManifest,
} from './lirm-silhouette-source-manifest-core.js';

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
const provider = args.get('--provider') || 'pokeapi-official-artwork';
const outPath = args.get('--out');
if (!outPath) throw new Error('usage: lirm-silhouette-source-manifest.mjs --out <manifest.json> [--provider pokeapi-official-artwork|digi-api-artwork]');
if (!['pokeapi-official-artwork', 'digi-api-artwork'].includes(provider)) throw new Error(`unsupported provider: ${provider}`);

const retrievedAt = args.get('--retrieved-at') || new Date().toISOString();
const manifest = provider === 'digi-api-artwork'
  ? await fetchDigiApiArtworkManifest({
      endpoint: args.get('--endpoint') || 'https://digi-api.com/api/v1/digimon',
      pageSize: Number(args.get('--page-size') || 250),
      colorDistanceThreshold: Number(args.get('--color-distance-threshold') || 24),
      retrievedAt,
    })
  : createPokeApiOfficialArtworkManifest({
      startId: Number(args.get('--start-id') || 1),
      endId: Number(args.get('--end-id') || 1025),
      retrievedAt,
    });
const absolutePath = resolve(outPath);
await mkdir(dirname(absolutePath), { recursive: true });
await writeFile(absolutePath, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ status: 'complete', output: absolutePath, sourceCount: manifest.sourceCount, providerRoute: manifest.providerRoute })}\n`);
