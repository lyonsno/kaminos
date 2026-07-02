#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const SCHEMA = 'kaminos.volume.interframe-gap-risk-report.v0';
const SOURCE_SCHEMA = 'kaminos.volume.interframe-sequence-witness.v0';
const OPERATOR_SMOKE_SCHEMA = 'kaminos.volume.interframe-gap-risk-operator-smoke.v0';
const SEQUENCE_AUTHORITY = 'full-rate-live-sim-truth';
const SYNTHETIC_AUTHORITY = 'synthetic-comparison-not-live-simulator-output';
const FORBIDDEN_VERDICT = 'synthetic-fill-forbidden-here';
const NOT_CLEARED_VERDICT = 'synthetic-fill-not-cleared';
const FAILURE_MODE_BUCKETS = [
  'ghosting',
  'smearing',
  'topology-lie',
  'snuff-quench-miss',
  'low-fire-shimmer',
  'broad-smoke-mush',
];
const HARD_OPERATOR_VERDICTS = new Set(['fail-hard', 'fail', 'failed', 'veto', 'forbidden']);
const PARTIAL_OPERATOR_VERDICTS = new Set(['partial-fail', 'mixed', 'suspect', 'needs-review']);
const ACCEPTING_OPERATOR_VERDICTS = new Set(['pass', 'tolerable', 'acceptable', 'ok']);
const HARD_FAILURE_MODES = new Set([
  'topology-lie',
  'snuff-quench-miss',
  'broad-smoke-mush',
  'low-fire-shimmer',
]);

function parseArgs(argv) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      if (!values.has(key)) values.set(key, []);
      values.get(key).push(next);
      index += 1;
    } else {
      flags.add(key);
    }
  }
  return {
    has(name) {
      return flags.has(name) || values.has(name);
    },
    one(name, fallback = null) {
      const current = values.get(name);
      if (!current || current.length === 0) return fallback;
      return current[current.length - 1];
    },
    many(name) {
      return values.get(name) || [];
    },
  };
}

function usage() {
  return `Usage:
  node volume-interframe-gap-risk-report.mjs \\
    --source-report /path/interframe-sequence-report.json \\
    --operator-smoke-file /path/operator-smoke.json \\
    --require-operator-smoke \\
    --report /path/interframe-gap-risk-report.json

Inputs:
  --source-report          Repeatable exact-truth ${SOURCE_SCHEMA} report path.
  --operator-smoke-file    Repeatable ${OPERATOR_SMOKE_SCHEMA} visual observation file.
  --operator-smoke         Repeatable inline source::verdict::tag,tag::note observation.
  --require-operator-smoke Fail loud when a source report lacks an operator smoke tag.
  --html                   Optional static HTML summary path.

Operator smoke observations may identify a source by sourceReport, sourceReportId,
sourceReportBasename, or reportPath. Synthetic frames remain ${SYNTHETIC_AUTHORITY}.
`;
}

function writeJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function gitValue(args, fallback = null) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || fallback;
  } catch {
    return fallback;
  }
}

function fail(code, message, details = {}, failurePhase = phase) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.details = details;
  error.failurePhase = failurePhase;
  return error;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function unique(values) {
  return [...new Set(values.filter(value => value !== null && value !== undefined && value !== ''))];
}

function sourceReportIdFor(sourceReportPath) {
  return basename(dirname(sourceReportPath));
}

function metricRisk(summaryMetrics = {}) {
  const meanAbsoluteError = Number(summaryMetrics.meanAbsoluteError || 0);
  const highErrorPixelRatio = Number(summaryMetrics.highErrorPixelRatio || 0);
  const fireRegionMeanAbsoluteError = Number(summaryMetrics.fireRegionMeanAbsoluteError || 0);
  const smokeRegionMeanAbsoluteError = Number(summaryMetrics.smokeRegionMeanAbsoluteError || 0);
  const maxChannelError = Number(summaryMetrics.maxChannelError || 0);
  const components = [
    clamp01(meanAbsoluteError / 1.0),
    clamp01(highErrorPixelRatio / 0.01),
    clamp01(fireRegionMeanAbsoluteError / 30),
    clamp01(smokeRegionMeanAbsoluteError / 12),
    clamp01(maxChannelError / 180),
  ];
  return Number((components.reduce((sum, value) => sum + value, 0) / components.length).toFixed(4));
}

function extractQueryParam(route, key) {
  try {
    return new URL(route).searchParams.get(key);
  } catch {
    return null;
  }
}

function denseDeltaSummary(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const numeric = values.map(Number).filter(Number.isFinite);
  if (numeric.length === 0) return null;
  return {
    count: numeric.length,
    min: Math.min(...numeric),
    max: Math.max(...numeric),
  };
}

function normalizeOperatorVerdict(verdict) {
  const normalized = String(verdict || 'unknown').trim().toLowerCase();
  if (HARD_OPERATOR_VERDICTS.has(normalized)) return 'fail-hard';
  if (PARTIAL_OPERATOR_VERDICTS.has(normalized)) return 'partial-fail';
  if (ACCEPTING_OPERATOR_VERDICTS.has(normalized)) return 'tolerable';
  return normalized || 'unknown';
}

function normalizeOperatorObservation(raw, sourceFile = null) {
  const verdict = normalizeOperatorVerdict(raw.verdict);
  return {
    schema: raw.schema || null,
    sourceReport: raw.sourceReport || raw.reportPath || null,
    sourceReportId: raw.sourceReportId || null,
    sourceReportBasename: raw.sourceReportBasename || null,
    verdict,
    rawVerdict: raw.verdict || null,
    riskTags: Array.isArray(raw.riskTags) ? unique(raw.riskTags.map(String)) : [],
    note: raw.note || '',
    observedAt: raw.observedAt || null,
    observer: raw.observer || null,
    sourceFile,
  };
}

function smokeKeysForObservation(raw, sourceFile = null) {
  const keys = [];
  const baseDir = sourceFile ? dirname(sourceFile) : process.cwd();
  if (raw.sourceReport) {
    keys.push(raw.sourceReport);
    keys.push(resolve(baseDir, raw.sourceReport));
  }
  if (raw.reportPath) {
    keys.push(raw.reportPath);
    keys.push(resolve(baseDir, raw.reportPath));
  }
  if (raw.sourceReportId) keys.push(raw.sourceReportId);
  if (raw.sourceReportBasename) keys.push(raw.sourceReportBasename);
  return unique(keys);
}

function smokeKeysForSource(sourceReportPath, report) {
  const reportId = sourceReportIdFor(sourceReportPath);
  return unique([
    sourceReportPath,
    resolve(sourceReportPath),
    report.reportPath,
    report.reportPath ? resolve(report.reportPath) : null,
    reportId,
    basename(sourceReportPath),
    basename(dirname(sourceReportPath)),
    extractQueryParam(report.requestedRoute || '', 'volume_quality_reason'),
  ]);
}

function readOperatorSmokeFiles(paths) {
  const observationsByKey = new Map();
  const sourceFiles = [];
  for (const rawPath of paths) {
    const smokePath = resolve(rawPath);
    if (!existsSync(smokePath)) throw fail('operator-smoke-file-missing', `operator smoke file does not exist: ${smokePath}`, { smokePath }, 'load-operator-smoke');
    const payload = readJson(smokePath);
    if (payload.schema && payload.schema !== OPERATOR_SMOKE_SCHEMA) {
      throw fail('operator-smoke-schema-mismatch', `operator smoke file has schema ${payload.schema}`, {
        smokePath,
        expectedSchema: OPERATOR_SMOKE_SCHEMA,
      }, 'load-operator-smoke');
    }
    const observations = Array.isArray(payload.observations) ? payload.observations : [];
    sourceFiles.push({
      path: smokePath,
      schema: payload.schema || null,
      observationCount: observations.length,
    });
    for (const raw of observations) {
      const normalized = normalizeOperatorObservation(raw, smokePath);
      for (const key of smokeKeysForObservation(raw, smokePath)) observationsByKey.set(key, normalized);
    }
  }
  return { observationsByKey, sourceFiles };
}

function readInlineOperatorSmoke(specs) {
  const observationsByKey = new Map();
  for (const spec of specs) {
    const parts = spec.split('::');
    if (parts.length < 2) {
      throw fail('operator-smoke-inline-invalid', '--operator-smoke must be source::verdict::tag,tag::note', { spec }, 'load-operator-smoke');
    }
    const raw = {
      sourceReport: parts[0],
      verdict: parts[1],
      riskTags: parts[2] ? parts[2].split(',').map(tag => tag.trim()).filter(Boolean) : [],
      note: parts.slice(3).join('::'),
    };
    const normalized = normalizeOperatorObservation(raw, 'inline');
    for (const key of smokeKeysForObservation(raw, null)) observationsByKey.set(key, normalized);
  }
  return observationsByKey;
}

function lookupOperatorSmoke(sourceReportPath, report, observationsByKey) {
  for (const key of smokeKeysForSource(sourceReportPath, report)) {
    if (observationsByKey.has(key)) return observationsByKey.get(key);
  }
  return null;
}

function validateSourceReport(sourceReportPath, report, operatorSmoke, requireOperatorSmoke) {
  if (report.schema !== SOURCE_SCHEMA) {
    throw fail('source-report-schema-mismatch', `source report must be ${SOURCE_SCHEMA}`, {
      sourceReportPath,
      actualSchema: report.schema || null,
    }, 'validate-source-reports');
  }
  if (report.status !== 'completed') {
    throw fail('source-report-not-completed', `source report status must be completed`, {
      sourceReportPath,
      status: report.status || null,
    }, 'validate-source-reports');
  }
  if (report.sequenceAuthority !== SEQUENCE_AUTHORITY) {
    throw fail('source-report-truth-authority-mismatch', `source report must carry ${SEQUENCE_AUTHORITY}`, {
      sourceReportPath,
      sequenceAuthority: report.sequenceAuthority || null,
    }, 'validate-source-reports');
  }
  if (report.syntheticAuthority !== SYNTHETIC_AUTHORITY) {
    throw fail('source-report-synthetic-authority-mismatch', `source report must label synthetic output as ${SYNTHETIC_AUTHORITY}`, {
      sourceReportPath,
      syntheticAuthority: report.syntheticAuthority || null,
    }, 'validate-source-reports');
  }
  if (!report.sequence || !report.sequence.effectiveRoute) {
    throw fail('source-report-effective-route-missing', 'source report is missing sequence.effectiveRoute', { sourceReportPath }, 'validate-source-reports');
  }
  if (!report.sequence.backend) {
    throw fail('source-report-backend-missing', 'source report is missing sequence.backend', { sourceReportPath }, 'validate-source-reports');
  }
  if (!Number.isFinite(Number(report.totalFrameCount)) || !Number.isFinite(Number(report.cadence))) {
    throw fail('source-report-cadence-identity-missing', 'source report is missing totalFrameCount or cadence', {
      sourceReportPath,
      totalFrameCount: report.totalFrameCount || null,
      cadence: report.cadence || null,
    }, 'validate-source-reports');
  }
  if (!Array.isArray(report.candidates) || report.candidates.length === 0) {
    throw fail('source-report-candidates-missing', 'source report has no candidates to judge', { sourceReportPath }, 'validate-source-reports');
  }
  if (requireOperatorSmoke && !operatorSmoke) {
    throw fail('operator-smoke-missing', 'operator smoke tag required but missing for source report', {
      sourceReportPath,
      sourceReportId: sourceReportIdFor(sourceReportPath),
    }, 'validate-source-reports');
  }
  for (const candidate of report.candidates) {
    if (!candidate.id) {
      throw fail('candidate-id-missing', 'candidate is missing id', { sourceReportPath }, 'validate-source-reports');
    }
    if (candidate.syntheticAuthority !== SYNTHETIC_AUTHORITY) {
      throw fail('candidate-synthetic-authority-mismatch', `candidate ${candidate.id} lacks ${SYNTHETIC_AUTHORITY}`, {
        sourceReportPath,
        candidateId: candidate.id,
        syntheticAuthority: candidate.syntheticAuthority || null,
      }, 'validate-source-reports');
    }
    if (candidate.actualMiddleUsed !== false) {
      throw fail('candidate-actual-middle-used', `candidate ${candidate.id} reports actualMiddleUsed != false`, {
        sourceReportPath,
        candidateId: candidate.id,
        actualMiddleUsed: candidate.actualMiddleUsed,
      }, 'validate-source-reports');
    }
  }
}

function candidateFailureModes(candidate) {
  const modes = [];
  if (Array.isArray(candidate.failureModes)) modes.push(...candidate.failureModes);
  for (const frame of candidate.syntheticCadenceFrames || []) {
    if (Array.isArray(frame.failureModes)) modes.push(...frame.failureModes);
  }
  for (const frame of candidate.syntheticOddFrames || []) {
    if (Array.isArray(frame.failureModes)) modes.push(...frame.failureModes);
  }
  for (const metric of candidate.perGapMetrics || []) {
    if (Array.isArray(metric.failureModes)) modes.push(...metric.failureModes);
  }
  return unique(modes.map(String));
}

function candidateVerdict(candidate, operatorSmoke, failureModes, riskScore) {
  const candidateFailures = Array.isArray(candidate.failures) ? candidate.failures.length : 0;
  const operatorVerdict = operatorSmoke ? operatorSmoke.verdict : 'untagged';
  if (candidateFailures > 0) return 'candidate-run-failed';
  if (operatorVerdict === 'fail-hard') return FORBIDDEN_VERDICT;
  if (operatorVerdict === 'partial-fail') return 'synthetic-fill-suspect-here';
  if (failureModes.some(mode => HARD_FAILURE_MODES.has(mode)) || riskScore >= 0.5) return 'exact-truth-risk-high-visual-review-required';
  if (operatorVerdict === 'tolerable') return 'synthetic-fill-operator-tolerated-but-not-cleared';
  return NOT_CLEARED_VERDICT;
}

function riskTagsFor(candidate, operatorSmoke, failureModes, riskScore) {
  const tags = [];
  if (operatorSmoke?.riskTags) tags.push(...operatorSmoke.riskTags);
  tags.push(...failureModes.filter(mode => FAILURE_MODE_BUCKETS.includes(mode)));
  if (riskScore >= 0.5) tags.push('metric-risk-high');
  if (Array.isArray(candidate.failures) && candidate.failures.length > 0) tags.push('candidate-run-failed');
  if (!operatorSmoke) tags.push('operator-smoke-absent');
  return unique(tags);
}

function sourceIdentity(sourceReportPath, report, operatorSmoke) {
  return {
    sourceReportPath,
    sourceReportId: sourceReportIdFor(sourceReportPath),
    schema: report.schema,
    status: report.status,
    createdAt: report.createdAt || null,
    updatedAt: report.updatedAt || null,
    reportPath: report.reportPath || null,
    playbackPath: report.playbackPath || null,
    requestedRoute: report.requestedRoute || null,
    qualityReason: extractQueryParam(report.requestedRoute || '', 'volume_quality_reason'),
    sequenceAuthority: report.sequenceAuthority || null,
    fullRateTruthAuthority: report.sequence?.fullRateTruthAuthority || null,
    syntheticAuthority: report.syntheticAuthority || null,
    effectiveRoute: report.sequence?.effectiveRoute || null,
    backend: report.sequence?.backend || null,
    prototypeIdentity: report.sequence?.prototypeIdentity || null,
    captureMode: report.sequence?.captureMode || null,
    totalFrameCount: report.totalFrameCount || report.sequence?.totalFrameCount || null,
    cadence: report.cadence || report.sequence?.cadence || null,
    realFrameCount: report.realFrameCount || report.sequence?.realFrameCount || null,
    anchorFrameCount: report.anchorFrameCount || null,
    frameStep: report.frameStep || report.sequence?.frameStep || null,
    denseCaptureFrameDeltas: denseDeltaSummary(report.sequence?.denseCaptureFrameDeltas),
    denseCaptureSimStepDeltas: denseDeltaSummary(report.sequence?.denseCaptureSimStepDeltas),
    candidateCount: Array.isArray(report.candidates) ? report.candidates.length : 0,
    candidateIds: (report.candidates || []).map(candidate => candidate.id),
    operatorSmoke: operatorSmoke ? {
      verdict: operatorSmoke.verdict,
      rawVerdict: operatorSmoke.rawVerdict,
      riskTags: operatorSmoke.riskTags,
      note: operatorSmoke.note,
      observedAt: operatorSmoke.observedAt,
      observer: operatorSmoke.observer,
      sourceFile: operatorSmoke.sourceFile,
    } : null,
  };
}

function candidateRisk(source, report, candidate, operatorSmoke) {
  const failureModes = candidateFailureModes(candidate);
  const riskScore = metricRisk(candidate.summaryMetrics || {});
  const verdict = candidateVerdict(candidate, operatorSmoke, failureModes, riskScore);
  return {
    sourceReportPath: source.sourceReportPath,
    sourceReportId: source.sourceReportId,
    requestedRoute: source.requestedRoute,
    qualityReason: source.qualityReason,
    effectiveRoute: source.effectiveRoute,
    backend: source.backend,
    sequenceAuthority: source.sequenceAuthority,
    syntheticAuthority: candidate.syntheticAuthority || null,
    actualMiddleUsed: candidate.actualMiddleUsed,
    candidateId: candidate.id,
    sourceKind: candidate.sourceKind || null,
    summaryMetrics: candidate.summaryMetrics || null,
    riskScore,
    failureModes,
    riskTags: riskTagsFor(candidate, operatorSmoke, failureModes, riskScore),
    operatorSmokeVerdict: operatorSmoke?.verdict || null,
    operatorSmokeNote: operatorSmoke?.note || null,
    completedSyntheticOddFrames: Array.isArray(candidate.syntheticOddFrames) ? candidate.syntheticOddFrames.length : 0,
    completedSyntheticCadenceFrames: Array.isArray(candidate.syntheticCadenceFrames) ? candidate.syntheticCadenceFrames.length : 0,
    failureCount: Array.isArray(candidate.failures) ? candidate.failures.length : 0,
    failures: candidate.failures || [],
    verdict,
    syntheticFillForbidden: verdict === FORBIDDEN_VERDICT,
  };
}

function failureModeCounts(candidateRisks) {
  const counts = {};
  for (const risk of candidateRisks) {
    for (const mode of risk.failureModes || []) counts[mode] = (counts[mode] || 0) + 1;
  }
  return counts;
}

function sourceVerdicts(sourceReports, candidateRisks) {
  return sourceReports.map(source => {
    const risks = candidateRisks.filter(risk => risk.sourceReportPath === source.sourceReportPath);
    const forbidden = risks.filter(risk => risk.verdict === FORBIDDEN_VERDICT);
    const failed = risks.filter(risk => risk.verdict === 'candidate-run-failed');
    const high = risks.filter(risk => risk.verdict === 'exact-truth-risk-high-visual-review-required');
    const partial = risks.filter(risk => risk.verdict === 'synthetic-fill-suspect-here');
    let verdict = NOT_CLEARED_VERDICT;
    if (forbidden.length > 0) verdict = FORBIDDEN_VERDICT;
    else if (failed.length > 0) verdict = 'candidate-runs-failed';
    else if (partial.length > 0) verdict = 'synthetic-fill-suspect-here';
    else if (high.length > 0) verdict = 'exact-truth-risk-high-visual-review-required';
    return {
      sourceReportPath: source.sourceReportPath,
      sourceReportId: source.sourceReportId,
      qualityReason: source.qualityReason,
      operatorSmokeVerdict: source.operatorSmoke?.verdict || null,
      verdict,
      candidateCount: risks.length,
      forbiddenCandidateCount: forbidden.length,
      failedCandidateCount: failed.length,
      highRiskCandidateCount: high.length,
    };
  });
}

function htmlEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function writeHtmlSummary(path, report) {
  const rows = report.candidateRisks.map(risk => `<tr>
    <td>${htmlEscape(risk.sourceReportId)}</td>
    <td>${htmlEscape(risk.candidateId)}</td>
    <td>${htmlEscape(risk.verdict)}</td>
    <td>${htmlEscape(risk.operatorSmokeVerdict || 'untagged')}</td>
    <td>${htmlEscape(risk.riskScore)}</td>
    <td>${htmlEscape((risk.failureModes || []).join(', '))}</td>
  </tr>`).join('\n');
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Kaminos Interframe Gap Risk Report</title>
  <style>
    body { margin: 24px; background: #080c0f; color: #d9e3ea; font: 14px system-ui, sans-serif; }
    h1 { font-size: 22px; margin: 0 0 12px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #24333a; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #10181d; }
    .meta { color: #9eb0bb; margin: 0 0 16px; }
  </style>
</head>
<body>
  <h1>Kaminos Interframe Gap Risk Report</h1>
  <p class="meta">${htmlEscape(report.schema)}; ${htmlEscape(report.status)}; synthetic frames are ${htmlEscape(SYNTHETIC_AUTHORITY)}</p>
  <table>
    <thead><tr><th>Source</th><th>Candidate</th><th>Verdict</th><th>Operator</th><th>Risk</th><th>Failure Modes</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
}

function buildSummary(sourceReports, candidateRisks) {
  const sourceVerdictRows = sourceVerdicts(sourceReports, candidateRisks);
  const forbiddenCandidateCount = candidateRisks.filter(risk => risk.verdict === FORBIDDEN_VERDICT).length;
  const failedCandidateCount = candidateRisks.filter(risk => risk.verdict === 'candidate-run-failed').length;
  const operatorTaggedSourceCount = sourceReports.filter(source => source.operatorSmoke).length;
  const metricBestBySource = [];
  for (const source of sourceReports) {
    const risks = candidateRisks
      .filter(risk => risk.sourceReportPath === source.sourceReportPath && risk.summaryMetrics)
      .sort((a, b) => Number(a.summaryMetrics.meanAbsoluteError || Infinity) - Number(b.summaryMetrics.meanAbsoluteError || Infinity));
    if (risks[0]) {
      metricBestBySource.push({
        sourceReportId: source.sourceReportId,
        candidateId: risks[0].candidateId,
        meanAbsoluteError: risks[0].summaryMetrics.meanAbsoluteError,
        verdict: risks[0].verdict,
      });
    }
  }
  return {
    sourceReportCount: sourceReports.length,
    candidateCount: candidateRisks.length,
    operatorTaggedSourceCount,
    forbiddenCandidateCount,
    failedCandidateCount,
    sourceVerdicts: sourceVerdictRows,
    failureModeCounts: failureModeCounts(candidateRisks),
    metricBestBySource,
    verdict: forbiddenCandidateCount > 0
      ? 'tagged-routes-contain-forbidden-synthetic-fill'
      : 'no-synthetic-fill-clearance-from-this-report',
  };
}

const cwd = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
let phase = 'parse-args';
const createdAt = new Date().toISOString();
const args = parseArgs(process.argv.slice(2));

if (args.has('--help')) {
  console.log(usage());
  process.exit(0);
}

const outDir = resolve(args.one('--out-dir', '/tmp/kaminos-interframe-gap-risk-report'));
const reportPath = resolve(args.one('--report', `${outDir}/interframe-gap-risk-report.json`));
const htmlPath = args.one('--html', null) ? resolve(args.one('--html')) : null;
const requireOperatorSmoke = args.has('--require-operator-smoke');
const sourceReportPaths = args.many('--source-report').flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean).map(value => resolve(value));
const operatorSmokePaths = args.many('--operator-smoke-file');
const inlineOperatorSmoke = args.many('--operator-smoke');
const gitCommit = gitValue(['rev-parse', 'HEAD']);
const gitBranch = gitValue(['branch', '--show-current']);
const gitStatusShort = gitValue(['status', '--short'], '');
const lastTrustworthyEvidence = {
  sourceReportPaths,
  operatorSmokePaths: operatorSmokePaths.map(value => resolve(value)),
  inlineOperatorSmokeCount: inlineOperatorSmoke.length,
  requireOperatorSmoke,
};

try {
  if (sourceReportPaths.length === 0) {
    throw fail('source-report-missing', 'at least one --source-report is required', {}, 'parse-args');
  }

  phase = 'load-operator-smoke';
  const { observationsByKey, sourceFiles: operatorSmokeFiles } = readOperatorSmokeFiles(operatorSmokePaths);
  for (const [key, observation] of readInlineOperatorSmoke(inlineOperatorSmoke).entries()) observationsByKey.set(key, observation);

  phase = 'load-source-reports';
  const loaded = [];
  for (const sourceReportPath of sourceReportPaths) {
    if (!existsSync(sourceReportPath)) {
      throw fail('source-report-file-missing', `source report does not exist: ${sourceReportPath}`, { sourceReportPath }, 'load-source-reports');
    }
    loaded.push({
      path: sourceReportPath,
      report: readJson(sourceReportPath),
    });
  }
  lastTrustworthyEvidence.loadedSourceReportCount = loaded.length;

  phase = 'validate-source-reports';
  const sourceReports = [];
  const candidateRisks = [];
  for (const source of loaded) {
    const operatorSmoke = lookupOperatorSmoke(source.path, source.report, observationsByKey);
    validateSourceReport(source.path, source.report, operatorSmoke, requireOperatorSmoke);
    const identity = sourceIdentity(source.path, source.report, operatorSmoke);
    sourceReports.push(identity);
    for (const candidate of source.report.candidates) {
      candidateRisks.push(candidateRisk(identity, source.report, candidate, operatorSmoke));
    }
  }

  phase = 'write-report';
  const report = {
    schema: SCHEMA,
    status: 'completed',
    createdAt,
    updatedAt: new Date().toISOString(),
    cwd,
    gitCommit,
    gitBranch,
    gitStatusShort,
    reportPath,
    htmlPath,
    sourceSchema: SOURCE_SCHEMA,
    operatorSmokeSchema: OPERATOR_SMOKE_SCHEMA,
    sequenceAuthority: SEQUENCE_AUTHORITY,
    syntheticAuthority: SYNTHETIC_AUTHORITY,
    operatorSmokeRequired: requireOperatorSmoke,
    operatorSmokeFiles,
    sourceReports,
    candidateRisks,
    summary: buildSummary(sourceReports, candidateRisks),
    artifacts: {
      reportJson: reportPath,
      html: htmlPath,
    },
    failures: [],
  };
  if (htmlPath) writeHtmlSummary(htmlPath, report);
  writeJson(reportPath, report);
  console.log(JSON.stringify({
    schema: SCHEMA,
    status: report.status,
    reportPath,
    htmlPath,
    sourceReportCount: report.summary.sourceReportCount,
    candidateCount: report.summary.candidateCount,
    forbiddenCandidateCount: report.summary.forbiddenCandidateCount,
    verdict: report.summary.verdict,
  }, null, 2));
} catch (error) {
  const failed = {
    schema: SCHEMA,
    status: 'failed',
    createdAt,
    updatedAt: new Date().toISOString(),
    cwd,
    gitCommit,
    gitBranch,
    gitStatusShort,
    reportPath,
    htmlPath,
    sourceSchema: SOURCE_SCHEMA,
    operatorSmokeSchema: OPERATOR_SMOKE_SCHEMA,
    sequenceAuthority: SEQUENCE_AUTHORITY,
    syntheticAuthority: SYNTHETIC_AUTHORITY,
    operatorSmokeRequired: requireOperatorSmoke,
    failurePhase: error.failurePhase || phase,
    lastTrustworthyEvidence,
    failures: [{
      code: error.code || 'interframe-gap-risk-report-failed',
      message: error.message,
      failurePhase: error.failurePhase || phase,
      details: error.details || null,
      stack: error.stack,
    }],
  };
  writeJson(reportPath, failed);
  console.error(JSON.stringify(failed.failures[0], null, 2));
  process.exitCode = 1;
}
