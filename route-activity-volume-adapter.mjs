export const KAMINOS_ROUTE_ACTIVITY_VOLUME_ADAPTER_SCHEMA = 'kaminos.kiln.route-activity-volume-adapter.v0';

const DEFAULT_VOLUME_CONTROLS = Object.freeze({
  density: 0,
  fire: 0,
  radiance: 0,
  absorption: 0.85,
  glow: 0,
  smoke: 0,
  curl: 1.2,
  microdetail: 0.8,
  interfaceShred: 0.7,
  fireLicks: 0.5,
  projection: 0.65,
  speed: 2.2,
  raySteps: 72,
  adaptiveRays: 0.65,
  inputRadius: 0.1,
  flowRate: 0,
  resolution: 48,
  gridOverlay: 0,
  flowDebug: 0,
});

const HEAT_CONTROL_PRESETS = {
  burn: {
    adapterMode: 'volumetric-burn',
    activationState: 'active',
    density: 5.0,
    fire: 1.65,
    radiance: 2.05,
    absorption: 0.85,
    glow: 1.35,
    smoke: 3.1,
    curl: 2.65,
    microdetail: 2.1,
    interfaceShred: 2.1,
    fireLicks: 1.9,
    speed: 5,
    raySteps: 96,
    inputRadius: 0.18,
    flowRate: 0.35,
    resolution: 96,
  },
  ember: {
    adapterMode: 'volumetric-ember',
    activationState: 'active',
    density: 2.1,
    fire: 0.55,
    radiance: 0.72,
    absorption: 0.95,
    glow: 0.95,
    smoke: 1.45,
    curl: 1.65,
    microdetail: 1.1,
    interfaceShred: 1.05,
    fireLicks: 0.7,
    speed: 2.8,
    raySteps: 72,
    inputRadius: 0.1,
    flowRate: 0.06,
    resolution: 48,
  },
  pilot: {
    adapterMode: 'volumetric-pilot',
    activationState: 'active',
    density: 1.25,
    fire: 0.32,
    radiance: 0.42,
    absorption: 0.8,
    glow: 0.38,
    smoke: 0.55,
    curl: 1.15,
    microdetail: 0.72,
    interfaceShred: 0.5,
    fireLicks: 0.35,
    speed: 1.8,
    raySteps: 56,
    inputRadius: 0.08,
    flowRate: 0.035,
    resolution: 32,
  },
  'weak-heat': {
    adapterMode: 'volumetric-weak-heat',
    activationState: 'active',
    density: 1.45,
    fire: 0.24,
    radiance: 0.28,
    absorption: 1.1,
    glow: 0.26,
    smoke: 1.1,
    curl: 1.05,
    microdetail: 0.72,
    interfaceShred: 0.65,
    fireLicks: 0.18,
    speed: 1.5,
    raySteps: 56,
    inputRadius: 0.1,
    flowRate: 0.028,
    resolution: 32,
  },
  snuff: {
    adapterMode: 'volumetric-snuff',
    activationState: 'active',
    density: 1.8,
    fire: 0,
    radiance: 0.04,
    absorption: 1.45,
    glow: 0.08,
    smoke: 2.25,
    curl: 1.25,
    microdetail: 0.9,
    interfaceShred: 1.2,
    fireLicks: 0,
    speed: 1.15,
    raySteps: 64,
    inputRadius: 0.13,
    flowRate: 0.025,
    resolution: 48,
  },
  glow: {
    adapterMode: 'volumetric-glow',
    activationState: 'active',
    density: 1.4,
    fire: 0.18,
    radiance: 0.34,
    absorption: 0.92,
    glow: 1.15,
    smoke: 0.72,
    curl: 0.85,
    microdetail: 0.7,
    interfaceShred: 0.38,
    fireLicks: 0.16,
    speed: 1.1,
    raySteps: 56,
    inputRadius: 0.1,
    flowRate: 0.018,
    resolution: 32,
  },
  preheat: {
    adapterMode: 'volumetric-preheat',
    activationState: 'active',
    density: 0.95,
    fire: 0.12,
    radiance: 0.2,
    absorption: 0.82,
    glow: 0.28,
    smoke: 0.35,
    curl: 0.75,
    microdetail: 0.55,
    interfaceShred: 0.28,
    fireLicks: 0.1,
    speed: 1.05,
    raySteps: 48,
    inputRadius: 0.08,
    flowRate: 0.016,
    resolution: 32,
  },
  bank: {
    adapterMode: 'volumetric-bank',
    activationState: 'active',
    density: 1.65,
    fire: 0.22,
    radiance: 0.38,
    absorption: 0.95,
    glow: 1.05,
    smoke: 1.15,
    curl: 0.95,
    microdetail: 0.8,
    interfaceShred: 0.55,
    fireLicks: 0.22,
    speed: 1.25,
    raySteps: 56,
    inputRadius: 0.1,
    flowRate: 0.024,
    resolution: 48,
  },
  cooled: {
    adapterMode: 'volumetric-cooled',
    activationState: 'idle',
    density: 0.4,
    fire: 0,
    radiance: 0,
    glow: 0.1,
    smoke: 0.08,
    flowRate: 0,
  },
  cold: {
    adapterMode: 'volumetric-cold',
    activationState: 'idle',
  },
};

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function controlsForHeatClass(heatClass) {
  const preset = HEAT_CONTROL_PRESETS[heatClass] || HEAT_CONTROL_PRESETS.cold;
  return {
    adapterMode: preset.adapterMode,
    activationState: preset.activationState,
    volumeControls: {
      ...DEFAULT_VOLUME_CONTROLS,
      ...preset,
      adapterMode: undefined,
      activationState: undefined,
    },
  };
}

function volumePrimitiveForRouteActivity(routeActivity, volumeControls) {
  if (!routeActivity?.routeRunId || volumeControls.flowRate <= 0) return null;
  const radius = clampNumber(volumeControls.inputRadius, 0.04, 0.7, 0.1);
  return {
    id: `${routeActivity.routeRunId}-route-volume`,
    kind: 'fire_smoke',
    shape: 'sphere',
    couplingSource: 'route-activity',
    targetRouteRunId: routeActivity.routeRunId,
    targetActivityId: routeActivity.activityId,
    topologyAuthority: 'status-volume-proxy',
    placeholderContract: 'route-activity-status-volume-not-asset-geometry',
    routeActivity: {
      schema: routeActivity.schema,
      activityId: routeActivity.activityId,
      routeRunId: routeActivity.routeRunId,
      visualAuthority: routeActivity.visualAuthority,
      heatClass: routeActivity.fire?.heatClass || 'cold',
      truthClass: routeActivity.fire?.truthClass || routeActivity.truthMode || 'unknown',
    },
    transform: {
      position: [0, -0.05, 0],
      rotation: [0, 0, 0],
      scale: [radius, radius, radius],
    },
    simulation: {
      sourceRadius: radius,
      flowRate: clampNumber(volumeControls.flowRate, 0, 2.5, 0),
      heatClass: routeActivity.fire?.heatClass || 'cold',
      visualAuthority: routeActivity.visualAuthority || 'none',
      warningLoad: routeActivity.fire?.warningLoad || 0,
    },
  };
}

export function deriveRouteActivityVolumeAdapter(routeActivity) {
  const activity = routeActivity && typeof routeActivity === 'object' ? routeActivity : {};
  const routeViolations = Array.isArray(activity.falseAuthorityViolations)
    ? activity.falseAuthorityViolations
    : [];
  const routeHeatClass = activity.fire?.heatClass || 'cold';
  const {
    adapterMode,
    activationState,
    volumeControls,
  } = controlsForHeatClass(routeHeatClass);
  const falseAuthorityViolations = [...routeViolations];
  const sourceTruthWarnings = [...new Set([
    ...(Array.isArray(activity.sourceTruthWarnings) ? activity.sourceTruthWarnings : []),
  ])];

  const routeAllowsFullBurn = activity.fire?.allowsFullBurn === true
    && activity.visualAuthority === 'live-compute'
    && routeHeatClass === 'burn';
  const fullBurnRequested = routeHeatClass === 'burn' || volumeControls.fire >= 1.2;

  let effectiveActivationState = activationState;
  let effectiveControls = { ...volumeControls };
  if (routeViolations.length > 0) {
    falseAuthorityViolations.push('route_activity_false_authority_blocked_volume');
    effectiveActivationState = 'blocked';
    effectiveControls = { ...DEFAULT_VOLUME_CONTROLS };
  } else if (fullBurnRequested && !routeAllowsFullBurn) {
    falseAuthorityViolations.push('volume_full_burn_without_route_authority');
    effectiveActivationState = 'blocked';
    effectiveControls = { ...DEFAULT_VOLUME_CONTROLS };
  }

  const allowsVolumetricBurn = effectiveActivationState === 'active' && routeAllowsFullBurn;
  const primitive = effectiveActivationState === 'active'
    ? volumePrimitiveForRouteActivity(activity, effectiveControls)
    : null;

  return {
    schema: KAMINOS_ROUTE_ACTIVITY_VOLUME_ADAPTER_SCHEMA,
    adapterId: `${activity.routeRunId || 'unknown'}-route-volume-adapter`,
    routeActivitySchema: activity.schema || null,
    routeActivityId: activity.activityId || null,
    routeRunId: activity.routeRunId || null,
    adapterMode: effectiveActivationState === 'blocked' ? 'volumetric-blocked' : adapterMode,
    activationState: effectiveActivationState,
    visualAuthority: activity.visualAuthority || 'none',
    heatClass: routeHeatClass,
    truthClass: activity.fire?.truthClass || activity.truthMode || 'unknown',
    allowsVolumetricBurn,
    sourceTruthWarnings,
    falseAuthorityViolations,
    volumeControls: effectiveControls,
    volumePrimitive: primitive,
  };
}

export function chooseRouteActivityForVolume(routeActivities = []) {
  const activities = Array.isArray(routeActivities) ? routeActivities.filter(Boolean) : [];
  return activities.find(activity => activity.fire?.allowsFullBurn === true)
    || activities.find(activity => activity.visualAuthority === 'partial-output')
    || activities.find(activity => activity.visualAuthority === 'failure-report')
    || activities.find(activity => activity.visualAuthority === 'fixture')
    || activities[0]
    || null;
}
