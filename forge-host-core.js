export const FORGE_HOST_STATION_MANIFEST_SCHEMA = 'kaminos.forge-host.station-manifest.v0';
export const FORGE_HOST_STATION_ANCHOR_SCHEMA = 'kaminos.forge-host.station-anchor.v0';
export const FORGE_HOST_STATION_VISUAL_SCHEMA = 'kaminos.forge-host.station-visual.v0';
export const FORGE_HOST_SMOKE_OFFER_SCHEMA = 'kaminos.forge-host.smoke-offer.v0';
export const FORGE_HOST_SMOKE_CHAMBER_SCHEMA = 'kaminos.forge-host.smoke-chamber.v0';
export const FORGE_HOST_SMOKE_DISPOSITION_RECEIPT_SCHEMA = 'kaminos.forge-host.smoke-disposition-receipt.v0';
export const FORGE_HOST_STATION_ATTENTION_SCHEMA = 'kaminos.forge-host.station-attention.v0';
export const FORGE_HOST_REGISTRY_SNAPSHOT_SCHEMA = 'kaminos.forge-host.registry-snapshot.v0';

export const FORGE_HOST_SMOKE_DISPOSITIONS = ['observed', 'accepted', 'needs-revision', 'blocked', 'parked'];

const STATUS_COLORS = {
  active: '#9fe6bd',
  current: '#f0d28a',
  promoted: '#8fc7d6',
  recent: '#aab0ff',
  inactive: '#7d7d7d',
  stale: '#c78a5b',
  fallback: '#a05a5a',
};

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function receiptSlug(value) {
  return String(value || 'smoke-offer')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'smoke-offer';
}

function offer({
  id,
  producerDiaulos,
  title,
  targetSurface,
  sourceRef,
  targetUrl,
  authority = 'fixture',
  freshness = 'fresh_fixture',
  displayState = 'fixture',
  downgrades = ['fixture_not_live_endpoint'],
}) {
  return {
    schema: FORGE_HOST_SMOKE_OFFER_SCHEMA,
    id,
    producerDiaulos,
    title,
    targetSurface,
    sourceRef,
    targetUrl,
    authority,
    freshness,
    displayState,
    downgrades,
  };
}

export function routeForgeHostSmokeOfferToChamber(offerRecord, station = {}, {
  openedAt = new Date().toISOString(),
} = {}) {
  if (!offerRecord || offerRecord.schema !== FORGE_HOST_SMOKE_OFFER_SCHEMA) {
    throw new Error(`Forge Host smoke chamber route expected ${FORGE_HOST_SMOKE_OFFER_SCHEMA}`);
  }
  if (!offerRecord.sourceRef || !offerRecord.targetSurface) {
    throw new Error(`${offerRecord.id || station.actorId || 'unknown'}: smoke chamber route missing source or target surface`);
  }
  if (['fixture', 'fallback', 'seeded', 'stale'].includes(offerRecord.authority) && offerRecord.displayState === 'live') {
    throw new Error(`${offerRecord.authority} smoke offer claimed live chamber routing for ${offerRecord.id || station.actorId || 'unknown offer'}`);
  }
  return {
    schema: FORGE_HOST_SMOKE_CHAMBER_SCHEMA,
    id: `smoke-chamber:${offerRecord.id}`,
    routeIdentity: 'forge-host-smoke-offer-route',
    openedAt,
    stationActorId: station.actorId || null,
    producerDiaulos: offerRecord.producerDiaulos || station.diaulos || null,
    callSign: station.callSign || titleFromDiaulos(offerRecord.producerDiaulos || station.diaulos),
    sourceAuthority: offerRecord.authority || 'unknown',
    displayState: offerRecord.displayState || 'unknown',
    freshness: offerRecord.freshness || 'unknown',
    targetSurface: offerRecord.targetSurface,
    sourceRef: offerRecord.sourceRef,
    targetUrl: offerRecord.targetUrl || null,
    sourceOffer: cloneJson(offerRecord),
    downgrades: cloneJson(offerRecord.downgrades || []),
    captureAffordances: [
      { id: 'screenshot', label: 'Screenshot', status: 'placeholder' },
      { id: 'filmstrip', label: 'Filmstrip', status: 'placeholder' },
      { id: 'reply', label: 'Reply', status: 'placeholder' },
    ],
    routeWarnings: ['not_chat_bridge', 'not_command_execution'],
  };
}

export function buildForgeHostSmokeDispositionReceipt(chamber, {
  disposition = 'observed',
  operatorNote = '',
  savedAt = new Date().toISOString(),
  screenshot = null,
  receiptId = null,
} = {}) {
  if (!chamber || chamber.schema !== FORGE_HOST_SMOKE_CHAMBER_SCHEMA) {
    throw new Error(`Forge Host smoke disposition expected ${FORGE_HOST_SMOKE_CHAMBER_SCHEMA}`);
  }
  if (!FORGE_HOST_SMOKE_DISPOSITIONS.includes(disposition)) {
    throw new Error(`Unsupported Smoke Chamber disposition: ${disposition}`);
  }
  if (['fixture', 'fallback', 'seeded', 'stale'].includes(chamber.sourceAuthority) && chamber.displayState === 'live') {
    throw new Error(`${chamber.sourceAuthority} smoke chamber claimed live disposition for ${chamber.id || 'unknown chamber'}`);
  }
  const sourceOfferId = chamber.sourceOffer?.id || chamber.id?.replace(/^smoke-chamber:/, '') || 'unknown-offer';
  const effectiveReceiptId = receiptId || `${receiptSlug(sourceOfferId)}-${savedAt.replace(/[^0-9TZ]/g, '').slice(0, 15)}`;
  const screenshotRecord = screenshot
    ? {
        path: screenshot.path || null,
        source: screenshot.source || null,
        bytes: Number(screenshot.bytes || 0),
      }
    : null;
  const evidencePath = screenshotRecord?.path || screenshotRecord?.source || 'pending';
  const returnLine = `Your Smoke Offer ${sourceOfferId} was dispositioned in Kaminos as ${disposition}; evidence: ${evidencePath}. Let's discuss.`;
  return {
    schema: FORGE_HOST_SMOKE_DISPOSITION_RECEIPT_SCHEMA,
    receiptId: effectiveReceiptId,
    chamberId: chamber.id,
    sourceOfferId,
    stationActorId: chamber.stationActorId,
    producerDiaulos: chamber.producerDiaulos,
    sourceAuthority: chamber.sourceAuthority,
    displayState: chamber.displayState,
    sourceRef: chamber.sourceRef,
    targetUrl: chamber.targetUrl,
    targetSurface: chamber.targetSurface,
    disposition,
    operatorNote: String(operatorNote || '').trim(),
    savedAt,
    screenshot: screenshotRecord,
    routeWarnings: cloneJson(chamber.routeWarnings || []),
    downgrades: cloneJson(chamber.downgrades || []),
    returnLine,
  };
}

function titleFromDiaulos(diaulos) {
  return String(diaulos || 'unknown-diaulos')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => part.length <= 4 && part === part.toUpperCase()
      ? part
      : part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ') || 'Unknown Diaulos';
}

function stationLabel(diaulos) {
  const words = titleFromDiaulos(diaulos).split(/\s+/).filter(Boolean);
  if (!words.length) return 'Live';
  const useful = words.filter(word => !/^(and|the|of)$/i.test(word));
  return (useful[0] || words[0]).slice(0, 9);
}

function fallbackAnchorForIndex(index, diaulos) {
  const slots = [
    [-1.72, -0.58, -0.82],
    [-1.05, -0.58, -1.08],
    [-0.36, -0.58, -1.22],
    [0.36, -0.58, -1.22],
    [1.05, -0.58, -1.08],
    [1.72, -0.58, -0.82],
    [-1.66, -0.58, 0.78],
    [1.66, -0.58, 0.78],
    [-0.58, -0.58, 1.24],
    [0.58, -0.58, 1.24],
  ];
  const base = slots[index % slots.length];
  const cycle = Math.floor(index / slots.length);
  const x = Number((base[0] + cycle * 0.18).toFixed(3));
  const z = Number((base[2] + cycle * 0.12).toFixed(3));
  return {
    schema: FORGE_HOST_STATION_ANCHOR_SCHEMA,
    id: `anchor:live-registry:${diaulos || index}`,
    authority: 'host_generated_live_registry_overlay',
    position: [x, base[1], z],
    benchLookTarget: [Number((x * 1.18).toFixed(3)), -0.32, Number((z - 0.55).toFixed(3))],
    offerLookTarget: [Number((x * 0.72).toFixed(3)), -0.22, Number((z + 0.38).toFixed(3))],
  };
}

function fixtureStationByDiaulos(fixtureManifest) {
  return new Map((fixtureManifest?.stations || []).map(station => [station.diaulos, station]));
}

function registryDisplayAuthority(snapshotAuthority, endpointRow = {}) {
  const rowAuthority = endpointRow.sourceAuthority || snapshotAuthority || 'fallback';
  const displayState = endpointRow.displayState || (rowAuthority === 'live_registry' || rowAuthority === 'live' ? 'live' : rowAuthority);
  if (['fixture', 'fallback', 'seeded', 'stale'].includes(rowAuthority) && displayState === 'live') {
    throw new Error(`${rowAuthority} registry row claimed live display authority for ${endpointRow.diaulos || 'unknown diaulos'}`);
  }
  if (snapshotAuthority !== 'live_registry' && displayState === 'live') {
    throw new Error(`${snapshotAuthority || 'unknown'} registry snapshot claimed live display authority for ${endpointRow.diaulos || 'unknown diaulos'}`);
  }
  return {
    rowAuthority,
    offerAuthority: rowAuthority === 'live_registry' ? 'live' : rowAuthority,
    displayState,
  };
}

export function buildForgeHostFixture() {
  const fixtureSource = 'fixture:minion-forge-host-smoke-offers-0628';
  const builtAt = '2026-06-28T00:00:00.000Z';
  return {
    schema: FORGE_HOST_STATION_MANIFEST_SCHEMA,
    fixtureSource,
    sourceAuthority: 'fixture',
    builtAt,
    stations: [
      {
        actorId: 'forge-station:minion-spawnfucker',
        diaulos: 'minion-spawnfucker',
        callSign: 'Minion Spawnfucker',
        role: 'Forge Host',
        status: 'current',
        statusColor: '#f0d28a',
        anchor: {
          schema: FORGE_HOST_STATION_ANCHOR_SCHEMA,
          id: 'anchor:minion-forge-host',
          authority: 'host_static_fixture',
          position: [-1.35, -0.58, 0.1],
          benchLookTarget: [-1.8, -0.32, -0.72],
          offerLookTarget: [-0.88, -0.2, 0.55],
        },
        visual: {
          schema: FORGE_HOST_STATION_VISUAL_SCHEMA,
          shape: 'schnoz_orb_proxy',
          ringLabel: 'Minion',
          radius: 0.24,
          color: '#f0d28a',
        },
        attention: {
          schema: FORGE_HOST_STATION_ATTENTION_SCHEMA,
          mode: 'working',
          primaryLookTarget: 'offer',
          dwellMs: 900,
          jitter: 0.08,
        },
        smokeOffers: [
          offer({
            id: 'offer:minion:kiln-docs',
            producerDiaulos: 'minion-spawnfucker',
            title: 'Kiln Custody Docs',
            targetSurface: 'repo-doc',
            sourceRef: 'kaminos:main@ffe69db:docs/spatial-asset-kiln.md',
            targetUrl: 'docs/spatial-asset-kiln.md',
            downgrades: ['fixture_station_projection', 'doc_surface_not_live_chat'],
          }),
        ],
      },
      {
        actorId: 'forge-station:wake-and-bake-pit-boss',
        diaulos: 'wake-and-bake-pit-boss',
        callSign: 'Wake and Bake Pit Boss',
        role: 'Kiln Bench',
        status: 'promoted',
        statusColor: '#8fc7d6',
        anchor: {
          schema: FORGE_HOST_STATION_ANCHOR_SCHEMA,
          id: 'anchor:wake-kiln-bench',
          authority: 'host_static_fixture',
          position: [0.0, -0.58, -0.46],
          benchLookTarget: [0.38, -0.34, -1.2],
          offerLookTarget: [0.58, -0.26, 0.15],
        },
        visual: {
          schema: FORGE_HOST_STATION_VISUAL_SCHEMA,
          shape: 'schnoz_orb_proxy',
          ringLabel: 'Wake',
          radius: 0.22,
          color: '#8fc7d6',
        },
        attention: {
          schema: FORGE_HOST_STATION_ATTENTION_SCHEMA,
          mode: 'presenting',
          primaryLookTarget: 'offer',
          dwellMs: 760,
          jitter: 0.1,
        },
        smokeOffers: [
          offer({
            id: 'offer:wake:lerms-actor-motion-payload',
            producerDiaulos: 'wake-and-bake-pit-boss',
            title: 'LERMS Actor Motion Payload',
            targetSurface: 'preview-bench',
            sourceRef: 'lerms:cc/red-lerm-body-motion-0626@7967a42:/tmp/lerms-preview-bench-motion-payload-0628.json',
            targetUrl: '?world_chamber=lerms-underhill&posture=inspect&bench=terrain-preview',
            downgrades: ['fixture_station_projection', 'payload_report_not_loaded_in_this_slice'],
          }),
        ],
      },
      {
        actorId: 'forge-station:gutterglass-pornographer',
        diaulos: 'gutterglass-pornographer',
        callSign: 'Gutterglass Pornographer',
        role: 'Preview Bench',
        status: 'recent',
        statusColor: '#9fe6bd',
        anchor: {
          schema: FORGE_HOST_STATION_ANCHOR_SCHEMA,
          id: 'anchor:gutterglass-preview-bench',
          authority: 'host_static_fixture',
          position: [1.28, -0.58, 0.08],
          benchLookTarget: [1.75, -0.34, -0.62],
          offerLookTarget: [0.86, -0.24, 0.52],
        },
        visual: {
          schema: FORGE_HOST_STATION_VISUAL_SCHEMA,
          shape: 'schnoz_orb_proxy',
          ringLabel: 'Gutter',
          radius: 0.21,
          color: '#9fe6bd',
        },
        attention: {
          schema: FORGE_HOST_STATION_ATTENTION_SCHEMA,
          mode: 'aware',
          primaryLookTarget: 'bench',
          dwellMs: 820,
          jitter: 0.12,
        },
        smokeOffers: [
          offer({
            id: 'offer:gutterglass:preview-bench-adapter',
            producerDiaulos: 'gutterglass-pornographer',
            title: 'Preview Bench Adapter',
            targetSurface: 'adapter-report',
            sourceRef: 'projects/perceptasia/topoi/claude-gutterglass-pornographer-0610.reports/preview-bench-adapter-kit_2026-06-28.md',
            targetUrl: '#preview-bench-adapter-kit',
            downgrades: ['fixture_station_projection', 'perceptasia_report_pointer_only'],
          }),
        ],
      },
      {
        actorId: 'forge-station:mushfinger-clayfucker',
        diaulos: 'mushfinger-clayfucker',
        callSign: 'Mushfinger Clayfucker',
        role: 'Motion Grammar',
        status: 'recent',
        statusColor: '#ff9f7a',
        anchor: {
          schema: FORGE_HOST_STATION_ANCHOR_SCHEMA,
          id: 'anchor:mushfinger-motion',
          authority: 'host_static_fixture',
          position: [-0.12, -0.58, 0.92],
          benchLookTarget: [0.28, -0.32, 1.48],
          offerLookTarget: [-0.54, -0.2, 0.38],
        },
        visual: {
          schema: FORGE_HOST_STATION_VISUAL_SCHEMA,
          shape: 'schnoz_orb_proxy',
          ringLabel: 'Mush',
          radius: 0.2,
          color: '#ff9f7a',
        },
        attention: {
          schema: FORGE_HOST_STATION_ATTENTION_SCHEMA,
          mode: 'working',
          primaryLookTarget: 'bench',
          dwellMs: 980,
          jitter: 0.14,
        },
        smokeOffers: [
          offer({
            id: 'offer:mushfinger:motion-custody-review',
            producerDiaulos: 'mushfinger-clayfucker',
            title: 'Motion Custody Review',
            targetSurface: 'upstream-directive',
            sourceRef: 'metadosis/upstream-directives/mushfinger-reviews-landed-kiln-docs-motion-custody_2026-06-29T021442Z.md',
            targetUrl: '#motion-custody-review',
            downgrades: ['fixture_station_projection', 'review_packet_pointer_only'],
          }),
        ],
      },
    ],
  };
}

export function buildForgeHostManifestFromRegistrySnapshot(snapshot, {
  fixtureManifest = buildForgeHostFixture(),
} = {}) {
  if (snapshot?.schema !== FORGE_HOST_REGISTRY_SNAPSHOT_SCHEMA) {
    throw new Error(`Forge Host registry snapshot schema mismatch: ${snapshot?.schema || 'missing'}`);
  }
  const fixtureByDiaulos = fixtureStationByDiaulos(fixtureManifest);
  const stations = [];
  const endpointPath = snapshot.endpointRegistry?.path || 'unknown-endpoint-registry';
  let generatedAnchorIndex = 0;
  for (const [index, endpointRow] of (snapshot.endpoints || []).entries()) {
    const diaulos = endpointRow.diaulos || `unknown-diaulos-${index}`;
    const fixtureStation = fixtureByDiaulos.get(diaulos);
    const { rowAuthority, offerAuthority, displayState } = registryDisplayAuthority(snapshot.sourceAuthority, endpointRow);
    const sourceLive = offerAuthority === 'live' && displayState === 'live';
    const status = endpointRow.status || endpointRow.registryStatus || (sourceLive ? 'active' : displayState);
    const anchor = fixtureStation?.anchor
      ? {
          ...cloneJson(fixtureStation.anchor),
          authority: 'host_static_fixture_overlay',
        }
      : fallbackAnchorForIndex(generatedAnchorIndex++, diaulos);
    const visual = fixtureStation?.visual
      ? cloneJson(fixtureStation.visual)
      : {
          schema: FORGE_HOST_STATION_VISUAL_SCHEMA,
          shape: 'schnoz_orb_proxy',
          ringLabel: stationLabel(diaulos),
          radius: 0.19,
          color: STATUS_COLORS[status] || '#9fe6bd',
        };
    const callSign = endpointRow.callSign || titleFromDiaulos(diaulos);
    stations.push({
      actorId: `forge-station:${diaulos}`,
      diaulos,
      diaulosId: endpointRow.diaulosId || null,
      callSign,
      role: endpointRow.role || fixtureStation?.role || 'Live Diaulos',
      status,
      sourceAuthority: rowAuthority,
      displayState,
      registryStatus: endpointRow.registryStatus || null,
      observedAt: endpointRow.observedAt || null,
      sourceTopoi: endpointRow.sourceTopoi || [],
      endpoint: endpointRow.endpoint || {},
      statusColor: fixtureStation?.statusColor || STATUS_COLORS[status] || STATUS_COLORS.active,
      anchor,
      visual,
      attention: fixtureStation?.attention
        ? cloneJson(fixtureStation.attention)
        : {
            schema: FORGE_HOST_STATION_ATTENTION_SCHEMA,
            mode: sourceLive ? 'aware' : 'fallback',
            primaryLookTarget: sourceLive ? 'camera' : 'bench',
            dwellMs: 740,
            jitter: 0.16,
          },
      smokeOffers: [
        offer({
          id: `offer:${diaulos}:live-endpoint`,
          producerDiaulos: diaulos,
          title: sourceLive ? 'Live Endpoint' : 'Registry Placeholder',
          targetSurface: 'diaulos-endpoint',
          sourceRef: `${endpointPath}#${diaulos}`,
          targetUrl: endpointRow.endpoint?.resume || endpointRow.endpoint?.cwd || `#forge-station:${diaulos}`,
          authority: offerAuthority,
          freshness: endpointRow.observedAt || snapshot.loadedAt || 'unknown',
          displayState,
          downgrades: sourceLive
            ? ['endpoint_registry_presence_only', 'not_chat_bridge', 'not_domain_truth']
            : ['registry_not_live', 'not_chat_bridge', 'not_domain_truth'],
        }),
      ],
    });
  }
  return {
    schema: FORGE_HOST_STATION_MANIFEST_SCHEMA,
    sourceAuthority: snapshot.sourceAuthority || 'fallback',
    fixtureSource: fixtureManifest?.fixtureSource || null,
    registrySource: {
      schema: snapshot.schema,
      endpointRegistry: snapshot.endpointRegistry || null,
      diaulosRegistry: snapshot.diaulosRegistry || null,
      warnings: snapshot.warnings || [],
    },
    builtAt: snapshot.loadedAt || new Date().toISOString(),
    stations,
  };
}

function distance(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function mixTarget(a, b, amount) {
  return [
    a[0] * (1 - amount) + b[0] * amount,
    a[1] * (1 - amount) + b[1] * amount,
    a[2] * (1 - amount) + b[2] * amount,
  ];
}

export function deriveForgeStationAttention(station, {
  selectedActorId = null,
  cameraPosition = [0, 1.2, 4],
  timeSeconds = 0,
} = {}) {
  const anchor = station.anchor || {};
  const position = anchor.position || [0, 0, 0];
  const cameraDistance = distance(position, cameraPosition);
  const operatorProximity = Math.max(0, Math.min(1, 1 - ((cameraDistance - 1.25) / 5.5)));
  const selected = station.actorId === selectedActorId;
  const baseMode = selected ? 'selected' : (operatorProximity > 0.5 ? 'aware' : station.attention?.mode || 'idle');
  const wander = [
    position[0] + Math.sin(timeSeconds * 0.9 + position[0]) * 0.42,
    position[1] + 0.34 + Math.sin(timeSeconds * 0.6 + position[2]) * 0.08,
    position[2] + Math.cos(timeSeconds * 0.75 + position[2]) * 0.42,
  ];
  const offerTarget = anchor.offerLookTarget || anchor.benchLookTarget || wander;
  const benchTarget = anchor.benchLookTarget || offerTarget;
  const cameraTarget = [cameraPosition[0], Math.max(position[1] + 0.18, cameraPosition[1] - 0.2), cameraPosition[2]];
  const glanceCycle = Math.sin(timeSeconds * 0.7 + position[0] * 2.3);
  let primaryLookTarget = selected ? 'camera' : (station.attention?.primaryLookTarget || 'bench');
  if (!selected && operatorProximity > 0.36 && glanceCycle > 0.28) primaryLookTarget = 'camera';
  if (!selected && operatorProximity < 0.12 && glanceCycle < -0.45) primaryLookTarget = 'wander';
  const targetByKind = {
    camera: cameraTarget,
    offer: offerTarget,
    bench: benchTarget,
    wander,
  };
  const rawTarget = targetByKind[primaryLookTarget] || wander;
  const lookTargetWorld = selected
    ? mixTarget(offerTarget, cameraTarget, 0.68)
    : rawTarget;
  return {
    schema: FORGE_HOST_STATION_ATTENTION_SCHEMA,
    actorId: station.actorId,
    mode: baseMode,
    primaryLookTarget,
    lookTargetWorld,
    operatorProximity: Number(operatorProximity.toFixed(3)),
    offerFreshness: station.smokeOffers?.[0]?.freshness || 'unknown',
    dwellMs: station.attention?.dwellMs || 800,
    jitter: station.attention?.jitter || 0,
    source: station.sourceAuthority || 'fixture',
  };
}

export function validateForgeHostStationManifest(manifest) {
  const falseAuthorityViolations = [];
  const stationIds = new Set();
  if (manifest?.schema !== FORGE_HOST_STATION_MANIFEST_SCHEMA) {
    falseAuthorityViolations.push('manifest schema mismatch');
  }
  for (const station of manifest?.stations || []) {
    if (stationIds.has(station.actorId)) falseAuthorityViolations.push(`duplicate station actor id: ${station.actorId}`);
    stationIds.add(station.actorId);
    if (['fixture', 'fallback', 'seeded', 'stale'].includes(station.sourceAuthority) && station.displayState === 'live') {
      falseAuthorityViolations.push(`${station.actorId}: ${station.sourceAuthority} station claimed live display authority`);
    }
    for (const offerRecord of station.smokeOffers || []) {
      if (offerRecord.schema !== FORGE_HOST_SMOKE_OFFER_SCHEMA) {
        falseAuthorityViolations.push(`${offerRecord.id || station.actorId}: smoke offer schema mismatch`);
      }
      if (['fixture', 'fallback', 'seeded'].includes(offerRecord.authority) && offerRecord.displayState === 'live') {
        falseAuthorityViolations.push(`${offerRecord.id}: ${offerRecord.authority} offer claimed live display authority`);
      }
      if (!offerRecord.sourceRef || !offerRecord.targetSurface) {
        falseAuthorityViolations.push(`${offerRecord.id || station.actorId}: smoke offer missing source or target surface`);
      }
    }
  }
  return {
    schema: 'kaminos.forge-host.station-manifest-validation.v0',
    ok: falseAuthorityViolations.length === 0,
    stationCount: manifest?.stations?.length || 0,
    smokeOfferCount: (manifest?.stations || []).reduce((total, station) => total + (station.smokeOffers?.length || 0), 0),
    falseAuthorityViolations,
  };
}

export function cloneForgeHostManifest(manifest = buildForgeHostFixture()) {
  return cloneJson(manifest);
}
