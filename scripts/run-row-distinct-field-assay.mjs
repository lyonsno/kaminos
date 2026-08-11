#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  ROW_DISTINCT_ARTIFACT_ROUTE,
  writeRowDistinctAssayArtifacts,
} from '../row-distinct-field-assay-artifacts.mjs';

function options(argv) {
  const allowed = new Set(['--out', '--card', '--target', '--route']);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name)) throw new Error(`unknown option: ${name}`);
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
    values.set(name, value);
  }
  return values;
}

async function main(argv) {
  const fallbackOut = 'artifacts/row-distinct-scalar-anisotropic-v0';
  const recoverableOutIndex = argv.indexOf('--out');
  const recoverableOut = recoverableOutIndex >= 0 && argv[recoverableOutIndex + 1]
    && !argv[recoverableOutIndex + 1].startsWith('--')
    ? argv[recoverableOutIndex + 1]
    : fallbackOut;
  const outDir = resolve(recoverableOut);
  await mkdir(outDir, { recursive: true });
  let phase = 'cli-parse';
  let requestedRouteId = null;
  try {
    const args = options(argv);
    requestedRouteId = args.get('--route') ?? ROW_DISTINCT_ARTIFACT_ROUTE;
    phase = 'input-read';
    const [assayCard, target] = await Promise.all([
      readFile(resolve(args.get('--card')
        ?? 'fixtures/analytical-tissue/row-distinct-scalar-anisotropic-assay.v0.json'), 'utf8')
        .then(JSON.parse),
      readFile(resolve(args.get('--target')
        ?? 'fixtures/analytical-tissue/row-distinct-hindquarter-target.v0.json'), 'utf8')
        .then(JSON.parse),
    ]);
    const result = await writeRowDistinctAssayArtifacts({
      outDir,
      assayCard,
      target,
      requestedRouteId,
    });
    process.stdout.write(`${JSON.stringify({
      status: result.report.status,
      assayHash: result.assay.assayHash,
      admissionPassed: result.assay.verdict.passed,
      reportPath: result.reportPath,
      effectiveRouteId: result.report.effectiveRouteId,
      outputCount: result.report.outputs.length,
    })}\n`);
  } catch (error) {
    if (phase === 'cli-parse' || phase === 'input-read') {
      await writeFile(join(outDir, 'report.json'), `${JSON.stringify({
        schema: 'kaminos.row-distinct-field-assay-run-report.v0',
        status: 'failed',
        failurePhase: phase,
        requestedRouteId,
        effectiveRouteId: null,
        outputs: [],
        error: error instanceof Error ? error.message : String(error),
        lastTrustworthyEvidence: 'output directory and failure report only; no primary artifact accepted',
      }, null, 2)}\n`, 'utf8');
    }
    throw error;
  }
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
