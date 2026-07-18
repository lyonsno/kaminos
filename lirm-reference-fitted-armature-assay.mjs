#!/usr/bin/env node
import { resolve } from 'node:path';

import { runReferenceFittedArmatureAssay } from './lirm-reference-fitted-armature-core.mjs';

const root = resolve(import.meta.dirname);
const defaults = {
  donorPath: resolve(root, 'artifacts/lirm-speciation-armature-gestalt-composite-assay-v0/trellis/glbs/lirm-armature-22__basin-22-s1p50-n00-p046-lineage-seed-seed717046.glb'),
  outDir: resolve(root, 'artifacts/lirm-reference-fitted-armature-assay-v0'),
  width: 40,
  height: 32,
  passes: 4,
};

function readArgs(argv) {
  const options = { ...defaults };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--donor') { options.donorPath = resolve(value); index += 1; }
    else if (flag === '--out') { options.outDir = resolve(value); index += 1; }
    else if (flag === '--width') { options.width = Number(value); index += 1; }
    else if (flag === '--height') { options.height = Number(value); index += 1; }
    else if (flag === '--passes') { options.passes = Number(value); index += 1; }
    else throw new Error(`unknown argument: ${flag}`);
  }
  for (const key of ['width', 'height', 'passes']) {
    if (!Number.isInteger(options[key]) || options[key] <= 0) throw new Error(`${key} must be a positive integer`);
  }
  return options;
}

const report = await runReferenceFittedArmatureAssay(readArgs(process.argv.slice(2)));
console.log(JSON.stringify({
  status: report.status,
  donor: report.donor,
  acceptance: report.acceptance,
  outputInventory: report.outputInventory,
}, null, 2));
