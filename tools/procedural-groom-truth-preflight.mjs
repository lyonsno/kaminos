#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { runProceduralGroomTruthPreflight } from '../procedural-groom-truth-core.mjs';

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`invalid argument ${key}`);
    values[key.slice(2)] = value;
  }
  for (const required of ['manifest', 'repo-root', 'report']) {
    if (!values[required]) throw new Error(`--${required} is required`);
  }
  return values;
}

let reportPath = null;
try {
  const args = parseArgs(process.argv.slice(2));
  reportPath = resolve(args.report);
  const manifestPath = resolve(args.manifest);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const report = await runProceduralGroomTruthPreflight({
    manifest,
    manifestDirectory: dirname(manifestPath),
    repoRoot: resolve(args['repo-root']),
    reportPath,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.state === 'representation_ready_for_visual_review' ? 0 : 1;
} catch (error) {
  const failure = {
    schema: 'kaminos.procedural-groom-truth-report.v0',
    state: 'preflight_failed',
    visualAdmission: false,
    scientificAdmission: false,
    failures: [error.message],
    lastTrustworthyEvidence: null,
  };
  if (reportPath) await writeFile(reportPath, `${JSON.stringify(failure, null, 2)}\n`);
  process.stderr.write(`procedural groom preflight failed: ${error.message}\n`);
  process.exitCode = 1;
}
