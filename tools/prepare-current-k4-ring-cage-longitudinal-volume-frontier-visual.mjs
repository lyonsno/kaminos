#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  measureMuscleCompartmentRingCageContactState,
} from '../muscle-compartment-ring-cage-contact-core.mjs';
import {
  renderMuscleCompartmentRingCageContactHtml,
} from '../muscle-compartment-ring-cage-contact-witness.mjs';

const AMPLITUDE_FRONTIER_SCHEMA =
  'kaminos.current-k4-ring-cage-longitudinal-volume-amplitude-frontier-result.v0';
const RAMP_FRONTIER_SCHEMA =
  'kaminos.current-k4-ring-cage-longitudinal-volume-ramp-frontier-result.v0';
const MANIFEST_SCHEMA =
  'kaminos.current-k4-ring-cage-longitudinal-volume-frontier-visual-manifest.v0';
const REPORT_SCHEMA =
  'kaminos.current-k4-ring-cage-longitudinal-volume-frontier-visual-run-report.v0';
const BUNDLE_SCHEMA = 'kaminos.current-k4-ring-cage-contact-visual-bundle.v0';
const ROUTE = 'current-k4-ring-cage-longitudinal-volume-frontier-orbitable-v0';
const CUSTODY_MARKER = '.kaminos-current-k4-longitudinal-volume-frontier-visual-output';
const CUSTODY_SCHEMA =
  'kaminos.current-k4-longitudinal-volume-frontier-visual-output-custody.v0';
const CUSTODY_BYTES = Buffer.from(`${CUSTODY_SCHEMA}\n`);
const OWNED_PATHS = Object.freeze(['visual-manifest.json', 'contact-sheet.html', 'candidates']);
const FOCUS_RADIUS = 2.2;

function parseArguments(argv) {
  const supported = new Set(['--frontier', '--source', '--output']);
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!supported.has(argument)) throw new Error(`unsupported argument ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    parsed[argument.slice(2)] = value;
    index += 1;
  }
  for (const key of ['frontier', 'source', 'output']) {
    if (!parsed[key]) throw new Error(`--${key} is required`);
  }
  return {
    requestedFrontierPath: parsed.frontier,
    requestedSourcePath: parsed.source,
    outputDirectory: path.resolve(parsed.output),
  };
}

function preScanOutputDirectory(argv) {
  const index = argv.indexOf('--output');
  const value = index >= 0 ? argv[index + 1] : null;
  return value && !value.startsWith('--') ? path.resolve(value) : null;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
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

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function hasOutputCustody(outputDirectory) {
  try {
    return (await readFile(path.join(outputDirectory, CUSTODY_MARKER))).equals(CUSTODY_BYTES);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function clearOwnedOutput(outputDirectory) {
  await Promise.all(OWNED_PATHS.map(relative =>
    rm(path.join(outputDirectory, relative), { recursive: true, force: true })));
}

async function claimOutputCustody(outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  if (await hasOutputCustody(outputDirectory)) return;
  const occupied = [];
  for (const relative of [...OWNED_PATHS, 'run-report.json']) {
    if (await exists(path.join(outputDirectory, relative))) occupied.push(relative);
  }
  if (occupied.length > 0) {
    throw new Error(`refusing to claim unowned output containing ${occupied.join(', ')}`);
  }
  await writeAtomic(path.join(outputDirectory, CUSTODY_MARKER), CUSTODY_BYTES);
}

function receiptPath(target) {
  const relative = path.relative(process.cwd(), target);
  if (!path.isAbsolute(relative) && relative !== '..' &&
      !relative.startsWith(`..${path.sep}`)) {
    return `repo://${relative.split(path.sep).join('/')}`;
  }
  return target;
}

function resolveRecordedPath(recorded, baseDirectory = process.cwd()) {
  if (typeof recorded !== 'string') throw new Error('recorded path is missing');
  if (recorded.startsWith('repo://')) {
    return path.resolve(process.cwd(), recorded.slice('repo://'.length));
  }
  return path.resolve(baseDirectory, recorded);
}

function bundleIdentity({ selectedCarrier, packedCarrier, source, residualLedgerSha256 }) {
  const domain = {
    schema: BUNDLE_SCHEMA,
    route: ROUTE,
    sourceCarrierSha256: selectedCarrier.identity.sha256,
    packedCarrierSha256: packedCarrier.identity.sha256,
    sourceInputSha256: source.input.effective.sha256,
    residualLedgerSha256,
  };
  return { ...domain, sha256: sha256(Buffer.from(JSON.stringify(domain))) };
}

function routeReceipt() {
  return { requested: ROUTE, effective: ROUTE, fallbackUsed: false };
}

function boundUrl(relativeViewer, bundle, state) {
  const query = new URLSearchParams({
    bundle: bundle.sha256,
    source: bundle.sourceCarrierSha256,
    packed: bundle.packedCarrierSha256,
    ledger: bundle.residualLedgerSha256,
    routeRequested: ROUTE,
    routeEffective: ROUTE,
    state,
    view: 'contact',
  });
  return `${relativeViewer}?${query}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function metric(value) {
  return Number.isFinite(value) ? value.toFixed(4) : '—';
}

function candidateSubtitle(candidate) {
  if (Number.isFinite(candidate.compressionAreaScale)) {
    return `M45 section 11 area scale ${candidate.compressionAreaScale}`;
  }
  const compression = candidate.requested.compressionSections
    .map(row => `${row.sectionId.split(':').at(-1)}=${row.areaScale}`)
    .join(', ');
  const repayment = candidate.requested.repaymentSectionIds
    .map(sectionId => sectionId.split(':').at(-1))
    .join('/');
  return `${candidate.status} · compress ${compression} · repay ${repayment}`;
}

function contactSheetHtml(frontier, manifest) {
  const reference = frontier.selectedReference.metrics;
  const rows = [
    {
      id: 'selected-reference',
      title: 'Selected curvature-12 reference',
      subtitle: 'Before longitudinal transfer',
      image: 'selected-reference-contact.png',
      metrics: reference,
    },
    ...frontier.candidates.filter(candidate => manifest.candidateIds.includes(candidate.id))
      .map(candidate => ({
        id: candidate.id,
        title: candidate.id,
        subtitle: candidateSubtitle(candidate),
        image: `candidates/${candidate.id}/contact.png`,
        metrics: candidate.metrics,
      })),
  ];
  const articles = rows.map(row => `<article>
    <div class="image"><img src="${escapeHtml(row.image)}" alt="${escapeHtml(row.title)} contact-region close view"></div>
    <header><strong>${escapeHtml(row.title)}</strong><span>${escapeHtml(row.subtitle)}</span></header>
    <dl>
      <dt>movable total</dt><dd>${metric(row.metrics.pairwiseMovableTotalPenetration)}</dd>
      <dt>movable max</dt><dd>${metric(row.metrics.pairwiseMovableMaximumPenetration)}</dd>
      <dt>fixed total</dt><dd>${metric(row.metrics.pairwiseFixedTotalPenetration)}</dd>
      <dt>fixed max</dt><dd>${metric(row.metrics.pairwiseFixedMaximumPenetration)}</dd>
      <dt>skeletal total</dt><dd>${metric(row.metrics.skeletalTotalPenetration)}</dd>
    </dl>
  </article>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Current-K4 longitudinal volume frontier · contact close</title>
<style>*{box-sizing:border-box}body{margin:0;padding:22px;background:#07090d;color:#f4eee3;font-family:Inter,system-ui,sans-serif}h1{margin:0 0 4px;font:700 22px/1.2 ui-monospace,monospace}p{margin:0 0 18px;color:#aeb9c6;font-size:12px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}article{overflow:hidden;border:1px solid #ffffff20;border-radius:12px;background:#0b1017}.image{aspect-ratio:14/9;background:#05070a}.image img{width:100%;height:100%;object-fit:cover;object-position:center;display:block}header{display:flex;justify-content:space-between;gap:8px;padding:10px 12px 6px}header strong{font:700 12px/1.3 ui-monospace,monospace;color:#ffd166}header span{font-size:10px;color:#9aa8b7;text-align:right}dl{display:grid;grid-template-columns:1fr auto;gap:3px 12px;margin:0;padding:0 12px 12px;font:10px/1.25 ui-monospace,monospace}dt{color:#8e9baa}dd{margin:0;color:#dce6f0}.identity{margin-top:16px;color:#6f7d8c;font:9px/1.35 ui-monospace,monospace;overflow-wrap:anywhere}</style></head><body>
<h1>Current-K4 longitudinal volume frontier · M45 section 11 close view</h1>
<p>The reference and every measured candidate share exact centerlines, attachments, source identity, and integrated M45 volume. Candidate status remains visible. This is provisional mechanism evidence, not packing or anatomical admission.</p>
<section class="grid">${articles}</section>
<div class="identity">manifest ${escapeHtml(manifest.identity.sha256)} · frontier ${escapeHtml(manifest.inputs.frontier.sha256)} · route ${escapeHtml(ROUTE)}</div>
</body></html>`;
}

const rawArguments = process.argv.slice(2);
const preScannedOutputDirectory = preScanOutputDirectory(rawArguments);
let args = null;
let phase = 'parse-arguments';
let reportPath = preScannedOutputDirectory
  ? path.join(preScannedOutputDirectory, 'run-report.json')
  : null;
let inputReceipts = null;

try {
  args = parseArguments(rawArguments);
  reportPath = path.join(args.outputDirectory, 'run-report.json');
  phase = 'claim-output-custody';
  await claimOutputCustody(args.outputDirectory);
  phase = 'clear-stale-evidence';
  await clearOwnedOutput(args.outputDirectory);
  const frontierPath = await realpath(path.resolve(args.requestedFrontierPath));
  const sourcePath = await realpath(path.resolve(args.requestedSourcePath));
  phase = 'read-inputs';
  const [frontierBytes, sourceBytes] = await Promise.all([
    readFile(frontierPath),
    readFile(sourcePath),
  ]);
  const frontier = JSON.parse(frontierBytes);
  const source = JSON.parse(sourceBytes);
  inputReceipts = {
    frontier: {
      requested: receiptPath(path.resolve(args.requestedFrontierPath)),
      effective: receiptPath(frontierPath),
      sha256: sha256(frontierBytes),
      fallbackUsed: false,
    },
    source: {
      requested: receiptPath(path.resolve(args.requestedSourcePath)),
      effective: receiptPath(sourcePath),
      sha256: sha256(sourceBytes),
      fallbackUsed: false,
    },
  };
  phase = 'verify-frontier-input';
  if (![AMPLITUDE_FRONTIER_SCHEMA, RAMP_FRONTIER_SCHEMA].includes(frontier?.schema) ||
      frontier.status !== 'completed') {
    throw new Error(
      `visual preparation requires completed ${AMPLITUDE_FRONTIER_SCHEMA} or ` +
      `${RAMP_FRONTIER_SCHEMA}`,
    );
  }
  if (frontier.inputs.source.sha256 !== sha256(sourceBytes) ||
      frontier.inputs.source.sha256 !== inputReceipts.source.sha256) {
    throw new Error('frontier visual source identity mismatch');
  }
  const selectedCarrierPath = await realpath(resolveRecordedPath(
    frontier.inputs.selectedCarrier.effectivePath,
  ));
  const selectedCarrierBytes = await readFile(selectedCarrierPath);
  if (sha256(selectedCarrierBytes) !== frontier.inputs.selectedCarrier.sha256) {
    throw new Error('frontier selected carrier file identity mismatch');
  }
  const selectedCarrier = JSON.parse(selectedCarrierBytes);
  if (selectedCarrier.identity.sha256 !== frontier.selectedReference.carrierSha256) {
    throw new Error('frontier selected carrier semantic identity mismatch');
  }
  const compressionSectionId = frontier.schema === AMPLITUDE_FRONTIER_SCHEMA
    ? frontier.pressureSelection.compressionSectionIds[0]
    : frontier.candidates
      .flatMap(candidate => candidate.requested.compressionSections)
      .sort((left, right) => left.areaScale - right.areaScale ||
        right.sectionId.localeCompare(left.sectionId))[0]?.sectionId;
  const focusNodeId = `${compressionSectionId}:axis`;
  const focusCage = selectedCarrier.cages.find(cage =>
    cage.constructionId === compressionSectionId.split(':')[0]);
  const focusNode = focusCage?.manifest.nodes.find(node => node.id === focusNodeId);
  if (!focusNode) throw new Error(`frontier visual lacks focus node ${focusNodeId}`);
  const focus = {
    sectionId: compressionSectionId,
    point: focusNode.currentPosition,
    radius: FOCUS_RADIUS,
  };
  const candidateIds = frontier.visual.candidateIds;
  const route = routeReceipt();
  const bundles = {};
  const captureUrls = [];
  const initialMeasurement = measureMuscleCompartmentRingCageContactState(
    selectedCarrier,
    source,
  );
  phase = 'verify-candidate-inputs';
  for (const candidateId of candidateIds) {
    const candidate = frontier.candidates.find(row =>
      row.id === candidateId && row.packedCarrier && row.residualLedger);
    if (!candidate) throw new Error(`frontier visual lacks candidate ${candidateId}`);
    const carrierPath = await realpath(path.resolve(
      path.dirname(frontierPath),
      candidate.packedCarrier.path,
    ));
    const ledgerPath = await realpath(path.resolve(
      path.dirname(frontierPath),
      candidate.residualLedger.path,
    ));
    const [carrierBytes, ledgerBytes] = await Promise.all([
      readFile(carrierPath),
      readFile(ledgerPath),
    ]);
    if (sha256(carrierBytes) !== candidate.packedCarrier.sha256 ||
        sha256(ledgerBytes) !== candidate.residualLedger.sha256) {
      throw new Error(`frontier visual candidate ${candidateId} file identity mismatch`);
    }
    const packedCarrier = JSON.parse(carrierBytes);
    const residualLedger = JSON.parse(ledgerBytes);
    if (packedCarrier.identity.sha256 !== residualLedger.sourceCarrierSha256 ||
        residualLedger.sourceInputSha256 !== source.input.effective.sha256) {
      throw new Error(`frontier visual candidate ${candidateId} semantic identity mismatch`);
    }
    const bundle = bundleIdentity({
      selectedCarrier,
      packedCarrier,
      source,
      residualLedgerSha256: sha256(ledgerBytes),
    });
    bundles[candidateId] = bundle;
    const packedMeasurement = measureMuscleCompartmentRingCageContactState(
      packedCarrier,
      source,
    );
    const viewerRelative = `candidates/${candidateId}/index.html`;
    const viewerBytes = Buffer.from(renderMuscleCompartmentRingCageContactHtml({
      sourceCarrier: selectedCarrier,
      result: {
        status: 'longitudinal-volume-frontier-candidate-pending-visual-admission',
        fixedNodeMaximumDrift: candidate.metrics.fixedNodeMaximumDrift,
        termination: {
          reason: frontier.schema === AMPLITUDE_FRONTIER_SCHEMA
            ? 'pressure-directed-longitudinal-amplitude-frontier'
            : 'smooth-longitudinal-ramp-frontier',
        },
        metrics: { initial: initialMeasurement, packed: packedMeasurement },
        packedCarrier,
      },
      source,
      route,
      bundleIdentity: bundle,
      residualLedger,
      presentation: {
        title: `Current-K4 ${candidate.id}`,
        explanation: 'This contact-region view compares the same selected curvature-12 ' +
          'carrier against one exact longitudinal volume-transfer candidate. Its candidate ' +
          'status, compression profile, repayment set, and scalar interpretation remain ' +
          'provisional until the pixels are inspected.',
        sourceLabel: 'Selected curvature-12 reference',
        proposalLabel: candidateSubtitle(candidate),
        focus: { point: focus.point, radius: focus.radius },
      },
    }));
    await writeAtomic(path.join(args.outputDirectory, viewerRelative), viewerBytes);
    if (captureUrls.length === 0) {
      captureUrls.push({
        id: 'selected-reference',
        state: 'before',
        url: boundUrl(viewerRelative, bundle, 'before'),
        output: 'selected-reference-contact.png',
        report: 'selected-reference-contact-capture-report.json',
      });
    }
    captureUrls.push({
      id: candidateId,
      state: 'packed',
      url: boundUrl(viewerRelative, bundle, 'packed'),
      output: `candidates/${candidateId}/contact.png`,
      report: `candidates/${candidateId}/contact-capture-report.json`,
    });
  }
  const identityDomain = {
    schema: MANIFEST_SCHEMA,
    route: ROUTE,
    frontierSha256: inputReceipts.frontier.sha256,
    sourceSha256: inputReceipts.source.sha256,
    selectedCarrierSha256: selectedCarrier.identity.sha256,
    candidateIds,
    bundles,
    focus,
  };
  const manifest = {
    schema: MANIFEST_SCHEMA,
    status: 'pending-agent-inspection',
    evidenceTrack: frontier.evidenceTrack,
    claimCeiling: frontier.claimCeiling,
    inputs: inputReceipts,
    identity: { ...identityDomain, sha256: sha256(Buffer.from(JSON.stringify(identityDomain))) },
    route,
    focus,
    candidateIds,
    bundles,
    captureUrls,
    expectedCaptures: captureUrls.map(row => row.output),
    expectedCaptureReports: captureUrls.map(row => row.report),
  };
  phase = 'write-visual-primary';
  const manifestBytes = jsonBytes(manifest);
  const sheetBytes = Buffer.from(contactSheetHtml(frontier, manifest));
  await writeAtomic(path.join(args.outputDirectory, 'visual-manifest.json'), manifestBytes);
  await writeAtomic(path.join(args.outputDirectory, 'contact-sheet.html'), sheetBytes);
  const outputs = {
    visualManifest: { path: 'visual-manifest.json', sha256: sha256(manifestBytes) },
    contactSheet: { path: 'contact-sheet.html', sha256: sha256(sheetBytes) },
  };
  const report = {
    schema: REPORT_SCHEMA,
    status: 'completed',
    failurePhase: null,
    inputs: inputReceipts,
    outputs,
    visual: {
      status: manifest.status,
      route,
      identity: manifest.identity,
      captureUrls,
    },
    lastTrustworthyEvidence: {
      phase: 'visual-primary-written',
      visualManifestSha256: outputs.visualManifest.sha256,
      contactSheetSha256: outputs.contactSheet.sha256,
      candidateIds,
    },
  };
  phase = 'write-report';
  await writeAtomic(reportPath, jsonBytes(report));
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    reportPath,
    manifestIdentity: manifest.identity.sha256,
    candidateIds,
    captureCount: captureUrls.length,
  })}\n`);
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const outputDirectory = args?.outputDirectory || preScannedOutputDirectory;
  if (outputDirectory) {
    await mkdir(outputDirectory, { recursive: true });
    reportPath ||= path.join(outputDirectory, 'run-report.json');
    const outputCustodyVerified = await hasOutputCustody(outputDirectory);
    if (outputCustodyVerified) await clearOwnedOutput(outputDirectory);
    await writeAtomic(reportPath, jsonBytes({
      schema: REPORT_SCHEMA,
      status: 'failed',
      failurePhase: phase,
      error: message,
      rawArguments,
      inputs: inputReceipts,
      outputCustodyVerified,
      staleEvidenceCleared: outputCustodyVerified,
      outputs: null,
      visual: null,
      lastTrustworthyEvidence: {
        phase: inputReceipts ? 'inputs-read-and-hashed' : 'raw-arguments-captured',
        inputs: inputReceipts,
      },
    }));
  }
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
