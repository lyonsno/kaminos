import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { writeRareGestaltPressureWitness } from './assay-contract.mjs';

const outDir = new URL('.', import.meta.url).pathname;
try {
  const result = await writeRareGestaltPressureWitness({ outDir });
  process.stdout.write(`${JSON.stringify({
    status: result.status,
    candidateCount: result.candidates.length,
    receiptPath: join(outDir, 'receipt.json'),
  }, null, 2)}\n`);
} catch (error) {
  const failurePath = join(outDir, 'runner-failure.json');
  await writeFile(failurePath, `${JSON.stringify({
    schema: 'kaminos.lirm-rare-gestalt-pressure-runner-failure.v0',
    status: 'failed',
    failurePhase: 'witness-runner',
    errorMessage: error.message,
    lastTrustworthyEvidence: 'assay contract owns any candidate-level receipt written before this failure',
  }, null, 2)}\n`);
  throw error;
}
