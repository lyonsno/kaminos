import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runArchHistoryAssay } from './structural-material-arch-depth-assay.mjs';

const route = {
  requested: 'local Node.js CPU experiment',
  effective: 'local Node.js CPU / shear-regularized linear-spring PCG',
  fallback: false,
  node: process.version,
};

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function runArchHistoryAssayCli(sourceArgument, outputArgument) {
  if (!sourceArgument || !outputArgument) {
    throw new Error('usage: node structural-material-arch-history-assay.mjs <source.glb> <output.json>');
  }
  const sourcePath = resolve(process.cwd(), sourceArgument);
  const outputPath = resolve(process.cwd(), outputArgument);
  let report = {
    schema: 'kaminos.structural-material.arch-matched-history.v0',
    status: 'running',
    phase: 'preflight',
    route,
    source: { path: sourcePath },
    outputPath,
    lastTrustworthyEvidence: `source path ${sourcePath} and output path ${outputPath} accepted; source not yet read`,
  };
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  try {
    report.phase = 'read-source-and-run-matched-history';
    const sourceBytes = readFileSync(sourcePath);
    report.lastTrustworthyEvidence = `source read (${sourceBytes.length} bytes; sha256 ${sha256(sourceBytes)}); matched-history assay not yet complete`;
    report = { ...runArchHistoryAssay(sourcePath), outputPath };
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    return report;
  } catch (error) {
    report = {
      ...report,
      status: 'failed',
      phase: report.phase,
      error: { name: error.name, message: error.message },
    };
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    throw error;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [sourceArgument, outputArgument] = process.argv.slice(2);
  try {
    const report = runArchHistoryAssayCli(sourceArgument, outputArgument);
    process.stdout.write(`${JSON.stringify({
      status: report.status,
      outputPath: report.outputPath,
      eventCount: report.priorTransition.eventCount,
      relativeTravelDelta: report.matchedLaterLoad.relativeTravelDelta,
      unloadPeakDisplacement: report.unloaded.damaged.peakDisplacement,
    })}\n`);
  } catch (error) {
    process.stderr.write(`arch matched-history assay failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
