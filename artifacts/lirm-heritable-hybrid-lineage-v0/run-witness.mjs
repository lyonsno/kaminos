import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  writeHeritableHybridLineageControlSheet,
  writeHeritableHybridLineageWitness,
} from './assay-contract.mjs';

const outDir = new URL('.', import.meta.url).pathname;
try {
  const witness = await writeHeritableHybridLineageWitness({ outDir });
  const sheet = await writeHeritableHybridLineageControlSheet({ outDir });
  process.stdout.write(`${JSON.stringify({
    status: witness.status,
    candidateCount: witness.outputs.length,
    controlSheet: sheet.contactSheet,
  }, null, 2)}\n`);
} catch (error) {
  await writeFile(join(outDir, 'runner-failure.json'), `${JSON.stringify({
    schema: 'kaminos.lirm-heritable-hybrid-lineage-runner-failure.v0',
    status: 'failed',
    failurePhase: 'witness-or-sheet-runner',
    errorMessage: error.message,
    lastTrustworthyEvidence: 'assay contract owns any receipt written before runner failure',
  }, null, 2)}\n`);
  throw error;
}
