export const FORGE_HOST_STATION_MANIFEST_SCHEMA = 'kaminos.forge-host.station-manifest.v0';
export const FORGE_HOST_STATION_ANCHOR_SCHEMA = 'kaminos.forge-host.station-anchor.v0';
export const FORGE_HOST_STATION_VISUAL_SCHEMA = 'kaminos.forge-host.station-visual.v0';
export const FORGE_HOST_SMOKE_OFFER_SCHEMA = 'kaminos.forge-host.smoke-offer.v0';
export const FORGE_HOST_STATION_ATTENTION_SCHEMA = 'kaminos.forge-host.station-attention.v0';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
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
    source: 'fixture',
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
