#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  evaluateSmokeBenchNativeHostConformance,
  routeSmokeBenchOfferToTarget,
} from './smoke-bench-core.js';

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args.set(item, 'true');
    } else {
      args.set(item, next);
      index += 1;
    }
  }
  return args;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

const args = parseArgs(process.argv.slice(2));
const fixturePath = args.get('--fixture');
const offerPath = args.get('--offer');
const routePath = args.get('--route');
const adapterStatePath = args.get('--adapter-state');
const outPath = resolve(args.get('--out') || '/tmp/kaminos-smoke-bench-native-host-conformance.json');
const screenshotPath = args.get('--screenshot') || null;
const requiredPrimitiveRoles = String(args.get('--required-roles') || '')
  .split(',')
  .map(item => item.trim())
  .filter(Boolean);

let phase = 'read-input';
let report;
try {
  const fixture = fixturePath ? readJson(fixturePath) : {};
  const offer = offerPath ? readJson(offerPath) : fixture.offer || null;
  const route = routePath
    ? readJson(routePath)
    : fixture.route || (offer ? routeSmokeBenchOfferToTarget(offer) : null);
  const adapterState = adapterStatePath
    ? readJson(adapterStatePath)
    : fixture.adapterState || null;
  const roles = requiredPrimitiveRoles.length
    ? requiredPrimitiveRoles
    : fixture.requiredPrimitiveRoles || [];
  phase = 'evaluate-conformance';
  report = evaluateSmokeBenchNativeHostConformance({
    route,
    adapterState,
    requiredPrimitiveRoles: roles,
    screenshot: screenshotPath
      ? {
          path: screenshotPath,
          bytes: fixture.screenshot?.bytes ?? null,
        }
      : fixture.screenshot || null,
    observedAt: fixture.observedAt,
  });
  phase = 'write-report';
  writeJson(outPath, {
    schema: 'kaminos.smoke-bench.native-host-witness-report.v0',
    ok: report.ok,
    phase,
    source: {
      fixturePath: fixturePath || null,
      offerPath: offerPath || null,
      routePath: routePath || null,
      adapterStatePath: adapterStatePath || null,
    },
    report,
  });
  if (!report.ok) {
    console.error(`Smoke Bench native-host conformance failed: ${report.violations.join('; ')}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, out: outPath, adapterId: report.effective.adapterId }, null, 2));
} catch (error) {
  writeJson(outPath, {
    schema: 'kaminos.smoke-bench.native-host-witness-report.v0',
    ok: false,
    phase,
    error: String(error?.stack || error?.message || error),
  });
  console.error(`Smoke Bench native-host witness failed during ${phase}: ${String(error?.message || error)}`);
  process.exit(1);
}
