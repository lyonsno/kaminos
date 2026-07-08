#!/usr/bin/env node

import { writeLirmSpeciationArmatureConditioningPackages } from './lirm-speciation-armature-core.js';

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
const outDir = args.get('--out-dir') || args.get('--out') || 'artifacts/lirm-speciation-armature-conditioning-packages-v0';
const seed = args.get('--seed') || 'molten-lirm-seed-0707';
const candidateIds = (args.get('--candidate-ids') || 'lirm-armature-08,lirm-armature-11,lirm-armature-16,lirm-armature-22,lirm-armature-24')
  .split(',')
  .map(item => item.trim())
  .filter(Boolean);

const result = await writeLirmSpeciationArmatureConditioningPackages({
  outDir,
  seed,
  candidateIds,
});

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
