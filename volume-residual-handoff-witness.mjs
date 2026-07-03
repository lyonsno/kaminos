#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const REPORT_SCHEMA = 'kaminos.volume.residual-handoff-witness.v0';
const MODEL_ARTIFACT_SCHEMA = 'kaminos.volume.residual-upscale-model-artifact.v0';
const MODEL_ARTIFACT_AUTHORITY = 'offline-mlx-residual-upscaler-weights-v0';
const HANDOFF_AUTHORITY = 'residual-output-ema-continuation-handoff-v0';
const GAP_RISK_SCHEMA = 'kaminos.volume.interframe-gap-risk-report.v0';
const SYNTHETIC_AUTHORITY = 'synthetic-comparison-not-live-simulator-output';
const DEFAULT_RESET_CONDITIONS = [
  'loaded-artifact-identity-changed',
  'route-or-render-scale-identity-changed',
  'live-simulator-state-reset-or-seek',
  'frame-cadence-gap-exceeds-continuation-window',
  'alpha-or-continuation-mode-changed',
];

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed.set(key, next);
      index += 1;
    } else {
      parsed.set(key, true);
    }
  }
  return parsed;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function sha256File(path) {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

function fileSize(path) {
  return readFileSync(path).byteLength;
}

function gitValue(args, fallback = null) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || fallback;
  } catch {
    return fallback;
  }
}

function requireFile(path, label) {
  if (!path || !existsSync(path)) {
    const error = new Error(`${label} missing: ${path || 'not supplied'}`);
    error.code = 'missing-input';
    error.failurePhase = 'input-validate';
    throw error;
  }
}

function proofKeyForAlpha(alpha) {
  const normalized = Number(alpha);
  if (Math.abs(normalized - 0.25) < 0.0001) return 'load_a025';
  if (Math.abs(normalized - 0.5) < 0.0001) return 'load_a050';
  if (Math.abs(normalized - 1) < 0.0001) return 'train_save';
  return null;
}

function validateModelArtifact({ modelArtifactPath, modelArtifact }) {
  if (modelArtifact.schema !== MODEL_ARTIFACT_SCHEMA) {
    const error = new Error(`wrong model artifact schema: ${modelArtifact.schema || 'missing'}`);
    error.code = 'wrong-model-artifact-schema';
    error.failurePhase = 'artifact-validate';
    error.details = { expected: MODEL_ARTIFACT_SCHEMA, actual: modelArtifact.schema };
    throw error;
  }
  if (modelArtifact.authority !== MODEL_ARTIFACT_AUTHORITY) {
    const error = new Error(`wrong model artifact authority: ${modelArtifact.authority || 'missing'}`);
    error.code = 'wrong-model-artifact-authority';
    error.failurePhase = 'artifact-validate';
    error.details = { expected: MODEL_ARTIFACT_AUTHORITY, actual: modelArtifact.authority };
    throw error;
  }
  const weightsPath = modelArtifact.weights?.path;
  requireFile(weightsPath, 'artifact weights');
  const actualWeightsSha256 = sha256File(weightsPath);
  const expectedWeightsSha256 = modelArtifact.weights?.sha256;
  if (expectedWeightsSha256 && actualWeightsSha256 !== expectedWeightsSha256) {
    const error = new Error('artifact weights sha256 mismatch');
    error.code = 'weights-sha256-mismatch';
    error.failurePhase = 'artifact-validate';
    error.details = { expected: expectedWeightsSha256, actual: actualWeightsSha256, path: weightsPath };
    throw error;
  }
  return {
    schema: modelArtifact.schema,
    authority: modelArtifact.authority,
    manifestPath: modelArtifactPath,
    manifestSha256: sha256File(modelArtifactPath),
    weightsPath,
    weightsSha256: actualWeightsSha256,
    weightsBytes: fileSize(weightsPath),
    model: modelArtifact.model,
    source: modelArtifact.source,
    training: modelArtifact.training,
    metricsAtSave: modelArtifact.metricsAtSave,
  };
}

function validateProofSummary({ proofSummaryPath, proofSummary, modelArtifactIdentity, alpha }) {
  if (proofSummary.schema !== 'kaminos.volume.residual-upscale-save-load-proof.v0') {
    const error = new Error(`wrong proof summary schema: ${proofSummary.schema || 'missing'}`);
    error.code = 'wrong-proof-summary-schema';
    error.failurePhase = 'proof-validate';
    throw error;
  }
  const proofKey = proofKeyForAlpha(alpha);
  if (!proofKey || !proofSummary[proofKey]) {
    const error = new Error(`no proof row for residual continuation alpha ${alpha}`);
    error.code = 'missing-alpha-proof';
    error.failurePhase = 'proof-validate';
    error.details = { alpha, available: Object.keys(proofSummary).filter((key) => /^load_|train_save/.test(key)) };
    throw error;
  }
  const row = proofSummary[proofKey];
  const loaded = row.loadedModelArtifact || row.savedModelArtifact;
  const loadedManifest = loaded?.manifestPath || proofSummary.artifact;
  if (loadedManifest && resolve(loadedManifest) !== resolve(modelArtifactIdentity.manifestPath)) {
    const error = new Error('proof summary loaded artifact does not match requested model artifact');
    error.code = 'loaded-artifact-mismatch';
    error.failurePhase = 'proof-validate';
    error.details = {
      requested: modelArtifactIdentity.manifestPath,
      loaded: loadedManifest,
    };
    throw error;
  }
  if (loaded?.weightsSha256 && loaded.weightsSha256 !== modelArtifactIdentity.weightsSha256) {
    const error = new Error('proof summary loaded weights sha256 does not match model artifact');
    error.code = 'loaded-weights-mismatch';
    error.failurePhase = 'proof-validate';
    throw error;
  }
  const metrics = row.metrics || {};
  if (!(Number(metrics.deltaPsnr) > 0) || !(Number(metrics.weightedDeltaPsnr) > 0)) {
    const error = new Error('loaded artifact does not preserve positive still-frame residual metrics');
    error.code = 'nonpositive-still-proof';
    error.failurePhase = 'proof-validate';
    error.details = { deltaPsnr: metrics.deltaPsnr, weightedDeltaPsnr: metrics.weightedDeltaPsnr };
    throw error;
  }
  if (!(Number(metrics.continuationTemporalDeltaPsnr) > 0)) {
    const error = new Error('selected EMA alpha does not preserve positive continuation temporal delta');
    error.code = 'nonpositive-continuation-proof';
    error.failurePhase = 'proof-validate';
    error.details = { alpha, continuationTemporalDeltaPsnr: metrics.continuationTemporalDeltaPsnr };
    throw error;
  }
  return {
    proofSummaryPath,
    proofSummarySha256: sha256File(proofSummaryPath),
    selectedProofKey: proofKey,
    selectedAlpha: Number(alpha),
    modelConfigSource: row.modelConfigSource,
    evalOnly: row.evalOnly === true,
    effectiveMaxSteps: row.effectiveMaxSteps,
    requestedModelArch: row.requestedModelArch,
    modelArch: row.modelArch,
    loadedModelArtifact: row.loadedModelArtifact || null,
    metrics,
    previewSha256: row.previewSha256 || null,
    temporalPreviewSha256: row.temporalPreviewSha256 || null,
    continuationPreviewSha256: row.continuationPreviewSha256 || null,
    comparisons: proofSummary.comparisons || {},
    reports: proofSummary.reports || {},
    corpus: proofSummary.corpus || null,
  };
}

function summarizeGapRisk(gapRiskPath) {
  if (!gapRiskPath) return null;
  requireFile(gapRiskPath, 'gap-risk report');
  const gapRisk = readJson(gapRiskPath);
  if (gapRisk.schema !== GAP_RISK_SCHEMA) {
    const error = new Error(`wrong gap-risk schema: ${gapRisk.schema || 'missing'}`);
    error.code = 'wrong-gap-risk-schema';
    error.failurePhase = 'gap-risk-validate';
    throw error;
  }
  return {
    path: gapRiskPath,
    sha256: sha256File(gapRiskPath),
    schema: gapRisk.schema,
    status: gapRisk.status,
    sequenceAuthority: gapRisk.sequenceAuthority,
    syntheticAuthority: gapRisk.syntheticAuthority,
    sourceReportCount: gapRisk.summary?.sourceReportCount,
    candidateCount: gapRisk.summary?.candidateCount,
    forbiddenCandidateCount: gapRisk.summary?.forbiddenCandidateCount,
    sourceVerdicts: gapRisk.summary?.sourceVerdicts || [],
    failureModeCounts: gapRisk.summary?.failureModeCounts || {},
    verdict: gapRisk.summary?.verdict,
    adapterUse: 'comparison-veto-only-not-cadence-authority',
  };
}

function htmlEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function writeHtml(path, report) {
  const metrics = report.proof.metrics;
  const rows = [
    ['schema', report.schema],
    ['handoff authority', report.handoffAuthority],
    ['model artifact', report.loadedArtifactIdentity.manifestPath],
    ['weights sha256', report.loadedArtifactIdentity.weightsSha256],
    ['alpha', report.liveContinuationRequirements.residualContinuationAlpha],
    ['fallback label', report.liveContinuationRequirements.fallbackLabel],
    ['delta PSNR', metrics.deltaPsnr],
    ['weighted delta PSNR', metrics.weightedDeltaPsnr],
    ['continuation temporal delta PSNR', metrics.continuationTemporalDeltaPsnr],
    ['continuation flicker amplification', metrics.continuationFlickerAmplification],
    ['gap-risk verdict', report.gapRiskSummary?.verdict || 'not supplied'],
  ];
  const bodyRows = rows.map(([key, value]) => `<tr><th>${htmlEscape(key)}</th><td>${htmlEscape(value)}</td></tr>`).join('\n');
  const resetList = report.liveContinuationRequirements.resetConditions
    .map((item) => `<li>${htmlEscape(item)}</li>`)
    .join('\n');
  const visual = report.visualProof?.copiedContactSheet
    ? `<figure><img src="${htmlEscape(basename(report.visualProof.copiedContactSheet))}" alt="Residual save/load contact sheet"><figcaption>${htmlEscape(report.visualProof.truthLabel)}</figcaption></figure>`
    : '<p>No visual proof supplied.</p>';
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Kaminos Residual Handoff Witness</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 24px; color: #161616; background: #f7f5f0; }
    main { max-width: 1120px; margin: 0 auto; }
    table { border-collapse: collapse; width: 100%; background: white; }
    th, td { border: 1px solid #c9c4b8; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { width: 240px; background: #ebe6d9; }
    img { max-width: 100%; height: auto; border: 1px solid #b8b1a4; background: white; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  </style>
</head>
<body>
  <main>
    <h1>Kaminos Residual Handoff Witness</h1>
    <table>${bodyRows}</table>
    <h2>Reset Conditions</h2>
    <ul>${resetList}</ul>
    <h2>Visual Proof</h2>
    ${visual}
  </main>
</body>
</html>
`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
}

const args = parseArgs(process.argv.slice(2));
const cwd = new URL('.', import.meta.url).pathname;
const outDir = resolve(args.get('--out-dir') || '/tmp/kaminos-residual-handoff-witness');
const reportPath = resolve(args.get('--report') || `${outDir}/residual-handoff-report.json`);
const htmlPath = resolve(args.get('--html') || `${outDir}/residual-handoff.html`);
const alpha = Number(args.get('--residual-continuation-alpha') || 0.25);
const fallbackLabel = String(args.get('--fallback-label') || 'continuation-not-live-sim-output');
const requestedRouteIdentity = String(args.get('--route-identity') || 'native-3d-compute-fluid-raymarch-v0');
const visualTruthLabel = 'offline contact sheet / not live browser proof';

function fail(error, lastTrustworthyEvidence = {}) {
  const now = new Date().toISOString();
  const failure = {
    schema: REPORT_SCHEMA,
    status: 'failed',
    createdAt: now,
    updatedAt: now,
    cwd,
    gitCommit: gitValue(['rev-parse', 'HEAD']),
    gitBranch: gitValue(['branch', '--show-current']),
    gitStatusShort: gitValue(['status', '--short'], ''),
    reportPath,
    htmlPath,
    failurePhase: error.failurePhase || 'unknown',
    error: {
      code: error.code || 'residual-handoff-witness-failed',
      message: error.message,
      details: error.details || null,
    },
    lastTrustworthyEvidence,
  };
  writeJson(reportPath, failure);
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}

try {
  const modelArtifactPath = resolve(String(args.get('--model-artifact') || ''));
  const proofSummaryPath = resolve(String(args.get('--proof-summary') || ''));
  const contactSheetPath = args.get('--contact-sheet') ? resolve(String(args.get('--contact-sheet'))) : null;
  const gapRiskPath = args.get('--gap-risk-report') ? resolve(String(args.get('--gap-risk-report'))) : null;

  requireFile(modelArtifactPath, 'model artifact');
  requireFile(proofSummaryPath, 'proof summary');
  if (contactSheetPath) requireFile(contactSheetPath, 'contact sheet');

  mkdirSync(outDir, { recursive: true });
  const createdAt = new Date().toISOString();
  const modelArtifact = readJson(modelArtifactPath);
  const loadedArtifactIdentity = validateModelArtifact({ modelArtifactPath, modelArtifact });
  const proofSummary = readJson(proofSummaryPath);
  const proof = validateProofSummary({
    proofSummaryPath,
    proofSummary,
    modelArtifactIdentity: loadedArtifactIdentity,
    alpha,
  });
  const gapRiskSummary = summarizeGapRisk(gapRiskPath);
  const copiedContactSheet = contactSheetPath ? resolve(outDir, basename(contactSheetPath)) : null;
  if (copiedContactSheet) copyFileSync(contactSheetPath, copiedContactSheet);
  const visualProof = copiedContactSheet
    ? {
        sourceContactSheet: contactSheetPath,
        copiedContactSheet,
        sha256: sha256File(copiedContactSheet),
        bytes: fileSize(copiedContactSheet),
        truthLabel: visualTruthLabel,
      }
    : null;

  const report = {
    schema: REPORT_SCHEMA,
    status: 'completed',
    createdAt,
    updatedAt: createdAt,
    cwd,
    gitCommit: gitValue(['rev-parse', 'HEAD']),
    gitBranch: gitValue(['branch', '--show-current']),
    gitStatusShort: gitValue(['status', '--short'], ''),
    reportPath,
    htmlPath,
    handoffAuthority: HANDOFF_AUTHORITY,
    loadedArtifactIdentity,
    proof,
    liveContinuationRequirements: {
      requestedRouteIdentity,
      requiredModelArtifactSchema: MODEL_ARTIFACT_SCHEMA,
      requiredModelArtifactAuthority: MODEL_ARTIFACT_AUTHORITY,
      residualContinuationMode: 'ema',
      residualContinuationAlpha: Number(alpha),
      resetConditions: DEFAULT_RESET_CONDITIONS,
      fallbackLabel,
      loadedArtifactIdentity: {
        manifestSha256: loadedArtifactIdentity.manifestSha256,
        weightsSha256: loadedArtifactIdentity.weightsSha256,
        modelArch: loadedArtifactIdentity.model?.modelArch,
        scaleChannel: loadedArtifactIdentity.model?.scaleChannel,
      },
      browserRouteRequirements: [
        'load weights through an explicit browser-side inference backend before enabling residual correction',
        'record requested and effective route/render-scale identity before each continuation segment',
        'reset EMA state on simulator reset, route/control change, artifact change, or cadence discontinuity',
        'label residual output as continuation/fallback unless witnessed in the live browser route',
      ],
    },
    fallbackLabel,
    syntheticAuthorityDisclaimed: SYNTHETIC_AUTHORITY,
    gapRiskSummary,
    visualProof,
    artifacts: {
      reportJson: reportPath,
      html: htmlPath,
      copiedContactSheet,
    },
    failures: [],
  };
  writeJson(reportPath, report);
  writeHtml(htmlPath, report);
} catch (error) {
  fail(error);
}
