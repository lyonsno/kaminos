#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  EXPLICIT_RESPONSE_SHELL_ARTIFACT_ROUTE,
  writeExplicitResponseShellArtifacts,
  writeExplicitResponseShellFailureTombstones,
} from '../explicit-response-shell-assay-artifacts.mjs';

function options(argv) {
  const allowed = new Set(['--out', '--assay-card', '--target', '--route']);
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

async function readJson(path) {
  return readFile(resolve(path), 'utf8').then(JSON.parse);
}

async function main(argv) {
  const fallbackOut = 'artifacts/explicit-response-shell-v0';
  const outIndex = argv.indexOf('--out');
  const recoverableOut = outIndex >= 0 && argv[outIndex + 1]
    && !argv[outIndex + 1].startsWith('--')
    ? argv[outIndex + 1]
    : fallbackOut;
  const outDir = resolve(recoverableOut);
  await mkdir(outDir, { recursive: true });
  const generationId = randomUUID();
  let phase = 'cli-parse';
  let requestedRouteId = null;
  let requestedAssayCardPath = null;
  let requestedTargetPath = null;
  try {
    const args = options(argv);
    requestedRouteId = args.get('--route') ?? EXPLICIT_RESPONSE_SHELL_ARTIFACT_ROUTE;
    if (requestedRouteId !== EXPLICIT_RESPONSE_SHELL_ARTIFACT_ROUTE) {
      throw new Error(`requested route ${requestedRouteId} is unavailable`);
    }
    requestedAssayCardPath = args.get('--assay-card')
      ?? 'fixtures/analytical-tissue/explicit-response-shell-assay.v0.json';
    requestedTargetPath = args.get('--target')
      ?? 'fixtures/analytical-tissue/overlapping-hindquarter-tissue-target.v0.json';
    phase = 'input-read';
    const [assayCard, target] = await Promise.all([
      readJson(requestedAssayCardPath),
      readJson(requestedTargetPath),
    ]);
    const result = await writeExplicitResponseShellArtifacts({
      outDir,
      assayCard,
      target,
      requestedAssayCardPath,
      requestedTargetPath,
    });
    process.stdout.write(`${JSON.stringify({
      status: result.report.status,
      generationId: result.report.generationId,
      assayHash: result.assay.assayHash,
      evidencePassed: result.report.evidencePassed,
      hypothesisPassed: result.report.hypothesisPassed,
      effectiveRouteId: result.report.effectiveRouteId,
      effectiveCompilerId: result.report.effectiveCompilerId,
      outputCount: result.report.outputs.length,
      reportPath: result.reportPath,
    })}\n`);
  } catch (error) {
    if (phase === 'cli-parse' || phase === 'input-read') {
      await writeExplicitResponseShellFailureTombstones({
        outDir,
        generationId,
        failurePhase: phase,
        error,
        requestedRouteId,
        requestedAssayCardPath,
        requestedTargetPath,
      });
    }
    throw error;
  }
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
