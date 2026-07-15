#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { createCrucibleFlameContinuityComparison } from '../lib/crucible-flame-continuity-comparison.mjs';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith('--')) continue;
  const value = process.argv[index + 1];
  if (value && !value.startsWith('--')) {
    args.set(key, value);
    index += 1;
  } else {
    args.set(key, '1');
  }
}

const liveReportPath = args.get('--live-report') ? resolve(args.get('--live-report')) : null;
const holdoverReportPath = args.get('--holdover-report') ? resolve(args.get('--holdover-report')) : null;
const reportPath = args.get('--report') ? resolve(args.get('--report')) : null;
let phase = 'validating-arguments';
let comparisonWritten = false;

function writeReport(value) {
  if (!reportPath) return;
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(value, null, 2)}\n`);
}

try {
  if (!reportPath || !liveReportPath || !holdoverReportPath) {
    throw new Error('expected --live-report, --holdover-report, and --report');
  }
  phase = 'reading-witness-reports';
  const liveReport = JSON.parse(readFileSync(liveReportPath, 'utf8'));
  const holdoverReport = JSON.parse(readFileSync(holdoverReportPath, 'utf8'));
  const visualVerdict = args.get('--visual-verdict') || null;
  const visualNotes = args.get('--visual-notes') || null;
  const visualInspection = visualVerdict
    ? {
        status: 'inspected',
        verdict: visualVerdict,
        inspectedPaths: [liveReport.inFlightScreenshot, holdoverReport.inFlightScreenshot].filter(Boolean),
        notes: visualNotes,
      }
    : null;
  phase = 'comparing-witness-reports';
  const comparison = createCrucibleFlameContinuityComparison({ liveReport, holdoverReport, visualInspection });
  writeReport(comparison);
  comparisonWritten = true;
  if (comparison.status === 'invalid') throw new Error(`comparison invalid: ${comparison.failures.join(', ')}`);
  console.log(JSON.stringify({
    report: reportPath,
    status: comparison.status,
    classification: comparison.classification,
    outputHash: comparison.runs.live.output?.sha256 || null,
    cadenceDelta: comparison.cadenceDelta,
  }, null, 2));
} catch (error) {
  if (!comparisonWritten) {
    writeReport({
      schema: 'kaminos.crucible-flame-continuity-comparison-failure.v0',
      ok: false,
      phase,
      error: error?.message || String(error),
      liveReportPath,
      holdoverReportPath,
      reportPath,
      comparisonWritten: false,
    });
  }
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
}
