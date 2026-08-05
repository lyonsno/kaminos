#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const AMPLITUDE_FRONTIER_SCHEMA =
  'kaminos.current-k4-ring-cage-longitudinal-volume-amplitude-frontier-result.v0';
const AMPLITUDE_FRONTIER_REPORT_SCHEMA =
  'kaminos.current-k4-ring-cage-longitudinal-volume-amplitude-frontier-run-report.v0';
const RAMP_FRONTIER_SCHEMA =
  'kaminos.current-k4-ring-cage-longitudinal-volume-ramp-frontier-result.v0';
const RAMP_FRONTIER_REPORT_SCHEMA =
  'kaminos.current-k4-ring-cage-longitudinal-volume-ramp-frontier-run-report.v0';
const MANIFEST_SCHEMA =
  'kaminos.current-k4-ring-cage-longitudinal-volume-frontier-visual-manifest.v0';
const VISUAL_REPORT_SCHEMA =
  'kaminos.current-k4-ring-cage-longitudinal-volume-frontier-visual-run-report.v0';
const INSPECTION_SCHEMA =
  'kaminos.current-k4-longitudinal-volume-frontier-visual-inspection.v0';
const VERIFICATION_SCHEMA =
  'kaminos.current-k4-longitudinal-volume-frontier-capture-verification.v0';
const FINALIZATION_SCHEMA =
  'kaminos.current-k4-longitudinal-volume-frontier-finalization-report.v0';
const RESULT_STATUS_BY_FRONTIER_SCHEMA = Object.freeze({
  [AMPLITUDE_FRONTIER_SCHEMA]:
    'single-section-amplitude-frontier-rejected-visually-subtle-adjacency-bound',
  [RAMP_FRONTIER_SCHEMA]:
    'smooth-ramp-frontier-retained-scalar-advance-no-visual-selection',
});
const REPORT_SCHEMA_BY_FRONTIER_SCHEMA = Object.freeze({
  [AMPLITUDE_FRONTIER_SCHEMA]: AMPLITUDE_FRONTIER_REPORT_SCHEMA,
  [RAMP_FRONTIER_SCHEMA]: RAMP_FRONTIER_REPORT_SCHEMA,
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function writeAtomic(target, bytes) {
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, bytes);
  await rename(temporary, target);
}

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== '--output' ||
      !argv[1] || argv[1].startsWith('--')) {
    throw new Error('--output is required');
  }
  return path.resolve(argv[1]);
}

function requireCompleteCapture(report, label) {
  if (report?.browser?.effective?.installedStableChrome === true) {
    throw new Error(`${label} used forbidden stable Chrome`);
  }
  if (report?.status !== 'complete' ||
      report.route?.requested !== 'independent-headless-screenshot-v0' ||
      report.route?.effective !== 'independent-headless-screenshot-v0' ||
      report.route?.fallbackUsed !== false ||
      report.browser?.effective?.installedStableChrome !== false ||
      report.process?.cleanup?.status !== 'complete-no-process-group-remains' ||
      report.process?.cleanup?.groupPresentAfter !== false ||
      report.process?.profileCleanup?.status !== 'complete-removed' ||
      !/^[0-9a-f]{64}$/.test(report.primaryOutput?.sha256 || '')) {
    throw new Error(`${label} is not a complete independent capture receipt`);
  }
  if (/Uncaught|SyntaxError|ReferenceError|TypeError|identity-bound capture route mismatch/i
    .test(report.stderr?.tail || '')) {
    throw new Error(`${label} contains a browser execution failure`);
  }
}

function manifestIdentityHash(identity) {
  const { sha256: _recorded, ...domain } = identity || {};
  return sha256(Buffer.from(JSON.stringify(domain)));
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function main() {
  const outputDirectory = parseArguments(process.argv.slice(2));
  const visualDirectory = path.join(outputDirectory, 'visual');
  const paths = {
    frontier: path.join(outputDirectory, 'frontier-result.json'),
    frontierReport: path.join(outputDirectory, 'run-report.json'),
    manifest: path.join(visualDirectory, 'visual-manifest.json'),
    visualReport: path.join(visualDirectory, 'run-report.json'),
    inspection: path.join(visualDirectory, 'visual-inspection.json'),
    contactSheetReport: path.join(visualDirectory, 'contact-sheet-capture-report.json'),
    contactSheetImage: path.join(visualDirectory, 'contact-sheet.png'),
    verification: path.join(visualDirectory, 'capture-route-verification.json'),
    finalization: path.join(visualDirectory, 'visual-finalization-report.json'),
  };
  let phase = 'read-primary-inputs';
  try {
    const bytes = Object.fromEntries(await Promise.all([
      'frontier', 'frontierReport', 'manifest', 'visualReport', 'inspection',
      'contactSheetReport', 'contactSheetImage',
    ].map(async key => [key, await readFile(paths[key])])));
    const values = Object.fromEntries([
      'frontier', 'frontierReport', 'manifest', 'visualReport', 'inspection',
      'contactSheetReport',
    ].map(key => [key, JSON.parse(bytes[key])]));
    const { frontier, frontierReport, manifest, visualReport, inspection } = values;
    phase = 'verify-primary-custody';
    const finalResultStatus = RESULT_STATUS_BY_FRONTIER_SCHEMA[frontier?.schema];
    if (!finalResultStatus || frontier.status !== 'completed' ||
        frontierReport?.schema !== REPORT_SCHEMA_BY_FRONTIER_SCHEMA[frontier.schema] ||
        frontierReport.status !== 'completed' ||
        manifest?.schema !== MANIFEST_SCHEMA ||
        visualReport?.schema !== VISUAL_REPORT_SCHEMA ||
        visualReport.status !== 'completed' ||
        inspection?.schema !== INSPECTION_SCHEMA ||
        !inspection.status?.startsWith('agent-inspected-') ||
        typeof inspection.visualDisposition !== 'string') {
      throw new Error('frontier finalization requires completed primary and inspection schemas');
    }
    if (manifest.identity?.sha256 !== manifestIdentityHash(manifest.identity) ||
        manifest.identity.sha256 !== inspection.manifestIdentitySha256 ||
        sha256(bytes.manifest) !== inspection.manifestFileSha256 ||
        visualReport.outputs?.visualManifest?.sha256 !== sha256(bytes.manifest) ||
        visualReport.inputs?.frontier?.sha256 !== inspection.frontierResultSha256) {
      throw new Error('frontier finalization manifest or source-frontier identity mismatch');
    }
    const alreadyFinalized = frontier.resultStatus === finalResultStatus;
    if (alreadyFinalized) {
      if (frontier.visual?.finalization?.originalFrontierSha256 !==
          inspection.frontierResultSha256 ||
          frontier.visual?.inspection?.sha256 !== sha256(bytes.inspection)) {
        throw new Error('frontier finalization existing disposition identity mismatch');
      }
    } else if (sha256(bytes.frontier) !== inspection.frontierResultSha256 ||
        frontierReport.outputs?.frontierResult?.sha256 !== inspection.frontierResultSha256) {
      throw new Error('frontier finalization source primary identity mismatch');
    }
    if (!equal(manifest.candidateIds, frontier.visual.candidateIds) ||
        !equal(inspection.decision?.retainedNondominatedCandidateIds,
          frontier.nondominatedCandidateIds)) {
      throw new Error('frontier finalization candidate set mismatch');
    }

    phase = 'verify-capture-receipts';
    const captures = [];
    for (const expected of manifest.captureUrls) {
      const capturePath = path.join(visualDirectory, expected.report);
      const imagePath = path.join(visualDirectory, expected.output);
      const [captureBytes, imageBytes] = await Promise.all([
        readFile(capturePath),
        readFile(imagePath),
      ]);
      const capture = JSON.parse(captureBytes);
      requireCompleteCapture(capture, `capture ${expected.id}`);
      const inspected = inspection.captures.find(row => row.id === expected.id);
      if (!inspected || inspected.reportSha256 !== sha256(captureBytes) ||
          inspected.sha256 !== sha256(imageBytes) ||
          capture.primaryOutput.sha256 !== inspected.sha256 ||
          !capture.invocation?.url?.endsWith(expected.url) ||
          capture.primaryOutput.png?.width !== 1400 ||
          capture.primaryOutput.png?.height !== 900) {
        throw new Error(`capture ${expected.id} identity, URL, or dimensions mismatch`);
      }
      captures.push({
        id: expected.id,
        state: expected.state,
        url: expected.url,
        report: { path: expected.report, sha256: inspected.reportSha256 },
        primaryOutput: {
          path: expected.output,
          sha256: inspected.sha256,
          sizeBytes: capture.primaryOutput.sizeBytes,
          png: capture.primaryOutput.png,
        },
        browser: capture.browser.effective,
        route: capture.route,
        cleanup: capture.process.cleanup,
      });
    }
    if (new Set(captures.map(row => row.primaryOutput.sha256)).size !== captures.length) {
      throw new Error('frontier captures are not pixel-distinct');
    }
    const contactSheetReport = values.contactSheetReport;
    requireCompleteCapture(contactSheetReport, 'contact sheet capture');
    if (inspection.contactSheet.reportSha256 !== sha256(bytes.contactSheetReport) ||
        inspection.contactSheet.sha256 !== sha256(bytes.contactSheetImage) ||
        contactSheetReport.primaryOutput.sha256 !== inspection.contactSheet.sha256 ||
        contactSheetReport.primaryOutput.png?.width !== inspection.contactSheet.viewport.width ||
        contactSheetReport.primaryOutput.png?.height !== inspection.contactSheet.viewport.height ||
        !contactSheetReport.invocation?.url?.includes('/visual/contact-sheet.html')) {
      throw new Error('contact sheet capture identity or dimensions mismatch');
    }
    const verification = {
      schema: VERIFICATION_SCHEMA,
      status: 'verified',
      manifest: {
        identitySha256: manifest.identity.sha256,
        fileSha256: sha256(bytes.manifest),
      },
      frontier: { originalSha256: inspection.frontierResultSha256 },
      witnessRoute: manifest.route,
      focus: manifest.focus,
      captures,
      contactSheet: {
        report: {
          path: 'contact-sheet-capture-report.json',
          sha256: inspection.contactSheet.reportSha256,
        },
        primaryOutput: {
          path: 'contact-sheet.png',
          sha256: inspection.contactSheet.sha256,
          sizeBytes: contactSheetReport.primaryOutput.sizeBytes,
          png: contactSheetReport.primaryOutput.png,
        },
        browser: contactSheetReport.browser.effective,
        route: contactSheetReport.route,
        cleanup: contactSheetReport.process.cleanup,
      },
    };
    const verificationBytes = jsonBytes(verification);
    const verificationSha256 = sha256(verificationBytes);
    const inspectionSha256 = sha256(bytes.inspection);
    const finalizedFrontier = structuredClone(frontier);
    finalizedFrontier.resultStatus = finalResultStatus;
    finalizedFrontier.visual = {
      ...finalizedFrontier.visual,
      status: inspection.status,
      disposition: inspection.visualDisposition,
      decision: inspection.decision,
      inspection: {
        path: 'visual/visual-inspection.json',
        sha256: inspectionSha256,
      },
      routeVerification: {
        path: 'visual/capture-route-verification.json',
        sha256: verificationSha256,
        status: verification.status,
      },
      contactSheet: verification.contactSheet.primaryOutput,
      finalization: {
        originalFrontierSha256: inspection.frontierResultSha256,
        manifestIdentitySha256: manifest.identity.sha256,
      },
    };
    const finalizedFrontierBytes = jsonBytes(finalizedFrontier);
    const finalizedReport = structuredClone(frontierReport);
    finalizedReport.resultStatus = finalResultStatus;
    finalizedReport.visual = finalizedFrontier.visual;
    finalizedReport.outputs = {
      ...finalizedReport.outputs,
      frontierResult: {
        path: 'frontier-result.json',
        sha256: sha256(finalizedFrontierBytes),
      },
      visualInspection: finalizedFrontier.visual.inspection,
      captureRouteVerification: finalizedFrontier.visual.routeVerification,
      contactSheet: finalizedFrontier.visual.contactSheet,
    };
    finalizedReport.lastTrustworthyEvidence = {
      phase: 'visual-frontier-finalized',
      resultStatus: finalResultStatus,
      visualStatus: inspection.status,
      visualDisposition: inspection.visualDisposition,
      originalFrontierSha256: inspection.frontierResultSha256,
      finalizedFrontierSha256: finalizedReport.outputs.frontierResult.sha256,
      visualInspectionSha256: inspectionSha256,
      captureRouteVerificationSha256: verificationSha256,
    };
    const finalizedReportBytes = jsonBytes(finalizedReport);
    const finalization = {
      schema: FINALIZATION_SCHEMA,
      status: 'completed',
      failurePhase: null,
      resultStatus: finalResultStatus,
      visualStatus: inspection.status,
      visualDisposition: inspection.visualDisposition,
      outputs: {
        frontierResult: {
          path: '../frontier-result.json',
          sha256: sha256(finalizedFrontierBytes),
        },
        frontierRunReport: {
          path: '../run-report.json',
          sha256: sha256(finalizedReportBytes),
        },
        captureRouteVerification: {
          path: 'capture-route-verification.json',
          sha256: verificationSha256,
        },
        visualInspection: {
          path: 'visual-inspection.json',
          sha256: inspectionSha256,
        },
      },
      lastTrustworthyEvidence: finalizedReport.lastTrustworthyEvidence,
    };
    phase = 'write-finalized-artifacts';
    await writeAtomic(paths.verification, verificationBytes);
    await writeAtomic(paths.frontier, finalizedFrontierBytes);
    await writeAtomic(paths.frontierReport, finalizedReportBytes);
    await writeAtomic(paths.finalization, jsonBytes(finalization));
    process.stdout.write(`${JSON.stringify({
      status: finalization.status,
      resultStatus: finalization.resultStatus,
      visualStatus: finalization.visualStatus,
      visualDisposition: finalization.visualDisposition,
      outputs: finalization.outputs,
    })}\n`);
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    await writeAtomic(paths.finalization, jsonBytes({
      schema: FINALIZATION_SCHEMA,
      status: 'failed',
      failurePhase: phase,
      error: message,
      outputs: null,
      lastTrustworthyEvidence: {
        phase: 'finalization-inputs-preserved',
      },
    }));
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
