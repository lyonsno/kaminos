#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  measureMuscleCompartmentRingCageContactResidualLedger,
  measureMuscleCompartmentRingCageContactState,
} from '../muscle-compartment-ring-cage-contact-core.mjs';
import {
  renderMuscleCompartmentRingCageContactHtml,
} from '../muscle-compartment-ring-cage-contact-witness.mjs';

const SWEEP_SCHEMA = 'kaminos.current-k4-ring-cage-anisotropy-sweep-result.v0';
const MANIFEST_SCHEMA =
  'kaminos.current-k4-ring-cage-anisotropy-frontier-visual-manifest.v0';
const BUNDLE_SCHEMA =
  'kaminos.current-k4-ring-cage-anisotropy-frontier-visual-bundle.v0';
const ROUTE = 'current-k4-ring-cage-anisotropy-frontier-orbitable-v0';

function parseArguments(argv) {
  const supported = new Set(['--sweep', '--source', '--output']);
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!supported.has(argument)) throw new Error(`unsupported argument ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    parsed[argument.slice(2)] = value;
    index += 1;
  }
  for (const key of ['sweep', 'source', 'output']) {
    if (!parsed[key]) throw new Error(`--${key} is required`);
  }
  return {
    sweepPath: path.resolve(parsed.sweep),
    sourcePath: path.resolve(parsed.source),
    outputDirectory: path.resolve(parsed.output),
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function receiptPath(target, repoRoot) {
  const relative = path.relative(repoRoot, target);
  if (!path.isAbsolute(relative) && relative !== '..' &&
      !relative.startsWith(`..${path.sep}`)) {
    return `repo://${relative.split(path.sep).join('/')}`;
  }
  return target;
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

function resolveReceiptPath(receipt, repoRoot) {
  if (typeof receipt !== 'string') throw new Error('visual preparation lacks input receipt path');
  if (receipt.startsWith('repo://')) return path.resolve(repoRoot, receipt.slice('repo://'.length));
  return path.resolve(receipt);
}

function routeReceipt() {
  return { requested: ROUTE, effective: ROUTE, fallbackUsed: false };
}

function bundleIdentity({ id, sourceCarrier, packedCarrier, source, residualLedgerBytes, sweepSha256 }) {
  const domain = {
    schema: BUNDLE_SCHEMA,
    candidateId: id,
    route: ROUTE,
    sourceCarrierSha256: sourceCarrier.identity.sha256,
    packedCarrierSha256: packedCarrier.identity.sha256,
    sourceInputSha256: source.input.effective.sha256,
    residualLedgerSha256: sha256(residualLedgerBytes),
    sweepSha256,
  };
  return { ...domain, sha256: sha256(Buffer.from(JSON.stringify(domain))) };
}

function captureUrls(relativeViewerPath, bundle) {
  const query = new URLSearchParams({
    bundle: bundle.sha256,
    source: bundle.sourceCarrierSha256,
    packed: bundle.packedCarrierSha256,
    ledger: bundle.residualLedgerSha256,
    routeRequested: ROUTE,
    routeEffective: ROUTE,
    state: 'packed',
  });
  const primary = `${relativeViewerPath}?${query}`;
  query.set('view', 'side');
  return { primary, side: `${relativeViewerPath}?${query}` };
}

function witnessHtml({ sourceCarrier, packedCarrier, source, residualLedger, bundle, status }) {
  return Buffer.from(renderMuscleCompartmentRingCageContactHtml({
    sourceCarrier,
    result: {
      status,
      fixedNodeMaximumDrift: 0,
      termination: { reason: 'bounded-anisotropy-frontier-visual-comparison' },
      metrics: {
        initial: measureMuscleCompartmentRingCageContactState(sourceCarrier, source),
        packed: measureMuscleCompartmentRingCageContactState(packedCarrier, source),
      },
      packedCarrier,
    },
    source,
    route: routeReceipt(),
    bundleIdentity: bundle,
    residualLedger,
  }));
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
  return Number.isFinite(value) ? value.toFixed(4) : 'n/a';
}

function contactSheetHtml({ manifest, side = false }) {
  const viewName = side ? 'Side view' : 'Three-quarter view';
  const imageName = side ? 'side.png' : 'primary.png';
  const cards = [
    {
      id: 'selected-reference',
      label: 'Selected c12 reference',
      subtitle: 'Crowded baseline for this frontier',
      image: `selected-reference/${imageName}`,
      metrics: manifest.selectedReference.metrics,
      admissible: true,
    },
    ...manifest.candidates.map(candidate => ({
      id: candidate.id,
      label: candidate.id,
      subtitle: `iteration ${candidate.centerlineCheckpoint} · transverse scale ${candidate.compressionScale}`,
      image: `candidates/${candidate.id}/${imageName}`,
      metrics: candidate.metrics,
      admissible: candidate.status === 'admissible',
    })),
  ].map(card => `<article>
    <div class="image"><img src="${escapeHtml(card.image)}" alt="${escapeHtml(card.label)} ${viewName}"></div>
    <header><strong>${escapeHtml(card.label)}</strong><span>${escapeHtml(card.subtitle)}</span></header>
    <dl>
      <dt>movable total</dt><dd>${metric(card.metrics.pairwiseMovableTotalPenetration)}</dd>
      <dt>movable max</dt><dd>${metric(card.metrics.pairwiseMovableMaximumPenetration)}</dd>
      <dt>fixed total</dt><dd>${metric(card.metrics.pairwiseFixedTotalPenetration)}</dd>
      <dt>skeletal total</dt><dd>${metric(card.metrics.skeletalTotalPenetration)}</dd>
      <dt>max volume error</dt><dd>${metric(card.metrics.maximumRelativeVolumeError)}</dd>
    </dl>
  </article>`).join('\n');
  return Buffer.from(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Current-K4 anisotropy frontier · ${viewName}</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:22px;background:#07090d;color:#f4eee3;font-family:Inter,system-ui,sans-serif}h1{margin:0 0 4px;font:700 22px/1.2 ui-monospace,monospace}p{margin:0 0 18px;color:#aeb9c6;font-size:12px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}article{overflow:hidden;border:1px solid #ffffff20;border-radius:12px;background:#0b1017}.image{aspect-ratio:14/9;background:#05070a}.image img{width:100%;height:100%;object-fit:cover;object-position:center;display:block}header{display:flex;justify-content:space-between;gap:8px;padding:10px 12px 6px}header strong{font:700 12px/1.3 ui-monospace,monospace;color:#ffd166}header span{font-size:10px;color:#9aa8b7;text-align:right}dl{display:grid;grid-template-columns:1fr auto;gap:3px 12px;margin:0;padding:0 12px 12px;font:10px/1.25 ui-monospace,monospace}dt{color:#8e9baa}dd{margin:0;color:#dce6f0}.identity{margin-top:16px;color:#6f7d8c;font:9px/1.35 ui-monospace,monospace;overflow-wrap:anywhere}
</style></head><body>
<h1>Current-K4 constant-area anisotropy frontier · ${viewName}</h1>
<p>Source selected c12 reference → anisotropy candidate. Candidate images are provisional packed-state witnesses, not anatomical or packing admission.</p>
<section class="grid">${cards}</section>
<div class="identity">manifest ${escapeHtml(manifest.identity.sha256)} · sweep ${escapeHtml(manifest.inputs.sweep.sha256)} · route ${escapeHtml(ROUTE)}</div>
</body></html>`);
}

const args = parseArguments(process.argv.slice(2));
const repoRoot = process.cwd();
const [effectiveSweepPath, effectiveSourcePath] = await Promise.all([
  realpath(args.sweepPath),
  realpath(args.sourcePath),
]);
const [sweepBytes, sourceBytes] = await Promise.all([
  readFile(effectiveSweepPath),
  readFile(effectiveSourcePath),
]);
const sweep = JSON.parse(sweepBytes);
const source = JSON.parse(sourceBytes);
if (sweep?.schema !== SWEEP_SCHEMA || sweep.status !== 'completed') {
  throw new Error(`visual preparation requires completed ${SWEEP_SCHEMA}`);
}
if (sweep.inputs.source.fileSha256 !== sha256(sourceBytes) ||
    sweep.inputs.source.inputSha256 !== source.input.effective.sha256) {
  throw new Error('visual preparation source identity mismatch');
}
const selectedCarrierPath = resolveReceiptPath(
  sweep.inputs.selectedCarrier.effectivePath,
  repoRoot,
);
const selectedCarrierBytes = await readFile(await realpath(selectedCarrierPath));
const selectedCarrier = JSON.parse(selectedCarrierBytes);
if (sweep.inputs.selectedCarrier.fileSha256 !== sha256(selectedCarrierBytes) ||
    sweep.selectedReference.carrierIdentitySha256 !== selectedCarrier.identity.sha256) {
  throw new Error('visual preparation selected carrier identity mismatch');
}
const sweepRoot = path.dirname(effectiveSweepPath);
const candidates = sweep.nondominatedCandidateIds.map(id => {
  const candidate = sweep.candidates.find(row => row.id === id);
  if (!candidate || candidate.status !== 'admissible' || !candidate.packedCarrier?.path) {
    throw new Error(`visual frontier candidate ${id} is not an admitted carrier`);
  }
  return candidate;
});
if (new Set(candidates.map(candidate => candidate.id)).size !== candidates.length) {
  throw new Error('visual frontier contains duplicate candidate ids');
}

if (args.outputDirectory === path.parse(args.outputDirectory).root ||
    args.outputDirectory === repoRoot ||
    [effectiveSweepPath, effectiveSourcePath, selectedCarrierPath].some(input => {
      const relative = path.relative(args.outputDirectory, input);
      return relative === '' || (!path.isAbsolute(relative) &&
        relative !== '..' && !relative.startsWith(`..${path.sep}`));
    })) {
  throw new Error('visual output must be a dedicated directory that contains no input');
}
await rm(args.outputDirectory, { recursive: true, force: true });
await mkdir(args.outputDirectory, { recursive: true });

const sweepFileSha256 = sha256(sweepBytes);
const selectedResidualLedger = measureMuscleCompartmentRingCageContactResidualLedger(
  selectedCarrier,
  source,
);
const selectedLedgerBytes = jsonBytes(selectedResidualLedger);
const selectedBundle = bundleIdentity({
  id: 'selected-reference',
  sourceCarrier: selectedCarrier,
  packedCarrier: selectedCarrier,
  source,
  residualLedgerBytes: selectedLedgerBytes,
  sweepSha256: sweepFileSha256,
});
const selectedViewerRelative = 'selected-reference/index.html';
const selectedViewerBytes = witnessHtml({
  sourceCarrier: selectedCarrier,
  packedCarrier: selectedCarrier,
  source,
  residualLedger: selectedResidualLedger,
  bundle: selectedBundle,
  status: 'selected-c12-reference',
});
await Promise.all([
  writeAtomic(path.join(args.outputDirectory, selectedViewerRelative), selectedViewerBytes),
  writeAtomic(
    path.join(args.outputDirectory, 'selected-reference/residual-ledger.json'),
    selectedLedgerBytes,
  ),
]);
const selectedCaptureUrls = captureUrls(selectedViewerRelative, selectedBundle);

const visualCandidates = [];
for (const candidate of candidates) {
  const packedPath = path.resolve(sweepRoot, candidate.packedCarrier.path);
  const ledgerPath = path.resolve(sweepRoot, candidate.residualLedger.path);
  const [packedBytes, ledgerBytes] = await Promise.all([
    readFile(await realpath(packedPath)),
    readFile(await realpath(ledgerPath)),
  ]);
  if (sha256(packedBytes) !== candidate.packedCarrier.sha256 ||
      sha256(ledgerBytes) !== candidate.residualLedger.sha256) {
    throw new Error(`visual frontier candidate ${candidate.id} artifact identity mismatch`);
  }
  const packedCarrier = JSON.parse(packedBytes);
  const residualLedger = JSON.parse(ledgerBytes);
  if (packedCarrier.identity.sha256 !== candidate.packedCarrier.identitySha256 ||
      residualLedger.sourceCarrierSha256 !== packedCarrier.identity.sha256) {
    throw new Error(`visual frontier candidate ${candidate.id} carrier identity mismatch`);
  }
  const bundle = bundleIdentity({
    id: candidate.id,
    sourceCarrier: selectedCarrier,
    packedCarrier,
    source,
    residualLedgerBytes: ledgerBytes,
    sweepSha256: sweepFileSha256,
  });
  const viewerRelative = `candidates/${candidate.id}/index.html`;
  const viewerBytes = witnessHtml({
    sourceCarrier: selectedCarrier,
    packedCarrier,
    source,
    residualLedger,
    bundle,
    status: 'admissible-nondominated-pending-visual-admission',
  });
  await writeAtomic(path.join(args.outputDirectory, viewerRelative), viewerBytes);
  visualCandidates.push({
    id: candidate.id,
    status: candidate.status,
    centerlineCheckpoint: candidate.centerlineCheckpoint,
    compressionScale: candidate.compressionScale,
    packedCarrierIdentitySha256: packedCarrier.identity.sha256,
    metrics: candidate.metrics,
    comparisonToSelected: candidate.comparisonToSelected,
    bundleIdentity: bundle,
    viewer: { path: viewerRelative, sha256: sha256(viewerBytes) },
    captureUrls: captureUrls(viewerRelative, bundle),
  });
}

const manifestDomain = {
  schema: MANIFEST_SCHEMA,
  status: 'prepared-pending-capture',
  evidenceTrack: sweep.evidenceTrack,
  claimCeiling: sweep.claimCeiling,
  inputs: {
    sweep: { path: receiptPath(effectiveSweepPath, repoRoot), sha256: sweepFileSha256 },
    source: { path: receiptPath(effectiveSourcePath, repoRoot), sha256: sha256(sourceBytes) },
  },
  route: routeReceipt(),
  candidateIds: visualCandidates.map(candidate => candidate.id),
  selectedReference: {
    carrierIdentitySha256: selectedCarrier.identity.sha256,
    metrics: sweep.selectedReference.metrics,
    bundleIdentity: selectedBundle,
    viewer: { path: selectedViewerRelative, sha256: sha256(selectedViewerBytes) },
    captureUrls: selectedCaptureUrls,
  },
  candidates: visualCandidates,
};
const manifest = {
  ...manifestDomain,
  identity: { sha256: sha256(Buffer.from(JSON.stringify(manifestDomain))) },
};
await Promise.all([
  writeAtomic(path.join(args.outputDirectory, 'visual-manifest.json'), jsonBytes(manifest)),
  writeAtomic(path.join(args.outputDirectory, 'contact-sheet.html'),
    contactSheetHtml({ manifest, side: false })),
  writeAtomic(path.join(args.outputDirectory, 'contact-sheet-side.html'),
    contactSheetHtml({ manifest, side: true })),
]);
process.stdout.write(`${JSON.stringify({
  status: manifest.status,
  outputDirectory: args.outputDirectory,
  candidateIds: manifest.candidateIds,
  manifestIdentitySha256: manifest.identity.sha256,
})}\n`);
