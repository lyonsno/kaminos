import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const hostSurfaceCorePath = join(root, 'host-surface-core.js');
const hostSurfaceWitnessPath = join(root, 'host-surface-witness.mjs');
const fingerJuiceCorePath = join(root, 'finger-juice-host-core.js');
const lermsHostCorePath = join(root, 'lerms-timeline-host-core.js');
const worldChambersCorePath = join(root, 'world-chambers-core.js');
const indexPath = join(root, 'index.html');

assert.ok(existsSync(hostSurfaceCorePath), 'generic Kaminos host-surface core exists');
assert.ok(existsSync(hostSurfaceWitnessPath), 'generic Kaminos host-surface browser witness exists');
assert.ok(existsSync(fingerJuiceCorePath), 'Finger Juice host adapter still exists');
assert.ok(existsSync(lermsHostCorePath), 'LERMS moving timeline host adapter exists');
assert.ok(existsSync(worldChambersCorePath), 'World Chambers visual normalization exists');
assert.ok(existsSync(indexPath), 'Kaminos app shell exists');

const hostSurfaceWitnessSource = readFileSync(hostSurfaceWitnessPath, 'utf8');
const indexSource = readFileSync(indexPath, 'utf8');
const worldChambersSource = readFileSync(worldChambersCorePath, 'utf8');

assert.match(hostSurfaceWitnessSource, /kaminosHostSurfaceDebugState/, 'generic witness reads host-surface debug state');
assert.match(hostSurfaceWitnessSource, /--expected-host-id/, 'generic witness can assert host adapter identity');
assert.match(hostSurfaceWitnessSource, /--expected-packet-schema/, 'generic witness can assert producer packet schema');
assert.match(hostSurfaceWitnessSource, /--expected-packet-route/, 'generic witness can assert producer packet route');
assert.match(hostSurfaceWitnessSource, /sourceDowngrades/, 'generic witness asserts source-provided downgrade rows');
assert.match(hostSurfaceWitnessSource, /sourceCustody/, 'generic witness asserts source-provided custody rows');
assert.match(hostSurfaceWitnessSource, /kaminosOwnsSourceAlias/, 'generic witness accepts source-owned display custody aliases');
assert.match(hostSurfaceWitnessSource, /motionSamples/, 'generic witness records LERMS moving-timeline motion samples');
assert.match(hostSurfaceWitnessSource, /movedObjectCount/, 'generic witness proves LERMS moving-timeline objects change position');
assert.match(hostSurfaceWitnessSource, /goinObjectCount/, 'generic witness proves LERMS moving-timeline goin objects are present');
assert.match(hostSurfaceWitnessSource, /timelineTrace/, 'generic witness records LERMS timeline trace summary');
assert.match(hostSurfaceWitnessSource, /transitionInspector/, 'generic witness records LERMS selected goin transition inspector state');
assert.match(hostSurfaceWitnessSource, /possessionGlowVisibleCount/, 'generic witness proves carrying-lerm possession glow appears during playback');
assert.match(hostSurfaceWitnessSource, /primary_output_written/, 'generic witness writes durable reports even before screenshot success');
assert.match(indexSource, /kaminosHostSurfaceDebugState/, 'browser exposes generic host-surface debug state');
assert.match(indexSource, /kaminos_lerms_moving_timeline_host=1/, 'browser exposes a direct LERMS moving timeline host route');
assert.match(indexSource, /makeLermsPreviewActivityReadout/, 'browser renders LERMS actor activity readouts');
assert.match(indexSource, /makeLermsPreviewGoinVisualMesh/, 'browser renders LERMS goin visuals from timeline goin state');
assert.match(indexSource, /kaminosLermsPreviewGoin/, 'browser exposes goin visual debug identity');
assert.match(indexSource, /goinVisualCount/, 'browser exposes rendered goin count in LERMS visual state');
assert.match(indexSource, /updateLermsPreviewActorVisualMesh/, 'browser advances LERMS actors with in-place transform updates');
assert.match(indexSource, /updateLermsPreviewGoinVisualMesh/, 'browser advances LERMS goins with in-place transform updates');
assert.match(indexSource, /kaminos\.lerms-preview-timeline-playback-timer\.v1/, 'browser exposes low-churn LERMS playback timer evidence');
assert.match(indexSource, /makeLermsPreviewTimelineTrace/, 'browser renders timeline trace paths for LERMS behavior reading');
assert.match(indexSource, /kaminosLermsTimelineTrace/, 'browser exposes timeline trace debug identity');
assert.match(indexSource, /kaminosLermsTimelineTraceDot/, 'browser exposes per-beat actor and goin trace dot identity');
assert.match(indexSource, /renderLermsPreviewGoinTransitionInspector/, 'browser renders selected-goin transition diagnostics');
assert.match(indexSource, /lerms-preview-goin-transition-list/, 'browser has a goin transition list surface');
assert.match(indexSource, /kaminosLermsPreviewGoinTransitionInspector/, 'browser exposes goin transition inspector debug identity');
assert.match(indexSource, /makeLermsPreviewActorPossessionGlow/, 'browser renders a carrying-lerm possession glow');
assert.match(indexSource, /kaminosLermsPossessionGlow/, 'browser exposes carrying-lerm possession glow debug identity');
assert.match(indexSource, /lerms-preview-actor-path-dot/, 'browser names LERMS actor path dots for witness inspection');
assert.match(indexSource, /lerms-preview-goin-path-dot/, 'browser names LERMS goin path dots for witness inspection');
assert.match(indexSource, /actorPathCount/, 'browser reports actor trace path count');
assert.match(indexSource, /goinPathCount/, 'browser reports goin trace path count');
assert.match(indexSource, /dotCount/, 'browser reports trace dot count');
assert.match(indexSource, /frameLermsPreviewActorVisualsCamera/, 'browser frames the LERMS moving timeline route from rendered actor bounds');
assert.match(indexSource, /kaminosLermsActivityReadout/, 'browser exposes activity readout debug identity');
assert.match(indexSource, /__kaminosLermsPreviewCameraFrame/, 'browser exposes LERMS actor-bounds camera framing evidence');
assert.match(indexSource, /kaminosExcludeFromAODepth/, 'browser excludes overlay cues from AO depth');
assert.match(indexSource, /partial-ground-ring/, 'browser keeps the Mushfinger-style partial ground ring cue');
assert.match(worldChambersSource, /activityReadoutStyle/, 'timeline visual primitives carry activity readout style');
assert.match(worldChambersSource, /statusLabel/, 'timeline visual primitives carry actor status labels');
assert.match(worldChambersSource, /motionLabel/, 'timeline visual primitives carry motion clip labels');
assert.match(worldChambersSource, /createLermsPreviewGoinVisualPrimitives/, 'timeline visual primitives carry goin visual state');
assert.match(worldChambersSource, /createLermsPreviewGoinTransitionDiagnostics/, 'timeline state carries goin transition diagnostics');
assert.match(worldChambersSource, /selectedGoinId/, 'timeline state identifies a selected goin for diagnostic readout');
assert.match(worldChambersSource, /possessionGlow/, 'timeline actor visual primitives carry possession glow state');
assert.match(worldChambersSource, /goinVisualPrimitives/, 'timeline playback interpolates goin visuals');

const hostSurface = await import(hostSurfaceCorePath);
const fingerJuice = await import(fingerJuiceCorePath);
const lermsHost = await import(lermsHostCorePath);

assert.equal(hostSurface.KAMINOS_HOST_SURFACE_STATE_SCHEMA, 'kaminos.host-surface.state.v0');
assert.equal(hostSurface.KAMINOS_HOST_SURFACE_ROUTE, 'kaminos/host-surface');
assert.equal(typeof hostSurface.createHostSurfaceState, 'function');
assert.equal(typeof hostSurface.normalizeRejectedDebugSurface, 'function');
assert.equal(typeof hostSurface.uniqueStrings, 'function');

assert.equal(fingerJuice.FINGER_JUICE_HOST_ADAPTER.hostId, 'finger-juice');
assert.equal(fingerJuice.FINGER_JUICE_HOST_ADAPTER.hostRoute, 'kaminos/finger-juice-host');
assert.equal(fingerJuice.FINGER_JUICE_HOST_ADAPTER.hostStateSchema, 'kaminos.finger-juice-host.state.v0');

assert.equal(lermsHost.KAMINOS_LERMS_MOVING_TIMELINE_HOST_STATE_SCHEMA, 'kaminos.lerms-moving-timeline-host.state.v0');
assert.equal(lermsHost.KAMINOS_LERMS_MOVING_TIMELINE_HOST_ROUTE, 'kaminos/lerms-moving-timeline-host');
assert.equal(lermsHost.LERMS_MOVING_TIMELINE_HOST_ADAPTER.hostId, 'lerms-moving-timeline');
assert.equal(lermsHost.LERMS_MOVING_TIMELINE_HOST_ADAPTER.packetSchema, 'lerms.preview-bench-actor-motion-timeline.v0');
assert.equal(lermsHost.LERMS_MOVING_TIMELINE_HOST_ADAPTER.packetRoute, 'lerms/preview-bench/actor-motion-timeline-file');

const fingerPacket = {
  schema: 'big-papa-finger-juice.host-packet.v0',
  route: 'big-papa/finger-juice/host-packet',
  source: {
    producerDiaulos: 'big-papa-finger-juice-fucker',
    authority: 'host-packet-fixture',
    sourceTruthAuthority: 'big-papa-render-packet',
  },
  freshness: {
    status: 'fresh',
    budgetMs: 1500,
    observedAt: '2026-06-30T00:00:00.000Z',
    generatedAt: '2026-06-30T00:00:00.000Z',
  },
  render: {
    payload: {
      schema: 'big-papa-finger-juice.render-payload.preview.v0',
      downgraded: true,
      particleSamples: [
        { id: 'p0', position: [0, 0.25, 0], radius: 0.05 },
      ],
    },
  },
  custody: {
    bigPapaOwns: ['finger juice packet truth'],
    kaminosOwns: ['host display'],
    downgrades: ['host_packet_preview_payload_not_native_render_buffer'],
  },
};

const fingerState = fingerJuice.createFingerJuiceHostState(fingerPacket, {
  effectiveUrl: '/api/read?root=lerms-preview&path=big-papa-finger-juice-host-packet.json',
  loadedAt: '2026-06-30T00:00:01.000Z',
});
assert.equal(fingerState.schema, 'kaminos.finger-juice-host.state.v0');
assert.equal(fingerState.hostSurfaceSchema, 'kaminos.host-surface.state.v0');
assert.equal(fingerState.hostId, 'finger-juice');
assert.equal(fingerState.hostRoute, 'kaminos/finger-juice-host');
assert.equal(fingerState.packetSchema, 'big-papa-finger-juice.host-packet.v0');
assert.equal(fingerState.packetRoute, 'big-papa/finger-juice/host-packet');
assert.equal(fingerState.sourceAuthority, 'host-packet-fixture');
assert.equal(fingerState.sourceTruthAuthority, 'big-papa-render-packet');
assert.ok(fingerState.downgrades.includes('host_packet_preview_payload_not_native_render_buffer'));
assert.ok(fingerState.rejectedDebugSurfaces.some(surface => surface.acceptanceSurface === false));

const timelineReport = {
  schema: 'lerms.preview-bench-actor-motion-timeline-report.v0',
  route: 'lerms/preview-bench/actor-motion-timeline-file',
  reportPath: '/tmp/lerms-contested-loose-goin-timeline.json',
  timeline: {
    schema: 'lerms.preview-bench-actor-motion-timeline.v0',
    route: 'lerms/preview-bench/actor-motion-timeline-file',
    acceptanceSurface: {
      kind: 'kaminos_preview_bench_timeline',
      worldChamberId: 'lerms-underhill',
      posture: 'inspect',
      bench: 'terrain-preview',
      routeQuery: 'world_chamber=lerms-underhill&posture=inspect&bench=terrain-preview',
    },
    durationMs: 900,
    timeline: [
      {
        schema: 'lerms.preview-bench-actor-motion-timeline-frame.v0',
        frameIndex: 0,
        label: 'loose',
        timeMs: 0,
        actorMotion: [
          { actorId: 'loose-goin-carrier', state: 'carrying_goin', world: [-0.35, 0.42, 0.1], heading: [1, 0, 0], radius: 0.18 },
        ],
      },
      {
        schema: 'lerms.preview-bench-actor-motion-timeline-frame.v0',
        frameIndex: 1,
        label: 'reroute',
        timeMs: 450,
        actorMotion: [
          { actorId: 'loose-goin-carrier', state: 'rerouting', world: [0.2, 0.43, 0.24], heading: [-1, 0, 0.2], radius: 0.18 },
        ],
      },
      {
        schema: 'lerms.preview-bench-actor-motion-timeline-frame.v0',
        frameIndex: 2,
        label: 'hit',
        timeMs: 900,
        actorMotion: [
          { actorId: 'loose-goin-carrier', state: 'hit_reacting', world: [-0.12, 0.5, -0.35], heading: [0.2, 0, -1], radius: 0.16 },
        ],
        hitFlash: { world: [-0.12, 0.62, -0.35], radius: 0.28 },
      },
    ],
    playback: {
      schema: 'lerms.preview-bench-actor-motion-playback.v0',
      loop: true,
      interpolation: 'linear-between-frames',
      timeUnit: 'ms',
    },
    witnessState: {
      schema: 'lerms.preview-bench-actor-motion-timeline-state.v0',
      routeReady: true,
      requiresMotionWitness: true,
      staticActorPayloadAcceptedAsLoop: false,
      frameCount: 3,
    },
    downgrades: [
      'timevarying_payload_not_live_socket_stream',
      'timeline_playback_not_behavior_engine',
    ],
    custody: {
      lermsOwns: ['timelineBehaviorTruth', 'contestedLooseGoinSemantics'],
      kaminosOwns: ['host display', 'camera witness mechanics'],
    },
  },
};

const timelineHostState = lermsHost.createLermsMovingTimelineHostState(timelineReport, {
  effectiveUrl: '/api/read?root=lerms-preview&path=lerms-contested-loose-goin-timeline.json',
  loadedAt: '2026-07-01T00:00:00.000Z',
  payloadSource: {
    mode: 'server_file',
    root: 'lerms-preview',
    path: 'lerms-contested-loose-goin-timeline.json',
  },
});
assert.equal(timelineHostState.schema, 'kaminos.lerms-moving-timeline-host.state.v0');
assert.equal(timelineHostState.hostSurfaceSchema, 'kaminos.host-surface.state.v0');
assert.equal(timelineHostState.hostId, 'lerms-moving-timeline');
assert.equal(timelineHostState.hostRoute, 'kaminos/lerms-moving-timeline-host');
assert.equal(timelineHostState.packetSchema, 'lerms.preview-bench-actor-motion-timeline.v0');
assert.equal(timelineHostState.packetRoute, 'lerms/preview-bench/actor-motion-timeline-file');
assert.equal(timelineHostState.source.producerDiaulos, 'lerm-horde-fucker');
assert.equal(timelineHostState.sourceAuthority, 'source-owned-timeline-packet');
assert.equal(timelineHostState.sourceTruthAuthority, 'lerms.timelineBehaviorTruth');
assert.equal(timelineHostState.frameCount, 3);
assert.equal(timelineHostState.durationMs, 900);
assert.ok(timelineHostState.movingActorIds.includes('loose-goin-carrier'));
assert.ok(timelineHostState.stateTransitions.some(transition => transition.to === 'rerouting'));
assert.ok(timelineHostState.downgrades.includes('timeline_playback_not_behavior_engine'));
assert.ok(timelineHostState.downgrades.includes('timevarying_payload_not_live_socket_stream'));
assert.ok(timelineHostState.sourceDowngrades.includes('timeline_playback_not_behavior_engine'));
assert.ok(timelineHostState.sourceDowngrades.includes('timevarying_payload_not_live_socket_stream'));
assert.ok(timelineHostState.rejectedDebugSurfaces.some(surface => surface.surface === 'old_8790_actor_timeline_debug_route' && surface.acceptanceSurface === false));
assert.ok(timelineHostState.custody.lermsOwns.includes('timelineBehaviorTruth'));
assert.ok(timelineHostState.custody.kaminosOwns.includes('host display'));
assert.ok(timelineHostState.sourceCustody.lermsOwns.includes('timelineBehaviorTruth'));
assert.ok(timelineHostState.sourceCustody.kaminosOwns.includes('host display'));

const gutterglassCustodyReport = structuredClone(timelineReport);
delete gutterglassCustodyReport.timeline.custody.kaminosOwns;
gutterglassCustodyReport.timeline.custody.gutterglassOwns = ['Preview Bench playback and camera witness mechanics'];
const gutterglassCustodyState = lermsHost.createLermsMovingTimelineHostState(gutterglassCustodyReport, {
  effectiveUrl: '/api/read?root=lerms-preview&path=gutterglass-owned-source-rows.json',
  loadedAt: '2026-07-01T00:00:01.500Z',
});
assert.ok(gutterglassCustodyState.sourceCustody.gutterglassOwns.includes('Preview Bench playback and camera witness mechanics'));
assert.ok(gutterglassCustodyState.sourceCustody.kaminosOwns.includes('Preview Bench playback and camera witness mechanics'));
assert.equal(gutterglassCustodyState.sourceCustody.kaminosOwnsSourceAlias, 'gutterglassOwns');

const missingSourceRowsReport = structuredClone(timelineReport);
delete missingSourceRowsReport.timeline.custody;
delete missingSourceRowsReport.timeline.downgrades;
const missingSourceRowsState = lermsHost.createLermsMovingTimelineHostState(missingSourceRowsReport, {
  effectiveUrl: '/api/read?root=lerms-preview&path=missing-source-rows.json',
  loadedAt: '2026-07-01T00:00:02.000Z',
});
assert.ok(missingSourceRowsState.downgrades.includes('timeline_playback_not_behavior_engine'), 'display defaults can still show the adapter downgrade');
assert.ok(missingSourceRowsState.custody.lermsOwns.includes('timelineBehaviorTruth'), 'display defaults can still show adapter custody');
assert.deepEqual(missingSourceRowsState.sourceDowngrades, [], 'source downgrade evidence must not be fabricated from adapter defaults');
assert.deepEqual(missingSourceRowsState.sourceCustody, {}, 'source custody evidence must not be fabricated from adapter defaults');

const genericState = hostSurface.createHostSurfaceState({
  adapter: lermsHost.LERMS_MOVING_TIMELINE_HOST_ADAPTER,
  packetSchema: timelineHostState.packetSchema,
  packetRoute: timelineHostState.packetRoute,
  source: timelineHostState.source,
  freshness: timelineHostState.freshness,
  downgrades: timelineHostState.downgrades,
  rejectedDebugSurfaces: timelineHostState.rejectedDebugSurfaces,
  custody: timelineHostState.custody,
  sourceDowngrades: timelineHostState.sourceDowngrades,
  sourceCustody: timelineHostState.sourceCustody,
  hostSpecific: {
    frameCount: timelineHostState.frameCount,
    movingActorIds: timelineHostState.movingActorIds,
  },
}, { effectiveUrl: timelineHostState.effectiveUrl, loadedAt: timelineHostState.loadedAt });
assert.equal(genericState.schema, 'kaminos.host-surface.state.v0');
assert.equal(genericState.hostId, 'lerms-moving-timeline');
assert.equal(genericState.hostRoute, 'kaminos/lerms-moving-timeline-host');
assert.equal(genericState.packetSchema, 'lerms.preview-bench-actor-motion-timeline.v0');
assert.equal(genericState.sourceAuthority, 'source-owned-timeline-packet');
assert.equal(genericState.sourceTruthAuthority, 'lerms.timelineBehaviorTruth');
assert.ok(genericState.downgrades.includes('timeline_playback_not_behavior_engine'));
assert.ok(genericState.sourceDowngrades.includes('timeline_playback_not_behavior_engine'));
assert.ok(genericState.sourceCustody.lermsOwns.includes('timelineBehaviorTruth'));
assert.ok(genericState.rejectedDebugSurfaces.every(surface => surface.acceptanceSurface === false));
