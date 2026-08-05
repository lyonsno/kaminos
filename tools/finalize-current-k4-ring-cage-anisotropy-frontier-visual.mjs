#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const SWEEP_SCHEMA = 'kaminos.current-k4-ring-cage-anisotropy-sweep-result.v0';
const REPORT_SCHEMA = 'kaminos.current-k4-ring-cage-anisotropy-sweep-run-report.v0';
const MANIFEST_SCHEMA =
  'kaminos.current-k4-ring-cage-anisotropy-frontier-visual-manifest.v0';
const VERIFICATION_SCHEMA =
  'kaminos.current-k4-ring-cage-anisotropy-frontier-capture-verification.v0';
const INSPECTION_SCHEMA =
  'kaminos.current-k4-ring-cage-anisotropy-frontier-visual-inspection.v0';
const FINALIZATION_SCHEMA =
  'kaminos.current-k4-ring-cage-anisotropy-frontier-visual-finalization.v0';
const REJECTION_STATUS = 'agent-inspected-rejected-no-admissible-frontier-opening';
const REJECTION_DISPOSITION = 'reject-constant-area-anisotropy-for-current-k4';

function expectedCaptureRows(manifest, baseUrl) {
  const rows = [
    ['selected-reference:primary', manifest.selectedReference.captureUrls.primary],
    ['selected-reference:side', manifest.selectedReference.captureUrls.side],
    ...manifest.candidates.flatMap(candidate => [
      [`${candidate.id}:primary`, candidate.captureUrls.primary],
      [`${candidate.id}:side`, candidate.captureUrls.side],
    ]),
    ['contact-sheet:primary', 'contact-sheet.html'],
    ['contact-sheet:side', 'contact-sheet-side.html'],
  ];
  return rows.map(([key, relative]) => [key, new URL(relative, baseUrl).href]);
}

function validateInspection(inspection, manifest) {
  const preparedIdentitySha256 = manifest.preparedIdentitySha256 || manifest.identity.sha256;
  if (inspection?.preparedManifestIdentitySha256 !== preparedIdentitySha256) {
    throw new Error('frontier inspection prepared manifest identity mismatch');
  }
  if (inspection.status !== REJECTION_STATUS ||
      inspection.visualDisposition !== REJECTION_DISPOSITION) {
    throw new Error('frontier inspection lacks the exact rejected disposition');
  }
  for (const key of ['visibleDeltaAgainstAcceptedDirection', 'nextMechanism']) {
    if (typeof inspection[key] !== 'string' || inspection[key].trim().length < 8) {
      throw new Error(`frontier inspection requires substantive ${key}`);
    }
  }
}

export function finalizeCurrentK4RingCageAnisotropyFrontierVisual({
  sweep,
  runReport,
  manifest,
  captureEvidence,
  inspection,
  baseUrl,
}) {
  if (sweep?.schema !== SWEEP_SCHEMA || sweep.status !== 'completed' ||
      runReport?.schema !== REPORT_SCHEMA || runReport.status !== 'completed' ||
      manifest?.schema !== MANIFEST_SCHEMA ||
      !['prepared-pending-capture', REJECTION_STATUS].includes(manifest.status)) {
    throw new Error('frontier finalization requires completed scalar and prepared visual custody');
  }
  if (manifest.inputs.sweep.sha256 !== runReport.outputs.sweepResult.sha256 ||
      JSON.stringify(manifest.candidateIds) !== JSON.stringify(sweep.nondominatedCandidateIds) ||
      JSON.stringify(manifest.candidateIds) !==
        JSON.stringify(manifest.candidates.map(candidate => candidate.id))) {
    throw new Error('frontier finalization scalar/visual identity mismatch');
  }
  validateInspection(inspection, manifest);
  const preparedManifestIdentitySha256 =
    manifest.preparedIdentitySha256 || manifest.identity.sha256;
  const expected = expectedCaptureRows(manifest, baseUrl);
  if (!Array.isArray(captureEvidence) ||
      JSON.stringify(captureEvidence.map(row => row.key)) !==
        JSON.stringify(expected.map(row => row[0]))) {
    throw new Error('frontier capture key mismatch');
  }
  const captures = captureEvidence.map((capture, index) => {
    const [expectedKey, expectedUrl] = expected[index];
    if (capture.key !== expectedKey || capture.url !== expectedUrl ||
        capture.report?.invocation?.url !== expectedUrl) {
      throw new Error(`frontier capture URL mismatch for ${expectedKey}`);
    }
    if (capture.report.status !== 'complete' ||
        capture.report.route?.fallbackUsed !== false ||
        capture.report.browser?.effective?.installedStableChrome !== false ||
        !String(capture.report.browser?.effective?.kind).includes('headless-shell') ||
        capture.report.process?.cleanup?.status !== 'complete-no-process-group-remains' ||
        capture.report.primaryOutput?.sha256 !== capture.sha256) {
      if (capture.report.browser?.effective?.installedStableChrome === true) {
        throw new Error(`frontier capture ${expectedKey} used stable Chrome`);
      }
      throw new Error(`frontier capture ${expectedKey} lacks independent complete custody`);
    }
    return {
      key: capture.key,
      url: capture.url,
      sha256: capture.sha256,
      reportSha256: capture.reportSha256 || null,
      installedStableChrome: false,
      fallbackUsed: false,
      cleanupStatus: capture.report.process.cleanup.status,
    };
  });
  const verification = {
    schema: VERIFICATION_SCHEMA,
    status: 'verified',
    preparedManifestIdentitySha256,
    sweepSha256: manifest.inputs.sweep.sha256,
    baseUrl: new URL(baseUrl).href,
    candidateIds: manifest.candidateIds,
    captures,
  };
  const normalizedInspection = {
    schema: INSPECTION_SCHEMA,
    ...inspection,
    candidateIds: manifest.candidateIds,
    captureCount: captures.length,
  };
  return {
    verification,
    inspection: normalizedInspection,
    manifest: {
      ...manifest,
      preparedIdentitySha256: preparedManifestIdentitySha256,
      status: normalizedInspection.status,
      visualDisposition: normalizedInspection.visualDisposition,
    },
    runReport: {
      ...runReport,
      resultStatus: normalizedInspection.visualDisposition,
      visual: {
        ...runReport.visual,
        status: normalizedInspection.status,
        visualDisposition: normalizedInspection.visualDisposition,
        candidateIds: manifest.candidateIds,
        route: {
          requested: runReport.visual.route.requested,
          effective: runReport.visual.route.requested,
          fallbackUsed: false,
        },
        viewerRoute: manifest.route,
      },
      lastTrustworthyEvidence: {
        phase: 'visual-inspection-finalized',
        preparedManifestIdentitySha256,
        sweepResultSha256: runReport.outputs.sweepResult.sha256,
        disposition: normalizedInspection.visualDisposition,
      },
    },
  };
}

function parseArguments(argv) {
  const supported = new Set(['--output', '--base-url', '--inspection']);
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!supported.has(argument)) throw new Error(`unsupported argument ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    parsed[argument.slice(2)] = value;
    index += 1;
  }
  for (const key of ['output', 'base-url', 'inspection']) {
    if (!parsed[key]) throw new Error(`--${key} is required`);
  }
  return {
    outputDirectory: path.resolve(parsed.output),
    baseUrl: new URL(parsed['base-url']).href,
    inspectionPath: path.resolve(parsed.inspection),
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function publicReceiptPath(value, repoRoot) {
  if (typeof value !== 'string' || value.startsWith('repo://')) return value;
  const relative = path.relative(repoRoot, value);
  if (!path.isAbsolute(relative) && relative !== '..' &&
      !relative.startsWith(`..${path.sep}`)) {
    return `repo://${relative.split(path.sep).join('/')}`;
  }
  return value;
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function writeAtomic(target, bytes) {
  const temporary = `${target}.tmp-${process.pid}`;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(temporary, bytes);
  await rename(temporary, target);
}

async function loadCaptureEvidence(outputDirectory, manifest, baseUrl) {
  const paths = [
    ['selected-reference:primary', 'selected-reference/primary.png',
      'selected-reference/primary-capture-report.json'],
    ['selected-reference:side', 'selected-reference/side.png',
      'selected-reference/side-capture-report.json'],
    ...manifest.candidates.flatMap(candidate => [
      [`${candidate.id}:primary`, `candidates/${candidate.id}/primary.png`,
        `candidates/${candidate.id}/primary-capture-report.json`],
      [`${candidate.id}:side`, `candidates/${candidate.id}/side.png`,
        `candidates/${candidate.id}/side-capture-report.json`],
    ]),
    ['contact-sheet:primary', 'contact-sheet.png', 'contact-sheet-capture-report.json'],
    ['contact-sheet:side', 'contact-sheet-side.png', 'contact-sheet-side-capture-report.json'],
  ];
  const expectedUrls = new Map(expectedCaptureRows(manifest, baseUrl));
  return Promise.all(paths.map(async ([key, imageRelative, reportRelative]) => {
    const [imageBytes, reportBytes] = await Promise.all([
      readFile(path.join(outputDirectory, imageRelative)),
      readFile(path.join(outputDirectory, reportRelative)),
    ]);
    const report = JSON.parse(reportBytes);
    const imageSha256 = sha256(imageBytes);
    if (report.primaryOutput?.sha256 !== imageSha256) {
      throw new Error(`frontier capture ${key} PNG/report hash mismatch`);
    }
    return {
      key,
      url: expectedUrls.get(key),
      sha256: imageSha256,
      reportSha256: sha256(reportBytes),
      report,
    };
  }));
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const assayRoot = path.dirname(args.outputDirectory);
  const paths = {
    sweep: path.join(assayRoot, 'sweep-result.json'),
    runReport: path.join(assayRoot, 'run-report.json'),
    manifest: path.join(args.outputDirectory, 'visual-manifest.json'),
    inspectionInput: args.inspectionPath,
    verification: path.join(args.outputDirectory, 'capture-verification.json'),
    inspection: path.join(args.outputDirectory, 'visual-inspection.json'),
    finalization: path.join(args.outputDirectory, 'visual-finalization-report.json'),
  };
  let phase = 'read-inputs';
  try {
    const [sweepBytes, reportBytes, manifestBytes, inspectionBytes] = await Promise.all([
      readFile(paths.sweep),
      readFile(paths.runReport),
      readFile(paths.manifest),
      readFile(paths.inspectionInput),
    ]);
    const sweep = JSON.parse(sweepBytes);
    const runReport = JSON.parse(reportBytes);
    const manifest = JSON.parse(manifestBytes);
    manifest.inputs = Object.fromEntries(Object.entries(manifest.inputs).map(
      ([key, receipt]) => [key, {
        ...receipt,
        path: publicReceiptPath(receipt.path, process.cwd()),
      }],
    ));
    const inspectionInput = JSON.parse(inspectionBytes);
    phase = 'read-and-verify-captures';
    const captureEvidence = await loadCaptureEvidence(
      args.outputDirectory,
      manifest,
      args.baseUrl,
    );
    phase = 'finalize-visual-disposition';
    const result = finalizeCurrentK4RingCageAnisotropyFrontierVisual({
      sweep,
      runReport,
      manifest,
      captureEvidence,
      inspection: inspectionInput,
      baseUrl: args.baseUrl,
    });
    const verificationBytes = jsonBytes(result.verification);
    const inspection = {
      ...result.inspection,
      captureVerificationSha256: sha256(verificationBytes),
    };
    const inspectionBytesOut = jsonBytes(inspection);
    const manifestDomain = {
      ...result.manifest,
      captureVerification: {
        path: 'capture-verification.json',
        sha256: sha256(verificationBytes),
      },
      inspection: {
        path: 'visual-inspection.json',
        sha256: sha256(inspectionBytesOut),
      },
    };
    const { identity: _preparedIdentity, ...manifestWithoutIdentity } = manifestDomain;
    const finalizedManifest = {
      ...manifestWithoutIdentity,
      identity: { sha256: sha256(Buffer.from(JSON.stringify(manifestWithoutIdentity))) },
    };
    const manifestBytesOut = jsonBytes(finalizedManifest);
    const finalizedRunReport = {
      ...result.runReport,
      visual: {
        ...result.runReport.visual,
        manifest: {
          path: 'visual/visual-manifest.json',
          sha256: sha256(manifestBytesOut),
          identitySha256: finalizedManifest.identity.sha256,
        },
        verification: {
          path: 'visual/capture-verification.json',
          sha256: sha256(verificationBytes),
        },
        inspection: {
          path: 'visual/visual-inspection.json',
          sha256: sha256(inspectionBytesOut),
          disposition: inspection.visualDisposition,
        },
      },
    };
    phase = 'write-finalized-artifacts';
    await Promise.all([
      writeAtomic(paths.verification, verificationBytes),
      writeAtomic(paths.inspection, inspectionBytesOut),
      writeAtomic(paths.manifest, manifestBytesOut),
      writeAtomic(paths.runReport, jsonBytes(finalizedRunReport)),
    ]);
    const finalization = {
      schema: FINALIZATION_SCHEMA,
      status: 'completed',
      failurePhase: null,
      disposition: inspection.visualDisposition,
      finalizedManifestIdentitySha256: finalizedManifest.identity.sha256,
      captureVerificationSha256: sha256(verificationBytes),
      visualInspectionSha256: sha256(inspectionBytesOut),
    };
    await writeAtomic(paths.finalization, jsonBytes(finalization));
    process.stdout.write(`${JSON.stringify(finalization)}\n`);
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    await writeAtomic(paths.finalization, jsonBytes({
      schema: FINALIZATION_SCHEMA,
      status: 'failed',
      failurePhase: phase,
      error: message,
      lastTrustworthyEvidence: phase,
    }));
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
