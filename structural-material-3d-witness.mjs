#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  STRUCTURAL_MATERIAL_3D_ROUTE,
  buildLayeredStructuralWitnessScenario,
} from './structural-material-3d-core.js';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1] ?? '');
}

const outArg = args.get('--out') || 'artifacts/structural-material-3d/layered-sidecar.json';
const reportArg = args.get('--report') || outArg.replace(/\.json$/i, '-report.json');
const out = resolve(outArg);
const reportPath = resolve(reportArg);

function writeReport(payload) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`);
}

let failurePhase = null;
try {
  failurePhase = 'build-scenario';
  const scenario = buildLayeredStructuralWitnessScenario({
    magnitude: Number(args.get('--magnitude') || 1.46),
    forceY: Number(args.get('--force-y') || 0.52),
    forceZ: Number(args.get('--force-z') || 0.85),
  });

  failurePhase = 'write-sidecar';
  const sidecar = {
    schema: scenario.schema,
    requestedRoute: STRUCTURAL_MATERIAL_3D_ROUTE,
    effectiveRoute: scenario.effectiveRoute,
    solverAuthority: scenario.solverAuthority,
    geometryAuthority: scenario.geometryAuthority,
    visualConsumerAuthority: scenario.visualConsumerAuthority,
    claimBoundary: 'deterministic layered structural graph witness; not engineering-exact fracture prediction',
    force: scenario.force,
    summaries: scenario.summaries,
    sidecar: scenario.summaries.cracked.sidecar,
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(sidecar, null, 2)}\n`);

  failurePhase = 'write-report';
  writeReport({
    ok: true,
    failurePhase: null,
    requestedRoute: STRUCTURAL_MATERIAL_3D_ROUTE,
    effectiveRoute: scenario.effectiveRoute,
    output: outArg,
    reportPath: reportArg,
    crackedBrokenBonds: scenario.summaries.cracked.brokenBondCount,
    brokenDepthBonds: scenario.summaries.cracked.brokenDepthBondCount,
    controlBrokenBonds: scenario.summaries.control.brokenBondCount,
    repairedBonds: scenario.summaries.bound.repairedBondCount,
    soundSignature: scenario.summaries.cracked.sound.signature,
  });

  console.log(JSON.stringify({
    ok: true,
    requestedRoute: STRUCTURAL_MATERIAL_3D_ROUTE,
    effectiveRoute: scenario.effectiveRoute,
    out,
    report: reportPath,
    crackedBrokenBonds: scenario.summaries.cracked.brokenBondCount,
    brokenDepthBonds: scenario.summaries.cracked.brokenDepthBondCount,
    repairedBonds: scenario.summaries.bound.repairedBondCount,
  }, null, 2));
} catch (error) {
  writeReport({
    ok: false,
    failurePhase,
    requestedRoute: STRUCTURAL_MATERIAL_3D_ROUTE,
    effectiveRoute: null,
    output: outArg,
    reportPath: reportArg,
    error: error instanceof Error ? error.message : String(error),
  });
  throw error;
}
