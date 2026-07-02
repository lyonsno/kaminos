import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const hostCorePath = join(root, 'glove-well-host-core.js');
const indexPath = join(root, 'index.html');
const nativeHostLitePath = join(root, 'native-host-lite.js');

function makeGloveWellPacket() {
  return {
    schema: 'lerms.glove-well-host-packet.v0',
    route: 'lerms/glove-well/host-packet',
    hostCandidate: {
      kind: 'kaminos_native_host_candidate',
      hostId: 'glove-well',
      hostLabel: 'Glove Well',
      requestedAdapter: 'glove-well',
    },
    source: {
      producerDiaulos: 'greedy-glove-fucker',
      authority: 'live_simulation',
      sourceTruthAuthority: 'lerms.gloveWellBrowserSmokeState',
      endpoint: '/kaminos-hand-control-sidecar-event',
      effectiveRoute: 'native_wilor_mini_mlx_detector_sidecar_live',
      backend: 'native_wilor_mini_mlx_detector_sidecar_live',
      frameId: 'host-packet-prime-34',
    },
    freshness: {
      status: 'fresh',
      ageMs: 54,
      cameraAgeMs: 54,
      budgetMs: 180,
    },
    coordinateFrame: {
      space: 'operator_visible_webcam_mirrored_screen_normalized',
      origin: 'top_left',
      xRange: [0, 1],
      yRange: [0, 1],
      depthLoadBearing: false,
    },
    gloveWell: {
      phase: 'priming',
      statusCode: 'tracking',
      releaseCount: 1,
      aim: {
        active: true,
        origin: { x: 0.33, y: 0.595 },
        direction: { x: -0.638, y: -0.77 },
        arcSamples: [
          { t: 0.143, x: 0.299, y: 0.559 },
          { t: 0.286, x: 0.268, y: 0.528 },
        ],
      },
      hand: {
        palmCenter: { x: 0.57, y: 0.68 },
        pinkyTip: { x: 0.33, y: 0.595 },
        pinchActive: true,
      },
    },
    goins: [
      { id: 'launched-goin-001', state: 'rolling', position: { x: 0.316, y: 0.579 }, desireRadius: 0.179 },
      { id: 'primed-goin-002', state: 'held', position: { x: 0.57, y: 0.68 }, desireRadius: 0 },
    ],
    lermDesireHints: [
      {
        schema: 'lerms.glove-well-host-desire-hint.v0',
        lermId: 'nearby-red-lerm-001',
        targetGoinId: 'launched-goin-001',
        target: { x: 0.316, y: 0.579 },
        pull: 0.84,
        radius: 0.179,
        reason: 'rolling_goin_lure',
      },
    ],
    surface: {
      schema: 'lerms.glove-well-host-surface.v0',
      surfaceId: 'glove-well-native-smoke',
      hostRouteExpectation: 'kaminos/glove-well-host',
      layers: [
        { id: 'glove-well', label: 'Glove Well', sourceOwned: true },
        { id: 'hand-tracking', label: 'Hand Tracking', sourceOwned: true },
        { id: 'goins', label: 'Goins', sourceOwned: true },
        { id: 'lerm-desire', label: 'Lerm Desire', sourceOwned: true },
        { id: 'source-truth', label: 'Source Truth', sourceOwned: true },
        { id: 'capture', label: 'Capture', sourceOwned: false },
      ],
      primitives: [
        { id: 'glove-well-core', layerId: 'glove-well', kind: 'ellipse', role: 'wealth_source', center: { x: 0.18, y: 0.65 }, radiusX: 0.12, radiusY: 0.09, color: '#f4c64f' },
        { id: 'hand-bone-0', layerId: 'hand-tracking', kind: 'line', role: 'hand_skeleton_bone', start: { x: 0.57, y: 0.86 }, end: { x: 0.545, y: 0.72 }, color: '#82e2be' },
        { id: 'aim-arc-01', layerId: 'hand-tracking', kind: 'point', role: 'aim_arc_sample', center: { x: 0.299, y: 0.559 }, radius: 0.006, color: '#dfe7ff' },
        { id: 'goin-launched-goin-001', layerId: 'goins', kind: 'ellipse', role: 'rolling_goin', center: { x: 0.316, y: 0.579 }, radiusX: 0.026, radiusY: 0.022, color: '#f4c64f' },
        { id: 'lerm-desire-link-001', layerId: 'lerm-desire', kind: 'line', role: 'lerm_desire_link', start: { x: 0.68, y: 0.68 }, end: { x: 0.316, y: 0.579 }, color: '#ffe789', alpha: 0.84 },
      ],
      statusBadges: [
        { id: 'authority', label: 'Authority', value: 'live_simulation', authorityBearing: true },
        { id: 'freshness', label: 'Freshness', value: 'fresh', authorityBearing: true },
      ],
      controls: [
        { id: 'capture-filmstrip', label: 'Capture Filmstrip', sourceOwned: false },
      ],
      witnessExpectations: {
        expectedHostId: 'glove-well',
        expectedPacketSchema: 'lerms.glove-well-host-packet.v0',
        expectedPacketRoute: 'lerms/glove-well/host-packet',
        requiredDowngrades: [
          'local_browser_smoke_not_native_kaminos_host',
          'visual_capture_not_source_truth',
        ],
        requiredPrimitiveRoles: [
          'wealth_source',
          'rolling_goin',
          'hand_skeleton_bone',
          'aim_arc_sample',
          'lerm_desire_link',
        ],
        requiredSourceRows: [
          'source.authority',
          'source.effectiveRoute',
          'freshness.status',
          'downgrades',
          'custody.greedyOwns',
          'custody.kaminosOwns',
        ],
      },
    },
    capture: {
      state: 'complete',
      reportPath: '/tmp/lerms-glove-well-browser-smoke-capture-live-0701/capture-report.json',
      filmstripPath: '/tmp/lerms-glove-well-browser-smoke-capture-live-0701/filmstrip.html',
    },
    downgrades: [
      'local_browser_smoke_not_native_kaminos_host',
      'visual_capture_not_source_truth',
    ],
    rejectedDebugSurfaces: [
      {
        surface: 'local_lerms_browser_smoke',
        label: 'Local LERMS browser smoke',
        acceptanceSurface: false,
        reason: 'debug surface, not native Kaminos host acceptance',
      },
      {
        surface: 'preview_bench_smoke_offer_card',
        label: 'Preview Bench smoke-offer card',
        acceptanceSurface: false,
        reason: 'evidence card, not operator scene host',
      },
    ],
    custody: {
      greedyOwns: ['gloveWellCommandTruth', 'goinThrowRollDesireLaw', 'sourceOwnedHostPacket'],
      kaminosOwns: ['native host display', 'camera witness mechanics', 'host-surface adapter validation'],
      palmDaddyOwns: ['firstVerticalSourceTruthAcceptance'],
    },
  };
}

assert.ok(existsSync(hostCorePath), 'Kaminos native Glove Well host core exists');
assert.ok(existsSync(indexPath), 'Kaminos app shell exists');
assert.ok(existsSync(nativeHostLitePath), 'Kaminos has a lightweight native-host boot module');

const hostCoreSource = readFileSync(hostCorePath, 'utf8');
const indexSource = readFileSync(indexPath, 'utf8');
const nativeHostLiteSource = readFileSync(nativeHostLitePath, 'utf8');
const gloveWellHostMarkup = indexSource.slice(
  indexSource.indexOf('id="tab-glove-well-host"'),
  indexSource.indexOf('id="tab-finger-juice-host"'),
);

assert.match(hostCoreSource, /KAMINOS_GLOVE_WELL_HOST_STATE_SCHEMA\s*=\s*'kaminos\.glove-well-host\.state\.v0'/, 'native host state schema is explicit');
assert.match(hostCoreSource, /KAMINOS_GLOVE_WELL_HOST_ROUTE\s*=\s*'kaminos\/glove-well-host'/, 'native host route identity is explicit');
assert.match(hostCoreSource, /LERMS_GLOVE_WELL_HOST_PACKET_SCHEMA\s*=\s*'lerms\.glove-well-host-packet\.v0'/, 'host core preserves Greedy packet schema identity');
assert.match(hostCoreSource, /LERMS_GLOVE_WELL_HOST_SURFACE_SCHEMA\s*=\s*'lerms\.glove-well-host-surface\.v0'/, 'host core preserves Greedy surface schema identity');
assert.match(hostCoreSource, /normalizeGloveWellHostPacket/, 'host core exports host packet normalization');
assert.match(hostCoreSource, /createGloveWellHostState/, 'host core exports Kaminos host-state creation');

assert.match(indexSource, /data-tab="glove-well-host"/, 'Kaminos sidebar exposes a native Glove Well host tab');
assert.match(indexSource, /id="tab-glove-well-host"/, 'Kaminos app shell contains native Glove Well host content');
assert.match(indexSource, /params\.get\('kaminos_glove_well_host'\) === '1'/, 'Kaminos route can open directly into the native host');
assert.match(indexSource, />Update now</, 'operator-facing Glove Well control exposes a one-shot preview update');
assert.match(indexSource, />Resume updates</, 'operator-facing Glove Well control resumes following the source');
assert.match(indexSource, />Pause updates</, 'operator-facing Glove Well control pauses source updates');
assert.match(indexSource, /id="glove-well-host-live-start"/, 'native host exposes a resume-updates control');
assert.match(indexSource, /id="glove-well-host-live-stop"/, 'native host exposes a pause-updates control');
assert.match(indexSource, /id="glove-well-host-live-status"/, 'native host shows effective update state');
assert.doesNotMatch(gloveWellHostMarkup, />Load Packet<|>Start Packet Polling<|>Stop Packet Polling</, 'first-read Glove Well controls must not expose packet/polling substrate labels');
assert.match(indexSource, /nativeHostOnly/, 'canvas native-host routes have a fast path that skips full editor/WebGPU bootstrap');
assert.match(indexSource, /native-host-lite\.js/, 'Glove Well native host route can load the lightweight host module');
assert.match(indexSource, /kaminos-main\.js/, 'full editor bootstrap is loaded only when the route is not a native host smoke');
assert.match(nativeHostLiteSource, /glove-well-host-core\.js/, 'lightweight host imports only the Glove Well host core contract');
assert.doesNotMatch(nativeHostLiteSource, /from 'three'|from "three"|three\/addons|three\/tsl/, 'lightweight Glove Well host must not import the Three/editor stack');
assert.match(nativeHostLiteSource, /glove_well_host_root/, 'native host supports file-root packet loading');
assert.match(nativeHostLiteSource, /glove_well_host_path/, 'native host supports file-path packet loading');
assert.match(nativeHostLiteSource, /glove_well_host_url/, 'native host supports direct packet URL loading');
assert.match(nativeHostLiteSource, /glove_well_host_live/, 'native host supports explicit live polling route mode');
assert.match(nativeHostLiteSource, /glove_well_host_poll_ms/, 'native host supports caller-selected live poll cadence');
assert.match(nativeHostLiteSource, /No preview loaded|Updating|Paused|Update failed/, 'lightweight host preserves product-facing update status language');
assert.match(nativeHostLiteSource, /startButton\.hidden = updating/, 'lightweight host hides resume while following source updates');
assert.match(nativeHostLiteSource, /startButton\.style\.display = updating \? 'none' : ''/, 'lightweight host display state cannot be overridden by button CSS');
assert.match(nativeHostLiteSource, /stopButton\.hidden = !updating/, 'lightweight host hides pause while source updates are paused');
assert.match(nativeHostLiteSource, /stopButton\.style\.display = updating \? '' : 'none'/, 'lightweight host display state cannot expose both live controls');
assert.doesNotMatch(nativeHostLiteSource, /packet idle|packet loading|packet loaded|packet polling|packet polling stopped|packet polling error/, 'lightweight host status must not expose packet/polling substrate labels');
assert.match(indexSource, /id="glove-well-host-canvas"/, 'native host owns a canvas instead of accepting a LERMS debug page as host surface');
assert.match(nativeHostLiteSource, /window\.kaminosGloveWellHostDebugState/, 'native host exposes state for browser witnesses');
assert.match(nativeHostLiteSource, /window\.kaminosStartGloveWellHostLive/, 'native host exposes live polling start for witnesses/producers');
assert.match(nativeHostLiteSource, /window\.kaminosStopGloveWellHostLive/, 'native host exposes live polling stop for witnesses/producers');
assert.match(nativeHostLiteSource, /packetLoadCount/, 'native host debug state records load count for live/polling evidence');
assert.match(nativeHostLiteSource, /local_browser_smoke_not_native_kaminos_host/, 'native host displays local-browser downgrade');
assert.match(nativeHostLiteSource, /visual_capture_not_source_truth/, 'native host displays visual-capture downgrade');

const mod = await import(hostCorePath);
assert.equal(mod.KAMINOS_GLOVE_WELL_HOST_STATE_SCHEMA, 'kaminos.glove-well-host.state.v0');
assert.equal(mod.KAMINOS_GLOVE_WELL_HOST_ROUTE, 'kaminos/glove-well-host');
assert.equal(mod.LERMS_GLOVE_WELL_HOST_PACKET_SCHEMA, 'lerms.glove-well-host-packet.v0');
assert.equal(mod.LERMS_GLOVE_WELL_HOST_PACKET_ROUTE, 'lerms/glove-well/host-packet');
assert.equal(mod.LERMS_GLOVE_WELL_HOST_SURFACE_SCHEMA, 'lerms.glove-well-host-surface.v0');

const packet = makeGloveWellPacket();
const normalized = mod.normalizeGloveWellHostPacket(packet);
assert.equal(normalized.schema, 'lerms.glove-well-host-packet.v0');
assert.equal(normalized.route, 'lerms/glove-well/host-packet');
assert.equal(normalized.source.authority, 'live_simulation');
assert.equal(normalized.source.sourceTruthAuthority, 'lerms.gloveWellBrowserSmokeState');
assert.equal(normalized.surface.schema, 'lerms.glove-well-host-surface.v0');
assert.equal(normalized.surface.hostRouteExpectation, 'kaminos/glove-well-host');
assert.equal(normalized.surface.primitives.length, 5);
assert.deepEqual(normalized.surface.primitiveRoles.sort(), [
  'aim_arc_sample',
  'hand_skeleton_bone',
  'lerm_desire_link',
  'rolling_goin',
  'wealth_source',
]);
assert.ok(normalized.downgrades.includes('local_browser_smoke_not_native_kaminos_host'));
assert.ok(normalized.downgrades.includes('visual_capture_not_source_truth'));
assert.ok(normalized.rejectedDebugSurfaces.some(surface => surface.surface === 'preview_bench_smoke_offer_card' && surface.acceptanceSurface === false));

const state = mod.createGloveWellHostState(packet, {
  effectiveUrl: '/api/read?root=scratch&path=greedy-glove-well-host-packet-0701.json',
});
assert.equal(state.schema, 'kaminos.glove-well-host.state.v0');
assert.equal(state.route, 'kaminos/glove-well-host');
assert.equal(state.packetSchema, 'lerms.glove-well-host-packet.v0');
assert.equal(state.packetRoute, 'lerms/glove-well/host-packet');
assert.equal(state.sourceAuthority, 'live_simulation');
assert.equal(state.sourceTruthAuthority, 'lerms.gloveWellBrowserSmokeState');
assert.equal(state.freshness.status, 'fresh');
assert.equal(state.coordinateFrame.space, 'operator_visible_webcam_mirrored_screen_normalized');
assert.equal(state.surface.schema, 'lerms.glove-well-host-surface.v0');
assert.equal(state.surface.primitiveCount, 5);
assert.ok(state.surface.primitiveRoles.includes('wealth_source'));
assert.ok(state.sourceDowngrades.includes('local_browser_smoke_not_native_kaminos_host'));
assert.ok(state.sourceDowngrades.includes('visual_capture_not_source_truth'));
assert.ok(state.sourceCustody.greedyOwns.includes('goinThrowRollDesireLaw'));
assert.ok(state.sourceCustody.kaminosOwns.includes('native host display'));
assert.ok(state.sourceCustody.palmDaddyOwns.includes('firstVerticalSourceTruthAcceptance'));
assert.equal(state.hostSpecific.goinCount, 2);
assert.equal(state.hostSpecific.lermDesireHintCount, 1);
assert.equal(state.hostSurface.hostSpecific.primitiveCount, 5);

const missingSurfacePacket = structuredClone(packet);
delete missingSurfacePacket.surface;
assert.throws(
  () => mod.normalizeGloveWellHostPacket(missingSurfacePacket),
  /Glove Well host packet missing source-owned surface/,
  'Kaminos must not rederive Glove Well render primitives from raw state',
);

const defaultsOnlyPacket = structuredClone(packet);
delete defaultsOnlyPacket.downgrades;
delete defaultsOnlyPacket.custody.greedyOwns;
delete defaultsOnlyPacket.custody.kaminosOwns;
const defaultsOnlyState = mod.createGloveWellHostState(defaultsOnlyPacket, {
  effectiveUrl: '/api/read?root=scratch&path=glove-well-defaults-only.json',
});
assert.ok(defaultsOnlyState.downgrades.includes('local_browser_smoke_not_native_kaminos_host'), 'display defaults can still show adapter downgrade');
assert.deepEqual(defaultsOnlyState.sourceDowngrades, [], 'source downgrade evidence must not be fabricated from adapter defaults');
assert.equal(defaultsOnlyState.sourceCustody.greedyOwns, undefined, 'Greedy source custody must not be fabricated from display defaults');
assert.equal(defaultsOnlyState.sourceCustody.kaminosOwns, undefined, 'Kaminos source custody must not be fabricated from display defaults');
