#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  KILN_IMAGE_IMPORT_TRAY_WITNESS_SCHEMA,
  buildFixtureImportTrayWitness,
} from './kiln-image-ledger.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const reportPath = resolve(args.get('--report') || '/tmp/kaminos-kiln-image-import-witness.json');
const requestedRoute = args.get('--requested-route') || 'openai_api';
const effectiveRoute = args.get('--effective-route') || 'fixture';
const fallbackReason = args.has('--fallback-reason') ? args.get('--fallback-reason') : 'openai_api_unconfigured';

let phase = 'initializing';

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    schema: KILN_IMAGE_IMPORT_TRAY_WITNESS_SCHEMA,
    requestedRoute,
    effectiveRoute,
    reportPath,
    phase,
    ...report,
  }, null, 2));
}

try {
  phase = 'building-witness';
  const witness = buildFixtureImportTrayWitness({
    requestedGeneratorRoute: requestedRoute,
    effectiveFallbackRoute: effectiveRoute,
    fallbackReason,
  });
  phase = 'writing-report';
  writeReport(witness);
} catch (error) {
  writeReport({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
