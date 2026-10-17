#!/usr/bin/env node
// Warnings for the advisory tests workflow (.github/workflows/tests.yml).
//
// The workflow never fails on test results, so this step is the only place a
// problem shows: everything the runner itself would call a failure becomes a
// warning annotation and a line in the step summary. A run that stays green
// and says nothing must mean there was nothing to say.
//
//   node tools/ci-advisory-warnings.mjs <report.json> <serve outcome> <suite outcome> ["checkout=success npm=failure ..."] [superseding sha]
//
// Every run also gets one verdict notice. "tests clean" and "tests passed with
// warnings" mean the suite ran to a complete ok report with no new failures
// (the second also has warnings to read, which never refuse); "tests not
// clean" means the runner counted something against the run; "tests no
// result" means nothing usable was checked. A lane reads the verdict, never
// the absence of warnings.
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

export function advisoryWarnings({ report: r, serve, suite, setup = {}, superseded = null }) {
  // A branch run whose commit a newer push replaced checks nothing on purpose;
  // its verdict says so and it has nothing to warn about.
  if (superseded) return [];
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
    each('changed failure signature', 'signatureChanged', list('signatureChanged', r.signatureChanged).filter(x => !counted.has(x?.file)), x => x?.file ?? JSON.stringify(x));
    each('quarantined test now passes', 'staleQuarantine', r.staleQuarantine);
    each('unclassified test file', 'unclassified', r.unclassified);
    each('invalid classification', 'invalid', r.invalid, x => (typeof x === 'string' ? x : x?.file || JSON.stringify(x)));
    each('invalid quarantine entry', 'invalidQuarantine', r.invalidQuarantine, x => (typeof x === 'string' ? x : x?.file || JSON.stringify(x)));
    each('selector matched nothing', 'unmatchedSelectors', r.unmatchedSelectors);
    each('browser launch reached by a test', 'browserLaunchAttempts', r.browserLaunchAttempts, x => x?.file ?? JSON.stringify(x));
    each('test root neither run nor excluded', 'uncoveredTestRoots', r.uncoveredTestRoots);
    each('manifest entry for a missing file', 'orphans.manifest', r.orphans?.manifest);
    each('quarantine entry for a missing file', 'orphans.quarantine', r.orphans?.quarantine);
    each('warning', 'warnings', r.warnings, w => (typeof w === 'string' ? w : w?.message || JSON.stringify(w)));
    if (!out.length && suite !== 'success') out.push(`suite step ${suite} without a reason in its report`);
    else if (!out.length && r.ok !== true) out.push('report is not ok without a reason the runner names');
  }
  return out.map(line => line.replace(/\r?\n|\r/g, ' '));
}

export function advisoryVerdict({ report: r, serve, suite, setup = {}, superseded = null }) {
  if (superseded) return `tests no result: superseded by ${superseded}, a newer push to this branch; this commit was not checked`;
  const failedSetup = Object.entries(setup).filter(([, outcome]) => outcome !== 'success').map(([step]) => step);
  if (failedSetup.length) return `tests no result: setup step ${failedSetup.join(', ')} did not succeed, so nothing was checked`;
  if (!r) return `tests no result: no suite report (suite step ${suite || 'not run'})`;
  if (suite === 'skipped' || suite === 'cancelled') return `tests no result: the suite step was ${suite}`;
  const c = r.counts || {};
  const counts = `executed ${c.executed ?? '?'}, passed ${c.passed ?? '?'}, known failures ${c.knownFailures ?? '?'}, new failures ${c.newFailures ?? '?'}`;
  // Failures are what the runner itself counts against the run; warnings
  // (the runner's own, or a serve.py startup miss) are read but never refuse.
  const failures = advisoryWarnings({ report: { ...r, warnings: [] }, serve: 'success', suite, setup });
  const warnings = advisoryWarnings({ report: r, serve, suite, setup }).length - failures.length;
  if (r.ok === true && suite === 'success' && !failures.length) {
    const whole = ['executed', 'passed', 'knownFailures', 'newFailures'].every(k => Number.isInteger(c[k]) && c[k] >= 0);
    const why = !whole ? 'has no whole counts' : c.executed === 0 ? 'executed nothing'
      : c.passed + c.knownFailures + c.newFailures !== c.executed ? 'has counts that do not add up' : c.newFailures !== 0 ? 'counts new failures' : null;
    if (why) return `tests no result: the report says ok but ${why}`;
    if (!warnings) return `tests clean: ${counts}`;
    return `tests passed with warnings: ${warnings} warning${warnings === 1 ? '' : 's'} to read; ${counts}`;
  }
  return `tests not clean: ${failures.length || 1} problem${failures.length > 1 ? 's' : ''} (see the warnings); ${counts}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const [reportPath, serve, suite, setupText, superseded] = process.argv.slice(2);
  let report = null;
  try { report = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch {}
  const input = { report, serve, suite, setup: parseSetup(setupText), superseded: superseded || null };
  const lines = advisoryWarnings(input);
  const verdict = advisoryVerdict(input);
  console.log(`::notice title=tests::${verdict.replace(/%/g, '%25')}`);
  for (const line of lines) console.log(`::warning::${line.replace(/%/g, '%25')}`);
  const c = report?.counts;
  const head = c ? `executed ${c.executed}, passed ${c.passed}, known failures ${c.knownFailures}, new failures ${c.newFailures}, not run ${c.notRun}` : 'no report';
  const summary = `### Tests (advisory)\n\n**${verdict}**\n\n${head}\n\n${lines.length ? lines.map(l => `- ${l}`).join('\n') : 'No warnings.'}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  else process.stdout.write(summary);
}


