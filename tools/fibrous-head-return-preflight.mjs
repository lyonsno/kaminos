#!/usr/bin/env node
import { runFibrousHeadReturnPreflight } from '../fibrous-head-return-core.mjs';

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--') || index + 1 >= argv.length) throw new Error(`invalid argument ${key}`);
    values[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  for (const required of ['manifest', 'status', 'report']) {
    if (!values[required]) throw new Error(`--${required} is required`);
  }
  return values;
}

let reportPath = null;
try {
  const args = parseArgs(process.argv.slice(2));
  reportPath = args.report;
  const report = await runFibrousHeadReturnPreflight({
    manifestPath: args.manifest,
    statusPath: args.status,
    reportPath,
    completionReceiptPath: args['completion-receipt'] ?? null,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.state === 'cast_ready_for_triage') process.exitCode = 0;
  else if (report.state === 'pending_input') process.exitCode = 2;
  else process.exitCode = 1;
} catch (error) {
  process.stderr.write(`fibrous-head preflight failed${reportPath ? ` (${reportPath})` : ''}: ${error.message}\n`);
  process.exitCode = 1;
}
