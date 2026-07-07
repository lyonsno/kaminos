#!/usr/bin/env node

import { writeLirmSpeciationArmatureWitness } from './lirm-speciation-armature-core.js';

function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args.set(token, '1');
    } else {
      args.set(token, next);
      i += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const outDir = args.get('--out-dir') || args.get('--out') || 'artifacts/lirm-speciation-armature-witness-v0';
const seed = args.get('--seed') || 'molten-lirm-seed-0707';
const candidateCount = Number(args.get('--candidate-count') || 25);
const columns = Number(args.get('--columns') || 5);

const result = await writeLirmSpeciationArmatureWitness({
  outDir,
  seed,
  candidateCount,
  columns,
});

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
