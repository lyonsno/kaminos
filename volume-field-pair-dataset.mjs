#!/usr/bin/env node
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';

const DATASET_SCHEMA = 'kaminos.volume.field-pair-dataset.v0';
const FIELD_PROJECTION_TENSOR_SCHEMA = 'kaminos.volume.field-projection-tensor.v0';
const FIELD_TILE_EXPORT_SCHEMA = 'kaminos.volume.field-tile-export.v0';
const FIELD_TILE_COVERAGE_PAIRING_SCHEMA = 'kaminos.volume.field-tile-coverage-pairing.v0';
const SAME_STATE_FREEZE_PREFLIGHT_SCHEMA = 'kaminos.volume.same-state-freeze-preflight.v0';
const ROUTE_VARIANT_PREFLIGHT_SCHEMA = 'kaminos.volume.route-variant-preflight.v0';
const NORMALIZED_TILE_PAIRING_IDENTITY = 'normalized-tile-center-nearest-neighbor-v0';
const COMMON_SPATIAL_BIN_PAIRING_IDENTITY = 'common-spatial-bin-nearest-neighbor-v0';
const EXPECTED_VOLUME_ROUTE_ID = 'native-3d-compute-fluid-raymarch-v0';
const EXPECTED_PROTOTYPE_ID = 'kaminos-volume-prototype-v0';
const SEQUENTIAL_PAIR_AUTHORITY = 'route-paired-sequential-field-readbacks-not-frame-locked';
const DETERMINISTIC_REPLAY_PAIR_AUTHORITY = 'deterministic-replay-same-route-controls-fixed-step-not-state-transfer';
const DETERMINISTIC_REPLAY_IDENTITY = 'deterministic-replay-same-route-controls-fixed-step-v0';
const FIELD_AUTHORITY = 'webgpu-copy-src-readback-simReadback-summary-and-majorant';
const WITNESS_BROWSER_REUSE_IDENTITY = 'shared-headful-cdp-browser-v0';
const WITNESS_BROWSER_ATTACH_IDENTITY = 'attach-or-launch-shared-cdp-browser-v0';
const DEFAULT_BASE_URL = 'http://127.0.0.1:8097/?kaminos_volume_smoke=1&volume_scene=tall_plume&volume_tall_preset=operator_fire_0622&volume_resolution=128&volume_majorant_grid=48&volume_steps=148&volume_adaptive_rays=0.75&volume_density=3.05&volume_fire=0.50&volume_radiance=3&volume_absorption=0&volume_glow=2.5&volume_smoke=2.8&volume_curl=3.5&volume_microdetail=2.5&volume_interface_shred=0&volume_fire_licks=0&volume_projection=1.5&volume_speed=5&volume_fire_scale=0.59&volume_detail_scale=0.45&volume_plume_height=2.2&volume_wind_strength=0&volume_wind_angle=180&volume_wind_height=-0.8&volume_input_radius=0.11&volume_flow_rate=0.35&volume_reaction_fuel=1&volume_majorant_cadence=1&volume_pressure_iterations=2&volume_pressure_strategy=global&volume_sim_profile=1&volume_temporal_accum=0&volume_temporal_jitter=0&volume_history_clamp=1&volume_occupancy_skip=0.1&volume_majorant_skip=0&volume_majorant_smooth=0.1&volume_majorant_guard=0.3';
const SUPPORTED_GRIDS = [96, 128, 160, 192];
const SUPPORTED_MAJORANT_GRIDS = [24, 32, 48];

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed.set(key, next);
      index += 1;
    } else {
      parsed.set(key, true);
    }
  }
  return parsed;
}

function numberList(value, fallback) {
  const source = String(value || fallback).split(',');
  const numbers = source
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry));
  return numbers.length ? numbers : String(fallback).split(',').map(Number);
}

function stringList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function nearestSupported(value, supported, fallback) {
  const requested = Number(value);
  if (!Number.isFinite(requested)) return fallback;
  return supported.reduce((best, candidate) => (
    Math.abs(candidate - requested) < Math.abs(best - requested) ? candidate : best
  ), fallback);
}

function gridSlug(value) {
  return `g${nearestSupported(value, SUPPORTED_GRIDS, 96)}`;
}

function replayStartSlug(value) {
  const text = String(Number(value)).replace(/[^0-9a-z]+/gi, 'p');
  return `replay-start-${text}ms`;
}

function slugify(value, fallback = 'variant') {
  const slug = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function writeJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function cdpFetchForPort(port, path, options) {
  const resp = await fetch(`http://127.0.0.1:${port}${path}`, options);
  if (!resp.ok) throw new Error(`CDP ${path} failed ${resp.status}`);
  return resp.json();
}

async function waitForCdpPort(port) {
  for (let index = 0; index < 80; index += 1) {
    try {
      return await cdpFetchForPort(port, '/json/version');
    } catch {
      await delay(125);
    }
  }
  throw new Error(`shared witness browser CDP endpoint did not open on port ${port}`);
}

function wsRequest(ws, method, params = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveReq, rejectReq) => {
    const onMessage = (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (msg.error) rejectReq(new Error(`${method}: ${msg.error.message}`));
      else resolveReq(msg.result);
    };
    ws.addEventListener('message', onMessage);
  });
}

function waitForWebSocketOpen(ws) {
  return new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('WebSocket open failed')), { once: true });
  });
}

function makeWitnessBrowserSession({ enabled, port, userDataDir, windowSize, initialUrl }) {
  return {
    identity: WITNESS_BROWSER_REUSE_IDENTITY,
    attachIdentity: WITNESS_BROWSER_ATTACH_IDENTITY,
    enabled,
    mode: enabled ? 'dataset-owned-shared-headful-cdp-browser' : 'per-capture-witness-browser',
    port,
    userDataDir,
    windowSize,
    initialUrl,
    launchPolicy: enabled
      ? 'launch-once-attach-many-cleanup-once'
      : 'volume-witness-launches-and-closes-chrome-per-capture',
    focusStealMitigation: enabled
      ? 'one-headful-window-per-corpus-run-no-page-bringToFront-during-reused-captures'
      : 'none',
  };
}

async function startWitnessBrowserSession(session) {
  if (!session?.enabled) return { ...session, status: 'disabled' };
  const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const proc = spawn(chrome, [
    `--remote-debugging-port=${session.port}`,
    `--user-data-dir=${session.userDataDir}`,
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    `--window-size=${session.windowSize}`,
    session.initialUrl,
  ], { stdio: 'ignore' });
  const startedAt = new Date().toISOString();
  try {
    const version = await waitForCdpPort(session.port);
    return {
      ...session,
      status: 'started',
      startedAt,
      browser: version.Browser || null,
      webSocketDebuggerUrl: version.webSocketDebuggerUrl || null,
      pid: proc.pid,
      process: proc,
    };
  } catch (error) {
    proc.kill('SIGTERM');
    throw error;
  }
}

async function closeCdpBrowser(port) {
  const version = await cdpFetchForPort(port, '/json/version');
  if (!version.webSocketDebuggerUrl) return false;
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await waitForWebSocketOpen(ws);
  try {
    await wsRequest(ws, 'Browser.close');
  } finally {
    ws.close();
  }
  return true;
}

async function cleanupWitnessBrowserSession(session) {
  if (!session?.enabled || session.status !== 'started') return { ...session, cleanupStatus: 'not-needed' };
  let browserCloseSent = false;
  let processKillSent = false;
  try {
    browserCloseSent = await closeCdpBrowser(session.port);
  } catch {
    browserCloseSent = false;
  }
  if (session.process && !session.process.killed) {
    session.process.kill('SIGTERM');
    processKillSent = true;
  }
  const { process: _process, ...serializableSession } = session;
  return {
    ...serializableSession,
    cleanupStatus: 'closed',
    closedAt: new Date().toISOString(),
    browserCloseSent,
    processKillSent,
  };
}

function gitValue(args, fallback = null) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || fallback;
  } catch {
    return fallback;
  }
}

function routeWithGrid(baseUrl, grid, majorantGrid) {
  const url = new URL(baseUrl);
  url.searchParams.set('kaminos_volume_smoke', '1');
  url.searchParams.set('volume_resolution', String(nearestSupported(grid, SUPPORTED_GRIDS, 96)));
  url.searchParams.set('volume_majorant_grid', String(nearestSupported(majorantGrid, SUPPORTED_MAJORANT_GRIDS, 48)));
  url.searchParams.set('volume_sim_profile', '1');
  return url.toString();
}

function normalizeRouteVariant(entry, index) {
  const source = entry && typeof entry === 'object' ? entry : {};
  const identity = slugify(source.routeVariantIdentity || source.id || source.identity || source.name || `variant-${index + 1}`, `variant-${index + 1}`);
  const query = source.query || source.queryParams || source.params || {};
  const queryParams = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    queryParams[key] = String(value);
  }
  return {
    routeVariantIdentity: identity,
    label: source.label || source.name || identity,
    queryParams,
    note: source.note || null,
  };
}

function loadRouteVariants(path) {
  if (!path) {
    return [{
      routeVariantIdentity: 'base-route-v0',
      label: 'base route',
      queryParams: {},
      note: null,
    }];
  }
  const resolvedPath = resolve(String(path));
  const payload = readJson(resolvedPath);
  const rows = Array.isArray(payload) ? payload : payload.routeVariants;
  if (!Array.isArray(rows) || rows.length < 1) {
    throw new Error(`route variants file must contain a non-empty array or { "routeVariants": [...] }: ${resolvedPath}`);
  }
  const variants = rows.map(normalizeRouteVariant);
  const seen = new Set();
  for (const variant of variants) {
    if (seen.has(variant.routeVariantIdentity)) {
      throw new Error(`duplicate routeVariantIdentity in ${resolvedPath}: ${variant.routeVariantIdentity}`);
    }
    seen.add(variant.routeVariantIdentity);
  }
  return variants.map((variant) => ({ ...variant, sourcePath: resolvedPath }));
}

function buildDeterministicReplayStates({ steps, timeStepMs, startTimeMs, startTimeList }) {
  if (steps <= 0) {
    return [{
      replayStateIdentity: 'sequential-live-state-v0',
      deterministicReplay: { enabled: false },
    }];
  }
  const starts = Array.from(new Set(
    (Array.isArray(startTimeList) && startTimeList.length ? startTimeList : [startTimeMs])
      .map(Number)
      .filter(Number.isFinite)
  ));
  return starts.map((start) => ({
    replayStateIdentity: replayStartSlug(start),
    deterministicReplay: {
      enabled: true,
      identity: DETERMINISTIC_REPLAY_IDENTITY,
      steps,
      timeStepMs,
      startTimeMs: start,
      stateTransfer: false,
    },
  }));
}

function applyRouteVariant(baseUrl, routeVariant) {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(routeVariant?.queryParams || {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function fieldShapeFromReadback(simReadback, majorantReadback, simCostLedger) {
  const grid = Number(simReadback?.grid);
  const voxelCount = grid * grid * grid;
  const fluidBufferBytes = Number(simReadback?.fluidBufferBytes ?? simCostLedger?.fluidBufferBytes);
  const frontFieldBytes = Number(simReadback?.frontFieldBytes);
  const fluidComponents = Number.isFinite(fluidBufferBytes) && voxelCount > 0
    ? Math.round(fluidBufferBytes / (voxelCount * Float32Array.BYTES_PER_ELEMENT))
    : null;
  const frontComponents = Number.isFinite(frontFieldBytes) && voxelCount > 0
    ? Math.round(frontFieldBytes / (voxelCount * Float32Array.BYTES_PER_ELEMENT))
    : null;
  return {
    grid,
    voxelCount,
    fluidBufferBytes,
    fluidComponents,
    fluidComponentLayout: fluidComponents === 16 ? 'four-vec4-slots-per-cell' : 'unknown-from-readback-bytes',
    frontFieldIdentity: simReadback?.frontFieldIdentity || null,
    frontFieldBytes,
    frontComponents,
    majorantGrid: Number(majorantReadback?.grid),
    majorantBricks: Number(majorantReadback?.bricks),
  };
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function finiteVector(values, length, fallback = 0) {
  const source = Array.isArray(values) ? values : [];
  return Array.from({ length }, (_, index) => {
    const value = Number(source[index]);
    return Number.isFinite(value) ? value : fallback;
  });
}

function normalizedTileOrigin(tile) {
  if (Array.isArray(tile?.normalizedOrigin) && tile.normalizedOrigin.length === 3) {
    return finiteVector(tile.normalizedOrigin, 3);
  }
  const gridSpan = Math.max(1, Number(tile?.simGrid || tile?.grid || 1) - 1);
  return finiteVector(tile?.origin, 3).map((value) => value / gridSpan);
}

function normalizedTileSize(tile) {
  if (Array.isArray(tile?.normalizedSize) && tile.normalizedSize.length === 3) {
    return finiteVector(tile.normalizedSize, 3);
  }
  const grid = Math.max(1, Number(tile?.simGrid || tile?.grid || 1));
  return finiteVector(tile?.size, 3).map((value) => value / grid);
}

function normalizedTileCenter(tile) {
  if (Array.isArray(tile?.normalizedCenter) && tile.normalizedCenter.length === 3) {
    return finiteVector(tile.normalizedCenter, 3);
  }
  const origin = normalizedTileOrigin(tile);
  const size = normalizedTileSize(tile);
  return origin.map((value, index) => value + size[index] * 0.5);
}

function normalizedTileDistance(lowTile, highTile) {
  const lowCenter = normalizedTileCenter(lowTile);
  const highCenter = normalizedTileCenter(highTile);
  return Math.hypot(
    lowCenter[0] - highCenter[0],
    lowCenter[1] - highCenter[1],
    lowCenter[2] - highCenter[2],
  );
}

function normalizedTileRadius(tile) {
  const size = normalizedTileSize(tile);
  return Math.hypot(size[0], size[1], size[2]) * 0.5;
}

function normalizedTileSeparation(lowTile, highTile) {
  return Math.max(0, normalizedTileDistance(lowTile, highTile) - normalizedTileRadius(lowTile) - normalizedTileRadius(highTile));
}

function summarizeTileCoverage(exportSummary) {
  if (!exportSummary) return null;
  return {
    path: exportSummary.path,
    simGrid: exportSummary.simGrid,
    tileSize: exportSummary.tileSize,
    spatialBinCount: exportSummary.spatialBinCount,
    requestedSpatialBinIds: exportSummary.requestedSpatialBinIds || [],
    missingRequestedSpatialBinIds: exportSummary.missingRequestedSpatialBinIds || [],
    candidateSpatialBins: exportSummary.candidateSpatialBins,
    selectedSpatialBins: exportSummary.selectedSpatialBins || [],
    spatialBackfillTiles: exportSummary.spatialBackfillTiles,
    requestedMaxTiles: exportSummary.requestedMaxTiles,
    minCellEnergy: exportSummary.minCellEnergy,
    totalTiles: exportSummary.totalTiles,
    candidateTiles: exportSummary.candidateTiles,
    exportedTiles: exportSummary.exportedTiles,
    droppedCandidateTiles: exportSummary.droppedCandidateTiles,
    emptyTiles: exportSummary.emptyTiles,
    fullCoverage: exportSummary.fullCoverage,
    coverageLimitation: exportSummary.coverageLimitation,
  };
}

function spatialBinSet(tiles) {
  return new Set((Array.isArray(tiles) ? tiles : [])
    .map((tile) => tile?.spatialBinId)
    .filter(Boolean));
}

function setDifference(left, right) {
  return Array.from(left).filter((value) => !right.has(value)).sort();
}

function resolveFieldTilePairingPolicy(value) {
  const requested = String(value || NORMALIZED_TILE_PAIRING_IDENTITY);
  return requested.includes('common-spatial-bin')
    ? COMMON_SPATIAL_BIN_PAIRING_IDENTITY
    : NORMALIZED_TILE_PAIRING_IDENTITY;
}

function buildFieldTileCoveragePairing(pair, { fieldTilePairingPolicy = NORMALIZED_TILE_PAIRING_IDENTITY } = {}) {
  const lowExport = pair.low?.effective?.fieldTileExport || null;
  const highExport = pair.high?.effective?.fieldTileExport || null;
  if (!lowExport || !highExport) return null;
  const lowTiles = Array.isArray(lowExport.tilePayloads) ? lowExport.tilePayloads : [];
  const highTiles = Array.isArray(highExport.tilePayloads) ? highExport.tilePayloads : [];
  const lowSpatialBins = spatialBinSet(lowTiles);
  const highSpatialBins = spatialBinSet(highTiles);
  const commonSpatialBins = new Set(Array.from(lowSpatialBins).filter((binId) => highSpatialBins.has(binId)));
  const commonSpatialBinOnly = fieldTilePairingPolicy === COMMON_SPATIAL_BIN_PAIRING_IDENTITY;
  const matchedLowIndexes = new Set();
  const matchedHighIndexes = new Set();
  const matchedTilePairs = [];
  const rawCandidatePairs = lowTiles
    .flatMap((lowTile, lowIndex) => highTiles.map((highTile, highIndex) => ({
      lowTile,
      highTile,
      lowIndex,
      highIndex,
      distance: normalizedTileDistance(lowTile, highTile),
      sameSpatialBin: Boolean(lowTile.spatialBinId && lowTile.spatialBinId === highTile.spatialBinId),
    })));
  const candidatePairs = rawCandidatePairs
    .filter((candidate) => !commonSpatialBinOnly || candidate.sameSpatialBin)
    .sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      const energyDelta = Math.abs(finiteNumber(b.highTile.energySum) - finiteNumber(b.lowTile.energySum))
        - Math.abs(finiteNumber(a.highTile.energySum) - finiteNumber(a.lowTile.energySum));
      if (energyDelta !== 0) return energyDelta;
      const lowIdCompare = String(a.lowTile.tileId).localeCompare(String(b.lowTile.tileId));
      if (lowIdCompare !== 0) return lowIdCompare;
      return String(a.highTile.tileId).localeCompare(String(b.highTile.tileId));
    });

  for (const candidate of candidatePairs) {
    if (matchedLowIndexes.has(candidate.lowIndex) || matchedHighIndexes.has(candidate.highIndex)) continue;
    matchedLowIndexes.add(candidate.lowIndex);
    matchedHighIndexes.add(candidate.highIndex);
    matchedTilePairs.push({
      matchId: `match-${String(matchedTilePairs.length + 1).padStart(3, '0')}`,
      lowTileId: candidate.lowTile.tileId,
      highTileId: candidate.highTile.tileId,
      lowPath: candidate.lowTile.path,
      highPath: candidate.highTile.path,
      lowOrigin: candidate.lowTile.origin,
      highOrigin: candidate.highTile.origin,
      lowNormalizedOrigin: normalizedTileOrigin(candidate.lowTile),
      highNormalizedOrigin: normalizedTileOrigin(candidate.highTile),
      lowNormalizedSize: normalizedTileSize(candidate.lowTile),
      highNormalizedSize: normalizedTileSize(candidate.highTile),
      lowNormalizedCenter: normalizedTileCenter(candidate.lowTile),
      highNormalizedCenter: normalizedTileCenter(candidate.highTile),
      normalizedTileDistance: candidate.distance,
      normalizedTileSeparation: normalizedTileSeparation(candidate.lowTile, candidate.highTile),
      lowSpatialBinId: candidate.lowTile.spatialBinId || null,
      highSpatialBinId: candidate.highTile.spatialBinId || null,
      sameSpatialBin: candidate.sameSpatialBin,
      lowShape: candidate.lowTile.shape,
      highShape: candidate.highTile.shape,
      lowEnergySum: candidate.lowTile.energySum,
      highEnergySum: candidate.highTile.energySum,
    });
  }

  const unmatchedLowTiles = lowTiles
    .map((tile, index) => ({ tile, index }))
    .filter(({ index }) => !matchedLowIndexes.has(index))
    .map(({ tile }) => ({
      lowTileId: tile.tileId,
      lowPath: tile.path,
      lowNormalizedCenter: normalizedTileCenter(tile),
      reason: 'no-unused-high-tile-remaining',
    }));
  const unmatchedHighTiles = highTiles
    .map((tile, index) => ({ tile, index }))
    .filter(({ index }) => !matchedHighIndexes.has(index))
    .map(({ tile }) => ({
      highTileId: tile.tileId,
      highPath: tile.path,
      highNormalizedCenter: normalizedTileCenter(tile),
      reason: 'no-unmatched-low-tile-remaining',
  }));
  const distances = matchedTilePairs.map((match) => finiteNumber(match.normalizedTileDistance));
  const separations = matchedTilePairs.map((match) => finiteNumber(match.normalizedTileSeparation));
  const sameSpatialBinPairs = matchedTilePairs.filter((match) => match.sameSpatialBin).length;
  return {
    schema: FIELD_TILE_COVERAGE_PAIRING_SCHEMA,
    identity: fieldTilePairingPolicy,
    authority: 'post-capture-selected-tile-metadata-match-not-resampling',
    pairId: pair.pairId,
    pairAuthority: pair.pairAuthority,
    gridScaleRatio: pair.gridScaleRatio,
    voxelCountRatio: pair.voxelCountRatio,
    coverageExpansion: {
      low: summarizeTileCoverage(lowExport),
      high: summarizeTileCoverage(highExport),
      matchedTilePairs: matchedTilePairs.length,
      unmatchedLowTiles: unmatchedLowTiles.length,
      unmatchedHighTiles: unmatchedHighTiles.length,
      sameSpatialBinPairs,
      selectionPolicy: lowExport.selectionPolicy === highExport.selectionPolicy ? lowExport.selectionPolicy : 'mixed-selection-policy',
      fieldTilePairingPolicy,
      commonSpatialBinOnly,
      relationship: commonSpatialBinOnly
        ? 'selected low/high occupied tiles greedily paired by nearest normalized tile center only inside common spatial-bin ids'
        : 'selected low/high occupied tiles greedily paired by nearest normalized tile center',
    },
    matchedTilePairs,
    unmatchedLowTiles,
    unmatchedHighTiles,
    distanceSummary: {
      count: distances.length,
      min: distances.length ? Math.min(...distances) : null,
      max: distances.length ? Math.max(...distances) : null,
      mean: distances.length ? distances.reduce((sum, value) => sum + value, 0) / distances.length : null,
    },
    separationSummary: {
      count: separations.length,
      overlappingOrAdjacent: separations.filter((value) => value === 0).length,
      separated: separations.filter((value) => value > 0).length,
      min: separations.length ? Math.min(...separations) : null,
      max: separations.length ? Math.max(...separations) : null,
      mean: separations.length ? separations.reduce((sum, value) => sum + value, 0) / separations.length : null,
    },
    spatialBinSummary: {
      count: matchedTilePairs.length,
      sameSpatialBinPairs,
      differentSpatialBinPairs: matchedTilePairs.length - sameSpatialBinPairs,
      lowSelectedSpatialBins: Array.isArray(lowExport.selectedSpatialBins) ? lowExport.selectedSpatialBins : [],
      highSelectedSpatialBins: Array.isArray(highExport.selectedSpatialBins) ? highExport.selectedSpatialBins : [],
      highRequestedSpatialBins: Array.isArray(highExport.requestedSpatialBinIds) ? highExport.requestedSpatialBinIds : [],
      highMissingRequestedSpatialBins: Array.isArray(highExport.missingRequestedSpatialBinIds) ? highExport.missingRequestedSpatialBinIds : [],
      highSpatialBackfillTiles: Number(highExport.spatialBackfillTiles || 0),
      commonSpatialBins: Array.from(commonSpatialBins).sort(),
      lowOnlySpatialBins: setDifference(lowSpatialBins, highSpatialBins),
      highOnlySpatialBins: setDifference(highSpatialBins, lowSpatialBins),
    },
    excludedByPairingPolicy: {
      policy: fieldTilePairingPolicy,
      candidateTilePairs: rawCandidatePairs.length - candidatePairs.length,
      lowTilesWithoutCommonSpatialBin: lowTiles.filter((tile) => !commonSpatialBins.has(tile.spatialBinId)).length,
      highTilesWithoutCommonSpatialBin: highTiles.filter((tile) => !commonSpatialBins.has(tile.spatialBinId)).length,
    },
    limitation: 'Coverage pairing aligns exported selected tiles by normalized centers only; it does not resample low/high tensors or prove literal same-state GPU snapshot transfer.',
  };
}

function validateFieldTileCoveragePairing(pairing, { fieldTilePairingPolicy, minCommonSpatialBinPairs }) {
  if (!pairing || fieldTilePairingPolicy !== COMMON_SPATIAL_BIN_PAIRING_IDENTITY) return;
  const minimum = Math.max(0, Math.floor(Number(minCommonSpatialBinPairs || 0)));
  const actual = Number(pairing.spatialBinSummary?.sameSpatialBinPairs || 0);
  if (minimum > 0 && actual < minimum) {
    const error = new Error(`insufficient common-spatial-bin pairs: required ${minimum}, got ${actual}`);
    error.code = 'insufficient-common-spatial-bin-pairs';
    error.failurePhase = 'pairing-preflight';
    error.details = {
      fieldTilePairingPolicy,
      minCommonSpatialBinPairs: minimum,
      sameSpatialBinPairs: actual,
      excludedByPairingPolicy: pairing.excludedByPairingPolicy,
      spatialBinSummary: pairing.spatialBinSummary,
    };
    throw error;
  }
}

function makeBinTensor(name, bins, channels) {
  const rows = Array.isArray(bins) ? bins : [];
  return {
    name,
    dtype: 'float32-json-number-array',
    shape: [rows.length, channels.length],
    channels,
    data: rows.flatMap((row) => channels.map((channel) => finiteNumber(row?.[channel]))),
  };
}

function buildFieldProjectionTensor({ witness, plan, fieldShape, simReadback, majorantReadback, simCostLedger }) {
  const plumeHeightChannels = [
    'yMin',
    'yMax',
    'smokeWeight',
    'smokeRadialBreadth',
    'smokeVelocityY',
    'smokeLateralVelocityMean',
    'smokeWeightedCurlMean',
    'fireWeight',
    'fireInteriorWeight',
    'fireRingWeight',
    'emissionDetailWeight',
    'smokeDetailWeight',
    'combustionFrontWeight',
    'frontTopologyWeight',
  ];
  const sourceRelativeChannels = [
    'visualCenter',
    'smokeWeight',
    'fireWeight',
    'fireInteriorWeight',
    'fireRingWeight',
    'fireFlameWeight',
    'fireEmberWeight',
    'fireFlameDetailWeight',
    'fireLickWeight',
    'fireHeatWeight',
    'emissionDetailWeight',
    'smokeDetailWeight',
    'combustionFrontWeight',
    'frontTopologyWeight',
    'smokeVisualRiseVelocity',
    'fireVisualRiseVelocity',
  ];
  const fieldProjectionTensor = {
    schema: FIELD_PROJECTION_TENSOR_SCHEMA,
    identity: 'kaminos-field-summary-projection-v0',
    fieldAuthority: FIELD_AUTHORITY,
    sourceReport: plan.report,
    requestedRoute: plan.route,
    effectiveRoute: witness.effectiveRoute,
    prototypeIdentity: witness.prototypeIdentity,
    backend: witness.backend,
    captureBackend: witness.captureBackend,
    role: plan.role,
    requestedGrid: plan.requestedGrid,
    simGrid: simReadback.grid,
    requestedMajorantGrid: plan.requestedMajorantGrid,
    frameCount: witness.frameCount,
    simStepCount: witness.simStepCount,
    fieldShape,
    tensors: {
      plumeHeightBins: makeBinTensor('plumeHeightBins', simReadback.plumeHeightBins, plumeHeightChannels),
      sourceRelativeVisualHeightBins: makeBinTensor('sourceRelativeVisualHeightBins', simReadback.sourceRelativeVisualHeightBins, sourceRelativeChannels),
      scalarSummary: {
        name: 'scalarSummary',
        dtype: 'float32-json-number-array',
        shape: [1, 18],
        channels: [
          'densityMean',
          'densityMax',
          'heatMean',
          'fuelMean',
          'reactionMean',
          'fireLayerMean',
          'radianceMean',
          'extinctionMean',
          'detailMean',
          'microdetailMean',
          'combustionFrontMean',
          'frontTopologyMean',
          'velocityMean',
          'curlMean',
          'divergenceMean',
          'liveVoxels',
          'majorantOccupiedBricks',
          'majorantImportanceMax',
        ],
        data: [
          finiteNumber(simReadback.densityMean),
          finiteNumber(simReadback.densityMax),
          finiteNumber(simReadback.heatMean),
          finiteNumber(simReadback.fuelMean),
          finiteNumber(simReadback.reactionMean),
          finiteNumber(simReadback.fireLayerMean),
          finiteNumber(simReadback.radianceMean),
          finiteNumber(simReadback.extinctionMean),
          finiteNumber(simReadback.detailMean),
          finiteNumber(simReadback.microdetailMean),
          finiteNumber(simReadback.combustionFrontMean),
          finiteNumber(simReadback.frontTopologyMean),
          finiteNumber(simReadback.velocityMean),
          finiteNumber(simReadback.curlMean),
          finiteNumber(simReadback.divergenceMean),
          finiteNumber(simReadback.liveVoxels),
          finiteNumber(majorantReadback.occupiedBricks),
          finiteNumber(majorantReadback.importanceMax),
        ],
      },
    },
    pressureCues: {
      pressureSourceStrategy: simCostLedger.pressureSourceStrategy,
      pressureStrategy: simCostLedger.pressureStrategy,
      pressureJacobiPasses: simCostLedger.pressureJacobiPasses,
      pressureJacobiInlineDivergencePasses: simCostLedger.pressureJacobiInlineDivergencePasses,
      fullGridPassBreakdown: simCostLedger.fullGridPassBreakdown,
    },
    limitation: 'Compact projection tensor is derived from live readback summaries/bins; it is trainable feature material, not dense 3D field export.',
  };
  writeJson(plan.fieldProjectionTensor, { fieldProjectionTensor });
  return {
    schema: FIELD_PROJECTION_TENSOR_SCHEMA,
    identity: fieldProjectionTensor.identity,
    path: plan.fieldProjectionTensor,
    dtype: 'float32-json-number-array',
    tensors: Object.fromEntries(Object.entries(fieldProjectionTensor.tensors).map(([key, tensor]) => [
      key,
      {
        shape: tensor.shape,
        channels: tensor.channels,
      },
    ])),
  };
}

function writeFloat32Payload(path, values) {
  mkdirSync(dirname(path), { recursive: true });
  const array = new Float32Array(values.map(finiteNumber));
  writeFileSync(path, Buffer.from(array.buffer));
  return array.byteLength;
}

function buildFieldTileExportArtifacts({ witness, plan, fieldShape }) {
  if (!plan.fieldTileExport?.enabled) return null;
  const source = witness.simReadback?.fieldTileExport || null;
  const expectedSelectionPolicy = plan.fieldTileExport.selectionPolicy || 'selected-occupied-fluid-front-tiles';
  if (
    source?.schema !== FIELD_TILE_EXPORT_SCHEMA ||
    source.selectionPolicy !== expectedSelectionPolicy ||
    !Array.isArray(source.tiles) ||
    source.tiles.length < 1
  ) {
    const error = new Error('missing-primary-report: witness did not preserve selected field tile export data');
    error.code = 'missing-primary-report';
    error.failurePhase = 'validation';
    error.details = { requested: plan.fieldTileExport, effective: source, report: plan.report };
    throw error;
  }
  const tilePayloads = source.tiles.map((tile) => {
    const payloadPath = resolve(dirname(plan.fieldTileExportArtifact), `${plan.slug}.field-tile-${tile.tileId}.f32`);
    const byteLength = writeFloat32Payload(payloadPath, Array.isArray(tile.data) ? tile.data : []);
    const { data, ...metadata } = tile;
    return {
      ...metadata,
      path: payloadPath,
      dtype: 'float32',
      byteOrder: 'little-endian-native',
      byteLength,
      valueCount: Array.isArray(data) ? data.length : 0,
    };
  });
  const fieldTileExport = {
    schema: FIELD_TILE_EXPORT_SCHEMA,
    identity: source.identity,
    fieldAuthority: FIELD_AUTHORITY,
    sourceReport: plan.report,
    requestedRoute: plan.route,
    effectiveRoute: witness.effectiveRoute,
    prototypeIdentity: witness.prototypeIdentity,
    backend: witness.backend,
    captureBackend: witness.captureBackend,
    role: plan.role,
    requestedGrid: plan.requestedGrid,
    simGrid: source.grid,
    requestedMajorantGrid: plan.requestedMajorantGrid,
    deterministicReplay: witness.deterministicReplay || null,
    frameCount: witness.frameCount,
    simStepCount: witness.simStepCount,
    fieldShape,
    authority: source.authority,
    coordinateSpace: source.coordinateSpace,
    selectionPolicy: source.selectionPolicy,
    fullCoverage: source.fullCoverage,
    coverageLimitation: source.coverageLimitation,
    tileSize: source.tileSize,
    requestedMaxTiles: source.requestedMaxTiles,
    minCellEnergy: source.minCellEnergy,
    spatialBinCount: source.spatialBinCount,
    requestedSpatialBinIds: source.requestedSpatialBinIds || [],
    missingRequestedSpatialBinIds: source.missingRequestedSpatialBinIds || [],
    candidateSpatialBins: source.candidateSpatialBins,
    selectedSpatialBins: source.selectedSpatialBins || [],
    spatialBackfillTiles: source.spatialBackfillTiles,
    channels: source.channels,
    channelCount: source.channelCount,
    totalTiles: source.totalTiles,
    candidateTiles: source.candidateTiles,
    exportedTiles: source.exportedTiles,
    droppedCandidateTiles: source.droppedCandidateTiles,
    emptyTiles: source.emptyTiles,
    tilePayloads,
  };
  writeJson(plan.fieldTileExportArtifact, { fieldTileExport });
  return {
    schema: FIELD_TILE_EXPORT_SCHEMA,
    identity: fieldTileExport.identity,
    path: plan.fieldTileExportArtifact,
    dtype: 'float32-binary-sidecar',
    selectionPolicy: fieldTileExport.selectionPolicy,
    fullCoverage: fieldTileExport.fullCoverage,
    coverageLimitation: fieldTileExport.coverageLimitation,
    tileSize: fieldTileExport.tileSize,
    spatialBinCount: fieldTileExport.spatialBinCount,
    requestedSpatialBinIds: fieldTileExport.requestedSpatialBinIds,
    missingRequestedSpatialBinIds: fieldTileExport.missingRequestedSpatialBinIds,
    candidateSpatialBins: fieldTileExport.candidateSpatialBins,
    selectedSpatialBins: fieldTileExport.selectedSpatialBins,
    spatialBackfillTiles: fieldTileExport.spatialBackfillTiles,
    channels: fieldTileExport.channels,
    channelCount: fieldTileExport.channelCount,
    totalTiles: fieldTileExport.totalTiles,
    candidateTiles: fieldTileExport.candidateTiles,
    exportedTiles: fieldTileExport.exportedTiles,
    droppedCandidateTiles: fieldTileExport.droppedCandidateTiles,
    emptyTiles: fieldTileExport.emptyTiles,
    tilePayloads: tilePayloads.map(({ data, ...tile }) => tile),
  };
}

function buildSameStateFreezeAttempt({ pairAuthority, deterministicReplay }) {
  if (deterministicReplay?.enabled) {
    return {
      schema: SAME_STATE_FREEZE_PREFLIGHT_SCHEMA,
      status: 'satisfied-by-deterministic-replay',
      code: 'same-state-buffer-transfer-unsupported-deterministic-replay-used',
      failurePhase: 'pairing-preflight',
      requestedPairing: 'same-state low/high simulation-grid field readbacks',
      effectivePairing: pairAuthority,
      deterministicReplay,
      currentEvidence: [
        'volume_resolution changes still rebuildFluidState() and cannot transfer GPU buffers across grid dimensions',
        'volume-witness.mjs can request sampleDeterministicReplayFrame() with fixed route controls, reset reason, step count, and timestamp clock',
        'low/high captures are comparable as deterministic same-logical-state replays, not literal cloned GPU field snapshots',
      ],
      remainingHook: 'A true cross-grid snapshot/reseed import path would still be needed to claim literal state transfer instead of deterministic replay.',
    };
  }
  return {
    schema: SAME_STATE_FREEZE_PREFLIGHT_SCHEMA,
    status: 'blocked-by-missing-simulator-hook',
    code: 'same-state-grid-snapshot-unsupported',
    failurePhase: 'pairing-preflight',
    requestedPairing: 'same-state low/high simulation-grid field readbacks',
    effectivePairing: pairAuthority,
    currentEvidence: [
      'volume_resolution changes rebuildFluidState() and resets GPU fluid buffers',
      'sampleFrame() can copy current fluid/front/majorant buffers but cannot export/import them into a different grid instance',
      'no deterministic cross-grid seed/replay or frozen snapshot restore hook is exposed to volume-witness.mjs',
    ],
    requiredHook: 'Expose a simulator snapshot/reseed path that can clone or deterministically replay fluid/front/majorant state across requested low/high grids before readback.',
  };
}

function summarizeFieldEvidence(witness, plan) {
  const simReadback = witness.simReadback || null;
  const majorantReadback = witness.majorantReadback || null;
  const simCostLedger = witness.simCostLedger || null;
  const effectiveGrid = Number(witness.simGrid ?? simReadback?.grid);
  if (witness.effectiveRoute !== EXPECTED_VOLUME_ROUTE_ID) {
    const error = new Error(`wrong-fallback-route: expected ${EXPECTED_VOLUME_ROUTE_ID}, got ${witness.effectiveRoute || 'none'}`);
    error.code = 'wrong-fallback-route';
    error.failurePhase = 'validation';
    error.details = { expected: EXPECTED_VOLUME_ROUTE_ID, effective: witness.effectiveRoute, report: plan.report };
    throw error;
  }
  if (witness.prototypeIdentity !== EXPECTED_PROTOTYPE_ID) {
    const error = new Error(`absent-effective-identity: expected ${EXPECTED_PROTOTYPE_ID}, got ${witness.prototypeIdentity || 'none'}`);
    error.code = 'absent-effective-identity';
    error.failurePhase = 'validation';
    error.details = { expected: EXPECTED_PROTOTYPE_ID, effective: witness.prototypeIdentity, report: plan.report };
    throw error;
  }
  if (!Number.isFinite(effectiveGrid) || effectiveGrid !== plan.requestedGrid || simReadback?.grid !== plan.requestedGrid) {
    const error = new Error(`stale-default-config: requested sim grid ${plan.requestedGrid}, got witness ${effectiveGrid} and readback ${simReadback?.grid}`);
    error.code = 'stale-default-config';
    error.failurePhase = 'validation';
    error.details = { requestedGrid: plan.requestedGrid, effectiveGrid, readbackGrid: simReadback?.grid, report: plan.report };
    throw error;
  }
  if (!simReadback || !Number.isFinite(simReadback.densityMax)) {
    const error = new Error('missing-primary-report: witness did not preserve live simReadback field evidence');
    error.code = 'missing-primary-report';
    error.failurePhase = 'validation';
    error.details = { simReadback, report: plan.report };
    throw error;
  }
  if (!majorantReadback || majorantReadback.grid !== plan.requestedMajorantGrid || majorantReadback.occupiedBricks < 2) {
    const error = new Error('blank-or-partial-output: witness did not preserve live majorantReadback occupancy evidence');
    error.code = 'blank-or-partial-output';
    error.failurePhase = 'validation';
    error.details = { requestedMajorantGrid: plan.requestedMajorantGrid, majorantReadback, report: plan.report };
    throw error;
  }
  if (!simCostLedger || simCostLedger.routeIdentity !== EXPECTED_VOLUME_ROUTE_ID || simCostLedger.grid !== plan.requestedGrid) {
    const error = new Error('missing-primary-report: sim cost ledger is absent or does not match the effective grid');
    error.code = 'missing-primary-report';
    error.failurePhase = 'validation';
    error.details = { requestedGrid: plan.requestedGrid, simCostLedger, report: plan.report };
    throw error;
  }
  if (plan.deterministicReplay?.enabled) {
    const replay = witness.deterministicReplay || null;
    if (
      replay?.identity !== DETERMINISTIC_REPLAY_IDENTITY ||
      Number(replay.steps) !== plan.deterministicReplay.steps ||
      Number(replay.completedSteps) !== plan.deterministicReplay.steps ||
      Number(witness.simStepCount) !== plan.deterministicReplay.steps ||
      replay.stateTransfer !== false
    ) {
      const error = new Error('wrong-fallback-route: deterministic replay metadata is absent or does not match requested fixed-step capture');
      error.code = 'wrong-fallback-route';
      error.failurePhase = 'validation';
      error.details = { requestedReplay: plan.deterministicReplay, effectiveReplay: replay, report: plan.report };
      throw error;
    }
  }
  const fieldShape = fieldShapeFromReadback(simReadback, majorantReadback, simCostLedger);
  const fieldTileExport = buildFieldTileExportArtifacts({
    witness,
    plan,
    fieldShape,
  });
  const fieldProjectionTensor = buildFieldProjectionTensor({
    witness,
    plan,
    fieldShape,
    simReadback,
    majorantReadback,
    simCostLedger,
  });
  return {
    path: plan.out,
    fullScreenshot: plan.fullScreenshot,
    report: plan.report,
    fieldAuthority: FIELD_AUTHORITY,
    requestedGrid: plan.requestedGrid,
    simGrid: effectiveGrid,
    requestedMajorantGrid: plan.requestedMajorantGrid,
    effectiveRoute: witness.effectiveRoute,
    prototypeIdentity: witness.prototypeIdentity,
    backend: witness.backend,
    captureBackend: witness.captureBackend,
    frameCount: witness.frameCount,
    simStepCount: witness.simStepCount,
    deterministicReplay: witness.deterministicReplay || null,
    volumeScene: witness.volumeScene,
    fieldShape,
    fieldProjectionTensor,
    fieldTileExport,
    simReadback: {
      grid: simReadback.grid,
      samples: simReadback.samples,
      fluidBufferBytes: simReadback.fluidBufferBytes ?? simCostLedger.fluidBufferBytes,
      frontFieldIdentity: simReadback.frontFieldIdentity,
      frontFieldBytes: simReadback.frontFieldBytes,
      densityMean: simReadback.densityMean,
      densityMax: simReadback.densityMax,
      heatMean: simReadback.heatMean,
      fuelMean: simReadback.fuelMean,
      reactionMean: simReadback.reactionMean,
      fireLayerMean: simReadback.fireLayerMean,
      radianceMean: simReadback.radianceMean,
      extinctionMean: simReadback.extinctionMean,
      detailMean: simReadback.detailMean,
      microdetailMean: simReadback.microdetailMean,
      combustionFrontMean: simReadback.combustionFrontMean,
      frontTopologyMean: simReadback.frontTopologyMean,
      velocityMean: simReadback.velocityMean,
      curlMean: simReadback.curlMean,
      divergenceMean: simReadback.divergenceMean,
      liveVoxels: simReadback.liveVoxels,
      smokeWeight: simReadback.smokeWeight,
      fireWeight: simReadback.fireWeight,
      plumeHeightBins: simReadback.plumeHeightBins,
      sourceRelativeVisualHeightBins: simReadback.sourceRelativeVisualHeightBins,
    },
    majorantReadback: {
      grid: majorantReadback.grid,
      bricks: majorantReadback.bricks,
      occupiedBricks: majorantReadback.occupiedBricks,
      densityMean: majorantReadback.densityMean,
      densityMax: majorantReadback.densityMax,
      radianceMean: majorantReadback.radianceMean,
      radianceMax: majorantReadback.radianceMax,
      extinctionMean: majorantReadback.extinctionMean,
      extinctionMax: majorantReadback.extinctionMax,
      importanceMean: majorantReadback.importanceMean,
      importanceMax: majorantReadback.importanceMax,
    },
    pressureCues: {
      pressureSourceStrategy: simCostLedger.pressureSourceStrategy,
      pressureStrategy: simCostLedger.pressureStrategy,
      pressureJacobiPasses: simCostLedger.pressureJacobiPasses,
      pressureJacobiInlineDivergencePasses: simCostLedger.pressureJacobiInlineDivergencePasses,
      fullGridPassBreakdown: simCostLedger.fullGridPassBreakdown,
    },
    occupancyCues: {
      liveVoxels: simReadback.liveVoxels,
      majorantOccupiedBricks: majorantReadback.occupiedBricks,
      majorantImportanceMax: majorantReadback.importanceMax,
      smokeWeight: simReadback.smokeWeight,
      fireWeight: simReadback.fireWeight,
    },
    simCostLedger,
    controls: witness.controls || null,
    timingEvidenceSource: witness.timingEvidenceSource,
    timingDisclaimer: witness.timingDisclaimer,
    performanceVisualWarnings: witness.performanceVisualWarnings || [],
  };
}

function makeCapturePlan({ pairId, role, grid, majorantGrid, route, pairDir, debugPort, settleMs, windowSize, evidenceMode, deterministicReplay, fieldTileExport, witnessBrowserSession }) {
  const slug = `${pairId}-${role}-${gridSlug(grid)}`;
  const out = resolve(pairDir, `${slug}.png`);
  const report = resolve(pairDir, `${slug}.json`);
  const fullScreenshot = resolve(pairDir, `${slug}.full.png`);
  const stdout = resolve(pairDir, `${slug}.stdout.log`);
  const stderr = resolve(pairDir, `${slug}.stderr.log`);
  const fieldProjectionTensor = resolve(pairDir, `${slug}.field-projection-tensor.json`);
  const fieldTileExportArtifact = resolve(pairDir, `${slug}.field-tile-export.json`);
  const command = [
    process.execPath,
    'volume-witness.mjs',
    '--url', route,
    '--out', out,
    '--report', report,
    '--full-screenshot', fullScreenshot,
    '--debug-port', String(debugPort),
    '--settle-ms', String(settleMs),
    '--window-size', windowSize,
    '--evidence-mode', evidenceMode,
  ];
  if (deterministicReplay?.enabled) {
    command.push(
      '--deterministic-replay-steps', String(deterministicReplay.steps),
      '--deterministic-replay-time-step-ms', String(deterministicReplay.timeStepMs),
      '--deterministic-replay-start-ms', String(deterministicReplay.startTimeMs)
    );
  }
  if (fieldTileExport?.enabled) {
    command.push(
      '--field-tile-export', '1',
      '--field-tile-size', String(fieldTileExport.tileSize),
      '--field-tile-max-count', String(fieldTileExport.maxTiles),
      '--field-tile-min-cell-energy', String(fieldTileExport.minCellEnergy),
      '--field-tile-selection-policy', fieldTileExport.selectionPolicy,
      '--field-tile-spatial-bins', String(fieldTileExport.spatialBinCount)
    );
    if (Array.isArray(fieldTileExport.spatialBinIds) && fieldTileExport.spatialBinIds.length) {
      command.push('--field-tile-spatial-bin-ids', fieldTileExport.spatialBinIds.join(','));
    }
  }
  if (witnessBrowserSession?.enabled) {
    command.push(
      '--reuse-browser', '1',
      '--keep-browser-open', '1',
      '--user-data-dir', witnessBrowserSession.userDataDir
    );
  }
  return {
    slug,
    role,
    requestedGrid: nearestSupported(grid, SUPPORTED_GRIDS, 96),
    requestedMajorantGrid: nearestSupported(majorantGrid, SUPPORTED_MAJORANT_GRIDS, 48),
    route,
    out,
    report,
    fullScreenshot,
    fieldProjectionTensor,
    fieldTileExportArtifact,
    deterministicReplay: deterministicReplay?.enabled ? { ...deterministicReplay } : null,
    fieldTileExport: fieldTileExport?.enabled ? { ...fieldTileExport } : null,
    witnessBrowserSession: witnessBrowserSession?.enabled ? {
      identity: witnessBrowserSession.identity,
      attachIdentity: witnessBrowserSession.attachIdentity,
      enabled: true,
      port: witnessBrowserSession.port,
      userDataDir: witnessBrowserSession.userDataDir,
      launchPolicy: witnessBrowserSession.launchPolicy,
    } : null,
    stdout,
    stderr,
    command,
  };
}

function withFieldTileSpatialBinIds(plan, spatialBinIds) {
  const requestedIds = Array.from(new Set(Array.isArray(spatialBinIds) ? spatialBinIds.filter(Boolean) : []));
  if (!plan.fieldTileExport?.enabled || !requestedIds.length) return plan;
  const command = [];
  for (let index = 0; index < plan.command.length; index += 1) {
    if (plan.command[index] === '--field-tile-spatial-bin-ids') {
      index += 1;
      continue;
    }
    command.push(plan.command[index]);
  }
  command.push('--field-tile-spatial-bin-ids', requestedIds.join(','));
  return {
    ...plan,
    command,
    fieldTileExport: {
      ...plan.fieldTileExport,
      spatialBinIds: requestedIds,
    },
  };
}

function replaceCommandArg(command, flag, value) {
  const next = command.slice();
  const index = next.indexOf(flag);
  if (index >= 0 && index + 1 < next.length) {
    next[index + 1] = value;
  }
  return next;
}

function pathWithAttempt(path, attemptIndex) {
  if (attemptIndex <= 1) return path;
  const suffix = `.attempt-${String(attemptIndex).padStart(3, '0')}`;
  const dot = path.lastIndexOf('.');
  if (dot <= path.lastIndexOf('/')) return `${path}${suffix}`;
  return `${path.slice(0, dot)}${suffix}${path.slice(dot)}`;
}

function planForCaptureAttempt(plan, attemptIndex) {
  if (attemptIndex <= 1) {
    return {
      ...plan,
      attemptIndex,
      attemptIdentity: `${plan.slug}:attempt-001`,
    };
  }
  const attemptPlan = {
    ...plan,
    attemptIndex,
    attemptIdentity: `${plan.slug}:attempt-${String(attemptIndex).padStart(3, '0')}`,
    out: pathWithAttempt(plan.out, attemptIndex),
    report: pathWithAttempt(plan.report, attemptIndex),
    fullScreenshot: pathWithAttempt(plan.fullScreenshot, attemptIndex),
    fieldProjectionTensor: pathWithAttempt(plan.fieldProjectionTensor, attemptIndex),
    fieldTileExportArtifact: pathWithAttempt(plan.fieldTileExportArtifact, attemptIndex),
    stdout: pathWithAttempt(plan.stdout, attemptIndex),
    stderr: pathWithAttempt(plan.stderr, attemptIndex),
  };
  let command = plan.command.slice();
  command = replaceCommandArg(command, '--out', attemptPlan.out);
  command = replaceCommandArg(command, '--report', attemptPlan.report);
  command = replaceCommandArg(command, '--full-screenshot', attemptPlan.fullScreenshot);
  command = replaceCommandArg(command, '--field-projection-tensor', attemptPlan.fieldProjectionTensor);
  command = replaceCommandArg(command, '--field-tile-export-artifact', attemptPlan.fieldTileExportArtifact);
  attemptPlan.command = command;
  return attemptPlan;
}

function captureAttemptReceipt(attemptPlan, child, status) {
  return {
    attemptIndex: attemptPlan.attemptIndex,
    attemptIdentity: attemptPlan.attemptIdentity,
    status,
    out: attemptPlan.out,
    report: attemptPlan.report,
    fullScreenshot: attemptPlan.fullScreenshot,
    fieldProjectionTensor: attemptPlan.fieldProjectionTensor,
    fieldTileExportArtifact: attemptPlan.fieldTileExportArtifact,
    stdout: attemptPlan.stdout,
    stderr: attemptPlan.stderr,
    exitStatus: child.status,
    signal: child.signal,
    spawnError: child.error ? { name: child.error.name, message: child.error.message, code: child.error.code } : null,
  };
}

function runCaptureOnce(plan, cwd) {
  mkdirSync(dirname(plan.out), { recursive: true });
  const stdoutFd = openSync(plan.stdout, 'w');
  const stderrFd = openSync(plan.stderr, 'w');
  let child;
  try {
    child = spawnSync(plan.command[0], plan.command.slice(1), {
      cwd,
      stdio: ['ignore', stdoutFd, stderrFd],
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
  if (child.status !== 0) {
    const error = new Error(`capture failed for ${plan.role} sim grid ${plan.requestedGrid}`);
    error.code = 'capture-failed';
    error.failurePhase = 'capture';
    error.attemptReceipt = captureAttemptReceipt(plan, child, 'failed');
    error.details = {
      status: child.status,
      signal: child.signal,
      spawnError: child.error ? { name: child.error.name, message: child.error.message, code: child.error.code } : null,
      stdout: plan.stdout,
      stderr: plan.stderr,
      report: plan.report,
    };
    throw error;
  }
  const witness = readJson(plan.report);
  return {
    effective: summarizeFieldEvidence(witness, plan),
    attemptReceipt: captureAttemptReceipt(plan, child, 'passed'),
  };
}

function runCapture(plan, cwd, captureRetryPolicy = { maxRetries: 0 }) {
  const maxRetries = Math.max(0, Math.floor(Number(captureRetryPolicy?.maxRetries || 0)));
  const maxAttempts = maxRetries + 1;
  const attempts = [];
  let lastError = null;
  for (let attemptIndex = 1; attemptIndex <= maxAttempts; attemptIndex += 1) {
    const attemptPlan = planForCaptureAttempt(plan, attemptIndex);
    try {
      const { effective, attemptReceipt } = runCaptureOnce(attemptPlan, cwd);
      attempts.push(attemptReceipt);
      return {
        ...effective,
        captureAttempts: attempts,
        captureRetryPolicy: {
          identity: 'capture-retry-same-witness-route-v0',
          maxRetries,
          attemptsUsed: attemptIndex,
        },
      };
    } catch (error) {
      lastError = error;
      attempts.push(error.attemptReceipt || {
        attemptIndex,
        attemptIdentity: attemptPlan.attemptIdentity,
        status: 'failed-before-receipt',
        out: attemptPlan.out,
        report: attemptPlan.report,
        fullScreenshot: attemptPlan.fullScreenshot,
        fieldProjectionTensor: attemptPlan.fieldProjectionTensor,
        fieldTileExportArtifact: attemptPlan.fieldTileExportArtifact,
        stdout: attemptPlan.stdout,
        stderr: attemptPlan.stderr,
      });
    }
  }
  const error = new Error(`capture attempts exhausted for ${plan.role} sim grid ${plan.requestedGrid}: ${lastError?.message || 'unknown capture failure'}`);
  error.code = 'capture-attempts-exhausted';
  error.failurePhase = lastError?.failurePhase || 'capture';
  error.details = {
    maxRetries,
    attempts,
    terminalFailure: {
      code: lastError?.code || 'unknown',
      failurePhase: lastError?.failurePhase || 'unknown',
      message: lastError?.message || 'unknown capture failure',
      details: lastError?.details || {},
    },
  };
  throw error;
}

function summarizeRouteVariantPreflight(effective) {
  return {
    path: effective.path,
    report: effective.report,
    fullScreenshot: effective.fullScreenshot,
    fieldAuthority: effective.fieldAuthority,
    requestedGrid: effective.requestedGrid,
    simGrid: effective.simGrid,
    requestedMajorantGrid: effective.requestedMajorantGrid,
    effectiveRoute: effective.effectiveRoute,
    prototypeIdentity: effective.prototypeIdentity,
    backend: effective.backend,
    captureBackend: effective.captureBackend,
    deterministicReplay: effective.deterministicReplay,
    frameCount: effective.frameCount,
    simStepCount: effective.simStepCount,
    fieldShape: effective.fieldShape,
    simReadback: effective.simReadback,
    majorantReadback: effective.majorantReadback,
    controls: effective.controls,
    occupancyCues: effective.occupancyCues,
    pressureCues: effective.pressureCues,
    timingEvidenceSource: effective.timingEvidenceSource,
    timingDisclaimer: effective.timingDisclaimer,
    performanceVisualWarnings: effective.performanceVisualWarnings,
  };
}

function summarizeRouteVariantPreflightViability(receipts) {
  const passedReceipts = receipts.filter((receipt) => receipt.status === 'passed');
  const failedReceipts = receipts.filter((receipt) => receipt.status === 'failed');
  return {
    totalCells: receipts.length,
    passedCells: passedReceipts.length,
    failedCells: failedReceipts.length,
    viableRouteReplayIdentities: passedReceipts.map((receipt) => routeReplayIdentity(receipt.routeVariantIdentity, receipt.replayStateIdentity)),
    failedRouteReplayIdentities: failedReceipts.map((receipt) => routeReplayIdentity(receipt.routeVariantIdentity, receipt.replayStateIdentity)),
  };
}

function routeReplayIdentity(routeVariantIdentity, replayStateIdentity) {
  return `${routeVariantIdentity}/${replayStateIdentity}`;
}

function routeReplayCellIdentities(routeVariants, deterministicReplayStates) {
  return routeVariants.flatMap((routeVariant) => deterministicReplayStates.map((replayState) => (
    routeReplayIdentity(routeVariant.routeVariantIdentity, replayState.replayStateIdentity)
  )));
}

function loadRouteReplayViabilityFilter(path, routeVariants, deterministicReplayStates) {
  const requestedRouteReplayIdentities = routeReplayCellIdentities(routeVariants, deterministicReplayStates);
  if (!path) {
    return {
      identity: 'none',
      enabled: false,
      sourceManifest: null,
      requestedRouteReplayIdentities,
      allowedRouteReplayIdentities: requestedRouteReplayIdentities,
      excludedRouteReplayIdentities: [],
      classifierFailedRouteReplayIdentities: [],
      classifierMissingRouteReplayIdentities: [],
      limitation: 'No classifier manifest was supplied; all requested route/replay cells remain eligible for capture.',
    };
  }
  const resolvedPath = resolve(String(path));
  const payload = readJson(resolvedPath);
  const dataset = payload.dataset || payload;
  const receipts = dataset?.routeVariantPreflight?.receipts;
  if (!Array.isArray(receipts) || receipts.length < 1) {
    throw new Error(`route/replay viability manifest has no routeVariantPreflight receipts: ${resolvedPath}`);
  }
  const classifierStatusByIdentity = new Map();
  for (const receipt of receipts) {
    const identity = routeReplayIdentity(receipt.routeVariantIdentity, receipt.replayStateIdentity);
    classifierStatusByIdentity.set(identity, receipt.status || 'unknown');
  }
  const allowedRouteReplayIdentities = requestedRouteReplayIdentities
    .filter((identity) => classifierStatusByIdentity.get(identity) === 'passed');
  const excludedRouteReplayIdentities = requestedRouteReplayIdentities
    .filter((identity) => classifierStatusByIdentity.get(identity) !== 'passed');
  if (allowedRouteReplayIdentities.length < 1) {
    throw new Error(`route/replay viability manifest allowed zero requested cells: ${resolvedPath}`);
  }
  return {
    identity: 'classifier-passed-cells-only-v0',
    enabled: true,
    sourceManifest: resolvedPath,
    sourceDatasetStatus: dataset.status || null,
    sourceGitCommit: dataset.gitCommit || null,
    sourceRoutePreflightStatus: dataset.routeVariantPreflight?.status || null,
    requestedRouteReplayIdentities,
    allowedRouteReplayIdentities,
    excludedRouteReplayIdentities,
    classifierFailedRouteReplayIdentities: requestedRouteReplayIdentities
      .filter((identity) => classifierStatusByIdentity.get(identity) === 'failed'),
    classifierMissingRouteReplayIdentities: requestedRouteReplayIdentities
      .filter((identity) => !classifierStatusByIdentity.has(identity)),
    requestedCellCount: requestedRouteReplayIdentities.length,
    allowedCellCount: allowedRouteReplayIdentities.length,
    excludedCellCount: excludedRouteReplayIdentities.length,
    limitation: 'Only cells with passed route/replay classifier receipts are eligible for capture; excluded cells are not corpus failures and are not trainable evidence.',
  };
}

function routeReplayCellAllowed(routeReplayViabilityFilter, routeVariantIdentity, replayStateIdentity) {
  if (!routeReplayViabilityFilter?.enabled) return true;
  return routeReplayViabilityFilter.allowedRouteReplayIdentities
    .includes(routeReplayIdentity(routeVariantIdentity, replayStateIdentity));
}

function runRouteVariantPreflights({ enabled, continueOnFailure, routeReplayViabilityFilter, routeVariants, deterministicReplayStates, lowGrids, majorantGrid, baseUrl, outDir, debugPort, settleMs, windowSize, evidenceMode, cwd, captureRetryPolicy, witnessBrowserSession }) {
  if (!enabled) {
    const receipts = [];
    return {
      schema: ROUTE_VARIANT_PREFLIGHT_SCHEMA,
      enabled: false,
      continueOnFailure: false,
      status: 'skipped',
      receipts,
      viabilitySummary: summarizeRouteVariantPreflightViability(receipts),
      limitation: 'Route variants were not preflighted before low/high field export; downstream captures still validate effective route and field evidence.',
    };
  }
  const receipts = [];
  let preflightIndex = 0;
  for (const routeVariant of routeVariants) {
    for (const replayState of deterministicReplayStates) {
      if (!routeReplayCellAllowed(routeReplayViabilityFilter, routeVariant.routeVariantIdentity, replayState.replayStateIdentity)) {
        continue;
      }
      const preflightId = `preflight-${String(preflightIndex + 1).padStart(3, '0')}-${routeVariant.routeVariantIdentity}-${replayState.replayStateIdentity}`;
      const pairDir = resolve(outDir, '_route-variant-preflight', preflightId);
      const route = routeWithGrid(applyRouteVariant(baseUrl, routeVariant), lowGrids[0], majorantGrid);
      const plan = makeCapturePlan({
        pairId: preflightId,
        role: 'route-variant-preflight',
        grid: lowGrids[0],
        majorantGrid,
        route,
        pairDir,
        debugPort: witnessBrowserSession?.enabled ? witnessBrowserSession.port : debugPort + 10000 + preflightIndex,
        settleMs,
        windowSize,
        evidenceMode,
        deterministicReplay: replayState.deterministicReplay,
        fieldTileExport: { enabled: false },
        witnessBrowserSession,
      });
      try {
        const effective = runCapture(plan, cwd, captureRetryPolicy);
        receipts.push({
          schema: ROUTE_VARIANT_PREFLIGHT_SCHEMA,
          status: 'passed',
          routeVariantIdentity: routeVariant.routeVariantIdentity,
          routeVariant,
          replayStateIdentity: replayState.replayStateIdentity,
          replayState,
          requestedRoute: route,
          plan,
          effective: summarizeRouteVariantPreflight(effective),
        });
      } catch (error) {
        const sourceFailure = {
          code: error.code || 'unknown',
          failurePhase: error.failurePhase || 'unknown',
          message: error.message,
          details: error.details || {},
        };
        const failedReceipt = {
          schema: ROUTE_VARIANT_PREFLIGHT_SCHEMA,
          status: 'failed',
          routeVariantIdentity: routeVariant.routeVariantIdentity,
          routeVariant,
          replayStateIdentity: replayState.replayStateIdentity,
          replayState,
          requestedRoute: route,
          plan,
          failure: sourceFailure,
        };
        if (continueOnFailure) {
          receipts.push(failedReceipt);
          preflightIndex += 1;
          continue;
        }
        const wrapped = new Error(`route variant preflight failed for ${routeVariant.routeVariantIdentity} / ${replayState.replayStateIdentity}: ${error.message}`);
        wrapped.code = error.code || 'route-variant-preflight-failed';
        wrapped.failurePhase = 'route-variant-preflight';
        wrapped.details = {
          routeVariantIdentity: routeVariant.routeVariantIdentity,
          routeVariant,
          replayStateIdentity: replayState.replayStateIdentity,
          replayState,
          requestedRoute: route,
          plan,
          partialReceipts: receipts,
          sourceFailure,
        };
        wrapped.partialReceipts = receipts;
        throw wrapped;
      }
      preflightIndex += 1;
    }
  }
  return {
    schema: ROUTE_VARIANT_PREFLIGHT_SCHEMA,
    enabled: true,
    continueOnFailure,
    status: receipts.some((receipt) => receipt.status === 'failed') ? 'preflighted-with-failures' : 'passed',
    receipts,
    viabilitySummary: summarizeRouteVariantPreflightViability(receipts),
    limitation: 'Preflight validates route/effective identity, field readback shape, occupancy, and visual witness viability before expensive field-tile export; it does not replace low/high capture validation.',
  };
}

const args = parseArgs(process.argv.slice(2));
const cwd = new URL('.', import.meta.url).pathname;
const outDir = resolve(args.get('--out-dir') || '/tmp/kaminos-field-pair-dataset');
const manifestPath = resolve(args.get('--manifest') || `${outDir}/manifest.json`);
const baseUrl = args.get('--base-url') || DEFAULT_BASE_URL;
const routeVariantsPath = args.get('--route-variants') ? resolve(String(args.get('--route-variants'))) : null;
const routeVariants = loadRouteVariants(routeVariantsPath);
const lowGrids = numberList(args.get('--low-grids') || args.get('--low-grid'), '96').map((grid) => nearestSupported(grid, SUPPORTED_GRIDS, 96));
const highGrid = nearestSupported(args.get('--high-grid') || 128, SUPPORTED_GRIDS, 128);
const majorantGrid = nearestSupported(args.get('--majorant-grid') || 48, SUPPORTED_MAJORANT_GRIDS, 48);
const settleMs = Number(args.get('--settle-ms') || 8000);
const windowSize = String(args.get('--window-size') || '1280,960');
const debugPort = Number(args.get('--debug-port') || 9700);
const evidenceMode = String(args.get('--evidence-mode') || 'performance');
const reuseWitnessBrowser = args.has('--reuse-witness-browser') || !args.has('--no-reuse-witness-browser');
const witnessBrowserSession = makeWitnessBrowserSession({
  enabled: reuseWitnessBrowser,
  port: debugPort,
  userDataDir: resolve(args.get('--witness-browser-user-data-dir') || `/tmp/kaminos-field-pair-witness-profile-${debugPort}`),
  windowSize,
  initialUrl: applyRouteVariant(baseUrl, routeVariants[0]),
});
const deterministicReplaySteps = Math.max(0, Math.floor(Number(args.get('--deterministic-replay-steps') || 0)));
const deterministicReplayTimeStepMs = Number(args.get('--deterministic-replay-time-step-ms') || (1000 / 60));
const deterministicReplayStartMs = Number(args.get('--deterministic-replay-start-ms') || 1000);
const deterministicReplayStartMsList = args.has('--deterministic-replay-start-ms-list')
  ? numberList(args.get('--deterministic-replay-start-ms-list'), String(deterministicReplayStartMs))
  : [deterministicReplayStartMs];
const deterministicReplayStates = buildDeterministicReplayStates({
  steps: deterministicReplaySteps,
  timeStepMs: deterministicReplayTimeStepMs,
  startTimeMs: deterministicReplayStartMs,
  startTimeList: deterministicReplayStartMsList,
});
const routeReplayViabilityFilter = loadRouteReplayViabilityFilter(
  args.get('--route-replay-viability-manifest'),
  routeVariants,
  deterministicReplayStates
);
const deterministicReplay = deterministicReplayStates[0].deterministicReplay;
const pairAuthority = deterministicReplay.enabled ? DETERMINISTIC_REPLAY_PAIR_AUTHORITY : SEQUENTIAL_PAIR_AUTHORITY;
const fieldTileExport = args.has('--field-tile-export') ? {
  enabled: true,
  schema: FIELD_TILE_EXPORT_SCHEMA,
  selectionPolicy: String(args.get('--field-tile-selection-policy') || 'selected-occupied-fluid-front-tiles').includes('spatial')
    ? 'spatial-binned-occupied-fluid-front-tiles'
    : 'selected-occupied-fluid-front-tiles',
  tileSize: Math.max(4, Math.min(24, Math.floor(Number(args.get('--field-tile-size') || 8)))),
  maxTiles: Math.max(1, Math.min(128, Math.floor(Number(args.get('--field-tile-max-count') || 8)))),
  minCellEnergy: Math.max(0, Number(args.get('--field-tile-min-cell-energy') || 0.015)),
  spatialBinCount: Math.max(2, Math.min(8, Math.floor(Number(args.get('--field-tile-spatial-bins') || 4)))),
  spatialBinIds: stringList(args.get('--field-tile-spatial-bin-ids')),
} : { enabled: false };
const fieldTilePairingPolicy = resolveFieldTilePairingPolicy(args.get('--field-tile-pairing-policy'));
const minCommonSpatialBinPairs = Math.max(0, Math.floor(Number(args.get('--field-tile-min-common-bin-pairs') || 0)));
const preflightOnly = args.has('--preflight-only');
const routeVariantPreflightEnabled = args.has('--route-variant-preflight') || preflightOnly;
const routeVariantPreflightContinueOnFailure = args.has('--route-variant-preflight-continue-on-failure');
const captureRetries = Math.max(0, Math.min(5, Math.floor(Number(args.get('--capture-retries') || 0))));
const captureRetryPolicy = {
  identity: 'capture-retry-same-witness-route-v0',
  maxRetries: captureRetries,
  maxAttempts: captureRetries + 1,
  retryScope: 'per-witness-capture',
  artifactPolicy: 'attempt-specific-out-report-screenshot-stdout-stderr',
};
const dryRun = args.has('--dry-run');
const createdAt = new Date().toISOString();
const gitCommit = gitValue(['rev-parse', 'HEAD']);
const gitBranch = gitValue(['branch', '--show-current']);
const gitStatusShort = gitValue(['status', '--short'], '');
const allPairs = routeVariants.flatMap((routeVariant, variantIndex) => deterministicReplayStates.flatMap((replayState, replayIndex) => lowGrids.map((lowGrid, lowIndex) => {
  const pairIndex = ((variantIndex * deterministicReplayStates.length) + replayIndex) * lowGrids.length + lowIndex;
  const variantBaseUrl = applyRouteVariant(baseUrl, routeVariant);
  const variantPrefix = routeVariants.length > 1 || routeVariant.routeVariantIdentity !== 'base-route-v0'
    ? `${routeVariant.routeVariantIdentity}-`
    : '';
  const replayPrefix = deterministicReplayStates.length > 1 ? `${replayState.replayStateIdentity}-` : '';
  const pairId = `pair-${String(pairIndex + 1).padStart(3, '0')}-${variantPrefix}${replayPrefix}${gridSlug(lowGrid)}-to-${gridSlug(highGrid)}`;
  const pairDir = resolve(outDir, pairId);
  const lowRoute = routeWithGrid(variantBaseUrl, lowGrid, majorantGrid);
  const highRoute = routeWithGrid(variantBaseUrl, highGrid, majorantGrid);
  const lowDebugPort = witnessBrowserSession.enabled ? witnessBrowserSession.port : debugPort + pairIndex * 2;
  const highDebugPort = witnessBrowserSession.enabled ? witnessBrowserSession.port : debugPort + pairIndex * 2 + 1;
  return {
    pairId,
    routeReplayIdentity: routeReplayIdentity(routeVariant.routeVariantIdentity, replayState.replayStateIdentity),
    routeVariantIdentity: routeVariant.routeVariantIdentity,
    routeVariant,
    replayStateIdentity: replayState.replayStateIdentity,
    replayState,
    pairAuthority,
    fieldAuthority: FIELD_AUTHORITY,
    lowGrid,
    highGrid,
    gridScaleRatio: highGrid / lowGrid,
    voxelCountRatio: (highGrid ** 3) / (lowGrid ** 3),
    majorantGrid,
    low: makeCapturePlan({
      pairId,
      role: 'low',
      grid: lowGrid,
      majorantGrid,
      route: lowRoute,
      pairDir,
      debugPort: lowDebugPort,
      settleMs,
      windowSize,
      evidenceMode,
      deterministicReplay: replayState.deterministicReplay,
      fieldTileExport,
      witnessBrowserSession,
    }),
    high: makeCapturePlan({
      pairId,
      role: 'high',
      grid: highGrid,
      majorantGrid,
      route: highRoute,
      pairDir,
      debugPort: highDebugPort,
      settleMs,
      windowSize,
      evidenceMode,
      deterministicReplay: replayState.deterministicReplay,
      fieldTileExport,
      witnessBrowserSession,
    }),
  };
})));
const pairs = allPairs.filter((pair) => routeReplayCellAllowed(
  routeReplayViabilityFilter,
  pair.routeVariantIdentity,
  pair.replayStateIdentity
));

const manifest = {
  schema: DATASET_SCHEMA,
  status: dryRun ? 'dry-run' : (preflightOnly ? 'preflighting' : 'running'),
  createdAt,
  updatedAt: createdAt,
  cwd,
  gitCommit,
  gitBranch,
  gitStatusShort,
  baseUrl,
  routeVariantsPath,
  routeVariants,
  deterministicReplayStates,
  routeReplayViabilityFilter: {
    ...routeReplayViabilityFilter,
    unfilteredPairCount: allPairs.length,
    selectedPairCount: pairs.length,
  },
  outDir,
  manifestPath,
  dryRun,
  preflightOnly,
  trainable: !preflightOnly && !dryRun,
  evidenceClass: preflightOnly ? 'not-trainable-preflight-classification' : 'trainable-field-pair-corpus',
  pairAuthority,
  fieldAuthority: FIELD_AUTHORITY,
  deterministicReplay,
  witnessBrowserSession: {
    ...witnessBrowserSession,
    status: dryRun ? 'not-run-dry-run' : (witnessBrowserSession.enabled ? 'pending' : 'disabled'),
  },
  captureRetryPolicy,
  routeVariantPreflight: {
    schema: ROUTE_VARIANT_PREFLIGHT_SCHEMA,
    enabled: routeVariantPreflightEnabled,
    continueOnFailure: routeVariantPreflightContinueOnFailure,
    status: dryRun ? 'not-run-dry-run' : 'pending',
    receipts: [],
    viabilitySummary: summarizeRouteVariantPreflightViability([]),
  },
  fieldTileExport,
  coverageExpansion: fieldTileExport.enabled ? {
    schema: FIELD_TILE_COVERAGE_PAIRING_SCHEMA,
    identity: fieldTilePairingPolicy === COMMON_SPATIAL_BIN_PAIRING_IDENTITY
      ? COMMON_SPATIAL_BIN_PAIRING_IDENTITY
      : 'selected-tile-count-plus-normalized-pairing-v0',
    requestedMaxTiles: fieldTileExport.maxTiles,
    tileSize: fieldTileExport.tileSize,
    selectionPolicy: fieldTileExport.selectionPolicy,
    spatialBinCount: fieldTileExport.spatialBinCount,
    fieldTilePairingPolicy,
    minCommonSpatialBinPairs,
    pairingAuthority: 'post-capture-selected-tile-metadata-match-not-resampling',
  } : null,
  sameStateFreezeAttempt: buildSameStateFreezeAttempt({ pairAuthority, deterministicReplay }),
  limitation: deterministicReplay.enabled
    ? 'Pairs are fixed-step deterministic replays from the same route/control family; they preserve field authority and logical pairing but are not literal cross-grid GPU snapshot transfers.'
    : 'Pairs are live sequential readbacks from the same route family; they preserve field authority but are not frame-locked supervised tensors.',
  lowGrids,
  lowGrid: lowGrids[0],
  highGrid,
  gridScaleRatio: highGrid / lowGrids[0],
  voxelCountRatio: (highGrid ** 3) / (lowGrids[0] ** 3),
  majorantGrid,
  settleMs,
  windowSize,
  evidenceMode,
  pairs,
  failures: [],
};

writeJson(manifestPath, { dataset: manifest });

let startedWitnessBrowserSession = null;
if (!dryRun && witnessBrowserSession.enabled) {
  try {
    startedWitnessBrowserSession = await startWitnessBrowserSession(witnessBrowserSession);
    const { process: _process, ...serializableSession } = startedWitnessBrowserSession;
    manifest.witnessBrowserSession = serializableSession;
    manifest.updatedAt = new Date().toISOString();
    writeJson(manifestPath, { dataset: manifest });
  } catch (error) {
    manifest.status = 'failed';
    manifest.witnessBrowserSession = {
      ...witnessBrowserSession,
      status: 'failed',
      failurePhase: 'witness-browser-session-launch',
      error: error.message,
    };
    manifest.failures.push({
      code: 'witness-browser-session-launch-failed',
      failurePhase: 'witness-browser-session-launch',
      message: error.message,
      details: {
        port: witnessBrowserSession.port,
        userDataDir: witnessBrowserSession.userDataDir,
        launchPolicy: witnessBrowserSession.launchPolicy,
      },
    });
    manifest.updatedAt = new Date().toISOString();
    writeJson(manifestPath, { dataset: manifest });
  }
}

if (!dryRun && !manifest.failures.length) {
  try {
    manifest.routeVariantPreflight = runRouteVariantPreflights({
      enabled: routeVariantPreflightEnabled,
      continueOnFailure: routeVariantPreflightContinueOnFailure,
      routeReplayViabilityFilter,
      routeVariants,
      deterministicReplayStates,
      lowGrids,
      majorantGrid,
      baseUrl,
      outDir,
      debugPort,
      settleMs,
      windowSize,
      evidenceMode,
      cwd,
      captureRetryPolicy,
      witnessBrowserSession,
    });
    if (!preflightOnly && manifest.routeVariantPreflight.viabilitySummary.failedCells > 0) {
      manifest.failures.push({
        code: 'route-variant-preflight-failed-cells',
        failurePhase: 'route-variant-preflight',
        message: 'route variant preflight found failed route/replay cells; rerun with --preflight-only to classify non-trainable viability or remove failed cells before capture',
        details: {
          viabilitySummary: manifest.routeVariantPreflight.viabilitySummary,
          preflightOnly,
        },
      });
      manifest.status = 'failed';
    }
    if (preflightOnly) {
      manifest.status = manifest.routeVariantPreflight.viabilitySummary.failedCells > 0
        ? 'preflighted-with-failures'
        : 'preflighted';
      manifest.trainable = false;
      manifest.evidenceClass = 'not-trainable-preflight-classification';
    }
    manifest.updatedAt = new Date().toISOString();
    writeJson(manifestPath, { dataset: manifest });
  } catch (error) {
    manifest.status = 'failed';
    const failure = {
      code: error.code || 'route-variant-preflight-failed',
      failurePhase: error.failurePhase || 'route-variant-preflight',
      message: error.message,
      details: error.details || {},
    };
    manifest.failures.push(failure);
    manifest.routeVariantPreflight = {
      schema: ROUTE_VARIANT_PREFLIGHT_SCHEMA,
      enabled: routeVariantPreflightEnabled,
      continueOnFailure: routeVariantPreflightContinueOnFailure,
      status: 'failed',
      failure,
      receipts: Array.isArray(error.partialReceipts) ? error.partialReceipts : [],
      viabilitySummary: summarizeRouteVariantPreflightViability(Array.isArray(error.partialReceipts) ? error.partialReceipts : []),
    };
    manifest.updatedAt = new Date().toISOString();
    writeJson(manifestPath, { dataset: manifest });
  }
}

if (!dryRun && !preflightOnly && !manifest.failures.length) {
  for (const pair of manifest.pairs) {
    try {
      if (fieldTileExport.selectionPolicy === 'spatial-binned-occupied-fluid-front-tiles') {
        pair.low.effective = runCapture(pair.low, cwd, captureRetryPolicy);
        pair.high = withFieldTileSpatialBinIds(pair.high, pair.low.effective.fieldTileExport?.selectedSpatialBins);
        pair.high.effective = runCapture(pair.high, cwd, captureRetryPolicy);
      } else {
        pair.high.effective = runCapture(pair.high, cwd, captureRetryPolicy);
        pair.low.effective = runCapture(pair.low, cwd, captureRetryPolicy);
      }
      pair.fieldTileCoveragePairing = buildFieldTileCoveragePairing(pair, { fieldTilePairingPolicy });
      validateFieldTileCoveragePairing(pair.fieldTileCoveragePairing, {
        fieldTilePairingPolicy,
        minCommonSpatialBinPairs,
      });
      pair.status = 'captured';
    } catch (error) {
      pair.status = 'failed';
      const failure = {
        pairId: pair.pairId,
        code: error.code || 'capture-failed',
        failurePhase: error.failurePhase || 'unknown',
        message: error.message,
        details: error.details || {},
      };
      pair.failure = failure;
      manifest.failures.push(failure);
      break;
    } finally {
      manifest.updatedAt = new Date().toISOString();
      manifest.status = manifest.failures.length ? 'failed' : 'running';
      writeJson(manifestPath, { dataset: manifest });
    }
  }
  if (!manifest.failures.length) {
    manifest.status = 'captured';
    manifest.updatedAt = new Date().toISOString();
    writeJson(manifestPath, { dataset: manifest });
  }
}

if (!dryRun && witnessBrowserSession.enabled) {
  manifest.witnessBrowserSession = await cleanupWitnessBrowserSession(startedWitnessBrowserSession || manifest.witnessBrowserSession);
  manifest.updatedAt = new Date().toISOString();
  writeJson(manifestPath, { dataset: manifest });
}

console.log(JSON.stringify({ dataset: manifest }, null, 2));
if (manifest.failures.length) process.exit(1);
