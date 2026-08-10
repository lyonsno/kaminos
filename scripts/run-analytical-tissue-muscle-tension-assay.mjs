#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { writeAnalyticalTissueMuscleTensionArtifacts } from '../analytical-tissue-geometry-core.mjs';

function optionValue(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  if (index === argv.length - 1 || argv[index + 1].startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return argv[index + 1];
}

async function main(argv) {
  const defaultOutDir = 'artifacts/analytical-tissue-muscle-tension-v0';
  const outIndex = argv.indexOf('--out');
  const recoverableOutValue = outIndex >= 0 && argv[outIndex + 1]
    && !argv[outIndex + 1].startsWith('--')
    ? argv[outIndex + 1]
    : defaultOutDir;
  const outDir = resolve(recoverableOutValue);
  await mkdir(outDir, { recursive: true });

  let phase = 'cli-parse';
  let descriptorPath;
  let rowPlanPath;
  let requestedRouteId;
  try {
    const knownOptions = new Set(['--out', '--descriptor', '--row-plan', '--route']);
    for (let index = 0; index < argv.length; index += 1) {
      const token = argv[index];
      if (!knownOptions.has(token)) throw new Error(`unknown option: ${token}`);
      if (index === argv.length - 1 || argv[index + 1].startsWith('--')) {
        throw new Error(`${token} requires a value`);
      }
      index += 1;
    }
    descriptorPath = resolve(optionValue(
      argv,
      '--descriptor',
      'fixtures/analytical-tissue/synthetic-hindquarter-neutral.v0.json',
    ));
    rowPlanPath = resolve(optionValue(
      argv,
      '--row-plan',
      'fixtures/analytical-tissue/factored-row-plan.v0.json',
    ));
    requestedRouteId = optionValue(
      argv,
      '--route',
      'synthetic-hindquarter-analytic-profile-mesh-v0',
    );

    phase = 'input-read';
    const [descriptor, rowPlan] = await Promise.all([
      readFile(descriptorPath, 'utf8').then(JSON.parse),
      readFile(rowPlanPath, 'utf8').then(JSON.parse),
    ]);
    const result = await writeAnalyticalTissueMuscleTensionArtifacts({
      outDir,
      descriptor,
      rowPlan,
      requestedRouteId,
    });

    process.stdout.write(`${JSON.stringify({
      status: result.report.status,
      assayHash: result.assay.assayHash,
      reportPath: result.reportPath,
      effectiveRouteId: result.report.effectiveRouteId,
      outputCount: result.report.outputs.length,
    })}\n`);
  } catch (error) {
    if (phase === 'cli-parse' || phase === 'input-read') {
      const report = {
        schema: 'kaminos.analytical-tissue-geometry-run-report.v0',
        status: 'failed',
        failurePhase: phase,
        error: error instanceof Error ? error.message : String(error),
        requestedRouteId: requestedRouteId ?? null,
        effectiveRouteId: null,
        descriptorPath: descriptorPath ?? null,
        rowPlanPath: rowPlanPath ?? null,
        outputs: [],
        lastTrustworthyEvidence: 'output directory created; no assay artifact emitted',
      };
      await writeFile(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    }
    throw error;
  }
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
