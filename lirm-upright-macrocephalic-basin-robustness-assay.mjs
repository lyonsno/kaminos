#!/usr/bin/env node
import { resolve } from 'node:path';

import { runCrawlerBasinMatrix } from './lirm-crawler-basin-robustness-core.mjs';
import { UPRIGHT_MACROCEPHALIC_ARMATURE_PROGRAM } from './lirm-upright-macrocephalic-armature-program.mjs';

const repoRoot = resolve(import.meta.dirname);
const defaults = {
  repoRoot,
  manifestPath: resolve(repoRoot, 'artifacts/lirm-upright-macrocephalic-basin-robustness-assay-v1/manifest.json'),
  outDir: resolve(repoRoot, 'artifacts/lirm-upright-macrocephalic-basin-robustness-assay-v1'),
  armatureProgram: UPRIGHT_MACROCEPHALIC_ARMATURE_PROGRAM,
};

function readArgs(argv) {
  const options = { ...defaults };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]; const value = argv[index + 1];
    if (flag === '--repo-root') { options.repoRoot = resolve(value); index += 1; }
    else if (flag === '--manifest') { options.manifestPath = resolve(value); index += 1; }
    else if (flag === '--out') { options.outDir = resolve(value); index += 1; }
    else throw new Error(`unknown argument: ${flag}`);
  }
  return options;
}

const report = await runCrawlerBasinMatrix(readArgs(process.argv.slice(2)));
console.log(JSON.stringify({
  status: report.status,
  familyId: report.manifest.familyId,
  acceptance: report.acceptance,
  rows: report.rows.map(row => ({
    donorId: row.donorId,
    outcome: row.outcome,
    silhouetteImprovementCount: row.subreport?.acceptance?.heldOutSilhouetteImprovementCount ?? null,
    heldOutDepthImproved: row.subreport?.acceptance?.heldOutDepthImproved ?? null,
  })),
  comparisonWitness: report.outputInventory.comparisonWitness,
  timing: report.timing,
}, null, 2));
