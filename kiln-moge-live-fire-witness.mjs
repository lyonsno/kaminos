#!/usr/bin/env node
/**
 * Kiln volume-fire witness fed by a LIVE MoGe route result instead of the
 * bridge fixture. Consumes the JSON a real moge-webgpu cooperative run emits
 * (kaminos.webgpu-route-result.v0), converts it to kiln route-activity fuel,
 * and writes the fire witness report.
 *
 * Usage:
 *   node kiln-moge-live-fire-witness.mjs --route-result <moge-result.json> --out <report.json>
 *
 * The report names its effective source (live route result path + requestId),
 * never pretending fixture data is live: a stub or fallback receipt converts
 * to non-live fuel and the witness shows it.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { buildKilnVolumeFireWitness } from './kiln-volume-fire-bridge.mjs';
import { routeActivityFromMogeRouteResult } from './kiln-moge-route-activity.mjs';

const TOOL_ID = 'beaming-kiln-moge-live-fire-witness-v0';
const REPORT_SCHEMA = 'beaming.volume-fire.moge-live-route-witness-report.v0';

function parseArgs(argv) {
  const args = { out: null, routeResult: null };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--out') args.out = argv[++index] || null;
    else if (arg === '--route-result') args.routeResult = argv[++index] || null;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.out || !args.routeResult) {
  console.error('Usage: node kiln-moge-live-fire-witness.mjs --route-result <moge-result.json> --out <report.json>');
  process.exit(2);
}

const routeResultPath = resolve(args.routeResult);
const routeResult = JSON.parse(readFileSync(routeResultPath, 'utf8'));
const activity = routeActivityFromMogeRouteResult(routeResult);
const witness = buildKilnVolumeFireWitness({
  witnessId: `moge-live-fire-${routeResult.requestId || 'unknown'}`,
  routeRuns: [activity],
});

const out = resolve(args.out);
const report = {
  schema: REPORT_SCHEMA,
  toolId: TOOL_ID,
  effectiveSource: {
    kind: 'moge-live-route-result',
    path: routeResultPath,
    requestId: routeResult.requestId || null,
    receiptStatus: routeResult.receipt?.status ?? null,
    schedulerVerificationStatus: routeResult.receipt?.runtime?.schedulerVerification?.status ?? null,
  },
  requestedOut: args.out,
  outputPath: out,
  activity,
  witness,
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  out,
  truthModeCounts: witness.truthModeCounts,
  fullBurnCount: witness.fullBurnCount,
  falseAuthorityViolations: witness.falseAuthorityViolations,
  truthWarnings: witness.truthWarnings,
}, null, 2));
