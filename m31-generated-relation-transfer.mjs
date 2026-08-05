#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createM31GeneratedRelationTransfer } from './m31-generated-relation-transfer-core.mjs';

function parseArguments(argv) {
  const options = { sourceFixture: null, output: null, crossoverAngleDegrees: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--source-fixture') {
      options.sourceFixture = argv[++index];
      if (!options.sourceFixture) throw new Error('--source-fixture requires a path');
    } else if (argv[index] === '--output') {
      options.output = argv[++index];
      if (!options.output) throw new Error('--output requires a path');
    } else if (argv[index] === '--crossover-angle') {
      const angle = Number(argv[++index]);
      if (angle !== 35) throw new Error('only --crossover-angle 35 is admitted');
      options.crossoverAngleDegrees = angle;
    } else {
      throw new Error(`unknown transfer argument ${argv[index]}`);
    }
  }
  if (!options.sourceFixture) throw new Error('--source-fixture requires a path');
  if (!options.output) throw new Error('--output requires a path');
  return {
    sourceFixture: resolve(options.sourceFixture),
    output: resolve(options.output),
    crossoverAngleDegrees: options.crossoverAngleDegrees,
  };
}

async function writeJsonAtomically(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

export async function runM31GeneratedRelationTransferCli(argv) {
  const options = parseArguments(argv);
  let sourceFixture;
  try {
    sourceFixture = JSON.parse(await readFile(options.sourceFixture, 'utf8'));
  } catch (error) {
    const receipt = {
      schema: 'kaminos.m31-generated-relation-transfer.v0',
      status: 'M31_TRANSFER_FAILED',
      requestedRoute: null,
      effectiveRoute: null,
      fallbackUsed: false,
      failurePhase: 'source-fixture-read',
      lastTrustworthyEvidence: 'caller source-fixture and output paths parsed',
      primaryOutput: null,
      error: { code: 'source-fixture-unreadable', message: error.message },
    };
    await writeJsonAtomically(options.output, receipt);
    return receipt;
  }
  const receipt = createM31GeneratedRelationTransfer(sourceFixture,
    options.crossoverAngleDegrees === null
      ? {}
      : { crossoverAngleDegrees: options.crossoverAngleDegrees });
  await writeJsonAtomically(options.output, receipt);
  return receipt;
}

const isMain = process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  runM31GeneratedRelationTransferCli(process.argv.slice(2)).then(receipt => {
    console.log(JSON.stringify({
      status: receipt.status,
      failurePhase: receipt.failurePhase,
      primaryOutput: receipt.primaryOutput,
    }));
    if (receipt.status !== 'M31_TRANSFER_COMPLETE') process.exitCode = 1;
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
