#!/usr/bin/env node
// Warnings for the advisory tests workflow (.github/workflows/tests.yml).
//
// The workflow never fails on test results, so this step is the only place a
// problem shows: everything the runner itself would call a failure becomes a
// warning annotation and a line in the step summary. A run that stays green
// and says nothing must mean there was nothing to say.
//
//   node tools/ci-advisory-warnings.mjs <report.json> <serve outcome> <suite outcome>
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const notRun = (step) => `${step} did not run (an earlier step failed)`;
const firstLine = (text) => String(text ?? '').split('\n')[0];

export function advisoryWarnings({ report: r, serve, suite }) {
  const out = [];
  if (serve === 'skipped') out.push(notRun('serve.py check'));
  else if (serve !== 'success') out.push('serve.py did not answer within 10 s');
  if (!r) {
    out.push(suite === 'skipped' ? notRun('suite') : `no suite report (suite step ${suite})`);
  } else {
    if (r.failurePhase) out.push(`runner failed in phase ${r.failurePhase}: ${firstLine(r.error)}`);
    const each = (label, items, show = (x) => x) => { for (const item of items || []) out.push(`${label}: ${show(item)}`); };
    each('new failure', r.newFailures);
    each('unsigned failure', (r.results || []).filter(x => x.outcome === 'unsigned-failure'), x => x.file);
    each('changed failure signature', r.signatureChanged, x => x.file);
    each('quarantined test now passes', r.staleQuarantine);
    each('unclassified test file', r.unclassified);
    each('invalid classification', r.invalid, x => (typeof x === 'string' ? x : x.file || JSON.stringify(x)));
    each('invalid quarantine entry', r.invalidQuarantine, x => (typeof x === 'string' ? x : x.file || JSON.stringify(x)));
    each('selector matched nothing', r.unmatchedSelectors);
    each('browser launch reached by a test', r.browserLaunchAttempts, x => x.file);
    each('test root neither run nor excluded', r.uncoveredTestRoots);
    each('manifest entry for a missing file', r.orphans?.manifest);
    each('quarantine entry for a missing file', r.orphans?.quarantine);
    each('warning', r.warnings, w => (typeof w === 'string' ? w : w.message || JSON.stringify(w)));
    if (!out.length && suite !== 'success') out.push(`suite step ${suite} without a reason in its report`);
  }
  return out.map(line => line.replace(/\r?\n/g, ' '));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const [reportPath, serve, suite] = process.argv.slice(2);
  let report = null;
  try { report = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch {}
  const lines = advisoryWarnings({ report, serve, suite });
  for (const line of lines) console.log(`::warning::${line.replace(/%/g, '%25')}`);
  const c = report?.counts;
  const head = c ? `executed ${c.executed}, passed ${c.passed}, known failures ${c.knownFailures}, new failures ${c.newFailures}, not run ${c.notRun}` : 'no report';
  const summary = `### Tests (advisory)\n\n${head}\n\n${lines.length ? lines.map(l => `- ${l}`).join('\n') : 'No warnings.'}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  else process.stdout.write(summary);
}
