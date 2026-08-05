#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const RUN_REPORT_SCHEMA =
  'kaminos.current-k4-ring-cage-anisotropy-assay-run-report.v0';
const ASSAY_RESULT_SCHEMA =
  'kaminos.current-k4-ring-cage-anisotropy-assay-result.v0';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function finalizeCurrentK4RingCageAnisotropyVisualDisposition({
  runReport,
  assayResult,
  verification,
  inspection,
  verificationSha256,
  inspectionSha256,
}) {
  if (runReport?.schema !== RUN_REPORT_SCHEMA || runReport.status !== 'completed' ||
      assayResult?.schema !== ASSAY_RESULT_SCHEMA || assayResult.status !== 'completed') {
    throw new Error('anisotropy visual finalization requires completed primary artifacts');
  }
  if (verification?.status !== 'verified') {
    throw new Error('anisotropy visual finalization requires verified capture receipts');
  }
  if (!inspection?.status?.startsWith('agent-inspected-') ||
      typeof inspection.visualDisposition !== 'string') {
    throw new Error('anisotropy visual finalization requires an explicit agent disposition');
  }
  if (!/^[0-9a-f]{64}$/.test(verificationSha256) ||
      !/^[0-9a-f]{64}$/.test(inspectionSha256)) {
    throw new Error('anisotropy visual finalization requires content hashes');
  }
  const bundle = runReport.visual?.bundleIdentity;
  if (!bundle || verification.bundleIdentity?.sha256 !== bundle.sha256 ||
      inspection.bundleIdentitySha256 !== bundle.sha256) {
    throw new Error('anisotropy visual finalization bundle identity mismatch');
  }
  if (verification.residualLedger?.sha256 !== runReport.outputs?.residualLedger?.sha256 ||
      inspection.residualLedgerSha256 !== runReport.outputs?.residualLedger?.sha256) {
    throw new Error('anisotropy visual finalization residual ledger identity mismatch');
  }
  if (inspection.captureRouteVerificationSha256 !== verificationSha256) {
    throw new Error('anisotropy visual finalization route verification identity mismatch');
  }
  const verificationCaptures = verification.captures.map(capture => capture.sha256);
  const inspectionCaptures = inspection.captures.map(capture => capture.sha256);
  if (!equal(verificationCaptures, inspectionCaptures)) {
    throw new Error('anisotropy visual finalization capture identity mismatch');
  }
  if (!equal(runReport.visual.route, verification.witnessRoute) ||
      !equal(assayResult.visual?.route, verification.witnessRoute)) {
    throw new Error('anisotropy visual finalization witness route mismatch');
  }
  const visualDisposition = {
    status: inspection.status,
    inspection: {
      path: 'visual-inspection.json',
      sha256: inspectionSha256,
      disposition: inspection.visualDisposition,
    },
    routeVerification: {
      path: 'capture-route-verification.json',
      sha256: verificationSha256,
      status: verification.status,
    },
  };
  const finalizedAssayResult = structuredClone(assayResult);
  finalizedAssayResult.visual = {
    ...finalizedAssayResult.visual,
    ...visualDisposition,
  };
  finalizedAssayResult.visualDisposition = inspection.visualDisposition;
  const finalizedRunReport = structuredClone(runReport);
  finalizedRunReport.visual = {
    ...finalizedRunReport.visual,
    ...visualDisposition,
  };
  finalizedRunReport.visualDisposition = inspection.visualDisposition;
  finalizedRunReport.outputs = {
    ...finalizedRunReport.outputs,
    visualInspection: visualDisposition.inspection,
    routeVerification: visualDisposition.routeVerification,
  };
  finalizedRunReport.lastTrustworthyEvidence = {
    ...finalizedRunReport.lastTrustworthyEvidence,
    phase: 'visual-inspection-finalized',
    visualStatus: inspection.status,
    visualDisposition: inspection.visualDisposition,
    visualInspectionSha256: inspectionSha256,
    routeVerificationSha256: verificationSha256,
  };
  return { finalizedRunReport, finalizedAssayResult };
}

async function writeAtomic(target, bytes) {
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, bytes);
  await rename(temporary, target);
}

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== '--output' || !argv[1] || argv[1].startsWith('--')) {
    throw new Error('--output is required');
  }
  return path.resolve(argv[1]);
}

async function main() {
  const outputDirectory = parseArguments(process.argv.slice(2));
  const paths = {
    runReport: path.join(outputDirectory, 'run-report.json'),
    assayResult: path.join(outputDirectory, 'assay-result.json'),
    verification: path.join(outputDirectory, 'capture-route-verification.json'),
    inspection: path.join(outputDirectory, 'visual-inspection.json'),
  };
  const bytes = Object.fromEntries(await Promise.all(Object.entries(paths).map(
    async ([key, value]) => [key, await readFile(value)],
  )));
  const values = Object.fromEntries(Object.entries(bytes).map(
    ([key, value]) => [key, JSON.parse(value)],
  ));
  const finalized = finalizeCurrentK4RingCageAnisotropyVisualDisposition({
    ...values,
    verificationSha256: sha256(bytes.verification),
    inspectionSha256: sha256(bytes.inspection),
  });
  const assayResultBytes = jsonBytes(finalized.finalizedAssayResult);
  finalized.finalizedRunReport.outputs.assayResult.sha256 = sha256(assayResultBytes);
  await writeAtomic(paths.assayResult, assayResultBytes);
  await writeAtomic(paths.runReport, jsonBytes(finalized.finalizedRunReport));
  process.stdout.write(`${JSON.stringify({
    status: finalized.finalizedRunReport.visual.status,
    disposition: finalized.finalizedRunReport.visualDisposition,
    inspectionSha256: finalized.finalizedRunReport.visual.inspection.sha256,
    routeVerificationSha256:
      finalized.finalizedRunReport.visual.routeVerification.sha256,
  })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
