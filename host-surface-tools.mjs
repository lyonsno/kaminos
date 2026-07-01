#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FINGER_JUICE_HOST_ADAPTER,
  createFingerJuiceHostState,
} from './finger-juice-host-core.js';
import {
  LERMS_MOVING_TIMELINE_HOST_ADAPTER,
  createLermsMovingTimelineHostState,
} from './lerms-timeline-host-core.js';

export const KAMINOS_HOST_SURFACE_TOOLS_REPORT_SCHEMA = 'kaminos.host-surface.tools-report.v0';

const ADAPTERS = {
  'finger-juice': {
    adapter: FINGER_JUICE_HOST_ADAPTER,
    createState: createFingerJuiceHostState,
    queryFlag: 'kaminos_finger_juice_host',
    rootParam: 'finger_juice_host_root',
    pathParam: 'finger_juice_host_path',
    urlParam: 'finger_juice_host_url',
    requiredDowngrades: ['host_packet_preview_payload_not_native_render_buffer'],
    requiredCustody: [
      ['bigPapaOwns', 'custody missing bigPapaOwns'],
      ['kaminosOwns', 'custody missing kaminosOwns'],
    ],
  },
  'lerms-moving-timeline': {
    adapter: LERMS_MOVING_TIMELINE_HOST_ADAPTER,
    createState: createLermsMovingTimelineHostState,
    queryFlag: 'kaminos_lerms_moving_timeline_host',
    rootParam: 'lerms_actor_motion_timeline_root',
    pathParam: 'lerms_actor_motion_timeline_path',
    urlParam: 'lerms_actor_motion_timeline_url',
    fixedParams: {
      world_chamber: 'lerms-underhill',
      posture: 'inspect',
      bench: 'terrain-preview',
    },
    requiredDowngrades: ['timeline_playback_not_behavior_engine'],
    requiredCustody: [
      ['lermsOwns', 'custody missing lermsOwns'],
      ['kaminosOwns', 'custody missing kaminosOwns'],
    ],
  },
};

function usage() {
  return [
    'Usage: node host-surface-tools.mjs --adapter <id> --packet <path> [source options]',
    '',
    'Adapters:',
    '  finger-juice',
    '  lerms-moving-timeline',
    '',
    'Source options:',
    '  --source-url <url>       URL/path passed to the Kaminos host route',
    '  --root <root>            /api/read root for root/path host routes',
    '  --path <path>            /api/read path for root/path host routes',
    '  --server-origin <url>    Kaminos origin, default http://127.0.0.1:8100',
    '  --debug-port <port>      Chrome DevTools port for the emitted witness command',
    '  --settle-ms <ms>         Visual settle window for the emitted witness command',
    '  --hook-wait-ms <ms>      Host debug-hook wait window for the emitted witness command',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    adapter: null,
    packet: null,
    sourceUrl: null,
    root: null,
    path: null,
    serverOrigin: 'http://127.0.0.1:8100',
    debugPort: null,
    settleMs: null,
    hookWaitMs: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    const next = argv[index + 1];
    if (arg === '--adapter') {
      options.adapter = next;
      index += 1;
    } else if (arg === '--packet') {
      options.packet = next;
      index += 1;
    } else if (arg === '--source-url') {
      options.sourceUrl = next;
      index += 1;
    } else if (arg === '--root') {
      options.root = next;
      index += 1;
    } else if (arg === '--path') {
      options.path = next;
      index += 1;
    } else if (arg === '--server-origin') {
      options.serverOrigin = next;
      index += 1;
    } else if (arg === '--debug-port') {
      options.debugPort = Number(next);
      index += 1;
    } else if (arg === '--settle-ms') {
      options.settleMs = Number(next);
      index += 1;
    } else if (arg === '--hook-wait-ms') {
      options.hookWaitMs = Number(next);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function readJson(path) {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new Error(`packet not found: ${resolved}`);
  return JSON.parse(readFileSync(resolved, 'utf8'));
}

function adapterConfig(adapterId) {
  const config = ADAPTERS[adapterId];
  if (!config) {
    throw new Error(`unknown host-surface adapter: ${adapterId || 'missing'}`);
  }
  return config;
}

function sourceDowngradesFor(adapterId, packet) {
  if (adapterId === 'lerms-moving-timeline') {
    const timeline = packet?.timeline || packet;
    return Array.isArray(timeline?.downgrades) ? timeline.downgrades : [];
  }
  if (adapterId === 'finger-juice') {
    return [
      ...(Array.isArray(packet?.custody?.downgrades) ? packet.custody.downgrades : []),
      ...(Array.isArray(packet?.render?.payload?.downgrades) ? packet.render.payload.downgrades : []),
    ];
  }
  return [];
}

function sourceCustodyFor(adapterId, packet, state) {
  if (adapterId === 'lerms-moving-timeline') return packet?.timeline?.custody || packet?.custody || {};
  return packet?.custody || {};
}

function sourceRouteError(options = {}) {
  const hasSourceUrl = Boolean(options.sourceUrl);
  const hasRoot = Boolean(options.root);
  const hasPath = Boolean(options.path);
  const hasRootPath = hasRoot && hasPath;
  if (hasSourceUrl && (hasRoot || hasPath)) {
    return 'source route must use either source-url or root/path, not both';
  }
  if (!hasSourceUrl && !hasRootPath) {
    return 'missing source route: provide --source-url or both --root and --path';
  }
  if (!hasSourceUrl && (hasRoot || hasPath) && !hasRootPath) {
    return 'missing source route: root/path routes require both --root and --path';
  }
  return null;
}

function normalizeServerOrigin(serverOrigin = 'http://127.0.0.1:8100') {
  return String(serverOrigin || 'http://127.0.0.1:8100').replace(/\/+$/, '');
}

export function buildHostSurfaceSmokeUrl(options = {}) {
  const config = adapterConfig(options.adapter);
  const url = new URL('/index.html', normalizeServerOrigin(options.serverOrigin));
  url.searchParams.set(config.queryFlag, '1');
  for (const [key, value] of Object.entries(config.fixedParams || {})) {
    url.searchParams.set(key, value);
  }
  if (options.sourceUrl) {
    url.searchParams.set(config.urlParam, options.sourceUrl);
  } else if (options.root && options.path) {
    url.searchParams.set(config.rootParam, options.root);
    url.searchParams.set(config.pathParam, options.path);
  }
  return url.href;
}

function quoteShell(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=,%@+-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

export function buildHostSurfaceWitnessCommand(report, options = {}) {
  const out = options.out || `/tmp/kaminos-${report.hostId || 'host-surface'}-witness.png`;
  const reportPath = options.report || out.replace(/\.png$/i, '.json');
  const args = [
    'node',
    'host-surface-witness.mjs',
    '--url', report.smokeUrl,
    '--expected-host-id', report.hostId,
    '--expected-host-route', report.hostRoute,
    '--expected-packet-schema', report.packetSchema,
    '--expected-packet-route', report.packetRoute,
    '--expected-downgrade', report.primaryDowngrade || report.downgrades?.[0] || '',
    '--out', out,
    '--report', reportPath,
  ].filter(value => value !== '');
  if (Number.isFinite(options.debugPort)) args.push('--debug-port', String(options.debugPort));
  if (Number.isFinite(options.settleMs)) args.push('--settle-ms', String(options.settleMs));
  if (Number.isFinite(options.hookWaitMs)) args.push('--hook-wait-ms', String(options.hookWaitMs));
  return args.map(quoteShell).join(' ');
}

export function lintHostSurfacePacket(packet, options = {}) {
  const config = adapterConfig(options.adapter);
  const errors = [];
  let state = null;
  try {
    state = config.createState(packet, {
      effectiveUrl: options.sourceUrl || (options.root && options.path ? `/api/read?root=${encodeURIComponent(options.root)}&path=${encodeURIComponent(options.path)}` : null),
      payloadSource: {
        mode: options.sourceUrl ? 'external_url' : options.root && options.path ? 'server_file' : 'direct_packet',
        requestedUrl: options.sourceUrl || null,
        root: options.root || null,
        path: options.path || null,
      },
    });
  } catch (error) {
    errors.push(`normalization failed: ${error.message || error}`);
  }

  const adapter = config.adapter;
  const sourceDowngrades = sourceDowngradesFor(options.adapter, packet);
  const sourceCustody = sourceCustodyFor(options.adapter, packet, state);
  for (const downgrade of config.requiredDowngrades) {
    if (!sourceDowngrades.includes(downgrade)) {
      errors.push(`missing required downgrade: ${downgrade}`);
    }
  }
  for (const [field, message] of config.requiredCustody) {
    if (!Array.isArray(sourceCustody[field]) || sourceCustody[field].length === 0) {
      errors.push(message);
    }
  }
  const routeError = sourceRouteError(options);
  if (routeError) errors.push(routeError);

  const smokeUrl = routeError ? null : buildHostSurfaceSmokeUrl(options);
  const downgrades = state?.downgrades || sourceDowngrades;
  const report = {
    ok: errors.length === 0,
    schema: KAMINOS_HOST_SURFACE_TOOLS_REPORT_SCHEMA,
    adapter: options.adapter,
    hostId: state?.hostId || adapter.hostId,
    hostLabel: state?.hostLabel || adapter.hostLabel,
    hostRoute: state?.hostRoute || adapter.hostRoute,
    hostStateSchema: state?.schema || adapter.hostStateSchema,
    packetSchema: state?.packetSchema || adapter.packetSchema,
    packetRoute: state?.packetRoute || adapter.packetRoute,
    sourceAuthority: state?.sourceAuthority || adapter.defaultSourceAuthority,
    sourceTruthAuthority: state?.sourceTruthAuthority || adapter.defaultSourceTruthAuthority,
    freshness: state?.freshness || null,
    downgrades,
    primaryDowngrade: config.requiredDowngrades[0] || downgrades[0] || null,
    rejectedDebugSurfaces: state?.rejectedDebugSurfaces || adapter.defaultRejectedDebugSurfaces || [],
    custody: state?.custody || sourceCustody,
    errors,
    warnings: [],
    errorCount: errors.length,
    warningCount: 0,
    smokeUrl,
  };
  report.witnessCommand = smokeUrl ? buildHostSurfaceWitnessCommand(report, options) : null;
  return report;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.adapter) throw new Error('missing --adapter');
  if (!options.packet) throw new Error('missing --packet');
  const packet = readJson(options.packet);
  const report = lintHostSurfacePacket(packet, options);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      schema: KAMINOS_HOST_SURFACE_TOOLS_REPORT_SCHEMA,
      error: error.message || String(error),
    }, null, 2));
    process.exitCode = 1;
  }
}
