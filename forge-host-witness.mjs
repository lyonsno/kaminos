#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  applyForgeHostLayoutToRegistry,
  buildForgeHostLayoutWitnessSummary,
  buildForgeHostWitnessSummary,
  createForgeHostStaticLayoutFromRegistry,
  createForgeHostFixtureRegistry,
  createForgeHostRegistryFromDiaulosRegistry,
  validateForgeHostStaticLayout,
} from './forge-host-core.js';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const reportPath = resolve(args.get('--report') || '/tmp/kaminos-forge-host-witness.json');
const claimSourceKind = args.get('--claim-source-kind') || 'fixture';
const sourceKind = args.get('--source-kind') || 'fixture';
const sourceId = args.get('--source-id') || undefined;
const registryJsonPath = args.get('--registry-json') ? resolve(args.get('--registry-json')) : null;
const layoutJsonPath = args.get('--layout-json') ? resolve(args.get('--layout-json')) : null;
const fallback = args.get('--fallback') === '1' || sourceKind === 'demo-fallback';
const WITNESS_FALSE_CLAIM_PREDICATES = [
  'claimed live data but effective source is fixture',
  'demo fallback data cannot satisfy a seeded or live forge-host witness',
  'Forge Host static layout cannot claim dynamics authority',
];

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

function loadRegistry() {
  if (!registryJsonPath) return createForgeHostFixtureRegistry({ sourceKind, sourceId, fallback });
  const registryJson = JSON.parse(readFileSync(registryJsonPath, 'utf8'));
  return createForgeHostRegistryFromDiaulosRegistry(registryJson, {
    sourceKind: sourceKind === 'fixture' ? 'live' : sourceKind,
    sourceId: sourceId || registryJsonPath,
  });
}

function loadLayout(registry) {
  if (!layoutJsonPath) {
    return createForgeHostStaticLayoutFromRegistry(registry, {
      sourceKind: 'route-local-default',
      sourceId: 'route:forge-host-witness-derived-static-layout',
      persisted: false,
    });
  }
  const layoutJson = JSON.parse(readFileSync(layoutJsonPath, 'utf8'));
  return validateForgeHostStaticLayout(layoutJson, { claimedAuthority: 'persisted-static-layout' });
}

try {
  let registry = loadRegistry();
  const layout = loadLayout(registry);
  const layoutSummary = buildForgeHostLayoutWitnessSummary(layout, {
    claimedAuthority: layoutJsonPath ? 'persisted-static-layout' : 'static-host-owned-station-anchors',
  });
  registry = applyForgeHostLayoutToRegistry(registry, layout);
  const summary = buildForgeHostWitnessSummary(registry, { claimedSourceKind: claimSourceKind });
  writeReport({
    ok: true,
    phase: 'forge-host-witness-summary',
    sourceIdentity: summary.sourceIdentity,
    source: summary.source,
    layoutSourceIdentity: layoutSummary.layoutSourceIdentity,
    layout: layoutSummary,
    claimedSourceKind: summary.claimedSourceKind,
    actorBuckets: summary.actorBuckets,
    stationGroupSummary: summary.stationGroupSummary,
    selectedActor: summary.selectedActor,
    actorIds: summary.actorIds,
    filteredDiauloi: summary.filteredDiauloi,
    missingRequestedDiauloi: summary.missingRequestedDiauloi,
  });
} catch (error) {
  let registry = null;
  let layout = null;
  try {
    registry = loadRegistry();
    layout = registry ? loadLayout(registry) : null;
  } catch {
    registry = createForgeHostFixtureRegistry({ sourceKind, sourceId, fallback });
  }
  writeReport({
    ok: false,
    phase: 'forge-host-witness-summary',
    error: error.message,
    sourceIdentity: registry?.source?.id || sourceId || null,
    source: registry?.source || null,
    layoutSourceIdentity: layout?.source?.id || null,
    layout: layout ? {
      source: layout.source || null,
      authority: layout.authority || null,
      anchorCount: Array.isArray(layout.anchors) ? layout.anchors.length : null,
    } : null,
    claimedSourceKind: claimSourceKind,
    actorBuckets: null,
    stationGroupSummary: registry?.stationGroups || null,
    selectedActor: null,
  });
  throw error;
}
