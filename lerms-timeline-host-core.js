import {
  KAMINOS_HOST_SURFACE_STATE_SCHEMA,
  createHostSurfaceState,
  objectOrEmpty,
  uniqueStrings,
} from './host-surface-core.js';
import {
  LERMS_PREVIEW_ACTOR_MOTION_TIMELINE_ROUTE,
  LERMS_PREVIEW_ACTOR_MOTION_TIMELINE_SCHEMA,
  normalizeLermsPreviewActorMotionTimelineReport,
} from './world-chambers-core.js';

export const KAMINOS_LERMS_MOVING_TIMELINE_HOST_STATE_SCHEMA = 'kaminos.lerms-moving-timeline-host.state.v0';
export const KAMINOS_LERMS_MOVING_TIMELINE_HOST_ROUTE = 'kaminos/lerms-moving-timeline-host';

export const LERMS_MOVING_TIMELINE_HOST_ADAPTER = {
  hostId: 'lerms-moving-timeline',
  hostLabel: 'LERMS Moving Timeline',
  hostRoute: KAMINOS_LERMS_MOVING_TIMELINE_HOST_ROUTE,
  hostStateSchema: KAMINOS_LERMS_MOVING_TIMELINE_HOST_STATE_SCHEMA,
  packetSchema: LERMS_PREVIEW_ACTOR_MOTION_TIMELINE_SCHEMA,
  packetRoute: LERMS_PREVIEW_ACTOR_MOTION_TIMELINE_ROUTE,
  defaultProducerDiaulos: 'lerm-horde-fucker',
  defaultSourceAuthority: 'source-owned-timeline-packet',
  defaultSourceTruthAuthority: 'lerms.timelineBehaviorTruth',
  defaultDowngrades: ['timeline_playback_not_behavior_engine'],
  defaultRejectedDebugSurfaces: [
    {
      surface: 'old_8790_actor_timeline_debug_route',
      label: 'Old 8790 actor timeline route',
      acceptanceSurface: false,
      reason: 'old specialized debug route can provide evidence but is not the composed Kaminos moving host acceptance surface',
    },
  ],
};

export function createLermsMovingTimelineHostState(report, options = {}) {
  const timelineState = normalizeLermsPreviewActorMotionTimelineReport(report, options.payloadSource || options.actorMotionTimelineSource || null);
  const timeline = objectOrEmpty(report?.timeline || report);
  const source = {
    producerDiaulos: 'lerm-horde-fucker',
    route: timelineState.route,
    authority: 'source-owned-timeline-packet',
    sourceTruthAuthority: 'lerms.timelineBehaviorTruth',
    ...objectOrEmpty(timeline.source),
  };
  const custody = {
    lermsOwns: ['timelineBehaviorTruth'],
    kaminosOwns: ['host display', 'camera witness mechanics'],
    ...objectOrEmpty(timelineState.custody),
  };
  const downgrades = uniqueStrings(
    LERMS_MOVING_TIMELINE_HOST_ADAPTER.defaultDowngrades,
    timelineState.downgrades,
    timeline.downgrades,
  );
  const hostSurface = createHostSurfaceState({
    adapter: LERMS_MOVING_TIMELINE_HOST_ADAPTER,
    packetSchema: timelineState.payloadSchema,
    packetRoute: timelineState.route,
    source,
    freshness: timeline.freshness,
    downgrades,
    rejectedDebugSurfaces: timeline.rejectedDebugSurfaces || timeline.rejectedSurfaces,
    custody,
    hostSpecific: {
      frameCount: timelineState.frameCount,
      durationMs: timelineState.durationMs,
      actorIds: timelineState.actorIds,
      movingActorIds: timelineState.movingActorIds,
      stateTransitions: timelineState.stateTransitions,
    },
  }, options);

  return {
    ...timelineState,
    schema: KAMINOS_LERMS_MOVING_TIMELINE_HOST_STATE_SCHEMA,
    hostSurfaceSchema: KAMINOS_HOST_SURFACE_STATE_SCHEMA,
    route: KAMINOS_LERMS_MOVING_TIMELINE_HOST_ROUTE,
    hostId: hostSurface.hostId,
    hostLabel: hostSurface.hostLabel,
    hostRoute: hostSurface.hostRoute,
    effectiveUrl: hostSurface.effectiveUrl,
    loadedAt: hostSurface.loadedAt,
    packetSchema: timelineState.payloadSchema,
    packetRoute: timelineState.route,
    packetUrl: report?.packetUrl || null,
    source: hostSurface.source,
    sourceAuthority: hostSurface.sourceAuthority,
    sourceTruthAuthority: hostSurface.sourceTruthAuthority,
    freshness: hostSurface.freshness,
    downgrades: hostSurface.downgrades,
    rejectedDebugSurfaces: hostSurface.rejectedDebugSurfaces,
    custody: hostSurface.custody,
    hostSurface,
  };
}
