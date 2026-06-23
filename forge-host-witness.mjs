#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  buildForgeHostWitnessSummary,
  createForgeHostFixtureRegistry,
  createForgeHostRegistryFromDiaulosRegistry,
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
const fallback = args.get('--fallback') === '1' || sourceKind === 'demo-fallback';
const WITNESS_FALSE_CLAIM_PREDICATES = [
  'claimed live data but effective source is fixture',
  'demo fallback data cannot satisfy a seeded or live forge-host witness',
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

try {
  const registry = loadRegistry();
  const summary = buildForgeHostWitnessSummary(registry, { claimedSourceKind: claimSourceKind });
  writeReport({
    ok: true,
    phase: 'forge-host-witness-summary',
    sourceIdentity: summary.sourceIdentity,
    source: summary.source,
    claimedSourceKind: summary.claimedSourceKind,
    actorBuckets: summary.actorBuckets,
    selectedActor: summary.selectedActor,
    actorIds: summary.actorIds,
    filteredDiauloi: summary.filteredDiauloi,
    missingRequestedDiauloi: summary.missingRequestedDiauloi,
  });
} catch (error) {
  let registry = null;
  try {
    registry = loadRegistry();
  } catch {
    registry = createForgeHostFixtureRegistry({ sourceKind, sourceId, fallback });
  }
  writeReport({
    ok: false,
    phase: 'forge-host-witness-summary',
    error: error.message,
    sourceIdentity: registry?.source?.id || sourceId || null,
    source: registry?.source || null,
    claimedSourceKind: claimSourceKind,
    actorBuckets: null,
    selectedActor: null,
  });
  throw error;
}
