#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  OVERLAPPING_TISSUE_ARTIFACT_ROUTE,
  writeOverlappingAnisotropicTissueControlArtifacts,
} from '../row-distinct-field-assay-artifacts.mjs';

function options(argv) {
  const allowed = new Set([
    '--out', '--overlap-card', '--overlap-target', '--descriptor',
    '--frozen-sweep-card', '--frozen-card', '--frozen-target', '--route',
  ]);
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
  const fallbackOut = 'artifacts/overlapping-anisotropic-tissue-control-v0';
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
    requestedRouteId = args.get('--route') ?? OVERLAPPING_TISSUE_ARTIFACT_ROUTE;
    phase = 'input-read';
    const requestedOverlapCardPath = args.get('--overlap-card')
      ?? 'fixtures/analytical-tissue/overlapping-anisotropic-tissue-control-assay.v0.json';
    const requestedTargetPath = args.get('--overlap-target')
      ?? 'fixtures/analytical-tissue/overlapping-hindquarter-tissue-target.v0.json';
    const requestedDescriptorPath = args.get('--descriptor')
      ?? 'fixtures/analytical-tissue/overlapping-anisotropic-tissue-descriptor.v0.json';
    const [
      overlapCard,
      overlapTarget,
      descriptor,
      frozenSweepCard,
      frozenAssayCard,
      frozenTarget,
    ] = await Promise.all([
      readJson(requestedOverlapCardPath),
      readJson(requestedTargetPath),
      readJson(requestedDescriptorPath),
      readJson(args.get('--frozen-sweep-card')
        ?? 'fixtures/analytical-tissue/target-sdf-full-surface-sweep-assay.v0.json'),
      readJson(args.get('--frozen-card')
        ?? 'fixtures/analytical-tissue/row-distinct-scalar-anisotropic-assay.v0.json'),
      readJson(args.get('--frozen-target')
        ?? 'fixtures/analytical-tissue/row-distinct-hindquarter-target.v0.json'),
    ]);
    const result = await writeOverlappingAnisotropicTissueControlArtifacts({
      outDir,
      overlapCard,
      overlapTarget,
      descriptor,
      frozenSweepCard,
      frozenAssayCard,
      frozenTarget,
      requestedOverlapCardPath,
      requestedTargetPath,
      requestedDescriptorPath,
      requestedRouteId,
    });
    process.stdout.write(`${JSON.stringify({
      status: result.report.status,
      assayHash: result.assay.assayHash,
      evidencePassed: result.assay.evidenceVerdict.passed,
      hypothesisPassed: result.assay.hypothesisVerdict.passed,
      hypothesisFailures: result.assay.hypothesisVerdict.failures,
      reportPath: result.reportPath,
      effectiveRouteId: result.report.effectiveRouteId,
      effectiveCompilerId: result.report.effectiveCompilerId,
      effectiveExtractorId: result.report.effectiveExtractorId,
      outputCount: result.report.outputs.length,
    })}\n`);
  } catch (error) {
    if (phase === 'cli-parse' || phase === 'input-read') {
      await writeFile(join(outDir, 'report.json'), `${JSON.stringify({
        schema: 'kaminos.overlapping-anisotropic-tissue-control-run-report.v0',
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
