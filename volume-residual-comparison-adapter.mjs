#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const REPORT_SCHEMA = 'kaminos.volume.residual-comparison-adapter.v0';
const COMPARISON_AUTHORITY = 'image-space-residual-vs-field-gap-comparison-v0';
const HANDOFF_SCHEMA = 'kaminos.volume.residual-handoff-witness.v0';
const HANDOFF_AUTHORITY = 'residual-output-ema-continuation-handoff-v0';
const GAP_RISK_SCHEMA = 'kaminos.volume.interframe-gap-risk-report.v0';
const SYNTHETIC_AUTHORITY = 'synthetic-comparison-not-live-simulator-output';
const FIELD_EVIDENCE_AUTHORITY = 'field-side-residual-evidence-comparison-only';
const NO_SYNTHETIC_CADENCE_AUTHORITY = 'noSyntheticCadenceAuthority';

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    const value = next && !next.startsWith('--') ? next : true;
    if (parsed.has(key)) {
      const current = parsed.get(key);
      parsed.set(key, Array.isArray(current) ? [...current, value] : [current, value]);
    } else {
      parsed.set(key, value);
    }
    if (value !== true) index += 1;
  }
  return parsed;
}

function valuesFor(parsed, key) {
  const value = parsed.get(key);
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
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

function requireFile(path, label) {
  if (!path || !existsSync(path)) {
    const error = new Error(`${label} missing: ${path || 'not supplied'}`);
    error.code = 'missing-input';
    error.failurePhase = 'input-validate';
    throw error;
  }
}

function gitValue(args, fallback = null) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || fallback;
  } catch {
    return fallback;
  }
}

function assertSchema(payload, expected, label) {
  if (payload.schema !== expected) {
    const error = new Error(`${label} schema mismatch: ${payload.schema || 'missing'}`);
    error.code = 'schema-mismatch';
    error.failurePhase = `${label}-validate`;
    error.details = { expected, actual: payload.schema || null };
    throw error;
  }
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function summarizeResidualHandoff(path, handoff) {
  assertSchema(handoff, HANDOFF_SCHEMA, 'residual-handoff');
  if (handoff.handoffAuthority !== HANDOFF_AUTHORITY) {
    const error = new Error(`residual handoff authority mismatch: ${handoff.handoffAuthority || 'missing'}`);
    error.code = 'handoff-authority-mismatch';
    error.failurePhase = 'residual-handoff-validate';
    error.details = { expected: HANDOFF_AUTHORITY, actual: handoff.handoffAuthority || null };
    throw error;
  }
  const metrics = handoff.proof?.metrics || {};
  const deltaPsnr = numeric(metrics.deltaPsnr);
  const weightedDeltaPsnr = numeric(metrics.weightedDeltaPsnr);
  const continuationTemporalDeltaPsnr = numeric(metrics.continuationTemporalDeltaPsnr);
  const continuationFlickerAmplification = numeric(metrics.continuationFlickerAmplification);
  return {
    path,
    sha256: sha256File(path),
    schema: handoff.schema,
    status: handoff.status,
    authority: handoff.handoffAuthority,
    routeIdentity: handoff.liveContinuationRequirements?.requestedRouteIdentity || null,
    residualContinuationMode: handoff.liveContinuationRequirements?.residualContinuationMode || null,
    residualContinuationAlpha: handoff.liveContinuationRequirements?.residualContinuationAlpha ?? null,
    loadedArtifactIdentity: handoff.loadedArtifactIdentity
      ? {
          manifestSha256: handoff.loadedArtifactIdentity.manifestSha256,
          weightsSha256: handoff.loadedArtifactIdentity.weightsSha256,
          model: handoff.loadedArtifactIdentity.model || null,
          source: handoff.loadedArtifactIdentity.source || null,
        }
      : null,
    proof: {
      selectedProofKey: handoff.proof?.selectedProofKey || null,
      evalOnly: handoff.proof?.evalOnly ?? null,
      effectiveMaxSteps: handoff.proof?.effectiveMaxSteps ?? null,
      metrics: {
        deltaPsnr,
        weightedDeltaPsnr,
        temporalDeltaPsnr: numeric(metrics.temporalDeltaPsnr),
        continuationTemporalDeltaPsnr,
        continuationFlickerAmplification,
      },
    },
    visualProof: handoff.visualProof || null,
    positiveImageSpaceEvidence: deltaPsnr > 0 && weightedDeltaPsnr > 0 && continuationTemporalDeltaPsnr > 0,
  };
}

function summarizeGapRisk(path, gapRisk) {
  assertSchema(gapRisk, GAP_RISK_SCHEMA, 'gap-risk');
  if (gapRisk.syntheticAuthority !== SYNTHETIC_AUTHORITY) {
    const error = new Error(`gap-risk synthetic authority mismatch: ${gapRisk.syntheticAuthority || 'missing'}`);
    error.code = 'gap-risk-authority-mismatch';
    error.failurePhase = 'gap-risk-validate';
    error.details = { expected: SYNTHETIC_AUTHORITY, actual: gapRisk.syntheticAuthority || null };
    throw error;
  }
  return {
    path,
    sha256: sha256File(path),
    schema: gapRisk.schema,
    status: gapRisk.status,
    sequenceAuthority: gapRisk.sequenceAuthority,
    syntheticAuthority: gapRisk.syntheticAuthority,
    sourceReportCount: gapRisk.summary?.sourceReportCount ?? null,
    candidateCount: gapRisk.summary?.candidateCount ?? null,
    forbiddenCandidateCount: gapRisk.summary?.forbiddenCandidateCount ?? null,
    suspectCandidateCount: gapRisk.summary?.suspectCandidateCount ?? null,
    verdict: gapRisk.summary?.verdict || null,
    failureModeCounts: gapRisk.summary?.failureModeCounts || {},
    sourceVerdicts: gapRisk.summary?.sourceVerdicts || [],
    adapterUse: 'comparison-veto-only-not-live-or-synthetic-cadence-authority',
  };
}

function pushMetric(rows, sourcePath, evidenceKind, target, metrics, extra = {}) {
  const improvement = numeric(metrics?.improvementVsLinearContextPercent);
  const identity = numeric(metrics?.improvementVsIdentityPercent);
  const affine = numeric(metrics?.improvementVsAffinePercent);
  rows.push({
    sourcePath,
    evidenceKind,
    target,
    mse: numeric(metrics?.mse ?? metrics?.modelMse),
    improvementVsLinearContextPercent: improvement,
    improvementVsIdentityPercent: identity,
    improvementVsAffinePercent: affine,
    positiveVsLinearContext: improvement === null ? null : improvement > 0,
    ...extra,
  });
}

function summarizeFieldEvidence(path, summary) {
  const rows = [];
  for (const item of summary.broadTargets || []) {
    pushMetric(rows, path, 'broad-target', item.target, item);
  }
  for (const item of summary.visibleFireExactChannels || []) {
    pushMetric(rows, path, 'visible-fire-exact-channel', item.channel, item);
  }
  for (const item of summary.independentHeadComparison || []) {
    pushMetric(
      rows,
      path,
      'independent-head-comparison',
      item.target,
      {
        mse: item.independentMse,
        improvementVsLinearContextPercent: item.independentImprovementVsLinearContextPercent,
      },
      {
        jointMse: numeric(item.jointMse),
        jointImprovementVsLinearContextPercent: numeric(item.jointImprovementVsLinearContextPercent),
        read: item.read || null,
      },
    );
  }
  for (const probe of summary.probes || []) {
    pushMetric(
      rows,
      path,
      'field-probe',
      probe.requested?.targetChannelGroup || probe.requested?.targetChannelList || probe.file || 'unknown',
      probe.metrics || {},
      {
        file: probe.file || null,
        status: probe.status || null,
        identity: probe.identity || probe.requested?.model || null,
      },
    );
  }
  const positiveRows = rows.filter((row) => row.positiveVsLinearContext === true);
  const negativeRows = rows.filter((row) => row.positiveVsLinearContext === false);
  return {
    path,
    sha256: sha256File(path),
    schema: summary.schema || null,
    createdAt: summary.createdAt || null,
    authority: FIELD_EVIDENCE_AUTHORITY,
    implementation: summary.implementation || null,
    predicate: summary.predicate || null,
    selection: summary.selection || null,
    probabilityUpdate: summary.probabilityUpdate || null,
    metricRowCount: rows.length,
    positiveVsLinearContextCount: positiveRows.length,
    nonPositiveVsLinearContextCount: negativeRows.length,
    notableTargets: rows
      .filter((row) => row.improvementVsLinearContextPercent !== null)
      .sort((a, b) => Math.abs(b.improvementVsLinearContextPercent) - Math.abs(a.improvementVsLinearContextPercent))
      .slice(0, 8),
    rows,
  };
}

function deriveVerdict({ residual, gapRisk, fieldEvidenceSummaries }) {
  const hasFieldEvidence = fieldEvidenceSummaries.length > 0;
  const fieldPositiveCount = fieldEvidenceSummaries.reduce((sum, item) => sum + item.positiveVsLinearContextCount, 0);
  const hasForbiddenSynthetic = Number(gapRisk.forbiddenCandidateCount) > 0;
  if (residual.positiveImageSpaceEvidence && hasForbiddenSynthetic && hasFieldEvidence) {
    return 'residual-positive-gap-risk-vetoes-synthetic-field-evidence-adjacent';
  }
  if (residual.positiveImageSpaceEvidence && hasForbiddenSynthetic) {
    return 'residual-positive-gap-risk-vetoes-synthetic-field-evidence-missing';
  }
  if (residual.positiveImageSpaceEvidence && fieldPositiveCount > 0) {
    return 'residual-positive-field-evidence-adjacent-gap-risk-not-forbidden';
  }
  return 'comparison-inconclusive';
}

const args = parseArgs(process.argv.slice(2));
const cwd = new URL('.', import.meta.url).pathname;
const outPath = resolve(String(args.get('--out') || '/tmp/kaminos-residual-comparison-adapter/report.json'));

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
    reportPath: outPath,
    failurePhase: error.failurePhase || 'unknown',
    error: {
      code: error.code || 'residual-comparison-adapter-failed',
      message: error.message,
      details: error.details || null,
    },
    lastTrustworthyEvidence,
  };
  writeJson(outPath, failure);
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}

try {
  const handoffPath = resolve(String(args.get('--residual-handoff-report') || ''));
  const gapRiskPath = resolve(String(args.get('--gap-risk-report') || ''));
  const fieldSummaryPaths = valuesFor(args, '--field-summary').map((value) => resolve(String(value)));
  requireFile(handoffPath, 'residual handoff report');
  requireFile(gapRiskPath, 'gap-risk report');
  for (const path of fieldSummaryPaths) requireFile(path, 'field summary');

  const residual = summarizeResidualHandoff(handoffPath, readJson(handoffPath));
  const gapRisk = summarizeGapRisk(gapRiskPath, readJson(gapRiskPath));
  const fieldEvidenceSummaries = fieldSummaryPaths.map((path) => summarizeFieldEvidence(path, readJson(path)));
  const createdAt = new Date().toISOString();
  const report = {
    schema: REPORT_SCHEMA,
    status: 'completed',
    createdAt,
    updatedAt: createdAt,
    cwd,
    gitCommit: gitValue(['rev-parse', 'HEAD']),
    gitBranch: gitValue(['branch', '--show-current']),
    gitStatusShort: gitValue(['status', '--short'], ''),
    reportPath: outPath,
    comparisonAuthority: COMPARISON_AUTHORITY,
    noSyntheticCadenceAuthority: true,
    noSyntheticCadenceAuthorityLabel: NO_SYNTHETIC_CADENCE_AUTHORITY,
    syntheticAuthorityDisclaimed: SYNTHETIC_AUTHORITY,
    fieldEvidenceAuthority: FIELD_EVIDENCE_AUTHORITY,
    comparisonBoundaries: [
      'residual handoff evidence is image-space residual upscaling plus EMA continuation proof, not live browser integration proof',
      'gap-risk evidence is a veto/comparison chamber for RGB synthetic fills, not a blocker for residual upscaling',
      'field-side residual evidence is adjacent scalar/source/field pressure, not renderer or cadence custody',
      'this adapter does not certify synthetic cadence, RIFE, optical flow, browser live route quality, or final visual quality',
    ],
    residualHandoff: residual,
    gapRiskSummary: gapRisk,
    fieldEvidenceSummaries,
    crossLaneEvaluation: {
      verdict: deriveVerdict({ residual, gapRisk, fieldEvidenceSummaries }),
      residualPositiveImageSpaceEvidence: residual.positiveImageSpaceEvidence,
      forbiddenSyntheticCandidateCount: gapRisk.forbiddenCandidateCount,
      fieldSummaryCount: fieldEvidenceSummaries.length,
      fieldPositiveVsLinearContextCount: fieldEvidenceSummaries.reduce((sum, item) => sum + item.positiveVsLinearContextCount, 0),
      fieldNonPositiveVsLinearContextCount: fieldEvidenceSummaries.reduce((sum, item) => sum + item.nonPositiveVsLinearContextCount, 0),
      recommendedConsumerUse: [
        'Beaming/browser lanes can use residualHandoff route and reset requirements as integration inputs',
        'Pyro Interframe can use gapRiskSummary only as comparison/veto pressure against fake smoothness',
        'Pyro Field can use fieldEvidenceSummaries only as adjacent field-side pressure and target decomposition context',
      ],
    },
  };
  writeJson(outPath, report);
} catch (error) {
  fail(error);
}
