#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  KAMINOS_TRACKED_HAND_SURFACE_WITNESS_SCHEMA,
  buildFixturePerceptasiaHandPacket,
  composeTrackedHandSurface,
  renderTrackedHandSurfaceWitnessSvg,
} from './hand-surface-compositor-core.mjs';

const TOOL_ID = 'kaminos-hand-surface-compositor-witness-v0';
const REPORT_SCHEMA = 'kaminos.tracked-hand-surface-witness-report.v0';
const EFFECTIVE_FIXTURE = 'perceptasia-live-wilor-shape-fixture-v0';

function parseArgs(argv) {
  const args = {
    out: null,
    svg: null,
    fixture: 'live',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') args.out = argv[++index] || null;
    else if (arg === '--svg') args.svg = argv[++index] || null;
    else if (arg === '--fixture') args.fixture = argv[++index] || args.fixture;
  }
  return args;
}

function packetForFixture(fixture) {
  if (fixture === 'replay') {
    return buildFixturePerceptasiaHandPacket({
      sourceBackend: 'native_wilor_mini_mps_sidecar_replay',
      effectiveRoute: 'wilor_mini_mps_saved_image_replay',
      timestampMs: 1000,
    });
  }
  return buildFixturePerceptasiaHandPacket({
    sourceBackend: 'native_wilor_mini_mlx_detector_sidecar_live',
    effectiveRoute: 'native_wilor_mini_mlx_detector_sidecar_live',
    timestampMs: 1000,
    mano: {
      contract: 'wilor-mlx.mano.dense.v0',
      coordinate_space: 'wilor_camera_normalized',
      vertices: [
        { x: 0, y: 0, z: 0 },
        { x: 0.08, y: 0.02, z: 0 },
        { x: -0.02, y: 0.09, z: -0.02 },
      ],
      faces: [[0, 1, 2]],
    },
  });
}

const args = parseArgs(process.argv.slice(2));
if (!args.out) {
  console.error('Usage: node hand-surface-compositor-witness.mjs --out <path> [--svg <path>] [--fixture live|replay]');
  process.exit(2);
}

const requestedOut = args.out;
const out = resolve(requestedOut);
const svgPath = resolve(args.svg || out.replace(/\.json$/i, '.svg'));
const witness = composeTrackedHandSurface(packetForFixture(args.fixture), {
  requestedEndpoint: '/hand-control-sidecar-event',
  nowMs: 1040,
  maxFreshnessMs: 160,
  webcam: {
    source: 'live_webcam',
    visible: true,
    blank: false,
    frameId: 'witness-webcam-live-fixture',
    width: 1280,
    height: 720,
  },
  consumer: {
    id: 'lerms-hand-surface-field',
    schema: 'lerms.hand-surface-lerm-witness.v0',
    ownership: 'consumer',
  },
  attachments: [
    { id: 'red-lerm-palm', kind: 'lerm_placeholder', face: [0, 5, 9], barycentric: [0.22, 0.34, 0.44] },
    { id: 'yellow-lerm-index', kind: 'lerm_placeholder', face: [5, 6, 10], barycentric: [0.18, 0.48, 0.34] },
    { id: 'blue-lerm-ring', kind: 'lerm_placeholder', face: [13, 14, 18], barycentric: [0.24, 0.46, 0.3] },
  ],
  sceneDepth: { requested: false },
});
const svg = renderTrackedHandSurfaceWitnessSvg(witness, { width: 960, height: 540 });
const report = {
  schema: REPORT_SCHEMA,
  toolId: TOOL_ID,
  witnessSchema: KAMINOS_TRACKED_HAND_SURFACE_WITNESS_SCHEMA,
  effectiveFixture: EFFECTIVE_FIXTURE,
  requestedOut,
  outputPath: out,
  svgPath,
  fixture: args.fixture,
  witness,
};

mkdirSync(dirname(out), { recursive: true });
mkdirSync(dirname(svgPath), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2));
writeFileSync(svgPath, svg);
console.log(JSON.stringify({ ok: true, out, svgPath, authority: witness.authority }, null, 2));
