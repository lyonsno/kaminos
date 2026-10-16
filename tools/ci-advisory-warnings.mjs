#!/usr/bin/env node
// Warnings for the advisory tests workflow (.github/workflows/tests.yml).
//
// The workflow never fails on test results, so this step is the only place a
// problem shows: everything the runner itself would call a failure becomes a
// warning annotation and a line in the step summary. A run that stays green
// and says nothing must mean there was nothing to say.
//
//   node tools/ci-advisory-warnings.mjs <report.json> <serve outcome> <suite outcome> ["checkout=success npm=failure ..."]
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const firstLine = (text) => String(text ?? '').split(/\r?\n|\r/)[0];
const stepNote = (step, outcome) => outcome === 'skipped' ? `${step} did not run (an earlier step failed)`
  : outcome === 'cancelled' ? `${step} was cancelled` : null;

// Setup step outcomes as the workflow passes them: "name=outcome" pairs.
export function parseSetup(text) {
  const setup = {};
  for (const pair of String(text ?? '').split(/\s+/).filter(Boolean)) {
    const at = pair.indexOf('=');
    if (at > 0) setup[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return setup;
}

export function advisoryWarnings({ report: r, serve, suite, setup = {} }) {
  const out = [];
  for (const [step, outcome] of Object.entries(setup)) {
    if (outcome !== 'success') out.push(`setup step ${step} ${outcome === 'failure' ? 'failed' : `was ${outcome || 'not run'}`}, so the suite was not run and nothing was checked`);
  }
  if (serve !== 'success') out.push(stepNote('serve.py check', serve) || 'serve.py did not answer within 10 s');
  if (!r) {
    out.push(stepNote('suite', suite) || `no suite report (suite step ${suite})`);
  } else {
    if (r.failurePhase) out.push(`runner failed in phase ${r.failurePhase}: ${firstLine(r.error)}`);
    const list = (field, value) => {
      if (value === undefined || value === null) return [];
      if (Array.isArray(value)) return value;
      out.push(`report field ${field} is not a list`);
      return [];
    };
    const each = (label, field, value, show = (x) => x) => { for (const item of list(field, value)) out.push(`${label}: ${show(item)}`); };
    const counted = new Set(list('newFailures', r.newFailures));
    each('new failure', 'newFailures', [...counted]);
    each('unsigned failure', 'results', list('results', r.results).filter(x => x?.outcome === 'unsigned-failure' && !counted.has(x.file)), x => x.file);
    each('changed failure signature', 'signatureChanged', list('signatureChanged', r.signatureChanged).filter(x => !counted.has(x?.file)), x => x.file);
    each('quarantined test now passes', 'staleQuarantine', r.staleQuarantine);
    each('unclassified test file', 'unclassified', r.unclassified);
    each('invalid classification', 'invalid', r.invalid, x => (typeof x === 'string' ? x : x.file || JSON.stringify(x)));
    each('invalid quarantine entry', 'invalidQuarantine', r.invalidQuarantine, x => (typeof x === 'string' ? x : x.file || JSON.stringify(x)));
    each('selector matched nothing', 'unmatchedSelectors', r.unmatchedSelectors);
    each('browser launch reached by a test', 'browserLaunchAttempts', r.browserLaunchAttempts, x => x.file);
    each('test root neither run nor excluded', 'uncoveredTestRoots', r.uncoveredTestRoots);
    each('manifest entry for a missing file', 'orphans.manifest', r.orphans?.manifest);
    each('quarantine entry for a missing file', 'orphans.quarantine', r.orphans?.quarantine);
    each('warning', 'warnings', r.warnings, w => (typeof w === 'string' ? w : w.message || JSON.stringify(w)));
    if (!out.length && suite !== 'success') out.push(`suite step ${suite} without a reason in its report`);
    else if (!out.length && r.ok !== true) out.push('report is not ok without a reason the runner names');
  }
  return out.map(line => line.replace(/\r?\n|\r/g, ' '));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const [reportPath, serve, suite, setupText] = process.argv.slice(2);
  let report = null;
  try { report = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch {}
  const lines = advisoryWarnings({ report, serve, suite, setup: parseSetup(setupText) });
  for (const line of lines) console.log(`::warning::${line.replace(/%/g, '%25')}`);
  const c = report?.counts;
  const head = c ? `executed ${c.executed}, passed ${c.passed}, known failures ${c.knownFailures}, new failures ${c.newFailures}, not run ${c.notRun}` : 'no report';
  const summary = `### Tests (advisory)\n\n${head}\n\n${lines.length ? lines.map(l => `- ${l}`).join('\n') : 'No warnings.'}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  else process.stdout.write(summary);
}

