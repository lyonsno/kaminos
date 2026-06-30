#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  createFingerJuiceHostPacket,
  createWorldFingerJuiceTransportPrototype,
  normalizeHillTerrainSamplePacket,
  normalizeWorldFingerJuiceEmitterPacket,
} from './lerms-finger-juice-core.js';

function usage() {
  return [
    'Usage: node lerms-finger-juice-host-packet.mjs [options]',
    '',
    'Options:',
    '  --out <path>              JSON output path',
    '  --packet-url <url>        URL Kaminos/Gutterglass can fetch for the emitted packet',
    '  --terrain-packet <path>   Hill terrain sample packet JSON',
    '  --terrain-data <path>     Hill terrain sample data JSON',
    '  --steps <count>           Solver steps to advance before emission',
    '  --dt <seconds>            Solver step size',
    '  --source-ref <ref>        Source ref embedded in the packet envelope',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    out: '/private/tmp/big-papa-finger-juice-host-packet.json',
    packetUrl: '/api/read?root=lerms-preview&path=big-papa-finger-juice-host-packet.json',
    terrainPacket: null,
    terrainData: null,
    steps: 180,
    dt: 1 / 60,
    sourceRef: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    const next = argv[index + 1];
    if (arg === '--out') {
      options.out = next;
      index += 1;
    } else if (arg === '--packet-url') {
      options.packetUrl = next;
      index += 1;
    } else if (arg === '--terrain-packet') {
      options.terrainPacket = next;
      index += 1;
    } else if (arg === '--terrain-data') {
      options.terrainData = next;
      index += 1;
    } else if (arg === '--steps') {
      options.steps = Math.max(1, Math.floor(Number(next) || options.steps));
      index += 1;
    } else if (arg === '--dt') {
      options.dt = Math.max(1 / 240, Math.min(1 / 15, Number(next) || options.dt));
      index += 1;
    } else if (arg === '--source-ref') {
      options.sourceRef = next;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}\n${usage()}`);
    }
  }
  return options;
}

function readJson(path, label) {
  if (!path) return null;
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new Error(`${label} not found: ${resolved}`);
  return JSON.parse(readFileSync(resolved, 'utf8'));
}

function fixtureEmitterPacket() {
  return normalizeWorldFingerJuiceEmitterPacket({
    packet_id: 'big-papa-host-packet-fixture-v0',
    source_route: 'big-papa/finger-juice/host-packet-cli-fixture',
    source_backend: 'deterministic-cpu-host-packet-fixture',
    source_frame_id: 'big-papa-host-packet-fixture-frame-v0',
    evidence_kind: 'synthetic_fixture',
    simulation_authority: 'synthetic_fixture',
    hand_sample_space: {
      id: 'big-papa.synthetic-host-packet-hand-space.v0',
      handedness: 'right',
      screen_x: 'operator_unmirrored',
    },
    lerms_world_frame: {
      id: 'lerms-underhill',
      units: 'normalized_world',
      projection_contract: 'sampled_triangle_mesh_rounded_channel_manifold_v0',
      world_from_hand_sample: 'host-packet-cli-fixture-transform-v0',
    },
    emitters: [
      {
        id: 'index',
        tip_index: 8,
        origin_world: [-0.22, 0.72, -0.72],
        aim_world: [0.2, 0.34, 1],
        motion_world: [0.05, 0, 0.12],
        extension: 0.96,
        chemistry: 'knockback',
        radius: 0.042,
        strength: 1.18,
        active: true,
        authority: { valid: true, stale: false, confidence: 0.96, force_safe: true },
      },
      {
        id: 'middle',
        tip_index: 12,
        origin_world: [0.0, 0.74, -0.68],
        aim_world: [0.04, 0.28, 1],
        motion_world: [0, 0, 0.16],
        extension: 0.94,
        chemistry: 'pooling',
        radius: 0.046,
        strength: 1.04,
        active: true,
        authority: { valid: true, stale: false, confidence: 0.95, force_safe: true },
      },
      {
        id: 'ring',
        tip_index: 16,
        origin_world: [0.2, 0.72, -0.7],
        aim_world: [-0.18, 0.26, 1],
        motion_world: [-0.04, 0, 0.13],
        extension: 0.9,
        chemistry: 'weird',
        radius: 0.044,
        strength: 0.98,
        active: true,
        authority: { valid: true, stale: false, confidence: 0.92, force_safe: true },
      },
    ],
  });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const prototype = createWorldFingerJuiceTransportPrototype({
    seed: 17,
    maxParticles: 4096,
    lerms: [{ id: 'red-lerm-1', position: [-0.18, 0.75, -0.48], radius: 0.26, mass: 1.1 }],
    goins: [{ id: 'goin-1', position: [0.0, 0.75, -0.28], radius: 0.3, mass: 2.2 }],
  });
  const emitterPacket = fixtureEmitterPacket();
  prototype.setEmitters(emitterPacket);
  const terrainPacket = readJson(options.terrainPacket, 'terrain packet');
  const terrainData = readJson(options.terrainData, 'terrain data');
  if (terrainPacket && terrainData) {
    const terrainSurface = normalizeHillTerrainSamplePacket(terrainPacket, terrainData, { stepCount: 0 });
    if (!terrainSurface) throw new Error('terrain packet/data did not normalize into a sample surface');
    prototype.setTerrainSampleSurface(terrainSurface);
  }
  for (let index = 0; index < options.steps; index += 1) {
    prototype.step(options.dt);
  }
  const packet = createFingerJuiceHostPacket(prototype.debugState(), {
    packetUrl: options.packetUrl,
    sourceRef: options.sourceRef,
  });
  const out = resolve(options.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(packet, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    ok: true,
    schema: packet.schema,
    route: packet.route,
    out,
    packetUrl: packet.packetUrl,
    particleCount: packet.solver.particleCount,
    terrainCoupling: packet.terrain.couplingMode,
    terrainSampleChecksum: packet.terrain.sampleChecksum,
    downgradedRenderPayload: packet.render.payload.downgraded,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    phase: 'big-papa-finger-juice-host-packet-emission',
    error: error.message,
  }, null, 2));
  process.exitCode = 1;
}
